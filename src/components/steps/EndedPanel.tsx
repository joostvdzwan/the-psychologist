type EndedPanelProps = {
  onRestart: () => void;
  panelClass: string;
};

export function EndedPanel({ onRestart, panelClass }: EndedPanelProps) {
  return (
    <div className={`space-y-6 text-center ${panelClass}`}>
      <p className="text-[var(--psych-fg)] leading-relaxed">
        Session complete. Thank you for trying the prototype.
      </p>
      <button
        type="button"
        onClick={onRestart}
        className="psych-breathe-cta w-full rounded-xl bg-[var(--psych-accent)] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[var(--psych-accent-hover)]"
      >
        Start over
      </button>
    </div>
  );
}
