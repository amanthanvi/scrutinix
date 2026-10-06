import { createHmac } from "node:crypto";

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

/**
 * A `?shared=` payload: base64 of the URI-encoded JSON snapshot, as
 * `encodeSharedSnapshot` writes it.
 */
export function encodeSharedPayload(snapshot: object): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(snapshot))).toString(
    "base64",
  );
}

/**
 * The server's signature of a payload, computed here from the documented
 * contract (lib/server/share-signing.ts) with the test-only key
 * `scripts/run-e2e.mjs` hands both the server and this runner.
 */
export function signSharedPayload(payload: string): string {
  const secret = process.env.SHARE_SIGNING_SECRET;
  if (!secret) {
    throw new Error("SHARE_SIGNING_SECRET is unset; run via npm run test:e2e.");
  }
  return createHmac("sha256", secret)
    .update(`scrutinix-share-v1\n${payload}`)
    .digest("base64url");
}

/** A `/?shared=` path, signed unless `sig` is null. */
export function sharedPath(payload: string, sig: string | null): string {
  const params = new URLSearchParams({ shared: payload });
  if (sig) params.set("sig", sig);
  return `/?${params.toString()}`;
}
