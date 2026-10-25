import { expect, test, type Page } from "@playwright/test";

import {
  gotoApp,
  holdScanStream,
  releaseScanLines,
  submitSingleScan,
} from "./helpers";

/**
 * Nothing on the page moves when a scan lands. From "Checking" on, the
 * band holds the room its tallest verdict takes, and nothing above the
 * evidence collapses or appears as the verdict lands, so for every fixture
 * verdict the band keeps its height, the evidence keeps its place, and the
 * browser records no layout shift. Depends on SCRUTINIX_TEST_FIXTURES=1
 * (scripts/run-e2e.mjs); see lib/server/test-fixtures.ts for the scenarios.
 */

const VERDICTS = [
  ["https://example.com/", "Safe"],
  ["https://malicious.scrutinix.test/login", "Malicious"],
  ["https://critical.scrutinix.test/login", "Critical"],
  ["https://unreachable.scrutinix.test/", "Unknown"],
  ["https://error.scrutinix.test/", "Error"],
  ["https://feed-hit.scrutinix.test/payload.exe", "Malicious"],
  ["https://long-hop.scrutinix.test/", "Safe"],
  ["https://paypal.com.safe.scrutinix.test/login", "Look-alike"],
] as const;

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812, mobile: true },
  { name: "desktop", width: 1280, height: 900, mobile: false },
] as const;

/**
 * Record every layout shift on the page with its start time, input or not:
 * a landing happens long after the tap, and any shift after `markLanding`
 * is the landing's.
 */
async function recordLayoutShifts(page: Page) {
  await page.addInitScript(() => {
    const shifts: { at: number; value: number; moved: string[] }[] = [];
    Object.assign(window, { sxShifts: shifts, sxLanding: Infinity });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        startTime: number;
        value: number;
        sources?: { node?: Node | null }[];
      }[]) {
        shifts.push({
          at: entry.startTime,
          value: entry.value,
          moved: (entry.sources ?? []).map((source) =>
            source.node instanceof Element
              ? `${source.node.tagName.toLowerCase()}.${source.node.className}`
              : String(source.node?.nodeName),
          ),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

async function markLanding(page: Page) {
  await page.evaluate(() =>
    Object.assign(window, { sxLanding: performance.now() }),
  );
}

/** The landing's shifts, once the frames after it have been reported. */
async function landingShifts(page: Page) {
  return page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { sxShifts, sxLanding } = window as unknown as {
      sxShifts: { at: number; value: number; moved: string[] }[];
      sxLanding: number;
    };
    const landed = sxShifts.filter((shift) => shift.at >= sxLanding);
    return {
      sum: landed.reduce((total, shift) => total + shift.value, 0),
      moved: landed.flatMap((shift) => shift.moved),
    };
  });
}

/**
 * The band's height and where everything from the band to the last
 * question (or row) sits on the page: layout offsets, so neither scrolling
 * nor the viewport's edge hides a move. `list` names what the evidence
 * shows, since a failed scan trades the questions for its eight rows when
 * it lands (it has nothing to answer them with).
 */
function layout(page: Page) {
  return page.evaluate(() => {
    const heading = document.getElementById("sx-verdict-heading");
    const band = heading?.closest("section");
    if (!band) throw new Error("No verdict band.");
    const top = (node: Element) => {
      let sum = 0;
      for (
        let at: HTMLElement | null = node as HTMLElement;
        at;
        at = at.offsetParent as HTMLElement | null
      ) {
        sum += at.offsetTop;
      }
      return sum;
    };
    const marks = [
      band,
      document.getElementById("sx-link-anatomy-heading"),
      document.getElementById("sx-evidence-heading"),
      document.querySelector('[role="toolbar"][aria-label="Checks"]'),
      document.querySelector(
        'ul[aria-label="Questions"], ul[aria-label="Signals"]',
      ),
    ].filter((node): node is Element => node !== null);
    const questions = document.querySelectorAll(
      'ul[aria-label="Questions"] h4',
    );
    return {
      band: band.getBoundingClientRect().height,
      tops: marks.map(top),
      list: questions.length > 0 ? "questions" : "rows",
      items: [
        ...(questions.length > 0
          ? questions
          : document.querySelectorAll('ul[aria-label="Signals"] > li')),
      ].map(top),
    };
  });
}

/** Every check's cell has settled in the strip. */
async function expectChecksLanded(page: Page) {
  await expect(
    page
      .getByRole("toolbar", { name: "Checks" })
      .locator('[data-severity]:not([data-severity="pending"])'),
  ).toHaveCount(8);
}

for (const viewport of VIEWPORTS) {
  test.describe(`on a ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    });

    test(`nothing moves when any verdict lands (${viewport.width}px)`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await recordLayoutShifts(page);
      await holdScanStream(page);
      for (const [link, word] of VERDICTS) {
        await gotoApp(page);
        await page.evaluate(() => document.fonts.ready);
        await submitSingleScan(page, link);
        const checking = page.getByLabel("Scanning URL");
        await expect(checking).toBeVisible();
        const started = (await layout(page)).band;

        // Every check lands; the verdict hasn't.
        await releaseScanLines(page, 8);
        await expectChecksLanded(page);
        await expect(checking).toBeVisible();
        const before = await layout(page);
        expect(before.band, `${link}: checks landing`).toBe(started);

        await markLanding(page);
        await releaseScanLines(page, 1);
        await expect(
          page.getByLabel(`Scan result: ${word}`, { exact: true }),
        ).toBeVisible();
        const shifts = await landingShifts(page);
        const after = await layout(page);
        expect(after.band, `${link}: band height`).toBe(before.band);
        expect(after.tops, `${link}: positions`).toEqual(before.tops);
        if (word === "Error") {
          expect([before.list, after.list]).toEqual(["questions", "rows"]);
        } else {
          expect(after.items, `${link}: answers`).toEqual(before.items);
        }
        expect(shifts.sum, `${link}: moved ${shifts.moved.join(", ")}`).toBe(0);
      }
    });
  });
}

/** The lazily loaded link parser's chunk: tldts and its Public Suffix List. */
async function routeParser(page: Page, onParser: () => Promise<"go" | "fail">) {
  await page.route("**/_next/static/chunks/**/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("getPublicSuffix") && (await onParser()) === "fail") {
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response, body });
  });
}

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });

  test("a Safe verdict held for the address check, and the one it becomes, keep the band's height", async ({
    page,
  }) => {
    let releaseParser = () => {};
    const parserHeld = new Promise<void>((resolve) => {
      releaseParser = resolve;
    });
    await routeParser(page, async () => {
      await parserHeld;
      return "go";
    });
    await recordLayoutShifts(page);
    await holdScanStream(page);
    await gotoApp(page);
    await page.evaluate(() => document.fonts.ready);
    await submitSingleScan(page, "https://example.com/");
    await releaseScanLines(page, 8);
    await expectChecksLanded(page);
    const before = await layout(page);

    // The verdict lands while the parser is still loading: the band holds.
    await markLanding(page);
    await releaseScanLines(page, 1);
    await expect(
      page.getByLabel("Checking the link's address", { exact: true }),
    ).toBeVisible();
    const shifts = await landingShifts(page);
    const held = await layout(page);
    expect(held.band).toBe(before.band);
    expect(held.tops).toEqual(before.tops);
    expect(shifts.sum, `moved ${shifts.moved.join(", ")}`).toBe(0);

    // The parser arrives: the band states the verdict in the same room.
    // (The link's breakdown below it is drawn only now, so it may reflow.)
    releaseParser();
    await expect(
      page.getByLabel("Scan result: Safe", { exact: true }),
    ).toBeVisible();
    expect((await layout(page)).band).toBe(before.band);
  });

  test("an Unconfirmed verdict lands without moving anything", async ({
    page,
  }) => {
    let parserRequests = 0;
    await routeParser(page, async () => {
      parserRequests += 1;
      return "fail";
    });
    await recordLayoutShifts(page);
    await holdScanStream(page);
    await gotoApp(page);
    await page.evaluate(() => document.fonts.ready);
    // Typing loads the parser; let it fail (and be retried) first.
    await page
      .getByRole("textbox", { name: /url to analyze/i })
      .fill("https://paypal.com.safe.scrutinix.test/login");
    await expect.poll(() => parserRequests).toBeGreaterThanOrEqual(3);
    await page.getByRole("button", { name: /analyze url/i }).click();
    await releaseScanLines(page, 8);
    await expectChecksLanded(page);
    // The address check has failed: no domain line is held for it.
    await expect(page.locator(".sx-band-domain")).toHaveCount(0);
    const before = await layout(page);

    await markLanding(page);
    await releaseScanLines(page, 1);
    await expect(
      page.getByLabel("Scan result: Unconfirmed", { exact: true }),
    ).toBeVisible();
    const shifts = await landingShifts(page);
    const after = await layout(page);
    expect(after.band).toBe(before.band);
    expect(after.tops).toEqual(before.tops);
    expect(shifts.sum, `moved ${shifts.moved.join(", ")}`).toBe(0);
  });
});
