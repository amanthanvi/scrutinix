import { expect, test, type Page } from "@playwright/test";

import {
  gotoApp,
  holdScanStream,
  releaseScanLines as release,
  submitSingleScan,
} from "./helpers";

/**
 * Summary layout on real browsers: phone width, held streams, copying.
 * Depends on SCRUTINIX_TEST_FIXTURES=1 (scripts/run-e2e.mjs); see
 * lib/server/test-fixtures.ts for the scenarios.
 */

const LONGEST_LABEL_HOST =
  "accountverificationandsecuritycheckpointforyoursigninportalnowx.com";

/** Each question heading's layout offset from the top of the list (transforms ignored). */
async function headingOffsets(page: Page) {
  return page
    .getByRole("list", { name: "Questions" })
    .evaluate((list: HTMLElement) => {
      const top = (node: HTMLElement) => {
        let sum = 0;
        for (
          let at: HTMLElement | null = node;
          at;
          at = at.offsetParent as HTMLElement | null
        ) {
          sum += at.offsetTop;
        }
        return sum;
      };
      const origin = top(list);
      return [...list.querySelectorAll<HTMLElement>("h4")].map(
        (heading) => top(heading) - origin,
      );
    });
}

async function nextFrame(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

for (const width of [390, 1280]) {
  test(`questions hold their place while checks land (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await holdScanStream(page);
    await gotoApp(page);
    await submitSingleScan(page, "example.com");

    const questions = page.getByRole("list", { name: "Questions" });
    await expect(questions.locator('li[aria-busy="true"]')).toHaveCount(5);
    const pending = await headingOffsets(page);

    // One check at a time: no heading moves as answers fill in. Each
    // measurement waits until that check has landed in the strip.
    const landed = page
      .getByRole("toolbar", { name: "Checks" })
      .locator('[data-severity]:not([data-severity="pending"])');
    for (let check = 0; check < 8; check += 1) {
      await release(page, 1);
      await expect(landed).toHaveCount(check + 1);
      await nextFrame(page);
      expect(await headingOffsets(page), `after check ${check + 1}`).toEqual(
        pending,
      );
    }
    await expect(questions.locator('li[aria-busy="true"]')).toHaveCount(0);

    // The verdict lands; the questions stay put.
    await release(page, 1);
    await expect(page.getByLabel(/^scan result: safe$/i)).toBeVisible();
    expect(await headingOffsets(page)).toEqual(pending);
  });
}

test("a long destination host wraps instead of widening a phone screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page);
  await submitSingleScan(page, "https://long-hop.scrutinix.test/");
  await expect(page.getByLabel(/^scan result: /i)).toBeVisible();

  const destination = page.locator('[data-question="destination"]');
  // Named whole, never truncated.
  await expect(destination).toContainText(
    `It ends on ${LONGEST_LABEL_HOST}, a different site`,
  );
  const overflow = () =>
    page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
  const summary = await overflow();
  expect(summary.page).toBeLessThanOrEqual(summary.viewport);
  const box = await destination.boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(summary.viewport);
});

test("copying a question's sources gives the plain list once", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "example.com");
  await expect(page.getByLabel(/^scan result: safe$/i)).toBeVisible();

  const sources = page.locator('[data-question="reported"] .sx-sources');
  const copied = await sources.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(copied.replace(/\s+/g, " ").trim()).toBe(
    "Sources: VirusTotal, Safe Browsing, Threat feeds",
  );
  // The numbered line, dots and all, is drawn for the eye only.
  const numbered = sources.locator('[aria-hidden="true"]');
  await expect(numbered).toContainText("·");
  await expect(numbered).toHaveCSS("user-select", "none");
});
