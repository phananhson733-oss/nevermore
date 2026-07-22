import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const authorityRoot = resolve(scriptDirectory, "..");
const verifier = join(scriptDirectory, "verify-spec.mjs");
const authorityReadme = readFileSync(join(authorityRoot, "README.md"), "utf8");
const authoritySpec = readFileSync(
  join(authorityRoot, "MVP-IMPLEMENTATION-SPEC.md"),
  "utf8",
);
const authorityOpenApi = readFileSync(
  join(authorityRoot, "openapi.yaml"),
  "utf8",
);
const authoritySql = readFileSync(join(authorityRoot, "schema.sql"), "utf8");
const authoritySchemaSmoke = readFileSync(
  join(authorityRoot, "scripts/schema-smoke.sql"),
  "utf8",
);
const authorityBundleSchema = readFileSync(
  join(authorityRoot, "schemas/service-bundle-manifest.schema.json"),
  "utf8",
);
const repositoryRoot = resolve(authorityRoot, "../..");
const implementationSchemaSmoke = readFileSync(
  join(repositoryRoot, "packages/db/migrations/schema-smoke.sql"),
  "utf8",
);
const pageSnapshotLineageMigration = readFileSync(
  join(
    repositoryRoot,
    "packages/db/migrations/0012_page_snapshot_lineage_hardening.sql",
  ),
  "utf8",
);
const exactVariantRulesMigration = readFileSync(
  join(
    repositoryRoot,
    "packages/db/migrations/0013_exact_url_variant_rules.sql",
  ),
  "utf8",
);
const productProfileSynthesisMigration = readFileSync(
  join(
    repositoryRoot,
    "packages/db/migrations/0014_product_profile_synthesis.sql",
  ),
  "utf8",
);
const frozenCrawlSeedMigration = readFileSync(
  join(
    repositoryRoot,
    "packages/db/migrations/0015_frozen_crawl_seed.sql",
  ),
  "utf8",
);
const authorityTables = [
  ...authoritySql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
  ),
].map((match) => match[1]);

test("declares the activated v0.3 machine surface and exactly 35 application tables", () => {
  assert.match(authorityReadme, /状态：\*\*activated\*\*/);
  assert.match(authorityReadme, /当前已实现机器面：\*\*0\.3\.0\*\*/);
  assert.match(authoritySpec, /status: activated/);
  assert.match(authoritySpec, /implemented_surface_version: 0\.3\.0/);
  assert.match(authorityOpenApi, /^\s+version: 0\.3\.0$/m);
  assert.equal(authorityTables.length, 35);
  for (const table of [
    "capability_runs",
    "audit_runs",
    "audit_module_results",
    "site_pages",
    "page_snapshots",
    "product_profile_runs",
    "product_profile_invocation_attempts",
  ]) {
    assert.ok(authorityTables.includes(table), `${table} is missing`);
  }
});

test("declares all 32 implemented operations and six real async commands", () => {
  const operationBlock = authoritySpec.slice(
    authoritySpec.indexOf("<!-- API_OPERATIONS_START -->"),
    authoritySpec.indexOf("<!-- API_OPERATIONS_END -->"),
  );
  const declaredOperations = [
    ...operationBlock.matchAll(/^- `([a-z][A-Za-z0-9]+)`/gm),
  ].map((match) => match[1]);
  assert.equal(declaredOperations.length, 32);
  for (const operationId of [
    "getProjectProductProfile",
    "updateProductProfileDraft",
    "createProductProfileSynthesisRun",
    "reviewProductProfileCompetitor",
    "addProductProfileCompetitor",
    "confirmProductProfile",
  ]) {
    assert.ok(declaredOperations.includes(operationId), `${operationId} is missing`);
  }

  const asyncBlock = authoritySpec.slice(
    authoritySpec.indexOf("<!-- ASYNC_OPERATIONS_START -->"),
    authoritySpec.indexOf("<!-- ASYNC_OPERATIONS_END -->"),
  );
  const declaredAsyncOperations = [
    ...asyncBlock.matchAll(/^- `([a-z][A-Za-z0-9]+)`/gm),
  ].map((match) => match[1]);
  assert.equal(declaredAsyncOperations.length, 6);
  assert.ok(
    declaredAsyncOperations.includes("createProductProfileSynthesisRun"),
  );
});

test("allows concurrent CSV and DataForSEO lineage without double-counting demand", () => {
  assert.match(authoritySpec, /CSV 与 DataForSEO 可同时冻结/);
  assert.match(authoritySpec, /search volume 不得重复相加/);
  assert.doesNotMatch(authoritySpec, /一次 DiagnosticRun 最多选择其中一个/);
  assert.match(
    authoritySpec,
    /同一 demand 同时有两种来源时优先 DataForSEO Evidence，不重复累加/,
  );
});

test("freezes the three mutually exclusive Evidence provenance shapes", () => {
  assert.match(
    authoritySpec,
    /source_provider=system \+ derived\/computed\/B/,
  );
  assert.match(
    authoritySpec,
    /source_provider=llm \+ generated\/generated\/C/,
  );
  assert.match(
    authoritySpec,
    /snapshot_id \+ collection_run_id \+ capturedAt/,
  );
  assert.match(authoritySql, /signalframe\.evidence-provenance\.v2/);
  assert.match(
    authoritySql,
    /system evidence must be deterministic derived\/computed\/B evidence/,
  );
  assert.match(
    authoritySql,
    /invocation-backed evidence must be generated LLM grade-C evidence/,
  );
});

test("exposes collection-run lineage in the public Evidence contract", () => {
  const start = authorityOpenApi.indexOf("    Evidence:");
  const end = authorityOpenApi.indexOf("    SubjectRef:", start);
  assert.ok(start >= 0 && end > start, "Evidence schema is missing");
  const evidenceSchema = authorityOpenApi.slice(start, end);

  assert.match(
    evidenceSchema,
    /required: \[[^\]]*snapshotId[^\]]*collectionRunId[^\]]*analysisInvocationId[^\]]*\]/,
  );
  assert.match(
    evidenceSchema,
    /collectionRunId: \{ type: \[string, 'null'\], format: uuid \}/,
  );
  for (const shape of [
    "Source-backed Evidence",
    "System-derived Evidence",
    "LLM-generated Evidence",
  ]) {
    assert.match(evidenceSchema, new RegExp(`title: ${shape}`));
  }
});

test("declares traceable Slice 1 persistence without a second mutable lifecycle", () => {
  const tableBlock = (table, nextTable) => {
    const start = authoritySql.indexOf(`CREATE TABLE IF NOT EXISTS app.${table}`);
    const end = authoritySql.indexOf(
      `CREATE TABLE IF NOT EXISTS app.${nextTable}`,
      start + 1,
    );
    assert.ok(start >= 0, `${table} is missing`);
    return authoritySql.slice(start, end === -1 ? undefined : end);
  };

  const capability = tableBlock("capability_runs", "audit_runs");
  assert.match(
    capability,
    /async_run_id uuid PRIMARY KEY REFERENCES app\.async_runs\(id\) ON DELETE RESTRICT/,
  );
  assert.doesNotMatch(capability, /^\s*status\s+/im);

  const audit = tableBlock("audit_runs", "audit_module_results");
  assert.match(audit, /REFERENCES app\.diagnostic_runs\(id\) ON DELETE RESTRICT/);
  assert.match(
    audit,
    /REFERENCES app\.capability_runs\(async_run_id\) ON DELETE RESTRICT/,
  );
  assert.match(audit, /CHECK \(diagnostic_run_id = capability_run_id\)/);
  assert.doesNotMatch(audit, /^\s*status\s+/im);

  const pageSnapshot = tableBlock("page_snapshots", "idempotency_keys");
  assert.match(
    pageSnapshot,
    /data_snapshot_id uuid NOT NULL REFERENCES app\.data_snapshots\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    pageSnapshot,
    /CONSTRAINT page_snapshots_canonical_extract_required\s+CHECK \(canonical_extract IS NOT NULL\)/,
  );
  assert.match(
    pageSnapshot,
    /CONSTRAINT page_snapshots_site_page_data_snapshot_key\s+UNIQUE \(site_page_id, data_snapshot_id\)/,
  );
  assert.match(
    authoritySql,
    /CREATE UNIQUE INDEX IF NOT EXISTS page_snapshots_verified_source_identity_idx[\s\S]*?WHERE canonical_extract IS NOT NULL/,
  );
  assert.match(
    authoritySql,
    /NEW\.captured_at IS DISTINCT FROM source_captured_at/,
  );
  assert.match(
    authoritySql,
    /canonical_extract_json IS DISTINCT FROM NEW\.extract/,
  );
  assert.match(
    authoritySql,
    /digest\(convert_to\(NEW\.canonical_extract, 'UTF8'\), 'sha256'\)/,
  );

  for (const trigger of [
    "audit_runs_provenance_guard",
    "site_pages_provenance_guard",
    "page_snapshots_provenance_guard",
    "capability_runs_append_only",
    "audit_runs_append_only",
    "audit_module_results_append_only",
    "page_snapshots_append_only",
  ]) {
    assert.match(authoritySql, new RegExp(`CREATE TRIGGER ${trigger}`));
  }
  assert.match(authoritySql, /CREATE TRIGGER site_pages_set_updated_at/);
});

test("bounds every cumulative executable migration through Product Profile synthesis and frozen Crawl seeds", () => {
  for (const migrationVersion of [
    "0012_page_snapshot_lineage_hardening",
    "0013_exact_url_variant_rules",
    "0014_product_profile_synthesis",
    "0015_frozen_crawl_seed",
  ]) {
    assert.equal(
      authoritySql.match(
        new RegExp(`-- BEGIN EXACT EXECUTABLE MIGRATION ${migrationVersion}`, "g"),
      )?.length,
      1,
    );
    assert.equal(
      authoritySql.match(
        new RegExp(`-- END EXACT EXECUTABLE MIGRATION ${migrationVersion}`, "g"),
      )?.length,
      1,
    );
  }

  for (const functionName of [
    "enforce_site_page_provenance",
    "enforce_collection_run_provenance",
    "enforce_data_snapshot_provenance",
    "enforce_normalized_observation_provenance",
    "enforce_page_snapshot_provenance",
    "enforce_diagnostic_run_frozen_input",
    "enforce_evidence_provenance",
    "enforce_current_diagnostic_manifest",
    "expected_diagnostic_rule_version",
    "enforce_diagnostic_rule_version_lineage",
    "enforce_finding_rule_version_lineage",
    "enforce_product_profile_invocation_attempt_transition",
    "reserve_product_profile_invocation_attempt",
    "finalize_product_profile_invocation_attempt",
    "mark_product_profile_invocation_outcome_unknown",
    "validate_product_profile_provenance",
    "enforce_icp_profile_product_profile_provenance",
    "enforce_product_profile_run_provenance",
    "enforce_product_profile_run_frozen_input",
    "enforce_product_profile_async_result_provenance",
  ]) {
    const expectedCount =
      functionName === "enforce_collection_run_provenance" ? 2 : 1;
    assert.equal(
      authoritySql.match(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+app\\.${functionName}\\s*\\(`,
          "gi",
        ),
      )?.length,
      expectedCount,
      `${functionName} must match the cumulative migration history`,
    );
  }

  for (const triggerName of [
    "site_pages_provenance_guard",
    "collection_runs_provenance_guard",
    "data_snapshots_provenance_guard",
    "normalized_observations_provenance_guard",
    "page_snapshots_provenance_guard",
    "diagnostic_runs_frozen_input_guard",
    "evidence_provenance_guard",
    "diagnostic_runs_current_manifest_guard",
    "diagnostic_run_rules_version_guard",
    "findings_rule_version_guard",
    "product_profile_invocation_attempts_transition_guard",
    "icp_profiles_product_profile_provenance_guard",
    "product_profile_runs_provenance_guard",
    "product_profile_runs_frozen_input_guard",
    "async_runs_product_profile_result_guard",
  ]) {
    const expectedCount =
      triggerName === "collection_runs_provenance_guard" ? 2 : 1;
    assert.equal(
      authoritySql.match(new RegExp(`CREATE\\s+TRIGGER\\s+${triggerName}\\b`, "gi"))
        ?.length,
      expectedCount,
      `${triggerName} must match the cumulative migration history`,
    );
  }
});

test("schema smoke exercises Product Profile reservations, provenance, and exact frozen Crawl seeds", () => {
  assert.equal(authoritySchemaSmoke, implementationSchemaSmoke);
  for (const marker of [
    "expected exactly 35 app tables",
    "product profile invocation reservation was not persisted",
    "a fourth product profile invocation reservation was accepted",
    "unresolved product profile invocation allowed another provider call",
    "product profile provenance accepted a foreign canonical reference",
    "product profile run accepted an unfrozen manifest",
    "Crawl seed accepted a different exact URL",
    "frozen Crawl seed identity was mutated",
    "0015_frozen_crawl_seed",
  ]) {
    assert.match(authoritySchemaSmoke, new RegExp(marker));
  }
});

test("schema smoke mutates every page-snapshot lineage axis and expects rejection", () => {
  assert.equal(authoritySchemaSmoke, implementationSchemaSmoke);
  for (const marker of [
    "a second extract for one page/source snapshot was accepted",
    "a page snapshot with a different source capture time was accepted",
    "a page snapshot hash unrelated to its retained bytes was accepted",
    "retained page bytes unrelated to the page extract were accepted",
    "a new page snapshot without retained extract bytes was accepted",
    "a page snapshot with an unknown extract schema was accepted",
    "a page snapshot for another fetch URL was accepted",
  ]) {
    assert.match(authoritySchemaSmoke, new RegExp(marker));
  }
  assert.match(
    authoritySchemaSmoke,
    /page_snapshots_canonical_extract_required[\s\S]*?convalidated/,
  );
  assert.match(
    authoritySchemaSmoke,
    /page_snapshots_site_page_data_snapshot_key/,
  );
  assert.match(
    authoritySchemaSmoke,
    /'snapshots',[\s\S]*?'provider', 'csv'[\s\S]*?'provider', 'dataforseo'/,
  );
  assert.match(
    authoritySchemaSmoke,
    /current diagnostic accepted duplicate provider snapshots/,
  );
});

test("keeps historical 0.2 exports readable while defaulting new exports to 0.3", () => {
  assert.match(
    authoritySql,
    /DEFAULT 'signalframe\.service-bundle\.0\.3\.0'/,
  );
  assert.match(
    authoritySql,
    /schema_version IN \('signalframe\.service-bundle\.0\.2\.0','signalframe\.service-bundle\.0\.3\.0'\)/,
  );
});

test("uses the cumulative RFC 5646 database grammar on every canonical locale", () => {
  assert.match(
    authoritySql,
    /CREATE OR REPLACE FUNCTION app\.is_bcp47_language_tag\(candidate text\)/,
  );
  assert.match(
    authoritySql,
    /CREATE OR REPLACE FUNCTION app\.are_bcp47_language_tags\(candidates text\[\]\)/,
  );
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
    assert.match(authoritySql, new RegExp(`ADD CONSTRAINT ${constraint}`));
  }
});

test("retains cumulative async-run and export-bundle invariant guards", () => {
  for (const databaseObject of [
    "CREATE OR REPLACE FUNCTION app.reject_async_run_terminal_transition()",
    "CREATE TRIGGER async_runs_terminal_status_immutable",
    "CREATE OR REPLACE FUNCTION app.enforce_export_bundle_invariants()",
    "ADD CONSTRAINT export_bundles_object_key_invariant",
    "CREATE TRIGGER export_bundles_invariant_guard",
  ]) {
    assert.match(authoritySql, new RegExp(databaseObject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

const cumulativeMigrationOwnedTables = new Set([
  "product_profile_runs",
  "product_profile_invocation_attempts",
]);

function tableSql(tables) {
  return tables
    .filter((table) => !cumulativeMigrationOwnedTables.has(table))
    .map(
      (table) =>
        `CREATE TABLE IF NOT EXISTS app.${table} (id uuid PRIMARY KEY);`,
    )
    .join("\n");
}

function fixture(t, migrations) {
  const root = mkdtempSync(join(tmpdir(), "v03-authority-app-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const migrationDirectory = join(root, "packages/db/migrations");
  mkdirSync(migrationDirectory, { recursive: true });
  writeFileSync(
    join(migrationDirectory, "schema-smoke.sql"),
    implementationSchemaSmoke,
  );
  const completeMigrations = {
    "0012_page_snapshot_lineage_hardening.sql": pageSnapshotLineageMigration,
    "0013_exact_url_variant_rules.sql": exactVariantRulesMigration,
    "0014_product_profile_synthesis.sql": productProfileSynthesisMigration,
    "0015_frozen_crawl_seed.sql": frozenCrawlSeedMigration,
    ...migrations,
  };
  for (const [name, sql] of Object.entries(completeMigrations)) {
    writeFileSync(join(migrationDirectory, name), `${sql}\n`);
  }
  return root;
}

function writeAuthorityFixture(appRoot, schemaSql) {
  const fixtureAuthorityRoot = join(
    appRoot,
    "authority/implementation-spec-v0.3",
  );
  mkdirSync(join(fixtureAuthorityRoot, "schemas"), { recursive: true });
  mkdirSync(join(fixtureAuthorityRoot, "scripts"), { recursive: true });
  mkdirSync(join(appRoot, "docs/plans"), { recursive: true });

  for (const [name, contents] of Object.entries({
    "README.md": authorityReadme,
    "MVP-IMPLEMENTATION-SPEC.md": authoritySpec,
    "openapi.yaml": authorityOpenApi,
    "schema.sql": schemaSql,
    "schemas/service-bundle-manifest.schema.json": authorityBundleSchema,
    "scripts/schema-smoke.sql": authoritySchemaSmoke,
    "scripts/verify-spec.mjs": "// verifier fixture target\n",
  })) {
    writeFileSync(join(fixtureAuthorityRoot, name), contents);
  }
  for (const planName of [
    "2026-07-21-unified-growth-opportunity-prd.md",
    "2026-07-21-unified-growth-opportunity-design.md",
    "2026-07-21-unified-growth-opportunity-implementation.md",
  ]) {
    writeFileSync(join(appRoot, "docs/plans", planName), "fixture\n");
  }
  return fixtureAuthorityRoot;
}

function run(appRoot, fixtureAuthorityRoot) {
  const arguments_ = [verifier, "--app-root", appRoot];
  if (fixtureAuthorityRoot) {
    arguments_.push("--authority-root", fixtureAuthorityRoot);
  }
  return spawnSync(process.execPath, arguments_, {
    encoding: "utf8",
  });
}

test("compares the authority table contract with every ordered app migration", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth_slice.sql": tableSql(authorityTables.slice(midpoint)),
  });

  const result = run(appRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`tables:\\s*${authorityTables.length}`, "i"),
  );
});

test("rejects executable migration SQL hidden before the first blank line", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const mutatedMigration = pageSnapshotLineageMigration.replace(
    "BEGIN;\n\n",
    "BEGIN;\nSELECT 1;\n\n",
  );
  assert.notEqual(mutatedMigration, pageSnapshotLineageMigration);
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth_slice.sql": tableSql(authorityTables.slice(midpoint)),
    "0012_page_snapshot_lineage_hardening.sql": mutatedMigration,
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact cumulative 0012 lineage contract/i);
});

test("rejects executable migration SQL after the version projection", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const mutatedMigration = exactVariantRulesMigration.replace(
    "\nCOMMIT;",
    "\nSELECT 1;\n\nCOMMIT;",
  );
  assert.notEqual(mutatedMigration, exactVariantRulesMigration);
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth_slice.sql": tableSql(authorityTables.slice(midpoint)),
    "0013_exact_url_variant_rules.sql": mutatedMigration,
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /schema_migration_version projection immediately before COMMIT/i,
  );
});

test("rejects a later authority override of an exactly embedded function", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth_slice.sql": tableSql(authorityTables.slice(midpoint)),
  });
  const epilogueMarker =
    "-- The browser must not access canonical tables directly through the Supabase Data API.";
  const mutatedAuthoritySql = authoritySql.replace(
    epilogueMarker,
    `CREATE OR REPLACE FUNCTION app.enforce_page_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $override$
BEGIN
  RETURN NEW;
END;
$override$;

${epilogueMarker}`,
  );
  assert.notEqual(mutatedAuthoritySql, authoritySql);
  const fixtureAuthorityRoot = writeAuthorityFixture(
    appRoot,
    mutatedAuthoritySql,
  );

  const result = run(appRoot, fixtureAuthorityRoot);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /migration-owned function app\.enforce_page_snapshot_provenance exactly once \(found 2\)/i,
  );
});

test("rejects an app migration set that omits an authority table", (t) => {
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(1)),
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /application migration tables/i);
});

test("rejects a page-snapshot migration that omits the canonical hash guard", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth_slice.sql": tableSql(authorityTables.slice(midpoint)),
    "0012_page_snapshot_lineage_hardening.sql": `
      ALTER TABLE app.page_snapshots ADD COLUMN IF NOT EXISTS canonical_extract text;
      ALTER TABLE app.page_snapshots ADD CONSTRAINT page_snapshots_canonical_extract_required
        CHECK (canonical_extract IS NOT NULL) NOT VALID;
      CREATE UNIQUE INDEX page_snapshots_verified_source_identity_idx
        ON app.page_snapshots(site_page_id, data_snapshot_id)
        WHERE canonical_extract IS NOT NULL;
      ALTER TABLE app.page_snapshots
        ADD CONSTRAINT page_snapshots_site_page_data_snapshot_key
        UNIQUE (site_page_id, data_snapshot_id);
    `,
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /full PageSnapshot lineage guard/i);
});

test("rejects an exact-variant migration that omits diagnostic rule lineage", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth_slice.sql": tableSql(authorityTables.slice(midpoint)),
    "0013_exact_url_variant_rules.sql": `
      ALTER TABLE app.diagnostic_runs
        ADD CONSTRAINT diagnostic_runs_rule_set_version_check
        CHECK (rule_set_version IN ('mvp.rules.0.2.0', 'mvp.rules.0.2.1'));
    `,
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact cumulative 0013 diagnostic and rule-lineage contract/i);
});

test("rejects Product Profile migration drift in the durable three-call budget", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const mutatedMigration = productProfileSynthesisMigration.replace(
    "ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 3)",
    "ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 4)",
  );
  assert.notEqual(mutatedMigration, productProfileSynthesisMigration);
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth_slice.sql": tableSql(authorityTables.slice(midpoint)),
    "0014_product_profile_synthesis.sql": mutatedMigration,
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact cumulative 0014 Product Profile synthesis/i);
});

test("rejects frozen Crawl seed migration drift", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const mutatedMigration = frozenCrawlSeedMigration.replace(
    "length(NEW.crawl_seed_url) NOT BETWEEN 1 AND 2048",
    "length(NEW.crawl_seed_url) NOT BETWEEN 1 AND 4096",
  );
  assert.notEqual(mutatedMigration, frozenCrawlSeedMigration);
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth_slice.sql": tableSql(authorityTables.slice(midpoint)),
    "0015_frozen_crawl_seed.sql": mutatedMigration,
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact cumulative 0015 frozen Crawl seed/i);
});

test("rejects duplicate app migration ordinals", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const appRoot = fixture(t, {
    "0010_growth.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_other.sql": tableSql(authorityTables.slice(midpoint)),
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate migration ordinal 0010/i);
});

test("rejects a table created by more than one app migration", (t) => {
  const midpoint = Math.ceil(authorityTables.length / 2);
  const duplicate = authorityTables[0];
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, midpoint)),
    "0010_growth.sql": tableSql([
      ...authorityTables.slice(midpoint),
      duplicate,
    ]),
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`table ${duplicate}.*multiple migrations`, "i"));
});
