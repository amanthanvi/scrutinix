import { createHash } from "node:crypto";

import type { Redis } from "@upstash/redis";

import type { AnalysisResult } from "@/lib/domain/types";
import { sanitizeAnalysisResult } from "@/lib/domain/runtime-safety";
import { getRedisRestConfig } from "@/lib/server/redis-config";

export const FULL_RESULT_TTL_MS = 1000 * 60 * 15;
export const DEGRADED_RESULT_TTL_MS = 1000 * 60 * 5;

/** Minimal remote store surface so tests can inject a fake. */
export interface RemoteCacheStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: AnalysisResult, ttlMs: number): Promise<unknown>;
}

interface CacheEntry {
  result: AnalysisResult;
  expiresAt: number;
}

/**
 * Layered result cache: per-process LRU in front of an optional shared
 * Upstash store, so serverless instances stop re-running full scans the
 * moment any sibling instance has a fresh result. Remote values are
 * revalidated with the domain schema on read - Redis contents are never
 * trusted blindly.
 */
export class ResultCache {
  constructor(
    private readonly maxEntries = 200,
    private readonly getRemote: () => RemoteCacheStore | null = getSharedRedisStore,
    private readonly entries = new Map<string, CacheEntry>(),
  ) {}

  async get(key: string): Promise<AnalysisResult | null> {
    const local = this.getLocal(key);
    if (local) {
      return local;
    }

    const remote = this.getRemote();
    if (!remote) {
      return null;
    }

    try {
      const value = await remote.get(remoteKey(key));
      if (!value) {
        return null;
      }

      const result = sanitizeAnalysisResult(value);
      if (!result) {
        return null;
      }

      this.setLocal(key, result, DEGRADED_RESULT_TTL_MS);
      return result;
    } catch {
      return null;
    }
  }

  async set(
    key: string,
    result: AnalysisResult,
    ttlMs = FULL_RESULT_TTL_MS,
  ): Promise<void> {
    this.setLocal(key, result, ttlMs);

    const remote = this.getRemote();
    if (!remote) {
      return;
    }

    try {
      await remote.set(remoteKey(key), result, ttlMs);
    } catch {
      // Shared cache is best-effort; the local layer already has the entry.
    }
  }

  clear() {
    this.entries.clear();
  }

  private getLocal(key: string): AnalysisResult | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return clone(entry.result);
  }

  private setLocal(key: string, result: AnalysisResult, ttlMs: number) {
    this.entries.delete(key);
    this.entries.set(key, {
      result: clone(result),
      expiresAt: Date.now() + ttlMs,
    });

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}

declare global {
  var __analysisCache: ResultCache | undefined;
  var __analysisRedis: Promise<Redis> | null | undefined;
}

export const analysisCache = globalThis.__analysisCache ?? new ResultCache();

if (!globalThis.__analysisCache) {
  globalThis.__analysisCache = analysisCache;
}

/** Hash cache keys so raw scanned URLs never appear as Redis keys. */
function remoteKey(key: string) {
  return `sx:result:${createHash("sha256").update(key).digest("hex")}`;
}

function getSharedRedisStore(): RemoteCacheStore | null {
  if (globalThis.__analysisRedis === undefined) {
    const { url, token } = getRedisRestConfig();
    // Lazy import keeps @upstash/redis out of the module graph when the
    // shared cache is not configured.
    globalThis.__analysisRedis =
      url && token
        ? import("@upstash/redis").then(
            (module) => new module.Redis({ url, token }),
          )
        : null;
  }

  const redis = globalThis.__analysisRedis;
  if (!redis) {
    return null;
  }

  return {
    get: async (key) => (await redis).get(key),
    set: async (key, value, ttlMs) =>
      (await redis).set(key, value, { px: ttlMs }),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
