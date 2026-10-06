import { createHash } from "node:crypto";

import type { Redis } from "@upstash/redis";

import type { AnalysisResult } from "@/lib/domain/types";
import { sanitizeAnalysisResult } from "@/lib/domain/runtime-safety";
import { withTimeout } from "@/lib/server/http";
import { getRedisRestConfig } from "@/lib/server/redis-config";

export const FULL_RESULT_TTL_MS = 1000 * 60 * 15;
const REMOTE_CACHE_TIMEOUT_MS = 1_000;

interface RemoteCacheEntry {
  value: unknown;
  ttlMs: number;
}

/** Minimal remote store surface so tests can inject a fake. */
export interface RemoteCacheStore {
  get(key: string): Promise<RemoteCacheEntry | null>;
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
    const namespacedKey = remoteKey(key);
    if (!remote || !namespacedKey) {
      return null;
    }

    try {
      const entry = await withTimeout(
        remote.get(namespacedKey),
        REMOTE_CACHE_TIMEOUT_MS,
        "Shared cache read",
      );
      if (!entry || entry.ttlMs <= 0) {
        return null;
      }

      const result = sanitizeAnalysisResult(entry.value);
      if (!result) {
        return null;
      }

      this.setLocal(key, result, entry.ttlMs);
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
    const namespacedKey = remoteKey(key);
    if (!remote || !namespacedKey) {
      return;
    }

    try {
      await withTimeout(
        remote.set(namespacedKey, result, ttlMs),
        REMOTE_CACHE_TIMEOUT_MS,
        "Shared cache write",
      );
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
/** Null when no isolated namespace is available; the shared cache is then skipped. */
function remoteKey(key: string) {
  const namespace = cacheNamespace();
  return namespace
    ? `sx:result:${namespace}:${createHash("sha256").update(key).digest("hex")}`
    : null;
}

/**
 * One Redis store serves every Vercel environment, so results are
 * namespaced: a preview running different code must never answer production
 * scans. Each preview commit gets its own namespace for the same reason;
 * production keeps one so the cache stays warm across releases. Outside
 * Vercel (local dev with real credentials) the namespace is "local".
 */
function cacheNamespace(): string | null {
  const env = process.env.VERCEL_ENV?.trim().toLowerCase();
  if (env === "production" || env === "development") {
    return env;
  }
  if (env === "preview") {
    // Fail closed: without a per-deployment identity, previews could share
    // a namespace, so they skip the shared cache instead.
    const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim().toLowerCase();
    if (sha && /^[0-9a-f]{7,40}$/.test(sha)) {
      return `preview-${sha.slice(0, 12)}`;
    }
    const deployment = process.env.VERCEL_DEPLOYMENT_ID?.trim();
    if (deployment && /^[a-zA-Z0-9_]{1,64}$/.test(deployment)) {
      return `preview-${deployment.toLowerCase()}`;
    }
    return null;
  }
  return "local";
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
    get: async (key) => {
      const client = await redis;
      const [value, ttlMs] = await Promise.all([
        client.get(key),
        client.pttl(key),
      ]);
      return value === null || ttlMs <= 0 ? null : { value, ttlMs };
    },
    set: async (key, value, ttlMs) =>
      (await redis).set(key, value, { px: ttlMs }),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
