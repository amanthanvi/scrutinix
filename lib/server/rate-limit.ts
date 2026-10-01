import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { createApiError } from "@/lib/server/api-error";
import { logWarn } from "@/lib/server/logger";
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

type WindowOutcome = {
  success: boolean;
  remaining: number;
  reset: number;
};

type WindowRecord = {
  count: number;
  resetAt: number;
};

type DegradeReason = "missing_credentials" | "upstash_error";

declare global {
  var __devRateLimitStore: Map<string, WindowRecord> | undefined;
  var __scrutinixRateLimiters:
    { minute: Ratelimit; day: Ratelimit } | undefined;
}

const MINUTE_LIMIT = 10;
const DAY_LIMIT = 50;

/** Fail fast when Redis is unreachable so callers can degrade instead of stalling ~4s. */
const UPSTASH_REDIS_RETRY = {
  retries: 1,
  backoff: (retryCount: number) => Math.min(200, 50 * (retryCount + 1)),
} as const;

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
    const redis = new Redis({
      url: redisUrl,
      token: redisToken,
      retry: UPSTASH_REDIS_RETRY,
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

function toLimitResult(minute: WindowOutcome, day: WindowOutcome): LimitResult {
  const remaining = Math.min(minute.remaining, day.remaining);
  const reset = Math.min(minute.reset, day.reset);

  if (!minute.success || !day.success) {
    return {
      success: false,
      remaining,
      reset,
      status: 429,
      error: createApiError(
        "rate_limited",
        "Rate limit exceeded. Please retry after the cooldown window.",
        true,
      ),
    };
  }

  return { success: true, remaining, reset };
}

function degradeToInMemory(
  identifier: string,
  cost: number,
  reason: DegradeReason,
  cause?: unknown,
): LimitResult {
  const detail =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : undefined;

  logWarn("rate_limit.degraded", {
    mode: "in-memory",
    reason,
    ...(detail ? { detail } : {}),
    message:
      "Falling back to process-local rate limiting so analyze requests keep working.",
  });

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

    // allSettled so a throw in one window cannot discard a deny from the other.
    const [minuteSettled, daySettled] = await Promise.allSettled([
      minuteLimiter.limit(identifier, { rate: cost }),
      dayLimiter.limit(identifier, { rate: cost }),
    ]);

    const minute =
      minuteSettled.status === "fulfilled" ? minuteSettled.value : undefined;
    const day =
      daySettled.status === "fulfilled" ? daySettled.value : undefined;

    if (minute && day) {
      return toLimitResult(minute, day);
    }

    const rejection =
      minuteSettled.status === "rejected"
        ? minuteSettled.reason
        : daySettled.status === "rejected"
          ? daySettled.reason
          : undefined;

    // Shared Redis already denied — never admit via process-local fallback.
    const deniedWindow =
      minute && !minute.success
        ? minute
        : day && !day.success
          ? day
          : undefined;

    if (deniedWindow) {
      // Sibling window failed; drop the client so the next call can rebuild.
      globalThis.__scrutinixRateLimiters = undefined;
      logWarn("rate_limit.partial_upstash_failure", {
        reason: "upstash_error",
        ...(rejection instanceof Error
          ? { detail: rejection.message }
          : typeof rejection === "string"
            ? { detail: rejection }
            : {}),
        message:
          "Preserving Upstash deny despite sibling window failure; not degrading to in-memory.",
      });
      // Neutral stand-in so toLimitResult keeps remaining/reset from the deny.
      const passthrough: WindowOutcome = {
        success: true,
        remaining: Number.MAX_SAFE_INTEGER,
        reset: Number.MAX_SAFE_INTEGER,
      };
      return toLimitResult(minute ?? passthrough, day ?? passthrough);
    }

    // Both threw, or the only successful window allowed — intended prod-500 fix.
    globalThis.__scrutinixRateLimiters = undefined;
    return degradeToInMemory(identifier, cost, "upstash_error", rejection);
  } catch (error) {
    // Drop the singleton so the next request can rebuild against Redis if it
    // recovers; otherwise every subsequent call would keep a dead client.
    globalThis.__scrutinixRateLimiters = undefined;
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

  return toLimitResult(minute, day);
}

function incrementWindow(
  store: Map<string, WindowRecord>,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  cost: number,
): WindowOutcome {
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
