type IntroPanelProps = {
  onBegin: () => void;
  panelClass: string;
};

export function IntroPanel({ onBegin, panelClass }: IntroPanelProps) {
  return (
    <div className={`space-y-5 ${panelClass}`}>
      <div
        className="rounded-xl border px-4 py-3.5 text-sm leading-relaxed"
        style={{
          borderColor: "var(--psych-warm-border)",
          background: "var(--psych-warm-bg)",
          color: "var(--psych-warm-fg)",
        }}
      >
        This app does not provide diagnosis or treatment. If you are in crisis,
        contact local emergency services or a crisis line (U.S.: 988).
      </div>
      <button
        type="button"
        onClick={onBegin}
        className="psych-breathe-cta w-full rounded-xl bg-[var(--psych-accent)] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[var(--psych-accent-hover)] motion-reduce:transition-none"
      >
        Begin session
      </button>
    </div>
  );
}
