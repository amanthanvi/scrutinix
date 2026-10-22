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
  const history = page.getByRole("region", { name: "Scan history" });
  await expect(history).toContainText(
    "Completed scans stay on this device and appear here.",
  );
  await expect(page.getByRole("contentinfo")).toContainText(
    "History stays on this device",
  );

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
  await expect(page.getByText("Enter a URL to analyze.")).toBeVisible();

  await fillSingle(page, "javascript:alert(1)");
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(
    page.getByText("Only HTTP and HTTPS URLs are supported."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await fillSingle(page, "http://127.0.0.1/admin");
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(
    page.getByText(
      "Private, localhost, and internal network URLs are not allowed.",
    ),
  ).toBeVisible();

  await fillSingle(page, `https://example.com/${"a".repeat(2100)}`);
  await page.getByRole("button", { name: "Analyze URL" }).click();
  await expect(
    page.getByText("URLs longer than 2048 characters are not supported."),
  ).toBeVisible();
  await expect.poll(async () => (await historyState(page)).urls).toEqual([]);
  await capture(page, "validation-hostile.png");

  await page.getByRole("tab", { name: "Batch" }).click();
  const batch = page.getByRole("textbox", {
    name: "URLs to analyze, one per line",
  });
  await batch.press("Control+Enter");
  await expect(page.getByText("Add at least one URL.")).toBeVisible();

  const eleven = Array.from(
    { length: 11 },
    (_, index) => `https://example.com/p${index}`,
  ).join("\n");
  await expect(async () => {
    await batch.fill(eleven);
    await expect(batch).toHaveValue(eleven);
  }).toPass();
  await page.getByRole("button", { name: "Start batch" }).click();
  await expect(page.getByText("Batch capped at 10 URLs.")).toBeVisible();

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
  await expect(history.getByText(/legacy\.example/i)).toBeVisible();
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
  await expect(verdict).toContainText("example.com");
  await expect(verdict).toContainText(
    "No direct malicious indicators were found in the completed signals.",
  );
  const meter = verdict.getByRole("meter", { name: "Threat score" });
  await expect(meter).toBeVisible();
  const score = Number(await meter.getAttribute("aria-valuenow"));
  expect(score).toBeGreaterThanOrEqual(0);
  expect(score).toBeLessThanOrEqual(24);

  const signalView = page.getByRole("switch", {
    name: "Show full signal list",
  });
  await expect(signalView).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel(/DNS Profile signal:/i)).toHaveCount(0);
  await signalView.click();
  await expect(signalView).toHaveAttribute("aria-checked", "true");
  const tls = page.getByLabel(/TLS Certificate signal:/i);
  await expect(tls).toBeVisible();
  await tls.click();
  await expect(page.getByText("Fixture CA")).toBeVisible();
  await capture(page, "single-safe.png");

  const [jsonDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export JSON" }).click(),
  ]);
  await saveDownload(jsonDownload, "scan.json");
  expect(readEvidence("scan.json")).toContain("https://example.com/");

  await page.getByRole("button", { name: "Re-scan" }).click();
  await expect(verdict).toBeVisible();
  await page.getByText("Details", { exact: true }).click();
  await expect(verdict).toContainText(/cached/i);
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toEqual(["https://example.com/", "https://example.com/"]);
  await capture(page, "single-rescan.png");

  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByText("Link copied to clipboard")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const shared = new URL(copied).searchParams.get("shared");
  expect(shared).toBeTruthy();
  const payload = JSON.parse(decodeURIComponent(atob(shared ?? ""))) as {
    url?: string;
    verdict?: string;
  };
  expect(payload.url).toBe("https://example.com/");
  expect(payload.verdict).toBe("safe");

  await page.goto(copied);
  await expect(page.getByText(/Shared snapshot/i)).toBeVisible();
  await expect(page.getByText(/example\.com/i).first()).toBeVisible();
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toContain("https://example.com/");
  await capture(page, "single-shared.png");
});

test("verdicts and history", async ({ page }) => {
  await gotoApp(page);
  await scanSingle(page, "https://malicious.scrutinix.test/login", "malicious");
  await expect(page.getByLabel(/VirusTotal signal:/i)).toContainText(
    /malicious and .* suspicious engine flags/i,
  );
  await capture(page, "verdict-malicious.png");

  await scanSingle(page, "https://unreachable.scrutinix.test/", "unknown");
  await expect(
    page.getByText(/host was unreachable.*not evidence of safety/i),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /^scan result: safe$/i }),
  ).toHaveCount(0);
  await capture(page, "verdict-unknown.png");

  await scanSingle(
    page,
    "https://feed-hit.scrutinix.test/payload.exe",
    "malicious",
  );
  await expect(page.getByLabel(/Threat Feeds signal:/i)).toContainText(
    /feed match/i,
  );
  await capture(page, "verdict-feed.png");

  await scanSingle(page, "https://example.org/", "safe");
  const history = page.getByRole("region", { name: "Scan history" });
  await expect(history.getByLabel("Filter scan history")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toHaveLength(4);

  const filter = page
    .getByRole("region", { name: "Scan history" })
    .getByLabel("Filter scan history");
  await filter.fill("unreachable");
  const historyAfterFilter = page.getByRole("region", { name: "Scan history" });
  await expect(
    historyAfterFilter.getByText(/unreachable\.scrutinix\.test/i),
  ).toBeVisible();
  await expect(historyAfterFilter.getByText(/example\.org/i)).toHaveCount(0);
  await capture(page, "history-filtered.png");

  await filter.fill("no-such-host-zzz");
  await expect(historyAfterFilter).toContainText("No scans match this filter.");

  await filter.fill("");
  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    historyAfterFilter
      .getByRole("button", { name: "Export history as CSV" })
      .click(),
  ]);
  await saveDownload(csvDownload, "scan-history.csv");
  const csv = readEvidence("scan-history.csv");
  expect(csv).toContain("unreachable.scrutinix.test");
  expect(csv).toContain("example.org");

  await historyAfterFilter
    .getByRole("button", { name: /malicious\.scrutinix\.test/i })
    .click();
  await expect(
    page.getByRole("region", { name: /^scan result: malicious$/i }),
  ).toContainText("malicious.scrutinix.test");

  await historyAfterFilter
    .getByRole("button", { name: "Clear all history" })
    .click();
  await historyAfterFilter
    .getByRole("button", { name: "Confirm clear all history" })
    .click();
  await expect(historyAfterFilter).toContainText("History was cleared.");
  await expect.poll(async () => (await historyState(page)).urls).toEqual([]);
  await capture(page, "history-cleared.png");

  await historyAfterFilter
    .getByRole("button", { name: "Undo clearing scan history" })
    .click();
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toHaveLength(4);
  await expect(historyAfterFilter.getByText(/example\.org/i)).toBeVisible();
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
  await expect(results).toContainText("Batch complete");
  await expect(results).toContainText("2/2");
  await expect(results).toContainText("example.org");
  await expect(results).toContainText("example.net");
  await expect
    .poll(async () => (await historyState(page)).urls)
    .toEqual(
      expect.arrayContaining(["https://example.org/", "https://example.net/"]),
    );
  await capture(page, "batch-complete.png");

  const [csvDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export CSV" }).click(),
  ]);
  await saveDownload(csvDownload, "batch.csv");
  const csv = readEvidence("batch.csv");
  expect(csv).toContain("example.org");
  expect(csv).toContain("example.net");

  await results.getByRole("button", { name: "Open" }).first().click();
  await expect(page.getByRole("tab", { name: "Single" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const verdict = page.getByRole("region", { name: /^scan result: safe$/i });
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("example.org");
  await capture(page, "batch-opened.png");
});
