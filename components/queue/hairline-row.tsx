'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * The signature element. The row currently sending shows a hairline in
 * --stamp (airmail red) sweeping left→right over its send interval. Under
 * prefers-reduced-motion the hairline does not animate — it becomes a static
 * marker that steps forward on a 10s interval, and the sending state is
 * announced (via aria-live in the board).
 *
 * The row keeps a stable key across polls, so the component mounts once when a
 * send begins: the CSS animation sweeps from 0 over the interval. No wall-clock
 * reads during render keeps this pure and re-render-safe.
 */
const STEP_MS = 10_000;

export function HairlineSweep({ intervalMs }: { intervalMs: number }) {
  const reduce = useReducedMotion();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!reduce) return;
    const stepFraction = STEP_MS / intervalMs;
    const id = setInterval(() => {
      setProgress((p) => Math.min(0.98, p + stepFraction));
    }, STEP_MS);
    return () => clearInterval(id);
  }, [reduce, intervalMs]);

  if (reduce) {
    return (
      <div
        className="hairline"
        style={{ ['--sweep-from' as string]: String(progress) }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      className="hairline"
      style={{ ['--sweep-from' as string]: '0', ['--sweep-ms' as string]: `${intervalMs}ms` }}
      aria-hidden="true"
    />
  );
}
