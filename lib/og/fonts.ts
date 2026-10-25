import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Share-card fonts, read at render time with no network fetch. The display
 * text (headline, verdict, instruction, registered domain) is Newsreader,
 * the same two static cuts the page loads, vendored as TTF in
 * fonts/newsreader (SIL OFL 1.1; Satori reads TTF, not WOFF2). Interface
 * text is Geist from the installed `geist` package (SIL OFL 1.1), standing
 * in for the page's system sans, which a server can't embed; Geist Mono
 * sets the domains in a look-alike's sentence. `next.config.ts` traces
 * these files into the image routes' function bundles.
 */
const GEIST_DIR = path.join(process.cwd(), "node_modules/geist/dist/fonts");
const NEWSREADER_DIR = path.join(process.cwd(), "fonts/newsreader");

const FILES = [
  { name: "Geist", file: "geist-sans/Geist-Regular.ttf", weight: 400 },
  { name: "Geist", file: "geist-sans/Geist-Medium.ttf", weight: 500 },
  { name: "Geist", file: "geist-sans/Geist-SemiBold.ttf", weight: 600 },
  { name: "Geist Mono", file: "geist-mono/GeistMono-Medium.ttf", weight: 500 },
].map((font) => ({ ...font, file: path.join(GEIST_DIR, font.file) }));

const DISPLAY_FILES = [
  { name: "Newsreader", file: "newsreader-400-opsz16.ttf", weight: 400 },
  { name: "Newsreader", file: "newsreader-600-opsz60.ttf", weight: 600 },
].map((font) => ({ ...font, file: path.join(NEWSREADER_DIR, font.file) }));

type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600;
  style: "normal";
};

let cached: Promise<OgFont[]> | null = null;

export function loadOgFonts(): Promise<OgFont[]> {
  cached ??= Promise.all(
    [...FILES, ...DISPLAY_FILES].map(async ({ name, file, weight }) => ({
      name,
      data: await readFile(file),
      weight: weight as OgFont["weight"],
      style: "normal" as const,
    })),
  ).catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
