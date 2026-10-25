import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LiveScan } from "@/components/scan/LiveScan";
import type { ScanApi, ScanEvent } from "@/lib/types";
import { ScanStoreProvider } from "@/state/scanStore";

const ev = (stage: ScanEvent["stage"], message: string, ts: string): ScanEvent => ({
  stage,
  message,
  type: "info",
  ts,
});

const events = [
  ev("queued", "scan queued", "2026-10-25T10:00:00Z"),
  ev("crawling", "rendering https://x.dev", "2026-10-25T10:00:05Z"),
  ev("failed", "scan failed: x.dev showed a bot-protection page", "2026-10-25T10:01:05Z"),
];

vi.mock("@/lib/api", () => ({
  getApi: async (): Promise<Partial<ScanApi>> => ({
    getScan: async () => ({
      scan: {
        id: "scan_1",
        url: "https://x.dev",
        mode: "url",
        level: "AA",
        scope: "page",
        status: "failed",
        error: "x.dev showed a bot-protection page",
        created_at: "2026-10-25T10:00:00Z",
      },
      issues: [],
      fixes: [],
    }),
    getEvents: async () => events,
    listScans: async () => [],
  }),
}));

vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

describe("opening a scan that already failed", () => {
  it("shows its stored log, elapsed time, failure reason and the stage it failed in", async () => {
    render(
      <ScanStoreProvider>
        <LiveScan id="scan_1" />
      </ScanStoreProvider>,
    );
    expect(await screen.findByText(/showed a bot-protection page\s*Check the log/)).toBeInTheDocument();
    expect(screen.getByText("rendering https://x.dev")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for the agent…")).not.toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument(); // first event to last event
    // The stepper marks Crawling (where it failed), not Queued.
    const failedStep = screen.getByText("Crawling").closest("li");
    expect(failedStep?.textContent).toMatch(/fail/i);
  });
});
