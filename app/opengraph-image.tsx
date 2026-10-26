import { ImageResponse } from "next/og";

import { CARD_SIZE, DefaultCard } from "@/lib/og/cards";
import { loadOgFonts } from "@/lib/og/fonts";

// The card's own words, in order: the wordmark, the home headline, and the
// supporting line under it.
export const alt =
  "Scrutinix: Is this link what it says it is? Eight separate checks tell you whether it's safe to open, and which site it really belongs to.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(<DefaultCard />, {
    ...size,
    fonts: await loadOgFonts(),
  });
}
