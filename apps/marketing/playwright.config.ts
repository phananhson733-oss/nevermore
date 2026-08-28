import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.MARKETING_E2E_PORT ?? 3001);
const baseURL = `http://127.0.0.1:${port}`;
const testCookieKey = "cd".repeat(32);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // Vitest contract fixtures live beside browser fixtures and are not E2E specs.
  testIgnore: "**/*.test.ts",
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
    // `env -i` is the paid-call tripwire. The standalone server receives no
    // developer or production provider credentials even when the parent shell
    // has them; only the local values required to read the sealed fixtures are
    // admitted.
    command: `mkdir -p .next/standalone/apps/marketing/public .next/standalone/apps/marketing/.next/static && cp -R public/. .next/standalone/apps/marketing/public/ && cp -R .next/static/. .next/standalone/apps/marketing/.next/static/ && cd .next/standalone && env -i PATH="$PATH" NODE_ENV=production MARKETING_GSC_CONNECT_ENABLED=true TOKEN_ENCRYPTION_KEY=${testCookieKey} HOSTNAME=127.0.0.1 PORT=${port} node apps/marketing/server.js`,
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
