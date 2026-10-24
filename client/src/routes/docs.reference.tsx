import { createFileRoute } from "@tanstack/react-router";

import { RuleDocs } from "@/components/guide/RuleDocs";
import { DocHeader } from "@/components/guide/parts";

export const Route = createFileRoute("/docs/reference")({
  head: () => ({
    meta: [
      { title: "Reference documents · EquaLink" },
      {
        name: "description",
        content: "Rule documents such as W3C and WCAG pages, stored for EquaLink.",
      },
      { property: "og:title", content: "Reference documents · EquaLink" },
      {
        property: "og:description",
        content: "Rule documents such as W3C and WCAG pages, stored for EquaLink.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <DocHeader
        title="Reference documents"
        intro="Rule documents, such as W3C and WCAG pages. New W3C rules are added automatically once a month."
      />
      <p>
        Add them by hand, import several files at once, or have an agent push a batch to{" "}
        <code className="font-mono">POST /rule-docs</code> (a single object or a list of{" "}
        <code className="font-mono">title</code>, <code className="font-mono">content</code>,{" "}
        <code className="font-mono">source_url?</code>).
      </p>
      <RuleDocs />
    </>
  );
}
