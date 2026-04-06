import { gemmaGenerateTextStream } from "@/lib/gemma";
import { getPsychologistById } from "@/lib/psychologists";
import { type PersonaInfo, greetingPrompt } from "@/lib/prompts";
import { appendModelMessage, getSession } from "@/lib/session-store";
import { NextResponse } from "next/server";

type GreetBody = {
  sessionId?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GreetBody;
    const sessionId = body.sessionId ?? "";

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId required" },
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
      ? { name: psych.name, approach: psych.approach, personality: psych.personality }
      : undefined;

    const prompt = greetingPrompt(persona);

    const encoder = new TextEncoder();
    const sid = sessionId;
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let full = "";
          for await (const delta of gemmaGenerateTextStream(prompt)) {
            full += delta;
            controller.enqueue(encoder.encode(delta));
          }
          appendModelMessage(sid, full.trim());
          controller.close();
        } catch (err) {
          controller.error(err);
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
    const msg = e instanceof Error ? e.message : "Greet failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
