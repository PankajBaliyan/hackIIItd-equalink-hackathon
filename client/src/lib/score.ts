import type { Severity } from "@/lib/types";

/** Display-only severity weights; the authoritative score comes from the backend. */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};

export const SEVERITY_ORDER: Severity[] = ["critical", "serious", "moderate", "minor"];

export const emptyCounters = (): Record<Severity, number> => ({
  critical: 0,
  serious: 0,
  moderate: 0,
  minor: 0,
});

export function weightedTotal(counters: Record<Severity, number>): number {
  return SEVERITY_ORDER.reduce((sum, s) => sum + SEVERITY_WEIGHT[s] * counters[s], 0);
}

/** score = 100 - weighted / normalizer, clamped 0-100. */
export function estimateScore(counters: Record<Severity, number>, normalizer = 1): number {
  return Math.max(0, Math.min(100, Math.round(100 - weightedTotal(counters) / normalizer)));
}
