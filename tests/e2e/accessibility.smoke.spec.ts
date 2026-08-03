import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoApp } from "./helpers";

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
