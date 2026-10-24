import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** The score is earned: `npm run test:e2e` runs axe-core on every route in both themes and fails on any violation. */
export function A11yBadge() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="hidden min-h-8 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-xs font-medium hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
        >
          <ShieldCheck aria-hidden className="size-3.5 text-success" />
          Accessibility of this dashboard: <span className="tabular">100</span>
          <span className="sr-only"> (how this is measured)</span>
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scanned by EquaLink itself</DialogTitle>
          <DialogDescription>
            We run axe-core against every page of this dashboard, in both light and dark themes, and
            the build fails on any violation.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted">
          Automated checks catch roughly a third to half of WCAG issues, so we also test keyboard
          use, focus order and reduced motion by hand. Run it yourself with{" "}
          <code className="font-mono">npm run test:e2e</code>.
        </p>
        <Button variant="secondary" asChild>
          <a
            href="https://www.w3.org/WAI/WCAG22/quickref/"
            target="_blank"
            rel="noopener noreferrer"
          >
            WCAG 2.2 quick reference<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
