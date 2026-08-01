import { beforeEach, describe, expect, it, vi } from "vitest";

const redisConstructor = vi.hoisted(() =>
  vi.fn(function Redis() {
    return {};
  }),
);

vi.mock("@upstash/redis", () => ({
  Redis: redisConstructor,
}));

vi.mock("@upstash/ratelimit", () => {
  class MockRatelimit {
    static slidingWindow(limit: number, window: string) {
      return { limit, window };
    }

    async limit() {
      return {
        success: true,
        remaining: 9,
        reset: 1_900_000_000_000,
      };
    }
  }

  return {
    Ratelimit: MockRatelimit,
  };
});

import {
  applyRateLimit,
  getClientRateLimitId,
  getRedisRestConfig,
} from "@/lib/server/rate-limit";

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

  it("charges the full batch cost against the window", async () => {
    // A 10-URL batch consumes 10 of the 10-per-minute tokens in one call.
    const batch = await applyRateLimit("198.51.100.1", 10);
    expect(batch.success).toBe(true);
    expect(batch.remaining).toBe(0);

    const followUp = await applyRateLimit("198.51.100.1");
    expect(followUp.success).toBe(false);
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
