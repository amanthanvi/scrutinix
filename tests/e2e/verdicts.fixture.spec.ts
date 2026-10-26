import { expect, type Page } from "@playwright/test";

import { gotoApp, submitSingleScan, test } from "./helpers";

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

test("a failed scan's band offers Try again, which scans the link again", async ({
  page,
}) => {
  const scans: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/analyze") {
      scans.push(request.postData() ?? "");
    }
  });
  await gotoApp(page);
  await submitSingleScan(page, "https://error.scrutinix.test/");

  const verdict = page.getByLabel(/^scan result: error$/i);
  await expect(verdict.getByText("The scan failed — try again.")).toBeVisible();
  // No score or confidence to state: the score's place holds the action
  // its instruction asks for.
  await expect(verdict.getByText(/confidence/i)).toHaveCount(0);
  await verdict.getByRole("button", { name: "Try again" }).click();

  await expect.poll(() => scans.length).toBe(2);
  expect(scans[1]).toContain("error.scrutinix.test");
  // The band's heading keeps focus while the new scan runs and lands.
  await expect(verdict.getByRole("heading", { level: 2 })).toBeFocused();
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

test("neighbouring captions keep a gap when a short part's caption wraps", async ({
  page,
}) => {
  // "malicious." is narrower than "A label anyone can add", so that caption
  // wraps inside its part; the next caption must not read on from it.
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoApp(page);
  await page
    .getByRole("textbox", { name: "URL to analyze" })
    .fill("https://malicious.scrutinix.test/login");
  const pasted = page.getByRole("region", { name: "The link, taken apart" });
  await expect(pasted).toContainText("Registered domain");
  const gaps = await pasted.evaluate((region) => {
    const textRects = [...region.querySelectorAll(".sx-anat-caption")].map(
      (caption) => {
        const range = document.createRange();
        range.selectNodeContents(caption);
        return [...range.getClientRects()];
      },
    );
    const found: number[] = [];
    for (let i = 0; i + 1 < textRects.length; i += 1) {
      for (const left of textRects[i]!) {
        for (const right of textRects[i + 1]!) {
          if (Math.abs(left.top - right.top) < 2) {
            found.push(right.left - left.right);
          }
        }
      }
    }
    return found;
  });
  expect(gaps.length).toBeGreaterThan(0);
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(12);
});

test("a long expected site wraps its answer instead of widening a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await gotoApp(page);
  await page
    .getByRole("textbox", { name: /url to analyze/i })
    .fill("https://example.com/");
  const pasted = page.getByRole("region", { name: "The link, taken apart" });
  await pasted
    .getByRole("button", { name: "Expecting a particular site?" })
    .click();
  const expected = page.getByRole("textbox", {
    name: "Which site were you expecting?",
  });
  for (const typed of [
    "accountverificationandsecuritycheckpointforyoursigninportalnowx.com",
    "Accountverificationandsecuritycheckpointforyoursigninportal",
  ]) {
    await expected.fill(typed);
    await expect(pasted).toContainText(typed);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
      typed,
    ).toBe(true);
  }
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

/** The Evidence head's height: where its ink rule sits under the title. */
function evidenceHeadHeight(page: Page) {
  return page
    .locator("#sx-evidence-heading")
    .evaluate(
      (heading) => heading.parentElement!.getBoundingClientRect().height,
    );
}

test("an Error result shows its eight rows with no Summary/Full switch, and keeps the choice", async ({
  page,
}) => {
  await gotoApp(page);
  await submitSingleScan(page, "https://error.scrutinix.test/");
  const band = page.getByRole("region", { name: /^scan result: error$/i });
  await expect(band.getByText("The scan failed — try again.")).toBeVisible();

  // One view, so no control claiming another: the eight rows, no switch.
  const viewSwitch = page.getByRole("switch", {
    name: "Summary Full signal list",
  });
  await expect(page.getByRole("region", { name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Questions" })).toHaveCount(0);
  const rows = page.getByRole("list", { name: "Signals" });
  await expect(rows.getByRole("listitem")).toHaveCount(8);
  const errorHead = await evidenceHeadHeight(page);

  // The strip leads to the rows it shows: a cell focuses its row (which
  // holds no evidence to open, and the strip's hint says so).
  const strip = page.getByRole("toolbar", { name: "Checks" });
  await expect(strip).toHaveAccessibleDescription(
    "Each check moves to its row below.",
  );
  await strip.getByRole("button", { name: /^Redirects:/ }).click();
  await expect(rows.getByLabel(/^Redirect Chain:/)).toBeFocused();

  // The next result has both views, on the stored choice (Summary), and
  // its rule sits where the Error's did.
  await submitSingleScan(page, "example.com");
  await expect(
    page.getByRole("region", { name: /^scan result: safe$/i }),
  ).toBeVisible();
  await expect(viewSwitch).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("list", { name: "Questions" })).toBeVisible();
  expect(await evidenceHeadHeight(page)).toBe(errorHead);
  await viewSwitch.click();
  await expect(viewSwitch).toHaveAttribute("aria-checked", "true");

  // Reopened from history: still no switch, focus on the verdict, and the
  // announcement says nothing of a view.
  const history = page.getByRole("region", { name: /scan history/i });
  await history
    .getByRole("button", { name: /error\.scrutinix\.test/i })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: /^error$/i }),
  ).toBeFocused();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(rows.getByRole("listitem")).toHaveCount(8);
  await expect(page.locator("[aria-live='polite']").first()).toHaveText(
    "Result for error.scrutinix.test: Error. The scan failed — try again.",
  );

  // Back to the Safe result: Full is still the choice.
  await history.getByRole("button", { name: /example\.com/i }).click();
  await expect(viewSwitch).toHaveAttribute("aria-checked", "true");
  await expect(rows.getByRole("listitem")).toHaveCount(8);
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

/** The verdict heading's size in px, and whether its word stays inside it. */
function measureVerdict(page: Page) {
  return page.locator("#sx-verdict-heading").evaluate((heading) => {
    const word = heading.firstElementChild ?? heading;
    return {
      size: parseFloat(getComputedStyle(heading).fontSize),
      inside:
        heading.scrollWidth <= heading.clientWidth + 1 &&
        word.getBoundingClientRect().right <=
          heading.getBoundingClientRect().right + 1,
    };
  });
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

test("an Unconfirmed verdict grows with twice the default text size and wraps inside its band", async ({
  pageAtDefaultTextSize,
}) => {
  // At the narrowest phone width.
  const unconfirmedAt = async (standard: number) => {
    const page = await pageAtDefaultTextSize(standard, {
      viewport: { width: 320, height: 640 },
    });
    await interceptParser(page, (_respond, abort) => abort());
    await gotoApp(page);
    await submitSingleScan(
      page,
      "https://paypal.com.safe.scrutinix.test/login",
    );
    await expect(page.getByLabel(/^scan result: unconfirmed$/i)).toBeVisible({
      timeout: 15_000,
    });
    return measureVerdict(page);
  };
  const standard = await unconfirmedAt(16);
  const enlarged = await unconfirmedAt(32);
  expect(enlarged.size).toBeGreaterThan(standard.size);
  expect(enlarged.inside).toBe(true);
});

/**
 * Scan a Critical link and measure its verdict at each width, from the
 * narrowest phone through the rem breakpoints (40rem, 48rem) as they move
 * with the text size, checking at each that the word stays inside its band.
 */
async function scoredVerdictAtWidths(page: Page, standard: number) {
  await gotoApp(page);
  await submitSingleScan(page, "https://critical.scrutinix.test/login");
  const verdict = page.getByLabel(/^scan result: critical$/i);
  await expect(verdict.getByRole("meter")).toBeVisible({ timeout: 15_000 });

  const sizes = new Map<number, number>();
  for (const width of [320, 414, 640, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const current = await measureVerdict(page);
    expect(current.inside, `${width}px wide, ${standard}px text`).toBe(true);
    sizes.set(width, current.size);
  }
  return sizes;
}

test("a scored verdict stays inside its band at every width", async ({
  page,
}) => {
  // The engine's own default text size, so this runs in every engine.
  await scoredVerdictAtWidths(page, 16);
});

test("a larger default text size never shrinks a scored verdict, at any width, and keeps it inside its band", async ({
  pageAtDefaultTextSize,
}) => {
  // Each width's verdict size at the previous, smaller text size.
  let previous: Map<number, number> | undefined;
  const sizeAt320 = new Map<number, number>();
  for (const standard of [16, 24, 32]) {
    const page = await pageAtDefaultTextSize(standard);
    const sizes = await scoredVerdictAtWidths(page, standard);
    for (const [width, size] of sizes) {
      expect(
        size,
        `${width}px wide, ${standard}px text`,
      ).toBeGreaterThanOrEqual(previous?.get(width) ?? 0);
    }
    previous = sizes;
    sizeAt320.set(standard, sizes.get(320)!);
  }

  // The narrowest phone: the 2rem floor makes it larger, not just equal.
  expect(sizeAt320.get(32)).toBeGreaterThan(sizeAt320.get(16)!);
});
