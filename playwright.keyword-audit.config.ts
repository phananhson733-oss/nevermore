import { defineConfig, devices } from "@playwright/test";

const PORT = 4175;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Browser contract for the repository-owned Nevermore keyword audit Artifact.
 *
 * The harness always owns a dedicated server process. Reusing an arbitrary
 * process could validate a stale generated file from another checkout.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "keyword-audit-artifact.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
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
      name: "chromium-keyword-audit",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: {
    command: `node scripts/serve-keyword-audit-artifact.mjs --port ${PORT}`,
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
