import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/integrations/github")({
  head: () => ({
    meta: [
      { title: "GitHub · EquaLink" },
      { name: "description", content: "EquaLink GitHub — autonomous accessibility agent." },
      { property: "og:title", content: "GitHub · EquaLink" },
      { property: "og:description", content: "EquaLink GitHub — autonomous accessibility agent." },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("GitHub")} />;
}
