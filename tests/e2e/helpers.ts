import { expect, type Page } from "@playwright/test";

/**
 * Navigate to the app and wait for React hydration. The theme toggle's
 * accessible name flips from "Toggle theme" to "Switch to ... theme" during
 * its first client render, so once it appears the page is interactive - no
 * fixed sleeps needed.
 */
export async function gotoApp(page: Page) {
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
