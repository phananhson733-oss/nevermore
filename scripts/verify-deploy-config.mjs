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
  "playwright test --config=playwright.config.ts",
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
