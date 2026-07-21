#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const authorityRoot = path.resolve(scriptDirectory, "..");

function parseArguments(argv) {
  if (argv.length === 0) {
    return { appRoot: path.resolve(authorityRoot, "../..") };
  }
  if (argv.length === 2 && argv[0] === "--app-root" && argv[1]) {
    return { appRoot: path.resolve(argv[1]) };
  }
  throw new Error(
    "usage: node authority/implementation-spec-v0.3/scripts/verify-spec.mjs [--app-root <repository>]",
  );
}

const { appRoot } = parseArguments(process.argv.slice(2));
const readAuthority = (name) =>
  fs.readFileSync(path.join(authorityRoot, name), "utf8");

const files = {
  readme: readAuthority("README.md"),
  spec: readAuthority("MVP-IMPLEMENTATION-SPEC.md"),
  openapi: readAuthority("openapi.yaml"),
  sql: readAuthority("schema.sql"),
  bundleSchema: readAuthority(
    "schemas/service-bundle-manifest.schema.json",
  ),
  schemaSmoke: readAuthority("scripts/schema-smoke.sql"),
};

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
const unique = (values) => [...new Set(values)].sort();
const difference = (left, right) => {
  const rightSet = new Set(right);
  return unique(left).filter((value) => !rightSet.has(value));
};

function exactSet(actual, expected, label) {
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  const duplicates = actual.filter(
    (value, index) => actual.indexOf(value) !== index,
  );
  check(
    missing.length === 0 && extra.length === 0 && duplicates.length === 0,
    `${label} drift (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}; duplicates: ${unique(duplicates).join(", ") || "none"})`,
  );
}

function between(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end);
  check(startIndex >= 0, `missing marker ${start}`);
  check(endIndex > startIndex, `missing marker ${end}`);
  return startIndex >= 0 && endIndex > startIndex
    ? text.slice(startIndex + start.length, endIndex)
    : "";
}

function stripSqlComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ");
}

function applicationMigrationTables() {
  const migrationDirectory = path.join(appRoot, "packages/db/migrations");
  if (!fs.existsSync(migrationDirectory)) {
    failures.push(
      `application migration directory does not exist: ${migrationDirectory}`,
    );
    return [];
  }

  const migrationFiles = fs
    .readdirSync(migrationDirectory)
    .filter((fileName) => /^[0-9]{4}_.+\.sql$/.test(fileName))
    .sort();
  check(
    migrationFiles.length > 0,
    "at least one ordered application migration is required",
  );

  const ordinalOwners = new Map();
  for (const fileName of migrationFiles) {
    const ordinal = fileName.match(/^([0-9]{4})_/)?.[1];
    if (!ordinal) {
      failures.push(`migration lacks a four-digit ordinal: ${fileName}`);
      continue;
    }
    if (ordinalOwners.has(ordinal)) {
      failures.push(
        `duplicate migration ordinal ${ordinal}: ${ordinalOwners.get(ordinal)} and ${fileName}`,
      );
    } else {
      ordinalOwners.set(ordinal, fileName);
    }
  }

  const tableOwners = new Map();
  const tables = [];
  for (const fileName of migrationFiles) {
    const sql = stripSqlComments(
      fs.readFileSync(path.join(migrationDirectory, fileName), "utf8"),
    );
    const createdTables = [
      ...sql.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
      ),
    ].map((match) => match[1]);
    for (const table of createdTables) {
      if (tableOwners.has(table)) {
        failures.push(
          `table ${table} is created by multiple migrations: ${tableOwners.get(table)} and ${fileName}`,
        );
      } else {
        tableOwners.set(table, fileName);
      }
      tables.push(table);
    }
  }
  return tables;
}

check(
  files.spec.includes("status: reviewed-scaffold"),
  "main spec must be a reviewed-scaffold until the v0.3 runtime lock is activated",
);
check(
  files.spec.includes("product_version: 0.3.0"),
  "authority product version must be 0.3.0",
);
check(
  files.spec.includes("contract_version: 2026-07-21"),
  "authority contract version must be 2026-07-21",
);
check(
  files.spec.includes("implemented_surface_version: 0.2.0"),
  "reviewed scaffold must identify the still-implemented 0.2.0 machine surface",
);
check(files.openapi.includes("openapi: 3.1.0"), "OpenAPI must be 3.1.0");
check(
  files.openapi.includes("version: 0.2.0"),
  "scaffold OpenAPI must remain at the implemented 0.2.0 surface until activation",
);
check(
  !files.openapi.includes("bearerAuth"),
  "bearerAuth is forbidden; use same-origin session cookie",
);
check(
  files.openapi.includes("supabaseSessionCookie"),
  "session cookie security scheme missing",
);
check(files.openapi.includes("statusUrl"), "async statusUrl schema missing");
check(files.sql.includes("mvp.rules.0.2.0"), "SQL rule-set version drift");
check(
  files.sql.includes("signalframe.service-bundle.0.2.0"),
  "scaffold SQL export schema must remain at implemented version 0.2.0",
);
check(
  files.sql.includes(
    "origin <> 'generated' OR (analysis_invocation_id IS NOT NULL",
  ),
  "generated evidence lineage check missing",
);
check(
  files.sql.includes("async_runs_one_active_key_idx"),
  "active-run uniqueness index missing",
);
check(
  files.schemaSmoke.includes("ROLLBACK;"),
  "schema smoke test must roll back fixture data",
);
for (const phrase of [
  "unavailable observation with zero was accepted",
  "generated evidence without invocation was accepted",
  "append-only evidence update was accepted",
  "ready artifact without a revision was accepted",
]) {
  check(
    files.schemaSmoke.includes(phrase),
    `PostgreSQL smoke assertion missing: ${phrase}`,
  );
}

let parsedBundleSchema;
try {
  parsedBundleSchema = JSON.parse(files.bundleSchema);
} catch (error) {
  failures.push(`bundle manifest schema is invalid JSON: ${error.message}`);
}
check(
  parsedBundleSchema?.properties?.schemaVersion?.const ===
    "signalframe.service-bundle.0.2.0",
  "scaffold bundle manifest schema must remain at implemented version 0.2.0",
);
check(
  parsedBundleSchema?.properties?.ruleSetVersion?.const === "mvp.rules.0.2.0",
  "bundle manifest rule-set version drift",
);

const declaredOperationBlock = between(
  files.spec,
  "<!-- API_OPERATIONS_START -->",
  "<!-- API_OPERATIONS_END -->",
);
const declaredOperations = [
  ...declaredOperationBlock.matchAll(/^- `([a-z][A-Za-z0-9]+)`/gm),
].map((match) => match[1]);
const openapiOperations = [
  ...files.openapi.matchAll(
    /^\s+operationId:\s*([a-z][A-Za-z0-9]+)\s*$/gm,
  ),
].map((match) => match[1]);
check(
  declaredOperations.length === 26,
  `expected 26 declared API operations, got ${declaredOperations.length}`,
);
check(
  openapiOperations.length === 26,
  `expected 26 OpenAPI operations, got ${openapiOperations.length}`,
);
exactSet(openapiOperations, declaredOperations, "API operations");

const asyncBlock = between(
  files.spec,
  "<!-- ASYNC_OPERATIONS_START -->",
  "<!-- ASYNC_OPERATIONS_END -->",
);
const asyncOperations = [
  ...asyncBlock.matchAll(/^- `([a-z][A-Za-z0-9]+)`/gm),
].map((match) => match[1]);
check(
  asyncOperations.length === 5,
  `expected 5 async operations, got ${asyncOperations.length}`,
);
for (const operationId of asyncOperations) {
  const marker = `operationId: ${operationId}`;
  const start = files.openapi.indexOf(marker);
  const next = files.openapi.indexOf("operationId:", start + marker.length);
  const operationText = files.openapi.slice(
    start,
    next === -1 ? files.openapi.length : next,
  );
  check(start >= 0, `async operation ${operationId} missing from OpenAPI`);
  check(
    /'202':/.test(operationText),
    `async operation ${operationId} has no 202 response`,
  );
  check(
    /AsyncAccepted/.test(operationText),
    `async operation ${operationId} does not use AsyncAccepted`,
  );
}

const tableBlock = between(
  files.spec,
  "<!-- TABLES_START -->",
  "<!-- TABLES_END -->",
);
const declaredTables = [
  ...tableBlock.matchAll(/^- `([a-z][a-z0-9_]+)`/gm),
].map((match) => match[1]);
const sqlTables = [
  ...stripSqlComments(files.sql).matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
  ),
].map((match) => match[1]);
const appTables = applicationMigrationTables();
check(
  declaredTables.length === 28,
  `expected 28 declared tables, got ${declaredTables.length}`,
);
check(
  sqlTables.length === declaredTables.length,
  `expected ${declaredTables.length} SQL tables, got ${sqlTables.length}`,
);
exactSet(sqlTables, declaredTables, "authority SQL tables");
exactSet(appTables, declaredTables, "application migration tables");

const mvpRules = unique(
  [
    ...files.spec.matchAll(
      /`((?:TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3})@1`/g,
    ),
  ].map((match) => match[1]),
);
check(
  mvpRules.length === 11,
  `expected 11 frozen MVP rules, got ${mvpRules.length}`,
);
for (const prefix of ["TECH", "SEARCH", "CONTENT", "CRO", "GEO"]) {
  check(
    mvpRules.some((rule) => rule.startsWith(`${prefix}-`)),
    `rule domain ${prefix} is empty`,
  );
}

const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
for (const [fileName, source] of [
  ["README.md", files.readme],
  ["MVP-IMPLEMENTATION-SPEC.md", files.spec],
]) {
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1].split("#", 1)[0];
    if (
      !target ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("#")
    ) {
      continue;
    }
    check(
      fs.existsSync(path.resolve(authorityRoot, target)),
      `${fileName}: broken local link ${match[1]}`,
    );
  }
}

for (const phrase of [
  "phase=authorize",
  "phase=select_property",
  "mode=preview",
  "mode=confirm",
  "baseRevision",
  "outputLocale",
  "同一 DB transaction",
  "DataForSEO",
  "RBAC",
  "Billing",
  "Capability Lenses",
  "Opportunity table",
  "second Action creation path",
  "performance_checkpoints",
  "CMS publishing",
  "content lifecycle",
  "reviewed Slice 1 change sequence",
  "Project → Source/Snapshot/Observation → Evidence → Finding → Finding Review → Action → Artifact Revision → Approval/Authorized Delivery → Recheck/Outcome → Results",
]) {
  check(
    files.spec.includes(phrase),
    `required implementation decision missing: ${phrase}`,
  );
}

if (failures.length > 0) {
  console.error(`Spec verification failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("GenGrowth v0.3 reviewed authority scaffold verified.");
console.log(`- API operations: ${openapiOperations.length}`);
console.log(`- Async operations: ${asyncOperations.length}`);
console.log(`- PostgreSQL application tables: ${appTables.length}`);
console.log(`- Frozen diagnostic rules: ${mvpRules.length}`);
console.log("- Current implemented machine surface: 0.2.0");
console.log("- Service bundle manifest schema: valid JSON and version-aligned");
console.log("- PostgreSQL smoke assertions: present and rollback-safe");
console.log("- Local Markdown links: valid");
