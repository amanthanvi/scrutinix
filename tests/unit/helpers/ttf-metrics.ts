import { readFileSync } from "node:fs";

/**
 * The few TrueType facts the share card's layout depends on, read straight
 * from a font file: each character's advance width (cmap format 4, hmtx)
 * and the hhea ascender and descender, all in em.
 */
export function readTtfMetrics(file: string) {
  const font = readFileSync(file);
  const tables = new Map<string, number>();
  for (let index = 0; index < font.readUInt16BE(4); index += 1) {
    const record = 12 + index * 16;
    tables.set(
      font.toString("ascii", record, record + 4),
      font.readUInt32BE(record + 8),
    );
  }
  const table = (tag: string) => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`${file} has no ${tag} table`);
    return offset;
  };
  const unitsPerEm = font.readUInt16BE(table("head") + 18);
  const hhea = table("hhea");
  const metricsCount = font.readUInt16BE(hhea + 34);

  const cmap = table("cmap");
  let segments: number | null = null;
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = font.readUInt16BE(record);
    const encoding = font.readUInt16BE(record + 2);
    const subtable = cmap + font.readUInt32BE(record + 4);
    const unicode = platform === 0 || (platform === 3 && encoding === 1);
    if (unicode && font.readUInt16BE(subtable) === 4) {
      segments = subtable;
      break;
    }
  }
  if (segments === null) throw new Error(`${file} has no format 4 cmap`);
  const cmap4 = segments;

  const glyphOf = (code: number): number => {
    const doubled = font.readUInt16BE(cmap4 + 6);
    const ends = cmap4 + 14;
    const starts = ends + doubled + 2;
    const deltas = starts + doubled;
    const ranges = deltas + doubled;
    for (let index = 0; index < doubled / 2; index += 1) {
      if (code > font.readUInt16BE(ends + index * 2)) continue;
      const start = font.readUInt16BE(starts + index * 2);
      if (code < start) return 0;
      const delta = font.readInt16BE(deltas + index * 2);
      const range = font.readUInt16BE(ranges + index * 2);
      if (range === 0) return (code + delta) & 0xffff;
      const glyph = font.readUInt16BE(
        ranges + index * 2 + range + (code - start) * 2,
      );
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };

  return {
    ascender: font.readInt16BE(hhea + 4) / unitsPerEm,
    descender: font.readInt16BE(hhea + 6) / unitsPerEm,
    /** A character's advance width in thousandths of an em; null if absent. */
    advance(char: string): number | null {
      const glyph = glyphOf(char.codePointAt(0)!);
      if (glyph === 0) return null;
      const metric = Math.min(glyph, metricsCount - 1);
      const units = font.readUInt16BE(table("hmtx") + metric * 4);
      return Math.round((units / unitsPerEm) * 1000);
    },
  };
}
