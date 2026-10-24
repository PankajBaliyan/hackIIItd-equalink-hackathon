import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
});

const PAGES = [
  { to: "/docs", label: "Guide", hint: "How EquaLink works", exact: true },
  { to: "/docs/api", label: "API & setup", hint: "Routes and env vars", exact: false },
  { to: "/docs/reference", label: "Reference documents", hint: "W3C and WCAG rules", exact: false },
] as const;

function DocsLayout() {
  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="Documentation" className="lg:sticky lg:top-20 lg:self-start">
        <p className="mb-2 text-sm font-medium text-muted">Documentation</p>
        <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1">
          {PAGES.map((p) => (
            <li key={p.to} className="shrink-0">
              <Link
                to={p.to}
                activeOptions={{ exact: p.exact }}
                className="block min-h-11 rounded-md border border-transparent px-3 py-2 text-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:border-border data-[status=active]:bg-surface-2 data-[status=active]:font-medium"
              >
                {p.label}
                <span className="hidden text-xs font-normal text-muted lg:block">{p.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 space-y-10">
        <Outlet />
      </div>
    </div>
  );
}
