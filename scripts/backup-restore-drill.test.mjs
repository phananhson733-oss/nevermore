import assert from "node:assert/strict";
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

import {
  APP_TABLES,
  INTEGRITY_PROBES,
  assertSafeGeneratedTargetName,
  buildCanonicalCopySql,
  buildTableCountSql,
  compareInventories,
  makeTargetDatabaseName,
  parseSourceDatabaseUrl,
  redactSensitiveText,
  runRestoreDrill,
} from "./backup-restore-drill.mjs";

const SOURCE_URL =
  "postgres://local_user:super-secret@localhost:5432/signalframe_ci";

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
  restoredInventory = emptyInventory(),
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
          throw new Error(`${tool} deliberately failed with super-secret`);
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

test("inventory covers exactly the 28 app tables and explicit object metadata", () => {
  assert.equal(APP_TABLES.length, 28);
  assert.equal(new Set(APP_TABLES).size, 28);
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

test("runRestoreDrill verifies then drops only its generated target and writes safe evidence", async () => {
  const { reportDir, calls, overrides } = await fakeHarness();

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
  assert.equal(jsonReport.verification.appTableCount, 28);
  assert.equal(jsonReport.verification.canonicalChecksumAlgorithm, "sha256");
  assert.doesNotMatch(JSON.stringify(jsonReport), /super-secret|postgres:\/\//);
  assert.doesNotMatch(markdownReport, /super-secret|postgres:\/\//);

  const toolNames = calls.map((call) => call.operation);
  assert.ok(toolNames.includes("pg_restore"));
  assert.equal(
    calls.filter(
      (call) =>
        call.operation === "psql" && call.args.includes("--file"),
    ).length,
    2,
    "migration replay and schema smoke must both run",
  );
  assert.deepEqual(
    (await readdir(reportDir)).sort(),
    [path.basename(result.reportPaths.json), path.basename(result.reportPaths.markdown)].sort(),
  );
});

test("default PostgreSQL process adapters run through a private fake client toolchain", async () => {
  const fakeRoot = await mkdtemp(path.join(tmpdir(), "signalframe-fake-pg-"));
  const fakeBin = path.join(fakeRoot, "bin");
  const reportDir = path.join(fakeRoot, "reports");
  const statePath = path.join(fakeRoot, "state.json");
  await mkdir(fakeBin, { recursive: true });
  await writeFile(statePath, JSON.stringify({ exists: false }));

  const fakeClient = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const statePath = process.env.FAKE_PG_STATE;
const readState = () => JSON.parse(fs.readFileSync(statePath, "utf8"));
const writeState = (state) => fs.writeFileSync(statePath, JSON.stringify(state));
const argAfter = (flag) => args[args.indexOf(flag) + 1];
if (tool === "pg_dump") {
  fs.writeFileSync(argAfter("--file"), "fake custom dump");
} else if (tool === "createdb") {
  writeState({ exists: true });
} else if (tool === "dropdb") {
  writeState({ exists: false });
} else if (tool === "pg_restore") {
  if (!fs.existsSync(args.at(-1))) process.exit(2);
} else if (tool === "psql") {
  const commandIndex = args.indexOf("--command");
  if (commandIndex >= 0) {
    const sql = args[commandIndex + 1];
    if (sql.includes("from pg_database")) {
      process.stdout.write((readState().exists ? "yes" : "no") + "\\t1\\n");
    } else if (sql.includes("count(*)::text")) {
      for (const match of sql.matchAll(/select '([a-z_]+)' as key/g)) {
        process.stdout.write(match[1] + "\\t0\\n");
      }
    } else if (sql.startsWith("copy (")) {
      process.stdout.write("stable canonical row\\n");
    }
  }
}
`;
  for (const tool of ["psql", "pg_dump", "createdb", "pg_restore", "dropdb"]) {
    await writeFile(path.join(fakeBin, tool), fakeClient, { mode: 0o755 });
  }

  process.env.FAKE_PG_STATE = statePath;
  try {
    const result = await runRestoreDrill({
      sourceUrl: SOURCE_URL,
      reportDir,
      pgBinDir: fakeBin,
    });
    const report = JSON.parse(await readFile(result.reportPaths.json, "utf8"));

    assert.equal(result.status, "passed");
    assert.equal(report.verification.appTableCount, 28);
    assert.equal(report.verification.migrationReplay, "passed");
    assert.equal(report.verification.schemaSmoke, "passed");
    assert.equal(report.cleanup.targetDatabaseDropped, true);
    assert.equal(report.cleanup.targetDatabaseAbsentAfterCleanup, true);
    assert.equal(report.cleanup.dumpDirectoryRemoved, true);
    assert.deepEqual(JSON.parse(await readFile(statePath, "utf8")), {
      exists: false,
    });
  } finally {
    delete process.env.FAKE_PG_STATE;
    await rm(fakeRoot, { recursive: true });
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
    /already exists|refusing/i,
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

  const result = await runRestoreDrill(
    { sourceUrl: SOURCE_URL, reportDir, keepBackup: true },
    overrides,
  );
  const report = JSON.parse(await readFile(result.reportPaths.json, "utf8"));
  const dumpCall = calls.find((call) => call.operation === "pg_dump");
  const dumpPath = dumpCall.args[dumpCall.args.indexOf("--file") + 1];

  assert.equal(report.cleanup.dumpDirectoryRemoved, false);
  assert.equal(report.artifacts.backupRetained, true);
  assert.equal(report.artifacts.backupPath, dumpPath);
  assert.equal((await stat(dumpPath)).isFile(), true);
  await rm(path.dirname(dumpPath), { recursive: true });
});
