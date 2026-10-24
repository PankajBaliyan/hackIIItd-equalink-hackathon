import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

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
  return <PagePlaceholder item={navItem("Sites")} />;
}
