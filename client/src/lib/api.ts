import { openEventStream } from "@/lib/sse";
import type {
  CreateScanInput,
  Scan,
  ScanApi,
  ScanDetail,
  ScanEvent,
  PullRequest,
  GithubStatus,
} from "@/lib/types";

export const API_BASE_URL: string =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined) ?? "http://localhost:8000";
/** GitHub calls hit the real backend even while scans are mocked. Set VITE_GITHUB_LIVE=false to mock them too. */
export const GITHUB_LIVE: boolean = import.meta.env["VITE_GITHUB_LIVE"] !== "false";
export const USE_MOCKS: boolean = import.meta.env["VITE_USE_MOCKS"] !== "false";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body || res.statusText;
    try {
      const detail = (JSON.parse(body) as { detail?: unknown }).detail;
      if (typeof detail === "string") message = detail;
    } catch {
      /* not JSON */
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
  ship: (id, fixIds) =>
    request<PullRequest>(`/scans/${id}/ship`, {
      method: "POST",
      body: JSON.stringify({ fix_ids: fixIds }),
    }),
  getGithub: () => request<GithubStatus>("/integrations/github"),
  connectGithub: () => request<GithubStatus>("/integrations/github/connect", { method: "POST" }),
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
              connectGithub: realApi.connectGithub,
              disconnectGithub: realApi.disconnectGithub,
              setGithubRepo: realApi.setGithubRepo,
            }
          : m.mockApi,
      )
    : Promise.resolve(realApi);
  return cached;
}
