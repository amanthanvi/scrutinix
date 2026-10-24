import { expect, test, type Page } from "@playwright/test";

import { gotoApp, submitSingleScan } from "./helpers";

/**
 * These specs depend on SCRUTINIX_TEST_FIXTURES=1 (set by scripts/run-e2e.mjs),
 * which swaps the real providers for the deterministic per-hostname scenarios
 * in lib/server/test-fixtures.ts.
 */

test("a VirusTotal conviction renders a malicious verdict", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://malicious.scrutinix.test/login");

  const verdict = page.getByLabel(/^scan result: malicious$/i);
  await expect(verdict).toBeVisible();
  await expect(verdict.getByText("Don't open this link.")).toBeVisible();
  // The reported question states the conviction; the band does not.
  await expect(
    page.getByText("7 VirusTotal engines flagged this link."),
  ).toHaveCount(0);
  const reported = page.locator('[data-question="reported"]');
  await expect(reported).toContainText(
    "7 of 70 VirusTotal engines flag it as malicious and 2 as suspicious.",
  );
  await expect(reported).toContainText(
    "Each source is kept separately, so one can catch a link the others haven't reached yet.",
  );
  // The hosting network is evidence: its registration, never a location.
  await expect(page.locator('[data-question="other"]')).toContainText(
    "Its address belongs to network AS64500 EXAMPLE-NET, registered in NL.",
  );
  // Summary has no per-check rows; Full keeps all eight.
  await expect(
    page.getByRole("list", { name: "Signals" }).getByLabel(/virustotal:/i),
  ).toHaveCount(0);
  await page.getByRole("switch", { name: /^summary full/i }).click();
  await expect(
    page.getByRole("list", { name: "Signals" }).getByLabel(/virustotal:/i),
  ).toHaveAttribute(
    "aria-label",
    "VirusTotal: 7 engines flagged this link as malicious, 2 as suspicious.",
  );
  await expect(
    page.getByRole("list", { name: "Signals" }).getByRole("listitem"),
  ).toHaveCount(8);
});

test("an unreachable host renders an unknown verdict, not safe", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://unreachable.scrutinix.test/");

  const verdict = page.getByLabel(/^scan result: unknown$/i);
  await expect(verdict).toBeVisible();
  await expect(
    verdict.getByText("We couldn't check this link — treat it as unsafe."),
  ).toBeVisible();
  // No score and no "Safe" band beside Unknown, and no 8/8 caveat.
  await expect(page.getByRole("meter", { name: /threat score/i })).toHaveCount(
    0,
  );
  await expect(page.getByText(/safe band/i)).toHaveCount(0);
  await expect(page.getByText(/resolved signals/i)).toHaveCount(0);
});

test("a threat-feed listing renders a malicious verdict", async ({ page }) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://feed-hit.scrutinix.test/payload.exe");

  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();
  // The reported question carries the listing and its age, and says why
  // VirusTotal hasn't caught up; the reason itself sits in Details.
  const reported = page.locator('[data-question="reported"]');
  await expect(reported).toContainText(
    "URLhaus lists this link as active malware distribution (listed 6 hours ago).",
  );
  await expect(reported).toContainText(
    "Lists often name a threat before VirusTotal's engines catch up.",
  );
  await expect(page.getByText("URLhaus flagged this link.")).toHaveCount(0);
  await expect(page.getByText(/listed.*listed/i)).toHaveCount(0);
  await page.getByRole("switch", { name: /^summary full/i }).click();
  await expect(
    page.getByRole("list", { name: "Signals" }).getByLabel(/threat feeds:/i),
  ).toHaveAttribute(
    "aria-label",
    "Threat Feeds: URLhaus lists this link as active malware distribution.",
  );
});

test("a look-alike subdomain is named plainly and shown as Look-alike", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://paypal.com.secure-login.xyz/verify");

  const verdict = page.getByLabel(/^scan result: look-alike$/i);
  await expect(verdict).toBeVisible();
  await expect(
    verdict.getByRole("heading", { level: 2, name: "Look-alike" }),
  ).toBeVisible();
  await expect(
    verdict.getByText("Don't sign in or enter details here."),
  ).toBeVisible();
  await expect(verdict.getByText(/High confidence/)).toHaveCount(0);
  // No check flagged it: the band shows no reassuring score, and the
  // details state the checks' own verdict.
  await expect(verdict.getByRole("meter")).toHaveCount(0);
  await page.getByText("How we reached this verdict").click();
  await expect(
    page.getByText(
      /^No check flagged it: on their own, the checks scored it Safe, \d+ out of 100\.$/,
    ),
  ).toBeVisible();
  await expect(
    page.getByText("This link belongs to secure-login.xyz, not paypal.com.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("a pasted link is taken apart before any scan, then hands over to the result", async ({
  page,
}) => {
  await gotoApp(page);
  const input = page.getByRole("textbox", { name: /url to analyze/i });
  await input.fill("https://paypal.com.secure-login.xyz/verify");

  const pasted = page.getByRole("region", { name: "The link, taken apart" });
  await expect(pasted).toBeVisible();
  await expect(pasted).toContainText("Registered domain");
  await expect(pasted).toContainText(
    "This link belongs to secure-login.xyz, not paypal.com.",
  );

  await pasted
    .getByRole("button", { name: "Expecting a particular site?" })
    .click();
  await page
    .getByRole("textbox", { name: "Which site were you expecting?" })
    .fill("paypal.com");
  await expect(pasted).toContainText(
    "No. The link only spells out paypal.com.",
  );
  // The owner is stated once, by the anatomy, not again by the answer.
  await expect(
    pasted.getByText("This link belongs to secure-login.xyz, not paypal.com."),
  ).toHaveCount(1);

  // Scanning the same link: the result's own anatomy takes over, so the
  // owner is stated once.
  await page.getByRole("button", { name: /analyze url/i }).click();
  await expect(page.getByLabel(/^scan result: look-alike$/i)).toBeVisible();
  await expect(pasted).toHaveCount(0);
});

test("a phone-width history row keeps a look-alike's real owner visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoApp(page);
  await submitSingleScan(page, "https://paypal.com.secure-login.xyz/verify");
  await expect(page.getByLabel(/^scan result: look-alike$/i)).toBeVisible();

  const history = page.getByRole("region", { name: "Scan history" });
  const row = history.getByRole("listitem").first();
  await expect(row).toContainText("secure-login.xyz");
  await expect(row).toContainText("Look-alike");
  const owner = row.locator('[data-part="owner"]');
  await expect(owner).toHaveText("secure-login.xyz");
  const ownerBox = await owner.boundingBox();
  const rowBox = await row.boundingBox();
  expect(ownerBox && rowBox).toBeTruthy();
  if (ownerBox && rowBox) {
    expect(ownerBox.x).toBeGreaterThanOrEqual(rowBox.x);
    expect(ownerBox.x + ownerBox.width).toBeLessThanOrEqual(
      rowBox.x + rowBox.width + 0.5,
    );
  }
  // The owner itself is never cut: its full text fits its box.
  expect(
    await owner.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
});

test("an unreachable https link says the certificate couldn't be checked", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://unreachable.scrutinix.test");
  await expect(page.getByLabel(/^scan result: unknown$/i)).toBeVisible();
  // Said once, by the HTTPS question; the anatomy's fact steps aside.
  await expect(page.locator('[data-question="https"]')).toContainText(
    "No. We couldn't check the certificate.",
  );
  await expect(page.getByText(/couldn't check the certificate/i)).toHaveCount(
    1,
  );
  await expect(page.locator('[data-question="destination"]')).toContainText(
    "We couldn't reach the site, so we can't say where it leads.",
  );
  await expect(page.getByText("No secure connection")).toHaveCount(0);
});

test("strip cells open their evidence: the question in Summary, the row in Full", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://malicious.scrutinix.test/login");
  await expect(page.getByLabel(/^scan result: malicious$/i)).toBeVisible();

  const strip = page.getByRole("toolbar", { name: "Checks" });
  await expect(strip.getByRole("button")).toHaveCount(8);
  // Names start with the visible cell label (WCAG 2.5.3 label in name).
  await strip.getByRole("button", { name: /^DNS:/ }).click();
  await expect(
    page.getByRole("heading", { name: "What did the other checks find?" }),
  ).toBeFocused();
  await strip.getByRole("button", { name: /^Registration:/ }).click();
  await expect(
    page.getByRole("heading", { name: "What else raises concern?" }),
  ).toBeFocused();

  await page.getByRole("switch", { name: /^summary full/i }).click();
  await strip.getByRole("button", { name: /^DNS:/ }).click();
  await expect(page.getByLabel(/DNS Profile:/i)).toBeFocused();
});

/** The lazily loaded link parser's chunk: tldts and its Public Suffix List. */
const isParserChunk = (body: string) => body.includes("getPublicSuffix");

/**
 * Route every script chunk through `onParser` when it is the parser's, and
 * record each word the band's heading shows, so a transient "Safe" between
 * two renders is caught.
 */
async function interceptParser(
  page: Page,
  onParser: (
    respond: () => Promise<void>,
    abort: () => Promise<void>,
  ) => Promise<void>,
) {
  await page.route("**/_next/static/chunks/**/*.js", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const respond = () => route.fulfill({ response, body });
    if (isParserChunk(body)) {
      await onParser(respond, () => route.abort("failed"));
    } else {
      await respond();
    }
  });
  await page.addInitScript(() => {
    const words: string[] = [];
    Object.assign(window, { sxHeadings: words });
    new MutationObserver(() => {
      const text = document.getElementById("sx-verdict-heading")?.textContent;
      if (text && words.at(-1) !== text) words.push(text);
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

function headingWords(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { sxHeadings: string[] }).sxHeadings,
  );
}

test("a slow link parser holds a Safe look-alike, never showing Safe", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await interceptParser(page, async (respond) => {
    await held;
    await respond();
  });
  await gotoApp(page);
  await submitSingleScan(page, "https://paypal.com.safe.scrutinix.test/login");

  // The scan finished; the address check hasn't.
  const waiting = page.getByLabel("Checking the link's address", {
    exact: true,
  });
  await expect(waiting).toBeVisible();
  await expect(waiting.getByRole("heading", { level: 2 })).toHaveText(
    "Checking",
  );
  await expect(waiting.getByRole("meter")).toHaveCount(0);
  await expect(waiting).not.toContainText(/Safe|confidence/);
  const history = page.getByRole("region", { name: "Scan history" });
  const row = history.getByRole("listitem").first();
  await expect(row).toContainText("—");
  await expect(row).not.toContainText("Safe");

  release();
  const verdict = page.getByLabel(/^scan result: look-alike$/i);
  await expect(verdict).toBeVisible();
  await expect(verdict.getByRole("meter")).toHaveCount(0);
  await expect(row).toContainText("Look-alike");
  await expect(page.locator("p[aria-live='polite']")).toHaveText(
    /^Result for paypal\.com\.safe\.scrutinix\.test: Look-alike\./,
  );
  const words = await headingWords(page);
  expect(words).not.toContain("Safe");
  expect(words.at(-1)).toBe("Look-alike");
});

test("a link parser that fails to load leaves a Safe result Unconfirmed, never Safe", async ({
  page,
}) => {
  let parserRequests = 0;
  await interceptParser(page, async (_respond, abort) => {
    parserRequests += 1;
    await abort();
  });
  await gotoApp(page);
  await submitSingleScan(page, "https://paypal.com.safe.scrutinix.test/login");

  const verdict = page.getByLabel(/^scan result: unconfirmed$/i);
  await expect(verdict).toBeVisible({ timeout: 15_000 });
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
  await expect(page.locator("p[aria-live='polite']")).toHaveText(
    "Result for paypal.com.safe.scrutinix.test: Unconfirmed. Check the link's address before you open it. We couldn't check whether this address imitates another site.",
  );

  // The row says the same word, and it fits the verdict column.
  const row = page
    .getByRole("region", { name: "Scan history" })
    .getByRole("listitem")
    .first();
  const word = row.getByText("Unconfirmed", { exact: true });
  await expect(word).toBeVisible();
  expect(
    await word.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);

  // Turbopack retries a chunk once itself; ours is a second, fresh load.
  expect(parserRequests).toBeGreaterThanOrEqual(3);
  expect(await headingWords(page)).not.toContain("Safe");

  // The word fits the band at the narrowest phone width.
  await page.setViewportSize({ width: 320, height: 640 });
  const heading = verdict.getByRole("heading", { level: 2 });
  expect(
    await heading.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
