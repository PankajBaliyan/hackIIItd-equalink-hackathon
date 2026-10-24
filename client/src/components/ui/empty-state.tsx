import * as React from "react";

import { cn } from "@/lib/utils";

/** a11y: heading level is configurable so it fits the page outline; icon is decorative. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  as: Heading = "h2",
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-dashed bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden
          className="grid size-12 place-items-center rounded-full bg-surface-2 text-muted"
        >
          {icon}
        </span>
      )}
      <Heading className="text-lg font-semibold">{title}</Heading>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}
