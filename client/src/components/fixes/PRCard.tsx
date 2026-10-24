import { Check, Copy, ExternalLink, GitBranch, GitPullRequest } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import type { PullRequest } from "@/lib/types";

export function PRCard({ pr, files }: { pr: PullRequest; files?: string[] | undefined }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pr.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <article
      aria-label={`Pull request ${pr.number}`}
      className="space-y-3 rounded-card border border-success bg-surface p-4 shadow-soft"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <GitPullRequest aria-hidden className="size-5 text-success" />
          Pull request <span className="tabular">#{pr.number}</span>
        </h3>
        <div className="flex gap-2">
          <Chip>accessibility</Chip>
          <Chip>automated</Chip>
        </div>
      </header>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Repository</dt>
        <dd className="font-mono">{pr.repo}</dd>
        <dt className="text-muted">Branch</dt>
        <dd className="flex items-center gap-1.5 font-mono">
          <GitBranch aria-hidden className="size-3.5" />
          {pr.branch}
        </dd>
        <dt className="text-muted">Fixes</dt>
        <dd className="tabular">{pr.fixes.length}</dd>
        {files && (
          <>
            <dt className="text-muted">Files changed</dt>
            <dd>
              <ul className="font-mono">
                {files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" asChild>
          <a href={pr.url} target="_blank" rel="noopener noreferrer">
            View on GitHub <ExternalLink />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </article>
  );
}
