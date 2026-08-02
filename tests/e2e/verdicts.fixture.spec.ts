import { expect, test } from "@playwright/test";

import { gotoApp, submitSingleScan } from "./helpers";

/**
 * These specs depend on SCRUTINIX_TEST_FIXTURES=1 (set by scripts/run-e2e.mjs),
 * which swaps the real providers for the deterministic per-hostname scenarios
 * in lib/server/test-fixtures.ts.
 */

test("a VirusTotal conviction renders a malicious verdict", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://malicious.scrutinix.test/login");

  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  await expect(page.getByLabel(/virustotal signal:/i)).toBeVisible();
});

test("an unreachable host renders an unknown verdict, not safe", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://unreachable.scrutinix.test/");

  await expect(page.getByLabel(/^scan result: unknown$/i)).toBeVisible();
  await expect(page.getByText(/host could not be inspected/i)).toBeVisible();
  await expect(page.getByText(/^safe \(0-24\)$/i)).toHaveCount(0);
});

test("a threat-feed listing renders a malicious verdict", async ({ page }) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://feed-hit.scrutinix.test/payload.exe");

  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
});
