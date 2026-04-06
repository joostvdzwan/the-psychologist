export const SENTENCE_END_RE = /[.!?]\s/;
export const MIN_FIRST_SENTENCE_LEN = 20;

/** Tiny silent WAV blob URL — use during a user gesture to unlock audio on iOS. */
export function createSilentWav(): string {
  const header = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x26, 0x00, 0x00, 0x00, // RIFF + size
    0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, // WAVEfmt
    0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, // PCM, mono
    0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00, // 8 kHz
    0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61, // 16-bit, data
    0x02, 0x00, 0x00, 0x00, 0x00, 0x00,               // 1 silent sample
  ]);
  return URL.createObjectURL(new Blob([header], { type: "audio/wav" }));
}

export async function fetchTtsBlob(
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

export function playBlob(audioEl: HTMLAudioElement, blob: Blob): Promise<void> {
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

type VoiceEvent =
  | { type: "text"; data: string }
  | { type: "audio"; data: string }
  | { type: "done"; data: { reply: string; crisis: boolean } }
  | { type: "error"; data: { message: string } };

export async function processVoiceStream(
  body: ReadableStream<Uint8Array>,
  audioEl: HTMLAudioElement,
  onStreamText: (accumulated: string) => void,
): Promise<{ reply: string; crisis: boolean }> {
  const reader = body.getReader();
  const dec = new TextDecoder();

  const canMSE =
    typeof MediaSource !== "undefined" &&
    MediaSource.isTypeSupported("audio/mpeg");

  let fullReply = "";
  let crisis = false;
  let buf = "";

  const fallbackChunks: ArrayBuffer[] = [];
  let mediaSource: MediaSource | null = null;
  let sourceBuffer: SourceBuffer | null = null;
  const sbQueue: ArrayBuffer[] = [];
  let allAudioEnqueued = false;
  let firstAppendDone = false;

  let resolveEndOfStream: (() => void) | null = null;
  let playRejected = false;

  const tryAppend = () => {
    if (!sourceBuffer || sourceBuffer.updating) return;
    if (sbQueue.length > 0) {
      sourceBuffer.appendBuffer(sbQueue.shift()!);
    } else if (allAudioEnqueued) {
      try {
        if (mediaSource?.readyState === "open") mediaSource.endOfStream();
      } catch {
        /* already ended */
      }
    }
  };

  if (canMSE) {
    mediaSource = new MediaSource();
    const prev = audioEl.src;
    if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
    audioEl.src = URL.createObjectURL(mediaSource);

    await new Promise<void>((resolve) => {
      mediaSource!.addEventListener(
        "sourceopen",
        () => {
          sourceBuffer = mediaSource!.addSourceBuffer("audio/mpeg");
          sourceBuffer.addEventListener("updateend", () => {
            if (!firstAppendDone) {
              firstAppendDone = true;
              audioEl.play().catch(() => { playRejected = true; });
            }
            tryAppend();
          });
          resolve();
        },
        { once: true },
      );
    });
  }

  const feedAudio = (b64: string) => {
    const raw = atob(b64);
    const ab = new ArrayBuffer(raw.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);

    if (canMSE && sourceBuffer) {
      sbQueue.push(ab);
      tryAppend();
    } else {
      fallbackChunks.push(ab);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let nlIdx: number;
    while ((nlIdx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nlIdx);
      buf = buf.slice(nlIdx + 1);
      if (!line.trim()) continue;

      let ev: VoiceEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }

      switch (ev.type) {
        case "text":
          fullReply += ev.data;
          onStreamText(fullReply);
          break;
        case "audio":
          feedAudio(ev.data);
          break;
        case "done":
          fullReply = ev.data?.reply ?? fullReply;
          crisis = ev.data?.crisis ?? false;
          break;
        case "error":
          throw new Error(ev.data?.message ?? "Turn failed");
      }
    }
  }

  allAudioEnqueued = true;

  if (canMSE && mediaSource) {
    tryAppend();

    if (firstAppendDone) {
      await new Promise<void>((resolve) => {
        resolveEndOfStream = resolve;
        if (audioEl.ended) {
          resolve();
          return;
        }
        audioEl.addEventListener("ended", () => resolve(), { once: true });
        const poll = setInterval(() => {
          if (
            audioEl.ended ||
            playRejected ||
            (audioEl.paused && audioEl.currentTime > 0)
          ) {
            clearInterval(poll);
            resolve();
          }
        }, 250);
      });
    }
  } else if (fallbackChunks.length > 0) {
    const blob = new Blob(fallbackChunks, { type: "audio/mpeg" });
    try {
      await playBlob(audioEl, blob);
    } catch {
      /* Autoplay blocked or playback error — text reply still returned */
    }
  }

  void resolveEndOfStream;
  return { reply: fullReply.trim(), crisis };
}
