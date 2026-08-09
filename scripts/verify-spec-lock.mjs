#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractOpenApiOperations,
  listOrderedMigrationSources,
  migrationTableInventory,
} from "./spec-authority-lib.mjs";

const scriptRepositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const requiredAuthorityFiles = [
  "README.md",
  "MVP-IMPLEMENTATION-SPEC.md",
  "openapi.yaml",
  "schema.sql",
  "schemas/service-bundle-manifest.schema.json",
  "scripts/schema-smoke.sql",
  "scripts/generate-schema.mjs",
  "scripts/verify-spec.mjs",
  "scripts/verify-spec.test.mjs",
  "historical-publication-candidate/README.md",
  "historical-publication-candidate/acceptance-matrix.md",
  "historical-publication-candidate/openapi.candidate.yaml",
  "historical-publication-candidate/provider-boundaries.md",
  "historical-publication-candidate/repository-invariants.md",
  "historical-publication-candidate/schema.candidate.sql",
  "historical-publication-candidate/scripts/verify-candidate.mjs",
  "historical-publication-candidate/scripts/verify-candidate.test.mjs",
  "historical-publication-candidate/spec-v0.4-candidate-lock.json",
];

const requiredImplementationFiles = [
  "package.json",
  "patches/brace-expansion@5.0.9.patch",
  "authority/index.json",
  "openapi/mvp.yaml",
  "packages/contracts/src/generated/openapi.ts",
  "schemas/service-bundle-manifest.schema.json",
  "packages/db/migrations/schema-smoke.sql",
  "scripts/spec-authority-lib.mjs",
  "scripts/generate-spec-v0.4-lock.mjs",
  "scripts/verify-implementation.mjs",
  "scripts/verify-implementation-source.test.mjs",
  "scripts/verify-spec-lock.mjs",
  "scripts/verify-spec-lock.test.mjs",
  "scripts/verify-docs-consistency.test.mjs",
  "README.md",
  "CLAUDE.md",
  "docs/PROGRESS.md",
  "docs/DEPLOYMENT.md",
];

function parseArguments(argv) {
  const options = {
    root: scriptRepositoryRoot,
    lock: undefined,
    authorityRoot: undefined,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert.ok(
      value && ["--root", "--lock", "--authority-root"].includes(flag),
      "usage: verify-spec-lock.mjs [--root <repository>] [--lock <path>] [--authority-root <path>]",
    );
    if (flag === "--root") options.root = resolve(value);
    if (flag === "--lock") options.lock = value;
    if (flag === "--authority-root") options.authorityRoot = value;
  }
  return options;
}

function safePath(base, value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim().length > 0, `${label} must not be empty`);
  const path = isAbsolute(value) ? resolve(value) : resolve(base, value);
  if (!isAbsolute(value)) {
    const rel = relative(base, path);
    assert.ok(
      rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel),
      `${label} escapes its root`,
    );
  }
  return path;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function sorted(values) {
  return [...new Set(values)].sort();
}

function exactSet(actual, expected, label) {
  const duplicates = actual.filter(
    (value, index) => actual.indexOf(value) !== index,
  );
  assert.deepEqual(sorted(duplicates), [], `${label} contains duplicates`);
  assert.deepEqual(
    sorted(actual),
    sorted(expected),
    `${label} drifted from the active spec lock`,
  );
}

function assertRequiredHashes(value, requiredPaths, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} hashes are required`,
  );
  exactSet(Object.keys(value), requiredPaths, `${label} paths`);
  for (const [relativePath, hash] of Object.entries(value)) {
    assert.match(
      hash,
      /^[a-f0-9]{64}$/,
      `${label} has an invalid SHA-256 hash for ${relativePath}`,
    );
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function diagnosticRules(repoRoot) {
  const directory = resolve(repoRoot, "packages/engine/src/rules");
  const exportPattern =
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*Rule)\s*=\s*\{([\s\S]*?)\}\s+satisfies\s+DiagnosticRule\s*;/g;
  const rulesByIdentifier = new Map();
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const source = readFileSync(join(directory, name), "utf8");
    for (const match of source.matchAll(exportPattern)) {
      const id = match[2].match(
        /^\s*id:\s*["']((?:TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3})["']\s*,/m,
      )?.[1];
      const version = Number(
        match[2].match(/^\s*version:\s*([0-9]+)\s*,/m)?.[1],
      );
      assert.ok(id, `${name} ${match[1]} is missing its frozen rule id`);
      assert.ok(
        Number.isInteger(version) && version > 0,
        `${id} is missing a positive numeric version`,
      );
      assert.ok(
        !rulesByIdentifier.has(match[1]),
        `duplicate diagnostic rule export: ${match[1]}`,
      );
      rulesByIdentifier.set(match[1], { id, version });
    }
  }

  const registrySource = readFileSync(join(directory, "index.ts"), "utf8");
  const currentRegistryName = registrySource.match(
    /export\s+const\s+ALL_RULES\s*:[^=]+=\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*;/,
  )?.[1];
  assert.equal(
    currentRegistryName,
    "CONTEXTUAL_ALL_RULES",
    "ALL_RULES must alias the reviewed contextual registry",
  );
  const registryBody = registrySource.match(
    new RegExp(
      `export\\s+const\\s+${currentRegistryName}\\s*:[^=]+=\\s*\\[([\\s\\S]*?)\\]\\s*;`,
    ),
  )?.[1];
  assert.ok(registryBody, `${currentRegistryName} registry order is missing`);
  const identifiers = registryBody
    .split(",")
    .map((identifier) => identifier.trim())
    .filter(Boolean);
  assert.equal(
    new Set(identifiers).size,
    identifiers.length,
    `${currentRegistryName} contains duplicate rule exports`,
  );
  assert.deepEqual(
    new Set(identifiers),
    new Set(rulesByIdentifier.keys()),
    `${currentRegistryName} must enumerate every and only shipped diagnostic rule`,
  );
  return identifiers.map((identifier) => rulesByIdentifier.get(identifier));
}

function operationBlock(openapi, operationId) {
  const marker = `operationId: ${operationId}`;
  const start = openapi.indexOf(marker);
  assert.ok(start >= 0, `OpenAPI operation ${operationId} is missing`);
  const next = openapi.indexOf("operationId:", start + marker.length);
  return openapi.slice(start, next === -1 ? undefined : next);
}

function runVerifier(executable, arguments_, cwd, label) {
  const result = spawnSync(process.execPath, [executable, ...arguments_], {
    cwd,
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${label} failed`);
}

const options = parseArguments(process.argv.slice(2));
const repoRoot = options.root;
const indexPath = safePath(
  repoRoot,
  "authority/index.json",
  "authority discovery index",
);
const index = readJson(indexPath, "authority discovery index");
const configuredLock = options.lock ?? index.active?.lockPath;
assert.ok(configuredLock, "authority discovery does not identify an active lock");
const lockPath = safePath(repoRoot, configuredLock, "spec lock path");
assert.ok(existsSync(lockPath), `spec lock does not exist: ${lockPath}`);
const lock = readJson(lockPath, "active spec lock");

assert.equal(lock.lockFormat, 3, "active v0.4 requires lockFormat 3");
assert.equal(lock.authorityVersion, "0.4.0");
assert.equal(lock.authorityStatus, "active");
assert.equal(lock.normative, true);
assert.equal(lock.lockPath, configuredLock);
assert.deepEqual(index.active, {
  version: lock.authorityVersion,
  status: "active",
  normative: true,
  authorityRoot: lock.authorityRoot,
  lockPath: lock.lockPath,
});
assert.deepEqual(index.history, [
  {
    version: "0.3.0",
    status: "historical",
    normative: false,
    authorityRoot: "authority/implementation-spec-v0.3",
    lockPath: "scripts/spec-v0.3-lock.json",
  },
]);
assert.deepEqual(index.historicalDesignInputs, [
  {
    label: "v0.4 publication candidate before atomic promotion",
    status: "historical",
    normative: false,
    executable: false,
    path: "authority/implementation-spec-v0.4/historical-publication-candidate",
  },
]);

assert.equal(
  readJson(resolve(repoRoot, "package.json"), "package.json").version,
  lock.productVersion,
  "package version drifted from the active lock",
);
assert.equal(lock.ruleSetVersion, "mvp.rules.0.2.4");
assert.equal(lock.promptSetVersion, "mvp.prompts.0.2.0");
assert.equal(
  lock.migrationHead,
  "0050_product_profile_keyword_lineage",
);

const openapi = readFileSync(resolve(repoRoot, "openapi/mvp.yaml"), "utf8");
const operations = extractOpenApiOperations(openapi);
exactSet(operations, lock.apiOperations, "OpenAPI operations");
assert.equal(operations.length, 79, "v0.4 must freeze 79 OpenAPI operations");
exactSet(
  lock.asyncOperations,
  [
    "createProductProfileSynthesisRun",
    "importProjectSourceFile",
    "createCollectionRun",
    "createAnalysisRefreshRun",
    "createDiagnosticRun",
    "createGrowthAuditRun",
    "createContentShadowRun",
    "createActionRecheck",
    "createActionArtifact",
    "createProjectExport",
  ],
  "shared async operations",
);
for (const operationId of lock.asyncOperations) {
  assert.match(
    operationBlock(openapi, operationId),
    /'202':\s*(?:\{\s*)?\$ref:\s*'#\/components\/responses\/AsyncAccepted'\s*(?:\}\s*)?/s,
    `${operationId} must retain shared AsyncAccepted`,
  );
}

const migrations = listOrderedMigrationSources({
  root: repoRoot,
  migrationDirectory: lock.migrationDirectory,
  migrationFilePattern: lock.migrationFilePattern,
});
assert.equal(migrations.length, 50, "v0.4 must freeze 50 migrations");
assert.equal(
  migrations.at(-1)?.migrationVersion,
  lock.migrationHead,
  "migration head drifted",
);
const tables = migrationTableInventory(migrations);
exactSet(tables, lock.tables, "application tables");
assert.equal(tables.length, 80, "v0.4 must freeze 80 application tables");

assert.ok(Array.isArray(lock.rules), "rules must be an array");
assert.ok(
  lock.ruleVersions &&
    typeof lock.ruleVersions === "object" &&
    !Array.isArray(lock.ruleVersions),
  "ruleVersions must be an object",
);
exactSet(Object.keys(lock.ruleVersions), lock.rules, "rule version keys");
const rules = diagnosticRules(repoRoot);
assert.equal(rules.length, 12, "v0.4 must freeze 12 diagnostic rules");
exactSet(
  rules.map(({ id }) => id),
  lock.rules,
  "diagnostic rules",
);
for (const { id, version } of rules) {
  assert.equal(
    version,
    lock.ruleVersions[id],
    `${id} rule version drifted from ${lock.ruleVersions[id]}`,
  );
}
assert.equal(lock.ruleVersions["CONTENT-GAP-011"], 2);
assert.equal(lock.ruleVersions["TECH-LINKGRAPH-005"], 3);
assert.equal(lock.ruleVersions["TECH-INDEXABILITY-006"], 1);

assertRequiredHashes(
  lock.authorityFiles,
  requiredAuthorityFiles,
  "authorityFiles",
);
assertRequiredHashes(
  lock.implementationFiles,
  requiredImplementationFiles,
  "implementationFiles",
);

const configuredAuthority = options.authorityRoot ?? lock.authorityRoot;
const authorityRoot = safePath(
  repoRoot,
  configuredAuthority,
  "authority root",
);
assert.ok(existsSync(authorityRoot), "configured authority root does not exist");

for (const [relativePath, expected] of Object.entries(
  lock.implementationFiles,
)) {
  const path = safePath(repoRoot, relativePath, "implementation file");
  assert.ok(existsSync(path), `implementation file is missing: ${relativePath}`);
  assert.equal(
    sha256(path),
    expected,
    `implementation file drifted from active v0.4 lock: ${relativePath}`,
  );
}
for (const [relativePath, expected] of Object.entries(lock.authorityFiles)) {
  const path = safePath(authorityRoot, relativePath, "authority file");
  assert.ok(existsSync(path), `authority file is missing: ${relativePath}`);
  assert.equal(
    sha256(path),
    expected,
    `authority file drifted from active v0.4 lock: ${relativePath}`,
  );
}

runVerifier(
  resolve(repoRoot, "scripts/verify-implementation.mjs"),
  ["--root", repoRoot],
  repoRoot,
  "clone-local implementation verifier",
);
runVerifier(
  resolve(authorityRoot, "scripts/verify-spec.mjs"),
  [
    "--app-root",
    repoRoot,
    "--authority-root",
    authorityRoot,
    "--lock",
    lockPath,
  ],
  repoRoot,
  "active authority verifier",
);

console.log(
  `Spec lock passed: active authority ${lock.authorityVersion}, ${operations.length} operations, ${lock.asyncOperations.length} shared async operations, ${tables.length} tables, ${rules.length} rules.`,
);
