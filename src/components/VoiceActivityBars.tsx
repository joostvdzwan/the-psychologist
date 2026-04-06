type VoiceActivityBarsProps = {
  active: boolean;
};

export function VoiceActivityBars({ active }: VoiceActivityBarsProps) {
  if (!active) return null;
  return (
    <div
      className="flex h-9 items-end justify-center gap-[5px]"
      aria-hidden
      role="presentation"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="psych-voice-bar" />
      ))}
    </div>
  );
}
