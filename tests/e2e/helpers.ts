import { createHmac } from "node:crypto";

import { expect, type Page } from "@playwright/test";

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
 * Set the browser's default text size, the setting a reader changes for
 * larger text: rem grows (padding included) while the viewport doesn't,
 * which page zoom or a root font-size override would not reproduce.
 */
export async function setDefaultTextSize(page: Page, standard: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setFontSizes", { fontSizes: { standard, fixed: 13 } });
}

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
