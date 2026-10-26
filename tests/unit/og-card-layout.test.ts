import path from "node:path";

import { describe, expect, it } from "vitest";

import { ownershipSentence } from "@/lib/domain/verdict-guidance";
import {
  CARD_TEXT_WIDTH,
  DOMAIN_LINE,
  FACES,
  OWNERSHIP_LINE,
  TRACKING,
  baselineOf,
  fitRegisteredDomain,
  layOutOwnership,
  lineHeightFor,
  textWidth,
  type Face,
  type SentenceRun,
} from "@/lib/og/card-layout";

import { readTtfMetrics } from "./helpers/ttf-metrics";

const FONT_FILES: Record<Face, string> = {
  display: "fonts/newsreader/newsreader-600-opsz60.ttf",
  serif: "fonts/newsreader/newsreader-400-opsz16.ttf",
  mono: "node_modules/geist/dist/fonts/geist-mono/GeistMono-Medium.ttf",
};

/** Every character a registered domain can hold (hostnames are punycode). */
const DOMAIN_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789.-";

const LABEL_63 =
  "accountverificationandsecuritycheckpointforyoursigninportalnowx";

function rowWidth(row: SentenceRun[]): number {
  return row.reduce(
    (sum, run) => sum + textWidth(run.text, run.face, run.size),
    0,
  );
}

const rowText = (row: SentenceRun[]) => row.map((run) => run.text).join("");

describe("the card's font measurements", () => {
  it.each(Object.keys(FONT_FILES) as Face[])(
    "match the %s face's own file",
    (face) => {
      const font = readTtfMetrics(path.join(process.cwd(), FONT_FILES[face]));
      expect(FACES[face].ascender).toBeCloseTo(font.ascender, 3);
      expect(FACES[face].descender).toBeCloseTo(font.descender, 3);
      const { chars, widths } = FACES[face];
      [...chars].forEach((char, index) => {
        expect(widths[index], char).toBe(font.advance(char));
      });
      // Every character a domain can hold is measured, not guessed: the
      // display face's table holds them all, and the mono face is 0.6 em.
      for (const char of DOMAIN_CHARS) {
        if (face === "display") expect(chars, char).toContain(char);
        if (face === "mono") expect(font.advance(char), char).toBe(600);
      }
    },
  );

  it("measures every word of the look-alike sentence, not a guess", () => {
    const prose = ownershipSentence("owner.example", "brand.example")
      .replace("owner.example", "")
      .replace("brand.example", "");
    for (const char of prose) {
      expect(FACES.serif.chars, char).toContain(char);
    }
  });

  it("never measures a character it has no width for as narrower than it draws", () => {
    for (const face of ["display", "serif"] as const) {
      const font = readTtfMetrics(path.join(process.cwd(), FONT_FILES[face]));
      for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZÆŒ@%&") {
        if (FACES[face].chars.includes(char)) continue;
        const drawn = (font.advance(char)! / 1000 + TRACKING[face]) * 48;
        expect(textWidth(char, face, 48), `${face} ${char}`).toBeGreaterThan(
          drawn,
        );
      }
    }
  });

  it("gives each run the line box that puts its baseline on the row's", () => {
    const baseline = baselineOf("serif", 34, 1.3);
    for (const [face, size] of [
      ["mono", 36],
      ["mono", 24],
      ["serif", 34],
    ] as const) {
      const lineHeight = lineHeightFor(face, size, baseline);
      expect(baselineOf(face, size, lineHeight)).toBeCloseTo(baseline, 6);
    }
  });
});

describe("the registered domain line", () => {
  it("keeps its full size for the domains people see every day", () => {
    for (const domain of [
      "example.com",
      "scrutinix.test",
      "secure-login.xyz",
      "bankofamerica.com",
      "account-security-verification.co.uk",
    ]) {
      expect(fitRegisteredDomain(domain)).toEqual({
        text: domain,
        size: DOMAIN_LINE.size,
      });
    }
  });

  it("steps down to keep a long domain whole on one line", () => {
    for (const domain of [
      "an-extremely-long-registered-domain-for-testing-cards.com",
      // The longest label a hostname may hold (the long-hop fixture's).
      `${LABEL_63}.com`,
      `${LABEL_63}.co.uk`,
    ]) {
      const fitted = fitRegisteredDomain(domain);
      expect(fitted.text).toBe(domain);
      expect(fitted.size).toBeLessThan(DOMAIN_LINE.size);
      expect(fitted.size).toBeGreaterThanOrEqual(DOMAIN_LINE.minSize);
      expect(textWidth(domain, "display", fitted.size)).toBeLessThanOrEqual(
        CARD_TEXT_WIDTH,
      );
      // The largest whole size that fits.
      expect(textWidth(domain, "display", fitted.size + 1)).toBeGreaterThan(
        CARD_TEXT_WIDTH,
      );
    }
  });

  it("past the smallest size, shortens the middle of the label and never its end", () => {
    for (const [domain, suffix] of [
      [`${"wm".repeat(31)}w.com`, ".com"],
      [
        `${LABEL_63}.s3-website.dualstack.ap-northeast-1.amazonaws.com`,
        ".s3-website.dualstack.ap-northeast-1.amazonaws.com",
      ],
    ] as const) {
      const { text, size } = fitRegisteredDomain(domain);
      expect(size).toBe(DOMAIN_LINE.minSize);
      expect(textWidth(text, "display", size)).toBeLessThanOrEqual(
        CARD_TEXT_WIDTH,
      );
      const [head, rest] = text.split("…") as [string, string];
      const label = domain.slice(0, -suffix.length);
      // The suffix whole, with the label's own start and end around it.
      expect(rest.endsWith(suffix)).toBe(true);
      const tail = rest.slice(0, -suffix.length);
      expect(head.length).toBeGreaterThanOrEqual(3);
      expect(tail.length).toBeGreaterThanOrEqual(3);
      expect(label.startsWith(head)).toBe(true);
      expect(label.endsWith(tail)).toBe(true);
      expect(head.length - tail.length).toBeLessThanOrEqual(1);
      // As little as possible is taken out.
      expect(head.length + tail.length).toBeGreaterThan(label.length / 4);
    }
  });
});

describe("a look-alike's ownership sentence", () => {
  it("stays on one line when it fits, exactly the shared sentence", () => {
    const rows = layOutOwnership("secure-login.xyz", "paypal.com");
    expect(rows).toHaveLength(1);
    expect(rowText(rows[0]!)).toBe(
      ownershipSentence("secure-login.xyz", "paypal.com"),
    );
    const [, owner, , brand] = rows[0]!;
    expect(owner).toMatchObject({ face: "mono", size: OWNERSHIP_LINE.owner });
    expect(brand).toMatchObject({ face: "mono", size: OWNERSHIP_LINE.brand });
  });

  it("breaks at its comma when it is too wide, and says every word", () => {
    const owner = "secure-account-verification-center.com";
    const rows = layOutOwnership(owner, "paypal.com");
    expect(rows.map(rowText)).toEqual([
      `This link belongs to ${owner},`,
      "not paypal.com.",
    ]);
    expect(rows.map(rowText).join(" ")).toBe(
      ownershipSentence(owner, "paypal.com"),
    );
    for (const row of rows) {
      expect(rowWidth(row)).toBeLessThanOrEqual(CARD_TEXT_WIDTH);
    }
  });

  it("fits a 63-letter owner by its middle, keeping the end that names the site", () => {
    const owner = `${LABEL_63}.com`;
    for (const brand of [
      "paypal.com",
      "microsoftonline.com",
      `${LABEL_63}.net`,
    ]) {
      const rows = layOutOwnership(owner, brand);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(rowWidth(row)).toBeLessThanOrEqual(CARD_TEXT_WIDTH);
      }
      const ownerRun = rows[0]!.find((run) => run.face === "mono")!;
      const brandRun = rows[1]!.find((run) => run.face === "mono")!;
      expect(ownerRun.size).toBe(OWNERSHIP_LINE.minSize);
      expect(ownerRun.text).toMatch(
        /^accountverification.*….*portalnowx\.com$/,
      );
      // The imitated site is never set larger than the owner.
      expect(brandRun.size).toBeLessThanOrEqual(ownerRun.size);
      expect(brandRun.text.endsWith(brand.slice(brand.indexOf(".")))).toBe(
        true,
      );
    }
  });
});
