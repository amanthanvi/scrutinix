import { createHmac } from "node:crypto";

import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

/**
 * Navigate to the app and wait for React hydration. The theme toggle's
 * accessible name flips from "Toggle theme" to "Switch to ... theme" during
 * its first client render, so once it appears the page is interactive - no
 * fixed sleeps needed.
 */
export async function gotoApp(page: Page) {
  await isolateRateLimit(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
}

/**
 * Wait for running entrance motion to settle so axe measures final colors.
 * Infinite animations never finish, and React can cancel a transition when it
 * re-renders after hydration - a cancelled animation's `finished` rejects with
 * an AbortError - so only finite animations are awaited and cancellation
 * counts as settled.
 */
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.allSettled(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().endTime !== Infinity,
        )
        .map((animation) => animation.finished),
    ),
  );
}

/** Fill the single-scan input and submit it. */
export async function submitSingleScan(page: Page, url: string) {
  const input = page.getByRole("textbox", { name: /url to analyze/i });
  await expect(async () => {
    await input.fill(url);
    await expect(input).toHaveValue(url);
  }).toPass();
  await page.getByRole("button", { name: /analyze url/i }).click();
}

let clientCounter = 0;

/**
 * Give each test its own rate-limit identity. The suite runs more scans
 * than one client may start per minute (lib/server/rate-limit.ts), so the
 * limit stays as shipped and each test presents a distinct documentation
 * address (198.51.100.0/24) through the x-real-ip header the limiter trusts.
 */
export async function isolateRateLimit(page: Page) {
  clientCounter += 1;
  await page.setExtraHTTPHeaders({
    "x-real-ip": `198.51.100.${(process.pid + clientCounter) % 250}`,
  });
}

/**
 * A `?shared=` payload: base64 of the URI-encoded JSON snapshot, as
 * `encodeSharedSnapshot` writes it.
 */
export function encodeSharedPayload(snapshot: object): string {
  return Buffer.from(encodeURIComponent(JSON.stringify(snapshot))).toString(
    "base64",
  );
}

/**
 * The server's signature of a payload, computed here from the documented
 * contract (lib/server/share-signing.ts) with the test-only key
 * `scripts/run-e2e.mjs` hands both the server and this runner.
 */
export function signSharedPayload(payload: string): string {
  const secret = process.env.SHARE_SIGNING_SECRET;
  if (!secret) {
    throw new Error("SHARE_SIGNING_SECRET is unset; run via npm run test:e2e.");
  }
  return createHmac("sha256", secret)
    .update(`scrutinix-share-v1\n${payload}`)
    .digest("base64url");
}

/** A `/?shared=` path, signed unless `sig` is null. */
export function sharedPath(payload: string, sig: string | null): string {
  const params = new URLSearchParams({ shared: payload });
  if (sig) params.set("sig", sig);
  return `/?${params.toString()}`;
}

/**
 * Move focus to the next control, links included, with the key a reader of
 * this engine presses: Tab, or Option+Tab in WebKit on macOS, where Tab
 * skips links as Safari does unless "Press Tab to highlight each item on a
 * webpage" is on. (WebKit on Linux, like Chromium and Firefox, tabs to
 * links.)
 */
export async function pressTab(page: Page) {
  const engine = page.context().browser()?.browserType().name();
  await page.keyboard.press(
    engine === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab",
  );
}

/**
 * Set Chromium's default text size on an open page over DevTools
 * (Page.setFontSizes), the setting a reader changes for larger text: rem
 * grows (padding and rem media queries included) while the viewport
 * doesn't, which page zoom or a root font-size override would not
 * reproduce. Chromium only; specs use `pageAtDefaultTextSize`, which works
 * in every engine that has the setting.
 */
export async function setDefaultTextSize(page: Page, standard: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setFontSizes", { fontSizes: { standard, fixed: 13 } });
}

/** Why `pageAtDefaultTextSize` skips the test in WebKit. */
export const NO_DEFAULT_TEXT_SIZE_IN_SAFARI =
  "Safari has no default text size setting (its text-size controls, macOS " +
  "zoom and iOS's Aa, zoom the page, which the 320px reflow checks cover), " +
  "and WebKit gives Playwright no way to set one";

/**
 * Firefox's default text size, as Settings > Fonts > Size stores it for
 * Latin text (the page is lang="en"); monospace stays at its own default.
 */
function firefoxTextSizePrefs(standard: number) {
  return {
    "font.size.variable.x-western": standard,
    "font.size.monospace.x-western": 13,
  };
}

/**
 * Opens a new page, in a new context with the test's options (viewport,
 * isMobile, baseURL, ...) plus `options`, whose browser's default text size
 * is `standard` px. The page starts blank: navigate it and recreate any
 * state the check needs (`options.storageState` carries history).
 */
export type PageAtDefaultTextSize = (
  standard: number,
  options?: BrowserContextOptions,
) => Promise<Page>;

/**
 * `test` with `pageAtDefaultTextSize`, the engine-portable way to see a
 * page at a reader's default text size:
 *
 * - Chromium: a context in the test's browser, set over DevTools before
 *   anything loads.
 * - Firefox: a context in a browser launched with the reader's preference
 *   (Playwright sets Firefox preferences only at launch), one browser per
 *   size, shared by the worker's tests.
 * - WebKit: the test is skipped (NO_DEFAULT_TEXT_SIZE_IN_SAFARI) before it
 *   starts, so request the fixture only in tests that need the setting.
 *
 * (Playwright's docs call each fixture's `provide` argument `use`, a name
 * react-hooks/rules-of-hooks reads as a React hook.)
 */
export const test = base.extend<
  { pageAtDefaultTextSize: PageAtDefaultTextSize },
  { firefoxAtDefaultTextSize: (standard: number) => Promise<Browser> }
>({
  firefoxAtDefaultTextSize: [
    async ({ playwright, launchOptions }, provide) => {
      const launched = new Map<number, Promise<Browser>>();
      await provide((standard) => {
        let browser = launched.get(standard);
        if (!browser) {
          // The project's launch options (headless, args) apply as well.
          browser = playwright.firefox.launch({
            firefoxUserPrefs: {
              ...launchOptions.firefoxUserPrefs,
              ...firefoxTextSizePrefs(standard),
            },
          });
          launched.set(standard, browser);
        }
        return browser;
      });
      const browsers = await Promise.allSettled(launched.values());
      for (const browser of browsers) {
        if (browser.status === "fulfilled") await browser.value.close();
      }
    },
    { scope: "worker" },
  ],
  pageAtDefaultTextSize: async (
    { browser, browserName, firefoxAtDefaultTextSize },
    provide,
    testInfo,
  ) => {
    testInfo.skip(browserName === "webkit", NO_DEFAULT_TEXT_SIZE_IN_SAFARI);
    const contexts: BrowserContext[] = [];
    await provide(async (standard, options = {}) => {
      const host =
        browserName === "firefox"
          ? await firefoxAtDefaultTextSize(standard)
          : browser;
      const context = await host.newContext(options);
      contexts.push(context);
      const page = await context.newPage();
      if (browserName === "chromium") {
        await setDefaultTextSize(page, standard);
      }
      return page;
    });
    for (const context of contexts) await context.close();
  },
});
