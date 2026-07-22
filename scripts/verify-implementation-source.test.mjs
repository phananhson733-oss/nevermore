import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const verifier = readFileSync(
  resolve(scriptDirectory, "verify-implementation.mjs"),
  "utf8",
);

test("derives the migration table count from the expected table contract", () => {
  assert.match(verifier, /tables\.length\s*===\s*EXPECTED_TABLES\.length/);
  assert.match(
    verifier,
    /expected \$\{EXPECTED_TABLES\.length\} app tables in the migrations/,
  );
  assert.match(
    verifier,
    /database: \$\{EXPECTED_TABLES\.length\} app tables \(pg-boss excluded\)/,
  );
  assert.doesNotMatch(verifier, /tables\.length\s*===\s*28/);
});

test("freezes the activated v0.3 machine versions without bumping rules or prompts", () => {
  assert.match(verifier, /const PRODUCT_VERSION = "0\.3\.0";/);
  assert.match(verifier, /const CONTRACT_VERSION = "2026-07-21";/);
  assert.match(
    verifier,
    /const BUNDLE_SCHEMA_VERSION = "signalframe\.service-bundle\.0\.3\.0";/,
  );
  assert.match(verifier, /const RULE_SET_VERSION = "mvp\.rules\.0\.2\.1";/);
  assert.match(verifier, /\["TECH-HTTP-001", 2\]/);
  assert.match(verifier, /\["TECH-CANONICAL-002", 2\]/);
  assert.match(verifier, /\["TECH-LINKGRAPH-005", 2\]/);
  assert.match(verifier, /const PROMPT_SET_VERSION = "mvp\.prompts\.0\.2\.0";/);
});

test("freezes the eight traceability persistence tables in the 36-table contract", () => {
  for (const table of [
    "capability_runs",
    "audit_runs",
    "audit_module_results",
    "site_pages",
    "page_snapshots",
    "product_profile_runs",
    "product_profile_invocation_attempts",
    "finding_targets",
  ]) {
    assert.match(verifier, new RegExp(`"${table}"`));
  }
  const expectedTablesBlock = verifier.match(
    /const EXPECTED_TABLES = \[([\s\S]*?)\n\];/,
  );
  assert.ok(expectedTablesBlock);
  assert.equal(
    [...expectedTablesBlock[1].matchAll(/^\s+"[a-z][a-z0-9_]*",$/gm)].length,
    36,
  );
});

test("freezes the 32 implemented operations and six async commands", () => {
  for (const operationId of [
    "getProjectProductProfile",
    "updateProductProfileDraft",
    "createProductProfileSynthesisRun",
    "reviewProductProfileCompetitor",
    "addProductProfileCompetitor",
    "confirmProductProfile",
  ]) {
    assert.match(verifier, new RegExp(`"${operationId}"`));
  }
  assert.match(
    verifier,
    /expected \$\{EXPECTED_OPENAPI_OPERATIONS\.length\} OpenAPI operations, found \$\{operationIds\.length\}/,
  );
  assert.match(
    verifier,
    /expected \$\{EXPECTED_ASYNC_OPERATIONS\.length\} async 202 operations, found \$\{asyncOperations\.length\}/,
  );
  assert.match(
    verifier,
    /OpenAPI: \$\{EXPECTED_OPENAPI_OPERATIONS\.length\} operations, \$\{EXPECTED_ASYNC_OPERATIONS\.length\} shared 202 statusUrl operations/,
  );
  assert.match(
    verifier,
    /async runtime: \$\{EXPECTED_ASYNC_ROUTE_IMPLEMENTATIONS\.length\} route handlers use the shared asyncAccepted envelope/,
  );
});

test("gates Slice 1 persistence on canonical provenance and immutability", () => {
  for (const guard of [
    "audit_runs_provenance_guard",
    "site_pages_provenance_guard",
    "page_snapshots_provenance_guard",
    "capability_runs_append_only",
    "audit_runs_append_only",
    "audit_module_results_append_only",
    "page_snapshots_append_only",
    "finding_targets_lineage_guard",
    "finding_targets_append_only",
  ]) {
    assert.match(verifier, new RegExp(`"${guard}"`));
  }
  for (const invariant of [
    "page_snapshots_verified_source_identity_idx",
    "canonical_extract_json",
    "source_captured_at",
    "retained application bytes",
  ]) {
    assert.match(verifier, new RegExp(invariant));
  }
});

test("gates every integration file on a safe latest-schema database bootstrap", () => {
  assert.match(
    verifier,
    /must import runMigrations from migrate\.ts/,
  );
  assert.match(
    verifier,
    /must bind requireSafeTestDatabaseUrl\(process\.env\["DATABASE_URL"\]\) before schema bootstrap/,
  );
  assert.match(
    verifier,
    /must migrate only the URL returned by requireSafeTestDatabaseUrl/,
  );
  assert.match(
    verifier,
    /validates DATABASE_URL and migrates the disposable database/,
  );
});
