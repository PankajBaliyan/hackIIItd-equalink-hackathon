import { createFileRoute } from "@tanstack/react-router";
import { PagePlaceholder } from "@/components/shell/PagePlaceholder";
import { navItem } from "@/lib/nav";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports · EquaLink" },
      { name: "description", content: "EquaLink Reports — autonomous accessibility agent." },
      { property: "og:title", content: "Reports · EquaLink" },
      { property: "og:description", content: "EquaLink Reports — autonomous accessibility agent." },
    ],
  }),
  component: Page,
});

function Page() {
  return <PagePlaceholder item={navItem("Reports")} />;
}
