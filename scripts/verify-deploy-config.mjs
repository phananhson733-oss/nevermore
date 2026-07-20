#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// Validate both prepared worker-host configurations. The Owner/topology decision
// remains an external release gate documented in docs/DEPLOYMENT.md.
const render = read("render.yaml");
assert.match(render, /type:\s*worker/, "render.yaml must declare a worker service");
assert.match(render, /runtime:\s*docker/, "render.yaml worker must use the docker runtime");
assert.match(
  render,
  /dockerfilePath:\s*\.\/Dockerfile\.worker/,
  "render.yaml must build Dockerfile.worker",
);
for (const dashboardValue of [
  "APP_ORIGIN",
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "OPENAI_API_KEY",
]) {
  assert.match(
    render,
    new RegExp(`key:\\s*${dashboardValue}\\b[^\\n]*\\n\\s*sync:\\s*false`),
    `${dashboardValue} must be an explicit dashboard value (sync:false) in render.yaml`,
  );
}
assert.match(
  render,
  /key:\s*FINDING_SUMMARIES_ENABLED\b[^\n]*\n\s*value:\s*["']?true["']?/,
  "the prepared Render worker must explicitly enable budgeted Finding summaries",
);

const railway = JSON.parse(read("railway.json"));
assert.equal(railway.build?.builder, "DOCKERFILE");
assert.equal(railway.build?.dockerfilePath, "Dockerfile.railway");
assert.equal(
  railway.deploy?.startCommand,
  undefined,
  "the shared Railway config must let web use the image CMD and worker use its service-level override",
);
assert.equal(railway.deploy?.restartPolicyType, "ON_FAILURE");
assert.ok(railway.deploy?.restartPolicyMaxRetries >= 3);

const vercel = JSON.parse(read("apps/web/vercel.json"));
assert.equal(vercel.framework, "nextjs");

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

const railwayDockerfile = read("Dockerfile.railway");
assert.match(railwayDockerfile, /^FROM node:24-/m);
assert.match(railwayDockerfile, /pnpm install --frozen-lockfile/);
assert.match(railwayDockerfile, /pnpm --filter @sf\/web build/);
assert.match(
  railwayDockerfile,
  /cp -R apps\/web\/\.next\/static apps\/web\/\.next\/standalone\/apps\/web\/\.next\/static/,
);
assert.match(
  railwayDockerfile,
  /CMD \["node", "apps\/web\/\.next\/standalone\/apps\/web\/server\.js"\]/,
);
assert.match(
  railwayDockerfile,
  /apps\/worker\/package\.json/,
  "the shared Railway image must contain the worker workspace",
);
assert.doesNotMatch(
  railwayDockerfile,
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
assert.match(
  ciWorkflow,
  /run:\s*pnpm verify:spec/,
  "CI must enforce the pinned frozen-spec contract",
);
assert.match(ciWorkflow, /run:\s*pnpm test:e2e:real/);
assert.match(ciWorkflow, /run:\s*pnpm test:e2e:mock/);
assert.match(
  ciWorkflow,
  /docker build --pull=false --file Dockerfile\.worker --tag signalframe-worker:verify \./,
  "CI must build Dockerfile.worker",
);
assert.match(
  ciWorkflow,
  /docker build --pull=false --file Dockerfile\.railway --tag signalframe-railway:verify \./,
  "CI must build Dockerfile.railway",
);
assert.match(
  ciWorkflow,
  /name: Smoke the frozen Railway web runtime[\s\S]*signalframe-railway:verify[\s\S]*\/api\/mvp\/health\/live/,
  "CI must boot the Railway image and probe web liveness",
);
assert.match(
  ciWorkflow,
  /name: Smoke both worker image entrypoints[\s\S]*signalframe-worker:verify[\s\S]*signalframe-railway:verify[\s\S]*apps\/worker\/src\/index\.ts/,
  "CI must execute both worker image entrypoints",
);

console.log(
  "Deploy configs passed: CI builds the worker and frozen Railway images, the shared-image Railway web/worker path and Owner-pending Vercel/Render candidate stay explicit, Node 24 and frozen pnpm are pinned, and configuration remains secret-safe.",
);
