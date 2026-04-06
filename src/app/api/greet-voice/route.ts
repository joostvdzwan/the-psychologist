import { createElevenLabsStream } from "@/lib/elevenlabs-ws";
import { gemmaGenerateTextStream } from "@/lib/gemma";
import { getPsychologistById } from "@/lib/psychologists";
import { type PersonaInfo, greetingPrompt } from "@/lib/prompts";
import { appendModelMessage, getSession } from "@/lib/session-store";
import { NextResponse } from "next/server";

type GreetVoiceBody = {
  sessionId?: string;
  voiceId?: string;
  stability?: number;
  similarity_boost?: number;
};

const FLUSH_RE = /[.!?]\s*$/;

export async function POST(req: Request) {
  const enc = new TextEncoder();
  const writeLine = (
    controller: ReadableStreamDefaultController,
    obj: object,
  ) => {
    controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
  };

  try {
    const body = (await req.json()) as GreetVoiceBody;
    const sessionId = body.sessionId ?? "";
    const voiceId = body.voiceId ?? "";
    const stability =
      typeof body.stability === "number" ? body.stability : 0.55;
    const similarityBoost =
      typeof body.similarity_boost === "number"
        ? body.similarity_boost
        : 0.78;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId required" },
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

    const psych = getPsychologistById(session.psychologistId);
    const persona: PersonaInfo | undefined = psych
      ? {
          name: psych.name,
          approach: psych.approach,
          personality: psych.personality,
        }
      : undefined;

    const prompt = greetingPrompt(persona);

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

          let fullReply = "";
          let wsReady = false;
          let pendingText = "";

          elStream.ready.then(() => {
            wsReady = true;
            if (pendingText) {
              elStream!.send(pendingText);
              if (FLUSH_RE.test(pendingText)) elStream!.flush();
              pendingText = "";
            }
          });

          for await (const delta of gemmaGenerateTextStream(prompt)) {
            fullReply += delta;
            writeLine(controller, { type: "text", data: delta });

            if (wsReady) {
              elStream.send(delta);
              if (FLUSH_RE.test(fullReply)) elStream.flush();
            } else {
              pendingText += delta;
            }
          }

          await elStream.ready;
          elStream.end();
          await audioPromise;

          const reply = fullReply.trim();
          appendModelMessage(sessionId, reply);
          writeLine(controller, {
            type: "done",
            data: { reply, crisis: false },
          });
        } catch (err) {
          writeLine(controller, {
            type: "error",
            data: {
              message: err instanceof Error ? err.message : "Greeting failed",
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
    const msg = e instanceof Error ? e.message : "Greeting failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
