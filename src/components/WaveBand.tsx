type WaveBandProps = {
  className?: string;
};

/** Decorative slow-moving waveform — suggests audio + physiology */
export function WaveBand({ className = "" }: WaveBandProps) {
  return (
    <div
      className={`relative h-10 w-full overflow-hidden opacity-90 ${className}`}
      aria-hidden
    >
      <svg
        className="psych-wave-track absolute left-0 top-1/2 h-8 w-[200%] -translate-y-1/2 text-[var(--psych-signal)]"
        viewBox="0 0 1200 32"
        preserveAspectRatio="none"
      >
        <path
          d="M0,16 Q75,6 150,16 T300,16 T450,8 T600,16 T750,20 T900,14 T1050,16 T1200,16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity="0.45"
        />
        <path
          d="M0,22 Q100,28 200,22 T400,24 T600,18 T800,24 T1000,20 T1200,22"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.75"
          strokeLinecap="round"
          opacity="0.28"
        />
      </svg>
    </div>
  );
}
