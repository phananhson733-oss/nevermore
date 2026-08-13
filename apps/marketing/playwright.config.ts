import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.MARKETING_E2E_PORT ?? 3001);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `cd .next/standalone && HOSTNAME=127.0.0.1 PORT=${port} node apps/marketing/server.js`,
    url: `${baseURL}/tools/seo-audit`,
    timeout: 60_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
