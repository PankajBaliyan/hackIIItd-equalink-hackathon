export type Severity = "critical" | "serious" | "moderate" | "minor";
export type Stage =
  "queued" | "crawling" | "diagnosing" | "fixing" | "verifying" | "shipping" | "done" | "failed";

export interface Scan {
  id: string;
  url: string;
  mode: "url" | "repo";
  level: "A" | "AA" | "AAA";
  scope: "page" | "site";
  status: Stage;
  score_before?: number;
  score_after?: number;
  created_at: string;
  repo?: string | null;
  is_demo?: boolean;
  validation_engine?: "axe-core";
}

export interface Issue {
  id: string;
  scan_id: string;
  page_url: string;
  rule_id: string;
  wcag_sc: string;
  impact: Severity;
  selector: string;
  html: string;
  context?: string;
  source_file?: string;
  source_line?: number;
}

export interface Fix {
  id: string;
  issue_id: string;
  strategy: "rule" | "llm";
  original: string;
  patched: string;
  explanation: string;
  confidence: number;
  validated: boolean;
  violations_before: number;
  violations_after: number;
  rejected_reason?: string;
  included?: boolean;
}

export interface PullRequest {
  scan_id: string;
  repo: string;
  branch: string;
  number: number;
  url: string;
  fixes: string[];
}

export interface ScanEvent {
  stage: Stage;
  message: string;
  counters?: Record<Severity, number>;
  issue?: Issue;
  type: "info" | "issue" | "fix" | "validated" | "rejected";
  ts: string;
}

/** Request body for POST /scans. */
export interface CreateScanInput {
  url: string;
  repo?: string;
  level: Scan["level"];
  scope: Scan["scope"];
  auto_ship?: boolean;
}

/** Response of GET /scans/:id. */
export interface ScanDetail {
  scan: Scan;
  issues: Issue[];
  fixes: Fix[];
  pr?: PullRequest;
  summary?: { accepted: number; rejected: number; review: number; included: number };
}

export type ConnectionState = "connecting" | "live" | "reconnecting" | "polling" | "closed";

export interface GithubRepo {
  full_name: string;
  /** Whether EquaLink may open PRs on this repo. */
  enabled: boolean;
}

export interface GithubStatus {
  connected: boolean;
  account?: string;
  repos: GithubRepo[];
  /** Server auth mode: a GitHub App, a personal access token, or not configured. */
  mode?: "app" | "oauth" | "pat" | "none";
  /** When set, the user must finish connecting on GitHub (App install). */
  install_url?: string;
}

export interface PullSummary {
  repo: string;
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  author: string;
  head: string;
  base: string;
  url: string;
  created_at: string;
  updated_at: string;
  body: string;
}

export interface BranchList {
  default: string;
  branches: string[];
}

export interface CompareResult {
  ahead_by: number;
  behind_by: number;
  status: string;
  commits: { sha: string; message: string }[];
  files: { filename: string; status: string; additions: number; deletions: number }[];
}

export interface NewPull {
  repo: string;
  base: string;
  head: string;
  title: string;
  body: string;
  draft: boolean;
}

export interface RepoFiles {
  repo: string;
  branch: string;
  files: string[];
}

/** Everything the UI needs from the backend; implemented by the real client and the mock. */
export interface ScanApi {
  createScan(input: CreateScanInput): Promise<Scan>;
  listScans(): Promise<Scan[]>;
  getScan(id: string): Promise<ScanDetail>;
  importScan(payload: unknown): Promise<ScanDetail>;
  /** HTML files in a connected repository that can be scanned. */
  listRepoFiles(repo: string): Promise<RepoFiles>;
  /** Read a repository file, find accessibility issues and build validated fixes. */
  scanRepo(repo: string, path?: string): Promise<ScanDetail>;
  setFixIncluded(id: string, fixId: string, included: boolean): Promise<ScanDetail>;
  listPullRequests(): Promise<PullRequest[]>;
  /** Pull requests on GitHub for one enabled repo, or all enabled repos. */
  listGithubPulls(state: "open" | "closed" | "all", repo?: string): Promise<PullSummary[]>;
  listBranches(repo: string): Promise<BranchList>;
  compareBranches(repo: string, base: string, head: string): Promise<CompareResult>;
  createPull(input: NewPull): Promise<PullSummary>;
  ship(id: string, fixIds?: string[]): Promise<PullRequest>;
  getGithub(): Promise<GithubStatus>;
  connectGithub(): Promise<GithubStatus>;
  connectGithubToken(token: string): Promise<GithubStatus>;
  disconnectGithub(): Promise<GithubStatus>;
  setGithubRepo(fullName: string, enabled: boolean): Promise<GithubStatus>;
  /** Streams events until the scan finishes; returns an unsubscribe function. */
  subscribe(
    id: string,
    onEvent: (e: ScanEvent) => void,
    onConnection?: (s: ConnectionState) => void,
  ): () => void;
}

/** A tracked website, stored by the server. */
export interface Site {
  id: number;
  url: string;
  host: string;
  repo: string | null;
  created_at: string;
}

/** A reference document (e.g. a W3C rule page), stored by the server. */
export interface RuleDoc {
  id: number;
  title: string;
  /** One URL, or several separated by ", ". */
  source_url: string | null;
  content: string;
  /** "manual" or "w3c-sync". */
  origin: string;
  created_at: string;
}

/** Outcome of the latest W3C rules sync, and whether the next one is scheduled. */
export interface RuleSyncStatus {
  configured: boolean;
  scheduled: boolean;
  status: "running" | "done" | "failed" | null;
  trigger: "schedule" | "manual" | null;
  received: number;
  added: number;
  skipped: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  next_run_at: string | null;
}
