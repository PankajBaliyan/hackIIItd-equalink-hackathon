import { countBySeverity } from "@/lib/wcag";
import { emptyCounters, weightedTotal } from "@/lib/score";
import type { Fix, Issue, Scan, Severity } from "@/lib/types";

export interface ScoreItem {
  value: number;
  /** The server's final number, as opposed to an estimate from what has streamed in so far. */
  final: boolean;
  label: string;
}

const DIAGNOSING_ON: Scan["status"][] = ["diagnosing", "fixing", "verifying", "shipping", "done"];
const FIXING_ON: Scan["status"][] = ["fixing", "verifying", "shipping"];

/** Python's round(): halves go to the even number (92.5 -> 92), unlike Math.round, so estimates match the server. */
function roundHalfEven(n: number): number {
  const floor = Math.floor(n);
  const diff = n - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Same formula as the server (server/app/pipeline.py: score): 100 - weighted issues / 2, rounded, clamped. */
function estimate(counters: Record<Severity, number>): number {
  return Math.max(0, Math.min(100, roundHalfEven(100 - weightedTotal(counters) / 2)));
}

/**
 * What the Live Scan score rings show. Before the scan ends the server has no score yet, so it is estimated from
 * the issues found so far with the server's own formula; the "after fixes" ring appears once fixing starts and
 * follows the validated fixes until the server's final number arrives.
 */
export function scoreView(
  scan: Scan,
  issues: Issue[],
  fixes: Fix[],
): { before?: ScoreItem; after?: ScoreItem; delta?: number } {
  const counters = countBySeverity(issues);
  let before: ScoreItem | undefined;
  if (scan.score_before != null) {
    before = { value: scan.score_before, final: true, label: "Score before fixes" };
  } else if (issues.length > 0 || DIAGNOSING_ON.includes(scan.status)) {
    before = {
      value: estimate(counters),
      final: false,
      label: "Score so far",
    };
  }

  let after: ScoreItem | undefined;
  if (scan.score_after != null) {
    after = { value: scan.score_after, final: true, label: "Score after fixes" };
  } else if (FIXING_ON.includes(scan.status)) {
    const impact = new Map(issues.map((i) => [i.id, i.impact]));
    const fixed = emptyCounters();
    for (const f of fixes) {
      const sev: Severity | undefined = f.validated ? impact.get(f.issue_id) : undefined;
      if (sev) fixed[sev] += 1;
    }
    const left = emptyCounters();
    for (const s of Object.keys(left) as Severity[]) left[s] = Math.max(0, counters[s] - fixed[s]);
    after = {
      value: estimate(left),
      final: false,
      label: "After fixes so far",
    };
  }

  return {
    ...(before && { before }),
    ...(after && { after }),
    ...(before && after && { delta: after.value - before.value }),
  };
}
