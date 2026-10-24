import { emptyCounters } from "@/lib/score";
import type {
  CreateScanInput,
  Fix,
  GithubStatus,
  Issue,
  PullRequest,
  Scan,
  ScanApi,
  ScanDetail,
  ScanEvent,
  Severity,
  Stage,
} from "@/lib/types";
import {
  fixFixtures,
  issueFixtures,
  prFixture,
  SCORE_AFTER,
  SCORE_BEFORE,
  seedScans,
} from "./fixtures";

const STAGE_RANK: Record<Stage, number> = {
  queued: 0,
  crawling: 1,
  diagnosing: 2,
  fixing: 3,
  verifying: 4,
  shipping: 5,
  done: 6,
  failed: 6,
};

const scans = new Map<string, Scan>(seedScans().map((s) => [s.id, s]));
const prs = new Map<string, PullRequest>();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString();

type Step = { wait: number; apply: (ctx: Ctx) => ScanEvent };
interface Ctx {
  scan: Scan;
  issues: Issue[];
  counters: Record<Severity, number>;
}

const info = (stage: Stage, message: string): ScanEvent => ({
  stage,
  message,
  type: "info",
  ts: ts(),
});

/** Scripted timeline: ~18s at speed 1. */
function script(): Step[] {
  const set = (c: Ctx, stage: Stage) => (c.scan.status = stage);
  const steps: Step[] = [
    {
      wait: 400,
      apply: (c) => (set(c, "crawling"), info("crawling", "▸ TinyFish Fetch: rendering /")),
    },
    { wait: 900, apply: (c) => info(c.scan.status, "▸ opening login modal (TinyFish Agent)") },
    { wait: 900, apply: (c) => info(c.scan.status, "▸ keyboard traversal: Tab ×24, Esc") },
    {
      wait: 600,
      apply: (c) => (
        set(c, "diagnosing"),
        info("diagnosing", "▸ axe-core: wcag2a, wcag2aa, wcag22aa")
      ),
    },
  ];
  for (const iss of issueFixtures("")) {
    steps.push({
      wait: 700,
      apply: (c) => {
        const issue = c.issues.find((i) => i.id === iss.id)!;
        c.counters[issue.impact] += 1;
        return {
          stage: "diagnosing",
          type: "issue",
          message: `✗ ${issue.rule_id} (WCAG ${issue.wcag_sc}) ${issue.selector}`,
          counters: { ...c.counters },
          issue,
          ts: ts(),
        };
      },
    });
  }
  steps.push({
    wait: 600,
    apply: (c) => (
      (c.scan.score_before = SCORE_BEFORE),
      (set(c, "fixing"), info("fixing", `▸ score before: ${SCORE_BEFORE}`))
    ),
  });
  for (const fix of fixFixtures) {
    steps.push({
      wait: 700,
      apply: () => ({
        stage: "fixing",
        type: "fix",
        message: `✎ proposed fix for ${fix.issue_id} (${fix.strategy}, confidence ${Math.round(fix.confidence * 100)}%)`,
        ts: ts(),
      }),
    });
    steps.push({
      wait: 500,
      apply: () => ({
        stage: "fixing",
        type: fix.validated ? "validated" : "rejected",
        message: fix.validated
          ? `✓ validated: violations ${fix.violations_before} → ${fix.violations_after}`
          : `⊘ rejected: ${fix.rejected_reason}`,
        ts: ts(),
      }),
    });
  }
  steps.push(
    {
      wait: 700,
      apply: (c) => (
        set(c, "verifying"),
        info("verifying", "▸ TinyFish re-rendering patched preview")
      ),
    },
    {
      wait: 1000,
      apply: (c) => (
        (c.scan.score_after = SCORE_AFTER),
        (set(c, "done"),
        info("done", `✓ Verified by TinyFish. Score ${SCORE_BEFORE} → ${SCORE_AFTER}`))
      ),
    },
  );
  return steps;
}

/** Runs the timeline against the in-memory scan record. `speed` > 1 is faster. */
function run(scan: Scan, onEvent: (e: ScanEvent) => void, speed: number): () => void {
  let cancelled = false;
  void (async () => {
    const ctx: Ctx = { scan, issues: issueFixtures(scan.id), counters: emptyCounters() };
    onEvent(info("queued", "▸ scan queued"));
    for (const step of script()) {
      await delay(step.wait / speed);
      if (cancelled) return;
      onEvent(step.apply(ctx));
    }
  })();
  return () => {
    cancelled = true;
  };
}

// One shared run per scan so reloads/second subscribers don't restart the timeline.
const running = new Map<string, { buffer: ScanEvent[]; listeners: Set<(e: ScanEvent) => void> }>();

function ensureRun(scan: Scan, speed: number) {
  let r = running.get(scan.id);
  if (r) return r;
  r = { buffer: [], listeners: new Set() };
  running.set(scan.id, r);
  const shared = r;
  run(
    scan,
    (e) => {
      shared.buffer.push(e);
      shared.listeners.forEach((l) => l(e));
    },
    speed,
  );
  return r;
}

let github: GithubStatus = { connected: false, repos: [] };
const copy = (g: GithubStatus): GithubStatus => ({ ...g, repos: g.repos.map((r) => ({ ...r })) });

export const mockApi: ScanApi = {
  async getGithub() {
    await delay(150);
    return copy(github);
  },
  async connectGithub() {
    await delay(900);
    github = {
      connected: true,
      account: "shopeasy",
      repos: [
        { full_name: "shopeasy/shopeasy-demo", enabled: true },
        { full_name: "shopeasy/shopeasy-demo-reset", enabled: false },
        { full_name: "shopeasy/marketing-site", enabled: false },
      ],
    };
    return copy(github);
  },
  async disconnectGithub() {
    await delay(300);
    github = { connected: false, repos: [] };
    return copy(github);
  },
  async setGithubRepo(fullName, enabled) {
    await delay(150);
    github = {
      ...github,
      repos: github.repos.map((r) => (r.full_name === fullName ? { ...r, enabled } : r)),
    };
    return copy(github);
  },

  async createScan(input: CreateScanInput) {
    await delay(300);
    const scan: Scan = {
      id: `scan_${Math.random().toString(36).slice(2, 8)}`,
      url: input.url,
      mode: input.repo ? "repo" : "url",
      level: input.level,
      scope: input.scope,
      status: "queued",
      created_at: ts(),
    };
    scans.set(scan.id, scan);
    return { ...scan };
  },

  async listScans() {
    await delay(150);
    return [...scans.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((s) => ({ ...s }));
  },

  async getScan(id) {
    await delay(100);
    const scan = scans.get(id);
    if (!scan) throw new Error(`Scan ${id} not found`);
    const rank = STAGE_RANK[scan.status];
    const issues: Issue[] = rank >= STAGE_RANK.diagnosing ? issueFixtures(id) : [];
    const fixes: Fix[] = rank >= STAGE_RANK.fixing ? fixFixtures : [];
    const detail: ScanDetail = { scan: { ...scan }, issues, fixes };
    const pr = prs.get(id);
    if (pr) detail.pr = pr;
    return detail;
  },

  async ship(id, fixIds) {
    await delay(1500);
    const scan = scans.get(id);
    if (!scan) throw new Error(`Scan ${id} not found`);
    const base = prFixture(id);
    const pr: PullRequest = {
      ...base,
      fixes: fixIds ? base.fixes.filter((f) => fixIds.includes(f)) : base.fixes,
    };
    prs.set(id, pr);
    return pr;
  },

  subscribe(id, onEvent, onConnection) {
    const scan = scans.get(id);
    if (!scan) {
      onConnection?.("closed");
      return () => {};
    }
    // Finished/seeded scans have nothing to stream.
    if (scan.status === "done" && !running.has(id)) {
      onEvent(info("done", "✓ scan complete"));
      onConnection?.("closed");
      return () => {};
    }
    const r = ensureRun(scan, 1);
    onConnection?.("live");
    r.buffer.forEach(onEvent); // replay history for late subscribers
    const listener = (e: ScanEvent) => {
      onEvent(e);
      if (e.stage === "done" || e.stage === "failed") onConnection?.("closed");
    };
    r.listeners.add(listener);
    return () => r.listeners.delete(listener);
  },
};
