/**
 * Fixed-window limiter keyed by an arbitrary string (e.g. "login:<ip>:<email>").
 *
 * In-process storage is correct for a single Node instance and for local dev.
 * Phase 10 swaps the store for Redis/Upstash so limits hold across serverless instances;
 * the interface stays the same.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? Date.now;

  return function check(key: string): RateLimitResult {
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
    }
    const allowed = entry.count <= opts.limit;
    return {
      allowed,
      remaining: Math.max(0, opts.limit - entry.count),
      retryAfterMs: allowed ? 0 : entry.resetAt - t,
    };
  };
}

export const loginLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60 * 1000 });
export const signupLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });
