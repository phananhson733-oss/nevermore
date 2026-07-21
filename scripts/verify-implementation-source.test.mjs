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
  assert.match(verifier, /const RULE_SET_VERSION = "mvp\.rules\.0\.2\.0";/);
  assert.match(verifier, /const PROMPT_SET_VERSION = "mvp\.prompts\.0\.2\.0";/);
});

test("freezes the five Slice 1 persistence tables in the 33-table contract", () => {
  for (const table of [
    "capability_runs",
    "audit_runs",
    "audit_module_results",
    "site_pages",
    "page_snapshots",
  ]) {
    assert.match(verifier, new RegExp(`"${table}"`));
  }
  const expectedTablesBlock = verifier.match(
    /const EXPECTED_TABLES = \[([\s\S]*?)\n\];/,
  );
  assert.ok(expectedTablesBlock);
  assert.equal(
    [...expectedTablesBlock[1].matchAll(/^\s+"[a-z][a-z0-9_]*",$/gm)].length,
    33,
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
  ]) {
    assert.match(verifier, new RegExp(`"${guard}"`));
  }
});
