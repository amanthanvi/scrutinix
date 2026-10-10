import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoAxeViolations(page: Page) {
  const devToolsButton = page.getByRole("button", {
    name: /open next\.js dev tools/i,
  });
  if ((await devToolsButton.count()) > 0) {
    await devToolsButton.evaluate((element) => {
      element.remove();
    });
  }

  const accessibilityReport = await new AxeBuilder({ page }).analyze();
  expect(accessibilityReport.violations).toEqual([]);
}

test("privacy page discloses what a scan sends @smoke", async ({ page }) => {
  await page.goto("/privacy", { waitUntil: "domcontentloaded" });

  const main = page.locator("#main-content");
  await expect(
    main.getByRole("heading", { name: /what leaves this browser/i }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", {
      name: /do not scan private or one-time links/i,
    }),
  ).toBeVisible();

  const text = [
    "IndexedDB",
    "password-reset",
    "VirusTotal community",
    "premium VirusTotal customers",
    "private scanning",
    "Google Safe Browsing",
    "raw URL, not a hash",
    "URLhaus",
    "abuse.ch",
    "ThreatFox",
    "hostname only",
    "OpenPhish",
    "matches it locally",
    "Spamhaus DBL",
    "SURBL",
    "rdap.org",
    "DNS resolver",
    "scrutinix/3.0",
    "64 KB",
    "one-time link",
    "15 minutes",
    "Upstash Redis",
    "hash of the URL",
    "one-minute window",
    "one-day window",
    "Share links embed a browser-generated snapshot in the URL itself",
    "Vercel",
    "each later host",
    "IPv6 address",
    "does not open a connection",
  ];

  for (const phrase of text) {
    await expect(main).toContainText(phrase);
  }

  await expectNoAxeViolations(page);
});

test("about page lists every feed and provider @smoke", async ({ page }) => {
  await page.goto("/about", { waitUntil: "domcontentloaded" });

  const main = page.locator("#main-content");
  await expect(
    main.getByRole("heading", { name: /how a scan becomes a verdict/i }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { name: /^sources$/i })).toBeVisible();

  const text = [
    "VirusTotal",
    "Google Safe Browsing",
    "URLhaus",
    "OpenPhish",
    "ThreatFox",
    "Spamhaus DBL",
    "SURBL",
    "ML ensemble",
    "rdap.org",
    "75 or higher",
    "urlhaus.abuse.ch/browse/",
    "No hosted model is called",
  ];

  for (const phrase of text) {
    await expect(main).toContainText(phrase);
  }

  await expectNoAxeViolations(page);
});
