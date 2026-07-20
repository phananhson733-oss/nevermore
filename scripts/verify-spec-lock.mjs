#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(
  readFileSync(join(repoRoot, "scripts/spec-v0.2-lock.json"), "utf8"),
);

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function sorted(values) {
  return [...new Set(values)].sort();
}

function assertSameSet(actual, expected, label) {
  assert.deepEqual(sorted(actual), sorted(expected), `${label} drifted from the frozen spec lock`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

assert.equal(lock.lockFormat, 1, "unsupported spec lock format");
assert.equal(
  JSON.parse(read("package.json")).version,
  lock.productVersion,
  "package version drifted from the frozen spec lock",
);

const openapi = read("openapi/mvp.yaml");
const operations = [
  ...openapi.matchAll(/^\s+operationId:\s*([a-z][A-Za-z0-9]+)\s*$/gm),
].map((match) => match[1]);
assertSameSet(operations, lock.apiOperations, "OpenAPI operations");
assert.match(
  read("packages/contracts/src/zod/health.ts"),
  new RegExp(`CONTRACT_VERSION\\s*=\\s*"${lock.contractVersion}"`),
  "runtime contract version drifted from the frozen spec lock",
);
for (const operationId of lock.asyncOperations) {
  const marker = `operationId: ${operationId}`;
  const start = openapi.indexOf(marker);
  const next = openapi.indexOf("operationId:", start + marker.length);
  const operation = openapi.slice(start, next === -1 ? undefined : next);
  assert.ok(start >= 0, `async operation ${operationId} is missing`);
  assert.match(operation, /'202':/, `${operationId} must expose a 202 response`);
  assert.match(operation, /AsyncAccepted/, `${operationId} must use AsyncAccepted`);
}

const initialMigration = read("packages/db/migrations/0001_init.sql");
const tables = [
  ...initialMigration.matchAll(/CREATE TABLE IF NOT EXISTS app\.([a-z][a-z0-9_]*)\s*\(/g),
].map((match) => match[1]);
assertSameSet(tables, lock.tables, "application tables");

const rulesDir = join(repoRoot, "packages/engine/src/rules");
const rules = readdirSync(rulesDir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .flatMap((name) => [
    ...readFileSync(join(rulesDir, name), "utf8").matchAll(
      /\bid:\s*"((?:TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3})"/g,
    ),
  ])
  .map((match) => match[1]);
assertSameSet(rules, lock.rules, "diagnostic rules");

const explicitAuthorityIndex = process.argv.indexOf("--authority-root");
assert.ok(
  explicitAuthorityIndex === -1 || process.argv.length === explicitAuthorityIndex + 2,
  "usage: node scripts/verify-spec-lock.mjs [--authority-root <path>]",
);
const defaultAuthority = resolve(
  repoRoot,
  "../signalframe-mvp/implementation-spec-v0.2",
);
const authorityRoot =
  explicitAuthorityIndex === -1
    ? defaultAuthority
    : resolve(process.argv[explicitAuthorityIndex + 1]);
const authorityAvailable = existsSync(authorityRoot);
if (explicitAuthorityIndex !== -1) {
  assert.ok(authorityAvailable, "explicit authority root does not exist");
}

if (authorityAvailable) {
  for (const [relativePath, expectedHash] of Object.entries(lock.authorityFiles)) {
    const sourcePath = join(authorityRoot, relativePath);
    assert.ok(existsSync(sourcePath), `authority file is missing: ${relativePath}`);
    assert.equal(
      sha256(sourcePath),
      expectedHash,
      `authority file drifted from the reviewed v0.2 lock: ${relativePath}`,
    );
  }
  const verification = spawnSync(
    process.execPath,
    [join(authorityRoot, "scripts/verify-spec.mjs")],
    { stdio: "inherit" },
  );
  assert.equal(
    verification.status,
    0,
    "authoritative implementation-spec verifier failed",
  );
  console.log("Frozen spec source hashes match the reviewed authority snapshot.");
} else {
  console.log(
    "Authority checkout absent; verified the clone-local pinned v0.2 contract lock.",
  );
}

console.log(
  `Spec lock passed: ${operations.length} operations, ${lock.asyncOperations.length} async operations, ${tables.length} tables, ${rules.length} rules.`,
);
