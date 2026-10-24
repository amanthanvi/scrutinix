import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const redisSet = vi.hoisted(() => vi.fn());

vi.mock("@upstash/redis", () => ({
  Redis: class {
    set = redisSet;
  },
}));

import {
  issueLaunchGrant,
  redeemLaunchGrant,
} from "@/lib/server/share-launch-grant";

const LINK = "https://parcel-help.example/track?id=42";

beforeEach(() => {
  globalThis.__spentShareLaunches = undefined;
  globalThis.__shareLaunchRedis = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  redisSet.mockReset();
});

describe("issueLaunchGrant", () => {
  it("is 66 characters, however long the link", () => {
    const long = `https://example.com/${"/".repeat(1_500)}a`;
    for (const url of [LINK, long]) {
      const grant = issueLaunchGrant(url);
      expect(grant).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
      // Cookie-safe as is: nothing to URI-encode.
      expect(encodeURIComponent(grant)).toBe(grant);
    }
  });

  it("is new each time, so each launch is its own one-use grant", () => {
    expect(issueLaunchGrant(LINK)).not.toBe(issueLaunchGrant(LINK));
  });
});

describe("redeemLaunchGrant", () => {
  it("scans once: a second render or reload with the same grant gets nothing", async () => {
    const grant = issueLaunchGrant(LINK);
    expect(await redeemLaunchGrant(grant, LINK)).toBe(true);
    expect(await redeemLaunchGrant(grant, LINK)).toBe(false);
    // A fresh launch of the same link is a new grant.
    expect(await redeemLaunchGrant(issueLaunchGrant(LINK), LINK)).toBe(true);
  });

  it("lets only one of two requests carrying the same grant at once scan", async () => {
    const grant = issueLaunchGrant(LINK);
    const results = await Promise.all([
      redeemLaunchGrant(grant, LINK),
      redeemLaunchGrant(grant, LINK),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("refuses a grant for a different link, and leaves it unspent", async () => {
    const grant = issueLaunchGrant(LINK);
    expect(await redeemLaunchGrant(grant, "https://other.example/")).toBe(
      false,
    );
    expect(await redeemLaunchGrant(grant, LINK)).toBe(true);
  });

  it("refuses anything that isn't a grant", async () => {
    for (const value of [
      null,
      undefined,
      "",
      LINK,
      encodeURIComponent(LINK),
      `${issueLaunchGrant(LINK)}x`,
      `x${issueLaunchGrant(LINK)}`,
    ]) {
      expect(await redeemLaunchGrant(value, LINK), String(value)).toBe(false);
    }
  });

  describe("with the shared store", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://redis.test");
      vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    });

    it("spends the grant with one set-if-absent, so only the first request scans", async () => {
      const keys = new Set<string>();
      redisSet.mockImplementation(async (key: string) => {
        if (keys.has(key)) return null;
        keys.add(key);
        return "OK";
      });
      const grant = issueLaunchGrant(LINK);

      expect(await redeemLaunchGrant(grant, LINK)).toBe(true);
      expect(await redeemLaunchGrant(grant, LINK)).toBe(false);
      const [key, , options] = redisSet.mock.calls[0]!;
      expect(key).toBe(`sx:share-launch:${grant.split(".")[0]}`);
      // The link is never a key: only the random id.
      expect(String(key)).not.toContain("parcel");
      expect(options).toEqual({ nx: true, px: 120_000 });
      // Nothing was spent in this process's memory.
      expect(globalThis.__spentShareLaunches).toBeUndefined();
    });

    it("spends it in memory while the store errors", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      redisSet.mockRejectedValue(new Error("connect ECONNREFUSED"));
      const grant = issueLaunchGrant(LINK);

      expect(await redeemLaunchGrant(grant, LINK)).toBe(true);
      expect(await redeemLaunchGrant(grant, LINK)).toBe(false);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
