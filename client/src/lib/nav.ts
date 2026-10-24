import {
  ScanSearch,
  Activity,
  Wrench,
  GitPullRequest,
  History,
  FileBarChart,
  Globe,
  Github,
  Workflow,
  Settings,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

export type Tier = "P0" | "P1" | "P2";

export interface NavItem {
  label: string;
  to: string;
  params?: Record<string, string>;
  icon: LucideIcon;
  phase: string;
  tier: Tier;
  soon?: boolean;
  description: string;
}

export const DEMO_SCAN_ID = "demo";

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      {
        label: "New Scan",
        to: "/",
        icon: ScanSearch,
        phase: "Phase 4",
        tier: "P0",
        description:
          "Point EquaLink at a URL or repository and start an autonomous accessibility scan.",
      },
      {
        label: "Live Scan",
        to: "/scans/$id",
        params: { id: DEMO_SCAN_ID },
        icon: Activity,
        phase: "Phase 5",
        tier: "P0",
        description: "Watch the agent scan, diagnose and stream findings in real time.",
      },
      {
        label: "Fixes",
        to: "/scans/$id/fixes",
        params: { id: DEMO_SCAN_ID },
        icon: Wrench,
        phase: "Phase 6–7",
        tier: "P0",
        description: "Review AI-proposed fixes, each re-validated by axe-core before shipping.",
      },
      {
        label: "Pull Requests",
        to: "/pull-requests",
        icon: GitPullRequest,
        phase: "Phase 7",
        tier: "P0",
        description: "Track the GitHub pull requests EquaLink opened with verified fixes.",
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        label: "Scan History",
        to: "/history",
        icon: History,
        phase: "Phase 8",
        tier: "P0",
        description: "Browse past scans and how your accessibility score changed over time.",
      },
      {
        label: "Reports",
        to: "/reports",
        icon: FileBarChart,
        phase: "Later",
        tier: "P1",
        description: "Export compliance reports for WCAG 2.2 AA audits.",
      },
      {
        label: "Sites",
        to: "/sites",
        icon: Globe,
        phase: "Phase 8",
        tier: "P1",
        description: "Manage the sites and environments EquaLink monitors.",
      },
    ],
  },
  {
    label: "Integrations",
    items: [
      {
        label: "GitHub",
        to: "/integrations/github",
        icon: Github,
        phase: "Later",
        tier: "P0",
        description: "Connect a GitHub account so EquaLink can open pull requests.",
      },
      {
        label: "CI / GitHub Action",
        to: "/integrations/ci",
        icon: Workflow,
        phase: "Later",
        tier: "P1",
        description: "Block regressions by running EquaLink in your CI pipeline.",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Settings",
        to: "/settings",
        icon: Settings,
        phase: "Phase 8",
        tier: "P1",
        description: "Configure rules, severity thresholds and agent behaviour.",
      },
      {
        label: "Docs",
        to: "/docs",
        icon: BookOpen,
        phase: "Later",
        tier: "P1",
        description: "Guides and reference for running EquaLink.",
      },
    ],
  },
];

export const allNavItems = navGroups.flatMap((g) => g.items);
export const navItem = (label: string) => allNavItems.find((i) => i.label === label)!;
