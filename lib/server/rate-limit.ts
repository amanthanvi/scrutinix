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
      /** Seconds until the denying window resets: the Retry-After value. */
      retryAfterSeconds: number;
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

/**
 * Independent budgets. "scan" meters `/api/analyze` (each scan fans out to
 * eight providers). "image" meters the per-result share image route, which
 * is CPU-bound but cheap next to a scan; social crawlers share IPs across
 * many users' links, so it gets a wider window and never spends scan quota.
 */
export type RateLimitTier = "scan" | "image";

const TIERS: Record<
  RateLimitTier,
  { minute: number; day: number; prefix: string }
> = {
  scan: { minute: 10, day: 50, prefix: "mud" },
  image: { minute: 30, day: 600, prefix: "og" },
};

declare global {
  var __devRateLimitStore: Map<string, WindowRecord> | undefined;
  var __scrutinixRateLimiters:
    | Partial<Record<RateLimitTier, { minute: Ratelimit; day: Ratelimit }>>
    | undefined;
}

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

function getUpstashLimiters(
  redisUrl: string,
  redisToken: string,
  tier: RateLimitTier,
) {
  const limiters = (globalThis.__scrutinixRateLimiters ??= {});
  const existing = limiters[tier];
  if (existing) {
    return existing;
  }

  const { minute, day, prefix } = TIERS[tier];
  const redis = new Redis({
    url: redisUrl,
    token: redisToken,
    retry: UPSTASH_REDIS_RETRY,
  });
  const created = {
    minute: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(minute, "1 m"),
      prefix: `${prefix}:minute`,
    }),
    day: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(day, "1 d"),
      prefix: `${prefix}:day`,
    }),
  };
  limiters[tier] = created;
  return created;
}

/**
 * What a person reads when they are limited, worded from the actual wait:
 * "Try again in about a minute", "...in about 12 minutes", or, when the
 * day's budget is spent, "...in about 5 hours".
 */
export function describeRateLimitWait(
  seconds: number,
  dayLimit: boolean,
  tier: RateLimitTier = "scan",
): string {
  // Name what was actually limited: a share-image fetch is not a scan.
  const what = tier === "image" ? "share-image requests" : "scans";
  if (dayLimit || seconds >= 3600) {
    const hours = Math.max(1, Math.ceil(seconds / 3600));
    return `Too many ${what} from this connection today. Try again in about ${hours === 1 ? "an hour" : `${hours} hours`}.`;
  }
  if (seconds <= 90) {
    return `Too many ${what} from this connection. Try again in about a minute.`;
  }
  return `Too many ${what} from this connection. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
}

function toLimitResult(
  minute: WindowOutcome,
  day: WindowOutcome,
  tier: RateLimitTier,
): LimitResult {
  const remaining = Math.min(minute.remaining, day.remaining);

  if (!minute.success || !day.success) {
    // The wait is set by the windows that denied: a spent day budget is
    // not lifted when the minute window resets.
    const reset = Math.max(
      ...[minute, day]
        .filter((window) => !window.success)
        .map((window) => window.reset),
    );
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((reset - Date.now()) / 1000),
    );
    return {
      success: false,
      remaining,
      reset,
      retryAfterSeconds,
      status: 429,
      error: createApiError(
        "rate_limited",
        describeRateLimitWait(retryAfterSeconds, !day.success, tier),
        true,
      ),
    };
  }

  return { success: true, remaining, reset: Math.min(minute.reset, day.reset) };
}

function degradeToInMemory(
  identifier: string,
  cost: number,
  tier: RateLimitTier,
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

  return applyInMemoryLimit(identifier, cost, tier);
}

export async function applyRateLimit(
  identifier: string,
  cost = 1,
  tier: RateLimitTier = "scan",
): Promise<LimitResult> {
  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
  ) {
    return applyInMemoryLimit(identifier, cost, tier);
  }

  const { url: redisUrl, token: redisToken } = getRedisRestConfig();

  if (!redisUrl || !redisToken) {
    return degradeToInMemory(identifier, cost, tier, "missing_credentials");
  }

  try {
    const { minute: minuteLimiter, day: dayLimiter } = getUpstashLimiters(
      redisUrl,
      redisToken,
      tier,
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
      return toLimitResult(minute, day, tier);
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
      return toLimitResult(minute ?? passthrough, day ?? passthrough, tier);
    }

    // Both threw, or the only successful window allowed — intended prod-500 fix.
    globalThis.__scrutinixRateLimiters = undefined;
    return degradeToInMemory(
      identifier,
      cost,
      tier,
      "upstash_error",
      rejection,
    );
  } catch (error) {
    // Drop the singleton so the next request can rebuild against Redis if it
    // recovers; otherwise every subsequent call would keep a dead client.
    globalThis.__scrutinixRateLimiters = undefined;
    return degradeToInMemory(identifier, cost, tier, "upstash_error", error);
  }
}

/** Entry count that triggers a sweep of expired windows (one-off IPs otherwise accumulate forever). */
const STORE_SWEEP_THRESHOLD = 5_000;

function applyInMemoryLimit(
  identifier: string,
  cost: number,
  tier: RateLimitTier,
): LimitResult {
  const limits = TIERS[tier];
  // The scan tier keeps its historical keys; other tiers are namespaced.
  const key = tier === "scan" ? identifier : `${tier}:${identifier}`;
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
    `minute:${key}`,
    limits.minute,
    60_000,
    now,
    cost,
  );
  const day = incrementWindow(
    store,
    `day:${key}`,
    limits.day,
    86_400_000,
    now,
    cost,
  );

  return toLimitResult(minute, day, tier);
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
