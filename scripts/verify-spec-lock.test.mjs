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

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function makeFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "spec-lock-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  write(root, "package.json", JSON.stringify({ version: "0.2.0" }));
  write(
    root,
    "openapi/mvp.yaml",
    [
      "openapi: 3.1.0",
      "info:",
      "  title: fixture",
      "  version: 0.2.0",
      "paths:",
      "  /projects:",
      "    get:",
      "      operationId: listProjects",
      "      responses:",
      "        '200':",
      "          description: ok",
      "",
    ].join("\n"),
  );
  write(
    root,
    "packages/contracts/src/zod/health.ts",
    'export const CONTRACT_VERSION = "2026-07-18";\n',
  );
  write(
    root,
    "packages/engine/src/rules/.gitkeep",
    "",
  );

  const migrations = options.migrations ?? {
    "0001_init.sql":
      "CREATE TABLE IF NOT EXISTS app.workspaces (id uuid PRIMARY KEY);\n",
    "0010_growth_audit_slice1.sql":
      "CREATE TABLE IF NOT EXISTS app.capability_runs (async_run_id uuid PRIMARY KEY);\n",
  };
  for (const [name, sql] of Object.entries(migrations)) {
    write(root, `packages/db/migrations/${name}`, sql);
  }

  const authorityReadme = write(root, "authority/README.md", "fixture authority\n");
  const authorityVerifier = write(
    root,
    "authority/scripts/verify-spec.mjs",
    [
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'const appRootIndex = process.argv.indexOf("--app-root");',
      'if (appRootIndex === -1 || !process.argv[appRootIndex + 1]) process.exit(9);',
      'writeFileSync(join(process.argv[appRootIndex + 1], "authority-ran"), "yes");',
      "",
    ].join("\n"),
  );

  const tables = options.tables ?? ["workspaces", "capability_runs"];
  const lock = {
    lockFormat: 2,
    productVersion: "0.2.0",
    contractVersion: "2026-07-18",
    authorityRoot: "authority",
    migrationDirectory: "packages/db/migrations",
    migrationFilePattern: "^[0-9]{4}_.+\\.sql$",
    authorityFiles: {
      "README.md": sha256(authorityReadme),
      "scripts/verify-spec.mjs": sha256(authorityVerifier),
    },
    apiOperations: ["listProjects"],
    asyncOperations: [],
    tables,
    rules: [],
  };
  const lockPath = options.lockPath ?? "scripts/custom-lock.json";
  write(root, lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  return { root, lock, lockPath };
}

function runVerifier(fixture, extraArguments = []) {
  return spawnSync(
    process.execPath,
    [verifier, "--root", fixture.root, ...extraArguments],
    { encoding: "utf8" },
  );
}

test("accepts a caller-supplied lock and scans the complete ordered migration set", (t) => {
  const fixture = makeFixture(t);
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 tables/);
  assert.equal(readFileSync(join(fixture.root, "authority-ran"), "utf8"), "yes");
});

test("retains scripts/spec-v0.2-lock.json as the default lock path", (t) => {
  const fixture = makeFixture(t, { lockPath: "scripts/spec-v0.2-lock.json" });
  const result = runVerifier(fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Spec lock passed/);
});

test("rejects a table declared by the lock but absent from every migration", (t) => {
  const fixture = makeFixture(t, {
    tables: ["workspaces", "capability_runs", "audit_runs"],
  });
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /application tables drifted/i);
});

test("rejects a table created by more than one ordered migration", (t) => {
  const fixture = makeFixture(t, {
    migrations: {
      "0001_init.sql":
        "CREATE TABLE IF NOT EXISTS app.workspaces (id uuid PRIMARY KEY);\n",
      "0010_growth_audit.sql":
        "CREATE TABLE IF NOT EXISTS app.workspaces (id uuid PRIMARY KEY);\n",
    },
    tables: ["workspaces"],
  });
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /table workspaces is created by multiple migrations/i);
});

test("rejects duplicate migration ordinals", (t) => {
  const fixture = makeFixture(t, {
    migrations: {
      "0010_growth_audit.sql":
        "CREATE TABLE IF NOT EXISTS app.audit_runs (id uuid PRIMARY KEY);\n",
      "0010_other.sql":
        "CREATE TABLE IF NOT EXISTS app.site_pages (id uuid PRIMARY KEY);\n",
    },
    tables: ["audit_runs", "site_pages"],
  });
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate migration ordinal 0010/i);
});

test("rejects an authority file whose content no longer matches the lock", (t) => {
  const fixture = makeFixture(t);
  write(fixture.root, "authority/README.md", "changed after review\n");
  const result = runVerifier(fixture, ["--lock", fixture.lockPath]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /authority file drifted/i);
});
