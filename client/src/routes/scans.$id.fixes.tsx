import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/scans/$id/fixes")({
  head: () => ({
    meta: [
      { title: "Fixes · EquaLink" },
      { name: "description", content: "EquaLink Fixes — autonomous accessibility agent." },
      { property: "og:title", content: "Fixes · EquaLink" },
      { property: "og:description", content: "EquaLink Fixes — autonomous accessibility agent." },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("Fixes")} />;
}
