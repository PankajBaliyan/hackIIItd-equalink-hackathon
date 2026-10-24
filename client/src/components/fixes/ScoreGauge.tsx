import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";

import { AnimatedCounter } from "@/components/ui/animated-counter";

/** Recharts radial gauge. The chart is decorative; the before → after text is the accessible content. */
export default function ScoreGauge({
  before,
  after,
}: {
  before?: number | undefined;
  after?: number | undefined;
}) {
  const value = after ?? before ?? 0;
  const delta = before != null && after != null ? after - before : undefined;
  return (
    <figure className="space-y-2 text-center">
      <div className="relative mx-auto size-44">
        <div aria-hidden className="size-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="78%"
              outerRadius="100%"
              data={[{ value }]}
              startAngle={90}
              endAngle={-270}
            >
              <defs>
                <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="var(--accent-c)" />
                  <stop offset="100%" stopColor="var(--accent-2)" />
                </linearGradient>
              </defs>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} angleAxisId={0} />
              <RadialBar
                dataKey="value"
                cornerRadius={10}
                fill="url(#gauge-grad)"
                background={{ fill: "var(--surface-2)" }}
                animationDuration={900}
              />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
        <p className="absolute inset-0 grid place-items-center text-4xl font-semibold">
          <AnimatedCounter value={value} from={before ?? 0} duration={1} />
        </p>
      </div>
      <figcaption className="space-y-1">
        <p className="tabular text-sm">
          Score {before ?? "–"} → {after ?? "–"}
          <span className="sr-only"> out of 100</span>
        </p>
        {delta != null && (
          <span className="tabular inline-flex rounded-full border bg-surface px-2.5 py-0.5 text-xs font-medium text-success">
            ▲ +{delta} points
          </span>
        )}
      </figcaption>
    </figure>
  );
}
