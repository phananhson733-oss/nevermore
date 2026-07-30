#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const rootPackage = JSON.parse(read("package.json"));
assert.equal(
  rootPackage.scripts?.["verify:spec"],
  "node scripts/verify-spec-lock.mjs",
  "verify:spec must be reproducible from the clone-local frozen-spec lock",
);
assert.equal(
  rootPackage.scripts?.["test:e2e"],
  "pnpm test:e2e:real && pnpm test:e2e:mock",
  "the advertised E2E command must include both real and mock suites",
);
assert.equal(
  rootPackage.scripts?.["test:e2e:real"],
  "tsx e2e/run-real-e2e.ts",
  "the real E2E gate must use the segmented fresh-process/database orchestrator",
);
assert.equal(
  rootPackage.scripts?.["test:e2e:mock"],
  "playwright test --config=playwright.mock.config.ts",
);

const railway = JSON.parse(read("railway.json"));
assert.equal(railway.build?.builder, "DOCKERFILE");
assert.equal(railway.build?.dockerfilePath, "Dockerfile.worker");
assert.equal(
  railway.deploy?.startCommand,
  "node --enable-source-maps --import tsx apps/worker/src/index.ts",
  "Railway must start the persistent worker directly; it must never fall back to a web CMD",
);
assert.equal(railway.deploy?.restartPolicyType, "ON_FAILURE");
assert.ok(railway.deploy?.restartPolicyMaxRetries >= 3);

const vercel = JSON.parse(read("apps/web/vercel.json"));
assert.equal(vercel.framework, "nextjs");

const vercelEnvironment = read("deploy/vercel.web.env.template");
assert.match(
  vercelEnvironment,
  /^APP_ORIGIN=https:\/\/app\.gengrowth\.ai\s/m,
  "the Vercel template must use the approved production origin root",
);
assert.doesNotMatch(
  vercelEnvironment,
  /^\s*NEXT_PUBLIC_BASE_PATH\s*=/m,
  "the approved Vercel deployment must leave NEXT_PUBLIC_BASE_PATH unset",
);
assert.doesNotMatch(
  vercelEnvironment,
  /gengrowth\.ai\/app\b/,
  "the approved Vercel deployment must not use the retired /app mount",
);

const dockerfile = read("Dockerfile.worker");
assert.match(dockerfile, /^FROM node:24-/m);
assert.match(dockerfile, /pnpm install --frozen-lockfile/);
assert.match(
  dockerfile,
  /CMD \["node", "--enable-source-maps", "--import", "tsx", "apps\/worker\/src\/index\.ts"\]/,
);
assert.doesNotMatch(
  dockerfile,
  /(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|GOOGLE_OAUTH_CLIENT_SECRET)\s*=/,
);

const dockerignore = read(".dockerignore");
assert.match(
  dockerignore,
  /^\.env\*$/m,
  "every root environment-file variant must stay out of the worker image",
);
assert.match(
  dockerignore,
  /^\*\*\/\.env\*$/m,
  "nested environment-file variants must stay out of the worker image",
);
assert.match(
  dockerignore,
  /^docs$/m,
  "operator docs and local verification evidence must stay out of runtime images",
);
assert.match(dockerignore, /^node_modules$/m);

const nextConfig = read("apps/web/next.config.ts");
assert.match(nextConfig, /outputFileTracingRoot:\s*monorepoRoot/);

const ciWorkflow = read(".github/workflows/ci.yml");
const realE2eRuntime = read("e2e/real-e2e-runtime.ts");
const realE2eRunner = read("e2e/run-real-e2e.ts");
const realE2eConfig = read("playwright.config.ts");
const testDatabaseSafety = read(
  "packages/db/src/test-database-safety.ts",
);
assert.match(
  realE2eRuntime,
  /REAL_E2E_SEGMENTS\s*=\s*\["light",\s*"ac044",\s*"ac045"\]\s+as const/,
  "the real E2E orchestrator must retain light, AC-044, and AC-045 segments",
);
assert.match(
  realE2eRunner,
  /for\s*\(\s*const\s+\[index,\s*segment\]\s+of\s+REAL_E2E_SEGMENTS\.entries\(\)\s*\)/,
  "the real E2E runner must execute every canonical segment",
);
assert.match(
  realE2eRunner,
  /finally\s*\{[\s\S]*?"dropdb"/,
  "every real E2E segment must force database cleanup from a finally block",
);
assert.match(
  realE2eRunner,
  /REAL_E2E_INVOCATION_ID:\s*invocationId/,
  "every real E2E child must carry the invocation identity used for its resources",
);
assert.match(
  realE2eRunner,
  /INHERITED_POSTGRES_ROUTING_ENVIRONMENT[\s\S]*"PGHOSTADDR"[\s\S]*"PGSERVICE"/,
  "real E2E must neutralize inherited PostgreSQL routing",
);
assert.match(
  testDatabaseSafety,
  /CONNECTION_ROUTING_QUERY_PARAMETERS[\s\S]*"hostaddr"[\s\S]*"servicefile"/,
  "destructive test URLs must reject PostgreSQL routing query overrides",
);
assert.match(
  realE2eConfig,
  /retries:\s*0\b/,
  "the stateful real E2E release gate must not reuse mutated state in retries",
);
assert.match(
  realE2eConfig,
  /trace:\s*"retain-on-failure"/,
  "the single real E2E attempt must retain failure traces",
);
const mockE2eConfig = read("playwright.mock.config.ts");
assert.match(
  mockE2eConfig,
  /retries:\s*0\b/,
  "the mock E2E release gate must fail its first unsuccessful attempt",
);
assert.match(
  mockE2eConfig,
  /trace:\s*"retain-on-failure"/,
  "the single mock E2E attempt must retain failure traces",
);
assert.doesNotMatch(
  realE2eConfig,
  /max-old-space-size/,
  "fresh process isolation must not be replaced or obscured by a heap bump",
);
assert.doesNotMatch(
  ciWorkflow,
  /createdb[^\n]*signalframe_e2e_ci|dropdb[^\n]*signalframe_e2e_ci/,
  "CI must delegate disposable real-E2E database ownership to the canonical runner",
);
const obsoleteVisualBaselineDirectory = join(
  root,
  "e2e",
  "real-vertical-chains.spec.ts-snapshots",
);
const obsoleteVisualBaselines = existsSync(obsoleteVisualBaselineDirectory)
  ? readdirSync(obsoleteVisualBaselineDirectory).filter((entry) =>
      /^canonical-relayops-.*\.png$/.test(entry),
    )
  : [];
assert.deepEqual(
  obsoleteVisualBaselines,
  [],
  "the authenticated App must not regain a second canonical visual baseline; the repository-owned GenGrowth customer Artifact is the sole customer-visible authority",
);
assert.doesNotMatch(
  read("e2e/real-vertical-chains.spec.ts"),
  /canonical-relayops-|assertCanonicalVisualRegression|toHaveScreenshot/,
  "real data E2E must verify behavior without defining an alternate customer visual authority",
);
assert.doesNotMatch(
  read("playwright.config.ts"),
  /canonical-relayops-|real-vertical-chains\.spec\.ts-snapshots/,
  "the authenticated-App Playwright harness must not restore the retired real-vertical-chains visual baseline",
);
assert.doesNotMatch(
  ciWorkflow,
  /update_linux_visual_baselines|test:e2e:real\s+--update-snapshots|real-vertical-chains\.spec\.ts-snapshots/,
  "CI must not regenerate the retired authenticated-App visual baseline",
);
// Anchored to end-of-line: `pnpm verify:spec:test` also matches an unanchored
// `pnpm verify:spec`, so without the anchor the gate itself could be dropped
// from CI while its test suite alone kept this assertion green.
assert.match(
  ciWorkflow,
  /run:\s*pnpm verify:spec$/m,
  "CI must enforce the pinned frozen-spec contract",
);
assert.match(
  ciWorkflow,
  /run:\s*pnpm verify:spec:test$/m,
  "CI must run the node:test suites for the verifiers behind verify:spec; nothing else collects them",
);
assert.match(ciWorkflow, /run:\s*pnpm test:e2e:real/);
assert.match(ciWorkflow, /run:\s*pnpm test:e2e:mock/);
assert.match(
  ciWorkflow,
  /docker build --pull=false --file Dockerfile\.worker --tag signalframe-worker:verify \./,
  "CI must build Dockerfile.worker",
);
console.log(
  "Deploy configs passed: Vercel is web-only at app.gengrowth.ai, Supabase owns state, Railway builds and starts the worker-only image, Node 24 and frozen pnpm are pinned, and configuration remains secret-safe.",
);
