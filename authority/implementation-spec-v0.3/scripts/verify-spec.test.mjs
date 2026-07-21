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
const authorityTables = [
  ...authoritySql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
  ),
].map((match) => match[1]);

test("declares the activated v0.3 machine surface and exactly 33 application tables", () => {
  assert.match(authorityReadme, /状态：\*\*activated\*\*/);
  assert.match(authorityReadme, /当前已实现机器面：\*\*0\.3\.0\*\*/);
  assert.match(authoritySpec, /status: activated/);
  assert.match(authoritySpec, /implemented_surface_version: 0\.3\.0/);
  assert.match(authorityOpenApi, /^\s+version: 0\.3\.0$/m);
  assert.equal(authorityTables.length, 33);
  for (const table of [
    "capability_runs",
    "audit_runs",
    "audit_module_results",
    "site_pages",
    "page_snapshots",
  ]) {
    assert.ok(authorityTables.includes(table), `${table} is missing`);
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

function tableSql(tables) {
  return tables
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
  for (const [name, sql] of Object.entries(migrations)) {
    writeFileSync(join(migrationDirectory, name), `${sql}\n`);
  }
  return root;
}

function run(appRoot) {
  return spawnSync(process.execPath, [verifier, "--app-root", appRoot], {
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

test("rejects an app migration set that omits an authority table", (t) => {
  const appRoot = fixture(t, {
    "0001_init.sql": tableSql(authorityTables.slice(0, -1)),
  });

  const result = run(appRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /application migration tables/i);
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
