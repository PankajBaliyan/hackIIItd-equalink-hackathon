import * as React from "react";

import { cn } from "@/lib/utils";

/** a11y: visible <label>, hint and error linked with aria-describedby, aria-invalid on error. */
export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}

const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, hint, error, id, className, ...props }, ref) => {
    const auto = React.useId();
    const fid = id ?? auto;
    const hintId = hint ? `${fid}-hint` : undefined;
    const errId = error ? `${fid}-err` : undefined;
    return (
      <div className="space-y-1.5">
        <label htmlFor={fid} className="text-sm font-medium">
          {label}
        </label>
        <input
          ref={ref}
          id={fid}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errId].filter(Boolean).join(" ") || undefined}
          className={cn(
            "min-h-11 w-full rounded-md border bg-surface px-3 text-base text-text placeholder:text-muted transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 sm:text-sm",
            error && "border-critical",
            className,
          )}
          {...props}
        />
        {hint && !error && (
          <p id={hintId} className="text-sm text-muted">
            {hint}
          </p>
        )}
        {error && (
          <p id={errId} className="flex items-center gap-1.5 text-sm text-critical">
            <span aria-hidden>✗</span> {error}
          </p>
        )}
      </div>
    );
  },
);
TextField.displayName = "TextField";

export { TextField };
