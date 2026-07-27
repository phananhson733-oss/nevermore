import { defineConfig, devices } from "@playwright/test";

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Browser contract for the standalone, customer-deliverable Artifact.
 *
 * This harness intentionally owns its server process. Reusing an arbitrary
 * process on 4174 could validate a stale HTML file from another checkout.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "complete-customer-artifact.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: BASE_URL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-artifact",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: `node scripts/serve-customer-artifact.mjs --port ${PORT}`,
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
