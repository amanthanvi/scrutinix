import { ImageResponse } from "next/og";

import { CARD_SIZE, ResultCard } from "@/lib/og/cards";
import { loadOgFonts } from "@/lib/og/fonts";
import {
  SHARE_IMAGE_MAX_PAYLOAD,
  describeSharedSnapshot,
} from "@/lib/server/share-metadata";

/**
 * Per-result share image for `/?shared=` links. The payload is the same
 * client-built snapshot the page decodes; it is validated against the
 * shared-snapshot schema, rendered, and never stored. A missing, oversize,
 * or invalid payload, or one whose link is not an http(s) URL, redirects to the static default card rather than
 * rendering anything (or an error image). `proxy.ts` meters this route on
 * its own rate-limit tier.
 */
export async function GET(request: Request) {
  const payload = new URL(request.url).searchParams.get("shared");
  const card =
    payload && payload.length <= SHARE_IMAGE_MAX_PAYLOAD
      ? describeSharedSnapshot(payload)
      : null;

  if (!card) {
    return Response.redirect(new URL("/opengraph-image", request.url), 302);
  }

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
        "Cache-Control": "public, max-age=86400, immutable",
      },
    },
  );
}
