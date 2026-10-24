import { createFileRoute } from "@tanstack/react-router";
import { FileBarChart } from "lucide-react";
import { ComingSoon } from "@/components/ui/coming-soon";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · EquaLink" },
      { name: "description", content: "EquaLink Reports — autonomous accessibility agent." },
      { property: "og:title", content: "Reports · EquaLink" },
      { property: "og:description", content: "EquaLink Reports — autonomous accessibility agent." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ComingSoon
      icon={FileBarChart}
      title="Compliance reports"
      summary="Exportable WCAG 2.2 AA reports you can hand to auditors and legal teams."
      points={[
        "Export as PDF or JSON with every issue, fix and validation result",
        "Before and after scores with a full audit trail",
        "Mapped to WCAG 2.2, EAA, ADA and GIGW requirements",
      ]}
    />
  );
}
