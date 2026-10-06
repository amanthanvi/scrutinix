import { expect, type Page } from "@playwright/test";

/**
 * Navigate to the app and wait for React hydration. The theme toggle's
 * accessible name flips from "Toggle theme" to "Switch to ... theme" during
 * its first client render, so once it appears the page is interactive - no
 * fixed sleeps needed.
 */
export async function gotoApp(page: Page) {
  await isolateRateLimit(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
}

/** Fill the single-scan input and submit it. */
export async function submitSingleScan(page: Page, url: string) {
  const input = page.getByRole("textbox", { name: /url to analyze/i });
  await expect(async () => {
    await input.fill(url);
    await expect(input).toHaveValue(url);
  }).toPass();
  await page.getByRole("button", { name: /analyze url/i }).click();
}

let clientCounter = 0;

/**
 * Give each test its own rate-limit identity. The suite runs more scans
 * than one client may start per minute (lib/server/rate-limit.ts), so the
 * limit stays as shipped and each test presents a distinct documentation
 * address (198.51.100.0/24) through the x-real-ip header the limiter trusts.
 */
export async function isolateRateLimit(page: Page) {
  clientCounter += 1;
  await page.setExtraHTTPHeaders({
    "x-real-ip": `198.51.100.${(process.pid + clientCounter) % 250}`,
  });
}
