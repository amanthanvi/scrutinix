import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  SHARE_LAUNCH_WINDOW_MS,
  type LaunchGrant,
} from "@/lib/domain/share-launch";

/**
 * The share-target launch grant: what `POST /share` stores in the
 * `sx-share-launch` cookie, and what lets the home page start one scan.
 * `<id>.<issuedAt>.<digest>`: a random id (16 bytes, base64url), the
 * server's time in milliseconds when it was issued, and the SHA-256 of the
 * exact normalized link (base64url), so the cookie is 80 characters
 * whatever the link's length (a 2,048-character link, URI-encoded, would
 * pass the 4 KiB cookie limit browsers enforce, and the grant would
 * silently not be set). The issue time lets the browser refuse a grant
 * that reaches it after its minute (`SHARE_LAUNCH_WINDOW_MS`).
 *
 * Nothing here is secret, and the server remembers nothing about a grant.
 * Only Scrutinix's own origin can set a `SameSite=Strict` cookie, so a
 * third-party page can't hand a visitor a grant, and the visitor's own
 * client gains nothing by forging one. It is used once because `proxy.ts`
 * clears the cookie in the first response for `/` that carries it, and the
 * page scans at most once per id (`claimLaunch`, in the browser).
 */
const GRANT_PATTERN = /^([A-Za-z0-9_-]{22})\.(\d{13})\.([A-Za-z0-9_-]{43})$/;

function digestOf(url: string): string {
  return createHash("sha256").update(url).digest("base64url");
}

/** A new grant for this normalized link, issued at `now`. */
export function issueLaunchGrant(url: string, now = Date.now()): string {
  return `${randomBytes(16).toString("base64url")}.${now}.${digestOf(url)}`;
}

/**
 * The grant's random id and issue time when it names this exact
 * normalized link and was issued within a minute of `now` (the page's
 * render), or null (no grant, not a grant, a grant for another link, or
 * one too old or from the future). The page hands it to the browser, which
 * records the id so the launch scans once, and only in its minute.
 */
export function readLaunchGrant(
  grant: string | null | undefined,
  url: string,
  now: number,
): LaunchGrant | null {
  const match = grant?.match(GRANT_PATTERN);
  if (!match || match[3] !== digestOf(url)) return null;
  const issuedAt = Number(match[2]);
  if (Math.abs(now - issuedAt) > SHARE_LAUNCH_WINDOW_MS) return null;
  return { id: match[1]!, issuedAt };
}
