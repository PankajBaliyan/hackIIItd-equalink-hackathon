import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

/** Staggered list entrance; renders plain content (no motion) when reduced motion is on. */
export function Reveal({
  index = 0,
  as = "li",
  children,
  className,
}: {
  index?: number;
  as?: "li" | "div";
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const Comp = as === "li" ? motion.li : motion.div;
  return (
    <Comp
      className={className}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        delay: reduce ? 0 : Math.min(index, 8) * 0.04,
        ease: "easeOut",
      }}
    >
      {children}
    </Comp>
  );
}
