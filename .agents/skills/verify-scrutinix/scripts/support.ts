import { expect, type Page, type Request } from "@playwright/test";

import { isolateRateLimit } from "../../../../tests/e2e/helpers";

export {
  isolateRateLimit,
  setDefaultTextSize,
} from "../../../../tests/e2e/helpers";

// Each test presents its own rate-limit identity, as tests/e2e does, so a
// full drive never spends one client's per-minute scan budget.
export async function gotoApp(page: Page) {
  await isolateRateLimit(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
}

// The theme button is named "Toggle theme" until the client has mounted.
export async function waitForHydration(page: Page) {
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
}

/** Every scan request the page starts, so a test can prove there were none. */
export function recordScans(page: Page): string[] {
  const scans: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/analyze")) {
      scans.push(request.url());
    }
  });
  return scans;
}

/**
 * Open the share target the way an Android share sheet does: a POST
 * navigation to /share with the shared fields, form-encoded. The browser
 * builds that request itself, so the test turns its own navigation to
 * /share into it. Resolves with the request /share received.
 */
export async function launchFromShareSheet(
  page: Page,
  fields: Record<string, string>,
): Promise<Request> {
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
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/share",
  );
  await page.goto("/share", { waitUntil: "domcontentloaded" });
  await page.unroute("**/share");
  return (await answered).request();
}

export async function fillSingle(page: Page, url: string) {
  const input = page.getByRole("textbox", { name: "URL to analyze" });
  await expect(async () => {
    await input.fill(url);
    await expect(input).toHaveValue(url);
  }).toPass();
  return input;
}

export async function historyState(page: Page): Promise<{
  names: string[];
  urls: string[];
}> {
  return page.evaluate(async () => {
    const listed = await indexedDB.databases();
    const names = listed.flatMap((entry) =>
      typeof entry.name === "string" ? [entry.name] : [],
    );
    if (!names.includes("scrutinix-v2")) {
      return { names, urls: [] as string[] };
    }

    const urls = await new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open("scrutinix-v2");
      request.onerror = () => {
        reject(request.error ?? new Error("Failed to open scan history."));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("scans")) {
          database.close();
          resolve([]);
          return;
        }
        const all = database
          .transaction("scans", "readonly")
          .objectStore("scans")
          .getAll();
        all.onerror = () => {
          reject(all.error ?? new Error("Failed to read scan history."));
        };
        all.onsuccess = () => {
          const rows = all.result as Array<{ url?: unknown }>;
          database.close();
          resolve(
            rows.flatMap((row) =>
              typeof row.url === "string" ? [row.url] : [],
            ),
          );
        };
      };
    });

    return { names, urls };
  });
}

/**
 * How long a scan may take to land. The first scan after a launch also
 * compiles the analyze route in `next dev`, which the 20-second assertion
 * default does not always cover.
 */
export const SCAN_TIMEOUT_MS = 60_000;

export async function scanSingle(page: Page, url: string, verdict: string) {
  await fillSingle(page, url);
  await page.getByRole("button", { name: "Analyze URL" }).click();
  const region = page.getByRole("region", {
    name: new RegExp(`^scan result: ${verdict}$`, "i"),
  });
  await expect(region).toBeVisible({ timeout: SCAN_TIMEOUT_MS });
  return region;
}
