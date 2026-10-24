import { createFileRoute } from "@tanstack/react-router";

import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { CodeBlock } from "@/components/ui/code-block";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Docs · EquaLink" },
      {
        name: "description",
        content: "How EquaLink scans, fixes, validates and ships accessibility fixes.",
      },
      { property: "og:title", content: "Docs · EquaLink" },
      {
        property: "og:description",
        content: "How EquaLink scans, fixes, validates and ships accessibility fixes.",
      },
    ],
  }),
  component: Page,
});

const SECTIONS = [
  ["quickstart", "Quick start"],
  ["validation", "How validation works"],
  ["fixers", "Fix types"],
  ["api", "API reference"],
  ["env", "Environment variables"],
  ["limits", "What automation can't catch"],
] as const;

const ENDPOINTS = [
  ["POST", "/scans", "Start a scan. Body: url, repo?, level, scope."],
  ["GET", "/scans", "List scans."],
  ["GET", "/scans/{id}", "Scan state: issues, fixes, score, PR."],
  ["GET", "/scans/{id}/events", "Server-Sent Events stream of progress."],
  ["POST", "/scans/{id}/ship", "Open a PR from validated fixes."],
] as const;

const FIXERS = [
  ["div onclick → button", "WCAG 4.1.2, 2.1.1", "Rule + LLM for the label"],
  ["Missing alt text", "WCAG 1.1.1", "Vision LLM decides decorative vs informative"],
  ["Low contrast", "WCAG 1.4.3", "Algorithmic: shift lightness until 4.5:1, hue preserved"],
  ["Input without label", "WCAG 1.3.1, 3.3.2", "Rule + LLM naming"],
  ["Focus trap in modal", "WCAG 2.1.2", "Template adapted to your framework"],
] as const;

const ENV = [
  ["VITE_USE_MOCKS", "true runs the dashboard on built-in mock data"],
  ["VITE_API_BASE_URL", "Backend base URL, default http://localhost:8000"],
  ["TINYFISH_API_KEY", "Backend: TinyFish Fetch, Agent and Search"],
  ["ANTHROPIC_API_KEY", "Backend: Claude for diagnosis and fixes"],
  ["GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET", "Backend: GitHub App"],
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-20 space-y-3">
      <h2 id={`${id}-h`} className="text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className="overflow-x-auto rounded-card border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface text-muted">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.join("|")} className="border-t">
              {r.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="px-3 py-2 text-left font-mono font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="px-3 py-2">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Page() {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="On this page" className="lg:sticky lg:top-20 lg:self-start">
        <p className="mb-2 text-sm font-medium text-muted">On this page</p>
        <ul className="space-y-1 text-sm">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="block min-h-11 rounded-md px-2 py-2.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8 lg:py-1.5"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-10">
        <header className="space-y-2">
          <FocusHeading className="text-4xl font-semibold outline-none">Docs</FocusHeading>
          <p className="text-lg text-muted">
            Scan, diagnose, fix, verify, then open a pull request. This is how each step works.
          </p>
        </header>

        <Section id="quickstart" title="Quick start">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              On <strong>New Scan</strong>, paste a URL, pick a WCAG level, and optionally connect a
              repo as <code className="font-mono">owner/repo</code>.
            </li>
            <li>
              Watch the <strong>Live Scan</strong> feed as the agent renders pages, opens modals and
              tabs through the keyboard.
            </li>
            <li>
              Open <strong>Fixes</strong>, review each diff, untick any you don't want.
            </li>
            <li>
              Click <strong>Open PR</strong>. Humans review and merge; nothing is committed
              directly.
            </li>
          </ol>
        </Section>

        <Section id="validation" title="How validation works">
          <p>The LLM never decides alone. Every proposed fix goes through the same gate:</p>
          <CodeBlock
            label="validation rule"
            code={`patched = apply(fix, original)\nbefore  = axe(original)   # violations for this node and rule\nafter   = axe(patched)\naccept iff after < before AND no new violations are introduced\notherwise: one retry with the failure reason, else "needs review"`}
          />
          <p>Rejected fixes are shown in the UI with the reason, and are never shipped.</p>
        </Section>

        <Section id="fixers" title="Fix types">
          <Table head={["Issue", "Criteria", "Strategy"]} rows={FIXERS} />
        </Section>

        <Section id="api" title="API reference">
          <Table head={["Method", "Route", "Purpose"]} rows={ENDPOINTS} />
          <p className="text-sm text-muted">
            Each SSE event has <code className="font-mono">stage</code>,{" "}
            <code className="font-mono">message</code>, <code className="font-mono">type</code> and
            an optional <code className="font-mono">counters</code> and{" "}
            <code className="font-mono">issue</code>.
          </p>
        </Section>

        <Section id="env" title="Environment variables">
          <Table head={["Variable", "Purpose"]} rows={ENV} />
        </Section>

        <Section id="limits" title="What automation can't catch">
          <p>
            Automated tools cover roughly a third to half of WCAG issues. EquaLink targets the
            deterministic and context-checkable ones and flags the rest for human review. Keep doing
            manual keyboard and screen reader testing.
          </p>
        </Section>
      </div>
    </div>
  );
}
