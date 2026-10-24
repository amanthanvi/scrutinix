import { expect, test } from "@playwright/test";
import { gotoApp, submitSingleScan } from "./helpers";

for (const width of [1440, 375]) {
  test(`Batch preserves its layout while its chunk loads at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page);
    await page.waitForLoadState("networkidle");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_next/static/chunks/*.js", async (route) => {
      await held;
      await route.continue();
    });
    await page.getByRole("tab", { name: "Batch", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Batch" });
    await expect(panel.locator('[aria-busy="true"]')).toBeVisible();
    const before = await panel.boundingBox();
    release();
    await expect(
      page.getByRole("textbox", { name: "URLs to analyze, one per line" }),
    ).toBeVisible();
    const after = await panel.boundingBox();
    expect(after?.height).toBe(before?.height);
  });
}

test("a failed notification chunk preserves the result and first notification", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://safe.scrutinix.test");
  await expect(
    page.getByRole("heading", { name: "Safe", exact: true }),
  ).toBeVisible();
  const typography = await page
    .getByRole("meter", { name: "Threat score" })
    .evaluate((meter) => {
      const style = getComputedStyle(meter);
      const widths = Array.from("0123456789", (digit) => {
        const probe = document.createElement("span");
        probe.style.font = style.font;
        probe.style.fontVariantNumeric = style.fontVariantNumeric;
        probe.textContent = digit;
        document.body.append(probe);
        const width = probe.getBoundingClientRect().width;
        probe.remove();
        return width;
      });
      return {
        widths,
        display: getComputedStyle(document.documentElement).getPropertyValue(
          "--font-display",
        ),
      };
    });
  expect(new Set(typography.widths).size).toBe(1);
  expect(typography.display).toContain("system-ui");
  await page.waitForLoadState("networkidle");
  await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
  await page.getByRole("button", { name: "Download result (JSON)" }).click();
  await expect(
    page.getByText("Downloaded scan.json", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Safe", exact: true }),
  ).toBeVisible();
});
