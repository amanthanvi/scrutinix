import { expect, test, type Page } from "@playwright/test";

import { capture, readEvidence, saveDownload } from "./evidence";
import {
  SCAN_TIMEOUT_MS,
  fillSingle,
  gotoApp,
  historyState,
  isolateRateLimit,
  launchFromShareSheet,
  recordScans,
  scanSingle,
  setDefaultTextSize,
  waitForHydration,
} from "./support";

test.use({
  permissions: ["clipboard-read", "clipboard-write"],
});

const legacyEntry = {
  id: "legacy-example",
  url: "https://legacy.example/",
  verdict: "safe",
  signals: {},
  threatInfo: {
    verdict: "safe",
    summary: "Legacy history row kept on this device.",
  },
  metadata: { scanId: "legacy-example" },
  savedAt: "2026-03-21T00:00:00.480Z",
};

const LOOK_ALIKE = "https://paypal.com.secure-login.xyz/verify";
const LOOK_ALIKE_OWNER =
  "This link belongs to secure-login.xyz, not paypal.com.";

/**
 * Proving that nothing scanned needs a window to watch: a scan that starts
 * on its own starts as the page settles, well inside this.
 */
const QUIET_WINDOW_MS = 1_000;

function scrollsSideways(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
}

/** The result's polite live region (the expected-site answer is another). */
function liveRegion(page: Page) {
  return page
    .getByRole("region", { name: "Results", exact: true })
    .locator("p[aria-live='polite']");
}

async function ogImagePath(page: Page): Promise<string> {
  const content = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  expect(content).toBeTruthy();
  const url = new URL(content ?? "");
  return `${url.pathname}${url.search}`;
}

test("site chrome and theme", async ({ page }) => {
  await gotoApp(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Is this link what it says it is?",
    }),
  ).toBeVisible();
  // The empty history region exists but draws nothing.
  const history = page.getByRole("region", { name: "Scan history" });
  await expect(history).toBeAttached();
  await expect(history).toBeEmpty();
  const footer = page.getByRole("navigation", { name: "Footer" });
  await expect(footer.getByRole("link", { name: "About" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Privacy" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Source" })).toBeVisible();

  // Keyboard order: skip link, About, Privacy, theme, then the scanner.
  const primary = page.getByRole("navigation", { name: "Primary" });
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(primary.getByRole("link", { name: "About" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(primary.getByRole("link", { name: "Privacy" })).toBeFocused();
  await page.keyboard.press("Tab");
  const toggle = page.getByRole("button", {
    name: /switch to (light|dark) theme/i,
  });
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tab", { name: "Single" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Batch" })).toBeFocused();

  const before = await toggle.getAttribute("aria-label");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("aria-label", before ?? "");
  const stored = await page.evaluate(() => localStorage.getItem("theme"));
  expect(stored === "light" || stored === "dark").toBe(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", {
      name:
        stored === "light" ? "Switch to dark theme" : "Switch to light theme",
    }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute(
    "class",
    new RegExp(stored ?? "light"),
  );
  await capture(page, "chrome-theme.png");

  await page.goto("/no-such-scrutinix-page");
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await capture(page, "not-found.png");
});

test("about and privacy", async ({ page }) => {
  await gotoApp(page);
  const primary = page.getByRole("navigation", { name: "Primary" });
  await primary.getByRole("link", { name: "About" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "How a scan becomes a verdict.",
    }),
  ).toBeVisible();
  await expect(primary.getByRole("link", { name: "About" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // The open methodology: every section, the scoring tables, the bands,
  // how confidence adds up, and how to say the name.
  for (const name of [
    "Scoring",
    "Score bands",
    "Points for each finding",
    "The rules",
    "Confidence",
    "Reading the eight cells",
    "Which site a link belongs to",
    "Using the scanner",
    "The name",
  ]) {
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  for (const caption of [
    "Lists of known bad links",
    "Checks of the link itself",
    "What lowers the score",
  ]) {
    await expect(page.getByRole("table", { name: caption })).toBeVisible();
  }
  await expect(page.getByText("Safe", { exact: true })).toBeVisible();
  await expect(page.getByText("80–100", { exact: true })).toBeVisible();
  const confidenceTable = page.getByRole("columnheader", {
    name: "Percentage points",
  });
  await expect(confidenceTable).toBeHidden();
  await page.getByText("How the figure adds up", { exact: true }).click();
  await expect(confidenceTable).toBeVisible();
  await expect(page.getByText(/SCROO-tih-nix/)).toBeVisible();
  await capture(page, "about.png");

  await primary.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.locator("main#main-content").getByRole("heading", { level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shared links" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sharing to Scrutinix" }),
  ).toBeVisible();
  await expect(primary.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await capture(page, "privacy.png");

  await page.getByRole("link", { name: "Scrutinix home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("region", { name: "Scan console" }),
  ).toBeVisible();
});

test("hostile and empty inputs", async ({ page }) => {
  const scans = recordScans(page);
  await gotoApp(page);
  const pasted = page.getByRole("region", { name: "The link, taken apart" });

  await fillSingle(page, "   ");
  await page.getByRole("textbox", { name: "URL to analyze" }).press("Enter");
  await expect(page.locator("#sx-url-error")).toHaveText(
    "Paste a link to check.",
  );

  // A checkable link is taken apart once the parser is here, so an
  // absent breakdown below is a refusal, not a parser still loading.
  await fillSingle(page, "example.com");
  await expect(pasted).toContainText("example.com");

  // Only a checkable web link is taken apart.
  await fillSingle(page, "javascript:alert(1)");
  await expect(pasted).toHaveCount(0);
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(page.locator("#sx-url-error")).toHaveText(
    "Only web links (http or https) can be checked.",
  );
  await expect(page).toHaveURL(/\/$/);

  await fillSingle(page, "http://127.0.0.1/admin");
  await expect(pasted).toHaveCount(0);
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(page.locator("#sx-url-error")).toHaveText(
    "Links to your own computer or private network can't be checked.",
  );

  await fillSingle(page, "https://");
  await expect(pasted).toHaveCount(0);
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(page.locator("#sx-url-error")).toHaveText(
    "That doesn't look like a web link. Check it and try again.",
  );

  await fillSingle(page, `https://example.com/${"a".repeat(2100)}`);
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(page.locator("#sx-url-error")).toHaveText(
    "That link is too long to check (over 2,048 characters).",
  );
  await capture(page, "validation-hostile.png");

  await page.getByRole("tab", { name: "Batch" }).click();
  const batch = page.getByRole("textbox", {
    name: "URLs to analyze, one per line",
  });
  await batch.press("Control+Enter");
  await expect(
    page.getByText("Paste at least one link to check."),
  ).toBeVisible();

  const eleven = Array.from(
    { length: 11 },
    (_, index) => `https://example.com/p${index}`,
  ).join("\n");
  await expect(async () => {
    await batch.fill(eleven);
    await expect(batch).toHaveValue(eleven);
  }).toPass();
  await page.getByRole("button", { name: "Start batch" }).click();
  await expect(
    page.getByText(
      "That's 11 links. A batch checks up to 10 — remove some and try again.",
    ),
  ).toBeVisible();

  // Every refusal happened in the browser: no request, nothing saved.
  expect(scans).toEqual([]);
  expect((await historyState(page)).urls).toEqual([]);

  // A payload that does not decode is no shared link at all: the plain
  // home page, not the neutral band.
  await page.goto("/?shared=not-a-snapshot");
  await waitForHydration(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Is this link what it says it is?",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "URL to analyze" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: /scan result:/i })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Shared link, not verified" }),
  ).toHaveCount(0);
  expect(scans).toEqual([]);
});

test("legacy history migration", async ({ page }) => {
  await page.addInitScript(
    async ({ entry }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("malicious-url-detector-v2", 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("scans")) {
            const store = database.createObjectStore("scans", {
              keyPath: "id",
            });
            store.createIndex("by-saved-at", "savedAt");
          }
        };
        request.onerror = () => {
          reject(request.error ?? new Error("Failed to open legacy history."));
        };
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("scans", "readwrite");
          transaction.objectStore("scans").put(entry);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            reject(
              transaction.error ?? new Error("Failed to seed legacy history."),
            );
          };
        };
      });
    },
    { entry: legacyEntry },
  );

  await gotoApp(page);
  const history = page.getByRole("region", { name: "Scan history" });
  const row = history.getByRole("button", { name: /legacy\.example/i });
  await expect(row).toBeVisible();
  await expect
    .poll(async () => (await historyState(page)).names)
    .toContain("scrutinix-v2");
  await expect
    .poll(async () => (await historyState(page)).names)
    .not.toContain("malicious-url-detector-v2");
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toContain("https://legacy.example/");

  // Saved before per-check results were kept: a plain note, never eight
  // "failed" cells.
  await row.click();
  await expect(
    page.getByText(
      "This scan was saved before per-check results were kept, so its eight checks can't be shown. Re-scan for a fresh result.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Checks" })).toHaveCount(0);
  await capture(page, "history-legacy.png");
});

test("single scan share and rescan", async ({ page }) => {
  const scans = recordScans(page);
  await gotoApp(page);
  const verdict = await scanSingle(page, "example.com", "safe");
  await expect.poll(() => scans.length).toBe(1);
  await expect(verdict.getByText("Looks safe to open.")).toBeVisible();
  // The registered domain sits under the verdict word.
  await expect(verdict).toContainText("example.com");
  const meter = verdict.getByRole("meter", { name: "Threat score" });
  await expect(meter).toBeVisible();
  const score = Number(await meter.getAttribute("aria-valuenow"));
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(24);

  // Summary answers five plain questions; Full lists the eight checks as
  // "{Label}: {finding}" rows.
  const signalView = page.getByRole("switch", {
    name: "Summary Full signal list",
  });
  await expect(signalView).toHaveAttribute("aria-checked", "false");
  const questions = page.getByRole("list", { name: "Questions" });
  await expect(questions.getByRole("heading", { level: 4 })).toHaveCount(5);
  await expect(page.getByRole("list", { name: "Signals" })).toHaveCount(0);
  await signalView.click();
  await expect(signalView).toHaveAttribute("aria-checked", "true");
  const rows = page.getByRole("list", { name: "Signals" });
  await expect(rows.getByRole("listitem")).toHaveCount(8);
  await expect(rows.getByLabel(/^VirusTotal:/)).toHaveAttribute(
    "aria-label",
    "VirusTotal: No engines flagged this link.",
  );
  await expect(rows.getByLabel(/^DNS Profile:/)).toBeVisible();
  const tls = rows.getByLabel(/^TLS Certificate:/);
  await expect(tls).toBeVisible();
  await tls.click();
  await expect(page.getByText("Fixture CA")).toBeVisible();
  await capture(page, "single-safe.png");

  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download result (JSON)" }).click(),
  ]);
  await saveDownload(jsonDownload, "scan.json");
  expect(readEvidence("scan.json")).toContain("https://example.com/");
  await expect(
    page.getByText("Downloaded scan.json", { exact: true }),
  ).toBeVisible();

  // Re-scan asks the server again (an earlier smoke run may already have
  // cached example.com, so "cached" alone would not prove it ran).
  await page.getByRole("button", { name: "Re-scan" }).click();
  await expect.poll(() => scans.length).toBe(2);
  await expect(verdict.getByText("Looks safe to open.")).toBeVisible();
  await page.getByText("How we reached this verdict", { exact: true }).click();
  await expect(page.getByText(/· cached/)).toBeVisible();
  // History keeps one row per link: the re-scan replaces the first entry.
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toEqual(["https://example.com/"]);
  await expect(
    page
      .getByRole("region", { name: "Scan history" })
      .getByRole("heading", { name: /^History \(1 scan\)$/ }),
  ).toBeVisible();
  await capture(page, "single-rescan.png");

  // Share copies a link signed with the published e2e key launch sets.
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText("Link copied to clipboard")).toBeVisible();
  await expect(
    page.getByText("It shows this result for 3 days after the check."),
  ).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const link = new URL(copied);
  expect(link.searchParams.get("shared")).toBeTruthy();
  expect(link.searchParams.get("sig")).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Recipient-first: the verified result, then "Check another link".
  await page.goto(`${link.pathname}${link.search}`);
  await waitForHydration(page);
  const sharedVerdict = page.getByRole("region", {
    name: /^scan result: safe$/i,
  });
  await expect(sharedVerdict).toBeVisible();
  await expect(
    sharedVerdict.getByText(/^Verified Scrutinix result · checked/),
  ).toBeVisible();
  // A snapshot carries no score, so the instruction takes its hedged form.
  await expect(
    sharedVerdict.getByText("Probably safe — still check who sent it."),
  ).toBeVisible();
  await expect(
    sharedVerdict.getByRole("button", { name: "Run a fresh scan" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Checks" }).getByRole("listitem"),
  ).toHaveCount(8);
  await expect(
    page.getByRole("heading", { level: 2, name: "Check another link" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByText("Is this link what it says it is?")).toHaveCount(
    0,
  );
  const input = page.getByRole("textbox", { name: "URL to analyze" });
  await expect(input).toHaveValue("");
  await expect(input).not.toBeFocused();
  // The page previews as this result, through the signed share image.
  const image = await ogImagePath(page);
  expect(image).toContain("/og/result?shared=");
  const card = await page.request.get(image);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
  await capture(page, "single-shared-verified.png");

  // A shared result outranks a ?url= beside it: nothing is filled in.
  await page.goto(
    `${link.pathname}${link.search}&url=${encodeURIComponent("https://example.org/")}`,
  );
  await waitForHydration(page);
  await expect(sharedVerdict).toBeVisible();
  await expect(input).toHaveValue("");

  // The same payload without its signature is only a claim: the neutral
  // band and Scrutinix's own anatomy, no verdict, score, strip, or preview.
  const unsigned = new URLSearchParams({
    shared: link.searchParams.get("shared") ?? "",
  });
  await page.goto(`/?${unsigned.toString()}`);
  await waitForHydration(page);
  const neutral = page.getByRole("region", {
    name: "Shared link, not verified",
  });
  await expect(neutral).toBeVisible();
  await expect(
    neutral.getByRole("heading", { name: "Check this shared link yourself" }),
  ).toBeVisible();
  await expect(
    neutral.getByRole("button", { name: "Scan this link" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The link, taken apart" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: /scan result/i })).toHaveCount(
    0,
  );
  await expect(page.getByRole("meter")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Checks" })).toHaveCount(0);
  await expect(page.getByText(/verified scrutinix result/i)).toHaveCount(0);
  expect(await ogImagePath(page)).not.toContain("/og/result");
  await capture(page, "single-shared-unsigned.png");
});

test("verdicts and history", async ({ page }) => {
  await gotoApp(page);
  const malicious = await scanSingle(
    page,
    "https://malicious.scrutinix.test/login",
    "malicious",
  );
  await expect(malicious.getByText("Don't open this link.")).toBeVisible();
  // The "Has it been reported?" question states the conviction.
  await expect(page.locator('[data-question="reported"]')).toContainText(
    "7 of 70 VirusTotal engines flag it as malicious and 2 as suspicious.",
  );
  // Each numbered strip cell leads to the question citing its check.
  const strip = page.getByRole("toolbar", { name: "Checks" });
  await expect(strip.getByRole("button")).toHaveCount(8);
  await strip.getByRole("button", { name: /^DNS:/ }).click();
  await expect(
    page.getByRole("heading", { name: "What did the other checks find?" }),
  ).toBeFocused();
  await strip.getByRole("button", { name: /^Registration:/ }).click();
  await expect(
    page.getByRole("heading", { name: "What else raises concern?" }),
  ).toBeFocused();
  await capture(page, "verdict-malicious.png");

  const unknown = await scanSingle(
    page,
    "https://unreachable.scrutinix.test/",
    "unknown",
  );
  await expect(
    unknown.getByText("We couldn't check this link — treat it as unsafe."),
  ).toBeVisible();
  // Absence of findings is not a reason to score it: no meter.
  await expect(unknown.getByRole("meter")).toHaveCount(0);
  await expect(page.locator('[data-question="destination"]')).toContainText(
    "We couldn't reach the site, so we can't say where it leads.",
  );
  await capture(page, "verdict-unknown.png");

  await scanSingle(
    page,
    "https://feed-hit.scrutinix.test/payload.exe",
    "malicious",
  );
  await expect(page.locator('[data-question="reported"]')).toContainText(
    "URLhaus lists this link as active malware distribution (listed 6 hours ago).",
  );
  // In Full, the same strip cell opens and focuses its row.
  await page.getByRole("switch", { name: "Summary Full signal list" }).click();
  const feeds = page
    .getByRole("list", { name: "Signals" })
    .getByLabel(/^Threat Feeds:/);
  await expect(feeds).toHaveAttribute(
    "aria-label",
    "Threat Feeds: URLhaus lists this link as active malware distribution.",
  );
  await strip.getByRole("button", { name: /^Threat feeds:/ }).click();
  await expect(feeds).toBeFocused();
  await capture(page, "verdict-feed.png");

  await scanSingle(page, "https://example.org/", "safe");
  const history = page.getByRole("region", { name: "Scan history" });
  await expect(
    history.getByRole("heading", { name: /^History \(4 scans\)$/ }),
  ).toBeVisible();
  await expect(history.getByLabel("Filter scan history")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toHaveLength(4);

  const filter = history.getByLabel("Filter scan history");
  await filter.fill("unreachable");
  await expect(
    history.getByRole("button", { name: /unreachable\.scrutinix\.test/i }),
  ).toBeVisible();
  await expect(
    history.getByRole("button", { name: /example\.org/i }),
  ).toHaveCount(0);
  await capture(page, "history-filtered.png");

  await filter.fill("no-such-host-zzz");
  await expect(history).toContainText("No scans match this filter.");

  await filter.fill("");
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    history.getByRole("button", { name: "Export history CSV" }).click(),
  ]);
  await saveDownload(csvDownload, "scan-history.csv");
  const csv = readEvidence("scan-history.csv");
  expect(csv).toContain("unreachable.scrutinix.test");
  expect(csv).toContain("example.org");

  // Opening a saved result moves focus to its verdict and announces it.
  await history
    .getByRole("button", { name: /malicious\.scrutinix\.test/i })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: /^malicious$/i }),
  ).toBeFocused();
  await expect(
    page.getByRole("region", { name: /^scan result: malicious$/i }),
  ).toBeVisible();
  await expect(liveRegion(page)).toHaveText(
    /^Result for malicious\.scrutinix\.test: Malicious, \d+ out of 100\. Don't open this link\.$/,
  );

  await history.getByRole("button", { name: "Clear all history" }).click();
  await history
    .getByRole("button", { name: "Confirm clear all history" })
    .click();
  await expect(history).toContainText("History was cleared.");
  await expect.poll(async () => (await historyState(page)).urls).toEqual([]);
  await capture(page, "history-cleared.png");

  await history.getByRole("button", { name: "Undo clear history" }).click();
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toHaveLength(4);
  await expect(
    history.getByRole("button", { name: /example\.org/i }),
  ).toBeVisible();
  await capture(page, "history-restored.png");

  // The public pages leave history alone: About, Privacy, then the
  // wordmark back to the scanner, and all four rows are still here.
  const primary = page.getByRole("navigation", { name: "Primary" });
  await primary.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await primary.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await page.getByRole("link", { name: "Scrutinix home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    history.getByRole("heading", { name: /^History \(4 scans\)$/ }),
  ).toBeVisible();
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toHaveLength(4);
});

test("link taken apart on paste, then a look-alike", async ({ page }) => {
  const scans = recordScans(page);
  await gotoApp(page);
  await fillSingle(page, LOOK_ALIKE);

  // Taken apart in the browser before any scan.
  const pasted = page.getByRole("region", { name: "The link, taken apart" });
  await expect(pasted).toContainText("Registered domain");
  await expect(pasted).toContainText(LOOK_ALIKE_OWNER);
  await pasted
    .getByRole("button", { name: "Expecting a particular site?" })
    .click();
  const expected = page.getByRole("textbox", {
    name: "Which site were you expecting?",
  });
  await expect(expected).toBeFocused();
  await expected.fill("paypal.com");
  await expect(pasted).toContainText(
    "No. The link only spells out paypal.com.",
  );
  // The owner is stated once, by the anatomy, not again by the answer.
  await expect(pasted.getByText(LOOK_ALIKE_OWNER)).toHaveCount(1);
  await expected.fill("secure-login.xyz");
  await expect(pasted).toContainText("Matches secure-login.xyz.");
  await expected.fill("PayPal");
  await expect(pasted).toContainText(
    "We can't tell from a name whether secure-login.xyz is PayPal's site. Type its address to compare.",
  );
  await capture(page, "anatomy-paste.png");
  expect(scans).toEqual([]);

  // Analyze: the result's own anatomy takes over, and a Safe look-alike
  // reads "Look-alike" with no score.
  await page.getByRole("button", { name: "Analyze URL" }).click();
  const verdict = page.getByRole("region", {
    name: /^scan result: look-alike$/i,
  });
  await expect(verdict).toBeVisible({ timeout: SCAN_TIMEOUT_MS });
  await expect(pasted).toHaveCount(0);
  await expect.poll(() => scans.length).toBe(1);
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(scans).toHaveLength(1);
  await expect(
    verdict.getByRole("heading", { level: 2, name: "Look-alike" }),
  ).toBeVisible();
  await expect(verdict).toContainText("secure-login.xyz");
  await expect(
    verdict.getByText("Don't sign in or enter details here."),
  ).toBeVisible();
  await expect(verdict.getByRole("meter")).toHaveCount(0);
  await expect(verdict.getByText(/High confidence/)).toHaveCount(0);
  await expect(page.getByText(LOOK_ALIKE_OWNER, { exact: true })).toBeVisible();
  await page.getByText("How we reached this verdict", { exact: true }).click();
  await expect(
    page.getByText(
      /^No check flagged it: on their own, the checks scored it Safe, \d+ out of 100\.$/,
    ),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Scan history" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Look-alike");
  await capture(page, "verdict-look-alike.png");
});

test("error and critical verdicts", async ({ page }) => {
  await gotoApp(page);
  // Every check fails: Error, no score, the eight rows instead of the
  // questions, and the scan's reference stated once in the details.
  const error = await scanSingle(
    page,
    "https://error.scrutinix.test/",
    "error",
  );
  await expect(error.getByText("The scan failed — try again.")).toBeVisible();
  await expect(error.getByRole("meter")).toHaveCount(0);
  // The score's place offers what the instruction says.
  await expect(error.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Questions" })).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Signals" }).getByRole("listitem"),
  ).toHaveCount(8);
  await page.getByText("How we reached this verdict", { exact: true }).click();
  await expect(page.getByText(/^Reference: \S+$/)).toBeVisible();
  await capture(page, "verdict-error.png");

  const critical = await scanSingle(
    page,
    "https://critical.scrutinix.test/login",
    "critical",
  );
  await expect(
    critical.getByText("Don't open this link — it's a known threat."),
  ).toBeVisible();
  const score = Number(
    await critical
      .getByRole("meter", { name: "Threat score" })
      .getAttribute("aria-valuenow"),
  );
  expect(score).toBeGreaterThanOrEqual(80);
  await capture(page, "verdict-critical.png");

  // The band's scoring link opens the method.
  await critical.getByRole("link", { name: "How scoring works" }).click();
  await expect(page).toHaveURL(/\/about#scoring$/);
  await expect(
    page.getByRole("heading", { name: "Scoring", exact: true }),
  ).toBeVisible();
});

test("an address check that fails to load reads Unconfirmed", async ({
  page,
}) => {
  // Fail the lazily loaded link parser (tldts and its Public Suffix List).
  let parserRequests = 0;
  await page.route("**/_next/static/chunks/**/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("getPublicSuffix")) {
      parserRequests += 1;
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response, body });
  });
  await gotoApp(page);
  const verdict = await scanSingle(
    page,
    "https://paypal.com.safe.scrutinix.test/login",
    "unconfirmed",
  );
  expect(parserRequests).toBeGreaterThan(0);
  await expect(
    verdict.getByRole("heading", { level: 2, name: "Unconfirmed" }),
  ).toBeVisible();
  await expect(
    verdict.getByText("Check the link's address before you open it."),
  ).toBeVisible();
  await expect(
    verdict.getByText(
      "We couldn't check whether this address imitates another site.",
    ),
  ).toBeVisible();
  await expect(verdict.getByRole("meter")).toHaveCount(0);
  await expect(verdict).not.toContainText(/Safe|High confidence|Looks safe/);
  await expect(
    page
      .getByRole("region", { name: "Scan history" })
      .getByRole("listitem")
      .first(),
  ).toContainText("Unconfirmed");
  await capture(page, "verdict-unconfirmed.png");
});

test("sharing to Scrutinix fills in the link and waits for Analyze", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  const link = "https://malicious.scrutinix.test/login";
  const input = page.getByRole("textbox", { name: "URL to analyze" });
  const analyze = page.getByRole("button", { name: "Analyze URL" });

  // A /?url= link (bookmarklet, Shortcut, any page): normalized, filled in,
  // taken apart, Analyze focused, and no scan.
  await page.goto(
    `/?url=${encodeURIComponent("HTTPS://Malicious.Scrutinix.Test:443/login#top")}`,
    { waitUntil: "domcontentloaded" },
  );
  await waitForHydration(page);
  await expect(input).toHaveValue(link);
  await expect(analyze).toBeFocused();
  await expect(input).not.toBeFocused();
  await expect(
    page.getByRole("region", { name: "The link, taken apart" }),
  ).toContainText("scrutinix.test");
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(scans).toEqual([]);
  await expect(page.getByRole("region", { name: /scan result/i })).toHaveCount(
    0,
  );

  // Anything that isn't a link to check prefills nothing, silently.
  for (const value of ["javascript:alert(1)", "http://localhost/"]) {
    await page.goto(`/?url=${encodeURIComponent(value)}`, {
      waitUntil: "domcontentloaded",
    });
    await waitForHydration(page);
    await expect(input).toHaveValue("");
    await expect(page.locator("#scan-console").getByRole("alert")).toHaveCount(
      0,
    );
  }

  // Share → Scrutinix on Android: the share sheet POSTs to /share, which
  // keeps only the first link, sets nothing, and redirects to /?url=.
  const sent = await launchFromShareSheet(page, {
    title: "Delivery",
    text: `Your parcel is waiting: ${link}`,
    url: "",
  });
  expect(sent.method()).toBe("POST");
  expect([...new URL(page.url()).searchParams.keys()]).toEqual(["url"]);
  expect(await page.context().cookies()).toEqual([]);
  await waitForHydration(page);
  await expect(input).toHaveValue(link);
  await expect(analyze).toBeFocused();
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(scans).toEqual([]);
  await capture(page, "share-target-prefilled.png");

  // Only the tap scans, once, and the address drops the link.
  await analyze.click();
  await expect(
    page.getByRole("region", { name: /^scan result: malicious$/i }),
  ).toBeVisible({ timeout: SCAN_TIMEOUT_MS });
  await expect.poll(() => scans.length).toBe(1);
  await expect(page).not.toHaveURL(/[?&]url=/);
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(scans).toHaveLength(1);

  // Opened by hand, /share has nothing to receive and goes home.
  const opened = await page.request.get("/share", { maxRedirects: 0 });
  expect(opened.status()).toBe(303);
  expect(opened.headers().location).toBe("/");
});

test("batch scan", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("tab", { name: "Batch" }).click();
  const batch = page.getByRole("textbox", {
    name: "URLs to analyze, one per line",
  });
  const value = "example.org\nhttps://example.net";
  await expect(async () => {
    await batch.fill(value);
    await expect(batch).toHaveValue(value);
  }).toPass();
  await page.getByRole("button", { name: "Start batch" }).click();

  const results = page.getByRole("region", { name: "Batch scan results" });
  await expect(results).toBeVisible();
  await expect(results).toContainText("Batch results");
  await expect(results).toContainText("2/2");
  await expect(
    results.getByRole("button", {
      name: "Open result for example.org/",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    results.getByRole("button", {
      name: "Open result for example.net/",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toEqual(
      expect.arrayContaining(["https://example.org/", "https://example.net/"]),
    );
  await capture(page, "batch-complete.png");

  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export batch CSV" }).click(),
  ]);
  await saveDownload(csvDownload, "batch.csv");
  const csv = readEvidence("batch.csv");
  expect(csv).toContain("example.org");
  expect(csv).toContain("example.net");

  await results
    .getByRole("button", { name: "Open result for example.org/", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "Single" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const verdict = page.getByRole("region", { name: /^scan result: safe$/i });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("example.org");
  await capture(page, "batch-opened.png");
});

test("a Batch panel that fails to load retries in place", async ({ page }) => {
  await gotoApp(page);
  await page.waitForLoadState("networkidle");
  const chunks = "**/_next/static/chunks/**/*.js";
  await page.route(chunks, (route) => route.abort());

  // Batch's input and its results both arrive with the tab.
  const batchTab = page.getByRole("tab", { name: "Batch" });
  await batchTab.click();
  const panel = page.getByRole("tabpanel", { name: "Batch" });
  const results = page.getByRole("region", { name: "Results", exact: true });
  await expect(panel.getByRole("alert")).toHaveText(
    "Batch didn't load. Check your connection and try again.",
  );
  await expect(results.getByRole("alert")).toHaveText(
    "Batch results didn't load. Check your connection and try again.",
  );
  await expect(
    page.getByText("This part of the page stopped working."),
  ).toHaveCount(0);
  await capture(page, "batch-load-failed.png");

  // Single keeps working while Batch is down.
  await page.getByRole("tab", { name: "Single" }).click();
  await expect(
    page.getByRole("textbox", { name: "URL to analyze" }),
  ).toBeEditable();

  await page.unroute(chunks);
  await batchTab.click();
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("textbox", { name: "URLs to analyze, one per line" }),
  ).toBeVisible();
  await results.getByRole("button", { name: "Try again" }).click();
  await expect(results.getByRole("alert")).toHaveCount(0);
});

test("larger default text reflows without sideways scrolling", async ({
  page,
}) => {
  // 200% of the default text size on the narrowest phone width.
  await page.setViewportSize({ width: 320, height: 700 });
  await setDefaultTextSize(page, 32);
  await gotoApp(page);
  expect(await scrollsSideways(page), "home").toBe(false);

  await scanSingle(page, "https://critical.scrutinix.test/login", "critical");
  expect(await scrollsSideways(page), "result").toBe(false);
  await page.getByRole("switch", { name: "Summary Full signal list" }).click();
  await page.locator("li[data-signal] details").first().waitFor();
  await page.evaluate(() => {
    for (const row of document.querySelectorAll("details")) row.open = true;
  });
  expect(await scrollsSideways(page), "every check open").toBe(false);
  await capture(page, "reflow-result.png");

  for (const path of ["/about", "/privacy"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await page.evaluate(() => {
      for (const part of document.querySelectorAll("details")) part.open = true;
    });
    expect(await scrollsSideways(page), path).toBe(false);
  }
  await capture(page, "reflow-privacy.png");
});
