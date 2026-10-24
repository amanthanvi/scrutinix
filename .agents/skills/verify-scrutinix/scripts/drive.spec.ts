import { expect, test } from "@playwright/test";

import { capture, readEvidence, saveDownload } from "./evidence";
import { fillSingle, gotoApp, historyState, scanSingle } from "./support";

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

test("site chrome and theme", async ({ page }) => {
  await gotoApp(page);
  // The empty history region exists but draws nothing.
  const history = page.getByRole("region", { name: "Scan history" });
  await expect(history).toBeAttached();
  await expect(history).toBeEmpty();
  const footer = page.getByRole("navigation", { name: "Footer" });
  await expect(footer.getByRole("link", { name: "About" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Source" })).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "About",
    }),
  ).toBeFocused();

  const toggle = page.getByRole("button", {
    name: /switch to (light|dark) theme/i,
  });
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
    page.getByRole("heading", { name: "How a scan becomes a verdict." }),
  ).toBeVisible();
  await expect(primary.getByRole("link", { name: "About" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("heading", { name: "Score bands" }),
  ).toBeVisible();
  await expect(page.getByText("Safe", { exact: true })).toBeVisible();
  await capture(page, "about.png");

  await primary.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(
    page.locator("main#main-content").getByRole("heading", { level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Shared links" }),
  ).toBeVisible();
  await expect(primary.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await capture(page, "privacy.png");

  await page.getByRole("link", { name: "Scrutinix" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("region", { name: "Scan console" }),
  ).toBeVisible();
});

test("hostile and empty inputs", async ({ page }) => {
  await gotoApp(page);

  await fillSingle(page, "   ");
  await page.getByRole("textbox", { name: "URL to analyze" }).press("Enter");
  await expect(page.locator("#sx-url-error")).toHaveText(
    "Paste a link to check.",
  );

  await fillSingle(page, "javascript:alert(1)");
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(page.locator("#sx-url-error")).toHaveText(
    "Only web links (http or https) can be checked.",
  );
  await expect(page).toHaveURL(/\/$/);

  await fillSingle(page, "http://127.0.0.1/admin");
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(page.locator("#sx-url-error")).toHaveText(
    "Links to your own computer or private network can't be checked.",
  );

  await fillSingle(page, `https://example.com/${"a".repeat(2100)}`);
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(page.locator("#sx-url-error")).toHaveText(
    "That link is too long to check (over 2,048 characters).",
  );
  await expect.poll(async () => (await historyState(page)).urls).toEqual([]);
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

  await page.goto("/?shared=not-a-snapshot");
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "URL to analyze" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: /scan result:/i })).toHaveCount(
    0,
  );
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
  await expect(
    history.getByRole("button", { name: /legacy\.example/i }),
  ).toBeVisible();
  await expect
    .poll(async () => (await historyState(page)).names)
    .toContain("scrutinix-v2");
  await expect
    .poll(async () => (await historyState(page)).names)
    .not.toContain("malicious-url-detector-v2");
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toContain("https://legacy.example/");
  await capture(page, "history-legacy.png");
});

test("single scan share and rescan", async ({ page }) => {
  await gotoApp(page);
  const verdict = await scanSingle(page, "example.com", "safe");
  await expect(verdict.getByText("Looks safe to open.")).toBeVisible();
  await expect(page.getByText(/example\.com/i).first()).toBeVisible();
  const meter = verdict.getByRole("meter", { name: "Threat score" });
  await expect(meter).toBeVisible();
  const score = Number(await meter.getAttribute("aria-valuenow"));
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(24);

  // Summary shows one quiet line when nothing drove the verdict; Full lists
  // all eight rows.
  const signalView = page.getByRole("switch", {
    name: "Summary Full signal list",
  });
  await expect(signalView).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("All 8 checks found nothing.")).toBeVisible();
  await expect(page.getByLabel(/DNS Profile signal:/i)).toHaveCount(0);
  await signalView.click();
  await expect(signalView).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel(/DNS Profile signal:/i)).toBeVisible();
  const tls = page.getByLabel(/TLS Certificate signal:/i);
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

  await page.getByRole("button", { name: "Re-scan" }).click();
  await expect(verdict).toBeVisible();
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
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const link = new URL(copied);
  expect(link.searchParams.get("shared")).toBeTruthy();
  expect(link.searchParams.get("sig")).toMatch(/^[A-Za-z0-9_-]{43}$/);

  await page.goto(`${link.pathname}${link.search}`);
  const sharedVerdict = page.getByRole("region", {
    name: /^scan result: safe$/i,
  });
  await expect(sharedVerdict).toBeVisible();
  await expect(
    sharedVerdict.getByText(/^Verified Scrutinix result · checked/),
  ).toBeVisible();
  await expect(page.getByText(/example\.com/i).first()).toBeVisible();
  await capture(page, "single-shared-verified.png");

  // The same payload without its signature is only a claim: the neutral band,
  // no verdict, score, or strip.
  const unsigned = new URLSearchParams({
    shared: link.searchParams.get("shared") ?? "",
  });
  await page.goto(`/?${unsigned.toString()}`);
  const neutral = page.getByLabel("Shared link, not verified");
  await expect(neutral).toBeVisible();
  await expect(
    neutral.getByRole("heading", { name: "Check this shared link yourself" }),
  ).toBeVisible();
  await expect(
    neutral.getByRole("button", { name: "Scan this link" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: /scan result/i })).toHaveCount(
    0,
  );
  await expect(page.getByRole("meter")).toHaveCount(0);
  await expect(page.getByText(/verified scrutinix result/i)).toHaveCount(0);
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
  await expect(page.getByLabel(/VirusTotal signal:/i)).toContainText(
    /engines flagged this link as malicious/i,
  );
  await capture(page, "verdict-malicious.png");

  const unknown = await scanSingle(
    page,
    "https://unreachable.scrutinix.test/",
    "unknown",
  );
  await expect(
    unknown.getByText("We couldn't check this link — treat it as unsafe."),
  ).toBeVisible();
  await expect(page.getByRole("meter", { name: "Threat score" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: /^scan result: safe$/i }),
  ).toHaveCount(0);
  await capture(page, "verdict-unknown.png");

  await scanSingle(
    page,
    "https://feed-hit.scrutinix.test/payload.exe",
    "malicious",
  );
  await expect(page.getByLabel(/Threat Feeds signal:/i)).toHaveAttribute(
    "aria-label",
    "Threat Feeds signal: URLhaus lists this link as active malware distribution.",
  );
  await capture(page, "verdict-feed.png");

  await scanSingle(page, "https://example.org/", "safe");
  const history = page.getByRole("region", { name: "Scan history" });
  await expect(
    history.getByRole("heading", { name: /^History \(4 scans\)$/ }),
  ).toBeVisible();
  await expect(history.getByLabel("Filter scan history")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
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

  await history
    .getByRole("button", { name: /malicious\.scrutinix\.test/i })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: /^malicious$/i }),
  ).toBeFocused();
  await expect(
    page.getByRole("region", { name: /^scan result: malicious$/i }),
  ).toBeVisible();

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
    results.getByRole("button", { name: "Open result for example.org" }),
  ).toBeVisible();
  await expect(
    results.getByRole("button", { name: "Open result for example.net" }),
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
    .getByRole("button", { name: "Open result for example.org" })
    .click();
  await expect(page.getByRole("tab", { name: "Single" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const verdict = page.getByRole("region", { name: /^scan result: safe$/i });
  await expect(verdict).toBeVisible();
  await expect(page.getByText(/example\.org/i).first()).toBeVisible();
  await capture(page, "batch-opened.png");
});
