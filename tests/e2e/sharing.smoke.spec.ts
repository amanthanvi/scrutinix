import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";

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

/** Whether each response from /share granted the one-scan launch cookie. */
function recordLaunchGrants(page: Page): Promise<boolean>[] {
  const grants: Promise<boolean>[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/share") {
      grants.push(
        response
          .headerValue("set-cookie")
          .then((value) => Boolean(value?.includes("sx-share-launch="))),
      );
    }
  });
  return grants;
}

/**
 * Launch the share target the way the share sheet does. The share target
 * is a POST navigation the browser builds itself: turn a browser-initiated
 * navigation to /share into that POST. Chromium's network stack still
 * stamps it Sec-Fetch-Site: none, as it does for a real launch, so the
 * route grants the launch.
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
  await page.goto("/share");
  await page.unroute("**/share");
}

/**
 * A launch grant for `link` in this browser's cookie jar, without opening
 * the page it redirects to (the request context shares the jar).
 */
async function grantLaunch(context: BrowserContext, link: string) {
  const response = await context.request.post("/share", {
    headers: { "sec-fetch-site": "none" },
    form: { text: link },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  expect(await launchCookieNames(context)).toEqual(["sx-share-launch"]);
}

async function launchCookieNames(context: BrowserContext) {
  return (await context.cookies())
    .map((cookie) => cookie.name)
    .filter((name) => name === "sx-share-launch");
}

/** The Single field, hydrated (the theme toggle names its target once mounted). */
async function urlField(page: Page) {
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
  return page.getByRole("textbox", { name: /url to analyze/i });
}

test("a /?url= link prefills and focuses the field, and never scans @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  await page.goto(`/?url=${encodeURIComponent(LINK)}`);

  const input = await urlField(page);
  await expect(input).toHaveValue(LINK);
  await expect(input).toBeFocused();
  // The link is taken apart while it waits for the tap.
  await expect(page.getByText("scrutinix.test").first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(scans).toEqual([]);
  await expect(page.getByLabel(/^scan result/i)).toHaveCount(0);

  // Anything that is not a link to check prefills nothing, silently.
  for (const value of ["javascript:alert(1)", "http://localhost/", "%%%"]) {
    await page.goto(`/?url=${encodeURIComponent(value)}`);
    await expect(await urlField(page)).toHaveValue("");
    // No error under the form (Next's route announcer is an alert too).
    await expect(page.locator("#scan-console").getByRole("alert")).toHaveCount(
      0,
    );
  }
  expect(scans).toEqual([]);
});

test("a share-sheet launch of the installed app scans the shared link @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  const grants = recordLaunchGrants(page);
  await launchFromShareSheet(page, {
    title: "Delivery",
    text: `Your parcel is waiting: ${LINK}`,
    url: "",
  });

  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  expect(await Promise.all(grants)).toEqual([true]);
  expect(scans).toHaveLength(1);
  await expect(await urlField(page)).toHaveValue(LINK);
  // The launch is spent: the address no longer carries it, and the cookie
  // that allowed it is gone, so a reload or a repeat only prefills.
  expect(new URL(page.url()).search).toBe("");
  expect(await launchCookieNames(page.context())).toEqual([]);
  await page.goto(`/?url=${encodeURIComponent(LINK)}`);
  await expect(await urlField(page)).toHaveValue(LINK);
  await page.waitForTimeout(500);
  expect(scans).toHaveLength(1);
});

test("a share-sheet launch of a long link still scans it @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  // Valid (under 2,048 characters), but over 4 KiB URI-encoded: a cookie
  // holding the link itself is one Chromium refuses to store.
  const long = `${LINK}${"/".repeat(1_500)}step`;
  expect(encodeURIComponent(long).length).toBeGreaterThan(4_096);
  await launchFromShareSheet(page, { url: long });

  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  expect(scans).toHaveLength(1);
  await expect(await urlField(page)).toHaveValue(long);
});

test("going Back to a launched page never scans it again @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  await launchFromShareSheet(page, { text: `Your parcel: ${LINK}` });
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  expect(scans).toHaveLength(1);

  // The router restores the page as it was rendered, launch and all, into
  // a fresh component: only the browser can know this launch already ran.
  await page.locator("header").getByRole("link", { name: "About" }).click();
  await page.waitForURL((url) => url.pathname === "/about");
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(await urlField(page)).toHaveValue(LINK);
  await page.waitForTimeout(750);
  expect(scans).toHaveLength(1);
});

/**
 * Two tabs and one launch grant for `LINK` in their shared cookie jar,
 * each tab with its own scan record and rate-limit identity.
 */
async function twoTabsWithGrant(page: Page) {
  const context = page.context();
  const other = await context.newPage();
  const scans: string[][] = [];
  for (const tab of [page, other]) {
    await isolateRateLimit(tab);
    scans.push(recordScans(tab));
  }
  await grantLaunch(context, LINK);
  const grant = (await context.cookies()).find(
    (cookie) => cookie.name === "sx-share-launch",
  )!.value;
  return { context, other, scans, grant, grantId: grant.split(".")[0]! };
}

/**
 * Open the launched page in two tabs at once, as a second tab can: hold
 * both loads until both are asked for, so both reach the server carrying
 * the cookie before either response can clear it. The server keeps
 * nothing, so both are granted. The first tab's page is delivered at once;
 * the second's, already rendered, is held until `release` settles.
 * Resolves once the first tab has loaded, with the second tab's HTML and
 * its navigation.
 */
async function raceLaunch(
  first: Page,
  second: Page,
  grant: string,
  release: Promise<unknown>,
) {
  let held = 0;
  let bothAsked!: () => void;
  const bothHeld = new Promise<void>((resolve) => (bothAsked = resolve));
  const hold = async (route: Route) => {
    expect(route.request().headers().cookie ?? "").toContain(grant);
    held += 1;
    if (held === 2) bothAsked();
    await bothHeld;
  };
  let rendered!: (html: string) => void;
  const secondHtml = new Promise<string>((resolve) => (rendered = resolve));
  const isLaunch = (url: URL) =>
    url.pathname === "/" && url.searchParams.has("url");
  await first.route(isLaunch, async (route) => {
    await hold(route);
    await route.continue();
  });
  await second.route(isLaunch, async (route) => {
    await hold(route);
    const response = await route.fetch();
    rendered(await response.text());
    await release;
    await route.fulfill({ response });
  });
  const target = `/?url=${encodeURIComponent(LINK)}`;
  const secondLoad = second.goto(target, { timeout: 0 });
  await first.goto(target);
  await first.unroute(isLaunch);
  return { secondHtml: await secondHtml, secondLoad };
}

test("one share-sheet launch scans once, though a second tab got the grant too @smoke", async ({
  page,
}) => {
  const { context, other, scans, grant, grantId } =
    await twoTabsWithGrant(page);
  // The second tab's answer is delivered once the first tab has started
  // its scan.
  const firstScan = page.waitForRequest((request) =>
    new URL(request.url()).pathname.startsWith("/api/analyze"),
  );
  const { secondHtml, secondLoad } = await raceLaunch(
    page,
    other,
    grant,
    firstScan,
  );
  await secondLoad;

  // The second tab was granted the same launch, and only prefilled.
  expect(secondHtml).toContain(grantId);
  for (const tab of [page, other]) {
    await expect(await urlField(tab)).toHaveValue(LINK);
  }
  await expect.poll(() => scans.flat().length).toBe(1);
  await other.waitForTimeout(750);
  expect(scans.map((tab) => tab.length)).toEqual([1, 0]);
  expect(await launchCookieNames(context)).toEqual([]);
  await other.close();
});

test("a page held while many more shares scan still never scans its launch twice @smoke", async ({
  page,
}) => {
  // Round 3 repro: nine shares gave ten scans once eight newer ids had
  // pushed the first out of the browser's record.
  test.setTimeout(180_000);
  const { other, scans, grant, grantId } = await twoTabsWithGrant(page);
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const { secondHtml, secondLoad } = await raceLaunch(
    page,
    other,
    grant,
    released,
  );
  expect(secondHtml).toContain(grantId);
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();

  // Nine more shares, each its own grant, each scanned once.
  for (let share = 1; share <= 9; share += 1) {
    await launchFromShareSheet(page, { text: `Share ${share}: ${LINK}` });
    await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
    await expect.poll(() => scans[0]!.length).toBe(share + 1);
  }

  // Then the held page, rendered with the first grant, arrives.
  release();
  await secondLoad;
  await expect(await urlField(other)).toHaveValue(LINK);
  await other.waitForTimeout(750);
  expect(scans.map((tab) => tab.length)).toEqual([10, 0]);
  await other.close();
});

test("a second tab whose clock runs eleven minutes ahead still only prefills @smoke", async ({
  page,
}) => {
  // Round 3 repro: the second page judged the first tab's record stale by
  // its own Date.now() and scanned again.
  const { other, scans, grant } = await twoTabsWithGrant(page);
  await other.addInitScript(() => {
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60_000;
  });
  const firstScan = page.waitForRequest((request) =>
    new URL(request.url()).pathname.startsWith("/api/analyze"),
  );
  const { secondLoad } = await raceLaunch(page, other, grant, firstScan);
  await secondLoad;
  await expect(await urlField(other)).toHaveValue(LINK);
  await expect.poll(() => scans.flat().length).toBe(1);
  await other.waitForTimeout(750);
  expect(scans.map((tab) => tab.length)).toEqual([1, 0]);
  await other.close();
});

test("a launch that reaches a running page after its minute only prefills @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  // Hydration a minute after the navigation began, on this page's own
  // monotonic clock (as a held response or a stalled device would leave it).
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    performance.now = () => realNow() + 61_000;
  });
  await launchFromShareSheet(page, { text: `Your parcel: ${LINK}` });

  const input = await urlField(page);
  await expect(input).toHaveValue(LINK);
  await page.waitForTimeout(750);
  expect(scans).toEqual([]);
  await expect(page.getByLabel(/^scan result/i)).toHaveCount(0);
  // It waits for a tap, as any prefill does.
  await expect(input).toBeFocused();
});

test("a form another site posts to the share target only prefills @smoke", async ({
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
  const grants = recordLaunchGrants(page);

  await page.goto(attacker);
  await page.waitForURL(
    (url) => url.origin === app.origin && url.pathname === "/",
  );
  const input = await urlField(page);
  await expect(input).toHaveValue(LINK);
  expect(await Promise.all(grants)).toEqual([false]);
  await page.waitForTimeout(500);
  expect(scans).toEqual([]);
  await expect(page.getByLabel(/^scan result/i)).toHaveCount(0);
  const cookies = await page.context().cookies();
  expect(cookies.map((cookie) => cookie.name)).not.toContain("sx-share-launch");
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
    await page.goto(path);
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
    await expect(page.getByText("Check a link before you click.")).toHaveCount(
      0,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
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
    page.getByRole("heading", { name: "Check a link before you click." }),
  ).toBeVisible();
});

test("a launch grant is spent by the first home page that loads, matching or not @smoke", async ({
  page,
}) => {
  await isolateRateLimit(page);
  const scans = recordScans(page);
  const payload = encodeSharedPayload({
    ...maliciousShare,
    capturedAt: new Date().toISOString(),
  });

  for (const visit of [
    // A different link in ?url=, a shared result, and the plain home page.
    `/?url=${encodeURIComponent("https://other.scrutinix.test/")}`,
    sharedPath(payload, signSharedPayload(payload)),
    "/",
  ]) {
    await grantLaunch(page.context(), LINK);
    await page.goto(visit);
    await urlField(page);
    expect(await launchCookieNames(page.context()), visit).toEqual([]);

    // So the link the grant named, opened afterwards, only prefills.
    await page.goto(`/?url=${encodeURIComponent(LINK)}`);
    await expect(await urlField(page)).toHaveValue(LINK);
  }
  await page.waitForTimeout(500);
  expect(scans).toEqual([]);
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
