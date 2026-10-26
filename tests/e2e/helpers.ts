import { createHmac } from "node:crypto";

import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
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

/**
 * A look-alike's owner sentence ("This link belongs to …, not …."): one
 * paragraph, drawn with its domains set apart and spoken as one string, so
 * `getByText` finds it twice (the drawn copy and the spoken one).
 */
export function ownerSentence(scope: Page | Locator): Locator {
  return scope.locator("p.sx-owner");
}

/**
 * The text nodes a screen reader gets from an element: those outside
 * `aria-hidden` and `hidden` subtrees. A sentence split across elements can
 * be read as separate stops (an inline-block inside it was, in TalkBack and
 * VoiceOver); one text node is always one. WebKit ignores aria-hidden on a
 * `display: contents` element, so that hides nothing here, in any engine.
 */
export function spokenTextNodes(locator: Locator): Promise<string[]> {
  return locator.evaluate((root) => {
    const found: string[] = [];
    const walk = (node: Node) => {
      if (
        node instanceof Element &&
        ((node.getAttribute("aria-hidden") === "true" &&
          getComputedStyle(node).display !== "contents") ||
          node.hasAttribute("hidden"))
      ) {
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent?.trim()) found.push(node.textContent);
        return;
      }
      node.childNodes.forEach(walk);
    };
    walk(root);
    return found;
  });
}

/**
 * The page's status region (`components/ui/announcer.tsx`): notifications,
 * a link arriving from outside, and the expected-site answer are said here.
 */
export function statusRegion(page: Page): Locator {
  return page.locator("p[role='status']");
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
 * The key that moves focus through every control in this engine: Tab, or
 * Option+Tab in WebKit on macOS. There, as in Safari unless "Press Tab to
 * highlight each item on a webpage" is on, Tab reaches only text fields,
 * selects, and elements with an explicit tabindex: it skips links, buttons,
 * and checkboxes. (WebKit on Linux, like Chromium and Firefox, tabs to
 * every control.)
 */
function tabKey(page: Page): "Tab" | "Alt+Tab" {
  const engine = page.context().browser()?.browserType().name();
  return engine === "webkit" && process.platform === "darwin"
    ? "Alt+Tab"
    : "Tab";
}

/** Move focus to the next control, as a keyboard reader of this engine does. */
export async function pressTab(page: Page) {
  await page.keyboard.press(tabKey(page));
}

/** Move focus to the previous control (Shift+Tab, or Option+Shift+Tab). */
export async function pressShiftTab(page: Page) {
  await page.keyboard.press(
    tabKey(page) === "Alt+Tab" ? "Alt+Shift+Tab" : "Shift+Tab",
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
  "Safari has no default text size setting. Its page zoom (View > Zoom In " +
  "on macOS, Aa on iOS) is covered by the 'page zoom reflows without " +
  "sideways scrolling' tests; its text-only zoom (View > Make Text Bigger, " +
  "Option-Command-Plus) is not a default size, and WebKit gives Playwright " +
  "no way to set either";

/**
 * Firefox's default text size for Latin text (the page is lang="en"), the
 * one preference Settings > Fonts > Size changes; monospace keeps the
 * platform's own default, as it does for a reader.
 */
function firefoxTextSizePrefs(standard: number) {
  return { "font.size.variable.x-western": standard };
}

/** The value Firefox ships for that preference. */
const FIREFOX_DEFAULT_TEXT_SIZE = 16;

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
 *   size, shared by the worker's tests; at Firefox's default (16px), the
 *   test's own browser.
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
          // The project's launch options (headless, args, and on macOS
          // env with MOZ_APP_DATA) apply as well, merged at the top level
          // only: spread `launchOptions.env` into any `env` passed here.
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
        browserName === "firefox" && standard !== FIREFOX_DEFAULT_TEXT_SIZE
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

/**
 * Hold every scan's NDJSON stream on this page: the real fixture response
 * is read in full, then handed to the app one line at a time.
 * `scan_started` goes out at once; `releaseScanLines(page, n)` sends the
 * next n lines (eight signal results, then `scan_complete`). `failCheck`
 * turns one check into a failure (its line and the final result), as a
 * provider timeout would, so the result carries a coverage caveat.
 */
export async function holdScanStream(
  page: Page,
  { failCheck = null }: { failCheck?: string | null } = {},
) {
  await page.addInitScript((failed) => {
    const failure = {
      status: "error",
      data: null,
      error: "This check could not be completed.",
      durationMs: 1,
    };
    const rewrite = (line: string) => {
      if (!failed) return line;
      const event = JSON.parse(line);
      if (event.type === "signal_result" && event.name === failed) {
        event.result = { ...event.result, ...failure };
      }
      if (event.type === "scan_complete") {
        event.result.signals[failed] = {
          ...event.result.signals[failed],
          ...failure,
        };
      }
      return JSON.stringify(event);
    };
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
      const lines = (await response.text())
        .split("\n")
        .filter(Boolean)
        .map(rewrite);
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
        if (sent === lines.length) {
          stream.close();
          // Sent in full: the next scan on this page brings its own.
          delete (window as { __sxRelease?: unknown }).__sxRelease;
        }
      };
      (window as unknown as { __sxRelease: typeof release }).__sxRelease =
        release;
      release(1);
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      });
    };
  }, failCheck);
}

/** Send the held scan's next `count` lines (see `holdScanStream`). */
export async function releaseScanLines(page: Page, count: number) {
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
