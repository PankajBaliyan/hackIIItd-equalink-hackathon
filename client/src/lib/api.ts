import { openEventStream } from "@/lib/sse";
import type {
  CreateScanInput,
  Scan,
  BranchList,
  CompareResult,
  NewPull,
  PullSummary,
  RepoFiles,
  ScanApi,
  ScanDetail,
  ScanEvent,
  PullRequest,
  GithubStatus,
  Site,
  RuleDoc,
  RuleSyncStatus,
} from "@/lib/types";

export const API_BASE_URL: string =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "http://localhost:8000";
/** GitHub calls hit the real backend even while scans are mocked. Set VITE_GITHUB_LIVE=false to mock them too. */
export const GITHUB_LIVE: boolean = import.meta.env["VITE_GITHUB_LIVE"] !== "false";
export const USE_MOCKS: boolean = import.meta.env["VITE_USE_MOCKS"] === "true";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the backend. Check that the FastAPI server is running.");
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const error = JSON.parse(text) as {
        detail?: unknown;
        errors?: { loc: unknown[]; msg: string }[];
      };
      if (typeof error.detail === "string") message = error.detail;
      if (error.errors?.length) {
        message += " " + error.errors.map((e) => `${e.loc.join(".")}: ${e.msg}`).join("; ");
      }
    } catch {
      /* Non-JSON error responses still have a useful fallback. */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const realApi: ScanApi = {
  createScan: (input: CreateScanInput) =>
    request<Scan>("/scans", { method: "POST", body: JSON.stringify(input) }),
  listScans: () => request<Scan[]>("/scans"),
  getScan: (id) => request<ScanDetail>(`/scans/${id}`),
  importScan: (payload) =>
    request<ScanDetail>("/scans/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listRepoFiles: (repo) => request<RepoFiles>(`/repo-files?repo=${encodeURIComponent(repo)}`),
  scanRepo: (repo, path) =>
    request<ScanDetail>("/scans/repo", {
      method: "POST",
      body: JSON.stringify({ repo, ...(path && { path }) }),
    }),
  setFixIncluded: (id, fixId, included) =>
    request<ScanDetail>(`/scans/${encodeURIComponent(id)}/fixes/${encodeURIComponent(fixId)}`, {
      method: "PATCH",
      body: JSON.stringify({ included }),
    }),
  listPullRequests: () => request<PullRequest[]>("/pull-requests"),
  ship: (id, fixIds) =>
    request<PullRequest>(`/scans/${id}/ship`, {
      method: "POST",
      body: JSON.stringify({ fix_ids: fixIds }),
    }),
  listGithubPulls: (state, repo) =>
    request<PullSummary[]>(
      `/integrations/github/pulls?state=${state}${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`,
    ),
  listBranches: (repo) =>
    request<BranchList>(`/integrations/github/branches?repo=${encodeURIComponent(repo)}`),
  compareBranches: (repo, base, head) =>
    request<CompareResult>(
      `/integrations/github/compare?repo=${encodeURIComponent(repo)}&base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`,
    ),
  createPull: (input) =>
    request<PullSummary>("/integrations/github/pulls", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getGithub: () => request<GithubStatus>("/integrations/github"),
  connectGithub: () => request<GithubStatus>("/integrations/github/connect", { method: "POST" }),
  connectGithubToken: (token) =>
    request<GithubStatus>("/integrations/github/token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  disconnectGithub: () => request<GithubStatus>("/integrations/github", { method: "DELETE" }),
  setGithubRepo: (fullName, enabled) =>
    request<GithubStatus>("/integrations/github/repos", {
      method: "PATCH",
      body: JSON.stringify({ full_name: fullName, enabled }),
    }),
  subscribe(id, onEvent, onConnection) {
    let lastStage = "";
    return openEventStream({
      url: `${API_BASE_URL}/scans/${id}/events`,
      onEvent,
      ...(onConnection && { onConnection }),
      // Polling fallback: synthesize one event whenever the scan status changes.
      poll: async () => {
        const { scan } = await realApi.getScan(id);
        if (scan.status === lastStage) return [];
        lastStage = scan.status;
        const e: ScanEvent = {
          stage: scan.status,
          message: `Stage: ${scan.status}`,
          type: "info",
          ts: new Date().toISOString(),
        };
        return [e];
      },
    });
  },
};

let cached: Promise<ScanApi> | undefined;

/** Picks the mock or real implementation from VITE_USE_MOCKS; mocks are code-split. */
export function getApi(): Promise<ScanApi> {
  cached ??= USE_MOCKS
    ? import("@/lib/mocks/mockApi").then((m) =>
        GITHUB_LIVE
          ? {
              ...m.mockApi,
              getGithub: realApi.getGithub,
              listGithubPulls: realApi.listGithubPulls,
              listBranches: realApi.listBranches,
              compareBranches: realApi.compareBranches,
              createPull: realApi.createPull,
              connectGithub: realApi.connectGithub,
              connectGithubToken: realApi.connectGithubToken,
              disconnectGithub: realApi.disconnectGithub,
              setGithubRepo: realApi.setGithubRepo,
            }
          : m.mockApi,
      )
    : Promise.resolve(realApi);
  return cached;
}

/** Sites always use the real server (there is no mock for them). */
export const sitesApi = {
  list: () => request<Site[]>("/sites"),
  create: (input: { url: string; repo?: string }) =>
    request<Site>("/sites", { method: "POST", body: JSON.stringify(input) }),
  async remove(id: number): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/sites/${id}`, { method: "DELETE" });
    if (!res.ok) throw new ApiError(res.status, "Couldn't remove the site.");
  },
};

export type RuleDocInput = { title: string; content: string; source_url?: string };

/** Reference documents always use the real server. POST takes a list so several can be added at once. */
export const ruleDocsApi = {
  list: () => request<RuleDoc[]>("/rule-docs"),
  create: (input: RuleDocInput[]) =>
    request<RuleDoc[]>("/rule-docs", { method: "POST", body: JSON.stringify(input) }),
  syncStatus: () => request<RuleSyncStatus>("/rule-docs/sync"),
  startSync: () => request<RuleSyncStatus>("/rule-docs/sync", { method: "POST" }),
  async remove(id: number): Promise<void> {
    const res = await fetch(`${API_BASE_URL}/rule-docs/${id}`, { method: "DELETE" });
    if (!res.ok) throw new ApiError(res.status, "Couldn't remove the document.");
  },
};
