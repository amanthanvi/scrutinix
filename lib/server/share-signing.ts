import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getEnv } from "@/lib/config/env";
import {
  SHARE_SIGNATURE_PATTERN,
  SHARED_PAYLOAD_MAX_LENGTH,
  type AnalysisResult,
  type ResultShare,
} from "@/lib/domain/schemas";
import {
  buildSharedSnapshot,
  encodeSharedSnapshot,
} from "@/lib/domain/signal-signature";

/**
 * Server-only share-link signing. A `?shared=` payload is plain base64
 * anyone can write, so the page, its metadata, and the share image state a
 * verdict only for payloads this server signed:
 *
 *   sig = base64url(HMAC-SHA256(SHARE_SIGNING_SECRET,
 *                               "scrutinix-share-v1\n" + payload))
 *
 * over the exact payload string. `SHARE_SIGNING_SECRET_PREVIOUS` verifies
 * (never signs) during key rotation, and only while a current secret is
 * set: with no current secret, sharing is unsigned and every link opens
 * the neutral view. Nothing here logs the secret, a payload, or a URL.
 */

const DOMAIN_PREFIX = "scrutinix-share-v1\n";

function signWith(key: string, payload: string): string {
  return createHmac("sha256", key)
    .update(DOMAIN_PREFIX + payload, "utf8")
    .digest("base64url");
}

/** The signature for `payload`, or null when no secret is configured. */
export function signSharePayload(payload: string): string | null {
  try {
    const key = getEnv().SHARE_SIGNING_SECRET;
    return key ? signWith(key, payload) : null;
  } catch {
    return null;
  }
}

/**
 * True only when `sig` is this server's signature of exactly `payload`
 * under the current or previous secret. Never throws: missing, malformed,
 * oversize, or wrong-length input is simply unverified.
 */
export function verifySharePayload(payload: unknown, sig: unknown): boolean {
  try {
    if (typeof payload !== "string" || typeof sig !== "string") return false;
    if (!payload || payload.length > SHARED_PAYLOAD_MAX_LENGTH) return false;
    // Canonical base64url only, so a signature has exactly one spelling.
    if (!SHARE_SIGNATURE_PATTERN.test(sig)) return false;

    const env = getEnv();
    if (!env.SHARE_SIGNING_SECRET) return false;
    const keys = [env.SHARE_SIGNING_SECRET, env.SHARE_SIGNING_SECRET_PREVIOUS];

    const given = Buffer.from(sig, "utf8");
    let verified = false;
    for (const key of keys) {
      if (!key) continue;
      const expected = Buffer.from(signWith(key, payload), "utf8");
      // Equal lengths by construction (both 43 characters); checked anyway
      // because timingSafeEqual throws on a mismatch.
      if (
        expected.length === given.length &&
        timingSafeEqual(expected, given)
      ) {
        verified = true;
      }
    }
    return verified;
  } catch {
    return false;
  }
}

/**
 * The share link parts for a completed result: the canonical snapshot
 * payload, signed when a secret is configured. Built on the server from
 * the result it is about to stream, so a signature only ever covers what
 * Scrutinix itself concluded.
 */
export function issueResultShare(result: AnalysisResult): ResultShare | null {
  const payload = encodeSharedSnapshot(buildSharedSnapshot(result));
  if (payload.length > SHARED_PAYLOAD_MAX_LENGTH) return null;
  const sig = signSharePayload(payload);
  return sig ? { payload, sig } : { payload };
}

/** `result` with its server-issued share attached (a copy; never mutates). */
export function withResultShare(result: AnalysisResult): AnalysisResult {
  const issued: AnalysisResult = { ...result };
  // Never pass on a share this server did not just issue.
  delete issued.share;
  const share = issueResultShare(issued);
  if (share) issued.share = share;
  return issued;
}
