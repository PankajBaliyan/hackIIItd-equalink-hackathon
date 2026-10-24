import type { LucideIcon } from "lucide-react";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { Chip } from "@/components/ui/chip";

/** Polished P2 empty state: what the feature will do, with no logic behind it. */
export function ComingSoon({
  icon: Icon,
  title,
  summary,
  points,
}: {
  icon: LucideIcon;
  title: string;
  summary: string;
  points: string[];
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8 text-center">
      <span
        aria-hidden
        className="mx-auto grid size-14 place-items-center rounded-card border bg-surface text-brand"
      >
        <Icon className="size-7" />
      </span>
      <div className="space-y-2">
        <Chip>Coming soon</Chip>
        <FocusHeading className="text-3xl font-semibold outline-none">{title}</FocusHeading>
        <p className="text-muted">{summary}</p>
      </div>
      <ul className="space-y-2 rounded-card border bg-surface p-5 text-left text-sm">
        {points.map((p) => (
          <li key={p} className="flex gap-2">
            <span aria-hidden className="text-success">
              ✓
            </span>
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
