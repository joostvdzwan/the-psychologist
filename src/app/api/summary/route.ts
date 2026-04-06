import { gemmaGenerateWithImage } from "@/lib/gemma";
import { buildSummaryPrompt, EMPTY_VISION, formatVisionForDialogue } from "@/lib/prompts";
import type { VisionContext } from "@/lib/prompts";
import { extractJsonObject } from "@/lib/parse-model-json";
import { getSession, updateSummary } from "@/lib/session-store";
import { NextResponse } from "next/server";

const VISION_FIELDS: (keyof VisionContext)[] = [
  "face",
  "gaze",
  "posture",
  "movement",
  "environment",
  "overall_affect",
  "affect_shift",
  "congruence_note",
  "arousal_level",
];

function parseVision(raw: string): { vision: VisionContext; dialogueText: string } {
  const json = extractJsonObject(raw);
  const obj = JSON.parse(json) as Record<string, unknown>;
  const vision: VisionContext = { ...EMPTY_VISION };
  for (const k of VISION_FIELDS) {
    if (typeof obj[k] === "string") {
      vision[k] = obj[k] as string;
    }
  }
  return { vision, dialogueText: formatVisionForDialogue(vision) };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const imageBase64 = typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    const mimeType =
      typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
    const seq = typeof body.seq === "number" ? body.seq : undefined;

    if (!sessionId || !imageBase64) {
      return NextResponse.json(
        { error: "sessionId and imageBase64 required" },
        { status: 400 },
      );
    }

    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session expired or invalid" }, { status: 404 });
    }

    const summaryPrompt = buildSummaryPrompt(session.vision);
    const raw = await gemmaGenerateWithImage(
      imageBase64,
      mimeType,
      summaryPrompt,
    );

    let vision: VisionContext;
    let dialogueText: string;
    try {
      ({ vision, dialogueText } = parseVision(raw));
    } catch {
      vision = {
        ...EMPTY_VISION,
        overall_affect: `(parse error) ${raw.slice(0, 200)}`,
      };
      dialogueText = formatVisionForDialogue(vision);
    }

    const { ok, seq: newSeq } = updateSummary(sessionId, dialogueText, vision, seq);
    if (!ok) {
      return NextResponse.json({ error: "Session expired" }, { status: 404 });
    }

    return NextResponse.json({ vision, seq: newSeq, affect_shift: vision.affect_shift });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Summary failed";
    const status =
      e instanceof Error && "status" in e && (e as { status?: number }).status === 429
        ? 429
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
