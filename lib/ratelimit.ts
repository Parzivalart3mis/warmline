import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { ApiError } from './http';

/**
 * Sliding-window limits on every mutating route, keyed by userId.
 * Without Upstash env (local dev / CI) limiting is a no-op.
 */
type LimiterKind = 'mutate' | 'generate' | 'import' | 'upload' | 'send';

const WINDOWS: Record<LimiterKind, { limit: number; window: `${number} s` }> = {
  mutate: { limit: 60, window: '60 s' },
  generate: { limit: 10, window: '60 s' },
  import: { limit: 5, window: '60 s' },
  upload: { limit: 10, window: '60 s' },
  send: { limit: 15, window: '60 s' },
};

const g = globalThis as unknown as { __warmlineLimiters?: Partial<Record<LimiterKind, Ratelimit>> };

function limiterFor(kind: LimiterKind): Ratelimit | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  g.__warmlineLimiters ??= {};
  g.__warmlineLimiters[kind] ??= new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(WINDOWS[kind].limit, WINDOWS[kind].window),
    prefix: `warmline:${kind}`,
  });
  return g.__warmlineLimiters[kind] ?? null;
}

export async function assertRateLimit(kind: LimiterKind, userId: string): Promise<void> {
  const limiter = limiterFor(kind);
  if (!limiter) return;
  const { success } = await limiter.limit(userId);
  if (!success) {
    throw new ApiError('RATE_LIMITED', 'Too many requests. Wait a minute and try again.', 429);
  }
}
