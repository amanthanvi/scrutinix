import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Geist, read from the installed `geist` package (SIL OFL 1.1) at render
 * time: no network fetch. `next.config.ts` traces these files into the
 * image routes' function bundles.
 */
const FONT_DIR = path.join(process.cwd(), "node_modules/geist/dist/fonts");

const FILES = [
  { name: "Geist", file: "geist-sans/Geist-Regular.ttf", weight: 400 },
  { name: "Geist", file: "geist-sans/Geist-Medium.ttf", weight: 500 },
  { name: "Geist", file: "geist-sans/Geist-SemiBold.ttf", weight: 600 },
  { name: "Geist Mono", file: "geist-mono/GeistMono-Medium.ttf", weight: 500 },
] as const;

type OgFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600;
  style: "normal";
};

let cached: Promise<OgFont[]> | null = null;

export function loadOgFonts(): Promise<OgFont[]> {
  cached ??= Promise.all(
    FILES.map(async ({ name, file, weight }) => ({
      name,
      data: await readFile(path.join(FONT_DIR, file)),
      weight,
      style: "normal" as const,
    })),
  ).catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
