import { CRISIS_MESSAGE, detectCrisisSignal } from "@/lib/crisis";
import { gemmaGenerateText, gemmaGenerateTextStream } from "@/lib/gemma";
import { getPsychologistById } from "@/lib/psychologists";
import { type PersonaInfo, dialoguePlainSystemBlock } from "@/lib/prompts";
import { appendMessages, getSession } from "@/lib/session-store";
import { NextResponse } from "next/server";

const DEFAULT_STYLE = { stability: 0.55, similarity_boost: 0.78 };

type TurnBody = {
  sessionId?: string;
  transcript?: string;
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
  try {
    const url = new URL(req.url);
    const wantStream = url.searchParams.get("stream") === "1";

    const body = (await req.json()) as TurnBody;
    const sessionId = body.sessionId ?? "";
    const transcript = (body.transcript ?? "").trim();

    if (!sessionId || !transcript) {
      return NextResponse.json(
        { error: "sessionId and transcript required" },
        { status: 400 },
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session expired or invalid" }, { status: 404 });
    }

    if (detectCrisisSignal(transcript)) {
      appendMessages(sessionId, transcript, CRISIS_MESSAGE);
      return NextResponse.json({
        crisis: true,
        reply: CRISIS_MESSAGE,
        voice_style: { ...DEFAULT_STYLE, stability: 0.62 },
      });
    }

    const history = session.messages
      .slice(-12)
      .map((m) => `${m.role === "user" ? "Patient" : "You"}: ${m.text}`)
      .join("\n");

    const psych = getPsychologistById(session.psychologistId);
    const persona: PersonaInfo | undefined = psych
      ? { name: psych.name, approach: psych.approach, personality: psych.personality }
      : undefined;

    const prompt = buildPlainPrompt(session.summary, transcript, history, persona);

    if (wantStream) {
      const encoder = new TextEncoder();
      const sid = sessionId;
      const userLine = transcript;
      const stream = new ReadableStream({
        async start(controller) {
          try {
            let full = "";
            for await (const delta of gemmaGenerateTextStream(prompt)) {
              full += delta;
              controller.enqueue(encoder.encode(delta));
            }
            appendMessages(sid, userLine, full.trim());
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
    }

    const raw = await gemmaGenerateText(prompt);
    const reply = raw.trim();
    appendMessages(sessionId, transcript, reply);

    return NextResponse.json({
      crisis: false,
      reply,
      voice_style: DEFAULT_STYLE,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Turn failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
