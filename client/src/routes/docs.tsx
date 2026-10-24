import { createFileRoute } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { ComingSoon } from "@/components/ui/coming-soon";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Docs · EquaLink" },
      { name: "description", content: "EquaLink Docs — autonomous accessibility agent." },
      { property: "og:title", content: "Docs · EquaLink" },
      { property: "og:description", content: "EquaLink Docs — autonomous accessibility agent." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ComingSoon
      icon={BookOpen}
      title="Docs"
      summary="Guides and reference for running EquaLink."
      points={[
        "Quick start: scan, review and ship your first fix",
        "How validation works and why the LLM never decides alone",
        "API reference for the scan endpoints",
      ]}
    />
  );
}
