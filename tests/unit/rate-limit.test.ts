import { beforeEach, describe, expect, it, vi } from "vitest";

const redisConstructor = vi.hoisted(() =>
  vi.fn(function Redis() {
    return {};
  }),
);

vi.mock("@upstash/redis", () => ({
  Redis: redisConstructor,
}));

const limitImpl = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true,
    remaining: 9,
    reset: 1_900_000_000_000,
  })),
);

vi.mock("@upstash/ratelimit", () => {
  class MockRatelimit {
    static slidingWindow(limit: number, window: string) {
      return { limit, window };
    }

    limit = limitImpl;
  }

  return {
    Ratelimit: MockRatelimit,
  };
});

import {
  applyRateLimit,
  describeRateLimitWait,
  getClientRateLimitId,
  getRedisRestConfig,
} from "@/lib/server/rate-limit";

describe("describeRateLimitWait", () => {
  it("words the wait from the window that denied", () => {
    expect(describeRateLimitWait(42, false)).toBe(
      "Too many scans from this connection. Try again in about a minute.",
    );
    expect(describeRateLimitWait(600, false)).toBe(
      "Too many scans from this connection. Try again in about 10 minutes.",
    );
    expect(describeRateLimitWait(3_000, true)).toBe(
      "Too many scans from this connection today. Try again in about an hour.",
    );
    expect(describeRateLimitWait(5 * 3_600, true)).toBe(
      "Too many scans from this connection today. Try again in about 5 hours.",
    );
  });
});

describe("getClientRateLimitId", () => {
  it("prefers x-real-ip over forwarded-for", () => {
    const headers = new Headers({
      "x-real-ip": "203.0.113.50",
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });

    expect(getClientRateLimitId(headers)).toBe("203.0.113.50");
  });

  it("uses the rightmost x-forwarded-for hop when platform headers are absent", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.1.1.1, 2.2.2.2",
    });

    expect(getClientRateLimitId(headers)).toBe("2.2.2.2");
  });

  it("does not treat a spoofed first XFF hop as identity when a later hop exists", () => {
    const headers = new Headers({
      "x-forwarded-for": "198.51.100.1, 203.0.113.9",
    });

    expect(getClientRateLimitId(headers)).toBe("203.0.113.9");
  });

  it("falls back to unknown when no client IP headers are present", () => {
    expect(getClientRateLimitId(new Headers())).toBe("unknown");
  });
});

describe("applyRateLimit", () => {
  beforeEach(() => {
    redisConstructor.mockClear();
    limitImpl.mockReset();
    limitImpl.mockResolvedValue({
      success: true,
      remaining: 9,
      reset: 1_900_000_000_000,
    });
    globalThis.__scrutinixRateLimiters = undefined;
    globalThis.__devRateLimitStore = undefined;
  });

  it("enforces the per-minute limit in development mode", async () => {
    vi.stubEnv("NODE_ENV", "development");

    let lastResult = await applyRateLimit("127.0.0.1");
    for (let index = 1; index < 10; index += 1) {
      lastResult = await applyRateLimit("127.0.0.1");
    }

    expect(lastResult.success).toBe(true);

    const blocked = await applyRateLimit("127.0.0.1");
    expect(blocked.success).toBe(false);
    if (!blocked.success) {
      expect(blocked.status).toBe(429);
      // A minute-window deny says when, in plain words.
      expect(blocked.error.message).toBe(
        "Too many scans from this connection. Try again in about a minute.",
      );
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it("waits for the day window when only the day budget is spent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const now = Date.now();
    limitImpl
      .mockResolvedValueOnce({
        success: true,
        remaining: 4,
        reset: now + 30_000,
      })
      .mockResolvedValueOnce({
        success: false,
        remaining: 0,
        reset: now + 5 * 3_600_000 - 60_000,
      });

    const result = await applyRateLimit("203.0.113.44");

    expect(result.success).toBe(false);
    if (!result.success) {
      // Not the minute window's 30 seconds: the day budget is what blocks.
      expect(result.retryAfterSeconds).toBeGreaterThan(4 * 3600);
      expect(result.reset).toBe(now + 5 * 3_600_000 - 60_000);
      expect(result.error.message).toBe(
        "Too many scans from this connection today. Try again in about 5 hours.",
      );
    }
  });

  it("falls back to in-memory limits when Upstash is missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    const result = await applyRateLimit("203.0.113.10");

    expect(result.success).toBe(true);
  });

  it("accepts Vercel KV aliases for Upstash REST config", () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.stubEnv("KV_REST_API_URL", "https://example-kv.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");

    expect(getRedisRestConfig()).toEqual({
      url: "https://example-kv.upstash.io",
      token: "kv-token",
    });
  });

  it("ignores empty Upstash placeholders when KV aliases are populated", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "  ");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("KV_REST_API_URL", "https://example-kv.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");

    expect(getRedisRestConfig()).toEqual({
      url: "https://example-kv.upstash.io",
      token: "kv-token",
    });
  });

  it("constructs Redis from Vercel KV aliases in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.stubEnv("KV_REST_API_URL", "https://example-kv.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");

    const result = await applyRateLimit("203.0.113.20");

    expect(result.success).toBe(true);
    expect(redisConstructor).toHaveBeenCalledWith({
      url: "https://example-kv.upstash.io",
      token: "kv-token",
      retry: {
        retries: 1,
        backoff: expect.any(Function),
      },
    });
  });

  it("reuses a singleton Redis client across production rate-limit calls", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    vi.stubEnv("KV_REST_API_URL", "https://example-kv.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");

    const first = await applyRateLimit("203.0.113.30");
    const second = await applyRateLimit("203.0.113.31");

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(redisConstructor).toHaveBeenCalledTimes(1);
  });

  it("falls back to in-memory limits when Upstash throws in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    limitImpl.mockRejectedValueOnce(new Error("fetch failed"));

    const result = await applyRateLimit("203.0.113.40");

    expect(result.success).toBe(true);
    expect(globalThis.__scrutinixRateLimiters).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"upstash_error"'),
    );
    warnSpy.mockRestore();
  });

  it("preserves an Upstash deny when the sibling window throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Minute denies; day rejects. Must not degrade to in-memory (which would admit).
    limitImpl
      .mockResolvedValueOnce({
        success: false,
        remaining: 0,
        reset: 1_900_000_000_000,
      })
      .mockRejectedValueOnce(new Error("day fetch failed"));

    const result = await applyRateLimit("203.0.113.42");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(429);
      expect(result.remaining).toBe(0);
    }
    expect(globalThis.__devRateLimitStore).toBeUndefined();
    expect(globalThis.__scrutinixRateLimiters).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"rate_limit.partial_upstash_failure"'),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('"event":"rate_limit.degraded"'),
    );
    warnSpy.mockRestore();
  });

  it("preserves a day-window Upstash deny when the minute window throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    limitImpl
      .mockRejectedValueOnce(new Error("minute fetch failed"))
      .mockResolvedValueOnce({
        success: false,
        remaining: 0,
        reset: 1_900_000_000_100,
      });

    const result = await applyRateLimit("203.0.113.43");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(429);
    }
    expect(globalThis.__devRateLimitStore).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("rebuilds the Upstash client after a prior failure", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    limitImpl.mockRejectedValueOnce(new Error("fetch failed"));

    await applyRateLimit("203.0.113.41");
    expect(redisConstructor).toHaveBeenCalledTimes(1);

    limitImpl.mockResolvedValue({
      success: true,
      remaining: 8,
      reset: 1_900_000_000_000,
    });
    const recovered = await applyRateLimit("203.0.113.41");

    expect(recovered.success).toBe(true);
    expect(redisConstructor).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("charges the full batch cost against the window", async () => {
    // A 10-URL batch consumes 10 of the 10-per-minute tokens in one call.
    const batch = await applyRateLimit("198.51.100.1", 10);
    expect(batch.success).toBe(true);
    expect(batch.remaining).toBe(0);

    const followUp = await applyRateLimit("198.51.100.1");
    expect(followUp.success).toBe(false);
  });

  it("meters share images on their own budget, never spending scan quota", async () => {
    const scans = await applyRateLimit("198.51.100.9", 10);
    expect(scans.remaining).toBe(0);

    // The scan window is spent, but the image tier is independent.
    const image = await applyRateLimit("198.51.100.9", 1, "image");
    expect(image.success).toBe(true);
    expect(image.remaining).toBe(29);

    // Rendering images never debits the scan window either.
    for (let i = 0; i < 30; i += 1) {
      await applyRateLimit("198.51.100.10", 1, "image");
    }
    const overImages = await applyRateLimit("198.51.100.10", 1, "image");
    expect(overImages.success).toBe(false);
    const scan = await applyRateLimit("198.51.100.10");
    expect(scan.success).toBe(true);
  });

  it("rejects a single request whose cost exceeds the window", async () => {
    const result = await applyRateLimit("198.51.100.2", 11);
    expect(result.success).toBe(false);
  });

  it("sweeps expired windows once the store grows large", async () => {
    await applyRateLimit("198.51.100.3");
    const store = globalThis.__devRateLimitStore;
    expect(store).toBeDefined();

    const expired = Date.now() - 60_000;
    for (let i = 0; i < 5_001; i += 1) {
      store?.set(`minute:one-shot-${i}`, { count: 1, resetAt: expired });
    }

    await applyRateLimit("198.51.100.4");

    expect(store && store.size).toBeLessThan(100);
  });
});
