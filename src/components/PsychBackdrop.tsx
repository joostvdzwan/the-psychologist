/**
 * Full-viewport ambient layers: gradient drift, vignette, subtle noise.
 * Lives under main content (z-0); siblings should use z-10+.
 */
export function PsychBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      aria-hidden
    >
      <div className="psych-gradient-layer absolute inset-0" />
      <div className="psych-vignette absolute inset-0" />
      <div className="psych-noise absolute inset-0 opacity-[0.04] mix-blend-overlay dark:opacity-[0.055]" />
    </div>
  );
}
