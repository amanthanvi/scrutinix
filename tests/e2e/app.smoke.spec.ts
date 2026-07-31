import { expect, test } from "@playwright/test";

import { createPendingSignalResults } from "@/lib/domain/types";

const legacyHistoryEntry = buildLegacyHistoryEntry();

test("legacy history migrates into the Scrutinix database @smoke", async ({
  page,
}) => {
  await page.addInitScript(
    async ({ entry }) => {
      await new Promise<void>((resolve, reject) => {
        const request = window.indexedDB.open("malicious-url-detector-v2", 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("scans")) {
            const store = database.createObjectStore("scans", {
              keyPath: "id",
            });
            store.createIndex("by-saved-at", "savedAt");
          }
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
        request.onerror = () => {
          reject(
            request.error ??
              new Error("Failed to open the legacy history database."),
          );
        };
      });
    },
    { entry: legacyHistoryEntry },
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_000);

  const historyRegion = page.getByRole("region", { name: /scan history/i });
  await expect(historyRegion.getByText(/legacy\.example/i)).toBeVisible();

  const databaseNames = await page.evaluate(async () => {
    if (typeof indexedDB.databases !== "function") {
      return [];
    }

    const databases = await indexedDB.databases();
    return databases.flatMap((database) =>
      typeof database.name === "string" ? [database.name] : [],
    );
  });

  expect(databaseNames).toContain("scrutinix-v2");
  expect(databaseNames).not.toContain("malicious-url-detector-v2");
});

function buildLegacyHistoryEntry() {
  const signals = createPendingSignalResults();

  signals.virusTotal = {
    status: "success",
    error: null,
    durationMs: 22,
    data: {
      malicious: 0,
      suspicious: 0,
      harmless: 8,
      undetected: 22,
      timeout: 0,
      results: [],
      permalink: "https://www.virustotal.com/gui/url/legacy-example",
    },
  };
  signals.mlEnsemble = {
    status: "success",
    error: null,
    durationMs: 14,
    data: {
      hostedModel: null,
      lexicalModel: {
        label: "benign",
        score: 0.08,
        reasons: ["No suspicious lexical patterns were found."],
        model: "lexical-heuristic",
      },
      consensusLabel: "benign",
      consensusScore: 0.08,
      reasons: ["No suspicious lexical patterns were found."],
      warnings: [],
    },
  };
  signals.googleSafeBrowsing = {
    status: "success",
    error: null,
    durationMs: 8,
    data: {
      checkedAt: "2026-03-21T00:00:00.000Z",
      matches: [],
    },
  };
  signals.threatFeeds = {
    status: "success",
    error: null,
    durationMs: 7,
    data: {
      checkedAt: "2026-03-21T00:00:00.000Z",
      matches: [],
      observations: [],
      warnings: [],
    },
  };
  signals.ssl = {
    status: "success",
    error: null,
    durationMs: 11,
    data: {
      protocol: "TLSv1.3",
      available: true,
      validationState: "trusted",
      authorized: true,
      authorizationError: null,
      issuer: "Example CA",
      subject: "legacy.example",
      validFrom: "2026-03-01T00:00:00.000Z",
      validTo: "2027-03-01T00:00:00.000Z",
      daysRemaining: 344,
      selfSigned: false,
      fingerprint256: "legacy-fingerprint",
      observations: [],
    },
  };
  signals.whois = {
    status: "success",
    error: null,
    durationMs: 9,
    data: {
      subjectType: "domain",
      available: true,
      registrar: "Example Registrar",
      registeredAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
      ageDays: 810,
      country: "US",
      handle: "EXAMPLE-DOMAIN",
      rdapUrl: "https://rdap.example.test/domain/legacy.example",
      observations: [],
    },
  };
  signals.dns = {
    status: "success",
    error: null,
    durationMs: 6,
    data: {
      subjectType: "hostname",
      addresses: ["93.184.216.34"],
      cnames: [],
      mx: ["mx.example.test"],
      txt: [],
      nameservers: ["ns1.example.test"],
      reverseHostnames: [],
      anomalies: [],
      observations: [],
    },
  };
  signals.redirectChain = {
    status: "success",
    error: null,
    durationMs: 12,
    data: {
      finalUrl: "https://legacy.example/",
      totalHops: 0,
      httpsUpgraded: false,
      reachable: true,
      terminalStatus: 200,
      terminalError: null,
      hops: [
        {
          url: "https://legacy.example/",
          status: 200,
        },
      ],
      observations: [],
    },
  };

  return {
    id: "legacy-example",
    url: "https://legacy.example/",
    verdict: "safe" as const,
    signals,
    threatInfo: {
      verdict: "safe" as const,
      confidence: 0.64,
      confidenceLabel: "moderate" as const,
      confidenceReasons: [
        "Primary reputation sources completed without malicious indicators.",
      ],
      hasPositiveEvidence: false,
      score: 8,
      summary:
        "No strong malicious indicators were found in the completed signals.",
      categories: [],
      reasons: [],
      recommendations: ["Treat this as a point-in-time result."],
      limitations: [],
    },
    metadata: {
      scanId: "legacy-example",
      startedAt: "2026-03-21T00:00:00.000Z",
      completedAt: "2026-03-21T00:00:00.480Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 480,
    },
    savedAt: "2026-03-21T00:00:00.480Z",
  };
}

test("single scan flow @smoke", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_000);

  const singleUrlInput = page.getByRole("textbox", {
    name: /url to analyze/i,
  });
  await expect(page.getByRole("tab", { name: /^single$/i })).toBeVisible();
  await expect(singleUrlInput).toBeVisible();
  await expect(page.getByRole("button", { name: /^analyze$/i })).toBeVisible();
  await expect(
    page.getByRole("region", { name: /scan history/i }),
  ).toBeVisible();

  await expect(async () => {
    await singleUrlInput.fill("example.com");
    await expect(singleUrlInput).toHaveValue("example.com");
  }).toPass();
  await page.getByRole("button", { name: /^analyze$/i }).click();

  await expect(page.getByText(/example\.com/i).first()).toBeVisible();
  await expect(page.getByLabel(/VirusTotal signal:/i)).toBeVisible();
  await expect(page.getByRole("meter", { name: /threat score/i })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("region", { name: /scan history/i }),
  ).toBeVisible();
});

test("batch scan flow @smoke", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_000);

  await page.getByRole("tab", { name: /^batch$/i }).click();
  const batchInput = page.getByRole("textbox", {
    name: /urls to analyze/i,
  });
  await expect(async () => {
    await batchInput.fill("example.com\nhttps://example.org");
    await expect(batchInput).toHaveValue("example.com\nhttps://example.org");
  }).toPass();
  await page.getByRole("button", { name: /start batch/i }).click();

  await expect(page.getByText(/example\.com/i).first()).toBeVisible();
});

test("history clear can be undone @smoke", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_000);

  const singleUrlInput = page.getByRole("textbox", {
    name: /url to analyze/i,
  });
  await singleUrlInput.fill("example.com");
  await page.getByRole("button", { name: /^analyze$/i }).click();

  const historyRegion = page.getByRole("region", { name: /scan history/i });
  await expect(historyRegion.getByText(/example\.com/i).first()).toBeVisible();

  await historyRegion
    .getByRole("button", { name: /clear all history/i })
    .click();
  await historyRegion
    .getByRole("button", { name: /confirm clear all history/i })
    .click();

  await expect(historyRegion.getByText(/history was cleared/i)).toBeVisible();
  await historyRegion.getByRole("button", { name: /undo clear/i }).click();
  await expect(historyRegion.getByText(/example\.com/i).first()).toBeVisible();
});
