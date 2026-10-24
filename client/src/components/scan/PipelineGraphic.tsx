import { motion, useReducedMotion } from "framer-motion";
import {
  Bug,
  GitPullRequest,
  ScanSearch,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

const STEPS: { label: string; Icon: LucideIcon }[] = [
  { label: "Scan", Icon: ScanSearch },
  { label: "Diagnose", Icon: Bug },
  { label: "Fix", Icon: Wrench },
  { label: "Verify", Icon: ShieldCheck },
  { label: "PR", Icon: GitPullRequest },
];

const CYCLE = 5; // seconds for the glow to travel the whole pipeline

/** Decorative animation; the ordered list itself is the accessible content. */
export function PipelineGraphic() {
  const reduce = useReducedMotion();
  return (
    <ol
      aria-label="How EquaLink works"
      className="flex flex-wrap items-center justify-center gap-y-4"
    >
      {STEPS.map(({ label, Icon }, i) => (
        <li key={label} className="flex items-center">
          <div className="flex flex-col items-center gap-2">
            <motion.span
              className="relative grid size-12 place-items-center rounded-card border bg-surface text-text"
              animate={
                reduce
                  ? {}
                  : { borderColor: ["var(--border-c)", "var(--accent-2)", "var(--border-c)"] }
              }
              transition={{
                duration: CYCLE / STEPS.length,
                repeat: Infinity,
                repeatDelay: CYCLE - CYCLE / STEPS.length,
                delay: (i * CYCLE) / STEPS.length,
                ease: "easeOut",
              }}
            >
              <Icon aria-hidden className="size-5" />
              <span className="sr-only">{`Step ${i + 1}: `}</span>
            </motion.span>
            <span className="text-sm font-medium">{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <span
              aria-hidden
              className="mx-2 mb-6 h-0.5 w-6 rounded-full bg-brand-gradient opacity-70 sm:w-10"
            />
          )}
        </li>
      ))}
    </ol>
  );
}
