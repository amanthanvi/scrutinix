import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  // The suite runs offline against deterministic fixtures, so a failure is
  // a real regression - retries would only hide flakes.
  retries: 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
