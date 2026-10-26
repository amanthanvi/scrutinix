import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// scripts/run-e2e.mjs starts the server on the same port (default 3000).
const port = process.env.E2E_PORT || "3000";

// Playwright's Firefox reads the profile list (profiles.ini) in the
// installed Firefox's data folder at startup, even with its own profile.
// macOS can deny other apps that folder (~/Library/Application Support/
// Firefox); Firefox then exits with "Could not find profile folder." and
// never launches. MOZ_APP_DATA gives it a folder of its own (tmpdir() is
// per user on macOS). Its own browsers (helpers.ts) inherit this too.
const firefoxLaunchOptions =
  process.platform === "darwin"
    ? {
        env: {
          ...process.env,
          MOZ_APP_DATA: join(tmpdir(), "scrutinix-e2e-firefox"),
        },
      }
    : {};

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
  },
  // `npm run test:e2e` runs Chromium (scripts/run-e2e.mjs picks it when no
  // --project is given); `npm run test:e2e:engines` runs all three. Write
  // specs that pass in each (AGENTS.md, "Engine-portable e2e tests").
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional local override for environments that ship a system
        // Chromium instead of the Playwright-managed download (unset in CI).
        launchOptions: process.env.PW_CHROMIUM_PATH
          ? { executablePath: process.env.PW_CHROMIUM_PATH }
          : {},
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: firefoxLaunchOptions,
      },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
