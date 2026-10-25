import { describe, expect, it } from "vitest";

import { completionSummary } from "@/components/scan/summary";
import type { Fix, Issue } from "@/lib/types";

const issue = (n: number) => ({ id: `i${n}` }) as Issue;
const fix = (n: number, validated: boolean) =>
  ({ id: `f${n}`, issue_id: `i${n}`, validated }) as Fix;
const issues = (n: number) => Array.from({ length: n }, (_, i) => issue(i));

describe("completionSummary", () => {
  it("says so when the scan found nothing, with no action", () => {
    expect(completionSummary([], [])).toEqual({
      text: "Scan complete. No accessibility issues found.",
      action: null,
    });
  });

  it("does not claim fixes when none were proposed", () => {
    const s = completionSummary(issues(3), []);
    expect(s.text).toBe(
      "Scan complete. 3 issues found. No automatic fixes were proposed, so they need human review.",
    );
    expect(s.action).toBe("issues");
  });

  it("counts validated, rejected and fix-less issues", () => {
    const s = completionSummary(issues(6), [fix(0, true), fix(1, true), fix(2, false)]);
    expect(s.text).toBe(
      "Scan complete. 6 issues found: 2 validated fixes ready to review, 1 rejected by the rules engine, 3 need human review.",
    );
    expect(s.action).toBe("fixes");
  });

  it("uses singular wording and omits zero counts", () => {
    expect(completionSummary(issues(1), [fix(0, true)]).text).toBe(
      "Scan complete. 1 issue found: 1 validated fix ready to review.",
    );
  });

  it("still offers the fixes page when every fix was rejected", () => {
    const s = completionSummary(issues(1), [fix(0, false)]);
    expect(s.text).toContain("0 validated fixes ready to review, 1 rejected");
    expect(s.action).toBe("fixes");
  });
});
