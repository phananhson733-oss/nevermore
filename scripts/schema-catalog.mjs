/**
 * Static PostgreSQL catalog for the checked-in migration chain.
 *
 * The restore drill builds SQL by hand (`select ... from app."<table>" order by
 * "<column>"`). Nothing used to compare that SQL against the schema it runs on,
 * so an integrity probe that ordered `app.capability_runs` by a non-existent
 * `id` column shipped and stayed red for the whole life of the gate while its
 * stubbed unit test stayed green. This module parses the checked-in migration
 * chain into `{table -> columns, primary key}` so a database-free test can
 * reject probe SQL that names a table or column the schema does not have.
 *
 * The parser is deliberately narrow. It understands exactly the DDL the chain
 * uses today (`CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`) and throws on any
 * statement that could invalidate the catalog (`DROP COLUMN`, `RENAME`,
 * `DROP TABLE`, `CREATE TABLE ... AS`). A future migration that needs one of
 * those must teach the parser first; it can never silently make the catalog a
 * stale over-approximation that lets bad probe SQL through.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS_DIRECTORY = path.resolve(
  scriptDirectory,
  "../packages/db/migrations",
);

/** Only this schema is catalogued; `pgboss` and `public` are not app contract. */
export const CATALOG_SCHEMA = "app";

/** Not a migration: a fixture-driven constraint smoke that always rolls back. */
const NON_MIGRATION_FILES = new Set(["schema-smoke.sql"]);

/**
 * Statements whose effect the parser cannot model. Encountering one is a hard
 * error rather than a silent skip: an unmodelled `DROP COLUMN` would leave the
 * catalog claiming a column that no longer exists, which is exactly the failure
 * this module exists to prevent.
 */
const UNSUPPORTED_DDL = [
  [/\bdrop\s+column\b/i, "DROP COLUMN"],
  [/\brename\s+column\b/i, "RENAME COLUMN"],
  [/\balter\s+table\b[^;]*\brename\b/i, "ALTER TABLE ... RENAME"],
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\bcreate\s+(?:unlogged\s+|temp\w*\s+)*table\b[^;(]*\bas\b/i,
    "CREATE TABLE ... AS"],
  [
    /\bselect\b(?:(?!\binsert\s+into\b)[^;])*\binto\s+(?:strict\s+)?app\./i,
    "SELECT ... INTO app.*",
  ],
];

const CONSTRAINT_ITEM_KEYWORDS = new Set([
  "check",
  "constraint",
  "deferrable",
  "exclude",
  "foreign",
  "initially",
  "like",
  "primary",
  "unique",
]);

/**
 * Replace every comment, single-quoted literal, and dollar-quoted body with a
 * placeholder so DDL keyword scanning never trips over prose or PL/pgSQL. The
 * removed dollar-quoted bodies are returned separately: they are not parsed for
 * structure, but they are still scanned for unsupported DDL so a `DROP COLUMN`
 * hidden inside a `DO $$ ... $$` block cannot escape the guard.
 */
export function scanSql(text) {
  let ddl = "";
  const hidden = [];
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (character === "-" && text[index + 1] === "-") {
      const newline = text.indexOf("\n", index);
      index = newline === -1 ? text.length : newline;
      ddl += " ";
      continue;
    }

    if (character === "/" && text[index + 1] === "*") {
      let depth = 1;
      index += 2;
      while (index < text.length && depth > 0) {
        if (text[index] === "/" && text[index + 1] === "*") {
          depth += 1;
          index += 2;
        } else if (text[index] === "*" && text[index + 1] === "/") {
          depth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (depth > 0) throw new Error("Unterminated SQL block comment.");
      ddl += " ";
      continue;
    }

    if (character === "'") {
      index += 1;
      let closed = false;
      while (index < text.length) {
        if (text[index] === "'") {
          if (text[index + 1] === "'") {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) throw new Error("Unterminated SQL string literal.");
      ddl += " '' ";
      continue;
    }

    if (character === "$") {
      const tagMatch = /^\$\$|^\$[a-z_][a-z0-9_]*\$/i.exec(text.slice(index));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = text.indexOf(tag, index + tag.length);
        if (end === -1) throw new Error("Unterminated dollar-quoted SQL body.");
        hidden.push(text.slice(index + tag.length, end));
        index = end + tag.length;
        ddl += " '' ";
        continue;
      }
    }

    ddl += character;
    index += 1;
  }

  return { ddl, hidden: hidden.join("\n;\n") };
}

function assertSupportedDdl(text, origin) {
  for (const [pattern, name] of UNSUPPORTED_DDL) {
    if (pattern.test(text)) {
      throw new Error(
        `${origin} uses ${name}, which the static schema catalog cannot model. ` +
          "Teach scripts/schema-catalog.mjs about it before landing the migration.",
      );
    }
  }
}

function readBalancedParens(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) return { body: text.slice(openIndex + 1, index), end: index };
    }
  }
  throw new Error("Unbalanced parentheses in CREATE TABLE body.");
}

function splitTopLevel(body) {
  const items = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

function parseCreateTableBody(body) {
  const columns = [];
  let primaryKey = null;

  for (const item of splitTopLevel(body)) {
    const leading = /^([a-z_][a-z0-9_]*)/i.exec(item);
    if (!leading) continue;
    const keyword = leading[1].toLowerCase();

    if (CONSTRAINT_ITEM_KEYWORDS.has(keyword)) {
      const tableLevelPrimaryKey = /^primary\s+key\s*\(([^)]*)\)/i.exec(item);
      if (tableLevelPrimaryKey) {
        primaryKey = splitTopLevel(tableLevelPrimaryKey[1]).map((column) =>
          column.toLowerCase(),
        );
      }
      continue;
    }

    columns.push(keyword);
    if (/\bprimary\s+key\b/i.test(item)) primaryKey = [keyword];
  }

  return { columns, primaryKey };
}

/**
 * Build the catalog from already-read migration SQL, newest statement wins.
 * Exported separately from the filesystem loader so tests can drive the parser
 * with synthetic DDL and prove it rejects what it cannot model.
 */
export function buildSchemaCatalog(migrations) {
  const tables = new Map();

  for (const { name, sql } of migrations) {
    const { ddl, hidden } = scanSql(sql);
    assertSupportedDdl(ddl, name);
    assertSupportedDdl(hidden, `${name} (dollar-quoted body)`);

    const createTable = new RegExp(
      `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${CATALOG_SCHEMA}\\.([a-z_][a-z0-9_]*)\\s*\\(`,
      "gi",
    );
    let match;
    while ((match = createTable.exec(ddl)) !== null) {
      const table = match[1].toLowerCase();
      const { body, end } = readBalancedParens(ddl, createTable.lastIndex - 1);
      createTable.lastIndex = end + 1;
      const { columns, primaryKey } = parseCreateTableBody(body);
      const existing = tables.get(table);
      if (existing) {
        for (const column of columns) existing.columns.add(column);
        continue;
      }
      tables.set(table, {
        table,
        columns: new Set(columns),
        primaryKey,
        definedBy: name,
      });
    }

    const alterTable = new RegExp(
      `alter\\s+table\\s+(?:only\\s+)?${CATALOG_SCHEMA}\\.([a-z_][a-z0-9_]*)([^;]*);`,
      "gi",
    );
    while ((match = alterTable.exec(ddl)) !== null) {
      const table = match[1].toLowerCase();
      const addColumn = /\badd\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
      let added;
      while ((added = addColumn.exec(match[2])) !== null) {
        const entry = tables.get(table);
        if (!entry) {
          throw new Error(
            `${name} adds a column to unknown table ${CATALOG_SCHEMA}.${table}.`,
          );
        }
        entry.columns.add(added[1].toLowerCase());
      }
    }
  }

  return tables;
}

export async function listMigrationFiles(readDirectory = readdir) {
  const entries = await readDirectory(MIGRATIONS_DIRECTORY, {
    withFileTypes: true,
  });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".sql") &&
        !NON_MIGRATION_FILES.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

export async function loadSchemaCatalog() {
  const names = await listMigrationFiles();
  const migrations = [];
  for (const name of names) {
    migrations.push({
      name,
      sql: await readFile(path.join(MIGRATIONS_DIRECTORY, name), "utf8"),
    });
  }
  return buildSchemaCatalog(migrations);
}

/**
 * Report every `app.<table>` / `"<column>"` reference in a generated statement
 * that the catalog does not contain. Callers pass the SQL the drill actually
 * emits, so a typo in either the probe declaration or the SQL builder is caught.
 */
export function missingSchemaReferences(catalog, references) {
  const missing = [];
  for (const table of references.tables) {
    if (!catalog.has(table)) {
      missing.push(`table ${CATALOG_SCHEMA}.${table}`);
    }
  }
  if (missing.length > 0) return missing;
  for (const table of references.tables) {
    for (const column of references.columns) {
      if (!catalog.get(table).columns.has(column)) {
        missing.push(`column ${CATALOG_SCHEMA}.${table}.${column}`);
      }
    }
  }
  return missing;
}
