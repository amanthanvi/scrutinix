import { describe, expect, it, vi } from "vitest";

import { ResultCache, type RemoteCacheStore } from "@/lib/server/cache";
import {
  createPendingSignalResults,
  type AnalysisResult,
} from "@/lib/domain/types";

const NO_REMOTE = () => null;

describe("ResultCache", () => {
  it("stores and returns cloned results", async () => {
    const cache = new ResultCache(2, NO_REMOTE);
    const result = buildResult("https://example.com/");

    await cache.set("key", result, 60_000);
    const cached = await cache.get("key");

    expect(cached).toEqual(result);
    expect(cached).not.toBe(result);
  });

  it("expires stale entries", async () => {
    vi.useFakeTimers();
    const cache = new ResultCache(2, NO_REMOTE);
    await cache.set("key", buildResult("https://example.com/"), 1_000);

    vi.advanceTimersByTime(1_500);
    expect(await cache.get("key")).toBeNull();
    vi.useRealTimers();
  });

  it("evicts the least recently used entry beyond maxEntries", async () => {
    const cache = new ResultCache(2, NO_REMOTE);
    await cache.set("a", buildResult("https://a.example/"), 60_000);
    await cache.set("b", buildResult("https://b.example/"), 60_000);

    // Touch "a" so "b" becomes the least recently used entry.
    await cache.get("a");
    await cache.set("c", buildResult("https://c.example/"), 60_000);

    expect(await cache.get("a")).not.toBeNull();
    expect(await cache.get("b")).toBeNull();
    expect(await cache.get("c")).not.toBeNull();
  });

  it("falls back to the remote store and revalidates its contents", async () => {
    const stored = buildResult("https://remote.example/");
    const remote: RemoteCacheStore = {
      get: vi.fn(async () => stored as unknown),
      set: vi.fn(async () => "OK"),
    };
    const cache = new ResultCache(2, () => remote);

    const hit = await cache.get("remote-key");
    expect(hit).toMatchObject({ url: "https://remote.example/" });
    expect(remote.get).toHaveBeenCalledOnce();

    // Second read is served from the hydrated local layer.
    await cache.get("remote-key");
    expect(remote.get).toHaveBeenCalledOnce();
  });

  it("rejects remote values that fail schema validation", async () => {
    const remote: RemoteCacheStore = {
      get: vi.fn(async () => "not-an-analysis-result"),
      set: vi.fn(async () => "OK"),
    };
    const cache = new ResultCache(2, () => remote);

    expect(await cache.get("poisoned")).toBeNull();
  });

  it("hashes keys before they reach the remote store", async () => {
    const seen: string[] = [];
    const remote: RemoteCacheStore = {
      get: vi.fn(async () => null),
      set: vi.fn(async (key: string) => {
        seen.push(key);
        return "OK";
      }),
    };
    const cache = new ResultCache(2, () => remote);

    await cache.set(
      "https://secret.example/private-path",
      buildResult("https://secret.example/private-path"),
      60_000,
    );

    expect(seen[0]).toMatch(/^sx:result:[0-9a-f]{64}$/);
    expect(seen[0]).not.toContain("secret.example");
  });

  it("survives a throwing remote store", async () => {
    const remote: RemoteCacheStore = {
      get: vi.fn(async () => {
        throw new Error("redis down");
      }),
      set: vi.fn(async () => {
        throw new Error("redis down");
      }),
    };
    const cache = new ResultCache(2, () => remote);
    const result = buildResult("https://example.com/");

    await expect(cache.set("key", result, 60_000)).resolves.toBeUndefined();
    expect(await cache.get("key")).toEqual(result);
  });
});

function buildResult(url: string): AnalysisResult {
  return {
    id: "scan-1",
    url,
    verdict: "safe",
    signals: createPendingSignalResults(),
    threatInfo: null,
    metadata: {
      scanId: "scan-1",
      startedAt: "2026-03-06T00:00:00.000Z",
      completedAt: "2026-03-06T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}
