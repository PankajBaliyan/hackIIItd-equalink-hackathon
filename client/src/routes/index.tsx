import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "New Scan · EquaLink" },
      { name: "description", content: "EquaLink New Scan — autonomous accessibility agent." },
      { property: "og:title", content: "New Scan · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink New Scan — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("New Scan")} />;
}
