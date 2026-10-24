import { defineConfig, devices } from "@playwright/test";

const evidenceDir =
  process.env.VERIFY_EVIDENCE_DIR || "/tmp/scrutinix-verify/evidence";
const suite = process.env.VERIFY_SUITE || "playwright";

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
        outputFolder: `${evidenceDir}/playwright-report/${suite}`,
      },
    ],
    ...(process.env.VERIFY_REPORT_FILE
      ? [["json", { outputFile: process.env.VERIFY_REPORT_FILE }]]
      : []),
  ],
  outputDir: `${evidenceDir}/test-results/${suite}`,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    trace: "on",
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
