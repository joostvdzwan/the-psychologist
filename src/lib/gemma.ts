import { createUserContent, GoogleGenAI } from "@google/genai";
import { gemmaModelId, gemmaVisionModelId, requireGemmaApiKey } from "./env";

const DIALOGUE_CONFIG = {
  maxOutputTokens: 400,
  temperature: 0.75,
} as const;

let _client: GoogleGenAI | null = null;

function client(): GoogleGenAI {
  if (!_client) _client = new GoogleGenAI({ apiKey: requireGemmaApiKey() });
  return _client;
}

export async function gemmaGenerateText(prompt: string): Promise<string> {
  const response = await client().models.generateContent({
    model: gemmaModelId(),
    contents: prompt,
    config: DIALOGUE_CONFIG,
  });
  return (response.text ?? "").trim();
}

/** Token stream for dialogue; yields incremental text chunks from the model. */
export async function* gemmaGenerateTextStream(
  prompt: string,
): AsyncGenerator<string, void, undefined> {
  const stream = await client().models.generateContentStream({
    model: gemmaModelId(),
    contents: prompt,
    config: DIALOGUE_CONFIG,
  });
  for await (const chunk of stream) {
    const t = chunk.text;
    if (t) yield t;
  }
}

export async function gemmaGenerateWithImage(
  imageBase64: string,
  mimeType: string,
  textPrompt: string,
): Promise<string> {
  const data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
  const contents = createUserContent([
    {
      inlineData: {
        mimeType: mimeType || "image/jpeg",
        data,
      },
    },
    { text: textPrompt },
  ]);
  const response = await client().models.generateContent({
    model: gemmaVisionModelId(),
    contents,
    config: {
      maxOutputTokens: 512,
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
  const text = (response.text ?? "").trim();
  if (!text) console.warn("[vision] empty model response", { model: gemmaVisionModelId() });
  return text;
}
