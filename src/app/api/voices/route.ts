import { requireElevenLabsApiKey } from "@/lib/env";
import { NextResponse } from "next/server";

type ElevenVoice = { voice_id: string; name: string };

export async function GET() {
  try {
    const key = requireElevenLabsApiKey();
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { error: "ElevenLabs voices fetch failed", detail: err.slice(0, 200) },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { voices: ElevenVoice[] };
    const voices = (data.voices ?? []).map((v) => ({
      id: v.voice_id,
      name: v.name,
    }));
    return NextResponse.json({ voices });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
