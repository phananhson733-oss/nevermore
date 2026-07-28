import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSchemaCatalog } from "./schema-catalog.mjs";

export const MIGRATION_VERSION_VIEW_PATTERN =
  /^CREATE\s+OR\s+REPLACE\s+VIEW\s+app\.schema_migration_version\s+AS\s+SELECT\s+'([^']+)'::text\s+AS\s+migration_version$/is;

export function executableSqlStatements(source) {
  const statements = [];
  let statement = "";
  let state = "code";
  let blockCommentDepth = 0;
  let dollarDelimiter = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        statement += character;
        state = "code";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) state = "code";
      } else if (character === "\n") {
        statement += character;
      }
      continue;
    }

    if (state === "single-quote") {
      statement += character;
      if (character === "'" && next === "'") {
        statement += next;
        index += 1;
      } else if (character === "'") {
        state = "code";
      }
      continue;
    }

    if (state === "double-quote") {
      statement += character;
      if (character === '"' && next === '"') {
        statement += next;
        index += 1;
      } else if (character === '"') {
        state = "code";
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (source.startsWith(dollarDelimiter, index)) {
        statement += dollarDelimiter;
        index += dollarDelimiter.length - 1;
        state = "code";
      } else {
        statement += character;
      }
      continue;
    }

    if (character === "-" && next === "-") {
      state = "line-comment";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      statement += " ";
      state = "block-comment";
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (character === "'") {
      statement += character;
      state = "single-quote";
      continue;
    }
    if (character === '"') {
      statement += character;
      state = "double-quote";
      continue;
    }
    if (character === "$") {
      const delimiter = source
        .slice(index)
        .match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (delimiter) {
        statement += delimiter;
        dollarDelimiter = delimiter;
        index += delimiter.length - 1;
        state = "dollar-quote";
        continue;
      }
    }
    if (character === ";") {
      const executable = statement.trim();
      if (executable) statements.push(executable);
      statement = "";
      continue;
    }
    statement += character;
  }

  const executable = statement.trim();
  if (executable) statements.push(executable);
  return statements;
}

export function migrationExecutableContract(source, migrationVersion) {
  const statements = executableSqlStatements(source);
  assert.match(
    statements[0] ?? "",
    /^BEGIN$/i,
    `${migrationVersion} must begin with BEGIN and have no executable prologue`,
  );
  assert.match(
    statements.at(-1) ?? "",
    /^COMMIT$/i,
    `${migrationVersion} must end with COMMIT and have no executable epilogue`,
  );

  const migrationViews = statements
    .map((statement, index) => ({
      index,
      version: statement.match(MIGRATION_VERSION_VIEW_PATTERN)?.[1],
    }))
    .filter(({ version }) => version !== undefined);
  assert.equal(
    migrationViews.length,
    1,
    `${migrationVersion} must declare exactly one schema_migration_version projection`,
  );
  assert.equal(
    migrationViews[0]?.version,
    migrationVersion,
    `${migrationVersion} must declare its exact schema_migration_version`,
  );
  assert.ok(
    (migrationViews[0]?.index ?? -1) > 0 &&
      (migrationViews[0]?.index ?? statements.length) < statements.length - 1,
    `${migrationVersion} must place schema_migration_version inside its transaction`,
  );
  return statements;
}

export function listOrderedMigrationSources({
  root,
  migrationDirectory = "packages/db/migrations",
  migrationFilePattern = "^[0-9]{4}_.+\\.sql$",
}) {
  const directory = resolve(root, migrationDirectory);
  const pattern = new RegExp(migrationFilePattern);
  const names = readdirSync(directory)
    .filter((name) => pattern.test(name))
    .sort();
  assert.ok(names.length > 0, "at least one ordered migration is required");

  const ordinals = new Map();
  return names.map((name) => {
    const ordinal = name.match(/^([0-9]{4})_/)?.[1];
    assert.ok(ordinal, `migration lacks a four-digit ordinal: ${name}`);
    assert.ok(
      !ordinals.has(ordinal),
      `duplicate migration ordinal ${ordinal}: ${ordinals.get(ordinal)} and ${name}`,
    );
    ordinals.set(ordinal, name);
    const migrationVersion = name.replace(/\.sql$/, "");
    const sql = readFileSync(join(directory, name), "utf8");
    migrationExecutableContract(sql, migrationVersion);
    return { name, migrationVersion, sql };
  });
}

export function migrationTableInventory(migrations) {
  const tableOwners = new Map();
  for (const migration of migrations) {
    const stripped = migration.sql
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\r\n]*/g, " ");
    for (const match of stripped.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?app\.([a-z][a-z0-9_]*)\s*\(/gi,
    )) {
      const table = match[1].toLowerCase();
      assert.ok(
        !tableOwners.has(table),
        `table ${table} is created by multiple migrations: ${tableOwners.get(table)} and ${migration.name}`,
      );
      tableOwners.set(table, migration.name);
    }
  }

  const catalog = buildSchemaCatalog(migrations);
  assert.deepEqual(
    [...catalog.keys()].sort(),
    [...tableOwners.keys()].sort(),
    "migration regex inventory and schema catalog inventory disagree",
  );
  return [...catalog.keys()];
}

export function renderAuthoritySchema(migrations) {
  const header = [
    "-- Nevermore active authority schema.",
    "-- GENERATED FILE: do not hand-edit.",
    "-- Source: ordered packages/db/migrations/*.sql.",
    "-- Regenerate with authority/implementation-spec-v0.4/scripts/generate-schema.mjs.",
    "",
  ].join("\n");
  const body = migrations
    .map(
      ({ name, sql }) =>
        [
          `-- BEGIN EXACT ORDERED MIGRATION ${name}`,
          sql.trimEnd(),
          `-- END EXACT ORDERED MIGRATION ${name}`,
          "",
        ].join("\n"),
    )
    .join("\n");
  return `${header}${body}`;
}

export function extractOpenApiOperations(source) {
  return [
    ...source.matchAll(/^\s+operationId:\s*([a-z][A-Za-z0-9]+)\s*$/gm),
  ].map((match) => match[1]);
}
