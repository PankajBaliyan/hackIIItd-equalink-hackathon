import { useId } from "react";

import { AnimatedCounter } from "@/components/ui/animated-counter";

/** Compact SVG ring. a11y: the ring is decorative; the value is real text with a label. */
export function ScoreRing({
  score,
  label,
  size = 112,
}: {
  score?: number | undefined;
  label: string;
  size?: number;
}) {
  const gradient = `ring-grad-${useId().replace(/:/g, "")}`; // unique per ring: there can be two on a page
  const r = 44;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <figure className="flex flex-col items-center gap-2" style={{ width: size + 24 }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" aria-hidden className="size-full -rotate-90">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--accent-c)" />
              <stop offset="100%" stopColor="var(--accent-2)" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct / 100)}
            style={{ transition: "stroke-dashoffset var(--dur-slow) ease-out" }}
          />
        </svg>
        <p className="absolute inset-0 grid place-items-center text-3xl font-semibold">
          {score == null ? (
            <span aria-label="Not scored yet">–</span>
          ) : (
            <AnimatedCounter value={score} />
          )}
        </p>
      </div>
      <figcaption className="text-center text-sm text-muted">{label}</figcaption>
    </figure>
  );
}
