import type { Metadata } from "next";
import { parse } from "tldts";

import { splitLinkAnatomy, type LinkAnatomy } from "@/lib/domain/link-anatomy";
import {
  decodeSharedSnapshot,
  type SharedView,
} from "@/lib/domain/signal-signature";
import type { SharedSnapshot } from "@/lib/domain/types";
import { verifySharePayload } from "@/lib/server/share-signing";
import {
  getVerdictGuidance,
  ownershipSentence,
  shareHeadline,
  type VerdictGuidance,
} from "@/lib/domain/verdict-guidance";

/** Route of the per-result share image (`app/og/result/route.tsx`). */
export const SHARE_IMAGE_PATH = "/og/result";

/**
 * Longest `?shared=` value the image route renders. Real snapshots are a
 * few KB; the page itself accepts up to 12k (`decodeSharedSnapshot`), but
 * a rendered PNG is the expensive part, so oversize payloads get the
 * static default card instead (and their pages advertise no per-result
 * image).
 */
export const SHARE_IMAGE_MAX_PAYLOAD = 6_000;

export interface SharedCard {
  snapshot: SharedSnapshot;
  /**
   * The shared link's anatomy, computed with the Public Suffix List on the
   * server so the first render (and hydration) of a shared view already
   * knows the owner and any look-alike, before the browser loads tldts.
   */
  anatomy: LinkAnatomy;
  /** The registered domain that owns the shared link. */
  domain: string;
  impersonates: string | null;
  imperative: string;
  /** Band tone and instruction for the card. */
  guidance: VerdictGuidance;
}

/**
 * A `?shared=` value as the server signed it. Base64 never contains a
 * space, so a space can only be a "+" that query decoding turned into one
 * (a chat client or shortener left it raw instead of %2B). Restoring it
 * changes nothing the signature covers: the HMAC is still checked against
 * the exact canonical string.
 */
export function normalizeSharedPayload(
  payload: string | null | undefined,
): string | null {
  return payload ? payload.replace(/ /g, "+") : null;
}

/**
 * What the page shows for a `?shared=` link. Null when the payload fails
 * validation or its link is not an http(s) URL. Otherwise the link and
 * its anatomy (Scrutinix's own computation), plus the snapshot only when
 * `sig` is this server's signature of the payload: an unsigned or
 * tampered payload is someone's claim, never Scrutinix's statement.
 */
export function resolveSharedView(
  payload: string | null | undefined,
  sig: string | null | undefined,
): SharedView | null {
  payload = normalizeSharedPayload(payload);
  const snapshot = decodeSharedSnapshot(payload);
  if (!snapshot) return null;

  const anatomy = splitLinkAnatomy(parse, snapshot.url);
  if (!anatomy) return null;

  return {
    url: snapshot.url,
    anatomy,
    snapshot: verifySharePayload(payload, sig) ? snapshot : null,
  };
}

/**
 * Everything a share preview states, derived from a verified snapshot.
 * Null when the payload is unsigned, tampered, or fails validation, or its
 * link is not an http(s) URL: a preview never states a verdict (or prints
 * any payload text, the domain included) that Scrutinix did not sign.
 */
export function describeSharedSnapshot(
  payload: string | null | undefined,
  sig: string | null | undefined,
): SharedCard | null {
  const view = resolveSharedView(payload, sig);
  const snapshot = view?.snapshot;
  if (!view || !snapshot) return null;

  const anatomy = view.anatomy;
  const impersonates = anatomy.impersonates;
  const guidance = getVerdictGuidance({
    verdict: snapshot.verdict,
    threatInfo: null,
    impersonates,
  });
  return {
    snapshot,
    anatomy,
    domain: anatomy.registeredDomain,
    impersonates,
    imperative: guidance.imperative,
    guidance,
  };
}

/**
 * Metadata for a `/?shared=` page: the title and description state the
 * result, and og:image / twitter:image point at the per-result card. Null
 * (the site defaults apply) unless the payload is signed by this server,
 * valid, and its link is an http(s) URL.
 */
export function getSharedMetadata(
  payload: string | null | undefined,
  sig: string | null | undefined,
): Metadata | null {
  payload = normalizeSharedPayload(payload);
  const card = describeSharedSnapshot(payload, sig);
  if (!card || !payload || !sig) return null;

  // A Safe look-alike never leads with "Safe": many chat clients show
  // only the title and image, so the hedge cannot live in the description.
  const headline = shareHeadline({
    verdict: card.snapshot.verdict,
    impersonates: card.impersonates,
  });
  const title = `${headline}: ${card.domain} — Scrutinix`;
  // The title names the domain; a look-alike's description states the
  // owner instead of repeating it.
  const description = card.impersonates
    ? `${card.imperative} ${ownershipSentence(card.domain, card.impersonates)}`
    : `${card.imperative} A shared Scrutinix result for ${card.domain}.`;
  const alt = `Scrutinix result for ${card.domain}: ${headline}.`;
  // Oversize payloads fall back to the default card (no `images` key).
  const images =
    payload.length <= SHARE_IMAGE_MAX_PAYLOAD
      ? [
          {
            url: shareImagePath(payload, sig),
            width: 1200,
            height: 630,
            alt,
          },
        ]
      : undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "Scrutinix",
      type: "website",
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(images ? { images } : {}),
    },
  };
}

/** The per-result image for a signed payload. */
export function shareImagePath(payload: string, sig: string): string {
  const params = new URLSearchParams({ shared: payload, sig });
  return `${SHARE_IMAGE_PATH}?${params.toString()}`;
}
