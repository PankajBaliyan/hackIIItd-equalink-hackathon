import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openEventStream } from "@/lib/sse";
import type { ScanEvent } from "@/lib/types";

class FakeEventSource {
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  send(id: number, e: Partial<ScanEvent>) {
    this.onmessage?.({ data: JSON.stringify({ type: "info", ts: "", ...e }), lastEventId: String(id) });
  }
}

describe("openEventStream reconnect", () => {
  beforeEach(() => {
    FakeEventSource.all = [];
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks only for events after the last one it saw, so the log is not replayed", () => {
    const seen: string[] = [];
    openEventStream({ url: "http://api/scans/s1/events", onEvent: (e) => seen.push(e.message) });
    const [first] = FakeEventSource.all;
    first!.send(4, { stage: "crawling", message: "a" });
    first!.send(7, { stage: "diagnosing", message: "b" });
    first!.onerror?.(); // connection drops
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.all).toHaveLength(2);
    expect(FakeEventSource.all[1]!.url).toBe("http://api/scans/s1/events?after=7");
    FakeEventSource.all[1]!.send(8, { stage: "done", message: "c" });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("opens the plain url when nothing was received yet", () => {
    openEventStream({ url: "http://api/scans/s1/events", onEvent: () => {} });
    FakeEventSource.all[0]!.onerror?.();
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.all[1]!.url).toBe("http://api/scans/s1/events");
  });
});
