/**
 * Brand-mark geometry: the eight-cell strip, static and idealized (every
 * cell filled), folded into a 4 x 2 block in signal order, left to right,
 * top to bottom. One source for the header mark, the OG cards, and the
 * raster icons (`scripts/generate-icons.mjs` imports this file directly,
 * so it stays dependency-free).
 */
export const MARK = {
  cell: 6,
  gap: 2,
  columns: 4,
  rows: 2,
  radius: 1,
} as const;

export const MARK_WIDTH =
  MARK.columns * MARK.cell + (MARK.columns - 1) * MARK.gap;
export const MARK_HEIGHT = MARK.rows * MARK.cell + (MARK.rows - 1) * MARK.gap;

export interface MarkCell {
  x: number;
  y: number;
  size: number;
}

/** The eight cells in mark units (origin at the top-left of the mark). */
export function markCells(scale = 1): MarkCell[] {
  return Array.from({ length: MARK.columns * MARK.rows }, (_, index) => ({
    x: (index % MARK.columns) * (MARK.cell + MARK.gap) * scale,
    y: Math.floor(index / MARK.columns) * (MARK.cell + MARK.gap) * scale,
    size: MARK.cell * scale,
  }));
}

/**
 * The app icon as SVG: the mark centred on a rounded ink tile, so it reads
 * on light and dark browser chrome alike.
 */
export function iconSvg({
  size = 512,
  tile = "#16181d",
  ink = "#ffffff",
}: { size?: number; tile?: string; ink?: string } = {}): string {
  const scale = (size * 0.72) / MARK_WIDTH;
  const offsetX = (size - MARK_WIDTH * scale) / 2;
  const offsetY = (size - MARK_HEIGHT * scale) / 2;
  const radius = MARK.radius * scale;
  const cells = markCells(scale)
    .map(
      (cell) =>
        `<rect x="${(offsetX + cell.x).toFixed(2)}" y="${(offsetY + cell.y).toFixed(2)}" width="${cell.size.toFixed(2)}" height="${cell.size.toFixed(2)}" rx="${radius.toFixed(2)}" fill="${ink}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${(size * 0.22).toFixed(2)}" fill="${tile}"/>${cells}</svg>`;
}
