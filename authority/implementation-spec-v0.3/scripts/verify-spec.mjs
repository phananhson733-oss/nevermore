#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const authorityRoot = path.resolve(scriptDirectory, "..");
const PRODUCT_VERSION = "0.3.0";
const CONTRACT_VERSION = "2026-07-21";
const BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.3.0";
const HISTORICAL_BUNDLE_SCHEMA_VERSION = "signalframe.service-bundle.0.2.0";
const RULE_SET_VERSION = "mvp.rules.0.2.0";
const PROMPT_SET_VERSION = "mvp.prompts.0.2.0";
const EXPECTED_TABLE_COUNT = 33;
const SLICE_1_TABLES = [
  "capability_runs",
  "audit_runs",
  "audit_module_results",
  "site_pages",
  "page_snapshots",
];

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
  files.spec.includes("status: activated"),
  "main spec must identify the activated v0.3 machine surface",
);
check(
  files.spec.includes(`product_version: ${PRODUCT_VERSION}`),
  `authority product version must be ${PRODUCT_VERSION}`,
);
check(
  files.spec.includes(`contract_version: ${CONTRACT_VERSION}`),
  `authority contract version must be ${CONTRACT_VERSION}`,
);
check(
  files.spec.includes(`implemented_surface_version: ${PRODUCT_VERSION}`),
  `authority must identify the implemented ${PRODUCT_VERSION} machine surface`,
);
check(files.openapi.includes("openapi: 3.1.0"), "OpenAPI must be 3.1.0");
check(
  files.openapi.includes(`version: ${PRODUCT_VERSION}`),
  `OpenAPI must expose the activated ${PRODUCT_VERSION} surface`,
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
const exportBundleBlock = between(
  files.openapi,
  "    ExportBundle:",
  "    ExportResponse:",
);
const readableBundleSchemaVersions = [
  ...exportBundleBlock.matchAll(
    /^\s+-\s+(signalframe\.service-bundle\.[0-9]+\.[0-9]+\.[0-9]+)\s*$/gm,
  ),
].map((match) => match[1]);
exactSet(
  readableBundleSchemaVersions,
  [HISTORICAL_BUNDLE_SCHEMA_VERSION, BUNDLE_SCHEMA_VERSION],
  "OpenAPI readable export bundle schema versions",
);
check(files.sql.includes(RULE_SET_VERSION), "SQL rule-set version drift");
check(files.sql.includes(PROMPT_SET_VERSION), "SQL prompt-set version drift");
check(
  files.sql.includes(`DEFAULT '${BUNDLE_SCHEMA_VERSION}'`),
  `SQL export schema must default to ${BUNDLE_SCHEMA_VERSION}`,
);
check(
  files.sql.includes(HISTORICAL_BUNDLE_SCHEMA_VERSION) &&
    files.sql.includes(BUNDLE_SCHEMA_VERSION),
  "SQL export schema must preserve historical 0.2.0 rows while accepting current 0.3.0 rows",
);
check(
  files.sql.includes(`DEFAULT '${CONTRACT_VERSION}'`),
  `SQL async-run contract version must default to ${CONTRACT_VERSION}`,
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
for (const databaseObject of [
  "CREATE OR REPLACE FUNCTION app.reject_async_run_terminal_transition()",
  "CREATE TRIGGER async_runs_terminal_status_immutable",
  "CREATE OR REPLACE FUNCTION app.enforce_export_bundle_invariants()",
  "ADD CONSTRAINT export_bundles_object_key_invariant",
  "CREATE TRIGGER export_bundles_invariant_guard",
  "CREATE OR REPLACE FUNCTION app.is_bcp47_language_tag(candidate text)",
  "CREATE OR REPLACE FUNCTION app.are_bcp47_language_tags(candidates text[])",
]) {
  check(
    files.sql.includes(databaseObject),
    `cumulative database invariant missing: ${databaseObject}`,
  );
}
for (const constraint of [
  "client_projects_default_delivery_locale_check",
  "sites_language_codes_bcp47_check",
  "diagnostic_runs_output_locale_check",
  "findings_summary_locale_check",
  "actions_content_locale_check",
  "execution_artifacts_output_locale_check",
  "artifact_revisions_output_locale_check",
  "export_bundles_output_locale_check",
]) {
  check(
    files.sql.includes(`ADD CONSTRAINT ${constraint}`),
    `cumulative BCP 47 constraint missing: ${constraint}`,
  );
}
check(
  files.schemaSmoke.includes("ROLLBACK;"),
  "schema smoke test must roll back fixture data",
);
for (const phrase of [
  "expected exactly 33 app tables",
  "unavailable observation with zero was accepted",
  "generated evidence without invocation was accepted",
  "append-only evidence update was accepted",
  "ready artifact without a revision was accepted",
  "duplicate audit module result was accepted",
  "capability run mutation was accepted",
  "audit run mutation was accepted",
  "audit module result mutation was accepted",
  "page snapshot mutation was accepted",
  "growth audit projection introduced a second status",
  "async run contract-version default is stale",
  "export bundle schema-version compatibility is stale",
  "database migration version projection is stale",
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
    BUNDLE_SCHEMA_VERSION,
  `bundle manifest schema must expose ${BUNDLE_SCHEMA_VERSION}`,
);
check(
  parsedBundleSchema?.properties?.productVersion?.const === PRODUCT_VERSION,
  `bundle manifest product version must be ${PRODUCT_VERSION}`,
);
check(
  parsedBundleSchema?.properties?.contractVersion?.const === CONTRACT_VERSION,
  `bundle manifest contract version must be ${CONTRACT_VERSION}`,
);
check(
  parsedBundleSchema?.properties?.ruleSetVersion?.const === RULE_SET_VERSION,
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
  declaredTables.length === EXPECTED_TABLE_COUNT,
  `expected ${EXPECTED_TABLE_COUNT} declared tables, got ${declaredTables.length}`,
);
check(
  sqlTables.length === declaredTables.length,
  `expected ${declaredTables.length} SQL tables, got ${sqlTables.length}`,
);
exactSet(sqlTables, declaredTables, "authority SQL tables");
exactSet(appTables, declaredTables, "application migration tables");
for (const tableName of SLICE_1_TABLES) {
  check(
    declaredTables.includes(tableName),
    `required Slice 1 table missing: ${tableName}`,
  );
}

const sqlWithoutComments = stripSqlComments(files.sql);
const tableDefinition = (tableName) => {
  const marker = `CREATE TABLE IF NOT EXISTS app.${tableName}`;
  const start = sqlWithoutComments.indexOf(marker);
  check(start >= 0, `${tableName} table definition missing from authority SQL`);
  const next = sqlWithoutComments.indexOf(
    "CREATE TABLE IF NOT EXISTS app.",
    start + marker.length,
  );
  return start >= 0
    ? sqlWithoutComments.slice(start, next === -1 ? undefined : next)
    : "";
};
const capabilityRuns = tableDefinition("capability_runs");
check(
  /async_run_id\s+uuid\s+PRIMARY KEY\s+REFERENCES\s+app\.async_runs\(id\)\s+ON DELETE RESTRICT/i.test(
    capabilityRuns,
  ),
  "capability_runs must extend canonical async_runs through an ON DELETE RESTRICT primary key",
);
check(
  !/^\s*status\s+/im.test(capabilityRuns),
  "capability_runs must not create a second status lifecycle",
);
const auditRuns = tableDefinition("audit_runs");
check(
  /REFERENCES\s+app\.diagnostic_runs\(id\)\s+ON DELETE RESTRICT/i.test(
    auditRuns,
  ) &&
    /REFERENCES\s+app\.capability_runs\(async_run_id\)\s+ON DELETE RESTRICT/i.test(
      auditRuns,
    ),
  "audit_runs must retain RESTRICT lineage to diagnostic and capability runs",
);
check(
  !/^\s*status\s+/im.test(auditRuns),
  "audit_runs must not create a second status lifecycle",
);
check(
  /CHECK\s*\(diagnostic_run_id\s*=\s*capability_run_id\)/i.test(auditRuns),
  "audit_runs must bind diagnostic and capability projections to the same canonical run",
);
const pageSnapshots = tableDefinition("page_snapshots");
check(
  /data_snapshot_id\s+uuid\s+NOT NULL\s+REFERENCES\s+app\.data_snapshots\(id\)\s+ON DELETE RESTRICT/i.test(
    pageSnapshots,
  ),
  "page_snapshots must retain RESTRICT lineage to canonical data snapshots",
);
for (const triggerName of [
  "audit_runs_provenance_guard",
  "site_pages_provenance_guard",
  "page_snapshots_provenance_guard",
  "capability_runs_append_only",
  "audit_runs_append_only",
  "audit_module_results_append_only",
  "page_snapshots_append_only",
]) {
  check(
    new RegExp(`CREATE\\s+TRIGGER\\s+${triggerName}\\b`, "i").test(
      sqlWithoutComments,
    ),
    `append-only trigger missing: ${triggerName}`,
  );
}
check(
  /CREATE\s+TRIGGER\s+site_pages_set_updated_at\b/i.test(sqlWithoutComments),
  "site_pages updated_at trigger missing",
);

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

console.log("GenGrowth v0.3 activated authority verified.");
console.log(`- API operations: ${openapiOperations.length}`);
console.log(`- Async operations: ${asyncOperations.length}`);
console.log(`- PostgreSQL application tables: ${appTables.length}`);
console.log(`- Frozen diagnostic rules: ${mvpRules.length}`);
console.log(`- Current implemented machine surface: ${PRODUCT_VERSION}`);
console.log("- Service bundle manifest schema: valid JSON and version-aligned");
console.log("- PostgreSQL smoke assertions: present and rollback-safe");
console.log("- Local Markdown links: valid");
