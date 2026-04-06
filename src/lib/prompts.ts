/** Structured output from Gemma 4 vision analysis. */
export type VisionContext = {
  face: string;
  gaze: string;
  posture: string;
  movement: string;
  environment: string;
  overall_affect: string;
  affect_shift: string;
  congruence_note: string;
  arousal_level: string;
};

export const EMPTY_VISION: VisionContext = {
  face: "not yet analyzed",
  gaze: "unknown",
  posture: "unknown",
  movement: "unknown",
  environment: "unknown",
  overall_affect: "No visual context yet.",
  affect_shift: "no previous observation",
  congruence_note: "not yet assessed",
  arousal_level: "unknown",
};

const SUMMARY_SYSTEM_BASE = `Non-verbal cue analyst for a therapy app. Given a camera frame (JPEG) of the patient, output ONLY a compact JSON object (no markdown, no fences):
{"face":"expression detail","gaze":"direction/engagement","posture":"open/closed, lean, arms, shoulders","movement":"still/fidgeting/gesturing","environment":"1 sentence","overall_affect":"1-2 hedged sentences integrating face+posture+gaze","affect_shift":"how presentation changed since last observation (e.g. 'relaxed to tense', 'no significant change')","congruence_note":"whether visible affect seems consistent or shifted suddenly","arousal_level":"low/moderate/high based on visible tension, movement, breathing"}
Be specific (e.g. "slight furrow between brows"). If no face visible, describe what IS visible. Never diagnose. Use hedged language (appears, may, seems).`;

export function buildSummaryPrompt(previousVision?: VisionContext): string {
  if (!previousVision || previousVision.face === "not yet analyzed") {
    return SUMMARY_SYSTEM_BASE + `\nThis is the FIRST observation — set affect_shift to "no previous observation".`;
  }
  return SUMMARY_SYSTEM_BASE + `\n\nPrevious observation for comparison:
  Face: ${previousVision.face}
  Gaze: ${previousVision.gaze}
  Posture: ${previousVision.posture}
  Movement: ${previousVision.movement}
  Overall affect: ${previousVision.overall_affect}
  Arousal: ${previousVision.arousal_level}
Compare the new frame against these previous observations to describe affect_shift accurately.`;
}

export function formatVisionForDialogue(v: VisionContext): string {
  return `Non-verbal observations (updated every few seconds — integrate gently):
  Face: ${v.face}
  Gaze: ${v.gaze}
  Posture: ${v.posture}
  Movement: ${v.movement}
  Environment: ${v.environment}
  Overall affect: ${v.overall_affect}
  Affect shift: ${v.affect_shift}
  Congruence: ${v.congruence_note}
  Arousal level: ${v.arousal_level}`;
}

export type PersonaInfo = {
  name: string;
  approach: string;
  personality: string;
  visionGuidance?: string;
  dialogueStyle?: string;
};

export type SessionPhase = "opening" | "exploring" | "closing";

export function getSessionPhase(createdAt: number, endsAt: number): SessionPhase {
  const elapsed = Date.now() - createdAt;
  const total = endsAt - createdAt;
  const remaining = total - elapsed;
  if (elapsed < 2 * 60 * 1000) return "opening";
  if (remaining < 2 * 60 * 1000) return "closing";
  return "exploring";
}

export function greetingPrompt(persona?: PersonaInfo, sceneSummary?: string): string {
  const identity = persona
    ? `You are ${persona.name}, a ${persona.approach} psychologist. ${persona.personality}`
    : `You are a warm, experienced psychologist.`;

  const visionLine = sceneSummary
    ? `\n${sceneSummary}\nYou may subtly attune your greeting to what you observe — but keep it light and welcoming. Don't narrate observations directly.`
    : "";

  const openerStyles = [
    "acknowledge something about the moment or setting",
    "share a brief, grounding thought before inviting them in",
    "gently name the feeling of starting a new conversation",
    "offer a warm observation and let silence do the rest",
    "express genuine curiosity about how they're arriving today",
  ];
  const style = openerStyles[Math.floor(Math.random() * openerStyles.length)];

  return `${identity}
A new patient just joined your live voice session. Give a brief, warm opening (1-3 sentences, under 40 words). Set the tone and gently open the space.
Style hint: ${style}.
IMPORTANT: Do NOT use the phrase "what's on your mind" or close variants — it's overused. Find a fresh, natural way in. Plain language only — no markdown, no labels. Don't state your name.${visionLine}`;
}

/** Plain-text dialogue: streams cleanly, uses structured non-verbal context. */
export function dialoguePlainSystemBlock(
  sceneSummary: string,
  persona?: PersonaInfo,
  vision?: VisionContext,
  phase?: SessionPhase,
  isSilence?: boolean,
): string {
  const identity = persona
    ? `You are ${persona.name}, a ${persona.approach} psychologist. ${persona.personality} Live voice session. NOT medical care.`
    : `You are a warm, experienced psychologist. Live voice session. NOT medical care.`;

  const visionRule = persona?.visionGuidance
    ? `Vision guidance (your approach): ${persona.visionGuidance}`
    : `Use non-verbal observations to attune tone.`;

  const styleBlock = persona?.dialogueStyle
    ? `\nTherapeutic style:\n${persona.dialogueStyle}`
    : "";

  const arousalPacing =
    vision?.arousal_level === "high"
      ? `\nThe patient appears to be in a state of high arousal. Slow your pacing, keep sentences short and grounding. Acknowledge what you sense gently ("it seems like a lot is coming up right now") and if it persists, suggest a brief pause or grounding exercise.`
      : "";

  const phaseGuidance = phase === "opening"
    ? `\nSession phase: OPENING. Focus on building rapport and safety. Be warm, open, exploratory. Don't push too deep yet.`
    : phase === "closing"
    ? `\nSession phase: CLOSING. The session is ending soon. Begin to consolidate — reflect back key themes, offer a grounding thought or takeaway. Don't open new threads.`
    : "";

  const silenceBlock = isSilence
    ? `\nThe patient has been silent for a while after your last response. Respond to the silence itself — don't repeat your last question or pretend they spoke. Use your therapeutic approach to decide whether to hold space, gently check in, or offer a soft observation based on what you see.`
    : "";

  return `${identity}
${sceneSummary}
${visionRule}${styleBlock}
Response variety (CRITICAL):
- Do NOT default to asking a question every turn. Vary your responses: use reflections, validations, observations, brief summaries, or simple acknowledging statements.
- Never end with more than one question. Often, end with a statement.
- Avoid "what's on your mind" and generic therapist clichés.
Clinical boundaries:
- Facilitate exploration — never give direct advice or tell the patient what to do.
- Never make interpretive leaps beyond what the patient has actually said.
- IMPORTANT: The non-verbal observations above are BACKGROUND CONTEXT to subtly inform your tone, pacing, and empathy. Most of the time, simply respond to what they said without commenting on appearance or body language.
- However, you MAY gently reference what you observe in three situations: (1) when the patient is being brief, vague, or withdrawn and a soft observation could help them open up, (2) when there is a striking incongruence between their words and visible presentation, or (3) when the patient explicitly asks you what you observe or how they appear. In case (3), give a thoughtful, detailed reflection based on the non-verbal observations above — be honest and specific, but frame everything with care and warmth. In cases (1) and (2), keep references tentative and inviting — never declarative.
- Never claim to know their inner state.
- If self-harm is mentioned, urge professional help immediately.${arousalPacing}${phaseGuidance}${silenceBlock}
Rules: Plain language only (no markdown/JSON). 2-4 short sentences. Stay in character. Focus on the patient's words.`;
}
