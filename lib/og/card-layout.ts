import { ownershipSentence } from "@/lib/domain/verdict-guidance";

/**
 * Where the result card (`ResultCard`, 1200 x 630) sets the site a link
 * belongs to, decided before Satori draws it: Satori breaks a line that is
 * too wide wherever it can (a hyphen) and draws past the edge where it
 * can't, and either pushes the strip off the bottom. Every registered
 * domain gets one line: its full size when it fits, a smaller size when it
 * doesn't, and, past the smallest size, an ellipsis in the middle of its
 * own label, so the end that names the site ("…portalnowx.com") always
 * shows. A look-alike's sentence keeps its one line when it fits and
 * otherwise breaks at its comma, with each domain fitted the same way.
 *
 * Widths are measured from the vendored fonts' own advance widths
 * (`tests/unit/og-card-layout.test.ts` reads them back from the files).
 */

/** The card's text column: 1200 less 72 px of padding on each side. */
export const CARD_TEXT_WIDTH = 1200 - 2 * 72;

export type Face = "display" | "serif" | "mono";

interface FaceMetrics {
  /** Characters with a known advance width, and those widths (1/1000 em). */
  chars: string;
  widths: readonly number[];
  /** hhea ascender and descender, in em (descender negative). */
  ascender: number;
  descender: number;
}

/**
 * `display` is Newsreader 600 (the registered domain), `serif` Newsreader
 * 400 (the look-alike sentence), `mono` Geist Mono 500 (its domains).
 */
export const FACES: Record<Face, FaceMetrics> = {
  display: {
    chars: "abcdefghijklmnopqrstuvwxyz0123456789.-…:[]",
    widths: [
      526, 596, 485, 607, 502, 391, 532, 610, 303, 284, 597, 296, 903, 618, 571,
      608, 594, 448, 431, 400, 597, 578, 818, 567, 570, 492, 632, 632, 632, 632,
      632, 632, 632, 632, 632, 632, 249, 335, 716, 278, 302, 303,
    ],
    ascender: 0.735,
    descender: -0.265,
  },
  serif: {
    chars: " ,.Tabcdefghijklmnopqrstuvwxyz",
    widths: [
      229, 239, 230, 670, 460, 546, 437, 556, 462, 345, 496, 561, 280, 247, 541,
      269, 832, 573, 526, 564, 545, 394, 384, 342, 537, 527, 743, 507, 524, 431,
    ],
    ascender: 0.735,
    descender: -0.265,
  },
  // Monospaced: every character `MONO_CHARS` matches is 0.6 em.
  mono: { chars: "", widths: [], ascender: 1.005, descender: -0.295 },
};

/**
 * The characters Geist Mono draws at its one width, 0.6 em: printable
 * ASCII, the ellipsis, Latin-1's letters, and basic Cyrillic (the test
 * reads every match back from the font). The imitated site in a
 * look-alike's sentence can be a decoded login name in any script
 * ("支付宝.com@evil.com"), drawn from a fallback face; it is measured as
 * unknown.
 */
export const MONO_CHARS = /^[ -~…À-ÿЀ-џ]$/u;
const MONO_WIDTH = 600;
/**
 * A character outside a face's table (an owner is punycode, so in practice
 * only an imitated site's non-Latin letters) counts as 1.2 em, wider than
 * any glyph these faces or a CJK fallback draw: a guess only ever makes a
 * line smaller than it had to be, never too wide.
 */
const UNKNOWN_WIDTH = 1200;

/** Letter-spacing, in em, as `ResultCard` sets each face. */
export const TRACKING: Record<Face, number> = {
  display: -0.02,
  serif: 0,
  mono: -0.02,
};

const ELLIPSIS = "…";

function advance(face: Face, char: string): number {
  if (face === "mono") {
    return MONO_CHARS.test(char) ? MONO_WIDTH : UNKNOWN_WIDTH;
  }
  const { chars, widths } = FACES[face];
  const index = chars.indexOf(char);
  return index >= 0 ? widths[index]! : UNKNOWN_WIDTH;
}

/** How wide `text` draws in `face` at `size` px, letter-spacing included. */
export function textWidth(text: string, face: Face, size: number): number {
  let units = 0;
  let count = 0;
  for (const char of text) {
    units += advance(face, char);
    count += 1;
  }
  return (units / 1000 + TRACKING[face] * count) * size;
}

/**
 * The line-height (a multiple of `size`) that puts a face's baseline
 * `baseline` px below the top of its line box. Satori centres a face's
 * ascender-to-descender span in the line box and aligns flex items by
 * their boxes, not their baselines, so a row that mixes faces or sizes
 * gives each part the line box that lands its baseline on the row's.
 */
export function lineHeightFor(
  face: Face,
  size: number,
  baseline: number,
): number {
  const { ascender, descender } = FACES[face];
  return (2 * baseline) / size - (ascender + descender);
}

/** Where a face's baseline sits in a line box of `lineHeight` x `size`. */
export function baselineOf(
  face: Face,
  size: number,
  lineHeight: number,
): number {
  const { ascender, descender } = FACES[face];
  return ((lineHeight + ascender + descender) * size) / 2;
}

export interface FittedDomain {
  /** The domain as drawn: whole, or with an ellipsis inside its label. */
  text: string;
  size: number;
}

/**
 * A registered domain fitted to `width`: at `size` when it fits, else at
 * the largest whole size down to `minSize` that fits, else at `minSize`
 * with characters taken from the middle of its first label. A registered
 * domain is one label and its public suffix ("co.uk", "github.io"), so the
 * suffix and the end of the label always show, and so does the start.
 */
export function fitDomain(
  domain: string,
  face: Face,
  { size, minSize, width }: { size: number; minSize: number; width: number },
): FittedDomain {
  const full = textWidth(domain, face, size);
  if (full <= width) return { text: domain, size };
  const fitted = Math.floor((size * width) / full);
  if (fitted >= minSize) return { text: domain, size: fitted };

  const fits = (text: string) => textWidth(text, face, minSize) <= width;
  const dot = domain.indexOf(".");
  // Cut between whole characters as a reader sees them, so an imitated
  // site in another script never loses a mark from its letter.
  const label = graphemes(dot > 0 ? domain.slice(0, dot) : domain);
  const suffix = dot > 0 ? domain.slice(dot) : "";
  for (let keep = label.length - 1; keep >= 2; keep -= 1) {
    const head = label.slice(0, Math.ceil(keep / 2)).join("");
    const tail = label.slice(label.length - Math.floor(keep / 2)).join("");
    const text = `${head}${ELLIPSIS}${tail}${suffix}`;
    if (fits(text)) return { text, size: minSize };
  }
  // A suffix too long for the line on its own: keep the domain's end.
  const chars = graphemes(domain);
  for (let keep = chars.length - 1; keep > 0; keep -= 1) {
    const text = `${ELLIPSIS}${chars.slice(-keep).join("")}`;
    if (fits(text)) return { text, size: minSize };
  }
  return { text: ELLIPSIS, size: minSize };
}

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
}

/** The registered domain line, in the display serif. */
export const DOMAIN_LINE = { size: 48, minSize: 32 } as const;

export function fitRegisteredDomain(domain: string): FittedDomain {
  return fitDomain(domain, "display", {
    ...DOMAIN_LINE,
    width: CARD_TEXT_WIDTH,
  });
}

/** One run of a look-alike sentence: prose, or one of its two domains. */
export interface SentenceRun {
  text: string;
  face: "serif" | "mono";
  size: number;
}

/** The look-alike sentence's sizes: prose, the owner, the imitated site. */
export const OWNERSHIP_LINE = {
  prose: 34,
  owner: 36,
  brand: 30,
  /** Neither domain is drawn smaller than this; past it, an ellipsis. */
  minSize: 24,
} as const;

/**
 * "This link belongs to secure-login.xyz, not paypal.com." as rows of
 * runs: one row when the sentence fits the card, else two, broken at the
 * sentence's own pause ("…belongs to <owner>," / "not <brand>."), each
 * domain fitted to what its row leaves (`fitDomain`).
 */
export function layOutOwnership(
  owner: string,
  brand: string,
  width: number = CARD_TEXT_WIDTH,
): SentenceRun[][] {
  const { prose, minSize } = OWNERSHIP_LINE;
  const sentence = ownershipSentence(owner, brand);
  const ownerAt = sentence.indexOf(owner);
  const brandAt = sentence.lastIndexOf(brand);
  const before = sentence.slice(0, ownerAt);
  const between = sentence.slice(ownerAt + owner.length, brandAt);
  const after = sentence.slice(brandAt + brand.length);
  const words = (text: string): SentenceRun => ({
    text,
    face: "serif",
    size: prose,
  });
  const wordsWidth = (...texts: string[]) =>
    texts.reduce((sum, text) => sum + textWidth(text, "serif", prose), 0);
  const domainRun = (text: string, size: number, room: number) => ({
    ...fitDomain(text, "mono", { size, minSize, width: room }),
    face: "mono" as const,
  });

  const oneLine =
    wordsWidth(before, between, after) +
    textWidth(owner, "mono", OWNERSHIP_LINE.owner) +
    textWidth(brand, "mono", OWNERSHIP_LINE.brand);
  if (oneLine <= width) {
    return [
      [
        words(before),
        domainRun(owner, OWNERSHIP_LINE.owner, width),
        words(between),
        domainRun(brand, OWNERSHIP_LINE.brand, width),
        words(after),
      ],
    ];
  }
  // ", not " breaks after its comma: the pause the sentence already has.
  const space = between.indexOf(" ");
  const pause = space < 0 ? between : between.slice(0, space);
  const resume = space < 0 ? "" : between.slice(space + 1);
  const ownerRun = domainRun(
    owner,
    OWNERSHIP_LINE.owner,
    width - wordsWidth(before, pause),
  );
  // The imitated site is never set larger than the owner.
  const brandRun = domainRun(
    brand,
    Math.min(OWNERSHIP_LINE.brand, ownerRun.size),
    width - wordsWidth(resume, after),
  );
  return [
    [words(before), ownerRun, words(pause)],
    [words(resume), brandRun, words(after)],
  ];
}
