import { expect, type Page } from "@playwright/test";

export async function gotoApp(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /switch to (light|dark) theme/i }),
  ).toBeVisible();
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

export async function scanSingle(page: Page, url: string, verdict: string) {
  await fillSingle(page, url);
  await page.getByRole("button", { name: "Analyze URL" }).click();
  const region = page.getByRole("region", {
    name: new RegExp(`^scan result: ${verdict}$`, "i"),
  });
  await expect(region).toBeVisible();
  return region;
}
