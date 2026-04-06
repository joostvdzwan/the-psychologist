const PATTERNS = [
  /\bkill\s+myself\b/i,
  /\b(end\s+it\s+all|suicide|suicidal)\b/i,
  /\bself[\s-]?harm\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bcan'?t\s+go\s+on\b/i,
];

export function detectCrisisSignal(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return PATTERNS.some((re) => re.test(t));
}

export const CRISIS_MESSAGE = `I'm not able to help with crisis situations. If you're in immediate danger, contact local emergency services right away. In the U.S., you can call or text 988 for the Suicide & Crisis Lifeline. This app is not medical care—please reach out to a qualified professional or crisis line.`;
