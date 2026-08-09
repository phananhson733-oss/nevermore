import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifier = join(repositoryRoot, "scripts/verify-spec-lock.mjs");
const activeIndex = JSON.parse(
  readFileSync(join(repositoryRoot, "authority/index.json"), "utf8"),
);
const activeLock = JSON.parse(
  readFileSync(join(repositoryRoot, activeIndex.active.lockPath), "utf8"),
);

const REQUIRED_AUTHORITY_FILES = [
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

const REQUIRED_IMPLEMENTATION_FILES = [
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

const ASYNC_OPERATIONS = [
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

const RULES = [
  ["TECH-HTTP-001", 2],
  ["TECH-CANONICAL-002", 2],
  ["TECH-INDEXABILITY-006", 1],
  ["TECH-LINKGRAPH-005", 3],
  ["SEARCH-CTR-004", 1],
  ["SEARCH-DECAY-002", 1],
  ["CONTENT-COVERAGE-001", 1],
  ["CONTENT-GAP-011", 2],
  ["CRO-PATH-001", 1],
  ["CRO-LANDING-003", 1],
  ["GEO-ENTITY-001", 1],
  ["GEO-CRAWLER-002", 1],
];

function write(root, relativePath, contents = `${relativePath}\n`) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function hashMap(root, base, paths) {
  return Object.fromEntries(
    paths.map((relativePath) => [
      relativePath,
      sha256(join(root, base, relativePath)),
    ]),
  );
}

function fixtureOpenApi() {
  const remaining = Array.from(
    { length: 79 - ASYNC_OPERATIONS.length },
    (_, index) => `fixtureOperation${String(index + 1).padStart(2, "0")}`,
  );
  return [
    "openapi: 3.1.0",
    "info:",
    "  title: fixture",
    "  version: 0.3.0",
    "paths:",
    ...[...ASYNC_OPERATIONS, ...remaining].flatMap(
      (operationId, index) => [
        `  /fixture/${index}:`,
        "    post:",
        `      operationId: ${operationId}`,
        "      responses:",
        ...(ASYNC_OPERATIONS.includes(operationId)
          ? index % 2 === 0
            ? [
                "        '202': { $ref: '#/components/responses/AsyncAccepted' }",
              ]
            : [
                "        '202':",
                "          $ref: '#/components/responses/AsyncAccepted'",
              ]
          : ["        '200': { description: ok }"]),
      ],
    ),
    "",
  ].join("\n");
}

function fixtureMigration(migrationVersion, tables = []) {
  return [
    "BEGIN;",
    "CREATE SCHEMA IF NOT EXISTS app;",
    ...tables.map((table, index) =>
      index % 2 === 0
        ? `CREATE TABLE IF NOT EXISTS app.${table} (id uuid PRIMARY KEY);`
        : `CREATE TABLE app.${table} (id uuid PRIMARY KEY);`,
    ),
    "CREATE OR REPLACE VIEW app.schema_migration_version AS",
    `  SELECT '${migrationVersion}'::text AS migration_version;`,
    "COMMIT;",
    "",
  ].join("\n");
}

function makeFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "spec-v04-lock-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const lockPath = options.lockPath ?? "scripts/custom-v04-lock.json";
  const authorityRoot = "authority/active";
  const tables =
    options.tables ??
    Array.from({ length: 80 }, (_, index) => `table_${index + 1}`);
  const openapi = fixtureOpenApi();

  for (const path of REQUIRED_AUTHORITY_FILES) {
    write(root, join(authorityRoot, path));
  }
  write(root, join(authorityRoot, "openapi.yaml"), openapi);
  write(
    root,
    join(authorityRoot, "scripts/verify-spec.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const index = process.argv.indexOf("--app-root");',
      'if (index === -1 || !process.argv[index + 1]) process.exit(9);',
      'writeFileSync(join(process.argv[index + 1], "authority-ran"), "yes");',
      "",
    ].join("\n"),
  );

  for (const path of REQUIRED_IMPLEMENTATION_FILES) {
    write(root, path);
  }
  write(root, "package.json", '{"version":"0.3.0"}\n');
  write(root, "openapi/mvp.yaml", openapi);
  write(
    root,
    "scripts/verify-implementation.mjs",
    [
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const index = process.argv.indexOf("--root");',
      'if (index === -1 || !process.argv[index + 1]) process.exit(8);',
      'writeFileSync(join(process.argv[index + 1], "implementation-ran"), "yes");',
      "",
    ].join("\n"),
  );
  write(
    root,
    "packages/db/migrations/0001_fixture.sql",
    fixtureMigration("0001_fixture", tables),
  );
  for (let ordinal = 2; ordinal <= 41; ordinal += 1) {
    const migrationVersion = `${String(ordinal).padStart(4, "0")}_fixture`;
    write(
      root,
      `packages/db/migrations/${migrationVersion}.sql`,
      fixtureMigration(migrationVersion),
    );
  }
  write(
    root,
    "packages/db/migrations/0042_contextual_indexability_opportunities.sql",
    fixtureMigration("0042_contextual_indexability_opportunities"),
  );
  write(
    root,
    "packages/db/migrations/0043_validate_contextual_diagnostic_rule_set.sql",
    fixtureMigration("0043_validate_contextual_diagnostic_rule_set"),
  );
  write(
    root,
    "packages/db/migrations/0044_dataforseo_backlinks.sql",
    fixtureMigration("0044_dataforseo_backlinks"),
  );
  write(
    root,
    "packages/db/migrations/0045_dataforseo_backlink_target_lineage.sql",
    fixtureMigration("0045_dataforseo_backlink_target_lineage"),
  );
  write(
    root,
    "packages/db/migrations/0046_workspace_plan_tier.sql",
    fixtureMigration("0046_workspace_plan_tier"),
  );
  write(
    root,
    "packages/db/migrations/0047_dataforseo_competitor_metrics.sql",
    fixtureMigration("0047_dataforseo_competitor_metrics"),
  );
  write(
    root,
    "packages/db/migrations/0048_topic_model_generation.sql",
    fixtureMigration("0048_topic_model_generation"),
  );
  write(root, "packages/db/migrations/schema-smoke.sql", "BEGIN; ROLLBACK;\n");
  for (const [index, [id, version]] of RULES.entries()) {
    write(
      root,
      `packages/engine/src/rules/rule-${index}.ts`,
      [
        `export const fixture${index}Rule = {`,
        `  id: "${id}",`,
        `  version: ${version},`,
        '  domain: "technical_seo",',
        "} satisfies DiagnosticRule;",
        "",
      ].join("\n"),
    );
  }
  write(
    root,
    "packages/engine/src/rules/index.ts",
    [
      "export const CONTEXTUAL_ALL_RULES: readonly DiagnosticRule[] = [",
      ...RULES.map((_, index) => `  fixture${index}Rule,`),
      "];",
      "export const ALL_RULES: readonly DiagnosticRule[] = CONTEXTUAL_ALL_RULES;",
      "",
    ].join("\n"),
  );

  const index = {
    schemaVersion: 1,
    active: {
      version: "0.4.0",
      status: "active",
      normative: true,
      authorityRoot,
      lockPath,
    },
    history: [
      {
        version: "0.3.0",
        status: "historical",
        normative: false,
        authorityRoot: "authority/implementation-spec-v0.3",
        lockPath: "scripts/spec-v0.3-lock.json",
      },
    ],
    historicalDesignInputs: [
      {
        label: "v0.4 publication candidate before atomic promotion",
        status: "historical",
        normative: false,
        executable: false,
        path: "authority/implementation-spec-v0.4/historical-publication-candidate",
      },
    ],
  };
  write(root, "authority/index.json", `${JSON.stringify(index, null, 2)}\n`);

  const operationIds = [
    ...openapi.matchAll(/^\s+operationId:\s*([a-z][A-Za-z0-9]+)$/gm),
  ].map((match) => match[1]);
  const lock = {
    lockFormat: 3,
    authorityVersion: "0.4.0",
    authorityStatus: "active",
    normative: true,
    productVersion: "0.3.0",
    contractVersion: "2026-07-21",
    ruleSetVersion: "mvp.rules.0.2.4",
    promptSetVersion: "mvp.prompts.0.2.0",
    authorityRoot,
    lockPath,
    migrationDirectory: "packages/db/migrations",
    migrationFilePattern: "^[0-9]{4}_.+\\.sql$",
    migrationHead: "0048_topic_model_generation",
    authorityFiles: hashMap(root, authorityRoot, REQUIRED_AUTHORITY_FILES),
    implementationFiles: hashMap(root, "", REQUIRED_IMPLEMENTATION_FILES),
    apiOperations: operationIds,
    asyncOperations: ASYNC_OPERATIONS,
    tables,
    rules: RULES.map(([id]) => id),
    ruleVersions: Object.fromEntries(RULES),
  };
  write(root, lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return { root, lock, lockPath, authorityRoot, tables };
}

function writeLock(fixture, lock = fixture.lock) {
  write(
    fixture.root,
    fixture.lockPath,
    `${JSON.stringify(lock, null, 2)}\n`,
  );
}

function runVerifier(fixture, extra = []) {
  return spawnSync(
    process.execPath,
    [verifier, "--root", fixture.root, ...extra],
    { encoding: "utf8" },
  );
}

test("freezes the complete active v0.4 surface", () => {
  assert.equal(activeIndex.active.version, "0.4.0");
  assert.equal(activeLock.apiOperations.length, 79);
  assert.equal(activeLock.asyncOperations.length, 10);
  assert.equal(activeLock.tables.length, 80);
  assert.equal(activeLock.rules.length, 12);
  assert.equal(activeLock.ruleSetVersion, "mvp.rules.0.2.4");
  assert.equal(activeLock.migrationHead, "0048_topic_model_generation");
  assert.equal(activeLock.ruleVersions["CONTENT-GAP-011"], 2);
  assert.equal(activeLock.ruleVersions["TECH-LINKGRAPH-005"], 3);
  assert.equal(activeLock.ruleVersions["TECH-INDEXABILITY-006"], 1);
  for (const operationId of [
    "getProjectAuditBacklinks",
    "listProjectAuditKeywordRelations",
    "getProjectAuditCompetitorMonitor",
    "getArtifactExecutionStateBatch",
    "issuePublicationPreview",
    "createProjectMeasurementWindow",
    "createAnalysisRefreshRun",
  ]) {
    assert.ok(activeLock.apiOperations.includes(operationId));
  }
  for (const table of [
    "publication_preview_events",
    "measurement_windows",
    "keyword_relation_candidates",
    "action_execution_state_events",
    "competitor_monitor_signals",
    "backlink_facts",
    "analysis_refresh_runs",
    "analysis_refresh_steps",
    "topic_model_generation_runs",
    "topic_model_generation_invocation_attempts",
  ]) {
    assert.ok(activeLock.tables.includes(table));
  }
});

test("uses authority/index.json to discover the default active lock", (t) => {
  const fixture = makeFixture(t, {
    lockPath: "scripts/spec-v0.4-lock.json",
  });
  const result = runVerifier(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Spec lock passed: active authority 0\.4\.0/);
});

test("accepts the reviewed fixture and executes both downstream verifiers", (t) => {
  const fixture = makeFixture(t);
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(fixture.root, "authority-ran"), "utf8"), "yes");
  assert.equal(
    readFileSync(join(fixture.root, "implementation-ran"), "utf8"),
    "yes",
  );
});

test("rejects a 202 that does not reference the exact shared AsyncAccepted response", (t) => {
  const fixture = makeFixture(t);
  for (const [relativePath, lockSection, lockKey] of [
    [
      "openapi/mvp.yaml",
      fixture.lock.implementationFiles,
      "openapi/mvp.yaml",
    ],
    [
      `${fixture.authorityRoot}/openapi.yaml`,
      fixture.lock.authorityFiles,
      "openapi.yaml",
    ],
  ]) {
    const path = join(fixture.root, relativePath);
    write(
      fixture.root,
      relativePath,
      readFileSync(path, "utf8").replace(
        "'202': { $ref: '#/components/responses/AsyncAccepted' }",
        "'202': { $ref: '#/components/responses/MeasurementWindowAccepted' }",
      ),
    );
    lockSection[lockKey] = sha256(path);
  }
  writeLock(fixture);
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /createProductProfileSynthesisRun must retain shared AsyncAccepted/i,
  );
});

test("rejects a downgraded lock format", (t) => {
  const fixture = makeFixture(t);
  writeLock(fixture, { ...fixture.lock, lockFormat: 2 });
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires lockFormat 3/i);
});

test("rejects an active discovery pointer that differs from the lock", (t) => {
  const fixture = makeFixture(t);
  const indexPath = join(fixture.root, "authority/index.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  index.active.authorityRoot = "authority/wrong";
  write(
    fixture.root,
    "authority/index.json",
    `${JSON.stringify(index, null, 2)}\n`,
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authorityRoot/);
});

test("rejects a table removed from the ordered migration chain", (t) => {
  const fixture = makeFixture(t);
  const path = join(
    fixture.root,
    "packages/db/migrations/0001_fixture.sql",
  );
  write(
    fixture.root,
    "packages/db/migrations/0001_fixture.sql",
    readFileSync(path, "utf8").replace(
      `CREATE TABLE app.${fixture.tables.at(-1)} (id uuid PRIMARY KEY);\n`,
      "",
    ),
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /application tables drifted/i);
});

test("rejects duplicate migration ordinals", (t) => {
  const fixture = makeFixture(t);
  write(
    fixture.root,
    "packages/db/migrations/0001_duplicate.sql",
    [
      "BEGIN;",
      "CREATE OR REPLACE VIEW app.schema_migration_version AS",
      "  SELECT '0001_duplicate'::text AS migration_version;",
      "COMMIT;",
      "",
    ].join("\n"),
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate migration ordinal 0001/i);
});

test("rejects a migration without exact transactional identity", (t) => {
  const fixture = makeFixture(t);
  write(
    fixture.root,
    "packages/db/migrations/0001_fixture.sql",
    "CREATE TABLE app.unframed (id uuid PRIMARY KEY);\n",
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must begin with BEGIN/i);
});

test("rejects an authority file changed after lock review", (t) => {
  const fixture = makeFixture(t);
  write(
    fixture.root,
    `${fixture.authorityRoot}/README.md`,
    "changed after review\n",
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authority file drifted/i);
});

test("rejects a required hash removed from the active lock", (t) => {
  const fixture = makeFixture(t);
  delete fixture.lock.authorityFiles["schema.sql"];
  writeLock(fixture);
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authorityFiles paths drifted/i);
});

test("rejects CONTENT-GAP rule version drift", (t) => {
  const fixture = makeFixture(t);
  const path = join(
    fixture.root,
    "packages/engine/src/rules/rule-7.ts",
  );
  write(
    fixture.root,
    "packages/engine/src/rules/rule-7.ts",
    readFileSync(path, "utf8").replace("version: 2", "version: 999"),
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CONTENT-GAP-011 rule version drifted from 2/i);
});

test("rejects TECH-INDEXABILITY rule version drift", (t) => {
  const fixture = makeFixture(t);
  const path = join(
    fixture.root,
    "packages/engine/src/rules/rule-2.ts",
  );
  write(
    fixture.root,
    "packages/engine/src/rules/rule-2.ts",
    readFileSync(path, "utf8").replace("version: 1", "version: 999"),
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /TECH-INDEXABILITY-006 rule version drifted from 1/i,
  );
});

test("rejects a tampered implementation verifier before executing it", (t) => {
  const fixture = makeFixture(t);
  write(
    fixture.root,
    "scripts/verify-implementation.mjs",
    'throw new Error("tampered");\n',
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /implementation file drifted.*verify-implementation\.mjs/is,
  );
});

test("rejects a dependency patch changed after lock review", (t) => {
  const fixture = makeFixture(t);
  write(
    fixture.root,
    "patches/brace-expansion@5.0.9.patch",
    "tampered dependency patch\n",
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /implementation file drifted.*patches\/brace-expansion@5\.0\.9\.patch/is,
  );
});

test("rejects a missing dependency patch", (t) => {
  const fixture = makeFixture(t);
  rmSync(
    join(fixture.root, "patches/brace-expansion@5.0.9.patch"),
    { force: true },
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /implementation file is missing: patches\/brace-expansion@5\.0\.9\.patch/i,
  );
});

test("rejects a hash-pinned downstream verifier that fails", (t) => {
  const fixture = makeFixture(t);
  const path = write(
    fixture.root,
    "scripts/verify-implementation.mjs",
    'throw new Error("fixture implementation exploded");\n',
  );
  fixture.lock.implementationFiles["scripts/verify-implementation.mjs"] =
    sha256(path);
  writeLock(fixture);
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fixture implementation exploded/i);
  assert.match(result.stderr, /clone-local implementation verifier failed/i);
});

test("rejects OpenAPI drift even when operation ids are unchanged", (t) => {
  const fixture = makeFixture(t);
  const path = join(fixture.root, "openapi/mvp.yaml");
  write(
    fixture.root,
    "openapi/mvp.yaml",
    readFileSync(path, "utf8").replace("version: 0.3.0", "version: 9.9.9"),
  );
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /implementation file drifted.*openapi\/mvp\.yaml/is);
});
