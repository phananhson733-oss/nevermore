import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env["WORKBENCH_ARTIFACT_PORT"] ?? 3215);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Isolated visual-acceptance harness for the actual four-module Next app.
 * It deliberately owns a separate port, distDir, blob directory and cleanup
 * reporter so it can run beside the broader mock suite without corrupting
 * either server's generated manifests.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "complete-four-module-workbench.mock.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: [
    ["./e2e/workbench-artifact-cleanup-reporter.ts"],
    ["list"],
  ],
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: "test-results/workbench-artifact",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-workbench-artifact",
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
      SF_BLOB_DIR: "/tmp/signalframe-workbench-artifact-blobs",
      SF_DEV_AUTH: "true",
      SF_E2E_MOCK_API: "true",
      SF_E2E_CLIENT_NAME: "RelayOps",
      SF_E2E_PROJECT_NAME: "海外增长工作台",
      NEXT_DIST_DIR: ".next-workbench-artifact",
      PORT: String(PORT),
    },
  },
});
