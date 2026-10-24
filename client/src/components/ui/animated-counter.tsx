import { animate, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

/** Counts up to `value`; with reduced motion it jumps straight to the value. */
export function AnimatedCounter({
  value,
  from: start,
  duration = 0.6,
}: {
  value: number;
  from?: number;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(start ?? value);
  const from = useRef(start ?? value);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const c = animate(from.current, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setShown(Math.round(v)),
      onComplete: () => (from.current = value),
    });
    return () => c.stop();
  }, [value, duration, reduce]);

  return <span className="tabular">{shown}</span>;
}
