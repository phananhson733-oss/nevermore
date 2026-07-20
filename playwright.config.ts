import { defineConfig, devices } from "@playwright/test";
import { requireSafeTestDatabaseUrl } from "./packages/db/src/test-database-safety.ts";

/**
 * Playwright E2E harness (spec §16, DoD AC-042/043/044/045). The web app boots
 * under the loopback-only dev-auth shim (`SF_DEV_AUTH=true`, explicit Next
 * development runtime, and loopback `APP_ORIGIN`) on port 3100 so the screens
 * are reachable without a running
 * Supabase Auth (GoTrue) instance. The serial real-vertical spec boots and stops
 * the real worker in its own suite lifecycle for collection / diagnostic /
 * artifact / export jobs; responsive + a11y specs need only the web server.
 *
 * The dev operator auto-provisions the singleton "SignalFrame" workspace on the
 * first request (see apps/web/src/lib/auth/session.ts), so specs can seed a
 * project through `POST /api/mvp/projects` with no login step.
 */

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const DATABASE_URL = requireSafeTestDatabaseUrl(
  process.env["E2E_DATABASE_URL"],
  "E2E_DATABASE_URL",
);

export default defineConfig({
  testDir: "./e2e",
  // Database-free critical-flow specs have their own isolated server/config.
  testIgnore: ["**/*.mock.spec.ts"],
  // The dev-auth workspace is a shared singleton and the specs mutate the same
  // Postgres, so run serially rather than fully parallel to keep runs deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  // Reporter onEnd runs after Playwright has stopped the webServer. The cleanup
  // reporter must not be a globalTeardown, which runs while Next is still live.
  reporter: process.env["CI"]
    ? [["./e2e/real-global-teardown.ts"], ["github"], ["list"]]
    : [["./e2e/real-global-teardown.ts"], ["list"]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Playwright documents that browser rendering and font metrics vary by
      // host OS. Keep separately reviewed baselines per platform while a small
      // pixel ratio absorbs rasterisation noise within the same platform.
      pathTemplate:
        "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",
      threshold: 0.2,
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `next dev` sets NODE_ENV=development, satisfying the dev-auth gate.
    // Every stateful dependency is overridden here. The explicit disposable DB
    // guard above prevents a developer's hosted `.env.local` from being used by
    // this mutating harness.
    command: `pnpm --filter @sf/web dev --webpack --port ${PORT}`,
    url: `${BASE_URL}/api/mvp/health/live`,
    // Never reuse an unknown local process: it may have been started with a
    // hosted DATABASE_URL. A port collision must fail closed instead of sending
    // mutating E2E requests to a server whose dependencies we did not provide.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_ORIGIN: BASE_URL,
      DATABASE_URL,
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
      SF_BLOB_DIR: "/tmp/signalframe-e2e-real-blobs",
      SF_DEV_AUTH: "true",
      NEXT_DIST_DIR: ".next-e2e-real",
      PORT: String(PORT),
    },
  },
});
