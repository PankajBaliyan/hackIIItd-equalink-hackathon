import { cn } from "@/lib/utils";

/** a11y: role=meter with a numeric text value; colour is supplementary. */
export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 85 ? "bg-success" : pct >= 60 ? "bg-moderate" : "bg-critical";
  const word = pct >= 85 ? "High" : pct >= 60 ? "Medium" : "Low";
  return (
    <div className="flex items-center gap-3">
      <div
        role="meter"
        aria-label="Confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%, ${word}`}
        className="h-2 w-32 overflow-hidden rounded-full bg-surface-2"
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-sm">
        {pct}% <span className="text-muted">{word}</span>
      </span>
    </div>
  );
}
