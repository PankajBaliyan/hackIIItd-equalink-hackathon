import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** a11y: scrollable region is keyboard focusable and labelled; copy button announces its result. */
export function CodeBlock({
  code,
  label,
  filename,
}: {
  code: string;
  label: string;
  filename?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="overflow-hidden rounded-card border bg-bg">
      <div className="flex items-center justify-between gap-2 border-b bg-surface px-3 py-1">
        <span className="font-mono text-xs text-muted">{filename ?? label}</span>
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
          <span className="sr-only"> {label}</span>
        </Button>
      </div>
      <pre
        role="region"
        aria-label={label}
        tabIndex={0}
        className="overflow-x-auto p-4 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
