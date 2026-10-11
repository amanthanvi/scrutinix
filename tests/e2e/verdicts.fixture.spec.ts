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

  const verdict = page.getByLabel(/^scan result: malicious$/i);
  await expect(verdict).toBeVisible();
  await expect(verdict.getByText("Don't open this link.")).toBeVisible();
  // The driver row states the conviction; the band does not repeat it.
  await expect(
    page.getByText("7 VirusTotal engines flagged this link."),
  ).toHaveCount(0);
  // Summary holds only the signal that drove the verdict.
  await expect(page.getByLabel(/virustotal signal:/i)).toHaveAttribute(
    "aria-label",
    "VirusTotal signal: 7 engines flagged this link as malicious, 2 as suspicious.",
  );
  await expect(page.getByLabel(/google safe browsing signal:/i)).toHaveCount(0);
  await expect(page.getByText("7 other checks found nothing.")).toBeVisible();

  // Revealing the quiet checks keeps keyboard focus in the revealed list.
  await page.getByRole("button", { name: /show all checks/i }).press("Enter");
  const signals = page.getByRole("list", { name: "Signals" });
  await expect(signals.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(signals.locator(":focus")).toHaveCount(1);
});

test("an unreachable host renders an unknown verdict, not safe", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://unreachable.scrutinix.test/");

  const verdict = page.getByLabel(/^scan result: unknown$/i);
  await expect(verdict).toBeVisible();
  await expect(
    verdict.getByText("We couldn't check this link — treat it as unsafe."),
  ).toBeVisible();
  // No score and no "Safe" band beside Unknown, and no 8/8 caveat.
  await expect(page.getByRole("meter", { name: /threat score/i })).toHaveCount(
    0,
  );
  await expect(page.getByText(/safe band/i)).toHaveCount(0);
  await expect(page.getByText(/resolved signals/i)).toHaveCount(0);
});

test("a threat-feed listing renders a malicious verdict", async ({ page }) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://feed-hit.scrutinix.test/payload.exe");

  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  // The driver row carries the listing; the reason itself sits in Details.
  await expect(page.getByLabel(/threat feeds signal:/i)).toHaveAttribute(
    "aria-label",
    "Threat Feeds signal: URLhaus lists this link as active malware distribution.",
  );
  await expect(page.getByText("URLhaus flagged this link.")).toHaveCount(0);
  await expect(page.getByText(/listed.*listed/i)).toHaveCount(0);
});

test("a look-alike subdomain is named plainly and hedges a clean verdict", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://paypal.com.secure-login.xyz/verify");

  const verdict = page.getByLabel(/^scan result: safe$/i);
  await expect(verdict).toBeVisible();
  await expect(
    verdict.getByText("Don't sign in or enter details here."),
  ).toBeVisible();
  await expect(verdict.getByText(/High confidence/)).toHaveCount(0);
  await expect(
    page.getByText("This link belongs to secure-login.xyz, not paypal.com.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("a phone-width history row keeps a look-alike's real owner visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page);
  await submitSingleScan(page, "https://paypal.com.secure-login.xyz/verify");
  await expect(page.getByLabel(/^scan result: safe$/i)).toBeVisible();

  const history = page.getByRole("region", { name: "Scan history" });
  const row = history.getByRole("listitem").first();
  await expect(row).toContainText("secure-login.xyz");
  const owner = row.locator('[data-part="owner"]');
  await expect(owner).toHaveText("secure-login.xyz");
  const ownerBox = await owner.boundingBox();
  const rowBox = await row.boundingBox();
  expect(ownerBox && rowBox).toBeTruthy();
  if (ownerBox && rowBox) {
    expect(ownerBox.x).toBeGreaterThanOrEqual(rowBox.x);
    expect(ownerBox.x + ownerBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 0.5,
    );
  }
  // The owner itself is never cut: its full text fits its box.
  expect(
    await owner.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
});

test("an unreachable https link says the certificate couldn't be checked", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://unreachable.scrutinix.test");
  await expect(page.getByLabel(/^scan result: unknown$/i)).toBeVisible();
  await expect(page.getByText("Couldn't check the certificate")).toBeVisible();
  await expect(page.getByText("No secure connection")).toHaveCount(0);
});

test("strip cells open their evidence row", async ({ page }) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://malicious.scrutinix.test/login");
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();

  const strip = page.getByRole("toolbar", { name: "Checks" });
  await expect(strip.getByRole("button")).toHaveCount(8);
  // Names start with the visible cell label (WCAG 2.5.3 label in name).
  await strip.getByRole("button", { name: /^DNS:/ }).click();
  await expect(page.getByLabel(/DNS Profile signal:/i)).toBeFocused();
});
