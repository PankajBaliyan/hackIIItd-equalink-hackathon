import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

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
  return <PagePlaceholder item={navItem("Docs")} />;
}
