import { Button } from "@/components/ui/button";
import { USE_MOCKS } from "@/lib/api";
import { useScanStore } from "@/state/scanStore";

/** Dev-only: starts a scan through the active API layer and prints the stream. */
export function MockDebugPanel() {
  const s = useScanStore();
  return (
    <section aria-labelledby="dbg" className="space-y-3 rounded-card border bg-surface p-5">
      <h2 id="dbg" className="text-2xl">
        Data layer debug
      </h2>
      <p className="text-sm text-muted">
        Mode: <strong>{USE_MOCKS ? "mocks" : "real API"}</strong> · connection: {s.connection} ·
        stage: {s.scan?.status ?? "none"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={() =>
            void s.startScan({ url: "https://shopeasy.dev", level: "AA", scope: "page" })
          }
        >
          Start mock scan
        </Button>
        <Button
          variant="secondary"
          disabled={s.scan?.status !== "done"}
          onClick={() => void s.ship()}
        >
          Ship PR
        </Button>
        <Button variant="ghost" onClick={s.reset}>
          Reset
        </Button>
      </div>
      <p className="text-sm tabular">
        Issues {s.issues.length} · fixes {s.fixes.length} · score {s.scan?.score_before ?? "–"} →{" "}
        {s.scan?.score_after ?? "–"} · PR {s.pr ? `#${s.pr.number} ${s.pr.repo}` : "–"}
      </p>
      {/* scrollable log must be keyboard focusable */}
      <pre
        role="region"
        tabIndex={0}
        aria-label="Event log"
        className="max-h-64 overflow-auto rounded-md border bg-bg p-3 font-mono text-xs"
      >
        {s.events.map((e) => `[${e.stage}] ${e.message}`).join("\n") || "No events yet."}
      </pre>
    </section>
  );
}
