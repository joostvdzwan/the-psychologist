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

export type UseVisionCaptureOpts = {
  active: boolean;
  sessionId: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

function captureFrameDataUrl(video: HTMLVideoElement): string | null {
  if (video.readyState < 2) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const maxW = 384;
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
}

export function useVisionCapture({ active, sessionId, videoRef }: UseVisionCaptureOpts) {
  const [visionContext, setVisionContext] = useState<VisionContext | null>(null);
  const [visionAnalyzing, setVisionAnalyzing] = useState(false);

  const summarySeqRef = useRef(0);
  const summaryInFlightRef = useRef(false);

  const pushSummary = useCallback(async () => {
    if (!sessionId || !active) return;
    if (summaryInFlightRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    const dataUrl = captureFrameDataUrl(video);
    if (!dataUrl) return;
    summaryInFlightRef.current = true;
    setVisionAnalyzing(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
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
  }, [active, sessionId, videoRef]);

  useEffect(() => {
    if (!active || !sessionId) return;
    const id = setInterval(() => void pushSummary(), 6000);
    void pushSummary();
    return () => clearInterval(id);
  }, [active, sessionId, pushSummary]);

  const resetVision = useCallback(() => {
    setVisionContext(null);
    summarySeqRef.current = 0;
  }, []);

  return { visionContext, visionAnalyzing, resetVision };
}
