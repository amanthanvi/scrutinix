import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * The share-target launch grant: what `POST /share` stores in the
 * `sx-share-launch` cookie, and what lets the home page start one scan.
 * `<id>.<digest>`: a random id (16 bytes) and the SHA-256 of the exact
 * normalized link (both base64url), so the cookie is 66 characters
 * whatever the link's length (a 2,048-character link, URI-encoded, would
 * pass the 4 KiB cookie limit browsers enforce, and the grant would
 * silently not be set).
 *
 * Nothing here is secret, and the server remembers nothing about a grant.
 * Only Scrutinix's own origin can set a `SameSite=Strict` cookie, so a
 * third-party page can't hand a visitor a grant, and the visitor's own
 * client gains nothing by forging one. It is used once because `proxy.ts`
 * clears the cookie in the first response for `/` that carries it, and the
 * page scans at most once per id (`claimLaunch`, in the browser).
 */
const GRANT_PATTERN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

function digestOf(url: string): string {
  return createHash("sha256").update(url).digest("base64url");
}

/** A new grant for this normalized link. */
export function issueLaunchGrant(url: string): string {
  return `${randomBytes(16).toString("base64url")}.${digestOf(url)}`;
}

/**
 * The grant's random id when it names this exact normalized link, or null
 * (no grant, not a grant, or a grant for another link). The page hands the
 * id to the browser, which records it so the launch scans once.
 */
export function launchGrantId(
  grant: string | null | undefined,
  url: string,
): string | null {
  const match = grant?.match(GRANT_PATTERN);
  return match && match[2] === digestOf(url) ? match[1]! : null;
}
