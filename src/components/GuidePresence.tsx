"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const PORTRAIT_PATH = "/guide-portrait.jpg";

type GuidePresenceProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  /** Re-bind listeners when session becomes active */
  active: boolean;
  /** Display name for the guide (defaults to "Guide") */
  name?: string;
};

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Guide tile: portrait (file or placeholder) + Web Audio analyser bars while TTS plays.
 * The <audio> element must be rendered by the parent with the same ref.
 */
export function GuidePresence({ audioRef, active, name = "Guide" }: GuidePresenceProps) {
  const [portraitFailed, setPortraitFailed] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array(8).fill(0.15));
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const graphInitRef = useRef(false);
  const rafRef = useRef(0);
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const stopVisualizer = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setLevels(Array(8).fill(0.15));
  }, []);

  const initGraphOnFirstPlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || graphInitRef.current) return;

    const Ctor = getAudioContextCtor();
    if (!Ctor) return;

    let ctx = ctxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new Ctor();
      ctxRef.current = ctx;
    }
    await ctx.resume().catch(() => {});

    try {
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      graphInitRef.current = true;
    } catch {
      /* Element may already have a MediaElementSource */
    }
  }, [audioRef]);

  useEffect(() => {
    if (!active) return;

    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => {
      void (async () => {
        await initGraphOnFirstPlay();
        if (reducedMotion) return;
        stopVisualizer();
        if (!analyserRef.current) return;

        const runFrame = () => {
          if (audio.paused) {
            stopVisualizer();
            return;
          }
          const analyser = analyserRef.current;
          if (!analyser) return;
          const buf = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(buf);
          const n = 8;
          const chunk = Math.max(1, Math.floor(buf.length / n));
          const next: number[] = [];
          for (let i = 0; i < n; i++) {
            let sum = 0;
            for (let j = 0; j < chunk; j++) sum += buf[i * chunk + j] ?? 0;
            const avg = sum / chunk / 255;
            next.push(0.12 + avg * 0.88);
          }
          setLevels(next);
          rafRef.current = requestAnimationFrame(runFrame);
        };

        rafRef.current = requestAnimationFrame(runFrame);
      })();
    };

    const onStop = () => {
      stopVisualizer();
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("ended", onStop);
    audio.addEventListener("pause", onStop);
    audio.addEventListener("error", onStop);

    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("ended", onStop);
      audio.removeEventListener("pause", onStop);
      audio.removeEventListener("error", onStop);
      stopVisualizer();
    };
  }, [active, audioRef, initGraphOnFirstPlay, reducedMotion, stopVisualizer]);

  return (
    <>
      {/* Mobile: compact card */}
      <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-[var(--psych-panel-border)] bg-black/40 px-4 py-3 shadow-inner sm:hidden">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/90">
          {name}
        </span>
        <div className="flex items-end gap-0.5" aria-hidden>
          {levels.map((h, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-[var(--psych-signal)]"
              style={{
                height: `${Math.round(4 + h * 16)}px`,
                opacity: 0.35 + h * 0.65,
                transition: reducedMotion ? undefined : "height 45ms linear",
              }}
            />
          ))}
        </div>
      </div>

      {/* Desktop: full tile */}
      <div className="relative hidden aspect-video w-full flex-col overflow-hidden rounded-xl border border-[var(--psych-panel-border)] bg-black/40 shadow-inner sm:flex">
        <span className="absolute left-3 top-3 z-10 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/90 backdrop-blur-sm">
          {name}
        </span>

        <div className="relative min-h-0 flex-1 bg-gradient-to-br from-[color-mix(in_srgb,var(--psych-accent)_12%,var(--psych-bg))] to-[var(--psych-bg-mid)]">
          {!portraitFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- intentional: graceful 404 → placeholder
            <img
              src={PORTRAIT_PATH}
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-top"
              onError={() => setPortraitFailed(true)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[color-mix(in_srgb,var(--psych-accent)_18%,transparent)] to-[var(--psych-bg-mid)]">
              <span className="select-none text-3xl font-light tracking-wide text-[var(--psych-muted)]">
                {name}
              </span>
            </div>
          )}

          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[28%] items-end justify-center gap-1 pb-3 opacity-95"
            aria-hidden
          >
            {levels.map((h, i) => (
              <span
                key={i}
                className="w-1.5 rounded-full bg-[var(--psych-signal)]"
                style={{
                  height: `${Math.round(h * 100)}%`,
                  maxHeight: "100%",
                  minHeight: "12%",
                  opacity: 0.35 + h * 0.65,
                  transition: reducedMotion ? undefined : "height 45ms linear",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
