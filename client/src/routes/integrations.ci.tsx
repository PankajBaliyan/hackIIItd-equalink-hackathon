import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/integrations/ci")({
  head: () => ({
    meta: [
      { title: "CI / GitHub Action · EquaLink" },
      {
        name: "description",
        content: "EquaLink CI / GitHub Action — autonomous accessibility agent.",
      },
      { property: "og:title", content: "CI / GitHub Action · EquaLink" },
      {
        property: "og:description",
        content: "EquaLink CI / GitHub Action — autonomous accessibility agent.",
      },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("CI / GitHub Action")} />;
}
