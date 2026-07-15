/**
 * Per-message delays: interval ± uniform jitter, in milliseconds. Rolled once
 * at plan time inside a workflow step — the orchestrator never calls
 * Math.random(). Never zero, never negative.
 */
const MIN_DELAY_MS = 1_000;

export function computeDelays(
  count: number,
  intervalSeconds: number,
  jitterSeconds: number,
  rng: () => number = Math.random,
): number[] {
  const delays: number[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const jitter = (rng() * 2 - 1) * jitterSeconds;
    const ms = Math.round((intervalSeconds + jitter) * 1000);
    delays.push(Math.max(MIN_DELAY_MS, ms));
  }
  return delays;
}
