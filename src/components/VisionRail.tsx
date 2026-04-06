"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type VisionContext = {
  face: string;
  gaze: string;
  posture: string;
  movement: string;
  environment: string;
  overall_affect: string;
};

type VisionRailProps = {
  vision: VisionContext | null;
  analyzing: boolean;
};

type FieldDef = {
  key: keyof Omit<VisionContext, "overall_affect">;
  label: string;
};

const FIELDS: FieldDef[] = [
  { key: "face", label: "Face" },
  { key: "gaze", label: "Gaze" },
  { key: "posture", label: "Posture" },
  { key: "movement", label: "Movement" },
  { key: "environment", label: "Scene" },
];

const STAGGER_MS = 100;
const CHAR_MS = 18;
const FRESH_DURATION_MS = 5_000;

/* ── useReducedMotion ─────────────────────────────────────────── */

function useReducedMotion() {
  const [v] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  return v;
}

/* ── useTypewriter ────────────────────────────────────────────── */

function useTypewriter(
  text: string,
  active: boolean,
  reducedMotion: boolean,
): { display: string; done: boolean } {
  const [displayText, setDisplayText] = useState("");
  const [done, setDone] = useState(false);
  const rafRef = useRef(0);
  const prevRef = useRef({ text: "", active: false });

  useEffect(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    const prev = prevRef.current;
    const textChanged = text !== prev.text;
    const justActivated = active && !prev.active;
    prevRef.current = { text, active };

    if (!active) {
      setDisplayText("");
      setDone(false);
      return;
    }

    if (reducedMotion) {
      setDisplayText(text);
      setDone(true);
      return;
    }

    if (textChanged || justActivated) {
      const start = performance.now();
      setDisplayText("");
      setDone(false);

      const tick = (now: number) => {
        const pos = Math.min(
          Math.floor((now - start) / CHAR_MS),
          text.length,
        );
        setDisplayText(text.slice(0, pos));
        if (pos >= text.length) {
          setDone(true);
        } else {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      setDisplayText(text);
      setDone(true);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [text, active, reducedMotion]);

  return { display: displayText, done };
}

/* ── TypewriterCursor ─────────────────────────────────────────── */

function TypewriterCursor({ className = "" }: { className?: string }) {
  return (
    <span
      className={`psych-cursor-blink ml-px inline-block h-[0.85em] w-[1.5px] translate-y-[1px] bg-[var(--psych-accent)] ${className}`}
      aria-hidden
    />
  );
}

/* ── VisionRail ───────────────────────────────────────────────── */

export function VisionRail({ vision, analyzing }: VisionRailProps) {
  const rm = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const prevVisionRef = useRef<VisionContext | null>(null);
  const staggerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const freshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [affectRevealed, setAffectRevealed] = useState(false);
  const [collapsedMobile, setCollapsedMobile] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState(false);

  /* Stable-count typewriter hooks (one per field + affect) */
  const twFace = useTypewriter(vision?.face ?? "", revealedKeys.has("face"), rm);
  const twGaze = useTypewriter(vision?.gaze ?? "", revealedKeys.has("gaze"), rm);
  const twPosture = useTypewriter(vision?.posture ?? "", revealedKeys.has("posture"), rm);
  const twMovement = useTypewriter(vision?.movement ?? "", revealedKeys.has("movement"), rm);
  const twScene = useTypewriter(vision?.environment ?? "", revealedKeys.has("environment"), rm);
  const twAffect = useTypewriter(vision?.overall_affect ?? "", affectRevealed, rm);

  const tw: Record<string, { display: string; done: boolean }> = {
    face: twFace,
    gaze: twGaze,
    posture: twPosture,
    movement: twMovement,
    environment: twScene,
  };

  /* Orchestrate staggered reveal + scan-line on vision change */
  useEffect(() => {
    if (!vision || vision === prevVisionRef.current) return;
    prevVisionRef.current = vision;

    staggerTimersRef.current.forEach(clearTimeout);
    staggerTimersRef.current = [];

    setRevealedKeys(new Set());
    setAffectRevealed(false);
    setFresh(true);

    const el = containerRef.current;
    if (el) {
      el.classList.remove("psych-scanline-sweep");
      void el.offsetWidth;
      el.classList.add("psych-scanline-sweep");
    }

    FIELDS.forEach((f, i) => {
      const t = setTimeout(
        () => setRevealedKeys((prev) => new Set(prev).add(f.key)),
        rm ? 0 : i * STAGGER_MS,
      );
      staggerTimersRef.current.push(t);
    });

    const affectTimer = setTimeout(
      () => setAffectRevealed(true),
      rm ? 0 : FIELDS.length * STAGGER_MS,
    );
    staggerTimersRef.current.push(affectTimer);

    if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
    freshTimerRef.current = setTimeout(() => setFresh(false), FRESH_DURATION_MS);

    return () => {
      staggerTimersRef.current.forEach(clearTimeout);
    };
  }, [vision, rm]);

  const toggleMobile = useCallback(
    (key: string) =>
      setCollapsedMobile((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className="psych-telemetry relative overflow-hidden rounded-xl border border-[var(--psych-panel-border)] bg-[var(--psych-surface)] backdrop-blur-md"
    >
      {/* Scan-line overlay */}
      <div
        className="psych-scanline pointer-events-none absolute inset-0 z-20"
        aria-hidden
      />

      {/* Top shimmer */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px]"
        aria-hidden
      >
        <div className="psych-vitals-line h-full w-full" />
      </div>

      {/* ── Analyzing skeleton ─────────────────────────────────── */}
      {!vision && analyzing && (
        <div className="flex items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4">
          <p className="psych-label-caps flex shrink-0 items-center gap-1.5">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-[var(--psych-muted)] opacity-50" />
            Analyzing
          </p>
          <div className="flex flex-1 gap-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex-1 space-y-0.5">
                <div className="h-1.5 w-8 rounded bg-[var(--psych-panel-border)]" />
                <div
                  className="psych-vitals-line h-2 rounded"
                  style={{ width: `${50 + i * 8}%` }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Vision telemetry ───────────────────────────────────── */}
      {vision && (
        <div className="px-3 py-3 sm:px-4 sm:py-4">
          {/* Header badge */}
          <div className="mb-3 flex items-center gap-2">
            <p className="psych-label-caps flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full bg-[var(--psych-accent)] shadow-[0_0_6px_color-mix(in_srgb,var(--psych-accent)_50%,transparent)]" />
              Observing
            </p>
            {analyzing && (
              <span className="animate-pulse text-[9px] tracking-wide text-[var(--psych-muted)]">
                updating…
              </span>
            )}
          </div>

          {/* ── Desktop: 3-column tile grid ──────────────────── */}
          <div className="hidden gap-2.5 sm:grid sm:grid-cols-3">
            {FIELDS.map((f) => {
              const revealed = revealedKeys.has(f.key);
              const t = tw[f.key];
              return (
                <div
                  key={f.key}
                  className="group/tile relative cursor-default overflow-hidden rounded-lg border border-[var(--psych-panel-border)] bg-[color-mix(in_srgb,var(--psych-surface)_80%,transparent)] p-3 transition-[border-color,background-color,box-shadow] duration-200 hover:border-[color-mix(in_srgb,var(--psych-accent)_25%,transparent)] hover:bg-[color-mix(in_srgb,var(--psych-accent)_5%,transparent)] hover:shadow-[0_4px_20px_-6px_color-mix(in_srgb,var(--psych-accent)_18%,transparent)]"
                  style={{
                    opacity: revealed ? 1 : 0,
                    transform: revealed
                      ? "translateY(0) scale(1)"
                      : "translateY(8px) scale(0.97)",
                    transition: rm
                      ? "none"
                      : "opacity 300ms ease-out, transform 300ms ease-out",
                  }}
                >
                  {fresh && (
                    <span
                      className="psych-freshness-dot absolute right-2.5 top-2.5"
                      aria-hidden
                    />
                  )}

                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--psych-muted)]">
                    {f.label}
                  </p>

                  <div className="max-h-[18px] overflow-hidden transition-[max-height] duration-300 ease-out group-hover/tile:max-h-[150px]">
                    <p className="text-[11px] leading-relaxed text-[var(--psych-fg)]">
                      {t.display}
                      {!t.done && <TypewriterCursor />}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Mobile: vertical accordion ───────────────────── */}
          <div className="divide-y divide-[var(--psych-panel-border)] overflow-hidden rounded-lg border border-[var(--psych-panel-border)] sm:hidden">
            {FIELDS.map((f) => {
              const revealed = revealedKeys.has(f.key);
              const t = tw[f.key];
              const isOpen = !collapsedMobile.has(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleMobile(f.key)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--psych-accent)_4%,transparent)]"
                  style={{
                    opacity: revealed ? 1 : 0,
                    transform: revealed ? "translateX(0)" : "translateX(-8px)",
                    transition: rm
                      ? "none"
                      : "opacity 250ms ease-out, transform 250ms ease-out",
                  }}
                >
                  <span className="flex w-16 shrink-0 items-center gap-1.5 pt-px">
                    {fresh && (
                      <span className="psych-freshness-dot-sm" aria-hidden />
                    )}
                    <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--psych-muted)]">
                      {f.label}
                    </span>
                  </span>

                  <span
                    className="min-w-0 flex-1 overflow-hidden text-[10px] leading-relaxed text-[var(--psych-fg)] transition-[max-height] duration-300 ease-out"
                    style={{ maxHeight: isOpen ? "150px" : "16px" }}
                  >
                    {t.display}
                    {!t.done && <TypewriterCursor />}
                  </span>

                  <span
                    className="mt-0.5 text-[11px] leading-none text-[var(--psych-muted)] transition-transform duration-200"
                    style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
                    aria-hidden
                  >
                    ›
                  </span>
                </button>
              );
            })}
          </div>

          {/* ── Affect synthesis bar ─────────────────────────── */}
          <div
            className="mt-3 border-t border-[var(--psych-panel-border)] pt-3"
            style={{
              opacity: affectRevealed ? 1 : 0,
              transform: affectRevealed ? "translateY(0)" : "translateY(6px)",
              transition: rm
                ? "none"
                : "opacity 400ms ease-out, transform 400ms ease-out",
            }}
          >
            <div className="flex items-start gap-2.5">
              <div className="psych-affect-glow mt-0.5 w-[2px] shrink-0 self-stretch rounded-full" />
              <div className="min-w-0">
                <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--psych-muted)]">
                  Affect
                </p>
                <p className="text-[11px] italic leading-relaxed text-[var(--psych-accent)]">
                  {twAffect.display}
                  {!twAffect.done && <TypewriterCursor />}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom shimmer */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[2px]"
        aria-hidden
      >
        <div className="psych-vitals-line h-full w-full" />
      </div>
    </div>
  );
}
