import { ImageResponse } from "next/og";

import { CARD_SIZE, DefaultCard } from "@/lib/og/cards";
import { loadOgFonts } from "@/lib/og/fonts";

export const alt =
  "Scrutinix: check a link before you click. Eight independent checks, one plain verdict.";
export const size = CARD_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(<DefaultCard />, {
    ...size,
    fonts: await loadOgFonts(),
  });
}
