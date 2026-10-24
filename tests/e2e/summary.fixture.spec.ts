import { expect, test, type Page } from "@playwright/test";

import { gotoApp, submitSingleScan } from "./helpers";

/**
 * Summary layout on real browsers: phone width, held streams, copying.
 * Depends on SCRUTINIX_TEST_FIXTURES=1 (scripts/run-e2e.mjs); see
 * lib/server/test-fixtures.ts for the scenarios.
 */

const LONGEST_LABEL_HOST =
  "accountverificationandsecuritycheckpointforyoursigninportalnowx.com";

/**
 * Hold the next scan's NDJSON stream: the real fixture response is read in
 * full, then handed to the app one line at a time. `scan_started` goes out
 * at once; `release(n)` sends the next n lines (eight signal results, then
 * `scan_complete`).
 */
async function holdScanStream(page: Page) {
  await page.addInitScript(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (!new URL(url, location.href).pathname.endsWith("/api/analyze")) {
        return realFetch(input, init);
      }
      const response = await realFetch(input, init);
      const lines = (await response.text()).split("\n").filter(Boolean);
      const encoder = new TextEncoder();
      let sent = 0;
      let stream!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
      });
      const release = (count: number) => {
        for (; count > 0 && sent < lines.length; count -= 1) {
          stream.enqueue(encoder.encode(`${lines[sent]}\n`));
          sent += 1;
        }
        if (sent === lines.length) stream.close();
      };
      (window as unknown as { __sxRelease: typeof release }).__sxRelease =
        release;
      release(1);
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    };
  });
}

async function release(page: Page, count: number) {
  // The questions show as pending before the response arrives.
  await page.waitForFunction(() => "__sxRelease" in window);
  await page.evaluate(
    (n) =>
      (window as unknown as { __sxRelease: (n: number) => void }).__sxRelease(
        n,
      ),
    count,
  );
}

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

    // One check at a time: no heading moves as answers fill in.
    for (let check = 0; check < 8; check += 1) {
      await release(page, 1);
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

test("copying a question's sources gives one separator between names", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "example.com");
  await expect(page.getByLabel(/^scan result: safe$/i)).toBeVisible();

  const sources = page
    .locator('[data-question="reported"]')
    .getByText(/^Sources:/);
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
  // The dot between names is still drawn, just not as text.
  const dots = await sources.evaluate((node) =>
    [...node.children]
      .map((child) => getComputedStyle(child, "::before").content)
      .filter((content) => content.includes("·")),
  );
  expect(dots).toHaveLength(2);
});
