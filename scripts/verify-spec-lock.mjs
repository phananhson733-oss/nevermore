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
  options.lock ?? "scripts/spec-v0.2-lock.json",
  "spec lock path",
);
assert.ok(existsSync(lockPath), `spec lock does not exist: ${lockPath}`);
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
assert.ok([1, 2].includes(lock.lockFormat), "unsupported spec lock format");

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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function stripSqlComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ");
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

const rulesDir = fromRoot("packages/engine/src/rules");
const rules = readdirSync(rulesDir)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .flatMap((name) => [
    ...readFileSync(join(rulesDir, name), "utf8").matchAll(
      /\bid:\s*"((?:TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3})"/g,
    ),
  ])
  .map((match) => match[1]);
assertSameSet(rules, lock.rules, "diagnostic rules");

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
  console.log("Frozen spec source hashes match the reviewed authority snapshot.");
} else {
  console.log(
    `Authority checkout absent; verified the clone-local pinned ${lock.productVersion} contract lock.`,
  );
}

console.log(
  `Spec lock passed: ${operations.length} operations, ${lock.asyncOperations.length} async operations, ${tables.length} tables, ${rules.length} rules.`,
);
