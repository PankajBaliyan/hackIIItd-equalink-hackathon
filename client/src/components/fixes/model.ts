import type { Fix, Issue, Severity } from "@/lib/types";
import type { FixStatus } from "@/components/ui/status-chip";
import { principleOf } from "@/lib/wcag";

export interface Row {
  issue: Issue;
  fix?: Fix;
  status: FixStatus;
  principle: string;
}

export function buildRows(issues: Issue[], fixes: Fix[]): Row[] {
  return issues.map((issue) => {
    const fix = fixes.find((f) => f.issue_id === issue.id);
    const status: FixStatus = !fix ? "needs-review" : fix.validated ? "validated" : "rejected";
    return { issue, ...(fix && { fix }), status, principle: principleOf(issue.wcag_sc).id };
  });
}

export const SEV_RANK: Record<Severity, number> = {
  critical: 0,
  serious: 1,
  moderate: 2,
  minor: 3,
};

/** Plain unified-style patch text for "Copy patch". */
export function patchText(rows: Row[]): string {
  return rows
    .filter((r) => r.fix)
    .map(
      (r) =>
        `# ${r.issue.rule_id} (WCAG ${r.issue.wcag_sc}) ${r.issue.selector}${r.issue.source_file ? ` in ${r.issue.source_file}` : ""}\n` +
        r
          .fix!.original.split("\n")
          .map((l) => `- ${l}`)
          .join("\n") +
        "\n" +
        r
          .fix!.patched.split("\n")
          .map((l) => `+ ${l}`)
          .join("\n"),
    )
    .join("\n\n");
}
