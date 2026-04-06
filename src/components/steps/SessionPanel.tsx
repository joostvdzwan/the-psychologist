import { type RefObject } from "react";
import { GuidePresence } from "@/components/GuidePresence";
import { VoiceActivityBars } from "@/components/VoiceActivityBars";

type LogEntry = { role: "you" | "guide"; text: string };

export type SessionPanelProps = {
  sessionId: string | null;
  leftMs: number;
  camOk: boolean;
  micOk: boolean;
  log: LogEntry[];
  listening: boolean;
  transcriptPreview: string;
  statusLine: string;
  guideStreaming: string;
  guideName: string;
  busy: boolean;
  typedMessage: string;
  onTypedMessageChange: (value: string) => void;
  onSendTyped: () => void;
  speechChecked: boolean;
  speechSupported: boolean;
  httpSpeechTip: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  guideAudioRef: RefObject<HTMLAudioElement | null>;
  shellClass: string;
};

function formatMs(ms: number) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function SessionPanel({
  sessionId,
  leftMs,
  camOk,
  micOk,
  log,
  listening,
  transcriptPreview,
  statusLine,
  guideStreaming,
  guideName,
  busy,
  typedMessage,
  onTypedMessageChange,
  onSendTyped,
  speechChecked,
  speechSupported,
  httpSpeechTip,
  videoRef,
  guideAudioRef,
  shellClass,
}: SessionPanelProps) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-5 ${shellClass}`}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-mono tabular-nums text-[var(--psych-muted)]">
          {formatMs(leftMs)} remaining
        </span>
        <span className="flex items-center gap-2 text-[var(--psych-muted)]">
          <span
            className={`size-2 rounded-full ${camOk && micOk ? "bg-[var(--psych-accent)] shadow-[0_0_10px_color-mix(in_srgb,var(--psych-accent)_60%,transparent)]" : "bg-[var(--psych-muted)] opacity-40"}`}
            aria-hidden
          />
          {camOk && micOk ? "Live context" : "Connecting…"}
        </span>
      </div>

      {speechChecked && !speechSupported && (
        <p className="rounded-lg border border-[var(--psych-warm-border)] bg-[var(--psych-warm-bg)] px-3 py-2 text-xs leading-relaxed text-[var(--psych-warm-fg)]">
          This browser does not support speech recognition well. Use the text
          field below to message the guide.
        </p>
      )}

      {httpSpeechTip && speechSupported && (
        <p className="rounded-lg border border-[var(--psych-panel-border)] bg-[color-mix(in_srgb,var(--psych-surface)_90%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--psych-muted)]">
          Voice may fail on{" "}
          <span className="font-mono text-[var(--psych-fg)]">http://</span> in
          Chrome. Run{" "}
          <span className="font-mono text-[var(--psych-fg)]">pnpm dev:https</span>{" "}
          and open{" "}
          <span className="font-mono text-[var(--psych-fg)]">
            https://localhost:3000
          </span>
          , or type below.
        </p>
      )}

      <div className="relative">
        <GuidePresence
          key={sessionId ?? "idle"}
          audioRef={guideAudioRef}
          active
        />
        <div className="absolute bottom-3 right-3 z-10 w-[35%] overflow-hidden rounded-lg border border-white/20 bg-black/60 shadow-lg sm:w-[25%]">
          <video
            ref={videoRef}
            className="aspect-video w-full object-cover"
            playsInline
            muted
            autoPlay
          />
        </div>
      </div>

      <div className="min-h-[120px] space-y-2.5 overflow-y-auto rounded-xl border border-[var(--psych-panel-border)] bg-[color-mix(in_srgb,var(--psych-surface)_88%,transparent)] p-3.5 text-sm leading-relaxed">
        {log.length === 0 && !guideStreaming && (
          <p className="animate-pulse text-[var(--psych-muted)]">
            Starting session…
          </p>
        )}
        {log.map((line, i) => (
          <p
            key={i}
            className={
              line.role === "you"
                ? "text-[var(--psych-muted)]"
                : "text-[var(--psych-accent)] dark:text-[color-mix(in_srgb,var(--psych-accent)_92%,white)]"
            }
          >
            <span className="font-medium text-[var(--psych-fg)]">
              {line.role === "you" ? "You" : guideName}
            </span>
            <span className="text-[var(--psych-muted)]"> · </span>
            {line.text}
          </p>
        ))}
        {guideStreaming && (
          <p className="text-[var(--psych-accent)] dark:text-[color-mix(in_srgb,var(--psych-accent)_92%,white)]">
            <span className="font-medium text-[var(--psych-fg)]">{guideName}</span>
            <span className="text-[var(--psych-muted)]"> · </span>
            <span className="text-[var(--psych-muted)]">{guideStreaming}</span>
          </p>
        )}
      </div>

      <VoiceActivityBars active={listening} />

      {transcriptPreview && (
        <p className="text-center text-xs text-[var(--psych-muted)]">
          Heard: {transcriptPreview}
        </p>
      )}
      {statusLine && (
        <p className="text-center text-xs text-[var(--psych-signal)]">
          {statusLine}
        </p>
      )}

      <div className="space-y-2">
        <textarea
          value={typedMessage}
          onChange={(e) => onTypedMessageChange(e.target.value)}
          placeholder="Or type a message…"
          rows={2}
          disabled={busy}
          className="w-full resize-none rounded-xl border border-[var(--psych-panel-border)] bg-[color-mix(in_srgb,var(--psych-surface)_90%,transparent)] px-3 py-2 text-sm text-[var(--psych-fg)] placeholder:text-[var(--psych-muted)] focus:border-[color-mix(in_srgb,var(--psych-accent)_40%,transparent)] focus:outline-none focus:ring-1 focus:ring-[var(--psych-accent)] disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy || !typedMessage.trim()}
          onClick={onSendTyped}
          className="w-full rounded-xl bg-[var(--psych-fg)] py-2.5 text-sm font-medium text-[var(--psych-bg)] transition enabled:hover:opacity-90 disabled:opacity-35"
        >
          Send message
        </button>
      </div>
    </div>
  );
}
