type PermissionsPanelProps = {
  onAllow: () => void;
  onBack: () => void;
  error: string | null;
  panelClass: string;
};

export function PermissionsPanel({ onAllow, onBack, error, panelClass }: PermissionsPanelProps) {
  return (
    <div className={`space-y-5 ${panelClass}`}>
      <p className="text-sm leading-relaxed text-[var(--psych-muted)]">
        Camera provides environmental and facial context; the microphone
        captures your speech. Media is sent only to your configured APIs for
        this session.
      </p>
      {error && (
        <p className="text-sm text-[var(--psych-danger)]">{error}</p>
      )}
      <button
        type="button"
        onClick={onAllow}
        className="w-full rounded-xl bg-[var(--psych-accent)] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[var(--psych-accent-hover)]"
      >
        Allow camera and microphone
      </button>
      <button
        type="button"
        onClick={onBack}
        className="w-full text-sm text-[var(--psych-muted)] underline-offset-4 transition hover:text-[var(--psych-fg)] hover:underline"
      >
        Back
      </button>
    </div>
  );
}
