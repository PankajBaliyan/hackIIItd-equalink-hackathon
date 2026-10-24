import { AlertCircle, AlertOctagon, AlertTriangle, Info, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type Severity = "critical" | "serious" | "moderate" | "minor";

const META: Record<Severity, { label: string; Icon: LucideIcon; cls: string }> = {
  critical: { label: "Critical", Icon: AlertOctagon, cls: "text-critical" },
  serious: { label: "Serious", Icon: AlertTriangle, cls: "text-serious" },
  moderate: { label: "Moderate", Icon: AlertCircle, cls: "text-moderate" },
  minor: { label: "Minor", Icon: Info, cls: "text-minor" },
};

/** a11y: severity is never colour-only: always icon + text label. */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const { label, Icon, cls } = META[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip border bg-surface px-2 py-0.5 text-xs font-medium",
        cls,
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}
