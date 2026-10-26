import { expect, test, type Page } from "@playwright/test";

import {
  gotoApp,
  holdScanStream,
  releaseScanLines,
  submitSingleScan,
  test as textSizeTest,
} from "./helpers";

/**
 * Nothing on the page moves when a scan lands. From "Checking" on, the
 * band holds the room the tallest verdict that can still land takes, and
 * nothing above the evidence collapses or appears as the verdict lands, so
 * for every fixture verdict the band keeps its height, the evidence keeps
 * its place, and the browser records no layout shift. The one exception,
 * a coverage caveat, is pinned below. Depends on SCRUTINIX_TEST_FIXTURES=1
 * (scripts/run-e2e.mjs); see lib/server/test-fixtures.ts for the scenarios.
 * The positions, measured at every frame of a landing (`watchLayout`), are
 * the check in every engine; the browser's own record of layout shifts is
 * Chromium's alone (`expectNoLayoutShift`).
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

const PHONE = { name: "phone", width: 375, height: 812, mobile: true };
const DESKTOP = { name: "desktop", width: 1280, height: 900, mobile: false };

const VIEWPORTS = [
  PHONE,
  // 48rem: the score's column starts here.
  { name: "tablet", width: 768, height: 1024, mobile: false },
  DESKTOP,
] as const;

/** The band's height and where everything from it to the evidence sits. */
type Layout = {
  band: number;
  /** What the band says first: the word, the site, the instruction. */
  said: (number | null)[];
  tops: number[];
  list: "questions" | "rows";
  items: number[];
};

/**
 * Before the page's own scripts run: `sxLayout`, the measure `layout`
 * takes; a watch that takes it at every frame from `markLanding` until
 * `landing` reads it, so a move that undoes itself before the end state is
 * measured is caught in every engine; and, where the engine records layout
 * shifts (Chromium alone), every shift with its start time, input or not:
 * a landing happens long after the tap, and any shift after `markLanding`
 * is the landing's.
 *
 * The measure is the band's height and where everything from the band to
 * the last question (or row) sits on the page: layout offsets, so neither
 * scrolling nor the viewport's edge hides a move. `list` names what the
 * evidence shows, since a failed scan trades the questions for its eight
 * rows when it lands (it has nothing to answer them with).
 */
async function watchLayout(page: Page) {
  await page.addInitScript(() => {
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
    const measure = (): Layout | null => {
      const heading = document.getElementById("sx-verdict-heading");
      const band = heading?.closest("section");
      if (!band) return null;
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
        said: [
          heading,
          band.querySelector(
            ":scope > .sx-band-body > .sx-band-head p.sx-band-domain",
          ),
          band.querySelector(":scope > .sx-band-body > .sx-band-imperative"),
        ].map((node) => (node ? top(node) : null)),
        tops: marks.map(top),
        list: questions.length > 0 ? "questions" : "rows",
        items: [
          ...(questions.length > 0
            ? questions
            : document.querySelectorAll('ul[aria-label="Signals"] > li')),
        ].map(top),
      };
    };

    const frames: (Layout | null)[] = [];
    let watching = false;
    const watch = () => {
      if (!watching) return;
      requestAnimationFrame(watch);
      frames.push(measure());
    };

    const shifts: { at: number; value: number; moved: string[] }[] = [];
    const recorded =
      PerformanceObserver.supportedEntryTypes.includes("layout-shift");
    Object.assign(window, {
      sxLayout: measure,
      sxFrames: frames,
      sxWatch: (on: boolean) => {
        if (on && !watching) {
          frames.length = 0;
          requestAnimationFrame(watch);
        }
        watching = on;
      },
      sxShifts: shifts,
      sxShiftsRecorded: recorded,
      sxLanding: Infinity,
    });
    if (!recorded) return;
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

/** The measure now (`watchLayout`). */
async function layout(page: Page) {
  const now = await page.evaluate(() =>
    (window as unknown as { sxLayout: () => Layout | null }).sxLayout(),
  );
  if (!now) throw new Error("No verdict band.");
  return now;
}

/** From here, anything that moves is the landing's: watch every frame. */
async function markLanding(page: Page) {
  await page.evaluate(() => {
    Object.assign(window, { sxLanding: performance.now() });
    (window as unknown as { sxWatch: (on: boolean) => void }).sxWatch(true);
  });
}

/**
 * The landing, once the frames after it have been drawn and reported:
 * every frame the watch measured, and the layout shifts the browser
 * recorded (where it records them).
 */
async function landing(page: Page) {
  return page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { sxFrames, sxWatch, sxShifts, sxShiftsRecorded, sxLanding } =
      window as unknown as {
        sxFrames: (Layout | null)[];
        sxWatch: (on: boolean) => void;
        sxShifts: { at: number; value: number; moved: string[] }[];
        sxShiftsRecorded: boolean;
        sxLanding: number;
      };
    sxWatch(false);
    const landed = sxShifts.filter((shift) => shift.at >= sxLanding);
    return {
      frames: [...sxFrames],
      recorded: sxShiftsRecorded,
      sum: landed.reduce((total, shift) => total + shift.value, 0),
      moved: landed.flatMap((shift) => shift.moved),
    };
  });
}

/**
 * `now` keeps `before`'s band height and positions; with `said`, the
 * band's word, site, and instruction stay put too, and with `items`, every
 * answer (or row).
 */
function expectStill(
  now: Layout | null,
  before: Layout,
  at: string,
  { said = false, items = false } = {},
) {
  expect(now, `${at}: verdict band`).not.toBeNull();
  if (!now) return;
  expect(now.band, `${at}: band height`).toBe(before.band);
  if (said) {
    expect(now.said, `${at}: word, site, instruction`).toEqual(before.said);
  }
  expect(now.tops, `${at}: positions`).toEqual(before.tops);
  if (items) {
    expect(now.items, `${at}: answers`).toEqual(before.items);
  }
}

/**
 * Nothing moved at any frame of the landing, in every engine: each frame
 * the watch measured keeps `before`'s layout (`expectStill`).
 */
function expectStillAtEveryFrame(
  frames: (Layout | null)[],
  before: Layout,
  at: string,
  options?: { said?: boolean; items?: boolean },
) {
  expect(frames.length, `${at}: frames measured`).toBeGreaterThan(0);
  frames.forEach((frame, index) =>
    expectStill(
      frame,
      before,
      `${at} (frame ${index + 1} of ${frames.length})`,
      options,
    ),
  );
}

/**
 * The browser recorded no layout shift in the landing. Chromium must
 * record them; Firefox and WebKit have no Layout Instability API (an empty
 * record there would prove nothing), so the check runs wherever it exists,
 * and the positions at every frame are the check everywhere.
 */
function expectNoLayoutShift(
  shifts: Awaited<ReturnType<typeof landing>>,
  browserName: string,
  link?: string,
) {
  if (browserName === "chromium") {
    expect(shifts.recorded, "Chromium records layout shifts").toBe(true);
  }
  if (shifts.recorded) {
    const moved = `moved ${shifts.moved.join(", ")}`;
    expect(shifts.sum, link ? `${link}: ${moved}` : moved).toBe(0);
  }
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
      browserName,
    }) => {
      test.setTimeout(120_000);
      await watchLayout(page);
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
        const landed = await landing(page);
        const after = await layout(page);
        // An Error result trades its questions for rows (checked below).
        const still = { said: true, items: word !== "Error" };
        expectStill(after, before, link, still);
        if (word === "Error") {
          expect([before.list, after.list]).toEqual(["questions", "rows"]);
        }
        expectStillAtEveryFrame(landed.frames, before, link, still);
        expectNoLayoutShift(landed, browserName, link);
      }
    });
  });
}

/**
 * The lazily loaded link parser's chunk: tldts and its Public Suffix List,
 * found by one of the list's entries (kitakyushu.jp). tldts' export names
 * are minified away now that only `parse` is imported.
 */
async function routeParser(page: Page, onParser: () => Promise<"go" | "fail">) {
  await page.route("**/_next/static/chunks/**/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("kitakyushu") && (await onParser()) === "fail") {
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
    browserName,
  }) => {
    let releaseParser = () => {};
    const parserHeld = new Promise<void>((resolve) => {
      releaseParser = resolve;
    });
    await routeParser(page, async () => {
      await parserHeld;
      return "go";
    });
    await watchLayout(page);
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
    const landed = await landing(page);
    expectStill(await layout(page), before, "held");
    expectStillAtEveryFrame(landed.frames, before, "held");
    expectNoLayoutShift(landed, browserName);

    // The parser arrives: the band states the verdict in the same room.
    // (The link's breakdown below it is drawn only now, so it may reflow.)
    releaseParser();
    await expect(
      page.getByLabel("Scan result: Safe", { exact: true }),
    ).toBeVisible();
    expect((await layout(page)).band).toBe(before.band);
  });

  test("a long registered domain the parser finds late moves nothing in the band", async ({
    page,
    browserName,
  }) => {
    // While the parser loads, the site's line holds the link's whole host,
    // which the registered domain never outgrows.
    const link = `https://${"a".repeat(63)}.com/`;
    let releaseParser = () => {};
    const parserHeld = new Promise<void>((resolve) => {
      releaseParser = resolve;
    });
    await routeParser(page, async () => {
      await parserHeld;
      return "go";
    });
    await watchLayout(page);
    await holdScanStream(page);
    await gotoApp(page);
    await page.evaluate(() => document.fonts.ready);
    await submitSingleScan(page, link);
    await releaseScanLines(page, 8);
    await expectChecksLanded(page);
    await releaseScanLines(page, 1);
    await expect(
      page.getByLabel("Checking the link's address", { exact: true }),
    ).toBeVisible();
    const held = await layout(page);

    // The site's line had nothing to say yet, so only the word and the
    // instruction are compared; the breakdown below may reflow.
    await markLanding(page);
    releaseParser();
    await expect(
      page.getByLabel("Scan result: Safe", { exact: true }),
    ).toBeVisible();
    const landed = await landing(page);
    for (const [index, frame] of [
      ...landed.frames,
      await layout(page),
    ].entries()) {
      expect(frame?.band, `frame ${index + 1}: band height`).toBe(held.band);
      expect(
        [frame?.said[0], frame?.said[2]],
        `frame ${index + 1}: word and instruction`,
      ).toEqual([held.said[0], held.said[2]]);
      expect(frame?.tops[0], `frame ${index + 1}: band`).toBe(held.tops[0]);
    }
    if (browserName === "chromium") expect(landed.recorded).toBe(true);
  });

  test("an Unconfirmed verdict lands without moving anything", async ({
    page,
    browserName,
  }) => {
    let parserRequests = 0;
    await routeParser(page, async () => {
      parserRequests += 1;
      return "fail";
    });
    await watchLayout(page);
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
    // The address check has failed: the band names no site. (If the check
    // was still retrying when the scan started, the site's line keeps the
    // host's room it held then, so the band never shrinks under the reader.)
    await expect(
      page.locator(".sx-band-head p.sx-band-domain:not([data-stand-in])"),
    ).toHaveCount(0);
    const before = await layout(page);

    await markLanding(page);
    await releaseScanLines(page, 1);
    await expect(
      page.getByLabel("Scan result: Unconfirmed", { exact: true }),
    ).toBeVisible();
    const landed = await landing(page);
    expectStill(await layout(page), before, "Unconfirmed");
    expectStillAtEveryFrame(landed.frames, before, "Unconfirmed");
    expectNoLayoutShift(landed, browserName);
  });
});

/**
 * At a larger default text size the Evidence switch wraps under its
 * heading. An Error result draws no switch but holds its place, so nothing
 * above its rows moves when it lands. (WebKit has no default text size
 * setting; `pageAtDefaultTextSize` skips it there.)
 */
for (const standard of [24, 32]) {
  textSizeTest(
    `an Error result moves nothing at ${standard}px text (375px)`,
    async ({ pageAtDefaultTextSize, browserName }) => {
      const page = await pageAtDefaultTextSize(standard, {
        viewport: { width: 375, height: 812 },
      });
      await watchLayout(page);
      await holdScanStream(page);
      await gotoApp(page);
      await page.evaluate(() => document.fonts.ready);
      await submitSingleScan(page, "https://error.scrutinix.test/");
      await releaseScanLines(page, 8);
      await expectChecksLanded(page);
      const before = await layout(page);

      await markLanding(page);
      await releaseScanLines(page, 1);
      await expect(
        page.getByLabel("Scan result: Error", { exact: true }),
      ).toBeVisible();
      const landed = await landing(page);
      expectStill(await layout(page), before, "Error", { said: true });
      expectStillAtEveryFrame(landed.frames, before, "Error", { said: true });
      expectNoLayoutShift(landed, browserName);
    },
  );
}

/**
 * A coverage caveat is the one thing a landing still adds. Which checks
 * failed or only partly answered is known before the verdict, but the
 * sentence that qualifies the verdict is stated with it, under the
 * instruction, and holding a line for it would leave a gap in every band.
 * It may grow the band by its own lines, at most (none where the verdict
 * leaves room), and moves nothing else: the word and instruction stay, and
 * everything below moves by exactly what the band grew.
 */
for (const viewport of [PHONE, DESKTOP]) {
  test.describe(`on a ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    });

    test(`a coverage caveat adds only its own lines (${viewport.width}px)`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await watchLayout(page);
      await holdScanStream(page, { failCheck: "whois" });
      for (const [link, word] of [
        ["https://malicious.scrutinix.test/login", "Malicious"],
        ["https://example.com/", "Safe"],
        ["https://unreachable.scrutinix.test/", "Unknown"],
      ] as const) {
        await gotoApp(page);
        await page.evaluate(() => document.fonts.ready);
        await submitSingleScan(page, link);
        await releaseScanLines(page, 8);
        await expectChecksLanded(page);
        const before = await layout(page);

        await releaseScanLines(page, 1);
        const band = page.getByLabel(`Scan result: ${word}`, { exact: true });
        await expect(band).toBeVisible();
        const caveat = band.locator(
          ":scope > .sx-band-body > .sx-band-tail > p:not(.sx-band-line)",
        );
        await expect(caveat).toHaveText("Domain Registration didn't finish.");
        const lines = await caveat.evaluate(
          (node) =>
            node.getBoundingClientRect().height +
            parseFloat(getComputedStyle(node).marginTop),
        );
        const after = await layout(page);
        const grew = after.band - before.band;
        expect(grew, `${link}: band growth`).toBeGreaterThanOrEqual(0);
        expect(grew, `${link}: band growth`).toBeLessThanOrEqual(lines + 0.5);
        expect(after.said, `${link}: word and instruction`).toEqual(
          before.said,
        );
        // Everything below the band moves by the band's growth and no more.
        // Layout offsets are whole pixels and the growth is not, so each
        // may round either way: one rounding before and one after leave a
        // true move less than 1px off (0.97px seen, Chromium on Linux).
        expect(after.tops[0], `${link}: band`).toBe(before.tops[0]);
        const below = [
          ...before.tops
            .slice(1)
            .map((offset, index) => [offset, after.tops[index + 1] ?? NaN]),
          ...before.items.map((offset, index) => [
            offset,
            after.items[index] ?? NaN,
          ]),
        ];
        expect(below.length, `${link}: compared`).toBeGreaterThan(5);
        for (const [was, is] of below) {
          expect(
            Math.abs((is ?? NaN) - (was ?? NaN) - grew),
            `${link}: ${was} moved to ${is}, the band grew ${grew}`,
          ).toBeLessThanOrEqual(1);
        }
      }
    });
  });
}
