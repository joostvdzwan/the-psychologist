import { gemmaGenerateText } from "./gemma";
import { getSession, updateDigest } from "./session-store";

const RECENT_WINDOW = 8;
const inFlight = new Set<string>();

const DIGEST_PROMPT_PREFIX = `You are summarizing a therapy session for the therapist's continuity. Given the existing summary (if any) and new exchanges, produce a concise 2-4 sentence summary covering: key themes discussed, emotions expressed, important details the patient shared, and any patterns noticed. Write from the therapist's perspective. Do not include greetings or small talk. Plain text only.`;

/**
 * Fire-and-forget: compresses older messages into a running digest.
 * Call without awaiting — it runs in the background after the turn response
 * is already streaming.
 */
export function maybeCompressDigest(sessionId: string): void {
  const s = getSession(sessionId);
  if (!s) return;

  const cutoff = s.messages.length - RECENT_WINDOW;
  if (cutoff <= s.digestedUpTo) return;
  if (inFlight.has(sessionId)) return;

  inFlight.add(sessionId);

  const chunk = s.messages
    .slice(s.digestedUpTo, cutoff)
    .map((m) => `${m.role === "user" ? "Patient" : "Therapist"}: ${m.text}`)
    .join("\n");

  const existingPart = s.conversationDigest
    ? `Existing summary:\n${s.conversationDigest}\n\n`
    : "";

  const prompt = `${DIGEST_PROMPT_PREFIX}\n\n${existingPart}New exchanges to incorporate:\n${chunk}\n\nUpdated summary:`;

  gemmaGenerateText(prompt)
    .then((result) => {
      updateDigest(sessionId, result.trim(), cutoff);
    })
    .catch(() => {
      /* best-effort — digest is non-critical */
    })
    .finally(() => {
      inFlight.delete(sessionId);
    });
}
