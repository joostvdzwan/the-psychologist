import { CRISIS_MESSAGE, detectCrisisSignal } from "@/lib/crisis";
import { createElevenLabsStream } from "@/lib/elevenlabs-ws";
import { gemmaGenerateTextStream } from "@/lib/gemma";
import { getPsychologistById } from "@/lib/psychologists";
import { type PersonaInfo, type VisionContext, dialoguePlainSystemBlock, getSessionPhase } from "@/lib/prompts";
import { maybeCompressDigest } from "@/lib/conversation-digest";
import { appendMessages, appendModelMessage, getSession } from "@/lib/session-store";
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
  createdAt?: number,
  endsAt?: number,
) {
  const isSilence = transcript === "[silence]";
  const phase = createdAt && endsAt ? getSessionPhase(createdAt, endsAt) : undefined;
  const system = dialoguePlainSystemBlock(sessionSummary, persona, vision, phase, isSilence);
  const digestSection = digest
    ? `\nEarlier in this session (summarized):\n${digest}\n\nRecent conversation:\n${history || "(start of session)"}`
    : `\nConversation so far:\n${history || "(start of session)"}`;

  const patientLine = isSilence
    ? `\n(The patient has been silent.)`
    : `\nPatient said: "${transcript}"`;

  return `${system}
${digestSection}
${patientLine}

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

    const isSilence = transcript === "[silence]";

    if (!isSilence && detectCrisisSignal(transcript)) {
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
          dialogueStyle: psych.dialogueStyle,
        }
      : undefined;

    const prompt = buildPlainPrompt(
      session.summary,
      transcript,
      history,
      persona,
      session.vision,
      session.conversationDigest || undefined,
      session.createdAt,
      session.endsAt,
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
          let earlyFlushed = false;
          const EARLY_FLUSH_CHARS = 32;

          if (!firstChunk.done && firstChunk.value) {
            fullReply += firstChunk.value;
            writeLine(controller, { type: "text", data: firstChunk.value });
            elStream.send(firstChunk.value);
            if (FLUSH_RE.test(fullReply)) { elStream.flush(); earlyFlushed = true; }
          }

          for await (const delta of llmIter) {
            fullReply += delta;
            writeLine(controller, { type: "text", data: delta });
            elStream.send(delta);
            if (!earlyFlushed && fullReply.length >= EARLY_FLUSH_CHARS) {
              elStream.flush();
              earlyFlushed = true;
            } else if (FLUSH_RE.test(fullReply)) {
              elStream.flush();
            }
          }

          elStream.end();
          await audioPromise;

          const reply = fullReply.trim();
          if (isSilence) {
            appendModelMessage(sessionId, reply);
          } else {
            appendMessages(sessionId, transcript, reply);
          }
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
