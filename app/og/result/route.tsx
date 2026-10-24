import { ImageResponse } from "next/og";

import { CARD_SIZE, ResultCard } from "@/lib/og/cards";
import { loadOgFonts } from "@/lib/og/fonts";
import { sharedSnapshotRemainingMs } from "@/lib/domain/signal-signature";
import {
  SHARE_IMAGE_MAX_PAYLOAD,
  describeSharedSnapshot,
  normalizeSharedPayload,
} from "@/lib/server/share-metadata";

/**
 * Per-result share image for `/?shared=` links. The payload is the
 * snapshot the server built and signed when it streamed the result; it is
 * verified against `sig`, validated against the shared-snapshot schema,
 * rendered, and never stored. A missing, oversize, unsigned, tampered,
 * expired (`SHARE_MAX_AGE`), or invalid payload, or one whose link is not
 * an http(s) URL, redirects to the static default card: this route never
 * draws a verdict (or any payload text) Scrutinix did not sign within the
 * last three days. `proxy.ts` meters it on its own rate-limit tier.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const payload = normalizeSharedPayload(params.get("shared"));
  const now = Date.now();
  const card =
    payload && payload.length <= SHARE_IMAGE_MAX_PAYLOAD
      ? describeSharedSnapshot(payload, params.get("sig"), now)
      : null;

  if (!card) {
    return Response.redirect(new URL("/opengraph-image", request.url), 302);
  }

  // Never cached past the snapshot's own three days, so no browser or CDN
  // serves the verdict after the page itself stops showing it.
  const maxAge = Math.min(
    3600,
    Math.floor(sharedSnapshotRemainingMs(card.snapshot.capturedAt, now) / 1000),
  );

  return new ImageResponse(
    <ResultCard
      verdict={card.snapshot.verdict}
      tone={card.guidance.tone}
      imperative={card.imperative}
      domain={card.domain}
      impersonates={card.impersonates}
      signature={card.snapshot.signature}
      capturedAt={card.snapshot.capturedAt}
    />,
    {
      ...CARD_SIZE,
      fonts: await loadOgFonts(),
      headers: {
        // Short and revalidating, never immutable: after a leaked key is
        // revoked, images already drawn for forged links must age out
        // within the hour. No stale-while-revalidate for the same reason.
        "Cache-Control":
          maxAge >= 1
            ? `public, max-age=${maxAge}, s-maxage=${maxAge}`
            : "no-store",
      },
    },
  );
}
