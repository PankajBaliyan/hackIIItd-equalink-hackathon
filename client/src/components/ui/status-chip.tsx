import { CheckCircle2, CircleSlash, Eye, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type FixStatus = "validated" | "rejected" | "needs-review";

const META: Record<FixStatus, { label: string; Icon: LucideIcon; cls: string }> = {
  validated: { label: "Validated", Icon: CheckCircle2, cls: "text-success" },
  rejected: { label: "Rejected", Icon: CircleSlash, cls: "text-critical" },
  "needs-review": { label: "Needs review", Icon: Eye, cls: "text-moderate" },
};

/** a11y: icon + text label; state is not conveyed by colour alone. */
export function StatusChip({ status, className }: { status: FixStatus; className?: string }) {
  const { label, Icon, cls } = META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium",
        cls,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}
