import { describe, expect, it, vi } from "vitest";

import {
  FULL_RESULT_TTL_MS,
  REDUCED_COVERAGE_TTL_MS,
  ResultCache,
  resolveResultCacheTtl,
  type RemoteCacheStore,
} from "@/lib/server/cache";
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
      get: vi.fn(async () => ({ value: stored, ttlMs: 12_000 })),
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
      get: vi.fn(async () => ({
        value: "not-an-analysis-result",
        ttlMs: 12_000,
      })),
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

  it("preserves a remote entry's remaining TTL in the local layer", async () => {
    vi.useFakeTimers();
    const stored = buildResult("https://remote.example/");
    const remote: RemoteCacheStore = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ value: stored, ttlMs: 1_000 })
        .mockResolvedValueOnce(null),
      set: vi.fn(async () => "OK"),
    };
    const cache = new ResultCache(2, () => remote);

    expect(await cache.get("remote-key")).toEqual(stored);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await cache.get("remote-key")).toBeNull();
    expect(remote.get).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("bounds a stalled remote write", async () => {
    vi.useFakeTimers();
    const remote: RemoteCacheStore = {
      get: vi.fn(async () => null),
      set: vi.fn(() => new Promise(() => undefined)),
    };
    const cache = new ResultCache(2, () => remote);
    const write = cache.set("key", buildResult("https://example.com/"), 60_000);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(write).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe("resolveResultCacheTtl", () => {
  it("gives complete scans the full TTL", () => {
    expect(
      resolveResultCacheTtl(buildResult("https://a.example/"), false),
    ).toBe(FULL_RESULT_TTL_MS);
  });

  it("never caches errored, partial-failure, or aborted scans", () => {
    const errored = buildResult("https://a.example/");
    errored.verdict = "error";
    expect(resolveResultCacheTtl(errored, false)).toBeNull();

    const partial = buildResult("https://a.example/");
    partial.metadata.partialFailure = true;
    expect(resolveResultCacheTtl(partial, false)).toBeNull();

    expect(
      resolveResultCacheTtl(buildResult("https://a.example/"), true),
    ).toBeNull();
  });

  it("shortens the TTL when a composite signal degraded with warnings", () => {
    const feedsDegraded = buildResult("https://a.example/");
    feedsDegraded.signals.threatFeeds = {
      status: "success",
      error: null,
      durationMs: 10,
      data: {
        checkedAt: "2026-03-06T00:00:00.000Z",
        matches: [],
        observations: [],
        warnings: ["ThreatFox lookup failed: timeout."],
      },
    };
    expect(resolveResultCacheTtl(feedsDegraded, false)).toBe(
      REDUCED_COVERAGE_TTL_MS,
    );

    const mlDegraded = buildResult("https://a.example/");
    mlDegraded.signals.mlEnsemble = {
      status: "success",
      error: null,
      durationMs: 10,
      data: {
        transformerModel: null,
        lexicalModel: {
          label: "benign",
          score: 0.1,
          reasons: [],
          model: "lexical-heuristic",
        },
        consensusLabel: "benign",
        consensusScore: 0.1,
        reasons: [],
        warnings: ["The local URL classifier failed."],
      },
    };
    expect(resolveResultCacheTtl(mlDegraded, false)).toBe(
      REDUCED_COVERAGE_TTL_MS,
    );
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
