import { defineConfig, devices } from "@playwright/test";

const evidenceDir =
  process.env.VERIFY_EVIDENCE_DIR || "/tmp/scrutinix-verify/evidence";

export default defineConfig({
  testDir: "./scripts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: `${evidenceDir}/playwright-report`,
      },
    ],
  ],
  outputDir: `${evidenceDir}/test-results`,
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
