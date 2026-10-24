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
  // The share target is a POST navigation the browser builds itself. Turn
  // a browser-initiated navigation to /share into that POST; Chromium's
  // network stack still stamps it Sec-Fetch-Site: none, as it does for a
  // real launch, so the route grants the launch.
  const grants = recordLaunchGrants(page);
  await page.route("**/share", (route) =>
    route.continue({
      method: "POST",
      headers: {
        ...route.request().headers(),
        "content-type": "application/x-www-form-urlencoded",
      },
      postData: new URLSearchParams({
        title: "Delivery",
        text: `Your parcel is waiting: ${LINK}`,
        url: "",
      }).toString(),
    }),
  );
  await page.goto("/share");

  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  expect(await Promise.all(grants)).toEqual([true]);
  expect(scans).toHaveLength(1);
  await expect(await urlField(page)).toHaveValue(LINK);
  // The launch is spent: the address no longer carries it, and the cookie
  // that allowed it is gone, so a reload or a repeat only prefills.
  expect(new URL(page.url()).search).toBe("");
  const cookies = await page.context().cookies();
  expect(cookies.map((cookie) => cookie.name)).not.toContain("sx-share-launch");
  await page.unroute("**/share");
  await page.goto(`/?url=${encodeURIComponent(LINK)}`);
  await expect(await urlField(page)).toHaveValue(LINK);
  await page.waitForTimeout(500);
  expect(scans).toHaveLength(1);
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
