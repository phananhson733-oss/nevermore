import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E harness (spec §16, DoD AC-042/043/044/045). The web app boots
 * under the double-gated dev-auth shim (`SF_DEV_AUTH=true`, `NODE_ENV!=production`)
 * on port 3100 so the authenticated screens are reachable without a running
 * Supabase Auth (GoTrue) instance. Specs that exercise async jobs (collection /
 * diagnostic / artifact / export) additionally boot the worker in their own
 * global-setup; the responsive + a11y specs need only the web server.
 *
 * The dev operator auto-provisions the singleton "SignalFrame" workspace on the
 * first request (see apps/web/src/lib/auth/session.ts), so specs can seed a
 * project through `POST /api/mvp/projects` with no login step.
 */

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The dev-auth workspace is a shared singleton and the specs mutate the same
  // Postgres, so run serially rather than fully parallel to keep runs deterministic.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
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
    // `next dev` sets NODE_ENV=development, satisfying the dev-auth gate. The web
    // app loads apps/web/.env.local (symlinked to the repo-root .env.local), which
    // already carries SF_DEV_AUTH=true and the local DATABASE_URL.
    command: `pnpm --filter @sf/web dev --port ${PORT}`,
    url: `${BASE_URL}/api/mvp/health/live`,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    env: {
      SF_DEV_AUTH: "true",
      PORT: String(PORT),
    },
  },
});
