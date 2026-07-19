#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

// Worker host is a persistent container built from Dockerfile.worker. Render is
// the primary host (render.yaml); railway.json is kept as an equivalent fallback.
const render = read("render.yaml");
assert.match(render, /type:\s*worker/, "render.yaml must declare a worker service");
assert.match(render, /runtime:\s*docker/, "render.yaml worker must use the docker runtime");
assert.match(
  render,
  /dockerfilePath:\s*\.\/Dockerfile\.worker/,
  "render.yaml must build Dockerfile.worker",
);
for (const secret of [
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "OPENAI_API_KEY",
]) {
  assert.match(
    render,
    new RegExp(`key:\\s*${secret}\\b[^\\n]*\\n\\s*sync:\\s*false`),
    `${secret} must be sync:false (a dashboard secret, never a committed value) in render.yaml`,
  );
}

const railway = JSON.parse(read("railway.json"));
assert.equal(railway.build?.builder, "DOCKERFILE");
assert.equal(railway.build?.dockerfilePath, "Dockerfile.worker");
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

const dockerignore = read(".dockerignore");
assert.match(dockerignore, /^\.env\.local$/m);
assert.match(dockerignore, /^\.env\.\*\.local$/m);
assert.match(dockerignore, /^node_modules$/m);

const nextConfig = read("apps/web/next.config.ts");
assert.match(nextConfig, /outputFileTracingRoot:\s*monorepoRoot/);

console.log(
  "Deploy config passed: Vercel web + Render/Railway worker, Node 24, frozen pnpm, PID 1, secret-safe context.",
);
