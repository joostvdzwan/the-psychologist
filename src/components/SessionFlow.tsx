"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WaveBand } from "@/components/WaveBand";
import { createSilentWav, fetchTtsBlob, playBlob, processVoiceStream } from "@/lib/audio";
import { useSpeechRecognition } from "@/hooks/use-speech-recognition";
import { useVisionCapture } from "@/hooks/use-vision-capture";
import { IntroPanel } from "@/components/steps/IntroPanel";
import { SelectPanel } from "@/components/steps/SelectPanel";
import { PermissionsPanel } from "@/components/steps/PermissionsPanel";
import { SessionPanel } from "@/components/steps/SessionPanel";
import { EndedPanel } from "@/components/steps/EndedPanel";

type Step = "intro" | "select" | "permissions" | "session" | "ended";

type PsychologistMeta = {
  id: string;
  name: string;
  gender: "male" | "female";
  approach: string;
  personality: string;
};

const STEP_LABEL: Record<Step, string> = {
  intro: "Begin",
  select: "Choose",
  permissions: "Access",
  session: "Session",
  ended: "Complete",
};

function msLeft(endsAt: number) {
  return Math.max(0, endsAt - Date.now());
}

export function SessionFlow() {
  const [step, setStep] = useState<Step>("intro");
  const [psychologists, setPsychologists] = useState<PsychologistMeta[]>([]);
  const [psychError, setPsychError] = useState<string | null>(null);
  const [selectedPsychId, setSelectedPsychId] = useState<string>("");
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [introPlaying, setIntroPlaying] = useState<string>("");
  const [introLoading, setIntroLoading] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<number>(0);
  const [leftMs, setLeftMs] = useState(0);
  const [camOk, setCamOk] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);
  const [log, setLog] = useState<{ role: "you" | "guide"; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [typedMessage, setTypedMessage] = useState("");
  const [guideStreaming, setGuideStreaming] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const guideAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const selectedVoiceIdRef = useRef<string>("");
  const busyRef = useRef(false);
  const greetingFiredRef = useRef(false);
  const sendTurnRef = useRef<(t: string) => Promise<void>>(async () => {});
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pauseVisionRef = useRef<() => void>(() => {});
  const resumeVisionRef = useRef<() => void>(() => {});

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { selectedVoiceIdRef.current = selectedVoiceId; }, [selectedVoiceId]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const sendTurn = useCallback(async (transcript: string) => {
    const sid = sessionIdRef.current;
    const vid = selectedVoiceIdRef.current;
    if (!sid || !vid) return;

    const prevAudio = guideAudioRef.current;
    if (prevAudio && !prevAudio.paused) {
      prevAudio.pause();
      prevAudio.currentTime = 0;
    }

    const isSilenceTurn = transcript === "[silence]";

    pauseVisionRef.current();
    setBusy(true);
    speech.pauseForAudio();
    setGuideStreaming("");
    speech.setStatus(isSilenceTurn ? "" : "Responding…");
    if (!isSilenceTurn) {
      setLog((L) => [...L, { role: "you", text: transcript }]);
    }

    try {
      const res = await fetch("/api/turn-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, transcript, voiceId: vid }),
      });

      const ct = res.headers.get("content-type") ?? "";

      if (ct.includes("application/json")) {
        const data = (await res.json()) as {
          reply?: string;
          crisis?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Turn failed");

        const reply = data.reply ?? "";
        if (!reply) {
          speech.setStatus("No reply — try again or type below.");
          return;
        }

        setLog((L) => [...L, { role: "guide", text: reply }]);
        speech.setStatus(data.crisis ? "Crisis resources shown." : "Speaking…");

        const audioEl = guideAudioRef.current;
        if (audioEl) {
          try {
            const blob = await fetchTtsBlob(reply, vid, 0.55, 0.78);
            await playBlob(audioEl, blob);
          } catch {
            /* Autoplay blocked — text reply already in log */
          }
        }
        speech.clearStatus();
        return;
      }

      if (!res.ok) {
        const err = (await res.text().then(
          (t) => { try { return JSON.parse(t); } catch { return {}; } },
        )) as { error?: string };
        throw new Error(err.error ?? "Turn failed");
      }
      if (!res.body) throw new Error("No response body");

      const audioEl = guideAudioRef.current;
      if (!audioEl) throw new Error("Audio not ready — reload and try again.");

      const { reply, crisis } = await processVoiceStream(
        res.body,
        audioEl,
        (text) => setGuideStreaming(text),
      );
      setGuideStreaming("");

      if (!reply.trim()) {
        speech.setStatus("No reply — try again or type below.");
        return;
      }

      setLog((L) => [...L, { role: "guide", text: reply }]);
      speech.setStatus(crisis ? "Crisis resources shown." : "");
    } catch (e) {
      setGuideStreaming("");
      speech.setStatus(e instanceof Error ? e.message : "Error");
    } finally {
      resumeVisionRef.current();
      speech.resumeAfterAudio();
      setBusy(false);
    }
  }, []);

  useEffect(() => { sendTurnRef.current = sendTurn; }, [sendTurn]);

  const onTranscript = useCallback((text: string) => {
    void sendTurnRef.current(text);
  }, []);

  const speech = useSpeechRecognition({
    active: step === "session" && !!sessionId,
    onTranscript,
    guideAudioRef,
  });

  useEffect(() => { speech.markBusy(busy); }, [busy, speech.markBusy]);

  const SILENCE_TURN_MS = 25_000;

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const startSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      if (!busyRef.current && sessionIdRef.current) {
        void sendTurnRef.current("[silence]");
      }
    }, SILENCE_TURN_MS);
  }, [clearSilenceTimer]);

  useEffect(() => {
    if (step !== "session" || !sessionId) {
      clearSilenceTimer();
      return;
    }
    if (!busy && greetingFiredRef.current) {
      startSilenceTimer();
    } else {
      clearSilenceTimer();
    }
  }, [busy, step, sessionId, startSilenceTimer, clearSilenceTimer]);

  const { visionContext, visionAnalyzing, resetVision, pauseVision, resumeVision } = useVisionCapture({
    active: step === "session" && !!sessionId,
    sessionId,
    videoRef,
  });

  useEffect(() => { pauseVisionRef.current = pauseVision; }, [pauseVision]);
  useEffect(() => { resumeVisionRef.current = resumeVision; }, [resumeVision]);

  // Countdown timer
  useEffect(() => {
    if (step !== "session" || !endsAt) return;
    const t = setInterval(() => setLeftMs(msLeft(endsAt)), 500);
    return () => clearInterval(t);
  }, [step, endsAt]);

  // Session end detection
  useEffect(() => {
    if (step === "session" && leftMs <= 0 && endsAt > 0) {
      setStep("ended");
      stopMedia();
    }
  }, [step, leftMs, endsAt]);

  const stopMedia = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  // Load psychologists on select step
  const loadPsychologists = useCallback(async () => {
    setPsychError(null);
    try {
      const res = await fetch("/api/psychologists");
      const data = (await res.json()) as {
        psychologists?: PsychologistMeta[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load psychologists");
      setPsychologists(data.psychologists ?? []);
    } catch (e) {
      setPsychError(e instanceof Error ? e.message : "Failed to load psychologists");
    }
  }, []);

  useEffect(() => {
    if (step === "select") void loadPsychologists();
  }, [step, loadPsychologists]);

  // Intro audio
  const stopIntroAudio = useCallback(() => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
      audio.removeAttribute("src");
    }
    setIntroPlaying("");
  }, []);

  const playIntro = useCallback(async (psychId: string) => {
    stopIntroAudio();
    setIntroLoading(psychId);
    try {
      const res = await fetch("/api/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psychologistId: psychId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Intro playback failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      let audio = previewAudioRef.current;
      if (!audio) {
        audio = new Audio();
        previewAudioRef.current = audio;
      }
      audio.src = url;
      audio.onended = () => { URL.revokeObjectURL(url); setIntroPlaying(""); };
      audio.onerror = () => { URL.revokeObjectURL(url); setIntroPlaying(""); };
      setIntroPlaying(psychId);
      await audio.play();
    } catch (e) {
      setIntroPlaying("");
      setPsychError(e instanceof Error ? e.message : "Intro playback failed");
    } finally {
      setIntroLoading("");
    }
  }, [stopIntroAudio]);

  useEffect(() => {
    if (step !== "select") stopIntroAudio();
  }, [step, stopIntroAudio]);

  // Camera preview binding
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (step !== "session") {
      if (video) video.srcObject = null;
      return;
    }
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    void video.play().catch(() => {});
  }, [step, sessionId]);

  // Permissions & session start
  const startPermissions = async () => {
    setPermError(null);
    if (!selectedPsychId) {
      setPermError("Choose a psychologist first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermError("Camera/microphone access requires HTTPS. Run `pnpm dev:https` and open https://your-ip:3000 on your phone.");
      return;
    }

    const audioEl = guideAudioRef.current;
    if (audioEl) {
      // Unlock audio by playing a tiny silent WAV *unmuted* during user gesture.
      // Muted playback doesn't count as a user-initiated play on mobile Safari.
      const silentWav = createSilentWav();
      audioEl.src = silentWav;
      audioEl.play()
        .then(() => { audioEl.pause(); })
        .catch(() => {})
        .finally(() => URL.revokeObjectURL(silentWav));

      const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = W.AudioContext ?? W.webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        void ctx.resume().catch(() => {});
        (window as unknown as { __psychAudioCtx?: AudioContext }).__psychAudioCtx = ctx;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      setCamOk(true);
      setMicOk(true);
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psychologistId: selectedPsychId }),
      });
      const data = (await res.json()) as {
        sessionId?: string;
        endsAt?: number;
        voiceId?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Session failed");
      setSessionId(data.sessionId ?? null);
      setSelectedVoiceId(data.voiceId ?? "");
      setEndsAt(data.endsAt ?? 0);
      setLeftMs(msLeft(data.endsAt ?? 0));
      setStep("session");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Permission error";
      setPermError(msg);
      setCamOk(false);
      setMicOk(false);
      stopMedia();
    }
  };

  // Greeting
  const fireGreeting = useCallback(async () => {
    const sid = sessionIdRef.current;
    const vid = selectedVoiceIdRef.current;
    if (!sid || !vid) return;

    pauseVisionRef.current();
    setBusy(true);
    speech.pauseForAudio();
    speech.setStatus("Starting session…");

    try {
      const res = await fetch("/api/greet-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, voiceId: vid }),
      });

      const ct = res.headers.get("content-type") ?? "";

      if (ct.includes("application/json")) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Greeting failed");
      }

      if (!res.ok) throw new Error("Greeting failed");
      if (!res.body) throw new Error("No response body");

      const audioEl = guideAudioRef.current;
      if (!audioEl) throw new Error("Audio not ready");

      const { reply } = await processVoiceStream(
        res.body,
        audioEl,
        (text) => setGuideStreaming(text),
      );

      setGuideStreaming("");

      if (reply.trim()) {
        setLog((L) => [...L, { role: "guide", text: reply }]);
      }
      speech.clearStatus();
    } catch (e) {
      setGuideStreaming("");
      speech.setStatus(e instanceof Error ? e.message : "Greeting failed");
    } finally {
      resumeVisionRef.current();
      speech.resumeAfterAudio();
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (step !== "session" || !sessionId || greetingFiredRef.current) return;
    greetingFiredRef.current = true;
    void fireGreeting();
  }, [step, sessionId, fireGreeting]);

  // Derived values
  const selectedPsychName =
    psychologists.find((p) => p.id === selectedPsychId)?.name ?? "Guide";

  const panelClass =
    "rounded-2xl border border-[var(--psych-panel-border)] bg-[var(--psych-surface)] p-6 shadow-sm backdrop-blur-md";
  const sessionShellClass =
    "rounded-2xl border border-[var(--psych-panel-border)] bg-[var(--psych-surface)] p-5 shadow-[0_28px_90px_-24px_rgba(0,0,0,0.45)] backdrop-blur-xl";

  const sendTyped = () => {
    const t = typedMessage.trim();
    if (!t || busy) return;
    setTypedMessage("");
    void sendTurn(t);
  };

  const handleRestart = () => {
    clearSilenceTimer();
    setStep("intro");
    setSessionId(null);
    setSelectedPsychId("");
    setSelectedVoiceId("");
    setLog([]);
    setGuideStreaming("");
    resetVision();
    greetingFiredRef.current = false;
  };

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-8">
      <audio ref={guideAudioRef} className="hidden" playsInline preload="auto"></audio>

      <header className={`space-y-4${step === "session" || step === "ended" ? " hidden" : ""}`}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="psych-label-caps">Consultation prototype</p>
          {step !== "intro" && (
            <span
              className="psych-label-caps text-[var(--psych-signal)]"
              aria-live="polite"
            >
              {STEP_LABEL[step]}
            </span>
          )}
        </div>
        <div className="space-y-1">
          <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight text-[var(--psych-fg)] sm:text-3xl">
            The Psychologist
          </h1>
          <WaveBand />
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-[var(--psych-muted)]">
          Voice-first session with multimodal context and synthesized speech.
          Not medical care.
        </p>
      </header>

      {step === "intro" && (
        <IntroPanel onBegin={() => setStep("select")} panelClass={panelClass} />
      )}

      {step === "select" && (
        <SelectPanel
          psychologists={psychologists}
          selectedId={selectedPsychId}
          onSelect={(id) => {
            setSelectedPsychId(id);
            void playIntro(id);
          }}
          onContinue={() => { stopIntroAudio(); setStep("permissions"); }}
          introPlaying={introPlaying}
          introLoading={introLoading}
          error={psychError}
          panelClass={panelClass}
        />
      )}

      {step === "permissions" && (
        <PermissionsPanel
          onAllow={() => void startPermissions()}
          onBack={() => setStep("select")}
          error={permError}
          panelClass={panelClass}
        />
      )}

      {step === "session" && (
        <SessionPanel
          sessionId={sessionId}
          leftMs={leftMs}
          camOk={camOk}
          micOk={micOk}
          log={log}
          listening={speech.listening}
          transcriptPreview={speech.transcriptPreview}
          statusLine={speech.statusLine}
          guideStreaming={guideStreaming}
          guideName={selectedPsychName}
          busy={busy}
          typedMessage={typedMessage}
          onTypedMessageChange={setTypedMessage}
          onSendTyped={sendTyped}
          speechChecked={speech.speechChecked}
          speechSupported={speech.speechSupported}
          httpSpeechTip={speech.httpSpeechTip}
          videoRef={videoRef}
          guideAudioRef={guideAudioRef}
          shellClass={sessionShellClass}
        />
      )}

      {step === "ended" && (
        <EndedPanel onRestart={handleRestart} panelClass={panelClass} />
      )}
    </div>
  );
}
