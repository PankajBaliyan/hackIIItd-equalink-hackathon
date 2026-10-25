import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { ReactNode } from "react";

import { getApi } from "@/lib/api";
import { emptyCounters } from "@/lib/score";
import type {
  ConnectionState,
  CreateScanInput,
  Fix,
  Issue,
  PullRequest,
  Scan,
  ScanEvent,
  ScanDetail,
  Severity,
} from "@/lib/types";

export interface ScanState {
  scan: Scan | null;
  issues: Issue[];
  fixes: Fix[];
  events: ScanEvent[];
  counters: Record<Severity, number>;
  pr: PullRequest | null;
  connection: ConnectionState;
  /** PRs opened in this session (for /pull-requests). */
  pullRequests: PullRequest[];
  error: string | null;
  summary: ScanDetail["summary"] | null;
  screenshot: string | null;
  selectedIssueId: string | null;
}

type Action =
  | { type: "reset" }
  | { type: "scan"; scan: Scan }
  | ({ type: "detail" } & ScanDetail)
  | { type: "event"; event: ScanEvent }
  | { type: "connection"; connection: ConnectionState }
  | { type: "pr"; pr: PullRequest }
  | { type: "selectIssue"; id: string | null }
  | { type: "error"; error: string };

const initial: ScanState = {
  scan: null,
  issues: [],
  fixes: [],
  events: [],
  counters: emptyCounters(),
  pr: null,
  connection: "closed",
  pullRequests: [],
  error: null,
  summary: null,
  screenshot: null,
  selectedIssueId: null,
};

function reducer(state: ScanState, a: Action): ScanState {
  switch (a.type) {
    case "reset":
      return { ...initial, pullRequests: state.pullRequests };
    case "scan":
      return { ...initial, pullRequests: state.pullRequests, scan: a.scan };
    case "detail":
      return {
        ...state,
        scan: a.scan,
        issues: a.issues,
        fixes: a.fixes,
        pr: a.pr ?? null,
        summary: a.summary ?? null,
        screenshot: a.screenshot ?? null,
        error: null,
      };
    case "event": {
      const e = a.event;
      const issues =
        e.issue && !state.issues.some((i) => i.id === e.issue!.id)
          ? [...state.issues, e.issue]
          : state.issues;
      return {
        ...state,
        events: [...state.events, e],
        issues,
        counters: e.counters ?? state.counters,
        scan: state.scan ? { ...state.scan, status: e.stage } : state.scan,
      };
    }
    case "connection":
      return { ...state, connection: a.connection };
    case "pr":
      return {
        ...state,
        pr: a.pr,
        pullRequests: [a.pr, ...state.pullRequests.filter((p) => p.scan_id !== a.pr.scan_id)],
      };
    case "selectIssue":
      return { ...state, selectedIssueId: a.id };
    case "error":
      return { ...state, error: a.error };
  }
}

interface StoreValue extends ScanState {
  startScan(input: CreateScanInput): Promise<Scan>;
  /** Loads detail for an id and, if unfinished, streams live events. */
  openScan(id: string): void;
  ship(fixIds?: string[]): Promise<PullRequest>;
  setFixIncluded(fixId: string, included: boolean): Promise<void>;
  selectIssue(id: string | null): void;
  reset(): void;
}

const Ctx = createContext<StoreValue | null>(null);

export function ScanStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const unsub = useRef<(() => void) | null>(null);
  const stateRef = useRef(state);
  const activeId = useRef<string | null>(null);
  stateRef.current = state;

  const stream = useCallback(async (id: string) => {
    const api = await getApi();
    unsub.current?.();
    unsub.current = api.subscribe(
      id,
      (event) => {
        if (activeId.current !== id) return;
        dispatch({ type: "event", event });
        // Pull full issue/fix data as soon as each stage that produces it completes.
        if (event.stage === "done" || event.stage === "fixing" || event.stage === "verifying") {
          void api
            .getScan(id)
            .then((d) => {
              if (activeId.current === id) dispatch({ type: "detail", ...d });
            })
            .catch((e: unknown) => {
              if (activeId.current === id)
                dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) });
            });
        }
      },
      (connection) => dispatch({ type: "connection", connection }),
    );
  }, []);

  const startScan = useCallback(
    async (input: CreateScanInput) => {
      const api = await getApi();
      const scan = await api.createScan(input);
      activeId.current = scan.id;
      dispatch({ type: "scan", scan });
      void stream(scan.id);
      return scan;
    },
    [stream],
  );

  const openScan = useCallback(
    (id: string) => {
      if (activeId.current === id) return;
      activeId.current = id;
      unsub.current?.();
      dispatch({ type: "reset" });
      void getApi()
        .then((api) => api.getScan(id))
        .then((d) => {
          if (activeId.current !== id) return;
          dispatch({ type: "detail", ...d });
          if (d.scan.status !== "done" && d.scan.status !== "failed") void stream(id);
        })
        .catch((e: unknown) => {
          if (activeId.current !== id) return;
          activeId.current = null;
          dispatch({ type: "error", error: e instanceof Error ? e.message : String(e) });
        });
    },
    [stream],
  );

  const ship = useCallback(async (fixIds?: string[]) => {
    const id = stateRef.current.scan?.id;
    if (!id) throw new Error("Load a scan before opening a pull request.");
    const api = await getApi();
    const pr = await api.ship(id, fixIds);
    if (activeId.current === id) dispatch({ type: "pr", pr });
    return pr;
  }, []);

  const setFixIncluded = useCallback(async (fixId: string, included: boolean) => {
    const id = stateRef.current.scan?.id;
    if (!id) throw new Error("Load a scan before reviewing a fix.");
    const detail = await (await getApi()).setFixIncluded(id, fixId, included);
    if (activeId.current === id) dispatch({ type: "detail", ...detail });
  }, []);

  const selectIssue = useCallback((id: string | null) => dispatch({ type: "selectIssue", id }), []);

  const reset = useCallback(() => {
    unsub.current?.();
    activeId.current = null;
    dispatch({ type: "reset" });
  }, []);

  useEffect(() => () => unsub.current?.(), []);

  const value = useMemo<StoreValue>(
    () => ({ ...state, startScan, openScan, ship, setFixIncluded, selectIssue, reset }),
    [state, startScan, openScan, ship, setFixIncluded, selectIssue, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScanStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useScanStore must be used inside <ScanStoreProvider>");
  return v;
}
