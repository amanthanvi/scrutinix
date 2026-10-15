import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Download, Page } from "@playwright/test";

export const evidenceDir =
  process.env.VERIFY_EVIDENCE_DIR ?? "/tmp/scrutinix-verify/evidence";

export async function capture(page: Page, name: string): Promise<string> {
  mkdirSync(evidenceDir, { recursive: true });
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
  mkdirSync(evidenceDir, { recursive: true });
  const file = path.join(evidenceDir, name);
  await download.saveAs(file);
  return file;
}

export function readEvidence(name: string): string {
  return readFileSync(path.join(evidenceDir, name), "utf8");
}
