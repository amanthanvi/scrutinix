import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  encodeSharedPayload,
  gotoApp,
  setDefaultTextSize,
  settleAnimations,
  sharedPath,
  signSharedPayload,
  submitSingleScan,
} from "./helpers";

test("home page accessibility @smoke", async ({ page }) => {
  await gotoApp(page);

  const devToolsButton = page.getByRole("button", {
    name: /open next\.js dev tools/i,
  });
  if ((await devToolsButton.count()) > 0) {
    await devToolsButton.evaluate((element) => {
      element.remove();
    });
  }

  const accessibilityReport = await new AxeBuilder({ page }).analyze();
  expect(accessibilityReport.violations).toEqual([]);
});

test("result view accessibility @smoke", async ({ page }) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://malicious.scrutinix.test/login");
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  await page.getByRole("switch", { name: /^summary full/i }).click();
  await expect(page.getByLabel(/DNS Profile:/i)).toBeVisible();
  // Let the 200ms row entrance finish so axe measures settled colors.
  await settleAnimations(page);

  const devToolsButton = page.getByRole("button", {
    name: /open next\.js dev tools/i,
  });
  if ((await devToolsButton.count()) > 0) {
    await devToolsButton.evaluate((element) => {
      element.remove();
    });
  }

  const accessibilityReport = await new AxeBuilder({ page }).analyze();
  expect(accessibilityReport.violations).toEqual([]);
});

/**
 * No sideways scrolling on the home, a result, the Full list with every
 * check's details open, a filtered history, and a shared look-alike
 * (verified, unverified, and expired), at each default text size and
 * width given.
 */
async function expectReflow(
  page: Page,
  sizes: ReadonlyArray<readonly [standard: number, width: number]>,
) {
  const scrollsSideways = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
  // Three saved scans; the first result below makes four, which brings up
  // the history filter.
  await gotoApp(page);
  for (const [link, verdict] of [
    ["https://malicious.scrutinix.test/", /^scan result: malicious$/i],
    ["https://unreachable.scrutinix.test/", /^scan result: unknown$/i],
    ["https://example.com/", /^scan result: safe$/i],
  ] as const) {
    await submitSingleScan(page, link);
    await expect(page.getByLabel(verdict)).toBeVisible({ timeout: 15_000 });
  }

  // A look-alike whose registered domain ("secure-login.xyz") is kept
  // whole where it fits.
  const shared = (capturedAt: Date) =>
    encodeSharedPayload({
      verdict: "malicious",
      url: "https://paypal.com.secure-login.xyz/verify",
      summary: "Google Safe Browsing flagged this link.",
      capturedAt: capturedAt.toISOString(),
      signature: Array(8).fill("malicious"),
    });
  const fresh = shared(new Date());
  const old = shared(new Date(Date.now() - 4 * 24 * 60 * 60 * 1000));
  const sharedViews = [
    ["verified", sharedPath(fresh, signSharedPayload(fresh))],
    ["unverified", sharedPath(fresh, null)],
    ["expired", sharedPath(old, signSharedPayload(old))],
  ] as const;

  for (const [standard, width] of sizes) {
    const at = `${standard}px text at ${width}px`;
    await page.setViewportSize({ width, height: 700 });
    await setDefaultTextSize(page, standard);
    await gotoApp(page);
    expect(await scrollsSideways(), `home, ${at}`).toBe(false);

    // A short last part ("/login") whose caption runs past it, at the
    // right edge just after the link goes inline.
    await submitSingleScan(page, "https://critical.scrutinix.test/login");
    await expect(page.getByLabel(/^scan result: critical$/i)).toBeVisible();
    expect(await scrollsSideways(), `result, ${at}`).toBe(false);

    await page.getByRole("switch", { name: /^summary full/i }).click();
    await page.locator("li[data-signal] details").first().waitFor();
    await page.evaluate(() => {
      for (const row of document.querySelectorAll("details")) row.open = true;
    });
    expect(await scrollsSideways(), `full details, ${at}`).toBe(false);

    // A filter lengthens the export labels ("Export filtered history …").
    await page
      .getByRole("searchbox", { name: "Filter scan history" })
      .fill("scrutinix");
    await expect(
      page.getByRole("button", { name: "Export filtered history JSON" }),
    ).toBeVisible();
    expect(await scrollsSideways(), `filtered history, ${at}`).toBe(false);

    for (const [view, path] of sharedViews) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "Check another link" }),
      ).toBeVisible();
      expect(await scrollsSideways(), `${view} shared link, ${at}`).toBe(false);
    }
  }
}

// 150% from the narrowest phone, 200% from 360px; and where the link
// first goes inline at each size.
const REFLOW_SIZES = [
  [24, 320],
  [32, 360],
  [16, 656],
  [24, 960],
  [32, 1280],
] as const;

test("larger default text reflows without sideways scrolling @smoke", async ({
  page,
}) => {
  await expectReflow(page, REFLOW_SIZES);
});

test.describe("on a phone", () => {
  // Overlay scrollbars: the full width is the page's, so a bleed past the
  // gutter shows here even where a desktop scrollbar would absorb it.
  test.use({ isMobile: true, hasTouch: true });

  test("larger default text reflows without sideways scrolling @smoke", async ({
    page,
  }) => {
    await expectReflow(page, [
      [24, 320],
      [32, 360],
      [32, 375],
    ]);
  });
});

test("home page keyboard navigation @smoke", async ({ page }) => {
  await gotoApp(page);

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: /skip to content/i });
  await expect(skipLink).toBeFocused();

  const header = page.getByRole("banner");

  await page.keyboard.press("Tab");
  await expect(header.getByRole("link", { name: /^about$/i })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(header.getByRole("link", { name: /^privacy$/i })).toBeFocused();

  await page.keyboard.press("Tab");
  const themeToggle = page.getByRole("button", {
    name: /switch to light theme|switch to dark theme|toggle theme/i,
  });
  await expect(themeToggle).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("tab", { name: /^single$/i })).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^batch$/i })).toBeFocused();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`${colorScheme} theme has zero axe violations on a result @smoke`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await gotoApp(page);
    await submitSingleScan(page, "https://paypal.com.secure-login.xyz/verify");
    await expect(page.getByLabel(/^scan result: look-alike$/i)).toBeVisible();
    await page
      .getByRole("button", { name: /open next\.js dev tools/i })
      .evaluateAll((elements) =>
        elements.forEach((element) => element.remove()),
      );

    // Summary (the five questions) first, then Full (the eight rows).
    await expect(page.getByRole("list", { name: "Questions" })).toBeVisible();
    await settleAnimations(page);
    const summary = await new AxeBuilder({ page }).analyze();
    expect(summary.violations, "Summary").toEqual([]);

    await page.getByRole("switch", { name: /^summary full/i }).click();
    await expect(page.getByRole("list", { name: "Signals" })).toBeVisible();
    await settleAnimations(page);
    const full = await new AxeBuilder({ page }).analyze();
    expect(full.violations, "Full").toEqual([]);
  });

  test(`${colorScheme} theme has zero axe violations on a pasted link taken apart @smoke`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await gotoApp(page);
    await page
      .getByRole("textbox", { name: /url to analyze/i })
      .fill("https://paypal.com.secure-login.xyz/verify");
    await page
      .getByRole("button", { name: "Expecting a particular site?" })
      .click();
    await page
      .getByRole("textbox", { name: "Which site were you expecting?" })
      .fill("PayPal");
    await settleAnimations(page);
    await page
      .getByRole("button", { name: /open next\.js dev tools/i })
      .evaluateAll((elements) =>
        elements.forEach((element) => element.remove()),
      );

    const report = await new AxeBuilder({ page }).analyze();
    expect(report.violations).toEqual([]);
  });

  test(`${colorScheme} theme has zero axe violations on shared links, verified or not @smoke`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    const payload = encodeSharedPayload({
      verdict: "malicious",
      url: "https://paypal.com.secure-login.xyz/verify",
      summary: "Google Safe Browsing flagged this link.",
      // Inside the 3-day window a signed share is shown for.
      capturedAt: new Date().toISOString(),
      signature: Array(8).fill("malicious"),
    });
    for (const [label, sig] of [
      [/^scan result: malicious$/i, signSharedPayload(payload)],
      ["Shared link, not verified", null],
    ] as const) {
      await page.goto(sharedPath(payload, sig), {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByLabel(label)).toBeVisible();
      // Recipient-first: the form follows the shared result.
      await expect(
        page.getByRole("heading", { name: "Check another link" }),
      ).toBeVisible();
      await settleAnimations(page);
      await page
        .getByRole("button", { name: /open next\.js dev tools/i })
        .evaluateAll((elements) =>
          elements.forEach((element) => element.remove()),
        );
      const report = await new AxeBuilder({ page }).analyze();
      expect(report.violations, String(label)).toEqual([]);
    }
  });

  test(`${colorScheme} theme has zero axe violations at rest and on /about @smoke`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    for (const path of ["/", "/about", "/privacy"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("button", { name: /switch to (light|dark) theme/i }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: /open next\.js dev tools/i })
        .evaluateAll((elements) =>
          elements.forEach((element) => element.remove()),
        );
      const report = await new AxeBuilder({ page }).analyze();
      expect(report.violations, path).toEqual([]);
    }
  });
}
