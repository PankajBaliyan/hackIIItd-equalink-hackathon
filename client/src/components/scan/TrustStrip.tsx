import { GitPullRequest, ShieldCheck } from "lucide-react";

import { Chip } from "@/components/ui/chip";

const STANDARDS = ["WCAG 2.2", "EAA", "ADA", "GIGW"];

export function TrustStrip() {
  return (
    <section aria-labelledby="trust-title" className="space-y-3">
      <h2 id="trust-title" className="sr-only">
        Why you can trust the fixes
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        <li className="flex items-start gap-3 rounded-card border bg-surface p-4">
          <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          <p className="text-sm">
            <strong className="font-medium">Rules engine validated.</strong>{" "}
            <span className="text-muted">
              The LLM never decides alone. axe-core re-checks every fix.
            </span>
          </p>
        </li>
        <li className="flex items-start gap-3 rounded-card border bg-surface p-4">
          <GitPullRequest aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
          <p className="text-sm">
            <strong className="font-medium">Every fix is a PR, never a direct commit.</strong>{" "}
            <span className="text-muted">Humans review and merge.</span>
          </p>
        </li>
      </ul>
      <ul aria-label="Standards covered" className="flex flex-wrap gap-2">
        {STANDARDS.map((s) => (
          <li key={s}>
            <Chip className="px-3 py-1 text-sm">{s}</Chip>
          </li>
        ))}
      </ul>
    </section>
  );
}
