export function requireGemmaApiKey(): string {
  const k = process.env.GEMMA_API_KEY;
  if (!k) throw new Error("GEMMA_API_KEY is not set");
  return k;
}

export function requireElevenLabsApiKey(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not set");
  return k;
}

/** Dialogue model — fast text-only generation. */
export function gemmaModelId(): string {
  return process.env.GEMMA_MODEL_ID ?? "gemini-2.5-flash-lite";
}

/** Vision model — multimodal for facial/body-language/scene analysis. */
export function gemmaVisionModelId(): string {
  return process.env.GEMMA_VISION_MODEL_ID ?? "gemini-2.5-flash";
}
