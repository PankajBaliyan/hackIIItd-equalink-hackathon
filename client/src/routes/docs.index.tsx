import { createFileRoute } from "@tanstack/react-router";

import { DocHeader, PageToc, Section, Table } from "@/components/guide/parts";
import { CodeBlock } from "@/components/ui/code-block";

export const Route = createFileRoute("/docs/")({
  head: () => ({
    meta: [
      { title: "Guide · EquaLink" },
      {
        name: "description",
        content: "How EquaLink scans, fixes, validates and ships accessibility fixes.",
      },
      { property: "og:title", content: "Guide · EquaLink" },
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
  ["limits", "What automation can't catch"],
] as const;

const FIXERS = [
  ["div onclick → button", "WCAG 4.1.2, 2.1.1", "Rule + LLM for the label"],
  ["Missing alt text", "WCAG 1.1.1", "Vision LLM decides decorative vs informative"],
  ["Low contrast", "WCAG 1.4.3", "Algorithmic: shift lightness until 4.5:1, hue preserved"],
  ["Input without label", "WCAG 1.3.1, 3.3.2", "Rule + LLM naming"],
  ["Focus trap in modal", "WCAG 2.1.2", "Template adapted to your framework"],
] as const;

function Page() {
  return (
    <>
      <DocHeader
        title="Guide"
        intro="Scan, diagnose, fix, verify, then open a pull request. This is how each step works."
      />
      <PageToc sections={SECTIONS} />
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
            Click <strong>Open PR</strong>. Humans review and merge; nothing is committed directly.
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

      <Section id="limits" title="What automation can't catch">
        <p>
          Automated tools cover roughly a third to half of WCAG issues. EquaLink targets the
          deterministic and context-checkable ones and flags the rest for human review. Keep doing
          manual keyboard and screen reader testing.
        </p>
      </Section>
    </>
  );
}
