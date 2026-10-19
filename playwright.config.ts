import { defineConfig, devices } from "@playwright/test";

// scripts/run-e2e.mjs starts the server on the same port (default 3000).
const port = process.env.E2E_PORT || "3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  // The suite runs offline against deterministic fixtures, so a failure is
  // a real regression - retries would only hide flakes.
  retries: 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    // Optional local override for environments that ship a system Chromium
    // instead of the Playwright-managed download (unset in CI).
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
