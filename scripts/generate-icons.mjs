#!/usr/bin/env node
/**
 * Regenerates every shipping raster icon from the brand-mark geometry in
 * lib/brand-mark.ts (the eight-cell strip folded 4 x 2 on an ink tile):
 *
 *   public/icon.svg                 vector source (also linked as an icon)
 *   public/favicon.ico              16 + 32 + 48 px PNG entries
 *   public/favicon-16x16.png
 *   public/favicon-32x32.png
 *   public/apple-touch-icon.png     180 px
 *   public/android-chrome-192x192.png
 *   public/android-chrome-512x512.png
 *
 * Provenance: authored geometry only (no third-party artwork, no fonts),
 * rasterised with sharp. Each standalone PNG carries that origin in an
 * `impeccable:prompt` tEXt chunk, so `impeccable embed-prompt --scan
 * public` stays clear after a regeneration. Run `npm run icons` after any
 * change to lib/brand-mark.ts (Node 24 strips the TypeScript types).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";

import sharp from "sharp";

import { iconSvg } from "../lib/brand-mark.ts";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));

const PROVENANCE =
  "Origin: authored, not generated. Scrutinix app icon rasterised by " +
  "scripts/generate-icons.mjs (sharp) from the brand-mark geometry in " +
  "lib/brand-mark.ts: the eight-cell strip folded 4 x 2 (6-unit cells, " +
  "2-unit gaps, 1-unit radius), white #ffffff on a #16181d tile with a 22% " +
  "corner radius, the mark at 72% of the tile width. No third-party " +
  "artwork, fonts, or image model. Regenerate with `npm run icons`.";

/** Inserts a Latin-1 tEXt chunk just before IEND. */
function withText(buffer, keyword, text) {
  const data = Buffer.concat([
    Buffer.from(keyword, "latin1"),
    Buffer.from([0]),
    Buffer.from(text, "latin1"),
  ]);
  const type = Buffer.from("tEXt", "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const iend = buffer.length - 12;
  return Buffer.concat([
    buffer.subarray(0, iend),
    length,
    type,
    data,
    crc,
    buffer.subarray(iend),
  ]);
}

async function png(size) {
  return sharp(Buffer.from(iconSvg({ size })))
    .png()
    .toBuffer();
}

/** ICO container holding PNG-encoded images (supported since Vista). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

writeFileSync(`${publicDir}icon.svg`, `${iconSvg({ size: 512 })}\n`);

for (const [file, size] of [
  ["favicon-16x16.png", 16],
  ["favicon-32x32.png", 32],
  ["apple-touch-icon.png", 180],
  ["android-chrome-192x192.png", 192],
  ["android-chrome-512x512.png", 512],
]) {
  writeFileSync(
    `${publicDir}${file}`,
    withText(await png(size), "impeccable:prompt", PROVENANCE),
  );
}

writeFileSync(
  `${publicDir}favicon.ico`,
  ico(
    await Promise.all(
      [16, 32, 48].map(async (size) => ({ size, data: await png(size) })),
    ),
  ),
);

console.log("Icons regenerated from lib/brand-mark.ts.");
