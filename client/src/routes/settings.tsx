import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · EquaLink" },
      { name: "description", content: "EquaLink Settings — autonomous accessibility agent." },
      { property: "og:title", content: "Settings · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink Settings — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("Settings")} />;
}
