import { expect, test, type Page } from "@playwright/test";

import {
  encodeSharedPayload,
  isolateRateLimit,
  sharedPath,
  signSharedPayload,
} from "./helpers";

const LINK = "https://malicious.scrutinix.test/login";

/** Every scan request the page starts, so a test can assert there are none. */
function recordScans(page: Page): string[] {
  const scans: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/analyze")) {
      scans.push(request.url());
    }
  });
  return scans;
}

/** What each response from /share tried to store: its Set-Cookie, if any. */
function recordShareCookies(page: Page): Promise<string | null>[] {
  const cookies: Promise<string | null>[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/share") {
      cookies.push(response.headerValue("set-cookie"));
    }
  });
  return cookies;
}

/**
 * Launch the share target the way the share sheet does. The share target
 * is a POST navigation the browser builds itself: turn a browser-initiated
 * navigation to /share into that POST. Chromium's network stack still
 * stamps it Sec-Fetch-Site: none, as it does for a real launch. Resolves
 * with the request /share received, as sent.
 */
async function launchFromShareSheet(
  page: Page,
  fields: Record<string, string>,
) {
  await page.route("**/share", (route) =>
    route.continue({
      method: "POST",
      headers: {
        ...route.request().headers(),
        "content-type": "application/x-www-form-urlencoded",
      },
      postData: new URLSearchParams(fields).toString(),
    }),
  );
  const shared = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/share",
  );
  await page.goto("/share");
  await page.unroute("**/share");
  return (await shared).request();
}

/** The Single field, hydrated (the theme toggle names its target once mounted). */
async function urlField(page: Page) {
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
  return page.getByRole("textbox", { name: /url to analyze/i });
}

/**
 * The page the link arrived on: the link filled in and taken apart below
 * the field, Analyze focused, and no scan, however long it waits.
 */
async function expectWaitingForAnalyze(
  page: Page,
  scans: string[],
  link: string,
) {
  const input = await urlField(page);
  await expect(input).toHaveValue(link);
  await page.waitForTimeout(750);
  expect(scans).toEqual([]);
  await expect(page.getByLabel(/^scan result/i)).toHaveCount(0);
  // Analyze holds focus; the field doesn't, so no keyboard covers the link.
  await expect(page.getByRole("button", { name: "Analyze URL" })).toBeFocused();
  await expect(input).not.toBeFocused();
  await expect(
    page.getByRole("region", { name: "The link, taken apart" }),
  ).toContainText("scrutinix.test");
}

/** Tap Analyze: exactly one scan, of the link in the field. */
async function analyzeOnce(page: Page, scans: string[]) {
  await page.getByRole("button", { name: /analyze url/i }).click();
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  await page.waitForTimeout(500);
  expect(scans).toHaveLength(1);
  // The result replaced what the page opened on.
  expect(new URL(page.url()).searchParams.has("url")).toBe(false);
}

test("a /?url= link fills in the field and waits for Analyze @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  // Normalized on the server: scheme and host case, default port, fragment.
  await page.goto(
    `/?url=${encodeURIComponent("HTTPS://Malicious.Scrutinix.Test:443/login#top")}`,
  );
  await expectWaitingForAnalyze(page, scans, LINK);
  await analyzeOnce(page, scans);

  // Anything that is not a link to check prefills nothing, silently.
  for (const value of ["javascript:alert(1)", "http://localhost/", "%%%"]) {
    await page.goto(`/?url=${encodeURIComponent(value)}`);
    await expect(await urlField(page)).toHaveValue("");
    // No error under the form (Next's route announcer is an alert too).
    await expect(page.locator("#scan-console").getByRole("alert")).toHaveCount(
      0,
    );
  }
  expect(scans).toHaveLength(1);
});

test("Share → Scrutinix fills in the shared link and waits for Analyze @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  const shareCookies = recordShareCookies(page);
  const sent = await launchFromShareSheet(page, {
    title: "Delivery",
    text: `Your parcel is waiting: ${LINK}`,
    url: "",
  });

  // The share sheet's own POST (Sec-Fetch-Site: none, which Playwright
  // doesn't report for a routed request), which sets nothing and only
  // fills in.
  expect(sent.method()).toBe("POST");
  expect(await Promise.all(shareCookies)).toEqual([null]);
  expect(await page.context().cookies()).toEqual([]);
  expect([...new URL(page.url()).searchParams.keys()]).toEqual(["url"]);
  await expectWaitingForAnalyze(page, scans, LINK);
  await analyzeOnce(page, scans);
});

test("a share with no link says so in one quiet line and scans nothing @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  const shareCookies = recordShareCookies(page);
  const note = "We didn't find a link to check in what you shared.";
  // Android shares plain text as title and text, with no url.
  await launchFromShareSheet(page, {
    title: "Dinner plans",
    text: "Call me when you get home, the door code is the usual one.",
  });

  // Nothing of the text rides along: only the flag.
  expect(Object.fromEntries(new URL(page.url()).searchParams)).toEqual({
    nolink: "1",
  });
  expect(await Promise.all(shareCookies)).toEqual([null]);
  const input = await urlField(page);
  await expect(input).toHaveValue("");

  // One line under the form, for the eye; spoken once, politely, from the
  // status region (the visible line is hidden from assistive technology).
  const line = page.locator("p[aria-hidden='true']", { hasText: note });
  await expect(line).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: note })).toHaveText(
    note,
  );
  expect((await line.boundingBox())!.y).toBeGreaterThan(
    (await input.boundingBox())!.y,
  );
  // Not an error, and nothing to tap.
  await expect(page.locator("#scan-console").getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Analyze URL" }),
  ).not.toBeFocused();
  await page.waitForTimeout(750);
  expect(scans).toEqual([]);

  // Gone once the person starts on a link of their own.
  await input.fill("example.com");
  await expect(line).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: note })).toHaveCount(
    0,
  );

  // A plain visit never shows it.
  await page.goto("/");
  await urlField(page);
  await expect(page.getByText(note)).toHaveCount(0);
});

test("a share-sheet launch carries a long link whole @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  // Valid (under 2,048 characters), but over 4 KiB URI-encoded.
  const long = `${LINK}${"/".repeat(1_500)}step`;
  expect(encodeURIComponent(long).length).toBeGreaterThan(4_096);
  await launchFromShareSheet(page, { url: long });
  await expectWaitingForAnalyze(page, scans, long);
});

test("going Back to a page a link arrived on still waits for Analyze @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  await launchFromShareSheet(page, { text: `Your parcel: ${LINK}` });
  await expect(await urlField(page)).toHaveValue(LINK);

  // The router restores the page as it was rendered into a fresh component.
  await page.locator("header").getByRole("link", { name: "About" }).click();
  await page.waitForURL((url) => url.pathname === "/about");
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(await urlField(page)).toHaveValue(LINK);
  await page.waitForTimeout(750);
  expect(scans).toEqual([]);
});

test("a form another site posts to the share target only fills in the field @smoke", async ({
  page,
  baseURL,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  const app = new URL(baseURL!);
  // localhost and 127.0.0.1 are different sites: the attacker's page.
  const attacker = `http://localhost:${app.port}/attacker`;
  await page.route(attacker, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>attacker</title>
        <form method="post" action="${app.origin}/share">
          <input name="text" value="${LINK}">
        </form>
        <script>document.forms[0].submit()</script>`,
    }),
  );
  const shareCookies = recordShareCookies(page);

  await page.goto(attacker);
  await page.waitForURL(
    (url) => url.origin === app.origin && url.pathname === "/",
  );
  await expectWaitingForAnalyze(page, scans, LINK);
  expect(await Promise.all(shareCookies)).toEqual([null]);
  expect(await page.context().cookies()).toEqual([]);
});

const maliciousShare = {
  verdict: "malicious",
  url: "https://paypal.com.secure-login.xyz/verify",
  summary: "Google Safe Browsing lists this link as phishing.",
  signature: Array(8).fill("malicious"),
};

test("a shared link opens recipient-first: the result, then Check another link @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const payload = encodeSharedPayload({
    ...maliciousShare,
    capturedAt: new Date().toISOString(),
  });
  const unsigned = encodeSharedPayload({
    ...maliciousShare,
    capturedAt: new Date().toISOString(),
    verdict: "safe",
  });

  for (const [path, bandLabel] of [
    [
      sharedPath(payload, signSharedPayload(payload)),
      /^scan result: malicious$/i,
    ],
    [sharedPath(unsigned, null), "Shared link, not verified"],
  ] as const) {
    // A shared result outranks a `?url=` beside it: nothing is filled in.
    await page.goto(
      `${path}&url=${encodeURIComponent("https://other.scrutinix.test/")}`,
    );
    const band = page.getByLabel(bandLabel);
    const anatomy = page.getByText(
      "This link belongs to secure-login.xyz, not paypal.com.",
    );
    const another = page.getByRole("heading", {
      level: 2,
      name: "Check another link",
    });
    const input = await urlField(page);
    await expect(band).toBeVisible();
    await expect(another).toBeVisible();
    // The page's own headline is not drawn over the result.
    await expect(
      page.getByText("Is this link what it says it is?"),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(input).toHaveValue("");
    await expect(input).not.toBeFocused();

    const top = async (locator: ReturnType<Page["getByText"]>) =>
      (await locator.boundingBox())!.y;
    const order = [await top(band), await top(anatomy)];
    if (typeof bandLabel !== "string") {
      order.push(await top(page.getByRole("list", { name: "Checks" })));
    }
    order.push(await top(another), await top(input));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  }
});

test("a fresh scan from a shared link clears it from the address @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const payload = encodeSharedPayload({
    ...maliciousShare,
    url: LINK,
    capturedAt: new Date().toISOString(),
  });
  await page.goto(sharedPath(payload, signSharedPayload(payload)));
  await urlField(page);
  await page.getByRole("button", { name: "Run a fresh scan" }).click();
  await expect(
    page.getByRole("button", { name: "Run a fresh scan" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Re-scan" })).toBeVisible();
  // The fresh result stays where the shared one was: above the form.
  const band = page.getByLabel(/^scan result: malicious$/i);
  const another = page.getByRole("heading", { name: "Check another link" });
  expect((await band.boundingBox())!.y).toBeLessThan(
    (await another.boundingBox())!.y,
  );

  const address = new URL(page.url());
  expect(address.searchParams.has("shared")).toBe(false);
  expect(address.searchParams.has("sig")).toBe(false);
  await page.reload();
  await expect(await urlField(page)).toBeVisible();
  await expect(page.getByText(/verified scrutinix result/i)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Is this link what it says it is?" }),
  ).toBeVisible();
});

/** The page's meta description: the shared result's own sentence. */
function metaDescription(page: Page) {
  return page.locator('meta[name="description"]').getAttribute("content");
}

test("a signed share states the instruction its basis supports; one signed before it stays hedged @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const capturedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const confirmedCritical = {
    verdict: "critical",
    url: "https://critical.scrutinix.test/login",
    summary: "Google Safe Browsing lists this link as phishing.",
    capturedAt,
    signature: Array(8).fill("malicious"),
  };
  const cleanSafe = {
    verdict: "safe",
    url: "https://example.com/",
    summary: "No check flagged this link.",
    capturedAt,
    signature: Array(8).fill("clear"),
  };

  // The summary shows unless it only repeats the instruction ("Looks safe
  // to open." over "No check flagged this link."), as on the sender's band.
  for (const [snapshot, word, instruction, summaryShown] of [
    [
      {
        ...confirmedCritical,
        basis: {
          confidence: "high",
          clean: false,
          partial: false,
          confirmed: true,
        },
      },
      "critical",
      "Don't open this link — it's a known threat.",
      true,
    ],
    [
      {
        ...cleanSafe,
        basis: {
          confidence: "high",
          clean: true,
          partial: false,
          confirmed: false,
        },
      },
      "safe",
      "Looks safe to open.",
      false,
    ],
    // Signed before the basis existed: the hedged forms, as before.
    [confirmedCritical, "critical", "Don't open this link.", true],
    [cleanSafe, "safe", "Probably safe — still check who sent it.", true],
  ] as const) {
    const payload = encodeSharedPayload(snapshot);
    await page.goto(sharedPath(payload, signSharedPayload(payload)));
    const band = page.getByRole("region", {
      name: new RegExp(`^scan result: ${word}$`, "i"),
    });
    await expect(band).toBeVisible();
    await expect(
      band.getByText(/^Verified Scrutinix result · checked/),
    ).toBeVisible();
    // Exactly this sentence: "Don't open this link." never passes for the
    // known-threat form, or the other way round.
    await expect(band.locator(".sx-band-imperative:not(.sx-slot)")).toHaveText(
      instruction,
    );
    await expect(band.getByText(snapshot.summary, { exact: true })).toHaveCount(
      summaryShown ? 1 : 0,
    );
    expect((await metaDescription(page))?.startsWith(`${instruction} `)).toBe(
      true,
    );
  }
});

test("a recipient reads the instruction the sender's band showed @smoke", async ({
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

  for (const [link, word, instruction] of [
    [
      "https://critical.scrutinix.test/login",
      "critical",
      "Don't open this link — it's a known threat.",
    ],
    ["https://example.com/", "safe", "Looks safe to open."],
  ] as const) {
    await isolateRateLimit(page);
    await page.goto("/");
    const input = await urlField(page);
    await expect(async () => {
      await input.fill(link);
      await expect(input).toHaveValue(link);
    }).toPass();
    await page.getByRole("button", { name: /analyze url/i }).click();
    const bandName = new RegExp(`^scan result: ${word}$`, "i");
    const senderBand = page.getByRole("region", { name: bandName });
    await expect(
      senderBand.locator(".sx-band-imperative:not(.sx-slot)"),
    ).toHaveText(instruction);

    await page.evaluate(() => {
      delete (window as unknown as { __copied?: string }).__copied;
    });
    await page.getByRole("button", { name: "Share" }).click();
    const copied = await page.waitForFunction(
      () => (window as unknown as { __copied?: string }).__copied,
    );
    const shared = new URL(String(await copied.jsonValue()));
    expect(shared.searchParams.get("sig")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await page.goto(`${shared.pathname}${shared.search}`);
    const band = page.getByRole("region", { name: bandName });
    await expect(
      band.getByText(/^Verified Scrutinix result · checked/),
    ).toBeVisible();
    await expect(band.locator(".sx-band-imperative:not(.sx-slot)")).toHaveText(
      instruction,
    );
    expect((await metaDescription(page))?.startsWith(`${instruction} `)).toBe(
      true,
    );
  }
});

test("the site never mentions installing it @smoke", async ({ page }) => {
  // Owner decision: the browser's own install UI is the only prompt.
  await isolateRateLimit(page);
  for (const path of ["/", "/about", "/privacy"]) {
    await page.goto(path);
    const text = await page.locator("body").innerText();
    expect(text, path).not.toMatch(/\binstall/i);
  }
});
