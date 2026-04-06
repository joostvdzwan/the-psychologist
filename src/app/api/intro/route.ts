import { requireElevenLabsApiKey } from "@/lib/env";
import { getPsychologistById } from "@/lib/psychologists";
import { NextResponse } from "next/server";

type IntroBody = {
  psychologistId?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IntroBody;
    const psychologistId = body.psychologistId ?? "";

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
        { error: `No voice configured for ${psych.name}. Set the VOICE_ID_${psych.id.toUpperCase()} env var.` },
        { status: 500 },
      );
    }

    const key = requireElevenLabsApiKey();
    const modelId =
      process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5";
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(psych.voiceId)}/stream?optimize_streaming_latency=4`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: psych.introText,
        model_id: modelId,
        voice_settings: {
          stability: 0.55,
          similarity_boost: 0.78,
          style: 0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      const status = res.status >= 400 && res.status < 600 ? res.status : 502;
      return NextResponse.json(
        { error: "ElevenLabs TTS failed", detail: err.slice(0, 300) },
        { status },
      );
    }

    return new NextResponse(res.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Intro TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
