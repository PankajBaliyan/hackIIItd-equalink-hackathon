import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Moon,
  Sun,
  Github,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getApi } from "@/lib/api";
import { useGithub } from "@/lib/useGithub";
import { A11yBadge } from "@/components/shell/A11yBadge";
import { navGroups, allNavItems } from "@/lib/nav";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "equalink-sidebar-collapsed";

function Logo({ compact }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      className="flex items-center gap-2.5 rounded-md px-1 py-1"
      aria-label="EquaLink home"
    >
      <span
        aria-hidden
        className="grid size-8 place-items-center rounded-[9px] bg-brand-gradient font-mono text-sm font-semibold text-brand-fg shadow-soft"
      >
        =
      </span>
      {!compact && <span className="text-[15px] font-semibold tracking-tight">EquaLink</span>}
    </Link>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  // Live Scan and Fixes point at the most recent scan
  const { data: scans } = useQuery({
    queryKey: ["scans"],
    queryFn: async () => (await getApi()).listScans(),
  });
  const latestId = scans?.[0]?.id;
  return (
    <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-2">
      {navGroups.map((g) => (
        <div key={g.label} className="mb-5">
          <h2
            className={cn(
              "mb-1.5 px-2 text-xs font-medium uppercase tracking-wider text-muted",
              collapsed && "sr-only",
            )}
          >
            {g.label}
          </h2>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    params={(item.params && latestId ? { id: latestId } : item.params) as never}
                    onClick={onNavigate}
                    activeOptions={{ exact: true }}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group flex min-h-11 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text lg:min-h-9",
                      "data-[status=active]:bg-surface-2 data-[status=active]:text-text",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    <Icon
                      aria-hidden
                      className="size-[18px] shrink-0 group-data-[status=active]:text-brand-2"
                    />
                    <span className={cn("flex-1 truncate", collapsed && "sr-only")}>
                      {item.label}
                    </span>
                    {item.soon && !collapsed && (
                      <span className="rounded-full border px-1.5 py-px text-[11px] font-medium text-muted">
                        Soon
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      className="grid size-11 place-items-center rounded-md border bg-surface text-muted transition-colors duration-fast hover:bg-surface-2 hover:text-text lg:size-9"
    >
      {theme === "dark" ? (
        <Sun aria-hidden className="size-4" />
      ) : (
        <Moon aria-hidden className="size-4" />
      )}
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { data: gh } = useGithub();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const title =
    allNavItems.find((i) => {
      if (i.to === "/") return pathname === "/";
      const pattern = new RegExp("^" + i.to.replace(/\$[a-z]+/gi, "[^/]+") + "/?$");
      return pattern.test(pathname);
    })?.label ?? (pathname.startsWith("/_design") ? "Design system" : "EquaLink");

  return (
    <div className="flex min-h-screen">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <aside
        aria-label="Sidebar"
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-surface/80 backdrop-blur transition-[width] duration-base ease-out lg:flex",
          collapsed ? "w-[72px]" : "w-[260px]",
        )}
      >
        <div
          className={cn("flex h-14 items-center border-b px-4", collapsed && "justify-center px-0")}
        >
          <Logo compact={collapsed} />
        </div>
        <NavList collapsed={collapsed} />
        <div className={cn("border-t p-3", collapsed && "flex justify-center")}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden className="size-4" />
            ) : (
              <PanelLeftClose aria-hidden className="size-4" />
            )}
            {!collapsed && "Collapse"}
          </button>
        </div>
      </aside>

      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col border-r bg-surface shadow-soft data-[state=open]:animate-in data-[state=open]:slide-in-from-left lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Description className="sr-only">Main navigation menu</Dialog.Description>
            <div className="flex h-14 items-center justify-between border-b px-4">
              <Logo />
              <Dialog.Close
                aria-label="Close navigation"
                className="grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
              >
                <X aria-hidden className="size-5" />
              </Dialog.Close>
            </div>
            <NavList onNavigate={() => setDrawer(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-bg/75 px-4 backdrop-blur md:px-6">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open navigation"
            className="-ml-2 grid size-11 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text lg:hidden"
          >
            <Menu aria-hidden className="size-5" />
          </button>
          <p className="truncate text-sm font-medium" aria-live="polite">
            {title}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <A11yBadge />
            <Link
              to="/integrations/github"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-xs font-medium text-muted hover:text-text lg:min-h-8"
            >
              <Github aria-hidden className="size-3.5" />
              <span className="hidden md:inline">GitHub:</span>{" "}
              {gh?.connected ? gh.account : "Not connected"}
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-8 outline-none md:px-6 md:py-12"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
