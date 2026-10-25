import {
  chmodSync,
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import type { Download, Page } from "@playwright/test";

export const evidenceDir =
  process.env.VERIFY_EVIDENCE_DIR ?? "/tmp/scrutinix-verify/evidence";

// Same name runtime.mjs writes when it creates the evidence directory.
const evidenceMarkerName = ".verify-evidence";

// Mark the directory only when this call creates it. mkdirSync returns
// undefined when the directory is already there.
function ensureEvidenceDirectory() {
  const created = mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
  if (created === undefined) return;
  chmodSync(evidenceDir, 0o700);
  const fd = openSync(
    path.join(evidenceDir, evidenceMarkerName),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, "scrutinix verify evidence\n");
  } finally {
    closeSync(fd);
  }
}

export async function capture(page: Page, name: string): Promise<string> {
  ensureEvidenceDirectory();
  const file = path.join(
    evidenceDir,
    name.endsWith(".png") ? name : `${name}.png`,
  );
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export async function saveDownload(
  download: Download,
  name: string,
): Promise<string> {
  ensureEvidenceDirectory();
  const file = path.join(evidenceDir, name);
  await download.saveAs(file);
  return file;
}

export function readEvidence(name: string): string {
  return readFileSync(path.join(evidenceDir, name), "utf8");
}
