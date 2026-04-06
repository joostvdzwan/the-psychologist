"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GuidePresence } from "@/components/GuidePresence";
import { VisionRail } from "@/components/VisionRail";
import { VoiceActivityBars } from "@/components/VoiceActivityBars";
import { WaveBand } from "@/components/WaveBand";

type SpeechResult = {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string };
};

type SpeechResultEvent = {
  readonly results: { readonly length: number; readonly [index: number]: SpeechResult };
  readonly resultIndex: number;
};

type WebSpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((ev: SpeechResultEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onend: (() => void) | null;
};

const SILENCE_MS = 1200;

const SENTENCE_END_RE = /[.!?]\s/;
const MIN_FIRST_SENTENCE_LEN = 30;

async function fetchTtsBlob(
  text: string,
  voiceId: string,
  stability: number,
  similarity_boost: number,
): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId, stability, similarity_boost }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as {
      error?: string;
      detail?: string;
    };
    const msg = err.detail
      ? `${err.error ?? "TTS failed"}: ${err.detail}`
      : (err.error ?? "Audio failed");
    throw new Error(msg);
  }
  return res.blob();
}

function playBlob(audioEl: HTMLAudioElement, blob: Blob): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const prev = audioEl.src;
    if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(blob);
    audioEl.src = url;

    const cleanup = () => {
      audioEl.removeEventListener("ended", onDone);
      audioEl.removeEventListener("pause", onDone);
      audioEl.removeEventListener("error", onErr);
      if (audioEl.src === url) URL.revokeObjectURL(url);
    };
    const onDone = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error("Audio playback error")); };
    audioEl.addEventListener("ended", onDone);
    audioEl.addEventListener("pause", onDone);
    audioEl.addEventListener("error", onErr);
    audioEl.play().catch((err) => { cleanup(); reject(err); });
  });
}

type Step = "intro" | "select" | "permissions" | "session" | "ended";

type PsychologistMeta = {
  id: string;
  name: string;
  gender: "male" | "female";
  approach: string;
  personality: string;
};

type VisionContext = {
  face: string;
  gaze: string;
  posture: string;
  movement: string;
  environment: string;
  overall_affect: string;
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

function formatMs(ms: number) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
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

  const [listening, setListening] = useState(false);
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [log, setLog] = useState<{ role: "you" | "guide"; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [typedMessage, setTypedMessage] = useState("");
  const [speechChecked, setSpeechChecked] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  /** Partial guide reply while the model is streaming (feels instant vs waiting for full JSON). */
  const [guideStreaming, setGuideStreaming] = useState("");
  /** Chrome often blocks Web Speech over http://localhost; show dev workaround. */
  const [httpSpeechTip, setHttpSpeechTip] = useState(false);
  /** Latest Gemma 4 vision analysis, displayed as overlay on the video tile. */
  const [visionContext, setVisionContext] = useState<VisionContext | null>(null);
  const [visionAnalyzing, setVisionAnalyzing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const guideAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<WebSpeechRec | null>(null);
  const summaryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const selectedVoiceIdRef = useRef<string>("");
  const summarySeqRef = useRef(0);
  const summaryInFlightRef = useRef(false);
  const busyRef = useRef(false);
  const speechHadErrorRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumulatedRef = useRef("");
  const processedCountRef = useRef(0);
  const pendingTranscriptRef = useRef("");
  const recognitionActiveRef = useRef(false);
  const pausedForAudioRef = useRef(false);
  const greetingFiredRef = useRef(false);
  const sendTurnRef = useRef<(t: string) => Promise<void>>(async () => {});
  const startContinuousListeningRef = useRef<() => void>(() => {});

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    selectedVoiceIdRef.current = selectedVoiceId;
  }, [selectedVoiceId]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (step !== "session") {
      setHttpSpeechTip(false);
      return;
    }
    setHttpSpeechTip(
      typeof window !== "undefined" && window.location.protocol === "http:",
    );
  }, [step]);

  useEffect(() => {
    if (step !== "session" || !endsAt) return;
    const t = setInterval(() => setLeftMs(msLeft(endsAt)), 500);
    return () => clearInterval(t);
  }, [step, endsAt]);

  useEffect(() => {
    if (step === "session" && leftMs <= 0 && endsAt > 0) {
      setStep("ended");
      stopMedia();
      recognitionActiveRef.current = false;
      const r = recognitionRef.current;
      if (r) {
        try { r.stop(); } catch { /* */ }
        recognitionRef.current = null;
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      if (summaryTimerRef.current) clearInterval(summaryTimerRef.current);
    }
  }, [step, leftMs, endsAt]);

  const stopMedia = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

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
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setIntroPlaying("");
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setIntroPlaying("");
      };
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

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    setSpeechSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    setSpeechChecked(true);
  }, []);

  /** Camera preview: video element only exists in session step, so bind stream after mount */
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (step !== "session") {
      if (video) video.srcObject = null;
      return;
    }
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    void video.play().catch(() => {
      /* autoplay policies; user interaction already happened for permissions */
    });
  }, [step, sessionId]);

  const startPermissions = async () => {
    setPermError(null);
    if (!selectedPsychId) {
      setPermError("Choose a psychologist first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermError(
        "Camera/microphone access requires HTTPS. Run `pnpm dev:https` and open https://your-ip:3000 on your phone.",
      );
      return;
    }

    const audioEl = guideAudioRef.current;
    if (audioEl) {
      audioEl.muted = true;
      audioEl.play().then(() => { audioEl.pause(); audioEl.muted = false; }).catch(() => { audioEl.muted = false; });
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

  const captureFrameDataUrl = (): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const maxW = 512;
    const scale = w > maxW ? maxW / w : 1;
    const cw = Math.round(w * scale);
    const ch = Math.round(h * scale);
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, cw, ch);
    return c.toDataURL("image/jpeg", 0.65);
  };

  const pushSummary = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || step !== "session") return;
    if (summaryInFlightRef.current) return;
    const dataUrl = captureFrameDataUrl();
    if (!dataUrl) return;
    summaryInFlightRef.current = true;
    setVisionAnalyzing(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sid,
          imageBase64: dataUrl,
          mimeType: "image/jpeg",
          seq: summarySeqRef.current,
        }),
      });
      if (res.status === 429) return;
      const j = (await res.json()) as {
        vision?: VisionContext;
        seq?: number;
        error?: string;
      };
      if (res.ok) {
        if (j.vision) setVisionContext(j.vision);
        if (typeof j.seq === "number") summarySeqRef.current = j.seq;
      }
    } catch {
      /* best-effort */
    } finally {
      summaryInFlightRef.current = false;
      setVisionAnalyzing(false);
    }
  }, [step]);

  useEffect(() => {
    if (step !== "session" || !sessionId) return;
    const id = setInterval(() => void pushSummary(), 2500);
    summaryTimerRef.current = id;
    void pushSummary();
    return () => clearInterval(id);
  }, [step, sessionId, pushSummary]);

  const flushAccumulated = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    const text = accumulatedRef.current.trim();
    accumulatedRef.current = "";
    setTranscriptPreview("");
    if (!text) return;
    const audioEl = guideAudioRef.current;
    if (audioEl && !audioEl.paused) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    if (busyRef.current) {
      pendingTranscriptRef.current = pendingTranscriptRef.current
        ? pendingTranscriptRef.current + " " + text
        : text;
      return;
    }
    void sendTurnRef.current(text);
  };

  const setupRecognition = () => {
    type SpeechRecCtor = new () => WebSpeechRec;
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecCtor;
      webkitSpeechRecognition?: SpeechRecCtor;
    };
    const Ctor =
      typeof window !== "undefined" &&
      (w.SpeechRecognition ?? w.webkitSpeechRecognition);
    if (!Ctor) {
      setStatusLine("Speech recognition is not supported in this browser.");
      return null;
    }
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (ev: SpeechResultEvent) => {
      let hasNewFinal = false;
      let interim = "";

      for (let i = 0; i < ev.results.length; i++) {
        const result = ev.results[i];
        if (result.isFinal) {
          if (i >= processedCountRef.current) {
            accumulatedRef.current += result[0].transcript + " ";
            processedCountRef.current = i + 1;
            hasNewFinal = true;
          }
        } else {
          interim = result[0].transcript;
        }
      }

      setTranscriptPreview((accumulatedRef.current + interim).trim());

      if (hasNewFinal) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          flushAccumulated();
        }, SILENCE_MS);
      }
    };

    r.onerror = (ev: Event) => {
      const code = (ev as unknown as { error?: string }).error;
      if (code === "aborted") return;

      const nonRecoverable = new Set(["not-allowed", "service-not-allowed"]);
      if (code && nonRecoverable.has(code)) {
        recognitionActiveRef.current = false;
        setListening(false);
        const hints: Record<string, string> = {
          "not-allowed":
            "Speech recognition blocked — check browser permissions or type below.",
          "service-not-allowed":
            "Chrome blocked the cloud speech service. Try: pnpm dev:https and open https://localhost:3000, or type below.",
        };
        setStatusLine(hints[code] ?? `Speech error: ${code}`);
        recognitionRef.current = null;
        return;
      }
      speechHadErrorRef.current = true;
    };

    r.onend = () => {
      setListening(false);
      processedCountRef.current = 0;
      recognitionRef.current = null;
      if (!pausedForAudioRef.current) {
        flushAccumulated();
      }

      if (recognitionActiveRef.current && sessionIdRef.current && !pausedForAudioRef.current) {
        setTimeout(() => {
          if (recognitionActiveRef.current && sessionIdRef.current && !pausedForAudioRef.current) {
            startContinuousListeningRef.current();
          }
        }, 300);
      }
    };

    recognitionRef.current = r;
    return r;
  };

  const startContinuousListening = () => {
    const r = recognitionRef.current ?? setupRecognition();
    if (!r) return;
    speechHadErrorRef.current = false;
    accumulatedRef.current = "";
    processedCountRef.current = 0;
    setTranscriptPreview("");
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      setStatusLine("Could not start speech recognition — try typing below.");
    }
  };
  startContinuousListeningRef.current = startContinuousListening;

  const pauseRecForAudio = () => {
    pausedForAudioRef.current = true;
    const r = recognitionRef.current;
    recognitionRef.current = null;
    if (r) {
      try { r.stop(); } catch { /* */ }
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    accumulatedRef.current = "";
    processedCountRef.current = 0;
    setTranscriptPreview("");
  };

  const resumeRecAfterAudio = () => {
    pausedForAudioRef.current = false;
    if (recognitionActiveRef.current && sessionIdRef.current) {
      startContinuousListening();
    }
  };

  const sendTurn = useCallback(async (transcript: string) => {
    const sid = sessionIdRef.current;
    const vid = selectedVoiceIdRef.current;
    if (!sid || !vid) return;

    const prevAudio = guideAudioRef.current;
    if (prevAudio && !prevAudio.paused) {
      prevAudio.pause();
      prevAudio.currentTime = 0;
    }

    setBusy(true);
    setGuideStreaming("");
    setStatusLine("Responding…");
    setLog((L) => [...L, { role: "you", text: transcript }]);
    const DEFAULT_VOICE = { stability: 0.55, similarity_boost: 0.78 };

    try {
      const res = await fetch("/api/turn?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid, transcript }),
      });
      if (process.env.NODE_ENV === "development") {
        console.debug("[turn]", { ok: res.ok, transcriptLen: transcript.length });
      }

      const ct = res.headers.get("content-type") ?? "";
      let reply = "";
      let vs = DEFAULT_VOICE;
      let crisis = false;
      let firstSentence = "";
      let firstTtsPromise: Promise<Blob> | null = null;

      if (ct.includes("application/json")) {
        const data = (await res.json()) as {
          reply?: string;
          voice_style?: { stability: number; similarity_boost: number };
          crisis?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Turn failed");
        reply = data.reply ?? "";
        vs = data.voice_style ?? DEFAULT_VOICE;
        crisis = !!data.crisis;
      } else {
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Turn failed");
        }
        if (!res.body) throw new Error("No response body");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setGuideStreaming(acc);

          if (!firstTtsPromise && acc.length >= MIN_FIRST_SENTENCE_LEN) {
            const match = SENTENCE_END_RE.exec(acc);
            if (match && match.index + 1 >= MIN_FIRST_SENTENCE_LEN) {
              firstSentence = acc.slice(0, match.index + 1).trim();
              firstTtsPromise = fetchTtsBlob(
                firstSentence, vid, vs.stability, vs.similarity_boost,
              );
            }
          }
        }
        reply = acc.trim();
        setGuideStreaming("");
      }

      if (!reply.trim()) {
        setStatusLine("No reply — try again or type below.");
        return;
      }

      setLog((L) => [...L, { role: "guide", text: reply }]);
      setStatusLine(crisis ? "Crisis resources shown." : "Speaking…");

      const audioEl = guideAudioRef.current;
      if (!audioEl) throw new Error("Audio not ready — reload and try again.");

      pauseRecForAudio();
      try {
        if (firstTtsPromise && firstSentence) {
          const remainder = reply.slice(firstSentence.length).trim();
          const remainderPromise = remainder
            ? fetchTtsBlob(remainder, vid, vs.stability, vs.similarity_boost)
            : null;

          const firstBlob = await firstTtsPromise;
          await playBlob(audioEl, firstBlob);

          if (remainderPromise) {
            const remainderBlob = await remainderPromise;
            await playBlob(audioEl, remainderBlob);
          }
        } else {
          const blob = await fetchTtsBlob(
            reply, vid, vs.stability, vs.similarity_boost,
          );
          await playBlob(audioEl, blob);
        }
      } catch (playErr) {
        throw new Error(
          playErr instanceof Error
            ? `${playErr.message} (try tapping the page once, then send again)`
            : "Playback blocked",
        );
      } finally {
        resumeRecAfterAudio();
      }

      setStatusLine("");
    } catch (e) {
      setGuideStreaming("");
      setStatusLine(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { sendTurnRef.current = sendTurn; }, [sendTurn]);

  const fireGreeting = useCallback(async () => {
    const sid = sessionIdRef.current;
    const vid = selectedVoiceIdRef.current;
    if (!sid || !vid) return;

    setBusy(true);
    setStatusLine("Starting session…");

    try {
      const res = await fetch("/api/greet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sid }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Greeting failed");
      }
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let greeting = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        greeting += dec.decode(value, { stream: true });
        setGuideStreaming(greeting);
      }
      greeting = greeting.trim();
      setGuideStreaming("");

      if (!greeting) { setStatusLine(""); return; }

      setLog((L) => [...L, { role: "guide", text: greeting }]);
      setStatusLine("Speaking…");

      const audioEl = guideAudioRef.current;
      if (!audioEl) throw new Error("Audio not ready");

      const blob = await fetchTtsBlob(greeting, vid, 0.55, 0.78);

      pauseRecForAudio();
      try {
        await playBlob(audioEl, blob);
      } catch {
        /* greeting audio failed — not critical */
      } finally {
        resumeRecAfterAudio();
      }

      setStatusLine("");
    } catch (e) {
      setGuideStreaming("");
      setStatusLine(e instanceof Error ? e.message : "Greeting failed");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (step !== "session" || !sessionId || greetingFiredRef.current) return;
    greetingFiredRef.current = true;
    void fireGreeting();
  }, [step, sessionId, fireGreeting]);

  useEffect(() => {
    if (step !== "session" || !sessionId) return;
    recognitionActiveRef.current = true;
    startContinuousListening();
    return () => {
      recognitionActiveRef.current = false;
      const r = recognitionRef.current;
      recognitionRef.current = null;
      if (r) {
        try { r.stop(); } catch { /* */ }
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sessionId]);

  useEffect(() => {
    if (!busy && pendingTranscriptRef.current) {
      const text = pendingTranscriptRef.current;
      pendingTranscriptRef.current = "";
      void sendTurn(text);
    }
  }, [busy, sendTurn]);

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

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-8">
      <audio ref={guideAudioRef} className="hidden" playsInline preload="auto" />

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
        <div className={`space-y-5 ${panelClass}`}>
          <div
            className="rounded-xl border px-4 py-3.5 text-sm leading-relaxed"
            style={{
              borderColor: "var(--psych-warm-border)",
              background: "var(--psych-warm-bg)",
              color: "var(--psych-warm-fg)",
            }}
          >
            This app does not provide diagnosis or treatment. If you are in
            crisis, contact local emergency services or a crisis line (U.S.:
            988).
          </div>
          <button
            type="button"
            onClick={() => setStep("select")}
            className="psych-breathe-cta w-full rounded-xl bg-[var(--psych-accent)] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[var(--psych-accent-hover)] motion-reduce:transition-none"
          >
            Begin session
          </button>
        </div>
      )}

      {step === "select" && (
        <div className={`space-y-5 ${panelClass}`}>
          <p className="text-sm leading-relaxed text-[var(--psych-muted)]">
            Choose the psychologist you'd like to speak with. Click a card to
            hear them introduce themselves.
          </p>
          {psychError && (
            <p className="text-sm text-[var(--psych-danger)]">{psychError}</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {psychologists.map((p) => {
              const isSelected = selectedPsychId === p.id;
              const isPlaying = introPlaying === p.id;
              const isLoadingIntro = introLoading === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedPsychId(p.id);
                    void playIntro(p.id);
                  }}
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
            disabled={!selectedPsychId || !!psychError}
            onClick={() => {
              stopIntroAudio();
              setStep("permissions");
            }}
            className="w-full rounded-xl bg-[var(--psych-fg)] px-4 py-3.5 text-sm font-medium text-[var(--psych-bg)] transition enabled:hover:opacity-90 disabled:opacity-35 dark:text-[var(--psych-bg)]"
          >
            Continue
          </button>
        </div>
      )}

      {step === "permissions" && (
        <div className={`space-y-5 ${panelClass}`}>
          <p className="text-sm leading-relaxed text-[var(--psych-muted)]">
            Camera provides environmental and facial context; the microphone
            captures your speech. Media is sent only to your configured APIs
            for this session.
          </p>
          {permError && (
            <p className="text-sm text-[var(--psych-danger)]">{permError}</p>
          )}
          <button
            type="button"
            onClick={() => void startPermissions()}
            className="w-full rounded-xl bg-[var(--psych-accent)] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[var(--psych-accent-hover)]"
          >
            Allow camera and microphone
          </button>
          <button
            type="button"
            onClick={() => setStep("select")}
            className="w-full text-sm text-[var(--psych-muted)] underline-offset-4 transition hover:text-[var(--psych-fg)] hover:underline"
          >
            Back
          </button>
        </div>
      )}

      {step === "session" && (
        <div className={`flex min-h-0 flex-1 flex-col gap-5 ${sessionShellClass}`}>
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
              This browser does not support speech recognition well. Use the
              text field below to message the guide.
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="relative overflow-hidden rounded-xl border border-[var(--psych-panel-border)] bg-black/50 shadow-inner">
              <span className="absolute left-3 top-3 z-10 rounded-md bg-black/45 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/90 backdrop-blur-sm">
                You
              </span>
              <video
                ref={videoRef}
                className="aspect-video w-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <div className="psych-vitals-line absolute bottom-3 left-5 right-5" />
            </div>
            <GuidePresence
              key={sessionId ?? "idle"}
              audioRef={guideAudioRef}
              active
            />
          </div>

          <VisionRail vision={visionContext} analyzing={visionAnalyzing} />

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
                  {line.role === "you" ? "You" : selectedPsychName}
                </span>
                <span className="text-[var(--psych-muted)]"> · </span>
                {line.text}
              </p>
            ))}
            {guideStreaming && (
              <p className="text-[var(--psych-accent)] dark:text-[color-mix(in_srgb,var(--psych-accent)_92%,white)]">
                <span className="font-medium text-[var(--psych-fg)]">{selectedPsychName}</span>
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
              onChange={(e) => setTypedMessage(e.target.value)}
              placeholder="Or type a message…"
              rows={2}
              disabled={busy}
              className="w-full resize-none rounded-xl border border-[var(--psych-panel-border)] bg-[color-mix(in_srgb,var(--psych-surface)_90%,transparent)] px-3 py-2 text-sm text-[var(--psych-fg)] placeholder:text-[var(--psych-muted)] focus:border-[color-mix(in_srgb,var(--psych-accent)_40%,transparent)] focus:outline-none focus:ring-1 focus:ring-[var(--psych-accent)] disabled:opacity-50"
            />
            <button
              type="button"
              disabled={busy || !typedMessage.trim()}
              onClick={() => sendTyped()}
              className="w-full rounded-xl bg-[var(--psych-fg)] py-2.5 text-sm font-medium text-[var(--psych-bg)] transition enabled:hover:opacity-90 disabled:opacity-35"
            >
              Send message
            </button>
          </div>
        </div>
      )}

      {step === "ended" && (
        <div className={`space-y-6 text-center ${panelClass}`}>
          <p className="text-[var(--psych-fg)] leading-relaxed">
            Session complete. Thank you for trying the prototype.
          </p>
          <button
            type="button"
            onClick={() => {
              setStep("intro");
              setSessionId(null);
              setSelectedPsychId("");
              setSelectedVoiceId("");
              setLog([]);
              setGuideStreaming("");
              setVisionContext(null);
              summarySeqRef.current = 0;
              greetingFiredRef.current = false;
            }}
            className="psych-breathe-cta w-full rounded-xl bg-[var(--psych-accent)] px-4 py-3.5 text-sm font-medium text-white transition hover:bg-[var(--psych-accent-hover)]"
          >
            Start over
          </button>
        </div>
      )}
    </div>
  );
}
