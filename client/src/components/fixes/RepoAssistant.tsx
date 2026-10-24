import { Bot, CheckCircle2, Github, Send, Sparkles, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import type { Scan } from "@/lib/types";
import { ruleTitle } from "@/lib/wcag";

import type { Row } from "./model";

type Message = { id: number; role: "assistant" | "user"; text: string };

function buildAnswer(prompt: string, scan: Scan, rows: Row[], selectedRow: Row | null): string {
  const query = prompt.toLowerCase();
  const validated = rows.filter((row) => row.fix?.validated).length;
  const needsReview = rows.filter((row) => row.status === "needs-review").length;
  const critical = rows.filter((row) => row.issue.impact === "critical").length;
  const repo = scan.repo ?? "this repository";

  if (query.includes("summary") || query.includes("overview") || query.includes("scan")) {
    return `I reviewed ${repo}. The scan found ${rows.length} issue${rows.length === 1 ? "" : "s"}: ${validated} validated fix${validated === 1 ? "" : "es"} and ${needsReview} needing human review${needsReview === 1 ? "" : "s"}. ${critical ? `${critical} critical issue${critical === 1 ? "" : "s"} should be checked first.` : "No critical issues were reported."}`;
  }

  if (query.includes("priority") || query.includes("first") || query.includes("important")) {
    const first = rows.find((row) => row.issue.impact === "critical" || row.issue.impact === "serious");
    return first
      ? `Start with “${ruleTitle(first.issue.rule_id)}” (${first.issue.impact}). Confirm the affected selector and whether the proposed change matches the page intent before including it.`
      : "Start with fixes marked Needs review, then check the highest-severity validated fixes. A validated result means axe-core found no new violation; it does not replace a human review of behavior or content.";
  }

  if (query.includes("explain") || query.includes("selected") || query.includes("fix")) {
    if (!selectedRow) return "Select an issue on the left and I’ll explain its WCAG rule, proposed change, and review risks.";
    const fix = selectedRow.fix;
    return `This is “${ruleTitle(selectedRow.issue.rule_id)}” for ${selectedRow.issue.selector}. ${fix ? `${fix.explanation} The change is ${fix.validated ? "validated by axe-core" : "not validated"}; compare the diff with the surrounding markup before accepting it.` : "No automatic fix was proposed, so this needs a manual code review."}`;
  }

  if (query.includes("checklist") || query.includes("ready") || query.includes("pr")) {
    return `Before opening a PR for ${repo}: review every included diff, confirm the affected page still works with keyboard and assistive technology, check that content and labels remain accurate, then include only validated fixes. The PR will be opened on a new branch and nothing is merged automatically.`;
  }

  return "I can summarize this scan, identify what to review first, explain the selected fix, or prepare a pull-request checklist. Ask me about one of those options.";
}

export function RepoAssistant({
  scan,
  rows,
  selectedRow,
}: {
  scan: Scan;
  rows: Row[];
  selectedRow: Row | null;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const repoName = useMemo(() => scan.repo ?? "GitHub repository", [scan.repo]);

  const ask = (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: "user", text },
      { id: Date.now() + 1, role: "assistant", text: buildAnswer(text, scan, rows, selectedRow) },
    ]);
    setInput("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    ask(input);
  };

  return (
    <div className="fixed bottom-20 right-4 z-40 sm:bottom-6 sm:right-6">
      {open && (
        <section
          aria-label="Repository AI assistant"
          className="mb-3 flex h-[min(34rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-surface shadow-2xl"
        >
          <header className="flex items-center justify-between border-b bg-surface-2 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-brand-fg">
                <Sparkles aria-hidden className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">Repo AI assistant</h2>
                <p className="flex items-center gap-1 truncate text-xs text-muted">
                  <Github aria-hidden className="size-3" /> {repoName}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Close repository AI assistant"
              onClick={() => setOpen(false)}
              className="rounded-md p-2 text-muted hover:bg-surface hover:text-text"
            >
              <X aria-hidden className="size-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {messages.length === 0 && (
              <div className="rounded-xl border bg-surface-2 p-3 text-muted">
                <p className="font-medium text-text">Review helper</p>
                <p className="mt-1">I can help you understand this scan before you decide what belongs in the PR.</p>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={message.role === "user" ? "ml-8 rounded-xl bg-brand p-3 text-brand-fg" : "mr-4 rounded-xl border bg-surface-2 p-3"}
              >
                {message.text}
              </div>
            ))}
          </div>

          <div className="border-t p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {["Summarize this scan", "What should I review first?", "Explain the selected fix", "PR checklist"].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => ask(prompt)}
                  className="rounded-full border px-2.5 py-1 text-xs text-muted hover:border-brand hover:text-text"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <form onSubmit={submit} className="flex gap-2">
              <label className="sr-only" htmlFor="repo-assistant-input">Ask the repository assistant</label>
              <input
                id="repo-assistant-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about this review…"
                className="min-w-0 flex-1 rounded-md border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="submit"
                aria-label="Send question"
                disabled={!input.trim()}
                className="grid size-10 shrink-0 place-items-center rounded-md bg-brand text-brand-fg disabled:opacity-50"
              >
                <Send aria-hidden className="size-4" />
              </button>
            </form>
            <p className="mt-2 text-[11px] text-muted">Guidance is based on this scan. Always review the diff before opening a PR.</p>
          </div>
        </section>
      )}

      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Close repository AI assistant" : "Open repository AI assistant"}
        onClick={() => setOpen((value) => !value)}
        className="ml-auto flex min-h-12 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-brand-fg shadow-lg shadow-brand/30 transition hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? <CheckCircle2 aria-hidden className="size-4" /> : <Bot aria-hidden className="size-5" />}
        {open ? "Close assistant" : "Repo AI assistant"}
      </button>
    </div>
  );
}
