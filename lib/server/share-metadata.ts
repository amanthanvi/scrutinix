import type { Metadata } from "next";
import { parse } from "tldts";

import { splitLinkAnatomy, type LinkAnatomy } from "@/lib/domain/link-anatomy";
import { decodeSharedSnapshot } from "@/lib/domain/signal-signature";
import type { SharedSnapshot } from "@/lib/domain/types";
import {
  getVerdictGuidance,
  isLookAlikeSafe,
  ownershipSentence,
  verdictLabel,
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
 * Everything a share preview states, derived from a validated snapshot.
 * Null when the payload fails validation or its link is not an http(s)
 * URL: the card would otherwise print arbitrary text as the "domain"
 * under Scrutinix branding.
 */
export function describeSharedSnapshot(
  payload: string | null | undefined,
): SharedCard | null {
  const snapshot = decodeSharedSnapshot(payload);
  if (!snapshot) return null;

  const anatomy = splitLinkAnatomy(parse, snapshot.url);
  if (!anatomy) return null;

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
 * when the payload is missing, fails validation, or its link is not an
 * http(s) URL (the defaults apply).
 */
export function getSharedMetadata(
  payload: string | null | undefined,
): Metadata | null {
  const card = describeSharedSnapshot(payload);
  if (!card || !payload) return null;

  const headline = verdictLabel(card.snapshot.verdict);
  const title = `${headline}: ${card.domain} — Scrutinix`;
  // The title names the domain; a look-alike's description states the
  // owner instead of repeating it.
  const description = card.impersonates
    ? `${card.imperative} ${ownershipSentence(card.domain, card.impersonates)}`
    : `${card.imperative} A shared Scrutinix result for ${card.domain}.`;
  const alt = isLookAlikeSafe({
    verdict: card.snapshot.verdict,
    impersonates: card.impersonates,
  })
    ? `Scrutinix result for ${card.domain}: look-alike of ${card.impersonates}.`
    : `Scrutinix result for ${card.domain}: ${headline}.`;
  // Oversize payloads fall back to the default card (no `images` key).
  const images =
    payload.length <= SHARE_IMAGE_MAX_PAYLOAD
      ? [
          {
            url: `${SHARE_IMAGE_PATH}?shared=${encodeURIComponent(payload)}`,
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
