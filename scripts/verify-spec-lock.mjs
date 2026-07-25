#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
  "scripts/verify-spec.mjs",
];

const requiredImplementationFiles = [
  "openapi/mvp.yaml",
  "packages/contracts/src/generated/openapi.ts",
  "schemas/service-bundle-manifest.schema.json",
  "packages/db/migrations/schema-smoke.sql",
  "scripts/verify-implementation.mjs",
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
      "usage: node scripts/verify-spec-lock.mjs [--root <repository>] [--lock <path>] [--authority-root <path>]",
    );
    if (flag === "--root") options.root = resolve(value);
    if (flag === "--lock") options.lock = value;
    if (flag === "--authority-root") options.authorityRoot = value;
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const repoRoot = options.root;

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

const lockPath = safePath(
  repoRoot,
  options.lock ?? "scripts/spec-v0.3-lock.json",
  "spec lock path",
);
assert.ok(existsSync(lockPath), `spec lock does not exist: ${lockPath}`);
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
assert.ok([1, 2].includes(lock.lockFormat), "unsupported spec lock format");
if (lock.lockFormat === 1) {
  assert.fail(
    `lockFormat 2 is required for product version ${lock.productVersion}; legacy lockFormat 1 cannot verify activated v0.3 authority or implementation equality`,
  );
}

function fromRoot(relativePath) {
  return safePath(repoRoot, relativePath, relativePath);
}

function read(relativePath) {
  return readFileSync(fromRoot(relativePath), "utf8");
}

function sorted(values) {
  return [...new Set(values)].sort();
}

function assertSameSet(actual, expected, label) {
  assert.deepEqual(
    sorted(actual),
    sorted(expected),
    `${label} drifted from the frozen spec lock`,
  );
}

function assertUnique(values, label) {
  const duplicates = values.filter(
    (value, index) => values.indexOf(value) !== index,
  );
  assert.deepEqual(
    sorted(duplicates),
    [],
    `${label} contains duplicate entries`,
  );
}

function assertRequiredHashes(value, requiredPaths, label) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `lockFormat 2 requires ${label} hashes`,
  );
  for (const relativePath of requiredPaths) {
    assert.equal(
      typeof value[relativePath],
      "string",
      `${label} is missing ${relativePath}`,
    );
  }
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

function stripSqlComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ");
}

function diagnosticRules() {
  const rulesDirectory = fromRoot("packages/engine/src/rules");
  const ruleExportPattern =
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*Rule)\s*=\s*\{([\s\S]*?)\}\s+satisfies\s+DiagnosticRule\s*;/g;
  const rules = [];

  for (const name of readdirSync(rulesDirectory)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const source = readFileSync(join(rulesDirectory, name), "utf8");
    for (const match of source.matchAll(ruleExportPattern)) {
      const exportName = match[1];
      const definition = match[2];
      const id = definition.match(
        /^\s*id:\s*["']((?:TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3})["']\s*,/m,
      )?.[1];
      const version = definition.match(/^\s*version:\s*([0-9]+)\s*,/m)?.[1];
      assert.ok(id, `${name} ${exportName} is missing a frozen rule id`);
      assert.ok(version, `${name} ${exportName} is missing a numeric rule version`);
      rules.push({ id, version: Number(version) });
    }
  }

  assert.ok(rules.length > 0, "at least one exported diagnostic rule is required");
  return rules;
}

function migrationTables() {
  const migrationDirectory = safePath(
    repoRoot,
    lock.migrationDirectory ?? "packages/db/migrations",
    "migration directory",
  );
  assert.ok(
    existsSync(migrationDirectory),
    `migration directory does not exist: ${migrationDirectory}`,
  );
  const migrationFilePattern = new RegExp(
    lock.migrationFilePattern ?? "^[0-9]{4}_.+\\.sql$",
  );
  const migrationFiles = readdirSync(migrationDirectory)
    .filter((fileName) => migrationFilePattern.test(fileName))
    .sort();
  assert.ok(migrationFiles.length > 0, "at least one ordered migration is required");

  const filesByOrdinal = new Map();
  for (const fileName of migrationFiles) {
    const ordinal = fileName.match(/^([0-9]{4})_/)?.[1];
    assert.ok(ordinal, `migration lacks a four-digit ordinal: ${fileName}`);
    assert.ok(
      !filesByOrdinal.has(ordinal),
      `duplicate migration ordinal ${ordinal}: ${filesByOrdinal.get(ordinal)} and ${fileName}`,
    );
    filesByOrdinal.set(ordinal, fileName);
  }

  const tableOwners = new Map();
  const tables = [];
  for (const fileName of migrationFiles) {
    const sql = stripSqlComments(
      readFileSync(join(migrationDirectory, fileName), "utf8"),
    );
    const createdTables = [
      ...sql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
      ),
    ].map((match) => match[1]);
    for (const table of createdTables) {
      assert.ok(
        !tableOwners.has(table),
        `table ${table} is created by multiple migrations: ${tableOwners.get(table)} and ${fileName}`,
      );
      tableOwners.set(table, fileName);
      tables.push(table);
    }
  }
  return tables;
}

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

const tables = migrationTables();
assertSameSet(tables, lock.tables, "application tables");

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

assert.ok(Array.isArray(lock.rules), "rules must be an array");
assert.ok(lock.rules.length > 0, "at least one frozen diagnostic rule is required");
for (const [index, ruleId] of lock.rules.entries()) {
  assert.equal(typeof ruleId, "string", `rules[${index}] must be a string`);
}
assertUnique(lock.rules, "frozen diagnostic rules");
assert.ok(
  lock.ruleVersions &&
    typeof lock.ruleVersions === "object" &&
    !Array.isArray(lock.ruleVersions),
  "lockFormat 2 requires ruleVersions",
);
assertSameSet(
  Object.keys(lock.ruleVersions),
  lock.rules,
  "diagnostic rule version keys",
);
for (const [ruleId, version] of Object.entries(lock.ruleVersions)) {
  assert.ok(
    Number.isInteger(version) && version > 0,
    `${ruleId} frozen rule version must be a positive integer`,
  );
}

const rules = diagnosticRules();
const ruleIds = rules.map((rule) => rule.id);
assertUnique(ruleIds, "exported diagnostic rules");
assertSameSet(ruleIds, lock.rules, "diagnostic rules");
for (const rule of rules) {
  assert.equal(
    rule.version,
    lock.ruleVersions[rule.id],
    `${rule.id} rule version drifted from frozen version ${lock.ruleVersions[rule.id]}`,
  );
}

/**
 * The counts the authority states IN PROSE, checked against the lock.
 *
 * Every machine surface here was already compared four ways — the lock, both
 * verifiers and the marker registry all agreed on 49 operations. The authority's
 * own narrative said 47 in four places, and had said so since the commit that
 * moved the lock from 47 to 48 without touching the text. Nothing read the
 * prose, so nothing went red: the project's freezing criterion was literally
 * false while every gate stayed green.
 *
 * A number a reader is given is a claim the repository makes. This is the gate
 * that makes the narrative fail like code when it drifts.
 *
 * Each label must match at least once. That is deliberate: if a sentence is
 * reworded past these patterns the check fails rather than quietly verifying
 * nothing, which is the same "we did not look" -> "we found nothing"
 * substitution this repository keeps having to remove.
 */
const PROSE_COUNT_CLAIMS = [
  ["API operations", () => lock.apiOperations.length, [
    /(\d+)\s*个\s*operation\b/g,
    /(\d+)\s+operationId\b/g,
  ]],
  ["async operations", () => lock.asyncOperations.length, [
    /(\d+)\s*个\s*async\s+operation\b/g,
    /(\d+)\s+async\s+operation\b/g,
  ]],
  ["application tables", () => lock.tables.length, [
    /(\d+)\s*张应用表/g,
    /(\d+)\s+table\b/g,
  ]],
  ["diagnostic rules", () => lock.rules.length, [/(\d+)\s*条规则/g]],
];

function assertProseCountsMatchLock(label, sources) {
  for (const [claim, expected, patterns] of PROSE_COUNT_CLAIMS) {
    const found = [];
    for (const [name, text] of sources) {
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          found.push({ name, value: Number(match[1]), quote: match[0] });
        }
      }
    }
    assert.ok(
      found.length > 0,
      `${label} states no ${claim} count any more; the prose-vs-lock check cannot verify what it cannot find, so update the patterns in verify-spec-lock.mjs deliberately`,
    );
    for (const hit of found) {
      assert.equal(
        hit.value,
        expected(),
        `${hit.name} says "${hit.quote}" but the frozen spec lock declares ${expected()} ${claim}`,
      );
    }
  }
}

const configuredAuthority =
  options.authorityRoot ??
  lock.authorityRoot ??
  resolve(repoRoot, "../signalframe-mvp/implementation-spec-v0.2");
const authorityRoot = isAbsolute(configuredAuthority)
  ? resolve(configuredAuthority)
  : safePath(repoRoot, configuredAuthority, "authority root");
const authorityAvailable = existsSync(authorityRoot);
const authorityIsRequired =
  options.authorityRoot !== undefined || lock.authorityRoot !== undefined;
if (authorityIsRequired) {
  assert.ok(authorityAvailable, "configured authority root does not exist");
}

for (const [relativePath, expectedHash] of Object.entries(
  lock.implementationFiles,
)) {
  const implementationPath = fromRoot(relativePath);
  assert.ok(
    existsSync(implementationPath),
    `implementation file is missing: ${relativePath}`,
  );
  assert.equal(
    sha256(implementationPath),
    expectedHash,
    `implementation file drifted from the frozen ${lock.productVersion} lock: ${relativePath}`,
  );
}

const implementationVerifier = fromRoot("scripts/verify-implementation.mjs");
const implementationVerification = spawnSync(
  process.execPath,
  [implementationVerifier, "--root", repoRoot],
  { cwd: repoRoot, encoding: "utf8" },
);
if (implementationVerification.stdout) {
  process.stdout.write(implementationVerification.stdout);
}
if (implementationVerification.stderr) {
  process.stderr.write(implementationVerification.stderr);
}
assert.equal(
  implementationVerification.status,
  0,
  "clone-local implementation verifier failed",
);

if (authorityAvailable) {
  for (const [relativePath, expectedHash] of Object.entries(lock.authorityFiles)) {
    const sourcePath = safePath(authorityRoot, relativePath, "authority file");
    assert.ok(existsSync(sourcePath), `authority file is missing: ${relativePath}`);
    assert.equal(
      sha256(sourcePath),
      expectedHash,
      `authority file drifted from the reviewed ${lock.productVersion} lock: ${relativePath}`,
    );
  }
  if (lock.lockFormat >= 2) {
    for (const [authorityPath, implementationPath] of [
      ["openapi.yaml", "openapi/mvp.yaml"],
      [
        "schemas/service-bundle-manifest.schema.json",
        "schemas/service-bundle-manifest.schema.json",
      ],
      ["scripts/schema-smoke.sql", "packages/db/migrations/schema-smoke.sql"],
    ]) {
      assert.equal(
        sha256(safePath(authorityRoot, authorityPath, "authority file")),
        sha256(fromRoot(implementationPath)),
        `authority ${authorityPath} differs from implementation ${implementationPath}`,
      );
    }
  }
  const authorityVerifier = safePath(
    authorityRoot,
    "scripts/verify-spec.mjs",
    "authority verifier",
  );
  const authorityArguments = [authorityVerifier];
  if (lock.lockFormat >= 2) {
    authorityArguments.push("--app-root", repoRoot);
  }
  const verification = spawnSync(process.execPath, authorityArguments, {
    encoding: "utf8",
  });
  if (verification.stdout) process.stdout.write(verification.stdout);
  if (verification.stderr) process.stderr.write(verification.stderr);
  assert.equal(
    verification.status,
    0,
    "authoritative implementation-spec verifier failed",
  );
  assertProseCountsMatchLock("the authority narrative", [
    [
      "MVP-IMPLEMENTATION-SPEC.md",
      readFileSync(
        safePath(authorityRoot, "MVP-IMPLEMENTATION-SPEC.md", "authority file"),
        "utf8",
      ),
    ],
    [
      "README.md",
      readFileSync(
        safePath(authorityRoot, "README.md", "authority file"),
        "utf8",
      ),
    ],
  ]);
  console.log(
    "Frozen spec source hashes match the reviewed authority snapshot, and its prose counts match the lock.",
  );
} else {
  console.log(
    `Authority checkout absent; verified the clone-local pinned ${lock.productVersion} contract lock.`,
  );
}

console.log(
  `Spec lock passed: ${operations.length} operations, ${lock.asyncOperations.length} async operations, ${tables.length} tables, ${rules.length} rules.`,
);
