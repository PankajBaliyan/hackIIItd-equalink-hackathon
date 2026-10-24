import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Scan History · EquaLink" },
      { name: "description", content: "EquaLink Scan History — autonomous accessibility agent." },
      { property: "og:title", content: "Scan History · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink Scan History — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("Scan History")} />;
}
