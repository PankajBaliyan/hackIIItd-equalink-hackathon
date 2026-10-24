import * as React from "react";

import { cn } from "@/lib/utils";

/** a11y: purely presentational text chip; use a button/link wrapper if it must be interactive. */
export function Chip({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted",
        className,
      )}
      {...props}
    />
  );
}
