import type { VisionContext } from "./prompts";
import { EMPTY_VISION } from "./prompts";

export type ChatMessage = { role: "user" | "model"; text: string };

export type VoiceStyle = {
  stability: number;
  similarity_boost: number;
};

export type SessionRecord = {
  id: string;
  createdAt: number;
  endsAt: number;
  voiceId: string;
  psychologistId: string;
  summary: string;
  vision: VisionContext;
  summaryUpdatedAt: number;
  summarySeq: number;
  messages: ChatMessage[];
};

const SESSION_MS = 10 * 60 * 1000;

const store = new Map<string, SessionRecord>();

export function createSession(psychologistId: string, voiceId: string): SessionRecord {
  const id = crypto.randomUUID();
  const now = Date.now();
  const rec: SessionRecord = {
    id,
    createdAt: now,
    endsAt: now + SESSION_MS,
    voiceId,
    psychologistId,
    summary: "No visual context yet (camera off or still initializing).",
    vision: { ...EMPTY_VISION },
    summaryUpdatedAt: now,
    summarySeq: 0,
    messages: [],
  };
  store.set(id, rec);
  return rec;
}

export function getSession(id: string): SessionRecord | undefined {
  const s = store.get(id);
  if (!s) return undefined;
  if (Date.now() > s.endsAt) {
    store.delete(id);
    return undefined;
  }
  return s;
}

export function updateSummary(
  id: string,
  text: string,
  vision: VisionContext,
  clientSeq: number | undefined,
): { ok: boolean; seq: number } {
  const s = getSession(id);
  if (!s) return { ok: false, seq: 0 };
  if (clientSeq != null && clientSeq < s.summarySeq) {
    return { ok: true, seq: s.summarySeq };
  }
  s.summarySeq += 1;
  s.summary = text;
  s.vision = vision;
  s.summaryUpdatedAt = Date.now();
  return { ok: true, seq: s.summarySeq };
}

export function appendMessages(
  id: string,
  userText: string,
  modelText: string,
): boolean {
  const s = getSession(id);
  if (!s) return false;
  s.messages.push({ role: "user", text: userText });
  s.messages.push({ role: "model", text: modelText });
  return true;
}

export function appendModelMessage(id: string, text: string): boolean {
  const s = getSession(id);
  if (!s) return false;
  s.messages.push({ role: "model", text });
  return true;
}
