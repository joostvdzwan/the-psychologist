import { CRISIS_MESSAGE, detectCrisisSignal } from "@/lib/crisis";
import { createElevenLabsStream } from "@/lib/elevenlabs-ws";
import { gemmaGenerateTextStream } from "@/lib/gemma";
import { getPsychologistById } from "@/lib/psychologists";
import { type PersonaInfo, type VisionContext, dialoguePlainSystemBlock } from "@/lib/prompts";
import { maybeCompressDigest } from "@/lib/conversation-digest";
import { appendMessages, getSession } from "@/lib/session-store";
import { NextResponse } from "next/server";

type TurnVoiceBody = {
  sessionId?: string;
  transcript?: string;
  voiceId?: string;
  stability?: number;
  similarity_boost?: number;
};

function buildPlainPrompt(
  sessionSummary: string,
  transcript: string,
  history: string,
  persona?: PersonaInfo,
  vision?: VisionContext,
  digest?: string,
) {
  const system = dialoguePlainSystemBlock(sessionSummary, persona, vision);
  const digestSection = digest
    ? `\nEarlier in this session (summarized):\n${digest}\n\nRecent conversation:\n${history || "(start of session)"}`
    : `\nConversation so far:\n${history || "(start of session)"}`;

  return `${system}
${digestSection}

Patient said: "${transcript}"
Their current non-verbal presentation: ${sessionSummary}
If what they said and how they appear seem incongruent, gently and carefully explore that — guided by your therapeutic approach.

Your response:`;
}

export async function POST(req: Request) {
  const enc = new TextEncoder();
  const writeLine = (
    controller: ReadableStreamDefaultController,
    obj: object,
  ) => {
    controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
  };

  try {
    const body = (await req.json()) as TurnVoiceBody;
    const sessionId = body.sessionId ?? "";
    const transcript = (body.transcript ?? "").trim();
    const voiceId = body.voiceId ?? "";
    const stability =
      typeof body.stability === "number" ? body.stability : 0.55;
    const similarityBoost =
      typeof body.similarity_boost === "number"
        ? body.similarity_boost
        : 0.78;

    if (!sessionId || !transcript) {
      return NextResponse.json(
        { error: "sessionId and transcript required" },
        { status: 400 },
      );
    }
    if (!voiceId) {
      return NextResponse.json(
        { error: "voiceId required" },
        { status: 400 },
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session expired or invalid" },
        { status: 404 },
      );
    }

    if (detectCrisisSignal(transcript)) {
      appendMessages(sessionId, transcript, CRISIS_MESSAGE);
      return NextResponse.json({ crisis: true, reply: CRISIS_MESSAGE });
    }

    const history = session.messages
      .slice(-8)
      .map((m) => `${m.role === "user" ? "Patient" : "You"}: ${m.text}`)
      .join("\n");

    const psych = getPsychologistById(session.psychologistId);
    const persona: PersonaInfo | undefined = psych
      ? {
          name: psych.name,
          approach: psych.approach,
          personality: psych.personality,
          visionGuidance: psych.visionGuidance,
        }
      : undefined;

    const prompt = buildPlainPrompt(
      session.summary,
      transcript,
      history,
      persona,
      session.vision,
      session.conversationDigest || undefined,
    );

    const FLUSH_RE = /[.!?]\s*$/;

    const stream = new ReadableStream({
      async start(controller) {
        let elStream: ReturnType<typeof createElevenLabsStream> | null = null;
        try {
          elStream = createElevenLabsStream({
            voiceId,
            stability,
            similarityBoost,
          });

          const audioPromise = (async () => {
            for await (const b64 of elStream!.audioChunks()) {
              writeLine(controller, { type: "audio", data: b64 });
            }
          })();

          // Kick off LLM immediately so its TTFT overlaps with WS handshake
          const llmIter = gemmaGenerateTextStream(prompt);
          const firstChunkP = llmIter.next();
          const [firstChunk] = await Promise.all([firstChunkP, elStream.ready]);

          let fullReply = "";

          if (!firstChunk.done && firstChunk.value) {
            fullReply += firstChunk.value;
            writeLine(controller, { type: "text", data: firstChunk.value });
            elStream.send(firstChunk.value);
            if (FLUSH_RE.test(fullReply)) elStream.flush();
          }

          for await (const delta of llmIter) {
            fullReply += delta;
            writeLine(controller, { type: "text", data: delta });
            elStream.send(delta);
            if (FLUSH_RE.test(fullReply)) elStream.flush();
          }

          elStream.end();
          await audioPromise;

          const reply = fullReply.trim();
          appendMessages(sessionId, transcript, reply);
          maybeCompressDigest(sessionId);
          writeLine(controller, {
            type: "done",
            data: { reply, crisis: false },
          });
        } catch (err) {
          writeLine(controller, {
            type: "error",
            data: {
              message: err instanceof Error ? err.message : "Turn failed",
            },
          });
          elStream?.destroy();
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Turn failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
