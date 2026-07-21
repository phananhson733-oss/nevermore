import pg from "pg";
import { serializeDbProcessFailure } from "./runtime-failure.ts";
import { LATEST_APP_MIGRATION } from "./migration-version.ts";

/**
 * Verify the applied database matches the SQL contract shape (spec AC-003):
 * exactly 33 app tables plus every named index and trigger in the frozen SQL
 * contract. Exits non-zero on drift. This is a structural object-presence gate;
 * the byte-for-byte migration/spec gate separately prevents definition drift.
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
  "capability_runs",
  "audit_runs",
  "audit_module_results",
  "site_pages",
  "page_snapshots",
] as const;

const REQUIRED_INDEXES = [
  "client_projects_workspace_updated_idx",
  "sites_one_primary_per_project_idx",
  "source_connections_one_active_provider_idx",
  "source_connections_project_idx",
  "oauth_intents_expiry_idx",
  "import_previews_expiry_idx",
  "async_runs_one_active_key_idx",
  "async_runs_project_status_idx",
  "data_snapshots_project_provider_idx",
  "normalized_observations_lookup_idx",
  "normalized_observations_snapshot_idx",
  "provider_discrepancies_pair_idx",
  "analysis_invocations_project_idx",
  "evidence_run_idx",
  "findings_project_filter_idx",
  "finding_observations_finding_run_idx",
  "actions_plan_idx",
  "execution_artifacts_one_active_type_idx",
  "execution_artifacts_project_idx",
  "export_bundles_project_idx",
  "idempotency_keys_expiry_idx",
  "telemetry_events_name_created_idx",
  "audit_runs_project_created_idx",
  "site_pages_project_updated_idx",
  "site_pages_site_idx",
  "page_snapshots_page_captured_idx",
  "page_snapshots_project_captured_idx",
] as const;

const REQUIRED_TRIGGERS = [
  "workspaces_set_updated_at",
  "operator_profiles_set_updated_at",
  "client_projects_set_updated_at",
  "client_projects_icp_profile_provenance_guard",
  "sites_set_updated_at",
  "source_connections_set_updated_at",
  "source_credentials_set_updated_at",
  "oauth_intents_set_updated_at",
  "import_previews_set_updated_at",
  "async_runs_set_updated_at",
  "async_runs_terminal_status_immutable",
  "provider_discrepancies_set_updated_at",
  "findings_set_updated_at",
  "actions_set_updated_at",
  "actions_source_lineage_guard",
  "execution_artifacts_set_updated_at",
  "execution_artifacts_status_transition_guard",
  "export_bundles_invariant_guard",
  "idempotency_keys_set_updated_at",
  "icp_profiles_append_only",
  "data_snapshots_append_only",
  "normalized_observations_append_only",
  "diagnostic_run_rules_append_only",
  "analysis_invocations_append_only",
  "evidence_append_only",
  "finding_observations_append_only",
  "finding_review_events_append_only",
  "action_override_audit_append_only",
  "artifact_revisions_append_only",
  "telemetry_events_append_only",
  "site_pages_set_updated_at",
  "audit_runs_provenance_guard",
  "site_pages_provenance_guard",
  "page_snapshots_provenance_guard",
  "capability_runs_append_only",
  "audit_runs_append_only",
  "audit_module_results_append_only",
  "page_snapshots_append_only",
] as const;

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

    try {
      const version = await client.query<{ migration_version: unknown }>(
        "SELECT migration_version FROM app.schema_migration_version",
      );
      if (
        version.rows.length !== 1 ||
        version.rows[0]?.migration_version !== LATEST_APP_MIGRATION
      ) {
        problems.push("database migration version is missing or stale");
      }
    } catch {
      problems.push("missing view app.schema_migration_version");
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
  console.log(
    `Migration check passed: ${EXPECTED_TABLES.length} app tables, ` +
      `${REQUIRED_INDEXES.length} indexes, and ${REQUIRED_TRIGGERS.length} triggers present.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(serializeDbProcessFailure("migrate-check", error));
    process.exit(1);
  });
}
