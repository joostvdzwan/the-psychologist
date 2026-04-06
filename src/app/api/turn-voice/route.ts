import { CRISIS_MESSAGE, detectCrisisSignal } from "@/lib/crisis";
import { createElevenLabsStream } from "@/lib/elevenlabs-ws";
import { gemmaGenerateTextStream } from "@/lib/gemma";
import { getPsychologistById } from "@/lib/psychologists";
import { type PersonaInfo, dialoguePlainSystemBlock } from "@/lib/prompts";
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
) {
  const system = dialoguePlainSystemBlock(sessionSummary, persona);
  return `${system}

Conversation so far:
${history || "(start of session)"}

Patient said:
${transcript}

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
        }
      : undefined;

    const prompt = buildPlainPrompt(
      session.summary,
      transcript,
      history,
      persona,
    );

    const stream = new ReadableStream({
      async start(controller) {
        let elStream: ReturnType<typeof createElevenLabsStream> | null = null;
        try {
          elStream = createElevenLabsStream({
            voiceId,
            stability,
            similarityBoost,
          });
          await elStream.ready;

          const audioPromise = (async () => {
            for await (const b64 of elStream!.audioChunks()) {
              writeLine(controller, { type: "audio", data: b64 });
            }
          })();

          let fullReply = "";
          for await (const delta of gemmaGenerateTextStream(prompt)) {
            fullReply += delta;
            writeLine(controller, { type: "text", data: delta });
            elStream.send(delta);
          }

          elStream.end();
          await audioPromise;

          const reply = fullReply.trim();
          appendMessages(sessionId, transcript, reply);
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
