import type { Fix, Issue } from "@/lib/types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the "Scan complete" banner says, from what the scan actually produced. */
export function completionSummary(
  issues: Issue[],
  fixes: Fix[],
): { text: string; action: "fixes" | "issues" | null } {
  if (issues.length === 0)
    return { text: "Scan complete. No accessibility issues found.", action: null };
  const found = `Scan complete. ${plural(issues.length, "issue")} found`;
  if (fixes.length === 0) {
    return {
      text: `${found}. No automatic fixes were proposed, so they need human review.`,
      action: "issues",
    };
  }
  const validated = fixes.filter((f) => f.validated).length;
  const rejected = fixes.length - validated;
  const noFix = Math.max(0, issues.length - fixes.length);
  const parts = [`${plural(validated, "validated fix", "validated fixes")} ready to review`];
  if (rejected) parts.push(`${rejected} rejected by the rules engine`);
  if (noFix) parts.push(`${noFix} need human review`);
  return { text: `${found}: ${parts.join(", ")}.`, action: "fixes" };
}
