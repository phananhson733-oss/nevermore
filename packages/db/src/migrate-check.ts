import pg from "pg";

/**
 * Verify the applied database matches the SQL contract shape (spec AC-003):
 * exactly 28 app tables, the active-run uniqueness index, and append-only
 * triggers. Exits non-zero on drift. This is a fast structural gate, not a full
 * DDL diff.
 */

const EXPECTED_TABLES = [
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
  "finding_review_events",
  "actions",
  "action_override_audit",
  "execution_artifacts",
  "artifact_revisions",
  "export_bundles",
  "idempotency_keys",
  "telemetry_events",
] as const;

const REQUIRED_INDEXES = ["async_runs_one_active_key_idx", "sites_one_primary_per_project_idx"];
const REQUIRED_TRIGGERS = ["evidence_append_only", "findings_set_updated_at"];

export interface MigrateCheckResult {
  ok: boolean;
  problems: string[];
}

export async function checkMigrations(connectionString: string): Promise<MigrateCheckResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const problems: string[] = [];
  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'app' AND table_type = 'BASE TABLE'`,
    );
    const found = new Set(tables.rows.map((r) => r.table_name));
    if (found.size !== EXPECTED_TABLES.length) {
      problems.push(`expected ${EXPECTED_TABLES.length} app tables, found ${found.size}`);
    }
    for (const t of EXPECTED_TABLES) {
      if (!found.has(t)) problems.push(`missing table app.${t}`);
    }

    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'app'`,
    );
    const idxSet = new Set(indexes.rows.map((r) => r.indexname));
    for (const idx of REQUIRED_INDEXES) {
      if (!idxSet.has(idx)) problems.push(`missing index ${idx}`);
    }

    const triggers = await client.query<{ tgname: string }>(
      `SELECT t.tgname FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app' AND NOT t.tgisinternal`,
    );
    const trgSet = new Set(triggers.rows.map((r) => r.tgname));
    for (const trg of REQUIRED_TRIGGERS) {
      if (!trgSet.has(trg)) problems.push(`missing trigger ${trg}`);
    }
  } finally {
    await client.end();
  }
  return { ok: problems.length === 0, problems };
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const result = await checkMigrations(connectionString);
  if (!result.ok) {
    console.error("Migration check FAILED:");
    for (const p of result.problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log("Migration check passed: 28 app tables, required indexes and triggers present.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
