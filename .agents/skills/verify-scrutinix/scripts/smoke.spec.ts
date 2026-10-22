import { expect, test } from "@playwright/test";

import { capture } from "./evidence";
import { fillSingle, gotoApp, historyState } from "./support";

test.use({
  permissions: ["clipboard-read", "clipboard-write"],
});

test("smoke home and safe scan", async ({ page }) => {
  await gotoApp(page);
  await expect(
    page.getByRole("region", { name: "Scan console" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Check a link against eight security signals before you open it.",
    ),
  ).toBeVisible();
  await capture(page, "smoke-home.png");

  await fillSingle(page, "example.com");
  await page.getByRole("button", { name: "Analyze URL" }).click();

  const verdict = page.getByRole("region", { name: /^scan result: safe$/i });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("example.com");
  await expect(page.getByRole("meter", { name: "Threat score" })).toBeVisible();
  await expect(page.getByLabel(/VirusTotal signal:/i)).toBeVisible();

  const history = page.getByRole("region", { name: "Scan history" });
  await expect(history.getByText(/example\.com/i).first()).toBeVisible();
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toContain("https://example.com/");
  await capture(page, "smoke-safe.png");
});
