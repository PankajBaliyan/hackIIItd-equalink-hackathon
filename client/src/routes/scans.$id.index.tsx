import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/scans/$id/")({
  head: () => ({
    meta: [
      { title: "Live Scan · EquaLink" },
      { name: "description", content: "EquaLink Live Scan — autonomous accessibility agent." },
      { property: "og:title", content: "Live Scan · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink Live Scan — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("Live Scan")} />;
}
