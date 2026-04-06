"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

const SILENCE_MS = 900;

export type UseSpeechRecognitionOpts = {
  active: boolean;
  onTranscript: (text: string) => void;
  guideAudioRef: React.RefObject<HTMLAudioElement | null>;
};

export function useSpeechRecognition({
  active,
  onTranscript,
  guideAudioRef,
}: UseSpeechRecognitionOpts) {
  const [listening, setListening] = useState(false);
  const [transcriptPreview, setTranscriptPreview] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechChecked, setSpeechChecked] = useState(false);
  const [httpSpeechTip, setHttpSpeechTip] = useState(false);
  const [statusLine, setStatusLine] = useState("");

  const recognitionRef = useRef<WebSpeechRec | null>(null);
  const speechHadErrorRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumulatedRef = useRef("");
  const processedCountRef = useRef(0);
  const recognitionActiveRef = useRef(false);
  const pausedForAudioRef = useRef(false);
  const pendingTranscriptRef = useRef("");
  const busyRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const startContinuousListeningRef = useRef<(retryLeft?: number) => void>(() => {});

  useEffect(() => { onTranscriptRef.current = onTranscript; });

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    setSpeechSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    setSpeechChecked(true);
  }, []);

  useEffect(() => {
    if (!active) {
      setHttpSpeechTip(false);
      return;
    }
    setHttpSpeechTip(
      typeof window !== "undefined" && window.location.protocol === "http:",
    );
  }, [active]);

  const flushAccumulated = useCallback(() => {
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
    onTranscriptRef.current(text);
  }, [guideAudioRef]);

  const setupRecognition = useCallback(() => {
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
      if (recognitionRef.current !== null && recognitionRef.current !== r) return;

      setListening(false);
      processedCountRef.current = 0;
      recognitionRef.current = null;
      if (!pausedForAudioRef.current) {
        flushAccumulated();
      }

      if (recognitionActiveRef.current && !pausedForAudioRef.current) {
        setTimeout(() => {
          if (recognitionActiveRef.current && !pausedForAudioRef.current) {
            startContinuousListeningRef.current();
          }
        }, 300);
      }
    };

    recognitionRef.current = r;
    return r;
  }, [flushAccumulated]);

  const startContinuousListening = useCallback((retryLeft = 2) => {
    const prev = recognitionRef.current;
    if (prev) {
      recognitionRef.current = null;
      try { prev.stop(); } catch { /* */ }
    }

    const r = setupRecognition();
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
      recognitionRef.current = null;
      if (retryLeft > 0) {
        setTimeout(() => {
          if (recognitionActiveRef.current && !pausedForAudioRef.current) {
            startContinuousListeningRef.current(retryLeft - 1);
          }
        }, 300);
      } else {
        setStatusLine("Could not start speech recognition — try typing below.");
      }
    }
  }, [setupRecognition]);

  useEffect(() => {
    startContinuousListeningRef.current = startContinuousListening;
  }, [startContinuousListening]);

  useEffect(() => {
    if (!active) return;
    recognitionActiveRef.current = true;
    const timer = setTimeout(() => {
      if (recognitionActiveRef.current) startContinuousListening();
    }, 80);
    return () => {
      clearTimeout(timer);
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
  }, [active]);

  const pauseForAudio = useCallback(() => {
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
  }, []);

  const resumeAfterAudio = useCallback(() => {
    pausedForAudioRef.current = false;
    if (recognitionActiveRef.current) {
      startContinuousListening();
    }
  }, [startContinuousListening]);

  const markBusy = useCallback((isBusy: boolean) => {
    busyRef.current = isBusy;
    if (!isBusy && pendingTranscriptRef.current) {
      const text = pendingTranscriptRef.current;
      pendingTranscriptRef.current = "";
      onTranscriptRef.current(text);
    }
  }, []);

  const clearStatus = useCallback(() => setStatusLine(""), []);
  const setStatus = useCallback((msg: string) => setStatusLine(msg), []);

  return {
    listening,
    transcriptPreview,
    speechSupported,
    speechChecked,
    httpSpeechTip,
    statusLine,
    setStatus,
    clearStatus,
    pauseForAudio,
    resumeAfterAudio,
    markBusy,
  };
}
