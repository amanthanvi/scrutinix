import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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

test("larger default text reflows without sideways scrolling @smoke", async ({
  page,
}) => {
  const scrollsSideways = () =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
  // 150% from the narrowest phone; 200% from a common phone width.
  for (const [standard, width] of [
    [24, 320],
    [32, 375],
  ] as const) {
    await page.setViewportSize({ width, height: 700 });
    await setDefaultTextSize(page, standard);
    await gotoApp(page);
    expect(await scrollsSideways(), `home, ${standard}px at ${width}`).toBe(
      false,
    );

    await submitSingleScan(page, "https://critical.scrutinix.test/login");
    await expect(page.getByLabel(/^scan result: critical$/i)).toBeVisible();
    expect(await scrollsSideways(), `result, ${standard}px at ${width}`).toBe(
      false,
    );

    // Every check's details open, in the Full list.
    await page.getByRole("switch", { name: /^summary full/i }).click();
    await page.locator("li[data-signal] details").first().waitFor();
    await page.evaluate(() => {
      for (const row of document.querySelectorAll("details")) row.open = true;
    });
    expect(
      await scrollsSideways(),
      `full details, ${standard}px at ${width}`,
    ).toBe(false);
  }
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
