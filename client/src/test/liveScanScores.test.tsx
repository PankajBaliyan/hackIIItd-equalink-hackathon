import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LiveScan } from "@/components/scan/LiveScan";
import type { Fix, Issue, ScanApi } from "@/lib/types";
import { ScanStoreProvider } from "@/state/scanStore";

const issues = [
  {
    id: "i1",
    scan_id: "s1",
    page_url: "https://x.dev/",
    rule_id: "image-alt",
    wcag_sc: "1.1.1",
    impact: "critical",
    selector: "img",
    html: "<img>",
  },
  {
    id: "i2",
    scan_id: "s1",
    page_url: "https://x.dev/",
    rule_id: "label",
    wcag_sc: "3.3.2",
    impact: "serious",
    selector: "input",
    html: "<input>",
  },
] as Issue[];
const fixes = [{ id: "f1", issue_id: "i1", validated: true }] as Fix[];

vi.mock("@/lib/api", () => ({
  getApi: async (): Promise<Partial<ScanApi>> => ({
    getScan: async () => ({
      scan: {
        id: "s1",
        url: "https://x.dev",
        mode: "url",
        level: "AA",
        scope: "page",
        status: "done",
        score_before: 76,
        score_after: 92,
        created_at: "2026-10-25T10:00:00Z",
      },
      issues,
      fixes,
    }),
    getEvents: async () => [],
    listScans: async () => [],
  }),
}));

vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

describe("Live Scan score rings", () => {
  it("shows the score before and after the fixes, and the gain, for a finished scan", async () => {
    render(
      <ScanStoreProvider>
        <LiveScan id="s1" />
      </ScanStoreProvider>,
    );
    expect(await screen.findByText("Score before fixes")).toBeInTheDocument();
    expect(screen.getByText("Score after fixes")).toBeInTheDocument();
    expect(screen.getByText("+16")).toBeInTheDocument();
    expect(screen.getByText(/points from validated fixes$/)).toBeInTheDocument();
    // Each ring has its own gradient id, so the two SVGs don't share one.
    const ids = [...document.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
