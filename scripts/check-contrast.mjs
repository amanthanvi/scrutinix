#!/usr/bin/env node
/**
 * WCAG contrast guard for the theme tokens in app/globals.css.
 *
 * Resolves every token for light (:root) and dark (.dark), converts OKLCH
 * to sRGB, and checks each pair the UI actually draws: 4.5:1 for text,
 * 3:1 for graphics and control boundaries (WCAG 1.4.3 / 1.4.11).
 *
 *   node scripts/check-contrast.mjs        # prints a table, exit 1 on failure
 *
 * `tests/unit/contrast.test.ts` imports `checkContrast` so the unit suite
 * fails whenever a token edit drops a pair below its threshold.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEXT = 4.5;
const GRAPHIC = 3;
const VERDICTS = [
  "safe",
  "suspicious",
  "malicious",
  "critical",
  "unknown",
  "error",
];

/** [foreground, background, minimum ratio, why] */
export const PAIRS = [
  // Ink on the ground, on fields, and on hover rows.
  ...["--sx-text", "--sx-text-muted", "--sx-text-soft"].flatMap((fg) =>
    ["--sx-bg", "--sx-surface", "--sx-subtle"].map((bg) => [
      fg,
      bg,
      TEXT,
      "text",
    ]),
  ),
  ["--sx-accent", "--sx-bg", TEXT, "link text"],
  ["--sx-accent", "--sx-subtle", TEXT, "link text on hover"],
  ["--sx-accent-fg", "--sx-accent-solid", TEXT, "primary button label"],
  ["--sx-accent-fg", "--sx-accent-solid-hover", TEXT, "primary button hover"],
  // UI danger (form and stream errors, destructive confirm): not a verdict.
  ...["--sx-bg", "--sx-surface", "--sx-subtle"].map((bg) => [
    "--sx-danger-fg",
    bg,
    TEXT,
    "error text",
  ]),
  ["--sx-danger-border", "--sx-surface", GRAPHIC, "invalid field border"],
  ["--sx-danger-border", "--sx-bg", GRAPHIC, "invalid field border"],
  // Verdict words on the ground (history, batch, about).
  ...VERDICTS.map((v) => [`--sx-${v}-fg`, "--sx-bg", TEXT, "verdict word"]),
  // Ink inside each verdict band.
  ...[...VERDICTS, "pending"].flatMap((v) => [
    ["--sx-text", `--sx-${v}-surface`, TEXT, "band ink"],
    ["--sx-text-muted", `--sx-${v}-surface`, TEXT, "band secondary"],
    ["--sx-accent", `--sx-${v}-surface`, TEXT, "band link"],
    ["--sx-focus-ring", `--sx-${v}-surface`, GRAPHIC, "focus in band"],
  ]),
  // Graphics and boundaries.
  ["--sx-focus-ring", "--sx-bg", GRAPHIC, "focus ring"],
  ["--sx-control", "--sx-bg", GRAPHIC, "control border"],
  ["--sx-control", "--sx-surface", GRAPHIC, "control border on field"],
  ["--sx-accent-solid", "--sx-bg", GRAPHIC, "primary button edge"],
  ...VERDICTS.map((v) => [`--sx-${v}`, "--sx-bg", GRAPHIC, "verdict graphic"]),
  // Strip cells that state a finding, on the ground.
  ...[
    "--sx-cell-flagged",
    "--sx-cell-caution",
    "--sx-cell-failed",
    "--sx-cell-limited",
    "--sx-cell-clear",
    "--sx-cell-na",
  ].map((cell) => [cell, "--sx-bg", GRAPHIC, "strip cell"]),
  // Adjacent states are deliberately not held to 3:1 against each other:
  // WCAG 1.4.11 is met by shape plus the text label, title, and evidence
  // row. Every filled mark (solid, hatch stripes, centred partial block,
  // dash) sits on the empty track and must stand off it at 3:1. States
  // that share a lightness (flagged / caution / found nothing) are told
  // apart by shape in app/scrutinix.css (solid / hatched / dash); failed
  // and didn't-apply share a lightness and are told apart by a solid inset
  // edge versus a dashed outline. tests/unit/contrast.test.ts checks those
  // shapes stay distinct. The bare track (still running) is a slot, not a
  // mark: its state is stated in text ("3 of 8 checks finished", names).
  ...[
    "--sx-cell-flagged",
    "--sx-cell-caution",
    "--sx-cell-limited",
    "--sx-cell-clear",
  ].map((cell) => [cell, "--sx-cell-track", GRAPHIC, "mark on track"]),
  // The strip's hover plate sits behind every cell of the hovered control.
  ...[
    "--sx-cell-flagged",
    "--sx-cell-caution",
    "--sx-cell-failed",
    "--sx-cell-limited",
    "--sx-cell-clear",
    "--sx-cell-na",
  ].map((cell) => [cell, "--sx-subtle", GRAPHIC, "strip cell on hover plate"]),
];

function blockOf(css, selector) {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in globals.css`);
  return css.slice(start, css.indexOf("\n}", start));
}

function tokensOf(text) {
  const map = {};
  for (const match of text.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    map[match[1]] = match[2].trim();
  }
  return map;
}

function resolve(map, name, depth = 0) {
  const value = map[name];
  if (value === undefined) throw new Error(`Unknown token ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref && depth < 10 ? resolve(map, ref[1], depth + 1) : value;
}

function oklchToLinearRgb(value) {
  const m = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`Not an opaque oklch colour: ${value}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x) => Math.min(Math.max(x, 0), 1);
  return [
    clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ];
}

function luminance(value) {
  const [r, g, b] = oklchToLinearRgb(value);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Every pair in both themes, with its ratio and verdict. */
export function checkContrast(
  css = readFileSync(
    fileURLToPath(new URL("../app/globals.css", import.meta.url)),
    "utf8",
  ),
) {
  const light = tokensOf(blockOf(css, ":root"));
  const dark = { ...light, ...tokensOf(blockOf(css, ".dark")) };
  const rows = [];
  for (const [theme, map] of [
    ["light", light],
    ["dark", dark],
  ]) {
    for (const [fg, bg, min, role] of PAIRS) {
      const ratio = contrastRatio(resolve(map, fg), resolve(map, bg));
      rows.push({ theme, fg, bg, min, role, ratio, ok: ratio >= min });
    }
  }
  return rows;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = checkContrast();
  for (const row of rows) {
    console.log(
      `${row.ok ? "ok  " : "FAIL"} ${row.theme.padEnd(5)} ${row.ratio
        .toFixed(2)
        .padStart(5)} >= ${row.min}  ${row.fg} on ${row.bg} (${row.role})`,
    );
  }
  const failed = rows.filter((row) => !row.ok).length;
  if (failed > 0) {
    console.error(`\n${failed} pair(s) below threshold.`);
    process.exit(1);
  }
  console.log(`\nAll ${rows.length} pairs pass.`);
}
