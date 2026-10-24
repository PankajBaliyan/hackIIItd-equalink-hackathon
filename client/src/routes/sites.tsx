import { createFileRoute } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { ComingSoon } from "@/components/ui/coming-soon";

export const Route = createFileRoute("/sites")({
  head: () => ({
    meta: [
      { title: "Sites · EquaLink" },
      { name: "description", content: "EquaLink Sites — autonomous accessibility agent." },
      { property: "og:title", content: "Sites · EquaLink" },
      { property: "og:description", content: "EquaLink Sites — autonomous accessibility agent." },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <ComingSoon
      icon={Globe}
      title="Sites"
      summary="Track every site you scan in one multi-site dashboard."
      points={[
        "Score trend per site over time",
        "Incremental scans of only the routes that changed",
        "Agency view across client sites",
      ]}
    />
  );
}
