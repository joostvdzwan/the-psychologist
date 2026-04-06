import { requireElevenLabsApiKey } from "./env";

export type ElevenLabsStreamOptions = {
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
};

type QueueItem =
  | { type: "audio"; data: string }
  | { type: "done" }
  | { type: "error"; error: Error };

/**
 * Opens an ElevenLabs WebSocket for streaming text-to-speech.
 * Send text chunks via send(); consume audio (base64 mp3) via audioChunks().
 */
export function createElevenLabsStream(opts: ElevenLabsStreamOptions) {
  const apiKey = requireElevenLabsApiKey();
  const modelId =
    opts.modelId ||
    process.env.ELEVENLABS_TTS_MODEL?.trim() ||
    "eleven_flash_v2_5";
  const uri = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/stream-input?model_id=${encodeURIComponent(modelId)}`;

  const ws = new WebSocket(uri);

  let resolveReady: () => void;
  let rejectReady: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const queue: QueueItem[] = [];
  let waiter: ((item: QueueItem) => void) | null = null;
  let finished = false;

  function push(item: QueueItem) {
    if (finished && item.type === "done") return;
    if (item.type === "done" || item.type === "error") finished = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(item);
    } else {
      queue.push(item);
    }
  }

  function pull(): Promise<QueueItem> {
    const item = queue.shift();
    if (item) return Promise.resolve(item);
    return new Promise((resolve) => {
      waiter = resolve;
    });
  }

  ws.addEventListener("open", () => {
    ws.send(
      JSON.stringify({
        text: " ",
        voice_settings: {
          stability: opts.stability ?? 0.55,
          similarity_boost: opts.similarityBoost ?? 0.78,
          use_speaker_boost: true,
          style: 0,
        },
        generation_config: {
          chunk_length_schedule: [25, 80, 120, 200],
        },
        xi_api_key: apiKey,
      }),
    );
    resolveReady();
  });

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        audio?: string;
        isFinal?: boolean;
      };
      if (msg.audio) push({ type: "audio", data: msg.audio });
      if (msg.isFinal) push({ type: "done" });
    } catch {
      /* ignore malformed frames */
    }
  });

  ws.addEventListener("error", () => {
    const err = new Error("ElevenLabs WebSocket error");
    rejectReady(err);
    push({ type: "error", error: err });
  });

  ws.addEventListener("close", () => {
    push({ type: "done" });
  });

  return {
    ready,

    send(text: string) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text }));
      }
    },

    flush() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: " ", flush: true }));
      }
    },

    end() {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: "" }));
      }
    },

    async *audioChunks(): AsyncGenerator<string, void, undefined> {
      while (true) {
        const item = await pull();
        if (item.type === "done") return;
        if (item.type === "error") throw item.error;
        yield item.data;
      }
    },

    destroy() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}
