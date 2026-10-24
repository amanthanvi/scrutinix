import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { Redis } from "@upstash/redis";

import { SHARE_LAUNCH_MAX_AGE_SECONDS } from "@/lib/domain/share-launch";
import { redactForLogs } from "@/lib/server/client-error";
import { logWarn } from "@/lib/server/logger";
import { getRedisRestConfig } from "@/lib/server/redis-config";

/**
 * The share-target launch grant: what `POST /share` stores in the
 * `sx-share-launch` cookie, and what the home page redeems to start one
 * scan. `<id>.<digest>`: a random one-use id (16 bytes) and the SHA-256 of
 * the exact normalized link (both base64url), so the cookie is 66
 * characters whatever the link's length (a 2,048-character link,
 * URI-encoded, would pass the 4 KiB cookie limit browsers enforce, and the
 * grant would silently not be set).
 *
 * Nothing here is secret: only Scrutinix's own origin can set a
 * `SameSite=Strict` cookie, so a third-party page can't hand a visitor a
 * grant, and the visitor's own client gains nothing by forging one.
 */
const GRANT_PATTERN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

/**
 * How long a spent id is remembered: longer than the cookie can live, so
 * a cookie a browser still holds is always recognised as spent.
 */
const SPENT_TTL_MS = 2 * SHARE_LAUNCH_MAX_AGE_SECONDS * 1000;

/** In-memory spent ids before expired ones are swept. */
const SPENT_SWEEP_THRESHOLD = 5_000;
/** Past this many live ids (a flood), redeem nothing rather than grow. */
const SPENT_CAPACITY = 50_000;

declare global {
  var __shareLaunchRedis: Promise<Redis> | null | undefined;
  var __spentShareLaunches: Map<string, number> | undefined;
}

function digestOf(url: string): string {
  return createHash("sha256").update(url).digest("base64url");
}

/** A new grant for this normalized link. */
export function issueLaunchGrant(url: string): string {
  return `${randomBytes(16).toString("base64url")}.${digestOf(url)}`;
}

/**
 * Whether the grant names this exact normalized link and has not been
 * redeemed before; redeeming spends it. The id is spent with one atomic
 * set-if-absent in the shared store (Upstash, when configured), so of two
 * requests carrying the same cookie at once only one scans. Without the
 * shared store (or while it errors) the id is spent in this process's
 * memory, which still holds for every request this instance serves.
 */
export async function redeemLaunchGrant(
  grant: string | null | undefined,
  url: string,
): Promise<boolean> {
  const match = grant?.match(GRANT_PATTERN);
  if (!match || match[2] !== digestOf(url)) return false;
  return spendOnce(match[1]!);
}

async function spendOnce(id: string): Promise<boolean> {
  const redis = sharedRedis();
  if (redis) {
    try {
      const reply = await (
        await redis
      ).set(`sx:share-launch:${id}`, 1, { nx: true, px: SPENT_TTL_MS });
      return reply === "OK";
    } catch (error) {
      // Drop the client so the next launch can rebuild it.
      globalThis.__shareLaunchRedis = undefined;
      const detail = error instanceof Error ? error.message : undefined;
      logWarn("share_launch.degraded", {
        mode: "in-memory",
        ...(detail ? { detail: redactForLogs(detail) } : {}),
        message: "Spending this launch grant in process memory.",
      });
    }
  }
  return spendInMemory(id);
}

/** Development and tests never reach a real store, as with rate limits. */
function sharedRedis(): Promise<Redis> | null {
  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
  ) {
    return null;
  }
  if (globalThis.__shareLaunchRedis === undefined) {
    const { url, token } = getRedisRestConfig();
    // Lazy, as in cache.ts: no Upstash client unless it is configured.
    globalThis.__shareLaunchRedis =
      url && token
        ? import("@upstash/redis").then(
            (module) =>
              new module.Redis({
                url,
                token,
                // Fail fast: the page waits on this.
                retry: { retries: 1, backoff: () => 50 },
              }),
          )
        : null;
  }
  return globalThis.__shareLaunchRedis;
}

function spendInMemory(id: string): boolean {
  const spent = (globalThis.__spentShareLaunches ??= new Map());
  const now = Date.now();
  if (spent.size > SPENT_SWEEP_THRESHOLD) {
    for (const [key, expiresAt] of spent) {
      if (expiresAt <= now) spent.delete(key);
    }
  }
  const expiresAt = spent.get(id);
  if (expiresAt !== undefined && expiresAt > now) return false;
  if (spent.size >= SPENT_CAPACITY) return false;
  spent.set(id, now + SPENT_TTL_MS);
  return true;
}
