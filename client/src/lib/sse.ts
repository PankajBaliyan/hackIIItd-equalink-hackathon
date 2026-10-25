import type { ConnectionState, ScanEvent } from "@/lib/types";

interface StreamOptions {
  url: string;
  onEvent: (e: ScanEvent) => void;
  onConnection?: (s: ConnectionState) => void;
  /** Polling fallback: called every `pollMs` once SSE has failed `maxRetries` times. */
  poll?: () => Promise<ScanEvent[]>;
  maxRetries?: number;
  pollMs?: number;
}

const isTerminal = (e: ScanEvent) => e.stage === "done" || e.stage === "failed";

/** EventSource wrapper: exponential backoff reconnect, then a polling fallback. */
export function openEventStream(opts: StreamOptions): () => void {
  const { url, onEvent, onConnection, poll, maxRetries = 4, pollMs = 3000 } = opts;
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let closed = false;
  // A fresh EventSource sends no Last-Event-ID, so remember where we got to and ask for the rest explicitly.
  let lastId = "";

  const finish = () => {
    closed = true;
    es?.close();
    clearTimeout(timer);
    onConnection?.("closed");
  };

  const emit = (e: ScanEvent) => {
    onEvent(e);
    if (isTerminal(e)) finish();
  };

  const startPolling = () => {
    if (!poll) return finish();
    onConnection?.("polling");
    const tick = async () => {
      if (closed) return;
      try {
        for (const e of await poll()) emit(e);
      } catch {
        /* keep polling */
      }
      if (!closed) timer = setTimeout(tick, pollMs);
    };
    void tick();
  };

  const connect = () => {
    if (closed) return;
    onConnection?.(retries === 0 ? "connecting" : "reconnecting");
    es = new EventSource(lastId ? `${url}${url.includes("?") ? "&" : "?"}after=${lastId}` : url);
    es.onopen = () => {
      retries = 0;
      onConnection?.("live");
    };
    es.onmessage = (m) => {
      if (m.lastEventId) lastId = m.lastEventId;
      try {
        emit(JSON.parse(m.data) as ScanEvent);
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => {
      es?.close();
      if (closed) return;
      if (++retries > maxRetries) return startPolling();
      onConnection?.("reconnecting");
      timer = setTimeout(connect, Math.min(1000 * 2 ** retries, 10000));
    };
  };

  if (typeof EventSource === "undefined") startPolling();
  else connect();
  return finish;
}
