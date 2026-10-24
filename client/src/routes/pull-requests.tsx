import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/pull-requests")({
  head: () => ({
    meta: [
      { title: "Pull Requests · EquaLink" },
      { name: "description", content: "EquaLink Pull Requests — autonomous accessibility agent." },
      { property: "og:title", content: "Pull Requests · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink Pull Requests — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("Pull Requests")} />;
}
