/**
 * Saves text as a file. The CSV and JSON formats for exported results live
 * in `export-formats.ts`, loaded only with the Batch and history panels;
 * this stays with the page for a result's own "Download result (JSON)".
 */
export function downloadTextFile(
  filename: string,
  content: string,
  type = "text/plain;charset=utf-8",
) {
  const blob = new Blob([content], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously races the download in some browsers; defer it.
  setTimeout(() => URL.revokeObjectURL(href), 1_000);
}
