import { defineConfig, devices } from "@playwright/test";

const suite = process.env.VERIFY_SUITE || "playwright";
// The HTML report and traces embed raw test output, so they go to the
// private state directory (suite.mjs passes VERIFY_RAW_DIR), never to the
// evidence directory people cite and share.
const rawDir =
  process.env.VERIFY_RAW_DIR || `/tmp/scrutinix-verify/playwright/${suite}`;

export default defineConfig({
  testDir: "./scripts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  // smoke.mjs sends the list output to a private log and prints a summary
  // from the JSON report.
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: `${rawDir}/report`,
      },
    ],
    ...(process.env.VERIFY_REPORT_FILE
      ? [["json", { outputFile: process.env.VERIFY_REPORT_FILE }]]
      : []),
  ],
  outputDir: `${rawDir}/test-results`,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    trace: "on",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
