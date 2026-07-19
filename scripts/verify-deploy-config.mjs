#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

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
  "Deploy config passed: Vercel web + Railway worker, Node 24, frozen pnpm, PID 1, secret-safe context.",
);
