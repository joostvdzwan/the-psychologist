/** Structured output from Gemma 4 vision analysis. */
export type VisionContext = {
  face: string;
  gaze: string;
  posture: string;
  movement: string;
  environment: string;
  overall_affect: string;
};

export const EMPTY_VISION: VisionContext = {
  face: "not yet analyzed",
  gaze: "unknown",
  posture: "unknown",
  movement: "unknown",
  environment: "unknown",
  overall_affect: "No visual context yet.",
};

export const SUMMARY_SYSTEM = `Non-verbal cue analyst for a therapy app. Given a camera frame (JPEG) of the patient, output ONLY a compact JSON object (no markdown, no fences):
{"face":"expression detail","gaze":"direction/engagement","posture":"open/closed, lean, arms, shoulders","movement":"still/fidgeting/gesturing","environment":"1 sentence","overall_affect":"1-2 hedged sentences integrating face+posture+gaze"}
Be specific (e.g. "slight furrow between brows"). If no face visible, describe what IS visible. Never diagnose. Use hedged language (appears, may, seems).`;

export function formatVisionForDialogue(v: VisionContext): string {
  return `Non-verbal observations (updated every few seconds — integrate gently):
  Face: ${v.face}
  Gaze: ${v.gaze}
  Posture: ${v.posture}
  Movement: ${v.movement}
  Environment: ${v.environment}
  Overall affect: ${v.overall_affect}`;
}

export type PersonaInfo = {
  name: string;
  approach: string;
  personality: string;
};

export function greetingPrompt(persona?: PersonaInfo): string {
  const identity = persona
    ? `You are ${persona.name}, a ${persona.approach} psychologist. ${persona.personality}`
    : `You are a warm, experienced psychologist.`;

  return `${identity}
A new patient joined your live voice session. Give a brief warm opening (1-3 sentences, under 40 words). Welcome them, set the tone, invite sharing. Plain language only — no markdown, no labels. Don't state your name. Be spontaneous.`;
}

/** Plain-text dialogue: streams cleanly, uses structured non-verbal context. */
export function dialoguePlainSystemBlock(
  sceneSummary: string,
  persona?: PersonaInfo,
): string {
  const identity = persona
    ? `You are ${persona.name}, a ${persona.approach} psychologist. ${persona.personality} Live voice session. NOT medical care.`
    : `You are a warm, experienced psychologist. Live voice session. NOT medical care.`;

  return `${identity}
${sceneSummary}
Rules: Plain language only (no markdown/JSON). 2-4 short sentences. Stay in character. Use non-verbal observations to attune tone — don't narrate them unless asked. Soften tone if patient appears tense. Never claim to know their inner state. If self-harm mentioned, urge professional help.`;
}
