import {
  splitLinkAnatomy,
  type ParseHostname,
} from "@/lib/domain/link-anatomy";
import type { AnalysisResult } from "@/lib/domain/types";

/**
 * The CSV and JSON formats for exported results. Only the Batch and history
 * panels export, and both load on demand, so these stay out of the page's
 * first load.
 */

/**
 * Neutralize spreadsheet formula injection: a scanned URL is attacker-
 * controlled text, and a cell starting with = + - @ (or a tab/CR smuggle)
 * executes on open in Excel/Sheets.
 */
function escapeCsvCell(value: unknown): string {
  let cell = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`;
  }
  return `"${cell.replaceAll('"', '""')}"`;
}

/**
 * `parse` (the Public Suffix List parser, when loaded) fills "Look-alike
 * of": the site a link's address imitates. The stored verdict and score
 * stay as data; a reader of the sheet still sees that a "safe" row's
 * address is a look-alike. Without the parser the column says so, since
 * a blank cell would read as "not a look-alike".
 */
const NOT_CHECKED = "Not checked";

export function resultsToCsv(
  results: AnalysisResult[],
  parse: ParseHostname | null = null,
) {
  const rows = [
    [
      "URL",
      "Verdict",
      "Look-alike of",
      "Score",
      "Confidence",
      "Cache Hit",
      "Completed At",
      "Top Reasons",
    ],
    ...results.map((result) => [
      result.url,
      result.verdict,
      parse
        ? (splitLinkAnatomy(parse, result.url)?.impersonates ?? "")
        : NOT_CHECKED,
      String(result.threatInfo?.score ?? 0),
      String(result.threatInfo?.confidence ?? 0),
      String(result.metadata?.cacheHit ?? false),
      result.metadata?.completedAt ?? "",
      (result.threatInfo?.reasons ?? []).slice(0, 3).join(" | "),
    ]),
  ];

  // BOM keeps Excel from mangling UTF-8; CRLF is the RFC 4180 line ending.
  return `﻿${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}`;
}

export function resultsToJson(results: AnalysisResult[]) {
  return JSON.stringify(results, null, 2);
}
