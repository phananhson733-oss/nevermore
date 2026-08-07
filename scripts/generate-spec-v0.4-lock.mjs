#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractOpenApiOperations,
  listOrderedMigrationSources,
  migrationTableInventory,
} from "./spec-authority-lib.mjs";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const lockPath = "scripts/spec-v0.4-lock.json";
const authorityRoot = "authority/implementation-spec-v0.4";

const authorityFiles = [
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

const implementationFiles = [
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

const asyncOperations = [
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
];

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function sha256(relativePath) {
  return createHash("sha256")
    .update(readFileSync(resolve(repositoryRoot, relativePath)))
    .digest("hex");
}

function hashMap(base, paths) {
  return Object.fromEntries(
    paths.map((relativePath) => [
      relativePath,
      sha256(join(base, relativePath)),
    ]),
  );
}

function diagnosticRules() {
  const ruleDirectory = resolve(
    repositoryRoot,
    "packages/engine/src/rules",
  );
  const pattern =
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*Rule)\s*=\s*\{([\s\S]*?)\}\s+satisfies\s+DiagnosticRule\s*;/g;
  const rulesByIdentifier = new Map();
  for (const name of readdirSync(ruleDirectory).sort()) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const source = readFileSync(join(ruleDirectory, name), "utf8");
    for (const match of source.matchAll(pattern)) {
      const id = match[2].match(
        /^\s*id:\s*["']((?:TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3})["']\s*,/m,
      )?.[1];
      const version = Number(
        match[2].match(/^\s*version:\s*([0-9]+)\s*,/m)?.[1],
      );
      assert.ok(id, `${name} ${match[1]} is missing its rule id`);
      assert.ok(
        Number.isInteger(version) && version > 0,
        `${id} is missing a positive rule version`,
      );
      assert.ok(
        !rulesByIdentifier.has(match[1]),
        `duplicate diagnostic rule export: ${match[1]}`,
      );
      rulesByIdentifier.set(match[1], { id, version });
    }
  }

  const registrySource = readFileSync(
    join(ruleDirectory, "index.ts"),
    "utf8",
  );
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
    "ALL_RULES contains duplicate rule exports",
  );
  assert.deepEqual(
    new Set(identifiers),
    new Set(rulesByIdentifier.keys()),
    "ALL_RULES must enumerate every and only shipped diagnostic rule",
  );
  return identifiers.map((identifier) => rulesByIdentifier.get(identifier));
}

const packageJson = JSON.parse(read("package.json"));
const health = read("packages/contracts/src/zod/health.ts");
const contractVersion = health.match(
  /CONTRACT_VERSION\s*=\s*"([^"]+)"/,
)?.[1];
assert.ok(contractVersion, "health contract version is missing");

const registry = read("packages/engine/src/registry.ts");
const ruleSetVersion = registry.match(
  /RULE_SET_VERSION\s*=\s*"([^"]+)"/,
)?.[1];
const promptSetVersion = registry.match(
  /PROMPT_SET_VERSION\s*=\s*"([^"]+)"/,
)?.[1];
assert.equal(ruleSetVersion, "mvp.rules.0.2.4");
assert.equal(promptSetVersion, "mvp.prompts.0.2.0");

const openapi = read("openapi/mvp.yaml");
const apiOperations = extractOpenApiOperations(openapi);
assert.equal(apiOperations.length, 79, "reviewed v0.4 operation count drift");
for (const operationId of asyncOperations) {
  assert.ok(
    apiOperations.includes(operationId),
    `shared async operation is absent from OpenAPI: ${operationId}`,
  );
}

const migrations = listOrderedMigrationSources({ root: repositoryRoot });
const tables = migrationTableInventory(migrations);
assert.equal(migrations.length, 45, "reviewed v0.4 migration count drift");
assert.equal(
  migrations.at(-1)?.migrationVersion,
  "0045_dataforseo_backlink_target_lineage",
  "0046_workspace_plan_tier",
  "reviewed v0.4 migration head drift",
);
assert.equal(tables.length, 78, "reviewed v0.4 table count drift");

const ruleContracts = diagnosticRules();
assert.equal(ruleContracts.length, 12, "reviewed v0.4 rule count drift");
const ruleVersions = Object.fromEntries(
  ruleContracts.map(({ id, version }) => [id, version]),
);
assert.equal(ruleVersions["CONTENT-GAP-011"], 2);
assert.equal(ruleVersions["TECH-LINKGRAPH-005"], 3);
assert.equal(ruleVersions["TECH-INDEXABILITY-006"], 1);

const lock = {
  lockFormat: 3,
  authorityVersion: "0.4.0",
  authorityStatus: "active",
  normative: true,
  productVersion: packageJson.version,
  contractVersion,
  ruleSetVersion,
  promptSetVersion,
  authorityRoot,
  lockPath,
  migrationDirectory: "packages/db/migrations",
  migrationFilePattern: "^[0-9]{4}_.+\\.sql$",
  migrationHead: migrations.at(-1).migrationVersion,
  authorityFiles: hashMap(authorityRoot, authorityFiles),
  implementationFiles: hashMap("", implementationFiles),
  apiOperations,
  asyncOperations,
  tables,
  rules: ruleContracts.map(({ id }) => id),
  ruleVersions,
};

writeFileSync(
  resolve(repositoryRoot, lockPath),
  `${JSON.stringify(lock, null, 2)}\n`,
);
console.log(
  `Generated ${lockPath}: ${apiOperations.length} operations, ${asyncOperations.length} shared async operations, ${tables.length} tables, ${ruleContracts.length} rules.`,
);
