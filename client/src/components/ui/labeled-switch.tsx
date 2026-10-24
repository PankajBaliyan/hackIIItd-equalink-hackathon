import * as React from "react";

import { Switch } from "@/components/ui/switch";

/** a11y: Radix switch (role=switch, Space toggles) with a clickable visible label and description. */
export function LabeledSwitch({
  label,
  description,
  ...props
}: React.ComponentProps<typeof Switch> & { label: string; description?: string }) {
  const id = React.useId();
  return (
    <div className="flex min-h-11 items-start gap-3">
      <Switch id={id} aria-describedby={description ? `${id}-d` : undefined} {...props} />
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="text-sm text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
