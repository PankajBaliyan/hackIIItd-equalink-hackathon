import { describe, expect, it } from "vitest";

import { mockApi } from "@/lib/mocks/mockApi";
import type { ScanEvent } from "@/lib/types";

describe("mock api", () => {
  it("streams a full run ending at done with counters and one rejected fix", async () => {
    const scan = await mockApi.createScan({
      url: "https://shopeasy.dev",
      level: "AA",
      scope: "page",
    });
    const events: ScanEvent[] = [];
    await new Promise<void>((resolve) => {
      mockApi.subscribe(scan.id, (e) => {
        events.push(e);
        if (e.stage === "done") resolve();
      });
    });
    expect(events.some((e) => e.type === "rejected")).toBe(true);
    expect(events.filter((e) => e.type === "issue")).toHaveLength(6);
    const detail = await mockApi.getScan(scan.id);
    expect(detail.scan.score_before).toBe(42);
    expect(detail.scan.score_after).toBe(91);
    expect(detail.fixes.filter((f) => !f.validated)).toHaveLength(1);
    const pr = await mockApi.ship(scan.id);
    expect(pr.number).toBe(7);
    expect(pr.repo).toBe("shopeasy/shopeasy-demo");
  }, 30000);
});
