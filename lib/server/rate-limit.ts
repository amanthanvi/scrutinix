import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { createApiError } from "@/lib/server/api-error";
import { getRedisRestConfig } from "@/lib/server/redis-config";

export { getRedisRestConfig };

type LimitResult =
  | {
      success: true;
      remaining: number;
      reset: number;
    }
  | {
      success: false;
      remaining: number;
      reset: number;
      status: number;
      error: ReturnType<typeof createApiError>;
    };

type WindowRecord = {
  count: number;
  resetAt: number;
};

declare global {
  var __devRateLimitStore: Map<string, WindowRecord> | undefined;
  var __scrutinixRateLimiters:
    { minute: Ratelimit; day: Ratelimit } | undefined;
}

const MINUTE_LIMIT = 10;
const DAY_LIMIT = 50;

/**
 * Rate-limit identity from request headers.
 *
 * The leftmost X-Forwarded-For hop is client-supplied and untrusted when the
 * edge does not overwrite the header. Prefer platform IPs (Vercel sets
 * x-real-ip / x-vercel-forwarded-for). Otherwise use the rightmost XFF hop
 * (typically appended by a trusted reverse proxy). Residual risk: without a
 * header-overwriting edge, clients can still spoof identity.
 */
export function getClientRateLimitId(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  const vercelForwarded = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercelForwarded) {
    const hop = lastForwardedHop(vercelForwarded);
    if (hop) {
      return hop;
    }
  }

  const forwardedFor = headers.get("x-forwarded-for");
  const hop = lastForwardedHop(forwardedFor);
  return hop ?? "unknown";
}

function lastForwardedHop(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const hops = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return hops.at(-1);
}

function getUpstashLimiters(redisUrl: string, redisToken: string) {
  if (!globalThis.__scrutinixRateLimiters) {
    // Fail fast when Redis is unreachable: the default 5 retries with
    // exponential backoff can stall the analyze proxy for ~4s before throwing.
    // Callers degrade to process-local limiting instead of surfacing HTTP 500.
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
      retry: {
        retries: 1,
        backoff: (retryCount) => Math.min(200, 50 * (retryCount + 1)),
      },
    });
    globalThis.__scrutinixRateLimiters = {
      minute: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(MINUTE_LIMIT, "1 m"),
        prefix: "mud:minute",
      }),
      day: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(DAY_LIMIT, "1 d"),
        prefix: "mud:day",
      }),
    };
  }
  return globalThis.__scrutinixRateLimiters;
}

function resetUpstashLimiters() {
  globalThis.__scrutinixRateLimiters = undefined;
}

function degradeToInMemory(
  identifier: string,
  cost: number,
  reason: string,
  cause?: unknown,
): LimitResult {
  const detail =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : undefined;

  console.warn(
    JSON.stringify({
      level: "warn",
      event: "rate_limit.degraded",
      mode: "in-memory",
      reason,
      ...(detail ? { detail } : {}),
      message:
        "Falling back to process-local rate limiting so analyze requests keep working.",
    }),
  );

  return applyInMemoryLimit(identifier, cost);
}

export async function applyRateLimit(
  identifier: string,
  cost = 1,
): Promise<LimitResult> {
  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
  ) {
    return applyInMemoryLimit(identifier, cost);
  }

  const { url: redisUrl, token: redisToken } = getRedisRestConfig();

  if (!redisUrl || !redisToken) {
    return degradeToInMemory(identifier, cost, "missing_credentials");
  }

  try {
    const { minute: minuteLimiter, day: dayLimiter } = getUpstashLimiters(
      redisUrl,
      redisToken,
    );

    const [minute, day] = await Promise.all([
      minuteLimiter.limit(identifier, { rate: cost }),
      dayLimiter.limit(identifier, { rate: cost }),
    ]);

    if (!minute.success || !day.success) {
      const reset = Math.min(minute.reset, day.reset);
      return {
        success: false,
        remaining: Math.min(minute.remaining, day.remaining),
        reset,
        status: 429,
        error: createApiError(
          "rate_limited",
          "Rate limit exceeded. Please retry after the cooldown window.",
          true,
        ),
      };
    }

    return {
      success: true,
      remaining: Math.min(minute.remaining, day.remaining),
      reset: Math.min(minute.reset, day.reset),
    };
  } catch (error) {
    // Drop the singleton so the next request can rebuild against Redis if it
    // recovers; otherwise every subsequent call would keep a dead client.
    resetUpstashLimiters();
    return degradeToInMemory(identifier, cost, "upstash_error", error);
  }
}

/** Entry count that triggers a sweep of expired windows (one-off IPs otherwise accumulate forever). */
const STORE_SWEEP_THRESHOLD = 5_000;

function applyInMemoryLimit(identifier: string, cost: number): LimitResult {
  const store =
    globalThis.__devRateLimitStore ?? new Map<string, WindowRecord>();
  globalThis.__devRateLimitStore = store;
  const now = Date.now();

  if (store.size > STORE_SWEEP_THRESHOLD) {
    for (const [key, record] of store) {
      if (record.resetAt <= now) {
        store.delete(key);
      }
    }
  }

  const minute = incrementWindow(
    store,
    `minute:${identifier}`,
    MINUTE_LIMIT,
    60_000,
    now,
    cost,
  );
  const day = incrementWindow(
    store,
    `day:${identifier}`,
    DAY_LIMIT,
    86_400_000,
    now,
    cost,
  );

  if (!minute.success || !day.success) {
    return {
      success: false,
      remaining: Math.min(minute.remaining, day.remaining),
      reset: Math.min(minute.reset, day.reset),
      status: 429,
      error: createApiError(
        "rate_limited",
        "Rate limit exceeded. Please retry after the cooldown window.",
        true,
      ),
    };
  }

  return {
    success: true,
    remaining: Math.min(minute.remaining, day.remaining),
    reset: Math.min(minute.reset, day.reset),
  };
}

function incrementWindow(
  store: Map<string, WindowRecord>,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  cost: number,
) {
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    const next = {
      count: cost,
      resetAt: now + windowMs,
    };
    store.set(key, next);
    return {
      success: next.count <= limit,
      remaining: Math.max(0, limit - next.count),
      reset: next.resetAt,
    };
  }

  current.count += cost;
  store.set(key, current);

  return {
    success: current.count <= limit,
    remaining: Math.max(0, limit - current.count),
    reset: current.resetAt,
  };
}
