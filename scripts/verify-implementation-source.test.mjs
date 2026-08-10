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
const lock = JSON.parse(
  readFileSync(resolve(scriptDirectory, "spec-v0.4-lock.json"), "utf8"),
);

test("derives active versions and inventories from the reviewed v0.4 lock", () => {
  assert.match(
    verifier,
    /const ACTIVE_LOCK_PATH = "scripts\/spec-v0\.4-lock\.json";/,
  );
  for (const binding of [
    "PRODUCT_VERSION = ACTIVE_LOCK.productVersion",
    "CONTRACT_VERSION = ACTIVE_LOCK.contractVersion",
    "RULE_SET_VERSION = ACTIVE_LOCK.ruleSetVersion",
    "PROMPT_SET_VERSION = ACTIVE_LOCK.promptSetVersion",
    "EXPECTED_OPENAPI_OPERATIONS = ACTIVE_LOCK.apiOperations",
    "EXPECTED_ASYNC_OPERATIONS = ACTIVE_LOCK.asyncOperations",
    "EXPECTED_TABLES = ACTIVE_LOCK.tables",
    "EXPECTED_RULES = ACTIVE_LOCK.rules",
  ]) {
    assert.match(verifier, new RegExp(binding.replaceAll(".", "\\.")));
  }
  assert.match(verifier, /ruleIds\.length === EXPECTED_RULES\.length/);
  assert.match(
    verifier,
    /expected \$\{EXPECTED_RULES\.length\} executable rules, found \$\{ruleIds\.length\}/,
  );
  assert.match(
    verifier,
    /diagnostics: \$\{EXPECTED_RULES\.length\} executable frozen rules in canonical order/,
  );
  assert.doesNotMatch(verifier, /expected 11 executable rules/);
  assert.doesNotMatch(
    verifier,
    /diagnostics: 11 executable frozen rules in canonical order/,
  );
  assert.equal(lock.authorityVersion, "0.4.0");
  assert.equal(lock.apiOperations.length, 80);
  assert.equal(lock.asyncOperations.length, 10);
  assert.equal(lock.tables.length, 80);
  assert.equal(lock.rules.length, 12);
  assert.equal(lock.ruleSetVersion, "mvp.rules.0.2.4");
  assert.equal(
    lock.migrationHead,
    "0050_product_profile_keyword_lineage",
  );
  assert.equal(lock.ruleVersions["CONTENT-GAP-011"], 2);
  assert.equal(lock.ruleVersions["TECH-LINKGRAPH-005"], 3);
  assert.equal(lock.ruleVersions["TECH-INDEXABILITY-006"], 1);
  assert.doesNotMatch(verifier, /mvp\.rules\.0\.2\.1/);
});

test("builds the complete database inventory through the static schema catalog", () => {
  assert.match(
    verifier,
    /import \{ buildSchemaCatalog \} from "\.\/schema-catalog\.mjs";/,
  );
  assert.match(
    verifier,
    /const tables = \[\.\.\.buildSchemaCatalog\(migrationSources\)\.keys\(\)\];/,
  );
  assert.match(verifier, /tables\.length === EXPECTED_TABLES\.length/);
  assert.match(
    verifier,
    /expected \$\{EXPECTED_TABLES\.length\} app tables in the migrations/,
  );
  assert.match(
    verifier,
    /database: 50 migrations through \$\{EXPECTED_MIGRATION_HEAD\}, \$\{EXPECTED_TABLES\.length\} app tables \(pg-boss excluded\), 109 indexes, 157 triggers, and 82 routines in migrate-check/,
  );
  for (const invariant of [
    "authority schema must contain migration 0048 verbatim and exactly once",
    "database async run kinds",
    "database async result resource types",
    "AnalysisInvocation tasks",
    "Topic invocation ledger must bound budget and fence every reservation to one exact AsyncRun attempt",
    "Topic migration must store hashes and bounded metadata, never raw prompt/provider/model output",
    "actorless system confirmation must require the exact successful invocation and reservation lineage",
    "Analysis Refresh plan constraint must accept exactly v1, v2, and v3 branches",
    "internal Topic mutator EXECUTE privilege is not revoked",
  ]) {
    assert.match(verifier, new RegExp(invariant));
  }
  assert.doesNotMatch(
    verifier,
    /CREATE\\s\+TABLE\\s\+IF\\s\+NOT\\s\+EXISTS\\s\+app/,
    "table inventory must not silently omit CREATE TABLE without IF NOT EXISTS",
  );
});

test("freezes ten shared async operations and the dedicated measurement 202", () => {
  for (const operationId of lock.asyncOperations) {
    assert.ok(lock.apiOperations.includes(operationId));
  }
  assert.match(
    verifier,
    /expected \$\{EXPECTED_ASYNC_OPERATIONS\.length\} shared AsyncAccepted operations/,
  );
  assert.match(
    verifier,
    /\["createProjectMeasurementWindow"\]/,
  );
  assert.match(
    verifier,
    /MeasurementWindowAcceptedHttpResponse/,
  );
  assert.match(
    verifier,
    /createProjectMeasurementWindow must retain its dedicated typed accepted response/,
  );
});

test("gates the current Supabase production authentication boundary", () => {
  for (const invariant of [
    "refresh and verify the Supabase session at the production boundary",
    "only login, the OAuth callback, and health may bypass the authenticated page boundary",
    "production requests must derive page authentication from refreshed Supabase user state",
    "unauthenticated pages must redirect to login with a sanitized return target",
    "operator resolution must verify the authenticated user with Supabase Auth",
    "operator resolution must look membership up by the authenticated user id",
    "non-development sessions must fail closed before any membership resolution",
    // Spec §1.6 opened self-serve signup. The invariant that replaced
    // "pre-provisioned membership" is the one that still protects data: a
    // signup must CREATE its workspace and must never select an existing one.
    "self-serve signup must live in provisionSelfServeOperator so its isolation can be verified",
    "self-serve signup must create the workspace it admits an account into",
    "self-serve signup must never select an existing workspace to join",
    "self-serve signup must serialize per user so a concurrent first request cannot orphan a workspace",
    "SF_DEV_AUTH must fail closed outside exact loopback development",
  ]) {
    assert.match(verifier, new RegExp(invariant));
  }
  assert.doesNotMatch(
    verifier,
    /the mock project shell must remain behind the loopback-development gate/,
  );
});

test("keeps strict Growth Map Keyword and Competitor contracts", () => {
  for (const invariant of [
    "public collection provider allowlist",
    "Analysis Refresh must own the fixed v3 DFS/Backlinks/Topic/Growth Audit plan while retaining exact v1/v2 readability and no public model options",
    "shared AsyncRun kinds",
    "shared AsyncRun result resource types",
    "shared AsyncAccepted resource types",
    "OpenAPI must not expose Topic generation reservation, attempt, or provider-option internals",
    "Growth Map diagnosticRunId pin must remain one optional canonical lowercase UUID",
    "Growth Map review view must remain the exact optional view=review literal",
    "Growth Map Keyword list path/operationId drift",
    "Growth Map Keyword detail path/operationId drift",
    "Growth Map Keyword detail must keep review view mutually exclusive with the generation pin",
    "Growth Map Keyword PATCH must reject every query parameter",
    "Growth Map Keyword suggestion approval path/operationId drift",
    "Growth Map Keyword suggestion approval request must remain a strict two-field compare-and-swap command",
    "Growth Map Keyword pinned detail must never expose a current pending suggestion",
    "Keyword governance suggestion generation must remain an exact internal async identity with no public model/config selector",
    "Keyword suggestion manifest must contain exact workspaceId/projectId authority and no self-embedded inputHash",
    "Growth Map Keyword source occurrence discriminator drift",
    "Growth Map Keyword mapped target discriminator drift",
    "Growth Map Keyword canonical metric pointer drift",
    "Growth Map Keyword recollection fields",
    "Growth Map Keyword recollection required fields",
    "Growth Map Keyword recollection must remain closed, bounded, exact, and nullable",
    "Growth Map Keyword cursor page diagnostic run identity types",
    "Growth Map Keyword cursor page must identify the exact frozen run and keep live reads null",
    "Growth Map Competitor list path/operationId drift",
    "Growth Map Competitor detail path/operationId drift",
    "Growth Map Competitor detail must keep review view mutually exclusive with the generation pin",
    "Growth Map Competitor PATCH must reject every query parameter",
    "Growth Map Competitor origin occurrence discriminator drift",
    "Growth Map Competitor product_profile origin must keep its strict typed Product Profile evidence contract",
    "Growth Map Competitor insight availability discriminator drift",
    "Growth Map Competitor discovery counts must remain exact non-negative whole-library integers",
    "Growth Map Competitor cursor page must remain bounded with exact metadata and explicit coverage",
  ]) {
    assert.match(verifier, new RegExp(invariant));
  }
  assert.match(
    verifier,
    /Object\.keys\(keywordSourceOccurrence\?\.discriminator\?\.mapping \?\? \{\}\),\s*\[\s*"product_profile",\s*"csv_import",/u,
  );
  assert.match(
    verifier,
    /\(keywordSourceOccurrence\?\.oneOf \?\? \[\]\)\.map\(\(shape\) => shape\.\$ref\),\s*\[\s*"#\/components\/schemas\/GrowthMapKeywordProductProfileOccurrence",\s*"#\/components\/schemas\/GrowthMapKeywordCsvImportOccurrence",/u,
  );
});

test("keeps the Sources read behind confirmed Product/ICP without hiding archived history", () => {
  assert.match(
    verifier,
    /Sources read must gate active projects on confirmed Product\/ICP, expose CONTEXT_INCOMPLETE, and preserve archived history/,
  );
});

test("requires Growth Map findings to retain optimistic review revision", () => {
  assert.match(
    verifier,
    /growthMapFinding\.required\.includes\("reviewRevision"\)/,
  );
  assert.match(
    verifier,
    /growthMapFinding\.properties\.reviewRevision\.minimum === 0/,
  );
});

test("keeps canonical provenance and append-only database guards", () => {
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

test("keeps integration databases behind safe latest-schema bootstrap", () => {
  for (const invariant of [
    "must import runMigrations from migrate.ts",
    'must bind requireSafeTestDatabaseUrl\\(process\\.env\\["DATABASE_URL"\\]\\) before schema bootstrap',
    "must migrate only the URL returned by requireSafeTestDatabaseUrl",
    "validates DATABASE_URL and migrates the disposable database",
  ]) {
    assert.match(verifier, new RegExp(invariant));
  }
});
