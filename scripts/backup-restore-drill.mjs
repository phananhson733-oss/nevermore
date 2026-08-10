#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(
  scriptDirectory,
  "../packages/db/migrations",
);
const schemaSmokePath = path.resolve(
  migrationsDirectory,
  "schema-smoke.sql",
);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"]);
const SAFE_SOURCE_DATABASE =
  /^(?:signalframe_ci(?:_[a-z0-9]+)*|signalframe_codex_[a-z0-9_]+)$/;
const GENERATED_TARGET_NAME =
  /^signalframe_restore_drill_\d{8}t\d{6}_[a-f0-9]{12}$/;
const DUMP_DIRECTORY_PREFIX = "signalframe-restore-drill-";
const PGPASS_DIRECTORY_PREFIX = "signalframe-restore-pgpass-";
const MAX_POSTGRES_OUTPUT_BYTES = 16 * 1024 * 1024;
const POSTGRES_ENV_ALLOWLIST = [
  "COMSPEC",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
];
const trustedFailures = new WeakMap();
const failureReportPaths = new WeakMap();

/**
 * Every table in the `app` schema, which is the whole tenant-visible contract
 * the restore drill has to prove it can bring back. This list is not curated:
 * `scripts/backup-restore-drill.test.mjs` asserts it equals the table set
 * parsed out of the checked-in migration chain, so a new migration that adds a
 * table and forgets this list fails the unit gate rather than silently
 * shrinking what the drill counts. There are no intentional exclusions.
 *
 * Not listed, and deliberately so: `pgboss` owns its own schema and is queue
 * state rather than tenant data. `pg_dump`/`pg_restore` still carry it, but its
 * row counts are transient by construction and would make the inventory
 * comparison flap, so it is verified by restore success rather than by count.
 */
export const APP_TABLES = [
  "workspaces",
  "operator_profiles",
  "client_projects",
  "sites",
  "icp_profiles",
  "source_connections",
  "source_credentials",
  "oauth_intents",
  "import_previews",
  "async_runs",
  "collection_runs",
  "data_snapshots",
  "normalized_observations",
  "provider_discrepancies",
  "diagnostic_runs",
  "diagnostic_run_rules",
  "analysis_invocations",
  "evidence",
  "findings",
  "finding_observations",
  "finding_targets",
  "finding_review_events",
  "actions",
  "action_override_audit",
  "execution_artifacts",
  "artifact_revisions",
  "export_bundles",
  "idempotency_keys",
  "telemetry_events",
  "capability_runs",
  "audit_runs",
  "audit_module_results",
  "site_pages",
  "page_snapshots",
  "product_profile_runs",
  "product_profile_invocation_attempts",
  "keyword_occurrences",
  "keyword_entities",
  "keyword_entity_sources",
  "competitor_entities",
  "competitor_origin_occurrences",
  "flow_shadow_runs",
  "flow_shadow_research_packs",
  "flow_shadow_qa_gates",
  "delivery_authorization_grants",
  "artifact_approval_events",
  "publication_destinations",
  "publication_preview_events",
  "publication_attempts",
  "publication_receipts",
  "measurement_windows",
  "measurement_gsc_dimensions",
  "measurement_ga4_dimensions",
  "measurement_geo_dimensions",
  "measurement_utm_identities",
  "measurement_ga4_campaigns",
  "topic_model_revisions",
  "topic_node_identities",
  "topic_node_revisions",
  "topic_cluster_aliases",
  "topic_node_successors",
  "keyword_review_decisions",
  "keyword_relation_identities",
  "keyword_relation_candidates",
  "keyword_relation_decisions",
  "action_execution_step_definitions",
  "action_execution_state_events",
  "competitor_monitor_settings",
  "competitor_monitor_runs",
  "competitor_monitor_evaluations",
  "competitor_monitor_signals",
  "geo_query_observations",
  "geo_citation_occurrences",
  "backlink_authority_snapshots",
  "backlink_facts",
  "backlink_page_metrics",
  "analysis_refresh_runs",
  "analysis_refresh_steps",
  "topic_model_generation_runs",
  "topic_model_generation_invocation_attempts",
  "keyword_governance_suggestion_generation_runs",
  "keyword_governance_suggestion_invocation_attempts",
  "keyword_review_suggestions",
  "keyword_governance_schedule_requests",
];

/**
 * Columns whose corruption a row count and a whole-row checksum would both
 * survive in a partial restore: object-storage keys and content hashes. Each
 * probe declares `key`, the table's real primary key, because that is both the
 * identity emitted with the payload and the deterministic ordering the checksum
 * depends on. `key` is not decorative: the unit gate asserts it matches the
 * primary key parsed from the migration chain, which is how a probe that
 * assumed a non-existent `id` column is now impossible to land.
 */
export const INTEGRITY_PROBES = [
  {
    id: "icp_profiles.content-hash",
    table: "icp_profiles",
    key: ["id"],
    columns: ["content_hash"],
  },
  {
    id: "import_previews.raw-object",
    table: "import_previews",
    key: ["id"],
    columns: ["raw_object_key", "file_checksum"],
  },
  {
    id: "data_snapshots.raw-object",
    table: "data_snapshots",
    key: ["id"],
    columns: ["raw_object_key", "checksum"],
  },
  {
    id: "capability_runs.input-manifest-hash",
    table: "capability_runs",
    key: ["async_run_id"],
    columns: ["input_manifest_hash"],
  },
  {
    id: "page_snapshots.content-hash",
    table: "page_snapshots",
    key: ["id"],
    columns: ["content_hash"],
  },
  {
    id: "execution_artifacts.content-hash",
    table: "execution_artifacts",
    key: ["id"],
    columns: ["content_hash"],
  },
  {
    id: "artifact_revisions.content-hash",
    table: "artifact_revisions",
    key: ["id"],
    columns: ["content_hash"],
  },
  {
    id: "action-execution-step-definitions.hashes",
    table: "action_execution_step_definitions",
    key: ["id"],
    columns: ["definition_hash", "request_hash"],
  },
  {
    id: "action-execution-state-events.request-hash",
    table: "action_execution_state_events",
    key: ["id"],
    columns: ["request_hash"],
  },
  {
    id: "export_bundles.object-metadata",
    table: "export_bundles",
    key: ["id"],
    columns: ["object_key", "checksum"],
  },
  {
    id: "flow_shadow_runs.content-hash",
    table: "flow_shadow_runs",
    key: ["id"],
    columns: ["content_hash"],
  },
  {
    id: "flow_shadow_research_packs.content-hash",
    table: "flow_shadow_research_packs",
    key: ["id"],
    columns: ["content_hash"],
  },
  {
    id: "delivery_authorization_grants.authority-hashes",
    table: "delivery_authorization_grants",
    key: ["id"],
    columns: ["requested_scope_hash", "authorization_snapshot_hash"],
  },
  {
    id: "artifact_approval_events.approval-hashes",
    table: "artifact_approval_events",
    key: ["id"],
    columns: [
      "artifact_content_hash",
      "qa_gate_snapshot_hash",
      "customer_acknowledgement_hash",
    ],
  },
  {
    id: "publication_destinations.authority-hashes",
    table: "publication_destinations",
    key: ["id"],
    columns: ["provider_scope_hash", "authorization_snapshot_hash"],
  },
  {
    id: "publication_preview_events.frozen-hashes",
    table: "publication_preview_events",
    key: ["id"],
    columns: [
      "preview_checksum",
      "content_checksum",
      "facts_hash",
      "request_hash",
    ],
  },
  {
    id: "publication_attempts.frozen-hashes",
    table: "publication_attempts",
    key: ["id"],
    columns: [
      "approved_artifact_content_hash",
      "authorization_snapshot_hash",
      "preview_checksum",
      "content_checksum",
      "request_hash",
    ],
  },
  {
    id: "publication_receipts.frozen-content-hashes",
    table: "publication_receipts",
    key: ["id"],
    columns: ["artifact_content_hash", "content_checksum"],
  },
  {
    id: "measurement_windows.frozen-hashes",
    table: "measurement_windows",
    key: ["id"],
    columns: [
      "artifact_content_hash",
      "content_checksum",
      "result_hash",
    ],
  },
  {
    id: "keyword_relation_candidates.evidence-hash",
    table: "keyword_relation_candidates",
    key: ["id"],
    columns: ["evidence_hash"],
  },
  {
    id: "topic_model_revisions.content-hash",
    table: "topic_model_revisions",
    key: ["id"],
    columns: ["content_hash"],
  },
];

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "t",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function normalizedHostname(hostname) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function containsAsciiControl(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeText(value) {
  if (value === null || value === undefined) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return String(value);
  }
  return "[UNAVAILABLE]";
}

export function redactSensitiveText(value, secrets = []) {
  let redacted = safeText(value);
  redacted = redacted.replace(
    /\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi,
    "[REDACTED_DATABASE_URL]",
  );
  try {
    for (const secret of secrets) {
      if (typeof secret === "string" && secret) {
        redacted = redacted.split(secret).join("[REDACTED]");
      }
    }
  } catch {
    // Redaction is best-effort for caller-provided secret collections.
  }
  return redacted;
}

function isObjectLike(value) {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function failureRecord(fields) {
  return Object.freeze({ ...fields });
}

function formatFailure(failure) {
  const fields = [`type=${failure.type}`, `code=${failure.code}`];
  if (failure.tool) fields.push(`tool=${failure.tool}`);
  if (failure.termination) {
    fields.push(`termination=${failure.termination}`);
  }
  if (failure.exitCode !== undefined) {
    fields.push(`exit_code=${failure.exitCode}`);
  }
  if (failure.signal) fields.push(`signal=${failure.signal}`);
  return fields.join(" ");
}

function createFailureError(fields) {
  const failure = failureRecord(fields);
  const error = new Error(formatFailure(failure));
  trustedFailures.set(error, failure);
  return error;
}

function normalizeFailure(value, fallback) {
  if (isObjectLike(value)) {
    const trusted = trustedFailures.get(value);
    if (trusted) return trusted;
  }
  return failureRecord(fallback);
}

function ensureFailureError(value, fallback) {
  if (isObjectLike(value) && trustedFailures.has(value)) return value;
  return createFailureError(fallback);
}

async function listMigrationPaths(readMigrationDirectory) {
  let entries;
  try {
    entries = await readMigrationDirectory(migrationsDirectory, {
      withFileTypes: true,
    });
  } catch {
    throw createFailureError({
      type: "restore_drill",
      code: "RESTORE_MIGRATION_DISCOVERY_FAILED",
    });
  }

  const migrationEntries = entries
    .filter(
      (entry) =>
        entry.name.endsWith(".sql") && entry.name !== "schema-smoke.sql",
    )
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  if (migrationEntries.length === 0) {
    throw createFailureError({
      type: "restore_drill",
      code: "RESTORE_MIGRATION_SET_EMPTY",
    });
  }

  return migrationEntries.map((entry) => {
    const migrationPath = path.resolve(migrationsDirectory, entry.name);
    if (
      !entry.isFile() ||
      path.dirname(migrationPath) !== migrationsDirectory
    ) {
      throw createFailureError({
        type: "restore_drill",
        code: "RESTORE_MIGRATION_PATH_UNSAFE",
      });
    }
    return migrationPath;
  });
}

export function assertSafeGeneratedTargetName(name) {
  if (!GENERATED_TARGET_NAME.test(name)) {
    throw new Error(
      "Refusing to operate on a database name that was not generated by this restore drill.",
    );
  }
  return name;
}

export function makeTargetDatabaseName(
  now = new Date(),
  bytes = nodeRandomBytes(8),
) {
  const entropy = bytes.toString("hex");
  if (entropy.length < 12) {
    throw new Error("Restore drill target entropy must contain at least 48 bits.");
  }
  return `signalframe_restore_drill_${formatTimestamp(now)}_${entropy.slice(0, 12)}`;
}

export function parseSourceDatabaseUrl(value, variableName = "DATABASE_URL") {
  if (!value) {
    throw new Error(`${variableName} is required for the restore drill.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${variableName} must be a PostgreSQL URL.`);
  }

  const hostname = normalizedHostname(parsed.hostname);
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new Error(
      `${variableName} must target a loopback PostgreSQL host (localhost, 127.0.0.1, or ::1).`,
    );
  }

  let database;
  let username;
  let password;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    username = parsed.username
      ? decodeURIComponent(parsed.username)
      : process.env["USER"] || "postgres";
    password = decodeURIComponent(parsed.password || "");
  } catch {
    throw new Error(`${variableName} contains invalid URL encoding.`);
  }
  if (containsAsciiControl(username) || containsAsciiControl(password)) {
    throw new Error(
      `${variableName} credentials must not contain ASCII control characters.`,
    );
  }
  if (!database) {
    throw new Error(`${variableName} must include a source database name.`);
  }
  if (SYSTEM_DATABASES.has(database.toLowerCase())) {
    throw new Error(`${variableName} must not target a PostgreSQL system database.`);
  }
  if (GENERATED_TARGET_NAME.test(database)) {
    throw new Error(
      `${variableName} must not point at a generated target restore database.`,
    );
  }
  if (!SAFE_SOURCE_DATABASE.test(database) || database.length > 63) {
    throw new Error(
      `${variableName} source database is not on the disposable local/CI allowlist.`,
    );
  }

  return {
    hostname,
    port: parsed.port || "5432",
    username,
    password,
    database,
    displayName: `${hostname}:${parsed.port || "5432"}/${database}`,
  };
}

function quoteIdentifier(identifier) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function buildTableCountSql() {
  return APP_TABLES.map(
    (table) =>
      `select '${table}' as key, count(*)::text as value from app.${quoteIdentifier(table)}`,
  ).join("\nunion all\n");
}

export function buildCanonicalCopySql(table) {
  const quotedTable = quoteIdentifier(table);
  return `copy (select to_jsonb(row_data)::text from app.${quotedTable} as row_data order by to_jsonb(row_data)::text) to stdout`;
}

export function buildIntegrityCopySql(probe) {
  const fields = [...probe.key, ...probe.columns]
    .map((column) => `'${column}', ${quoteIdentifier(column)}`)
    .join(", ");
  const ordering = probe.key
    .map((column) => `${quoteIdentifier(column)}::text`)
    .join(", ");
  return `copy (select jsonb_build_object(${fields})::text from app.${quoteIdentifier(probe.table)} order by ${ordering}) to stdout`;
}

/**
 * Pull every schema object a generated statement names back out of the SQL.
 * Table references are always `app."<table>"` and every other quoted identifier
 * in these single-table statements is a column of that table, so the drill's
 * own SQL can be checked against the schema without a database. Reading the
 * emitted string rather than the probe declaration means a typo in either one
 * is caught.
 */
export function extractSchemaReferences(sqlText) {
  const qualifiedTable = /\bapp\."([a-z_][a-z0-9_]*)"/g;
  const quotedIdentifier = /"([a-z_][a-z0-9_]*)"/g;
  const tables = new Set();
  for (const match of sqlText.matchAll(qualifiedTable)) tables.add(match[1]);
  const columns = new Set();
  for (const match of sqlText.replace(qualifiedTable, " ").matchAll(quotedIdentifier)) {
    columns.add(match[1]);
  }
  return { tables: [...tables], columns: [...columns] };
}

function parseKeyValueRows(stdout) {
  return Object.fromEntries(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("\t");
        if (separator < 1) throw new Error("Invalid inventory query output.");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function compareRecord(category, source, restored) {
  const keys = [...new Set([...Object.keys(source), ...Object.keys(restored)])].sort();
  return keys.flatMap((key) =>
    source[key] === restored[key]
      ? []
      : [
          {
            category,
            key,
            source: source[key],
            restored: restored[key],
          },
        ],
  );
}

export function compareInventories(source, restored) {
  return [
    ...compareRecord("row_count", source.tableCounts, restored.tableCounts),
    ...compareRecord(
      "canonical_checksum",
      source.tableChecksums,
      restored.tableChecksums,
    ),
    ...compareRecord(
      "integrity_checksum",
      source.integrityChecksums,
      restored.integrityChecksums,
    ),
  ];
}

function validateInventory(inventory) {
  const expected = {
    tableCounts: APP_TABLES,
    tableChecksums: APP_TABLES,
    integrityChecksums: INTEGRITY_PROBES.map((probe) => probe.id),
  };
  for (const [section, expectedKeys] of Object.entries(expected)) {
    const actual = inventory[section] ?? {};
    const actualKeys = Object.keys(actual).sort();
    const sortedExpected = [...expectedKeys].sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpected)) {
      throw new Error(`Restore inventory ${section} does not have the expected keys.`);
    }
  }
  for (const count of Object.values(inventory.tableCounts)) {
    if (!/^\d+$/.test(count)) throw new Error("Invalid table row count in inventory.");
  }
  for (const checksum of [
    ...Object.values(inventory.tableChecksums),
    ...Object.values(inventory.integrityChecksums),
  ]) {
    if (!/^[a-f0-9]{64}$/.test(checksum)) {
      throw new Error("Invalid SHA-256 checksum in restore inventory.");
    }
  }
  return inventory;
}

function connectionArgs(connection, database) {
  return [
    "--host",
    connection.hostname,
    "--port",
    connection.port,
    "--username",
    connection.username,
    "--dbname",
    database,
    "--no-password",
  ];
}

function postgresEnvironment(passfilePath) {
  const environment = {};
  for (const name of POSTGRES_ENV_ALLOWLIST) {
    const value = process.env[name];
    if (typeof value === "string" && value !== "") {
      environment[name] = value;
    }
  }
  environment.PATH ??= "/usr/local/bin:/usr/bin:/bin";
  environment.PGAPPNAME = "signalframe_restore_drill";
  environment.PGCONNECT_TIMEOUT = "10";
  environment.PGPASSFILE = passfilePath;
  environment.PGSSLMODE = "disable";
  return environment;
}

function resolvePgTool(tool, pgBinDir) {
  if (!pgBinDir) return tool;
  if (!path.isAbsolute(pgBinDir)) {
    throw new Error("RESTORE_DRILL_PG_BIN must be an absolute directory.");
  }
  return path.join(pgBinDir, tool);
}

function stableSignal(signal) {
  return typeof signal === "string" && /^SIG[A-Z0-9]+$/.test(signal)
    ? signal
    : "UNKNOWN_SIGNAL";
}

function postgresProcessFailure(tool, code, termination, details = {}) {
  return createFailureError({
    type: "postgres_process",
    code,
    tool,
    termination,
    ...details,
  });
}

export function runPostgresProcess({
  tool,
  args,
  environment,
  pgBinDir,
  output = "ignore",
}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(resolvePgTool(tool, pgBinDir), args, {
        env: environment,
        stdio: ["ignore", output === "ignore" ? "ignore" : "pipe", "ignore"],
      });
    } catch {
      reject(postgresProcessFailure(tool, "PG_TOOL_SPAWN_THROW", "spawn_throw"));
      return;
    }

    const chunks = [];
    const hash = output === "hash" ? createHash("sha256") : null;
    let outputBytes = 0;
    let outputLimitExceeded = false;
    let settled = false;

    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    try {
      if (output !== "ignore") {
        child.stdout.on("data", (value) => {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          if (hash) {
            hash.update(chunk);
          } else {
            outputBytes += chunk.length;
            if (outputBytes > MAX_POSTGRES_OUTPUT_BYTES) {
              outputLimitExceeded = true;
              try {
                child.kill("SIGKILL");
              } catch {
                // The close/error event still settles the process state.
              }
              return;
            }
            chunks.push(chunk);
          }
        });
        child.stdout.once("error", () => {
          fail(
            postgresProcessFailure(
              tool,
              "PG_TOOL_STDOUT_ERROR",
              "stream_error",
            ),
          );
        });
      }

      child.once("error", () => {
        fail(postgresProcessFailure(tool, "PG_TOOL_SPAWN_ERROR", "spawn_error"));
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        if (outputLimitExceeded) {
          fail(
            postgresProcessFailure(
              tool,
              "PG_TOOL_OUTPUT_LIMIT",
              "output_limit",
            ),
          );
          return;
        }
        if (signal !== null && signal !== undefined) {
          fail(
            postgresProcessFailure(tool, "PG_TOOL_SIGNAL", "signal", {
              signal: stableSignal(signal),
            }),
          );
          return;
        }
        if (code !== 0) {
          if (Number.isSafeInteger(code)) {
            fail(
              postgresProcessFailure(tool, "PG_TOOL_EXIT_NONZERO", "exit", {
                exitCode: code,
              }),
            );
          } else {
            fail(
              postgresProcessFailure(
                tool,
                "PG_TOOL_CLOSE_UNKNOWN",
                "unknown",
              ),
            );
          }
          return;
        }

        settled = true;
        if (hash) resolve(hash.digest("hex"));
        else if (output === "buffer") {
          resolve(Buffer.concat(chunks).toString("utf8"));
        } else resolve(undefined);
      });
    } catch {
      fail(postgresProcessFailure(tool, "PG_TOOL_SPAWN_ERROR", "spawn_error"));
    }
  });
}

async function defaultRunTool({ tool, args, environment, pgBinDir }) {
  await runPostgresProcess({ tool, args, environment, pgBinDir });
}

async function defaultRunQuery({
  connection,
  database,
  sqlText,
  environment,
  pgBinDir,
}) {
  return await runPostgresProcess({
    tool: "psql",
    pgBinDir,
    environment,
    output: "buffer",
    args: [
      ...connectionArgs(connection, database),
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--field-separator",
      "\t",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      sqlText,
    ],
  });
}

async function defaultHashQuery({
  connection,
  database,
  sqlText,
  environment,
  pgBinDir,
}) {
  return await runPostgresProcess({
    tool: "psql",
    pgBinDir,
    environment,
    output: "hash",
    args: [
      ...connectionArgs(connection, database),
      "--no-psqlrc",
      "--quiet",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      sqlText,
    ],
  });
}

async function defaultCollectInventory({
  connection,
  database,
  environment,
  pgBinDir,
}) {
  const tableCounts = parseKeyValueRows(
    await defaultRunQuery({
      connection,
      database,
      environment,
      pgBinDir,
      sqlText: buildTableCountSql(),
    }),
  );
  const tableChecksums = {};
  for (const table of APP_TABLES) {
    tableChecksums[table] = await defaultHashQuery({
      connection,
      database,
      environment,
      pgBinDir,
      sqlText: buildCanonicalCopySql(table),
    });
  }
  const integrityChecksums = {};
  for (const probe of INTEGRITY_PROBES) {
    integrityChecksums[probe.id] = await defaultHashQuery({
      connection,
      database,
      environment,
      pgBinDir,
      sqlText: buildIntegrityCopySql(probe),
    });
  }
  return validateInventory({ tableCounts, tableChecksums, integrityChecksums });
}

/**
 * The migration version the restored copy already declares, or null when the
 * database has never been migrated.
 *
 * The application's own runner is forward-only for a reason it states in
 * `packages/db/src/migrate.ts`: replaying a migration that re-asserts a CHECK
 * constraint a later migration has since widened (0014 re-narrowing
 * `async_runs_kind_check` after 0020 admits `content_shadow`) fails against
 * rows that use the newer value. A restored dump is already at head, so the
 * drill has to honour the same rule or its replay gate fails on any source
 * database that holds real data rather than on any real restore defect.
 */
async function defaultAppliedMigrationVersion({
  connection,
  database,
  environment,
  pgBinDir,
}) {
  const projection = parseKeyValueRows(
    await defaultRunQuery({
      connection,
      database,
      environment,
      pgBinDir,
      sqlText:
        "select 'projection' as key, coalesce(to_regclass('app.schema_migration_version')::text, '') as value",
    }),
  );
  if (!projection.projection) return null;
  const version = parseKeyValueRows(
    await defaultRunQuery({
      connection,
      database,
      environment,
      pgBinDir,
      sqlText:
        "select 'migration_version' as key, migration_version as value from app.schema_migration_version",
    }),
  );
  const applied = version.migration_version;
  if (!applied) return null;
  if (!/^[0-9]{4}_[a-z0-9_]+$/.test(applied)) {
    throw createFailureError({
      type: "restore_drill",
      code: "RESTORE_MIGRATION_VERSION_UNREADABLE",
    });
  }
  return applied;
}

/**
 * Forward-only replay selection, byte-for-byte the rule the application runner
 * applies: a migration whose ordinal-prefixed name is at or below the version
 * the database already declares has been applied and is not re-executed.
 */
export function pendingMigrationPaths(migrationPaths, appliedVersion) {
  if (appliedVersion === null || appliedVersion === undefined) {
    return [...migrationPaths];
  }
  return migrationPaths.filter(
    (migrationPath) =>
      path.basename(migrationPath).replace(/\.sql$/u, "") > appliedVersion,
  );
}

async function defaultDatabaseExists({
  connection,
  targetDatabase,
  environment,
  pgBinDir,
}) {
  assertSafeGeneratedTargetName(targetDatabase);
  const output = await defaultRunQuery({
    connection,
    database: "postgres",
    environment,
    pgBinDir,
    sqlText: `select case when exists (select 1 from pg_database where datname = '${targetDatabase}') then 'yes' else 'no' end as key, '1' as value`,
  });
  const answer = output.trim().split("\t", 1)[0];
  if (answer !== "yes" && answer !== "no") {
    throw new Error("Could not verify generated target database existence.");
  }
  return answer === "yes";
}

function assertSafeDumpDirectory(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith(DUMP_DIRECTORY_PREFIX)
  ) {
    throw new Error("Refusing to clean an untrusted restore drill dump directory.");
  }
  return resolved;
}

async function defaultRemoveDumpDirectory(directory) {
  await rm(assertSafeDumpDirectory(directory), { recursive: true, force: false });
}

function assertSafePgpassDirectory(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith(PGPASS_DIRECTORY_PREFIX)
  ) {
    throw new Error(
      "Refusing to clean an untrusted restore drill credential directory.",
    );
  }
  return resolved;
}

async function defaultRemovePgpassDirectory(directory) {
  await rm(assertSafePgpassDirectory(directory), {
    recursive: true,
    force: false,
  });
}

function escapePgpassField(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

function postgresPassfileContents(connection) {
  return `${[
    connection.hostname,
    connection.port,
    "*",
    connection.username,
    connection.password,
  ]
    .map(escapePgpassField)
    .join(":")}\n`;
}

function markdownReport(report) {
  const lines = [
    "# SignalFrame Restore Drill",
    "",
    `- Status: ${report.status}`,
    `- Source database: ${report.source.displayName}`,
    `- Generated target: ${report.targetDatabase}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Target dropped by tool: ${report.cleanup.targetDatabaseDropped ? "yes" : "no"}`,
    `- Target confirmed absent: ${report.cleanup.targetDatabaseAbsentAfterCleanup ? "yes" : "no"}`,
    `- Temporary dump removed: ${report.cleanup.dumpDirectoryRemoved ? "yes" : "no"}`,
    `- Temporary credential passfile removed: ${report.cleanup.credentialDirectoryRemoved ? "yes" : "no"}`,
    `- Backup explicitly retained: ${report.artifacts.backupRetained ? "yes" : "no"}`,
    "",
    "## Verification gates",
    "",
    `- Migration replay: ${report.verification.migrationReplay}`,
    `- Migrations applied to the restored copy: ${report.verification.migrationsApplied} of ${report.verification.migrationsDiscovered} (restored copy already declared ${report.verification.migrationVersionAlreadyApplied ?? "no migration version"})`,
    `- Schema smoke: ${report.verification.schemaSmoke}`,
    `- Application tables: ${report.verification.appTableCount}`,
    `- Row counts match: ${report.verification.rowCountsMatch ? "yes" : "no"}`,
    `- Canonical SHA-256 checksums match: ${report.verification.canonicalChecksumsMatch ? "yes" : "no"}`,
    `- Object metadata checksums match: ${report.verification.integrityChecksumsMatch ? "yes" : "no"}`,
    "",
    "## Differences",
    "",
  ];
  if (report.differences.length === 0) {
    lines.push("No differences detected.");
  } else {
    for (const difference of report.differences) {
      lines.push(
        `- ${difference.category} ${difference.key}: source=${difference.source ?? "missing"}, restored=${difference.restored ?? "missing"}`,
      );
    }
  }
  if (report.error) {
    lines.push("", "## Failure", "", report.error);
  }
  return `${lines.join("\n")}\n`;
}

async function writeReports(reportDir, targetDatabase, report, secrets) {
  const resolvedReportDir = path.resolve(reportDir);
  await mkdir(resolvedReportDir, { recursive: true, mode: 0o700 });
  const base = path.join(resolvedReportDir, targetDatabase);
  const jsonPath = `${base}.json`;
  const markdownPath = `${base}.md`;
  await writeFile(
    jsonPath,
    redactSensitiveText(JSON.stringify(report, null, 2), secrets),
    { mode: 0o600 },
  );
  await writeFile(
    markdownPath,
    redactSensitiveText(markdownReport(report), secrets),
    { mode: 0o600 },
  );
  await chmod(jsonPath, 0o600);
  await chmod(markdownPath, 0o600);
  return { json: jsonPath, markdown: markdownPath };
}

function isExplicitKeepBackup(value) {
  if (value === undefined || value === false || value === "0") return false;
  if (value === true || value === "1") return true;
  throw new Error("KEEP_BACKUP must be exactly 1 when retaining a local dump.");
}

export async function runRestoreDrill(options = {}, overrides = {}) {
  const sourceUrl = options.sourceUrl;
  const source = parseSourceDatabaseUrl(sourceUrl);
  const now = overrides.now ?? (() => new Date());
  const randomBytes = overrides.randomBytes ?? nodeRandomBytes;
  const pgBinDir = options.pgBinDir;
  resolvePgTool("psql", pgBinDir);
  const keepBackup = isExplicitKeepBackup(options.keepBackup);
  const collectInventoryOverride = overrides.collectInventory;
  const databaseExistsOverride = overrides.databaseExists;
  const appliedMigrationVersionOverride = overrides.appliedMigrationVersion;
  const runToolOverride = overrides.runTool;
  const readMigrationDirectory = overrides.readMigrationDirectory ?? readdir;
  const removeDumpDirectory =
    overrides.removeDumpDirectory ?? defaultRemoveDumpDirectory;
  const removePgpassDirectory =
    overrides.removePgpassDirectory ?? defaultRemovePgpassDirectory;

  const started = now();
  const startedAt = started.toISOString();
  const targetDatabase = assertSafeGeneratedTargetName(
    makeTargetDatabaseName(started, randomBytes(8)),
  );
  const reportDir = path.resolve(
    options.reportDir ?? path.join(process.cwd(), ".data", "restore-drills"),
  );
  const secrets = [source.password, sourceUrl].filter(Boolean);

  let collectInventory;
  let databaseExists;
  let appliedMigrationVersion;
  let runTool;
  let dumpDirectory = null;
  let dumpPath = null;
  let pgpassDirectory = null;
  let sourceInventory = null;
  let restoredInventory = null;
  let differences = [];
  let operationFailure = null;
  let targetCreateAttempted = false;
  let targetCreated = false;
  let dumpCreated = false;
  let verificationSucceeded = false;
  let migrationReplay = "not_run";
  let migrationReplayApplied = 0;
  let migrationReplayAlreadyApplied = null;
  let schemaSmoke = "not_run";
  let migrationPathCount = 0;
  const cleanupFailures = [];
  const cleanup = {
    targetDatabaseDropped: false,
    targetDatabaseAbsentAfterCleanup: false,
    dumpDirectoryRemoved: false,
    credentialDirectoryRemoved: false,
  };
  const artifacts = {
    backupRetained: false,
  };

  try {
    const migrationPaths = await listMigrationPaths(readMigrationDirectory);
    migrationPathCount = migrationPaths.length;
    dumpDirectory = await mkdtemp(path.join(tmpdir(), DUMP_DIRECTORY_PREFIX));
    await chmod(dumpDirectory, 0o700);
    dumpPath = path.join(dumpDirectory, "backup.dump");

    pgpassDirectory = await mkdtemp(
      path.join(tmpdir(), PGPASS_DIRECTORY_PREFIX),
    );
    await chmod(pgpassDirectory, 0o700);
    const pgpassPath = path.join(pgpassDirectory, "pgpass");
    await writeFile(pgpassPath, postgresPassfileContents(source), {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(pgpassPath, 0o600);
    const environment = postgresEnvironment(pgpassPath);

    collectInventory =
      collectInventoryOverride ??
      (({ database }) =>
        defaultCollectInventory({
          connection: source,
          database,
          environment,
          pgBinDir,
        }));
    databaseExists =
      databaseExistsOverride ??
      (({ targetDatabase: candidate }) =>
        defaultDatabaseExists({
          connection: source,
          targetDatabase: candidate,
          environment,
          pgBinDir,
        }));
    appliedMigrationVersion =
      appliedMigrationVersionOverride ??
      (({ database }) =>
        defaultAppliedMigrationVersion({
          connection: source,
          database,
          environment,
          pgBinDir,
        }));
    const rawRunTool =
      runToolOverride ??
      (({ tool, args }) =>
        defaultRunTool({ tool, args, environment, pgBinDir }));
    runTool = async ({ tool, args }) => {
      try {
        await rawRunTool({ tool, args });
      } catch (error) {
        throw ensureFailureError(error, {
          type: "postgres_process",
          code: "PG_TOOL_UNKNOWN_FAILURE",
          tool,
          termination: "unknown",
        });
      }
    };

    if (await databaseExists({ targetDatabase })) {
      throw createFailureError({
        type: "restore_drill",
        code: "RESTORE_TARGET_COLLISION",
      });
    }

    sourceInventory = validateInventory(
      await collectInventory({ database: source.database }),
    );
    await runTool({
      tool: "pg_dump",
      args: [
        ...connectionArgs(source, source.database),
        "--format",
        "custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        dumpPath,
      ],
    });
    dumpCreated = true;
    await chmod(dumpPath, 0o600);

    targetCreateAttempted = true;
    await runTool({
      tool: "createdb",
      args: [
        "--host",
        source.hostname,
        "--port",
        source.port,
        "--username",
        source.username,
        "--maintenance-db",
        "postgres",
        "--no-password",
        targetDatabase,
      ],
    });
    targetCreated = true;

    await runTool({
      tool: "pg_restore",
      args: [
        ...connectionArgs(source, targetDatabase),
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-privileges",
        dumpPath,
      ],
    });
    migrationReplay = "failed";
    migrationReplayAlreadyApplied = await appliedMigrationVersion({
      database: targetDatabase,
    });
    const pendingPaths = pendingMigrationPaths(
      migrationPaths,
      migrationReplayAlreadyApplied,
    );
    for (const migrationPath of pendingPaths) {
      await runTool({
        tool: "psql",
        args: [
          ...connectionArgs(source, targetDatabase),
          "--no-psqlrc",
          "--set",
          "ON_ERROR_STOP=1",
          "--file",
          migrationPath,
        ],
      });
      migrationReplayApplied += 1;
    }
    migrationReplay = "passed";
    schemaSmoke = "failed";
    await runTool({
      tool: "psql",
      args: [
        ...connectionArgs(source, targetDatabase),
        "--no-psqlrc",
        "--set",
        "ON_ERROR_STOP=1",
        "--file",
        schemaSmokePath,
      ],
    });
    schemaSmoke = "passed";

    restoredInventory = validateInventory(
      await collectInventory({ database: targetDatabase }),
    );
    differences = compareInventories(sourceInventory, restoredInventory);
    if (differences.length > 0) {
      throw createFailureError({
        type: "restore_drill",
        code: "RESTORE_INVENTORY_MISMATCH",
      });
    }
    verificationSucceeded = true;
  } catch (error) {
    operationFailure = normalizeFailure(error, {
      type: "restore_drill",
      code: "RESTORE_DRILL_OPERATION_FAILED",
    });
  } finally {
    if (targetCreateAttempted) {
      try {
        const existsBeforeCleanup = await databaseExists({ targetDatabase });
        if (!existsBeforeCleanup) {
          cleanup.targetDatabaseAbsentAfterCleanup = true;
          if (targetCreated) {
            cleanupFailures.push(
              failureRecord({
                type: "cleanup",
                code: "RESTORE_CLEANUP_TARGET_MISSING",
              }),
            );
          }
        } else if (existsBeforeCleanup) {
          try {
            await runTool({
              tool: "dropdb",
              args: [
                "--host",
                source.hostname,
                "--port",
                source.port,
                "--username",
                source.username,
                "--maintenance-db",
                "postgres",
                "--no-password",
                targetDatabase,
              ],
            });
            cleanup.targetDatabaseDropped = true;
          } catch (error) {
            cleanupFailures.push(
              normalizeFailure(error, {
                type: "postgres_process",
                code: "PG_TOOL_UNKNOWN_FAILURE",
                tool: "dropdb",
                termination: "unknown",
              }),
            );
          }

          try {
            cleanup.targetDatabaseAbsentAfterCleanup = !(await databaseExists({
              targetDatabase,
            }));
            if (!cleanup.targetDatabaseAbsentAfterCleanup) {
              cleanupFailures.push(
                failureRecord({
                  type: "cleanup",
                  code: "RESTORE_CLEANUP_TARGET_STILL_PRESENT",
                }),
              );
            }
          } catch (error) {
            cleanupFailures.push(
              normalizeFailure(error, {
                type: "cleanup",
                code: "RESTORE_CLEANUP_VERIFY_FAILED",
              }),
            );
          }
        }
      } catch (error) {
        cleanupFailures.push(
          normalizeFailure(error, {
            type: "cleanup",
            code: "RESTORE_CLEANUP_INSPECT_FAILED",
          }),
        );
      }
    }

    if (keepBackup && dumpCreated) {
      artifacts.backupRetained = true;
      artifacts.backupPath = dumpPath;
    } else if (dumpDirectory) {
      try {
        await removeDumpDirectory(dumpDirectory);
        cleanup.dumpDirectoryRemoved = true;
      } catch (error) {
        cleanupFailures.push(
          normalizeFailure(error, {
            type: "cleanup",
            code: "RESTORE_DUMP_CLEANUP_FAILED",
          }),
        );
      }
    } else {
      cleanup.dumpDirectoryRemoved = true;
    }

    if (pgpassDirectory) {
      try {
        await removePgpassDirectory(pgpassDirectory);
        cleanup.credentialDirectoryRemoved = true;
      } catch (error) {
        cleanupFailures.push(
          normalizeFailure(error, {
            type: "cleanup",
            code: "RESTORE_CREDENTIAL_CLEANUP_FAILED",
          }),
        );
      }
    } else {
      cleanup.credentialDirectoryRemoved = true;
    }
  }

  const rowCountDifferences = differences.filter(
    (difference) => difference.category === "row_count",
  );
  const canonicalDifferences = differences.filter(
    (difference) => difference.category === "canonical_checksum",
  );
  const integrityDifferences = differences.filter(
    (difference) => difference.category === "integrity_checksum",
  );
  const cleanupComplete =
    cleanup.targetDatabaseAbsentAfterCleanup &&
    (cleanup.dumpDirectoryRemoved || artifacts.backupRetained) &&
    cleanup.credentialDirectoryRemoved &&
    cleanupFailures.length === 0;
  const failures = [
    ...(operationFailure ? [operationFailure] : []),
    ...cleanupFailures,
  ];
  const status =
    verificationSucceeded && failures.length === 0 && cleanupComplete
      ? "passed"
      : "failed";
  const report = {
    schemaVersion: "signalframe.restore-drill.1",
    status,
    source: {
      displayName: source.displayName,
      database: source.database,
      disposableAllowlistMatched: true,
    },
    targetDatabase,
    startedAt,
    finishedAt: now().toISOString(),
    verification: {
      appTableCount: APP_TABLES.length,
      migrationReplay,
      migrationsDiscovered: migrationPathCount,
      migrationsApplied: migrationReplayApplied,
      migrationVersionAlreadyApplied: migrationReplayAlreadyApplied,
      schemaSmoke,
      rowCountsMatch: verificationSucceeded && rowCountDifferences.length === 0,
      canonicalChecksumsMatch:
        verificationSucceeded && canonicalDifferences.length === 0,
      integrityChecksumsMatch:
        verificationSucceeded && integrityDifferences.length === 0,
      canonicalChecksumAlgorithm: "sha256",
      integrityProbes: INTEGRITY_PROBES,
      sourceInventory,
      restoredInventory,
    },
    differences,
    cleanup,
    artifacts,
    failures,
    ...(failures.length > 0
      ? { error: failures.map(formatFailure).join("; ") }
      : {}),
  };
  const reportPaths = await writeReports(
    reportDir,
    targetDatabase,
    report,
    secrets,
  );
  const result = {
    status,
    targetDatabase,
    reportPaths,
    cleanup,
    artifacts,
  };

  if (status === "failed") {
    const primaryFailure =
      failures[0] ??
      failureRecord({
        type: "restore_drill",
        code: "RESTORE_DRILL_FAILED",
      });
    const error = new Error(report.error ?? formatFailure(primaryFailure));
    trustedFailures.set(error, primaryFailure);
    failureReportPaths.set(error, reportPaths);
    error.reportPaths = reportPaths;
    error.result = result;
    throw error;
  }
  return result;
}

function cliOptions() {
  if (process.argv.slice(2).length > 0) {
    throw new Error(
      "Restore drill accepts no command-line arguments; pass DATABASE_URL through the environment to keep credentials out of process arguments.",
    );
  }
  return {
    sourceUrl: process.env["DATABASE_URL"],
    reportDir:
      process.env["RESTORE_DRILL_REPORT_DIR"] ??
      path.resolve(process.cwd(), ".data", "restore-drills"),
    keepBackup: process.env["KEEP_BACKUP"],
    pgBinDir: process.env["RESTORE_DRILL_PG_BIN"],
  };
}

async function main() {
  try {
    const result = await runRestoreDrill(cliOptions());
    console.log(`Restore drill passed: ${result.targetDatabase}`);
    console.log(`JSON evidence: ${result.reportPaths.json}`);
    console.log(`Markdown evidence: ${result.reportPaths.markdown}`);
    if (result.artifacts.backupRetained) {
      console.log(`Private backup retained by explicit KEEP_BACKUP=1: ${result.artifacts.backupPath}`);
    }
  } catch (error) {
    const failure = normalizeFailure(error, {
      type: "restore_drill",
      code: "RESTORE_DRILL_FAILED",
    });
    console.error(formatFailure(failure));
    const reportPaths = isObjectLike(error)
      ? failureReportPaths.get(error)
      : undefined;
    if (reportPaths) {
      console.error(`JSON evidence: ${reportPaths.json}`);
      console.error(`Markdown evidence: ${reportPaths.markdown}`);
    }
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
