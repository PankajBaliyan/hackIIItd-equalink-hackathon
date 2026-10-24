import { createFileRoute } from "@tanstack/react-router";
import { GitPullRequest } from "lucide-react";

import { PRCard } from "@/components/fixes/PRCard";
import { FocusHeading } from "@/components/shell/PagePlaceholder";
import { EmptyState } from "@/components/ui/empty-state";
import { useScanStore } from "@/state/scanStore";

export const Route = createFileRoute("/pull-requests")({
  head: () => ({
    meta: [
      { title: "Pull Requests · EquaLink" },
      { name: "description", content: "Pull requests opened by EquaLink." },
      { property: "og:title", content: "Pull Requests · EquaLink" },
      { property: "og:description", content: "Pull requests opened by EquaLink." },
    ],
  }),
  component: Page,
});

function Page() {
  const { pullRequests } = useScanStore();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <FocusHeading className="text-3xl font-semibold outline-none">Pull Requests</FocusHeading>
      {pullRequests.length === 0 ? (
        <EmptyState
          icon={<GitPullRequest className="size-6" />}
          title="No pull requests yet"
          description="Review a scan's fixes and open a PR. It will show up here."
        />
      ) : (
        <ul className="space-y-4">
          {pullRequests.map((pr) => (
            <li key={pr.scan_id}>
              <PRCard pr={pr} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
