type PsychologistMeta = {
  id: string;
  name: string;
  gender: "male" | "female";
  approach: string;
  personality: string;
};

type SelectPanelProps = {
  psychologists: PsychologistMeta[];
  selectedId: string;
  onSelect: (id: string) => void;
  onContinue: () => void;
  introPlaying: string;
  introLoading: string;
  error: string | null;
  panelClass: string;
};

export function SelectPanel({
  psychologists,
  selectedId,
  onSelect,
  onContinue,
  introPlaying,
  introLoading,
  error,
  panelClass,
}: SelectPanelProps) {
  return (
    <div className={`space-y-5 ${panelClass}`}>
      <p className="text-sm leading-relaxed text-[var(--psych-muted)]">
        Choose the psychologist you&apos;d like to speak with. Click a card to
        hear them introduce themselves.
      </p>
      {error && (
        <p className="text-sm text-[var(--psych-danger)]">{error}</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {psychologists.map((p) => {
          const isSelected = selectedId === p.id;
          const isPlaying = introPlaying === p.id;
          const isLoadingIntro = introLoading === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={`relative flex flex-col gap-1.5 rounded-xl border p-4 text-left transition ${
                isSelected
                  ? "border-[var(--psych-accent)] bg-[color-mix(in_srgb,var(--psych-accent)_8%,transparent)] shadow-[0_0_16px_color-mix(in_srgb,var(--psych-accent)_18%,transparent)]"
                  : "border-[var(--psych-panel-border)] hover:border-[color-mix(in_srgb,var(--psych-accent)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--psych-accent)_4%,transparent)]"
              }`}
            >
              {(isPlaying || isLoadingIntro) && (
                <span className="absolute right-3 top-3 flex items-center gap-1.5 text-[10px] text-[var(--psych-accent)]">
                  {isLoadingIntro ? (
                    <span className="animate-pulse">Loading…</span>
                  ) : (
                    <>
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--psych-accent)] opacity-50" />
                        <span className="relative inline-flex size-2 rounded-full bg-[var(--psych-accent)]" />
                      </span>
                      Speaking
                    </>
                  )}
                </span>
              )}
              <span className="text-sm font-medium text-[var(--psych-fg)]">
                {p.name}
              </span>
              <span className="text-xs font-medium text-[var(--psych-accent)]">
                {p.approach}
              </span>
              <span className="text-xs leading-relaxed text-[var(--psych-muted)]">
                {p.personality}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={!selectedId || !!error}
        onClick={onContinue}
        className="w-full rounded-xl bg-[var(--psych-fg)] px-4 py-3.5 text-sm font-medium text-[var(--psych-bg)] transition enabled:hover:opacity-90 disabled:opacity-35 dark:text-[var(--psych-bg)]"
      >
        Continue
      </button>
    </div>
  );
}
