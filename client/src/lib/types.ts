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

/** Everything the UI needs from the backend; implemented by the real client and the mock. */
export interface ScanApi {
  createScan(input: CreateScanInput): Promise<Scan>;
  listScans(): Promise<Scan[]>;
  getScan(id: string): Promise<ScanDetail>;
  ship(id: string, fixIds?: string[]): Promise<PullRequest>;
  getGithub(): Promise<GithubStatus>;
  connectGithub(): Promise<GithubStatus>;
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
