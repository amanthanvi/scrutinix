import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CARD_HEADLINE } from "@/lib/og/cards";

import { textOf } from "./helpers/og-card-text";

// Stand-in for the renderer: record the element the route would draw.
const rendered = vi.hoisted(() => [] as unknown[]);
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(element: unknown) {
      rendered.push(element);
      super("png", { headers: { "content-type": "image/png" } });
    }
  },
}));
vi.mock("@/lib/og/fonts", () => ({ loadOgFonts: async () => [] }));

const { default: OpenGraphImage, alt } = await import("@/app/opengraph-image");

beforeEach(() => {
  rendered.length = 0;
});

describe("the default card (/opengraph-image)", () => {
  it("draws the headline in its explicit lines, and the alt reads the card", async () => {
    await OpenGraphImage();
    expect(rendered).toHaveLength(1);

    // The wordmark, the headline's lines, the supporting line, the address.
    const text = textOf(rendered[0]);
    const lines = DEFAULT_CARD_HEADLINE.length;
    expect(text).toHaveLength(lines + 3);
    const [wordmark, ...rest] = text;
    expect(wordmark).toBe("Scrutinix");
    expect(rest.slice(0, lines)).toEqual([...DEFAULT_CARD_HEADLINE]);
    expect(text.at(-1)).toBe("scrutinix.net");

    const supporting = rest[lines];
    expect(alt).toBe(
      `${wordmark}: ${DEFAULT_CARD_HEADLINE.join(" ")} ${supporting}`,
    );
  });
});
