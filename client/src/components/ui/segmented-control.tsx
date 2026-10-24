import * as React from "react";
import * as RadioGroup from "@radix-ui/react-radio-group";

import { cn } from "@/lib/utils";

/** a11y: radio-group semantics (arrow keys move + select, one tab stop), visible group label. */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (v: T) => void;
  className?: string;
}) {
  const id = React.useId();
  return (
    <div className={cn("space-y-1.5", className)}>
      <span id={id} className="text-sm font-medium">
        {label}
      </span>
      <RadioGroup.Root
        aria-labelledby={id}
        value={value}
        onValueChange={(v) => onValueChange(v as T)}
        orientation="horizontal"
        className="inline-flex w-full rounded-md border bg-surface p-1 sm:w-auto"
      >
        {options.map((o) => (
          <RadioGroup.Item
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className="min-h-11 flex-1 cursor-pointer rounded-chip px-4 text-sm font-medium text-muted transition-colors duration-fast hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-brand data-[state=checked]:text-brand-fg sm:min-h-8 sm:flex-none"
          >
            {o.label}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
