import { expect, test, type Locator, type Page } from "@playwright/test";

import { gotoApp, submitSingleScan } from "./helpers";

/**
 * Share links carry an unsigned snapshot anyone can write. These specs mint
 * links by hand, as an attacker would, and rely on the offline fixtures in
 * lib/server/test-fixtures.ts for the fresh scan's verdict.
 */

const phishingUrl = "https://malicious.scrutinix.test/login";

function shareLink(payload: string): string {
  return `/?shared=${encodeURIComponent(payload)}`;
}

const forgedLink = shareLink(
  Buffer.from(
    encodeURIComponent(
      JSON.stringify({
        verdict: "safe",
        url: phishingUrl,
        summary: "Verified safe by the Scrutinix security team.",
        capturedAt: "Checked by Scrutinix staff today",
      }),
    ),
  ).toString("base64"),
);

function snapshotRegion(page: Page): Locator {
  return page.getByRole("region", { name: "Unverified snapshot" });
}

/** Every text colour used inside `region`, resolved by the browser. */
async function textColors(region: Locator): Promise<string[]> {
  return region.evaluate((element) =>
    [element, ...element.querySelectorAll("*")].map(
      (node) => getComputedStyle(node).color,
    ),
  );
}

async function verdictColors(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ["safe", "suspicious", "malicious", "critical", "info", "error"].map(
      (verdict) => {
        const probe = document.createElement("span");
        probe.style.color = `var(--sx-${verdict}-fg)`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      },
    ),
  );
}

test("a forged share link opens as an unverified snapshot, then scans for real @smoke", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await gotoApp(page, forgedLink);

  const snapshot = snapshotRegion(page);
  await expect(snapshot).toBeVisible();
  await expect(snapshot.getByText("Claimed verdict")).toBeVisible();
  await expect(snapshot.getByText("safe", { exact: true })).toBeVisible();
  await expect(snapshot.getByText(/Checked by Scrutinix staff/)).toHaveCount(0);
  await expect(page.getByLabel(/scan result/i)).toHaveCount(0);
  await expect(page.getByRole("meter", { name: /threat score/i })).toHaveCount(
    0,
  );

  const forbidden = await verdictColors(page);
  for (const color of await textColors(snapshot)) {
    expect(forbidden).not.toContain(color);
  }

  await snapshot.getByRole("button", { name: "Scan this URL" }).click();

  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  await expect(snapshot).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("a share link from the first release stays readable @smoke", async ({
  page,
}) => {
  const legacyLink = shareLink(
    Buffer.from(
      JSON.stringify({
        verdict: "suspicious",
        url: "https://legacy.example/",
        summary: "Suspicious risk based on reputation signals.",
        capturedAt: "2026-03-06T06:05:08.000Z",
      }),
    ).toString("base64"),
  );

  await gotoApp(page, legacyLink);

  const snapshot = snapshotRegion(page);
  await expect(snapshot).toBeVisible();
  await expect(snapshot.getByText("legacy.example/")).toBeVisible();
  await expect(snapshot.getByText("suspicious", { exact: true })).toBeVisible();
  await expect(
    snapshot.getByText("Suspicious risk based on reputation signals."),
  ).toBeVisible();
  await expect(snapshot.getByText("Claimed scan time")).toBeVisible();
});

test("sharing a result copies a link that opens unverified @smoke", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoApp(page);
  await submitSingleScan(page, "example.com");
  await expect(page.getByLabel(/^scan result: safe$/i)).toBeVisible();

  await page.getByRole("button", { name: /^share$/i }).click();
  await expect(
    page.getByText(/opens as an unverified snapshot/i),
  ).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).searchParams.get("shared")).toBeTruthy();

  await gotoApp(page, link);

  const snapshot = snapshotRegion(page);
  await expect(snapshot).toBeVisible();
  await expect(snapshot.getByText("example.com/")).toBeVisible();
  await expect(snapshot.getByText("safe", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/scan result/i)).toHaveCount(0);
});
