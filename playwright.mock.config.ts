import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["E2E_MOCK_PORT"] ?? 3200);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Database-free critical-flow harness. The API is fulfilled in the browser and
 * the server gets an unusable loopback DATABASE_URL as a tripwire: an accidental
 * real route call fails locally instead of touching `.env.local`/hosted data.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.mock.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  // Cleanup is a reporter so its onEnd runs after Playwright stops Next.
  reporter: process.env["CI"]
    ? [["./e2e/mock-global-teardown.ts"], ["github"], ["list"]]
    : [["./e2e/mock-global-teardown.ts"], ["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-mock",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm --filter @sf/web dev --webpack --port ${PORT}`,
    url: `${BASE_URL}/api/mvp/health/live`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ORIGIN: BASE_URL,
      DATABASE_URL: "postgresql://e2e:e2e@127.0.0.1:1/e2e_never_connect",
      SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_ANON_KEY: "e2e-local-only",
      SUPABASE_SERVICE_ROLE_KEY: "e2e-local-only",
      CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
      GOOGLE_OAUTH_CLIENT_ID: "e2e-local-only",
      GOOGLE_OAUTH_CLIENT_SECRET: "e2e-local-only",
      DATAFORSEO_ENABLED: "false",
      RAW_IMPORT_BUCKET: "e2e-local-only",
      EXPORT_BUCKET: "e2e-local-only",
      SF_BLOB_BACKEND: "local",
      SF_BLOB_DIR: "/tmp/signalframe-e2e-mock-blobs",
      SF_DEV_AUTH: "true",
      SF_E2E_MOCK_API: "true",
      NEXT_DIST_DIR: ".next-e2e-mock",
      PORT: String(PORT),
    },
  },
});
