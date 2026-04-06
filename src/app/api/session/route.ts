import { getPsychologistById } from "@/lib/psychologists";
import { createSession } from "@/lib/session-store";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const psychologistId =
      typeof body.psychologistId === "string" ? body.psychologistId : "";
    if (!psychologistId) {
      return NextResponse.json(
        { error: "psychologistId required" },
        { status: 400 },
      );
    }

    const psych = getPsychologistById(psychologistId);
    if (!psych) {
      return NextResponse.json(
        { error: "Unknown psychologist" },
        { status: 404 },
      );
    }
    if (!psych.voiceId) {
      return NextResponse.json(
        { error: `No voice configured for ${psych.name}. Set VOICE_ID_${psych.id.toUpperCase()}.` },
        { status: 500 },
      );
    }

    const session = createSession(psych.id, psych.voiceId);
    return NextResponse.json({
      sessionId: session.id,
      endsAt: session.endsAt,
      voiceId: psych.voiceId,
    });
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
}
