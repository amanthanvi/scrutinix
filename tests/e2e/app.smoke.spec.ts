import { expect, test, type Page } from "@playwright/test";

import { createPendingSignalResults } from "@/lib/domain/types";
import { DEFAULT_CARD_HEADLINE } from "@/lib/og/cards";

import {
  encodeSharedPayload,
  gotoApp,
  isolateRateLimit,
  ownerSentence,
  sharedPath,
  signSharedPayload,
  spokenTextNodes,
  statusRegion,
  submitSingleScan,
} from "./helpers";

const legacyHistoryEntry = buildLegacyHistoryEntry();

/** The site's default title: the home headline, which every preview states. */
const SITE_TITLE = "Scrutinix — Is this link what it says it is?";
/** The approved line under that title in the site's own previews. */
const SITE_PREVIEW_DESCRIPTION = "Eight separate checks, one plain verdict.";

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

  await gotoApp(page);

  const historyRegion = page.getByRole("region", { name: /scan history/i });
  await expect(
    historyRegion.getByRole("button", { name: /legacy\.example/i }),
  ).toBeVisible();

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
      transformerModel: null,
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
  await gotoApp(page);

  const singleUrlInput = page.getByRole("textbox", {
    name: /url to analyze/i,
  });
  const analyze = page.getByRole("button", { name: /analyze url/i });
  await expect(page.getByRole("tab", { name: /^single$/i })).toBeVisible();
  await expect(singleUrlInput).toBeVisible();
  await expect(analyze).toBeEnabled();
  // Absence is the empty state: the region exists but draws nothing.
  const historyRegion = page.getByRole("region", { name: /scan history/i });
  await expect(historyRegion).toBeAttached();
  await expect(historyRegion).toBeEmpty();

  // An empty submit explains itself instead of a dead, disabled button.
  await analyze.click();
  await expect(page.locator("#sx-url-error")).toHaveText(
    "Paste a link to check.",
  );

  await submitSingleScan(page, "example.com");

  await expect(page.getByText(/example\.com/i).first()).toBeVisible();
  const verdict = page.getByLabel(/^scan result: safe$/i);
  await expect(verdict.getByText("Looks safe to open.")).toBeVisible();
  await expect(page.getByRole("meter", { name: /threat score/i })).toBeVisible({
    timeout: 30_000,
  });
  // Summary answers the five questions instead of listing rows.
  const questions = page.getByRole("list", { name: "Questions" });
  await expect(questions.getByRole("heading", { level: 4 })).toHaveCount(5);
  await expect(
    page.getByRole("list", { name: "Signals" }).getByLabel(/VirusTotal:/i),
  ).toHaveCount(0);
  await expect(
    questions.getByText("Not on any list we checked."),
  ).toBeVisible();
  // The questions already say it; the band doesn't repeat it.
  await expect(verdict.getByText("No check flagged this link.")).toHaveCount(0);

  const signalView = page.getByRole("switch", { name: /^summary full/i });
  await expect(signalView).toHaveAttribute("aria-checked", "false");
  await expect(signalView.getByText("Summary")).toBeVisible();
  await expect(signalView.getByText("Full")).toBeVisible();
  await signalView.click();
  await expect(signalView).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("list", { name: "Signals" }).getByLabel(/VirusTotal:/i),
  ).toHaveAttribute("aria-label", "VirusTotal: No engines flagged this link.");
  await expect(page.getByLabel(/DNS Profile:/i)).toBeVisible();
  await expect(page.getByLabel(/Redirect Chain:/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download result (JSON)" }),
  ).toBeVisible();
  await expect(analyze).toHaveAttribute("data-variant", "outline");
  await expect(
    page.getByRole("region", { name: /scan history/i }),
  ).toBeVisible();
});

test("opening a history entry focuses its verdict @smoke", async ({ page }) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://malicious.scrutinix.test/login");
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();

  await submitSingleScan(page, "example.com");
  await expect(page.getByLabel(/^scan result: safe$/i)).toBeVisible();

  const historyRegion = page.getByRole("region", { name: /scan history/i });
  await expect(
    historyRegion.getByRole("heading", { name: /^History \(2 scans\)$/ }),
  ).toBeVisible();
  await expect(historyRegion.getByRole("list")).toHaveAttribute("role", "list");
  // Each row: the verdict, the link, then when it was checked, set apart.
  const row = historyRegion.getByRole("button", {
    name: /^Malicious\s*malicious\.scrutinix\.test\/login\s*, checked \d{2}:\d{2}$/,
  });
  await expect(row).toBeVisible();
  // The link is said once: the drawn parts hide themselves, since WebKit
  // ignores aria-hidden on their `display: contents` wrapper (Safari read
  // the drawn link after the spoken one).
  expect(
    (await spokenTextNodes(row)).filter((text) =>
      text.includes("scrutinix.test"),
    ),
  ).toEqual(["malicious.scrutinix.test/login"]);
  await historyRegion
    .getByRole("button", { name: /malicious\.scrutinix\.test/i })
    .click();

  await expect(
    page.getByRole("heading", { level: 2, name: /^malicious$/i }),
  ).toBeFocused();
  await expect(page.locator("[aria-live='polite']").first()).toHaveText(
    /^Result for malicious\.scrutinix\.test: Malicious, \d+ out of 100\. Don't open this link\.$/,
  );
});

test("batch scan flow @smoke", async ({ page }) => {
  await gotoApp(page);

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
  await gotoApp(page);

  await submitSingleScan(page, "example.com");

  const historyRegion = page.getByRole("region", { name: /scan history/i });
  await expect(historyRegion.getByText(/example\.com/i).first()).toBeVisible();

  await historyRegion
    .getByRole("button", { name: /clear all history/i })
    .click();
  await historyRegion
    .getByRole("button", { name: /confirm clear all history/i })
    .click();

  await expect(historyRegion.getByText(/history was cleared/i)).toBeVisible();
  // The pressed button is gone: focus moves to the one that reverses it,
  // and the status region says what happened.
  const undo = historyRegion.getByRole("button", { name: /undo clear/i });
  await expect(undo).toBeFocused();
  await expect(statusRegion(page)).toHaveText(
    "History was cleared. Undo restores the previous list.",
  );
  await undo.click();
  await expect(historyRegion.getByText(/example\.com/i).first()).toBeVisible();
  await expect(
    historyRegion.getByRole("button", { name: "Clear all history" }),
  ).toBeFocused();
  await expect(statusRegion(page)).toHaveText("History restored.");
});

/** A check time inside the 3-day window a signed share is shown for. */
const recentCheck = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const maliciousSnapshot = {
  verdict: "malicious",
  url: "https://paypal.com.secure-login.xyz/verify",
  summary: "Google Safe Browsing flagged this link.",
  capturedAt: recentCheck(),
  signature: [
    "clear",
    "suspicious",
    "malicious",
    "clear",
    "clear",
    "clear",
    "clear",
    "clear",
  ],
};

/** The page's og:image, as a path on the test server (it is absolute). */
async function ogImagePath(page: Page): Promise<string> {
  const content = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  expect(content).toBeTruthy();
  const url = new URL(content!);
  return `${url.pathname}${url.search}`;
}

test("every preview of the site states the home headline @smoke", async ({
  page,
  request,
}) => {
  await gotoApp(page);
  const headline = (
    await page.getByRole("heading", { level: 1 }).textContent()
  )?.trim();
  expect(headline).toBeTruthy();

  const title = `Scrutinix — ${headline}`;
  expect(title).toBe(SITE_TITLE);
  await expect(page).toHaveTitle(title);
  // The default card's lines are the same words; the unit test
  // og-default-card.test.ts checks the card draws exactly these lines.
  expect(DEFAULT_CARD_HEADLINE.join(" ")).toBe(headline);

  const meta = (selector: string) =>
    page.locator(`meta[${selector}]`).getAttribute("content");
  // /about and /privacy keep their own titles but preview like the home.
  for (const path of ["/", "/about", "/privacy"]) {
    if (path !== "/") await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(await meta('property="og:title"'), path).toBe(title);
    expect(await meta('name="twitter:title"'), path).toBe(title);
    // The descriptions add to the title instead of repeating it.
    expect(await meta('property="og:description"'), path).toBe(
      SITE_PREVIEW_DESCRIPTION,
    );
    expect(await meta('name="twitter:description"'), path).toBe(
      SITE_PREVIEW_DESCRIPTION,
    );
    // One card everywhere, X included: the file convention's hashed URL
    // (a new hash makes crawlers fetch the card again) and its alt text.
    expect(await ogImagePath(page), path).toMatch(/^\/opengraph-image\?\w+$/);
    expect(await meta('name="twitter:image"'), path).toBe(
      await meta('property="og:image"'),
    );
    const alt = await meta('property="og:image:alt"');
    expect(alt, path).toContain(headline!);
    expect(await meta('name="twitter:image:alt"'), path).toBe(alt);
  }

  const manifest = await request.get("/site.webmanifest");
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).description).toBe(
    `${headline} ${SITE_PREVIEW_DESCRIPTION}`,
  );
});

/** The neutral view: no verdict, score, summary, or strip from the payload. */
async function expectUnverifiedSharedView(page: Page, claimedSummary: string) {
  const band = page.getByLabel("Shared link, not verified");
  await expect(band).toBeVisible();
  await expect(
    band.getByRole("heading", { name: "Check this shared link yourself" }),
  ).toBeVisible();
  await expect(
    band.getByText(
      "We can't confirm the result in this link came from Scrutinix. It may be old or edited, so we're not showing it.",
    ),
  ).toBeVisible();
  await expect(
    band.getByRole("button", { name: "Scan this link" }),
  ).toBeVisible();
  await expect(
    band.getByRole("button", { name: "Run a fresh scan" }),
  ).toHaveCount(0);
  await expect(page.getByLabel(/^scan result/i)).toHaveCount(0);
  await expect(page.getByRole("meter")).toHaveCount(0);
  await expect(page.getByText(claimedSummary)).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Checks" })).toHaveCount(0);
  await expect(page.getByText(/verified scrutinix result/i)).toHaveCount(0);
  await expect(page).toHaveTitle(SITE_TITLE);
  expect(await ogImagePath(page)).not.toContain("/og/result");
}

test("a signed shared link shows its verdict, instruction, and strip @smoke", async ({
  page,
  request,
}) => {
  const payload = encodeSharedPayload(maliciousSnapshot);

  await page.goto(sharedPath(payload, signSharedPayload(payload)));
  const verdict = page.getByLabel(/^scan result: malicious$/i);
  await expect(verdict).toBeVisible();
  await expect(verdict.getByText("Don't open this link.")).toBeVisible();
  await expect(
    verdict.getByText(/^Verified Scrutinix result · checked/),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Checks" }).getByRole("listitem"),
  ).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Run a fresh scan" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Malicious: secure-login.xyz — Scrutinix");

  // The page previews as this result, through the per-result image.
  const imagePath = await ogImagePath(page);
  expect(imagePath).toContain("/og/result?shared=");
  expect(imagePath).toContain("&sig=");
  const image = await request.get(imagePath);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toBe("image/png");
});

test("Share copies a signed link that opens as a verified result @smoke", async ({
  page,
}) => {
  // Capture what Share copies instead of reading the system clipboard.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { __copied?: string }).__copied = text;
        },
      },
    });
  });
  await gotoApp(page);
  await submitSingleScan(page, "https://malicious.scrutinix.test/login");
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  await page.getByRole("button", { name: "Share" }).click();

  const copied = await page.waitForFunction(
    () => (window as unknown as { __copied?: string }).__copied,
  );
  // Said once by the page's status region; Sonner's own region, inserted
  // with the toast, is muted (VoiceOver ignored it; TalkBack read it twice).
  await expect(statusRegion(page)).toHaveText(
    "Link copied to clipboard. It shows this result for 3 days after the check.",
  );
  await expect(
    page.locator("[data-sonner-toast]").getByText("Link copied to clipboard"),
  ).toBeVisible();
  await expect(page.locator("section[aria-live]")).toHaveCount(0);
  const link = new URL(String(await copied.jsonValue()));
  expect(link.searchParams.get("shared")).toBeTruthy();
  expect(link.searchParams.get("sig")).toMatch(/^[A-Za-z0-9_-]{43}$/);

  await page.goto(`${link.pathname}${link.search}`);
  const band = page.getByLabel(/^scan result: malicious$/i);
  await expect(band).toBeVisible();
  await expect(
    band.getByText(/^Verified Scrutinix result · checked/),
  ).toBeVisible();
  expect(await ogImagePath(page)).toContain("/og/result?shared=");

  // The same link with one character of its claim changed is someone's
  // claim: it decodes, but the original signature no longer covers it.
  const payload = link.searchParams.get("shared")!;
  const sig = link.searchParams.get("sig");
  const snapshot = JSON.parse(
    decodeURIComponent(Buffer.from(payload, "base64").toString("latin1")),
  ) as { summary: string };
  expect(snapshot.summary.length).toBeGreaterThan(0);
  const editedSummary = snapshot.summary.endsWith("!")
    ? `${snapshot.summary.slice(0, -1)}?`
    : `${snapshot.summary.slice(0, -1)}!`;
  const edited = encodeSharedPayload({ ...snapshot, summary: editedSummary });
  expect(edited).not.toBe(payload);
  await page.goto(sharedPath(edited, sig));
  await expectUnverifiedSharedView(page, editedSummary);

  // A corrupted payload (one raw base64 character changed) does not decode
  // at all, so the page falls back to the plain home page.
  const index = Math.floor(payload.length / 2);
  const corrupted = `${payload.slice(0, index)}${payload[index] === "A" ? "B" : "A"}${payload.slice(index + 1)}`;
  await page.goto(sharedPath(corrupted, sig));
  await expect(page.getByLabel(/^scan result/i)).toHaveCount(0);
  await expect(page.getByText(/verified scrutinix result/i)).toHaveCount(0);
  await expect(page).toHaveTitle(SITE_TITLE);
  expect(await ogImagePath(page)).not.toContain("/og/result");
});

test("a tampered shared link opens the neutral view @smoke", async ({
  page,
  request,
}) => {
  const signed = encodeSharedPayload(maliciousSnapshot);
  const sig = signSharedPayload(signed);
  // The attack: keep a real signature, rewrite the verdict to Safe.
  const forged = encodeSharedPayload({
    ...maliciousSnapshot,
    verdict: "safe",
    summary: "Scrutinix checked this link: it is safe.",
    signature: Array(8).fill("clear"),
  });

  await isolateRateLimit(page);
  await page.goto(sharedPath(forged, sig));
  await expectUnverifiedSharedView(
    page,
    "Scrutinix checked this link: it is safe.",
  );
  // Scrutinix's own anatomy of the link still states its real owner.
  await expect(ownerSentence(page)).toBeVisible();
  expect(await spokenTextNodes(ownerSentence(page))).toEqual([
    "This link belongs to secure-login.xyz, not paypal.com.",
  ]);

  // The image route refuses to draw a card for the forged payload.
  const image = await request.get(
    `/og/result?${new URLSearchParams({ shared: forged, sig }).toString()}`,
    { maxRedirects: 0 },
  );
  expect(image.status()).toBe(302);
  expect(image.headers().location).toContain("/opengraph-image");

  // "Scan this link" checks the link for real.
  await page.getByRole("button", { name: "Scan this link" }).click();
  await expect(page.getByLabel(/^scan result: /i)).toBeVisible();
});

test("a signed result older than three days opens the neutral view @smoke", async ({
  page,
  request,
}) => {
  // A genuine signature over a Safe captured while the link was benign,
  // opened 72 hours and a minute later.
  const payload = encodeSharedPayload({
    verdict: "safe",
    url: "https://example.com/",
    summary: "No check flagged this link.",
    capturedAt: new Date(Date.now() - (72 * 60 + 1) * 60 * 1000).toISOString(),
    signature: Array(8).fill("clear"),
  });
  const sig = signSharedPayload(payload);

  await page.goto(sharedPath(payload, sig));
  const band = page.getByLabel("Shared result, expired");
  await expect(band).toBeVisible();
  await expect(
    band.getByText(
      "This shared result is more than 3 days old, so we're not showing it.",
    ),
  ).toBeVisible();
  await expect(
    band.getByRole("button", { name: "Scan this link" }),
  ).toBeVisible();
  await expect(page.getByLabel(/^scan result/i)).toHaveCount(0);
  await expect(page.getByText("No check flagged this link.")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Checks" })).toHaveCount(0);
  await expect(page).toHaveTitle(SITE_TITLE);
  expect(await ogImagePath(page)).not.toContain("/og/result");

  const image = await request.get(
    `/og/result?${new URLSearchParams({ shared: payload, sig }).toString()}`,
    { maxRedirects: 0 },
  );
  expect(image.status()).toBe(302);
  expect(image.headers().location).toContain("/opengraph-image");
});

test("a link shared before signing opens the neutral view @smoke", async ({
  page,
}) => {
  const payload = encodeSharedPayload({
    verdict: "safe",
    url: "https://example.com/",
    summary: "No check flagged this link.",
    capturedAt: "2026-03-01T00:00:00.000Z",
  });

  await page.goto(sharedPath(payload, null));
  await expectUnverifiedSharedView(page, "No check flagged this link.");
  await expect(
    page.getByText("Probably safe — still check who sent it."),
  ).toHaveCount(0);
});

test("a signed snapshot without a strip still opens @smoke", async ({
  page,
}) => {
  // Results saved before per-check data was kept share no signature.
  const payload = encodeSharedPayload({
    verdict: "safe",
    url: "https://example.com/",
    summary: "No check flagged this link.",
    capturedAt: recentCheck(),
  });

  await page.goto(sharedPath(payload, signSharedPayload(payload)));
  await expect(page.getByLabel(/^scan result: safe$/i)).toBeVisible();
  await expect(
    page.getByText("Probably safe — still check who sent it."),
  ).toBeVisible();
});

test("a scan that lands below a short window brings the whole instruction into view @smoke", async ({
  page,
}) => {
  // 1440 x 900 at 200% zoom: the band's domain line sits between the
  // verdict word and the instruction, so measuring only the line under
  // the heading would stop the scroll with the instruction cut off.
  await page.setViewportSize({ width: 720, height: 450 });
  await gotoApp(page);
  await submitSingleScan(page, "https://malicious.scrutinix.test/login");
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await submitSingleScan(page, "https://malicious.scrutinix.test/again");
  await expect(
    page
      .getByLabel(/^scan result: malicious$/i)
      .getByText("Don't open this link."),
  ).toBeInViewport({ ratio: 1 });
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`on a phone a re-scan's verdict comes into view (${reducedMotion} motion) @smoke`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page);
    // Two saved scans lengthen the page below the band.
    await submitSingleScan(page, "example.com");
    await expect(page.getByLabel(/^scan result: safe$/i)).toBeVisible();
    await submitSingleScan(page, "https://malicious.scrutinix.test/login");
    const band = page.getByLabel(/^scan result: malicious$/i);
    const answer = band.getByText("Don't open this link.");
    await expect(answer).toBeVisible();

    // Re-scan from the action row at the end of the evidence: the band
    // now starts far above the fold, so only the landing scroll can bring
    // the answer back into view.
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(answer).not.toBeInViewport();
    await page.getByRole("button", { name: "Re-scan" }).click();

    // Fully in view, not just a sliver: the verdict word and the answer.
    const heading = page.getByRole("heading", {
      level: 2,
      name: /^malicious$/i,
    });
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(
      page
        .getByLabel(/^scan result: malicious$/i)
        .getByText("Don't open this link."),
    ).toBeInViewport({ ratio: 1 });
    await expect(heading).toBeFocused();
  });
}
