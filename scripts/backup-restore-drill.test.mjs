import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APP_TABLES,
  INTEGRITY_PROBES,
  assertSafeGeneratedTargetName,
  buildCanonicalCopySql,
  buildIntegrityCopySql,
  buildTableCountSql,
  compareInventories,
  extractSchemaReferences,
  makeTargetDatabaseName,
  parseSourceDatabaseUrl,
  pendingMigrationPaths,
  redactSensitiveText,
  runRestoreDrill,
} from "./backup-restore-drill.mjs";
import {
  buildSchemaCatalog,
  listMigrationFiles,
  loadSchemaCatalog,
  missingSchemaReferences,
} from "./schema-catalog.mjs";

/**
 * The drill talks to a stubbed PostgreSQL in these tests, so nothing here can
 * observe a query failing on the real server. That is exactly how an integrity
 * probe that ordered `app.capability_runs` by a non-existent `id` column stayed
 * green in this file while `pnpm restore:drill` failed every single run. The
 * catalog parsed from the checked-in migration chain closes that gap without a
 * database: the SQL the drill emits is checked against the schema it will run
 * on before any stub gets a chance to accept it.
 */
const SCHEMA_CATALOG = await loadSchemaCatalog();

const SOURCE_URL =
  "postgres://local_user:super-secret@localhost:5432/signalframe_ci";
const SCRIPT_PATH = fileURLToPath(
  new URL("./backup-restore-drill.mjs", import.meta.url),
);
const MIGRATIONS_DIRECTORY = path.resolve(
  fileURLToPath(new URL("../packages/db/migrations/", import.meta.url)),
);
const FAKE_PG_FIXTURE = new URL(
  "./fixtures/restore-drill-fake-pg.cjs",
  import.meta.url,
);
const EXPECTED_PASSFILE =
  "localhost:5432:*:local_user:super-secret\n";
const EXPECTED_MIGRATION_FILES = [
  "0001_init.sql",
  "0002_async_run_terminal_invariant.sql",
  "0003_artifact_status_transition.sql",
  "0004_artifact_revision_output_locale.sql",
  "0005_artifact_transition_invariants.sql",
  "0006_observability_metrics.sql",
  "0007_export_bundle_invariants.sql",
  "0008_bcp47_locale_grammar.sql",
  "0009_async_run_contract_version.sql",
  "0010_growth_audit_slice1.sql",
];
const CHILD_ENV_ALLOWLIST = new Set([
  "COMSPEC",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  // Injected by Node's experimental test coverage harness after spawn.
  "NODE_V8_COVERAGE",
  "PATH",
  "PATHEXT",
  "PGAPPNAME",
  "PGCONNECT_TIMEOUT",
  "PGPASSFILE",
  "PGSSLMODE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
  // macOS CoreFoundation injects this after exec even when it is not supplied.
  "__CF_USER_TEXT_ENCODING",
]);

async function createFakePgToolchain(state = {}, skippedTools = []) {
  const root = await mkdtemp(path.join(tmpdir(), "signalframe-fake-pg-"));
  const bin = path.join(root, "bin");
  const reportDir = path.join(root, "reports");
  const statePath = path.join(root, "state.json");
  const fakeClient = await readFile(FAKE_PG_FIXTURE, "utf8");
  await mkdir(bin, { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      exists: false,
      observations: [],
      expectedPassfileHash: createHash("sha256")
        .update(EXPECTED_PASSFILE)
        .digest("hex"),
      ...state,
    }),
  );
  for (const tool of ["psql", "pg_dump", "createdb", "pg_restore", "dropdb"]) {
    if (!skippedTools.includes(tool)) {
      await writeFile(path.join(bin, tool), fakeClient, { mode: 0o755 });
    }
  }
  return {
    root,
    bin,
    reportDir,
    statePath,
    readState: async () => JSON.parse(await readFile(statePath, "utf8")),
  };
}

async function withAmbientEnvironment(values, callback) {
  const previous = new Map(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function hostileThrownValue(sentinel) {
  return new Proxy(Object.create(null), {
    get() {
      throw new Error(sentinel);
    },
    getOwnPropertyDescriptor() {
      throw new Error(sentinel);
    },
    getPrototypeOf() {
      throw new Error(sentinel);
    },
    has() {
      throw new Error(sentinel);
    },
    ownKeys() {
      throw new Error(sentinel);
    },
  });
}

async function capturedFailure(run) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  assert.fail("expected restore drill to fail");
}

function emptyInventory() {
  return {
    tableCounts: Object.fromEntries(APP_TABLES.map((table) => [table, "0"])),
    tableChecksums: Object.fromEntries(
      APP_TABLES.map((table) => [table, "a".repeat(64)]),
    ),
    integrityChecksums: Object.fromEntries(
      INTEGRITY_PROBES.map((probe) => [probe.id, "b".repeat(64)]),
    ),
  };
}

async function fakeHarness({
  databaseExistsResults = [false, true, false],
  failTool,
  toolFailure,
  restoredInventory = emptyInventory(),
  appliedMigrationVersion = null,
} = {}) {
  const reportDir = await mkdtemp(
    path.join(tmpdir(), "signalframe-restore-report-test-"),
  );
  const calls = [];
  const existsResults = [...databaseExistsResults];
  const sourceInventory = emptyInventory();

  return {
    reportDir,
    calls,
    overrides: {
      now: () => new Date("2026-07-18T12:34:56.000Z"),
      randomBytes: () => Buffer.from("0123456789abcdef", "hex"),
      collectInventory: async ({ database }) => {
        calls.push({ operation: "inventory", database });
        return structuredClone(
          database === "signalframe_ci" ? sourceInventory : restoredInventory,
        );
      },
      appliedMigrationVersion: async ({ database }) => {
        calls.push({ operation: "applied_migration_version", database });
        return appliedMigrationVersion;
      },
      databaseExists: async ({ targetDatabase }) => {
        calls.push({ operation: "exists", targetDatabase });
        assert.ok(existsResults.length > 0, "unexpected database existence probe");
        return existsResults.shift();
      },
      runTool: async ({ tool, args }) => {
        calls.push({ operation: tool, args });
        if (tool === "pg_dump") {
          const fileIndex = args.indexOf("--file");
          await writeFile(args[fileIndex + 1], "sensitive custom dump");
        }
        if (tool === failTool) {
          throw (
            toolFailure ??
            new Error(`${tool} deliberately failed with super-secret`)
          );
        }
      },
    },
  };
}

test("parseSourceDatabaseUrl only accepts an explicit loopback database", () => {
  const parsed = parseSourceDatabaseUrl(SOURCE_URL);

  assert.deepEqual(
    {
      hostname: parsed.hostname,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      database: parsed.database,
      displayName: parsed.displayName,
    },
    {
      hostname: "localhost",
      port: "5432",
      username: "local_user",
      password: "super-secret",
      database: "signalframe_ci",
      displayName: "localhost:5432/signalframe_ci",
    },
  );
});

test("parseSourceDatabaseUrl rejects missing, hosted, and system databases", () => {
  assert.throws(() => parseSourceDatabaseUrl(), /DATABASE_URL.*required/i);
  assert.throws(
    () =>
      parseSourceDatabaseUrl(
        "postgres://user:secret@db.example.supabase.co:5432/postgres",
      ),
    /loopback|localhost/i,
  );
  assert.throws(
    () => parseSourceDatabaseUrl("postgres://user@localhost:5432/postgres"),
    /system database/i,
  );
  assert.throws(
    () =>
      parseSourceDatabaseUrl(
        "postgres://user@localhost:5432/signalframe_restore_drill_20260718t120000_abcdef123456",
      ),
    /generated target/i,
  );
  assert.throws(
    () => parseSourceDatabaseUrl("postgres://user@localhost:5432/customer_prod"),
    /disposable|allowlist/i,
  );
  assert.throws(
    () =>
      parseSourceDatabaseUrl(
        "postgres://user:line%0Abreak@localhost:5432/signalframe_ci",
      ),
    /control character/i,
  );
  assert.equal(
    parseSourceDatabaseUrl(
      "postgres://wzb@127.0.0.1:5432/signalframe_codex_llm_20260718_2259",
    ).database,
    "signalframe_codex_llm_20260718_2259",
  );
});

test("generated target names are unique, bounded, and strictly validated", () => {
  const name = makeTargetDatabaseName(
    new Date("2026-07-18T12:34:56.000Z"),
    Buffer.from("0123456789abcdef", "hex"),
  );

  assert.equal(name, "signalframe_restore_drill_20260718t123456_0123456789ab");
  assert.ok(name.length <= 63);
  assert.equal(assertSafeGeneratedTargetName(name), name);
  assert.throws(
    () => assertSafeGeneratedTargetName("signalframe_test"),
    /refusing/i,
  );
  assert.throws(
    () =>
      assertSafeGeneratedTargetName(
        "signalframe_restore_drill_20260718t123456_0123456789ab;drop database x",
      ),
    /refusing/i,
  );
});

test("URL, entropy, identifier, client path, and retention guards reject unsafe input", async () => {
  assert.throws(
    () => makeTargetDatabaseName(new Date(), Buffer.from("abcd", "hex")),
    /48 bits/i,
  );
  assert.throws(() => parseSourceDatabaseUrl("not a URL"), /valid PostgreSQL URL/i);
  assert.throws(
    () => parseSourceDatabaseUrl("https://localhost/signalframe_ci"),
    /PostgreSQL URL/i,
  );
  assert.throws(
    () => parseSourceDatabaseUrl("postgres://user@localhost"),
    /database name/i,
  );
  assert.throws(() => buildCanonicalCopySql("unsafe;table"), /unsafe SQL/i);
  await assert.rejects(
    runRestoreDrill({ sourceUrl: SOURCE_URL, keepBackup: "yes" }),
    /KEEP_BACKUP/i,
  );

  const reportDir = await mkdtemp(
    path.join(tmpdir(), "signalframe-restore-report-test-"),
  );
  await assert.rejects(
    runRestoreDrill({
      sourceUrl: SOURCE_URL,
      reportDir,
      pgBinDir: "relative/client/bin",
    }),
    /RESTORE_DRILL_PG_BIN/i,
  );
});

test("inventory covers exactly the 44 app tables and explicit object metadata", () => {
  assert.equal(APP_TABLES.length, 44);
  assert.equal(new Set(APP_TABLES).size, 44);
  for (const table of [
    "capability_runs",
    "audit_runs",
    "audit_module_results",
    "site_pages",
    "page_snapshots",
    "finding_targets",
    "product_profile_runs",
    "keyword_entities",
    "competitor_entities",
    "flow_shadow_runs",
    "flow_shadow_research_packs",
    "flow_shadow_qa_gates",
  ]) {
    assert.ok(APP_TABLES.includes(table), `missing restore inventory table ${table}`);
  }
  assert.match(buildTableCountSql(), /app\."artifact_revisions"/);

  const probedColumns = new Set(
    INTEGRITY_PROBES.flatMap((probe) => probe.columns),
  );
  for (const requiredColumn of [
    "raw_object_key",
    "object_key",
    "content_hash",
    "file_checksum",
    "checksum",
  ]) {
    assert.ok(
      probedColumns.has(requiredColumn),
      `missing integrity probe for ${requiredColumn}`,
    );
  }
  assert.ok(
    INTEGRITY_PROBES.some(
      (probe) =>
        probe.table === "capability_runs" &&
        probe.columns.includes("input_manifest_hash"),
    ),
    "missing capability manifest integrity probe",
  );
  assert.ok(
    INTEGRITY_PROBES.some(
      (probe) =>
        probe.table === "page_snapshots" && probe.columns.includes("content_hash"),
    ),
    "missing page snapshot integrity probe",
  );
});

test("the drill inventories every table the migration chain creates", () => {
  const catalogTables = [...SCHEMA_CATALOG.keys()].sort();

  assert.equal(catalogTables.length, 44);
  assert.deepEqual(
    [...APP_TABLES].sort(),
    catalogTables,
    "the restore inventory and the migration chain must name the same tables",
  );
  for (const table of [
    "flow_shadow_runs",
    "flow_shadow_research_packs",
    "flow_shadow_qa_gates",
  ]) {
    assert.ok(
      APP_TABLES.includes(table),
      `Content Shadow table ${table} is not inventoried by the restore drill`,
    );
  }
});

test("every statement the drill sends names only real tables and columns", () => {
  const statements = [
    buildTableCountSql(),
    ...APP_TABLES.map((table) => buildCanonicalCopySql(table)),
    ...INTEGRITY_PROBES.map((probe) => buildIntegrityCopySql(probe)),
  ];

  assert.equal(statements.length, 1 + APP_TABLES.length + INTEGRITY_PROBES.length);
  for (const sqlText of statements) {
    const missing = missingSchemaReferences(
      SCHEMA_CATALOG,
      extractSchemaReferences(sqlText),
    );
    assert.deepEqual(
      missing,
      [],
      `restore drill SQL names schema objects that do not exist: ${missing.join(", ")}`,
    );
  }
});

test("integrity probes order by the primary key the schema really declares", () => {
  for (const probe of INTEGRITY_PROBES) {
    const entry = SCHEMA_CATALOG.get(probe.table);
    assert.ok(entry, `integrity probe ${probe.id} names an unknown table`);
    assert.deepEqual(
      probe.key,
      entry.primaryKey,
      `integrity probe ${probe.id} does not order by the primary key of ${probe.table}`,
    );
    const expectedOrdering = probe.key
      .map((column) => `"${column}"::text`)
      .join(", ");
    assert.ok(
      buildIntegrityCopySql(probe).endsWith(
        `order by ${expectedOrdering}) to stdout`,
      ),
      `integrity probe ${probe.id} does not order by its declared key`,
    );
  }

  // The table that made this gate necessary: it is keyed by the async run it
  // extends and has no id column at all.
  assert.deepEqual(SCHEMA_CATALOG.get("capability_runs").primaryKey, [
    "async_run_id",
  ]);
  assert.equal(SCHEMA_CATALOG.get("capability_runs").columns.has("id"), false);
});

test("the schema gate rejects probe SQL naming a column the schema lacks", () => {
  // Replays the exact defect that shipped and stayed red for the life of the
  // gate: an integrity probe on capability_runs keyed by a non-existent id.
  // A stubbed PostgreSQL accepts this string happily; the schema catalog does
  // not, which is the whole point of checking the emitted SQL offline.
  const brokenColumn = buildIntegrityCopySql({
    id: "capability_runs.input-manifest-hash",
    table: "capability_runs",
    key: ["id"],
    columns: ["input_manifest_hash"],
  });
  assert.deepEqual(
    missingSchemaReferences(
      SCHEMA_CATALOG,
      extractSchemaReferences(brokenColumn),
    ),
    ["column app.capability_runs.id"],
  );

  assert.deepEqual(
    missingSchemaReferences(
      SCHEMA_CATALOG,
      extractSchemaReferences(buildCanonicalCopySql("capability_run")),
    ),
    ["table app.capability_run"],
  );
});

test("the schema catalog parses the DDL the migration chain actually uses", () => {
  const catalog = buildSchemaCatalog([
    {
      name: "0001_fixture.sql",
      sql: [
        "BEGIN;",
        "-- A comment that says drop column must not trip the guard.",
        "/* nested /* block */ comment */",
        "CREATE TABLE IF NOT EXISTS app.widgets (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  label text NOT NULL CHECK (label ~ '^[a-z, ]+$'),",
        "  CONSTRAINT widgets_label_unique UNIQUE (label)",
        ");",
        "CREATE TABLE IF NOT EXISTS app.widget_parts (",
        "  widget_id uuid NOT NULL REFERENCES app.widgets(id),",
        "  part_id text NOT NULL,",
        "  PRIMARY KEY (widget_id, part_id)",
        ");",
        "COMMIT;",
      ].join("\n"),
    },
    {
      name: "0002_fixture.sql",
      sql: [
        "ALTER TABLE app.widgets ADD COLUMN IF NOT EXISTS locale text;",
        "CREATE TABLE IF NOT EXISTS app.widgets (",
        "  id uuid PRIMARY KEY,",
        "  reissued text",
        ");",
        "DO $$ BEGIN",
        "  ALTER TABLE app.widgets",
        "    ADD CONSTRAINT widgets_locale_check CHECK (locale <> '');",
        "END; $$;",
      ].join("\n"),
    },
  ]);

  assert.deepEqual([...catalog.keys()].sort(), ["widget_parts", "widgets"]);
  assert.deepEqual(catalog.get("widgets").primaryKey, ["id"]);
  assert.deepEqual(catalog.get("widget_parts").primaryKey, [
    "widget_id",
    "part_id",
  ]);
  assert.deepEqual([...catalog.get("widgets").columns].sort(), [
    "id",
    "label",
    "locale",
    "reissued",
  ]);
  assert.deepEqual([...catalog.get("widget_parts").columns].sort(), [
    "part_id",
    "widget_id",
  ]);
});

test("the schema catalog refuses DDL it cannot model instead of going stale", () => {
  for (const [sql, expected] of [
    ["ALTER TABLE app.widgets DROP COLUMN label;", /DROP COLUMN/],
    ["ALTER TABLE app.widgets RENAME COLUMN label TO title;", /RENAME COLUMN/],
    ["ALTER TABLE app.widgets RENAME TO gadgets;", /ALTER TABLE \.\.\. RENAME/],
    ["DROP TABLE app.widgets;", /DROP TABLE/],
    [
      "CREATE TABLE app.widget_copy AS SELECT * FROM app.widgets;",
      /CREATE TABLE \.\.\. AS/,
    ],
    ["SELECT * INTO app.widget_copy FROM app.widgets;", /SELECT \.\.\. INTO/],
    [
      "DO $body$ BEGIN ALTER TABLE app.widgets DROP COLUMN label; END; $body$;",
      /DROP COLUMN/,
    ],
  ]) {
    assert.throws(
      () => buildSchemaCatalog([{ name: "0099_fixture.sql", sql }]),
      expected,
      `unsupported DDL slipped past the schema catalog: ${sql}`,
    );
  }
});

test("the schema catalog fails loudly on SQL it cannot tokenize", async () => {
  for (const [sql, expected] of [
    ["SELECT 'unterminated", /Unterminated SQL string literal/],
    ["DO $$ BEGIN END;", /Unterminated dollar-quoted SQL body/],
    ["/* never closed", /Unterminated SQL block comment/],
    [
      "CREATE TABLE IF NOT EXISTS app.widgets (id uuid",
      /Unbalanced parentheses/,
    ],
    [
      "ALTER TABLE app.absent ADD COLUMN label text;",
      /adds a column to unknown table app\.absent/,
    ],
  ]) {
    assert.throws(
      () => buildSchemaCatalog([{ name: "0099_fixture.sql", sql }]),
      expected,
    );
  }

  const files = await listMigrationFiles();
  assert.deepEqual(files, [...files].sort());
  assert.equal(files[0], "0001_init.sql");
  assert.equal(files.includes("schema-smoke.sql"), false);
  assert.ok(files.length >= 21, "migration chain discovery lost files");
});

test("canonical row hashing does not assume every table has an id column", () => {
  const sql = buildCanonicalCopySql("operator_profiles");

  assert.match(sql, /order by to_jsonb\(row_data\)::text/);
  assert.doesNotMatch(sql, /row_data\.id/);
});

test("compareInventories reports count, canonical, and metadata corruption", () => {
  const source = {
    tableCounts: { workspaces: "2", export_bundles: "1" },
    tableChecksums: { workspaces: "aaa", export_bundles: "bbb" },
    integrityChecksums: { "export_bundles.object-metadata": "ccc" },
  };
  const restored = structuredClone(source);

  assert.deepEqual(compareInventories(source, restored), []);

  restored.tableCounts.workspaces = "1";
  restored.tableChecksums.export_bundles = "tampered";
  restored.integrityChecksums["export_bundles.object-metadata"] = "damaged";

  assert.deepEqual(compareInventories(source, restored), [
    {
      category: "row_count",
      key: "workspaces",
      source: "2",
      restored: "1",
    },
    {
      category: "canonical_checksum",
      key: "export_bundles",
      source: "bbb",
      restored: "tampered",
    },
    {
      category: "integrity_checksum",
      key: "export_bundles.object-metadata",
      source: "ccc",
      restored: "damaged",
    },
  ]);
});

test("redactSensitiveText removes passwords and PostgreSQL URLs", () => {
  const message =
    "failed postgres://alice:secret@localhost:5432/db with password=secret";
  const redacted = redactSensitiveText(message, ["secret"]);

  assert.doesNotMatch(redacted, /secret/);
  assert.doesNotMatch(redacted, /alice/);
  assert.match(redacted, /\[REDACTED_DATABASE_URL\]/);
});

test("redactSensitiveText never invokes hostile getters or toString", () => {
  const sentinel = "HOSTILE_REDACTION_VALUE_MUST_NOT_ESCAPE";
  const hostileAccessor = Object.create(null);
  Object.defineProperty(hostileAccessor, "toString", {
    get() {
      throw new Error(sentinel);
    },
  });

  assert.doesNotThrow(() => redactSensitiveText(hostileAccessor));
  assert.doesNotThrow(() => redactSensitiveText(hostileThrownValue(sentinel)));
  assert.equal(redactSensitiveText(hostileAccessor), "[UNAVAILABLE]");
  assert.equal(redactSensitiveText(hostileThrownValue(sentinel)), "[UNAVAILABLE]");
});

test("runRestoreDrill verifies then drops only its generated target and writes safe evidence", async () => {
  const { reportDir, calls, overrides } = await fakeHarness();
  let migrationDiscoveryCalled = false;
  overrides.readMigrationDirectory = async (directory, options) => {
    migrationDiscoveryCalled = true;
    assert.equal(directory, MIGRATIONS_DIRECTORY);
    assert.deepEqual(options, { withFileTypes: true });
    return [
      ...EXPECTED_MIGRATION_FILES.toReversed(),
      "schema-smoke.sql",
      "README.md",
    ].map((name) => ({ name, isFile: () => true }));
  };

  const result = await runRestoreDrill(
    {
      sourceUrl: SOURCE_URL,
      reportDir,
    },
    overrides,
  );

  const target = "signalframe_restore_drill_20260718t123456_0123456789ab";
  assert.equal(result.status, "passed");
  assert.equal(result.targetDatabase, target);
  assert.equal(migrationDiscoveryCalled, true);
  assert.deepEqual(
    calls.filter((call) => call.operation === "inventory"),
    [
      { operation: "inventory", database: "signalframe_ci" },
      { operation: "inventory", database: target },
    ],
  );
  assert.ok(
    calls.some(
      (call) =>
        call.operation === "dropdb" && call.args.at(-1) === target,
    ),
  );
  assert.ok(
    !calls.some(
      (call) =>
        call.operation === "dropdb" && call.args.includes("signalframe_ci"),
    ),
  );
  for (const call of calls.filter((entry) => Array.isArray(entry.args))) {
    assert.ok(!call.args.join(" ").includes("super-secret"));
    assert.ok(!call.args.join(" ").includes(SOURCE_URL));
  }

  const jsonReport = JSON.parse(await readFile(result.reportPaths.json, "utf8"));
  const markdownReport = await readFile(result.reportPaths.markdown, "utf8");
  assert.equal(jsonReport.cleanup.targetDatabaseDropped, true);
  assert.equal(jsonReport.cleanup.targetDatabaseAbsentAfterCleanup, true);
  assert.equal(jsonReport.cleanup.dumpDirectoryRemoved, true);
  assert.equal(jsonReport.verification.appTableCount, 44);
  assert.equal(jsonReport.verification.canonicalChecksumAlgorithm, "sha256");
  assert.doesNotMatch(JSON.stringify(jsonReport), /super-secret|postgres:\/\//);
  assert.doesNotMatch(markdownReport, /super-secret|postgres:\/\//);

  const toolNames = calls.map((call) => call.operation);
  assert.ok(toolNames.includes("pg_restore"));
  const replayAndSmokePaths = calls
    .filter(
      (call) =>
        call.operation === "psql" && call.args.includes("--file"),
    )
    .map((call) => call.args[call.args.indexOf("--file") + 1]);
  assert.deepEqual(
    replayAndSmokePaths.map((filePath) => path.basename(filePath)),
    [...EXPECTED_MIGRATION_FILES, "schema-smoke.sql"],
    "all migrations must replay in production order before schema smoke",
  );
  for (const filePath of replayAndSmokePaths) {
    assert.equal(path.isAbsolute(filePath), true);
    assert.equal(path.dirname(filePath), MIGRATIONS_DIRECTORY);
  }
  assert.deepEqual(
    (await readdir(reportDir)).sort(),
    [path.basename(result.reportPaths.json), path.basename(result.reportPaths.markdown)].sort(),
  );
});

test("migration replay stops at the first failed ordered migration and still cleans only its target", async () => {
  const sentinel = "FAILED_MIGRATION_RAW_DETAIL_MUST_NOT_ESCAPE";
  const { reportDir, calls, overrides } = await fakeHarness();
  const runTool = overrides.runTool;
  overrides.runTool = async (request) => {
    await runTool(request);
    const fileIndex = request.args.indexOf("--file");
    if (
      request.tool === "psql" &&
      fileIndex >= 0 &&
      path.basename(request.args[fileIndex + 1]) ===
        "0004_artifact_revision_output_locale.sql"
    ) {
      throw new Error(`${sentinel} super-secret`);
    }
  };

  try {
    const caught = await capturedFailure(() =>
      runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides),
    );
    const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));
    const replayedFiles = calls
      .filter(
        (call) =>
          call.operation === "psql" && call.args.includes("--file"),
      )
      .map((call) =>
        path.basename(call.args[call.args.indexOf("--file") + 1]),
      );
    const dropCalls = calls.filter((call) => call.operation === "dropdb");

    assert.deepEqual(replayedFiles, EXPECTED_MIGRATION_FILES.slice(0, 4));
    assert.equal(report.verification.migrationReplay, "failed");
    assert.equal(report.verification.schemaSmoke, "not_run");
    assert.deepEqual(report.failures, [
      {
        type: "postgres_process",
        code: "PG_TOOL_UNKNOWN_FAILURE",
        tool: "psql",
        termination: "unknown",
      },
    ]);
    assert.equal(report.cleanup.targetDatabaseDropped, true);
    assert.equal(report.cleanup.targetDatabaseAbsentAfterCleanup, true);
    assert.equal(report.cleanup.dumpDirectoryRemoved, true);
    assert.equal(report.cleanup.credentialDirectoryRemoved, true);
    assert.equal(dropCalls.length, 1);
    assert.equal(dropCalls[0].args.at(-1), report.targetDatabase);
    assert.equal(dropCalls[0].args.includes("signalframe_ci"), false);
    assert.doesNotMatch(caught.message, new RegExp(sentinel));
    assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});

test("a restored copy is replayed forward only from the version it declares", async () => {
  const { reportDir, calls, overrides } = await fakeHarness({
    appliedMigrationVersion: "0009_async_run_contract_version",
  });

  try {
    const result = await runRestoreDrill(
      { sourceUrl: SOURCE_URL, reportDir },
      overrides,
    );
    const report = JSON.parse(await readFile(result.reportPaths.json, "utf8"));
    const replayedFiles = calls
      .filter(
        (call) => call.operation === "psql" && call.args.includes("--file"),
      )
      .map((call) =>
        path.basename(call.args[call.args.indexOf("--file") + 1]),
      );

    assert.equal(result.status, "passed");
    // A restored dump is already at head. Re-running an earlier migration over
    // it is not a stricter check, it is a wrong one: 0014 re-narrows
    // async_runs_kind_check, which 0020 widened, and the application's own
    // runner skips already-applied migrations for exactly that reason.
    assert.equal(
      replayedFiles.includes("0009_async_run_contract_version.sql"),
      false,
    );
    assert.equal(
      replayedFiles.includes("0014_product_profile_synthesis.sql"),
      true,
    );
    assert.equal(replayedFiles.at(-1), "schema-smoke.sql");
    assert.equal(
      report.verification.migrationVersionAlreadyApplied,
      "0009_async_run_contract_version",
    );
    assert.equal(report.verification.migrationReplay, "passed");
    assert.equal(report.verification.schemaSmoke, "passed");
    assert.equal(
      report.verification.migrationsApplied,
      replayedFiles.length - 1,
    );
    assert.ok(
      report.verification.migrationsDiscovered >
        report.verification.migrationsApplied,
      "the report must state how much of the chain it actually replayed",
    );
    assert.match(
      await readFile(result.reportPaths.markdown, "utf8"),
      /Migrations applied to the restored copy: \d+ of \d+ \(restored copy already declared 0009_async_run_contract_version\)/,
    );
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});

test("forward-only replay selection matches the application migration runner", () => {
  const paths = [
    "/migrations/0009_async_run_contract_version.sql",
    "/migrations/0014_product_profile_synthesis.sql",
    "/migrations/0021_content_shadow_invocation_task.sql",
  ];

  assert.deepEqual(pendingMigrationPaths(paths, null), paths);
  assert.deepEqual(pendingMigrationPaths(paths, undefined), paths);
  assert.deepEqual(
    pendingMigrationPaths(paths, "0009_async_run_contract_version"),
    paths.slice(1),
  );
  assert.deepEqual(
    pendingMigrationPaths(paths, "0021_content_shadow_invocation_task"),
    [],
  );
});

test("migration discovery rejects path traversal before any database tool runs", async () => {
  const sentinel = "UNSAFE_MIGRATION_PATH_MUST_NOT_ESCAPE";
  const { reportDir, calls, overrides } = await fakeHarness();
  overrides.readMigrationDirectory = async () => [
    { name: `../${sentinel}.sql`, isFile: () => true },
  ];

  try {
    const caught = await capturedFailure(() =>
      runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides),
    );
    const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));

    assert.deepEqual(calls, []);
    assert.deepEqual(report.failures, [
      {
        type: "restore_drill",
        code: "RESTORE_MIGRATION_PATH_UNSAFE",
      },
    ]);
    assert.equal(report.cleanup.targetDatabaseDropped, false);
    assert.equal(report.cleanup.dumpDirectoryRemoved, true);
    assert.equal(report.cleanup.credentialDirectoryRemoved, true);
    assert.doesNotMatch(caught.message, new RegExp(sentinel));
    assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});

test("default PostgreSQL process adapters run through a private fake client toolchain", async () => {
  const fake = await createFakePgToolchain();
  try {
    const result = await withAmbientEnvironment(
      {
        AZURE_OPENAI_API_KEY: "ambient-azure-secret",
        CI_JOB_JWT: "ambient-ci-secret",
        GITHUB_TOKEN: "ambient-github-secret",
        GOOGLE_OAUTH_CLIENT_SECRET: "ambient-oauth-secret",
        OPENAI_API_KEY: "ambient-openai-secret",
        PGPASSWORD: "ambient-pg-password",
        PGSERVICE: "ambient-pg-service",
      },
      () =>
        runRestoreDrill({
          sourceUrl: SOURCE_URL,
          reportDir: fake.reportDir,
          pgBinDir: fake.bin,
        }),
    );
    const report = JSON.parse(await readFile(result.reportPaths.json, "utf8"));
    const state = await fake.readState();

    assert.equal(result.status, "passed");
    assert.equal(report.verification.appTableCount, 44);
    assert.equal(report.verification.migrationReplay, "passed");
    assert.equal(report.verification.schemaSmoke, "passed");
    assert.equal(report.cleanup.targetDatabaseDropped, true);
    assert.equal(report.cleanup.targetDatabaseAbsentAfterCleanup, true);
    assert.equal(report.cleanup.dumpDirectoryRemoved, true);
    assert.equal(report.cleanup.credentialDirectoryRemoved, true);
    assert.equal(state.exists, false);
    assert.ok(state.observations.length > 0);
    for (const observation of state.observations) {
      assert.equal(observation.hasPgPassword, false);
      assert.equal(observation.passfileMode, 0o600);
      assert.equal(observation.passfileHashMatches, true);
      assert.ok(observation.passfilePath);
      assert.ok(
        observation.envKeys.every((name) => CHILD_ENV_ALLOWLIST.has(name)),
        `unexpected child env keys: ${observation.envKeys.filter((name) => !CHILD_ENV_ALLOWLIST.has(name)).join(", ")}`,
      );
      for (const forbidden of [
        "AZURE_OPENAI_API_KEY",
        "CI_JOB_JWT",
        "DATABASE_URL",
        "GITHUB_TOKEN",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "OPENAI_API_KEY",
        "PGPASSWORD",
        "PGSERVICE",
      ]) {
        assert.equal(observation.envKeys.includes(forbidden), false);
      }
    }
    const passfilePaths = new Set(
      state.observations.map((observation) => observation.passfilePath),
    );
    assert.equal(passfilePaths.size, 1);
    await assert.rejects(stat([...passfilePaths][0]), { code: "ENOENT" });
  } finally {
    await rm(fake.root, { recursive: true, force: true });
  }
});

test("non-zero PostgreSQL exits use fixed evidence and discard raw stderr", async () => {
  const sentinel = "RAW_STDERR_MUST_NEVER_REACH_EVIDENCE";
  const fake = await createFakePgToolchain({
    failureTool: "psql",
    failureKind: "exit",
    exitCode: 23,
    rawStderr: `${sentinel}\n# hostile markdown\n\u001b[31mred\u001b[0m`,
  });
  try {
    const caught = await capturedFailure(() =>
      runRestoreDrill({
        sourceUrl: SOURCE_URL,
        reportDir: fake.reportDir,
        pgBinDir: fake.bin,
      }),
    );
    const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));
    const markdown = await readFile(caught.reportPaths.markdown, "utf8");
    const state = await fake.readState();

    assert.deepEqual(report.failures, [
      {
        type: "postgres_process",
        code: "PG_TOOL_EXIT_NONZERO",
        tool: "psql",
        termination: "exit",
        exitCode: 23,
      },
    ]);
    assert.equal(report.cleanup.dumpDirectoryRemoved, true);
    assert.equal(report.cleanup.credentialDirectoryRemoved, true);
    assert.doesNotMatch(caught.message, new RegExp(sentinel));
    assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
    assert.doesNotMatch(markdown, new RegExp(sentinel));
    assert.equal(state.observations.length, 1);
    await assert.rejects(stat(state.observations[0].passfilePath), {
      code: "ENOENT",
    });
  } finally {
    await rm(fake.root, { recursive: true, force: true });
  }
});

test("checksum subprocess signal termination is classified without stderr", async () => {
  const sentinel = "SIGNAL_STDERR_MUST_NEVER_REACH_EVIDENCE";
  const fake = await createFakePgToolchain({
    failureTool: "psql",
    failureWhen: "checksum",
    failureKind: "signal",
    signal: "SIGTERM",
    rawStderr: sentinel,
  });
  try {
    const caught = await capturedFailure(() =>
      runRestoreDrill({
        sourceUrl: SOURCE_URL,
        reportDir: fake.reportDir,
        pgBinDir: fake.bin,
      }),
    );
    const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));
    const state = await fake.readState();

    assert.deepEqual(report.failures, [
      {
        type: "postgres_process",
        code: "PG_TOOL_SIGNAL",
        tool: "psql",
        termination: "signal",
        signal: "SIGTERM",
      },
    ]);
    assert.equal(report.cleanup.dumpDirectoryRemoved, true);
    assert.equal(report.cleanup.credentialDirectoryRemoved, true);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
    await assert.rejects(stat(state.observations.at(-1).passfilePath), {
      code: "ENOENT",
    });
  } finally {
    await rm(fake.root, { recursive: true, force: true });
  }
});

test("spawn error and synchronous spawn throw have distinct fixed classifications", async (t) => {
  await t.test("asynchronous spawn error", async () => {
    const fake = await createFakePgToolchain({}, ["psql"]);
    try {
      const caught = await capturedFailure(() =>
        runRestoreDrill({
          sourceUrl: SOURCE_URL,
          reportDir: fake.reportDir,
          pgBinDir: fake.bin,
        }),
      );
      const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));

      assert.deepEqual(report.failures, [
        {
          type: "postgres_process",
          code: "PG_TOOL_SPAWN_ERROR",
          tool: "psql",
          termination: "spawn_error",
        },
      ]);
      assert.equal(report.cleanup.dumpDirectoryRemoved, true);
      assert.equal(report.cleanup.credentialDirectoryRemoved, true);
    } finally {
      await rm(fake.root, { recursive: true, force: true });
    }
  });

  await t.test("synchronous spawn throw", async () => {
    const fake = await createFakePgToolchain();
    try {
      const caught = await capturedFailure(() =>
        runRestoreDrill({
          sourceUrl: SOURCE_URL,
          reportDir: fake.reportDir,
          pgBinDir: path.join(fake.root, "invalid\0pg-bin"),
        }),
      );
      const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));

      assert.deepEqual(report.failures, [
        {
          type: "postgres_process",
          code: "PG_TOOL_SPAWN_THROW",
          tool: "psql",
          termination: "spawn_throw",
        },
      ]);
      assert.equal(report.cleanup.dumpDirectoryRemoved, true);
      assert.equal(report.cleanup.credentialDirectoryRemoved, true);
    } finally {
      await rm(fake.root, { recursive: true, force: true });
    }
  });
});

test("hostile operation and cleanup failures cannot break evidence generation", async (t) => {
  const sentinel = "HOSTILE_ERROR_TRAP_MUST_NOT_ESCAPE";

  await t.test("operation failure", async () => {
    const { reportDir, overrides } = await fakeHarness({
      failTool: "pg_dump",
      toolFailure: hostileThrownValue(sentinel),
    });
    try {
      const caught = await capturedFailure(() =>
        runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides),
      );
      const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));

      assert.deepEqual(report.failures, [
        {
          type: "postgres_process",
          code: "PG_TOOL_UNKNOWN_FAILURE",
          tool: "pg_dump",
          termination: "unknown",
        },
      ]);
      assert.doesNotMatch(caught.message, new RegExp(sentinel));
      assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
    } finally {
      await rm(reportDir, { recursive: true, force: true });
    }
  });

  await t.test("cleanup failure", async () => {
    const { reportDir, calls, overrides } = await fakeHarness();
    overrides.removeDumpDirectory = async () => {
      throw hostileThrownValue(sentinel);
    };
    try {
      const caught = await capturedFailure(() =>
        runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides),
      );
      const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));

      assert.deepEqual(report.failures, [
        {
          type: "cleanup",
          code: "RESTORE_DUMP_CLEANUP_FAILED",
        },
      ]);
      assert.equal(report.cleanup.credentialDirectoryRemoved, true);
      assert.doesNotMatch(caught.message, new RegExp(sentinel));
      assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
    } finally {
      const dumpCall = calls.find((call) => call.operation === "pg_dump");
      const dumpPath = dumpCall.args[dumpCall.args.indexOf("--file") + 1];
      await rm(path.dirname(dumpPath), { recursive: true, force: true });
      await rm(reportDir, { recursive: true, force: true });
    }
  });

  await t.test("credential cleanup failure", async () => {
    const { reportDir, overrides } = await fakeHarness();
    let credentialDirectory;
    overrides.removePgpassDirectory = async (directory) => {
      credentialDirectory = directory;
      throw hostileThrownValue(sentinel);
    };
    try {
      const caught = await capturedFailure(() =>
        runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides),
      );
      const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));

      assert.deepEqual(report.failures, [
        {
          type: "cleanup",
          code: "RESTORE_CREDENTIAL_CLEANUP_FAILED",
        },
      ]);
      assert.equal(report.cleanup.dumpDirectoryRemoved, true);
      assert.equal(report.cleanup.credentialDirectoryRemoved, false);
      assert.doesNotMatch(caught.message, new RegExp(sentinel));
      assert.doesNotMatch(JSON.stringify(report), new RegExp(sentinel));
    } finally {
      if (credentialDirectory) {
        await rm(credentialDirectory, { recursive: true, force: true });
      }
      await rm(reportDir, { recursive: true, force: true });
    }
  });
});

test("CLI failure output contains only fixed process classification", async () => {
  const sentinel = "CLI_RAW_STDERR_MUST_NOT_ESCAPE";
  const fake = await createFakePgToolchain({
    failureTool: "psql",
    failureKind: "exit",
    exitCode: 29,
    rawStderr: sentinel,
  });
  try {
    const child = spawnSync(process.execPath, [SCRIPT_PATH], {
      encoding: "utf8",
      env: {
        DATABASE_URL: SOURCE_URL,
        PATH: process.env.PATH,
        RESTORE_DRILL_PG_BIN: fake.bin,
        RESTORE_DRILL_REPORT_DIR: fake.reportDir,
      },
    });

    assert.equal(child.status, 1);
    assert.match(child.stderr, /type=postgres_process/);
    assert.match(child.stderr, /code=PG_TOOL_EXIT_NONZERO/);
    assert.match(child.stderr, /tool=psql/);
    assert.match(child.stderr, /termination=exit/);
    assert.match(child.stderr, /exit_code=29/);
    assert.doesNotMatch(child.stderr, new RegExp(sentinel));

    const evidence = (await readdir(fake.reportDir)).filter((name) =>
      name.endsWith(".json"),
    );
    assert.equal(evidence.length, 1);
    assert.doesNotMatch(
      await readFile(path.join(fake.reportDir, evidence[0]), "utf8"),
      new RegExp(sentinel),
    );
  } finally {
    await rm(fake.root, { recursive: true, force: true });
  }
});

test("dropdb failure is never swallowed or reported as successful cleanup", async () => {
  const { reportDir, overrides } = await fakeHarness({
    databaseExistsResults: [false, true, true],
    failTool: "dropdb",
  });

  let caught;
  try {
    await runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  assert.match(caught.message, /cleanup|dropdb/i);
  const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));
  assert.equal(report.status, "failed");
  assert.equal(report.cleanup.targetDatabaseDropped, false);
  assert.equal(report.cleanup.targetDatabaseAbsentAfterCleanup, false);
  assert.equal(report.cleanup.dumpDirectoryRemoved, true);
  assert.doesNotMatch(JSON.stringify(report), /super-secret/);
});

test("a generated target missing before controlled cleanup makes the drill fail", async () => {
  const { reportDir, overrides } = await fakeHarness({
    databaseExistsResults: [false, false],
  });

  await assert.rejects(
    runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides),
    /cleanup|missing/i,
  );
});

test("an existing generated-name collision is never reused or dropped", async () => {
  const { reportDir, calls, overrides } = await fakeHarness({
    databaseExistsResults: [true],
  });

  await assert.rejects(
    runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides),
    /code=RESTORE_TARGET_COLLISION/,
  );
  assert.equal(calls.some((call) => call.operation === "createdb"), false);
  assert.equal(calls.some((call) => call.operation === "dropdb"), false);
});

test("restore failure removes the generated target and sensitive dump directory", async () => {
  const { reportDir, calls, overrides } = await fakeHarness({
    databaseExistsResults: [false, true, false],
    failTool: "pg_restore",
  });

  let caught;
  try {
    await runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  const dumpCall = calls.find((call) => call.operation === "pg_dump");
  const dumpPath = dumpCall.args[dumpCall.args.indexOf("--file") + 1];
  await assert.rejects(stat(path.dirname(dumpPath)), { code: "ENOENT" });

  const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));
  assert.equal(report.status, "failed");
  assert.equal(report.cleanup.targetDatabaseDropped, true);
  assert.equal(report.cleanup.targetDatabaseAbsentAfterCleanup, true);
  assert.equal(report.cleanup.dumpDirectoryRemoved, true);
  assert.ok(!("dumpPath" in (report.artifacts ?? {})));
});

test("a restored inventory mismatch fails with explicit corruption evidence", async () => {
  const restoredInventory = emptyInventory();
  restoredInventory.tableCounts.workspaces = "1";
  const { reportDir, overrides } = await fakeHarness({ restoredInventory });

  let caught;
  try {
    await runRestoreDrill({ sourceUrl: SOURCE_URL, reportDir }, overrides);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof Error);
  const report = JSON.parse(await readFile(caught.reportPaths.json, "utf8"));
  assert.equal(report.status, "failed");
  assert.deepEqual(report.differences, [
    {
      category: "row_count",
      key: "workspaces",
      source: "0",
      restored: "1",
    },
  ]);
  assert.equal(report.cleanup.targetDatabaseAbsentAfterCleanup, true);
  assert.equal(report.cleanup.dumpDirectoryRemoved, true);
});

test("KEEP_BACKUP is the only explicit mode that retains a private dump", async () => {
  const { reportDir, calls, overrides } = await fakeHarness();
  let credentialDirectory;
  overrides.removePgpassDirectory = async (directory) => {
    credentialDirectory = directory;
    assert.equal((await stat(path.join(directory, "pgpass"))).mode & 0o777, 0o600);
    await rm(directory, { recursive: true });
  };

  const result = await runRestoreDrill(
    { sourceUrl: SOURCE_URL, reportDir, keepBackup: true },
    overrides,
  );
  const report = JSON.parse(await readFile(result.reportPaths.json, "utf8"));
  const dumpCall = calls.find((call) => call.operation === "pg_dump");
  const dumpPath = dumpCall.args[dumpCall.args.indexOf("--file") + 1];

  assert.equal(report.cleanup.dumpDirectoryRemoved, false);
  assert.equal(report.cleanup.credentialDirectoryRemoved, true);
  assert.equal(report.artifacts.backupRetained, true);
  assert.equal(report.artifacts.backupPath, dumpPath);
  assert.equal((await stat(dumpPath)).isFile(), true);
  await assert.rejects(stat(credentialDirectory), { code: "ENOENT" });
  await rm(path.dirname(dumpPath), { recursive: true });
});
