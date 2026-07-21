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
const authoritySql = readFileSync(join(authorityRoot, "schema.sql"), "utf8");
const authorityTables = [
  ...authoritySql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
  ),
].map((match) => match[1]);

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
