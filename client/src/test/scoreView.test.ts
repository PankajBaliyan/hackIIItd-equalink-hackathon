import { describe, expect, it } from "vitest";

import { scoreView } from "@/components/scan/scoreView";
import type { Fix, Issue, Scan, Severity } from "@/lib/types";

const scan = (over: Partial<Scan>): Scan => ({
  id: "s",
  url: "https://x.dev",
  mode: "url",
  level: "AA",
  scope: "page",
  status: "queued",
  created_at: "2026-10-25T10:00:00Z",
  ...over,
});
const issue = (id: string, impact: Severity): Issue => ({ id, impact }) as Issue;
const fix = (issue_id: string, validated: boolean): Fix =>
  ({ id: `f_${issue_id}`, issue_id, validated }) as Fix;

// critical 10 + serious 5 = 15 weighted, /2 = 7.5 -> 92.5, which the server's Python round() makes 92 (not 93)
const found = [issue("a", "critical"), issue("b", "serious")];

describe("scoreView", () => {
  it("shows nothing before any page has been scanned", () => {
    expect(scoreView(scan({ status: "queued" }), [], [])).toEqual({});
    expect(scoreView(scan({ status: "crawling" }), [], [])).toEqual({});
  });

  it("estimates the score live from the issues found so far, using the server's formula", () => {
    expect(scoreView(scan({ status: "diagnosing" }), [], []).before).toEqual({
      value: 100,
      final: false,
      label: "Score so far",
    });
    expect(scoreView(scan({ status: "diagnosing" }), found, []).before?.value).toBe(92);
  });

  it("uses the server's score_before as soon as it exists", () => {
    const v = scoreView(scan({ status: "done", score_before: 41 }), found, []);
    expect(v.before).toEqual({ value: 41, final: true, label: "Score before fixes" });
    expect(v.after).toBeUndefined(); // no fix stage ran, so there is no "after"
    expect(v.delta).toBeUndefined();
  });

  it("follows validated fixes live while verifying, ignoring rejected ones", () => {
    const v = scoreView(scan({ status: "verifying" }), found, [fix("a", true), fix("b", false)]);
    expect(v.before?.value).toBe(92);
    expect(v.after).toEqual({ value: 98, final: false, label: "After fixes so far" }); // critical removed: 100 - 5/2 = 97.5 -> 98 (round half to even)
    expect(v.delta).toBe(6);
  });

  it("starts the after ring at the before value when fixing begins", () => {
    const v = scoreView(scan({ status: "fixing" }), found, []);
    expect(v.after?.value).toBe(v.before?.value);
    expect(v.delta).toBe(0);
  });

  it("shows the final before and after, and the gain, when the scan is done", () => {
    const v = scoreView(scan({ status: "done", score_before: 76, score_after: 92 }), found, [
      fix("a", true),
    ]);
    expect(v.before).toEqual({ value: 76, final: true, label: "Score before fixes" });
    expect(v.after).toEqual({ value: 92, final: true, label: "Score after fixes" });
    expect(v.delta).toBe(16);
  });

  it("keeps what it can for a failed scan", () => {
    const v = scoreView(scan({ status: "failed" }), found, []);
    expect(v.before).toEqual({ value: 92, final: false, label: "Score so far" });
    expect(v.after).toBeUndefined();
    expect(scoreView(scan({ status: "failed" }), [], [])).toEqual({});
  });
});
