import { requireElevenLabsApiKey } from "@/lib/env";
import { NextResponse } from "next/server";

/** Map ElevenLabs error JSON to a client-safe message when we recognize it. */
function elevenLabsTtsUserMessage(body: string): string | null {
  try {
    const j = JSON.parse(body) as {
      detail?: { status?: string; message?: string };
    };
    const st = j.detail?.status;
    if (st === "missing_permissions") {
      return (
        "ElevenLabs API key is missing the Text to speech permission. " +
        "In the ElevenLabs dashboard (API keys), enable Text to speech for this key or create a new key with that permission."
      );
    }
  } catch {
    /* not JSON */
  }
  return null;
}

type TtsBody = {
  text?: string;
  voiceId?: string;
  stability?: number;
  similarity_boost?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TtsBody;
    const text = (body.text ?? "").trim();
    const voiceId = body.voiceId ?? "";
    const stability =
      typeof body.stability === "number" ? body.stability : 0.55;
    const similarity_boost =
      typeof body.similarity_boost === "number" ? body.similarity_boost : 0.78;

    if (!text || !voiceId) {
      return NextResponse.json(
        { error: "text and voiceId required" },
        { status: 400 },
      );
    }

    const key = requireElevenLabsApiKey();
    const modelId =
      process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5";
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?optimize_streaming_latency=4`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: Math.min(1, Math.max(0, stability)),
          similarity_boost: Math.min(1, Math.max(0, similarity_boost)),
          style: 0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      const specific = elevenLabsTtsUserMessage(err);
      const status =
        res.status >= 400 && res.status < 600 ? res.status : 502;
      return NextResponse.json(
        specific
          ? { error: specific }
          : { error: "ElevenLabs TTS failed", detail: err.slice(0, 300) },
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
    const msg = e instanceof Error ? e.message : "TTS failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
