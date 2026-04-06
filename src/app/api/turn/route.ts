import { CRISIS_MESSAGE, detectCrisisSignal } from "@/lib/crisis";
import { gemmaGenerateText, gemmaGenerateTextStream } from "@/lib/gemma";
import { getPsychologistById } from "@/lib/psychologists";
import { type PersonaInfo, type VisionContext, dialoguePlainSystemBlock, getSessionPhase } from "@/lib/prompts";
import { maybeCompressDigest } from "@/lib/conversation-digest";
import { appendMessages, appendModelMessage, getSession } from "@/lib/session-store";
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

    const isSilence = transcript === "[silence]";

    if (!isSilence && detectCrisisSignal(transcript)) {
      appendMessages(sessionId, transcript, CRISIS_MESSAGE);
      return NextResponse.json({
        crisis: true,
        reply: CRISIS_MESSAGE,
        voice_style: { ...DEFAULT_STYLE, stability: 0.62 },
      });
    }

    const history = session.messages
      .slice(-8)
      .map((m) => `${m.role === "user" ? "Patient" : "You"}: ${m.text}`)
      .join("\n");

    const psych = getPsychologistById(session.psychologistId);
    const persona: PersonaInfo | undefined = psych
      ? { name: psych.name, approach: psych.approach, personality: psych.personality, visionGuidance: psych.visionGuidance, dialogueStyle: psych.dialogueStyle }
      : undefined;

    const prompt = buildPlainPrompt(session.summary, transcript, history, persona, session.vision, session.conversationDigest || undefined, session.createdAt, session.endsAt);

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
            if (isSilence) {
              appendModelMessage(sid, full.trim());
            } else {
              appendMessages(sid, userLine, full.trim());
            }
            maybeCompressDigest(sid);
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
    if (isSilence) {
      appendModelMessage(sessionId, reply);
    } else {
      appendMessages(sessionId, transcript, reply);
    }
    maybeCompressDigest(sessionId);

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
