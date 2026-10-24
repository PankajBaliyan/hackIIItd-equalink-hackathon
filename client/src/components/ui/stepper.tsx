import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Step {
  id: string;
  label: string;
}

/** a11y: ordered list; current step has aria-current="step"; state is also spelled out in sr-only text. */
export function Stepper({
  steps,
  current,
  failed,
  className,
}: {
  steps: Step[];
  /** Index of the active step; steps before it are complete. Use steps.length when all are done. */
  current: number;
  failed?: boolean;
  className?: string;
}) {
  return (
    <ol
      aria-label="Progress"
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-3", className)}
    >
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const bad = active && failed;
        return (
          <li
            key={s.id}
            aria-current={active ? "step" : undefined}
            className="flex items-center gap-2"
          >
            <span
              aria-hidden
              className={cn(
                "grid size-7 place-items-center rounded-full border text-xs font-semibold tabular",
                done && "border-success bg-success text-bg",
                active && !bad && "border-brand text-brand",
                bad && "border-critical text-critical",
              )}
            >
              {done ? (
                <Check className="size-4" />
              ) : bad ? (
                <X className="size-4" />
              ) : active ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                i + 1
              )}
            </span>
            <span className={cn("text-sm", active ? "font-medium" : "text-muted")}>
              {s.label}
              <span className="sr-only">
                {done
                  ? " (complete)"
                  : bad
                    ? " (failed)"
                    : active
                      ? " (in progress)"
                      : " (pending)"}
              </span>
            </span>
            {i < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
