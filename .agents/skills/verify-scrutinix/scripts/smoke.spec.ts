import { expect, test } from "@playwright/test";

import { capture } from "./evidence";
import { SCAN_TIMEOUT_MS, fillSingle, gotoApp, historyState } from "./support";

test("smoke home and safe scan", async ({ page }) => {
  await gotoApp(page);
  await expect(
    page.getByRole("region", { name: "Scan console" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Is this link what it says it is?",
    }),
  ).toBeVisible();
  await capture(page, "smoke-home.png");

  // The link is taken apart as soon as it is in the field, before a scan.
  await fillSingle(page, "example.com");
  await expect(
    page.getByRole("region", { name: "The link, taken apart" }),
  ).toContainText("example.com");
  await page.getByRole("button", { name: "Analyze URL" }).click();

  const verdict = page.getByRole("region", { name: /^scan result: safe$/i });
  await expect(verdict).toBeVisible({ timeout: SCAN_TIMEOUT_MS });
  await expect(
    verdict.getByRole("heading", { level: 2, name: "Safe" }),
  ).toBeVisible();
  await expect(verdict.getByText("Looks safe to open.")).toBeVisible();
  await expect(
    verdict.getByRole("meter", { name: "Threat score" }),
  ).toBeVisible();
  // Summary answers five questions; the numbered strip indexes all eight.
  const questions = page.getByRole("list", { name: "Questions" });
  await expect(questions.getByRole("heading", { level: 4 })).toHaveCount(5);
  await expect(questions.locator('[data-question="reported"]')).toContainText(
    "Not on any list we checked.",
  );
  await expect(
    page.getByRole("toolbar", { name: "Checks" }).getByRole("button"),
  ).toHaveCount(8);

  const history = page.getByRole("region", { name: "Scan history" });
  await expect(history.getByText(/example\.com/i).first()).toBeVisible();
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toContain("https://example.com/");
  await capture(page, "smoke-safe.png");
});
