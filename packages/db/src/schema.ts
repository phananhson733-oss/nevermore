// Drizzle typed query model mirroring app/*.sql (implementation-spec-v0.2/schema.sql).
//
// This is a QUERY MODEL, not the source of truth: check constraints, partial/unique
// indexes, triggers and grants live in the SQL migration. Here we mirror column
// names (snake_case), types, NOT NULL, primary keys, foreign-key references and
// column defaults so insert/select types are correct and ergonomic.
//
// Foreign keys use the function form `.references(() => other.id)` so forward and
// circular references resolve lazily (notably the deferred circular FKs from
// client_projects.current/confirmed_icp_profile_id -> icp_profiles.id and
// source_connections.last_successful_snapshot_id -> data_snapshots.id).

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Permissive JSON shapes for open jsonb payloads.
type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

/** Postgres `bytea` mapped to a Node Buffer on both read and write. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** timestamptz read/written as ISO strings (mode: "string"). */
function tz() {
  return timestamp({ withTimezone: true, mode: "string" });
}

const app = pgSchema("app");

// ---------------------------------------------------------------------------
// 1. workspaces
// ---------------------------------------------------------------------------
export const workspaces = app.table("workspaces", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 2. operator_profiles
// ---------------------------------------------------------------------------
export const operatorProfiles = app.table("operator_profiles", {
  user_id: uuid().primaryKey(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  display_name: text().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 3. client_projects  (deferred circular FKs -> icp_profiles.id)
// ---------------------------------------------------------------------------
export const clientProjects = app.table("client_projects", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  client_name: text().notNull(),
  project_name: text().notNull(),
  stage: text().notNull().default("setup"),
  default_delivery_locale: text().notNull(),
  current_icp_profile_id: uuid().references((): AnyPgColumn => icpProfiles.id),
  confirmed_icp_profile_id: uuid().references(
    (): AnyPgColumn => icpProfiles.id,
  ),
  archived_at: tz(),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 4. sites
// ---------------------------------------------------------------------------
export const sites = app.table("sites", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  origin: text().notNull(),
  host: text().notNull(),
  market_codes: text().array().notNull(),
  language_codes: text().array().notNull(),
  is_primary: boolean().notNull().default(true),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 5. icp_profiles  (append-only)
// ---------------------------------------------------------------------------
export const icpProfiles = app.table("icp_profiles", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  version: integer().notNull(),
  status: text().notNull(),
  profile: jsonb().$type<JsonObject>().notNull(),
  content_hash: text().notNull(),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 6. source_connections  (deferred circular FK -> data_snapshots.id)
// ---------------------------------------------------------------------------
export const sourceConnections = app.table("source_connections", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  provider: text().notNull(),
  connection_type: text().notNull(),
  state: text().notNull(),
  external_ref: text(),
  scopes: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  config: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  limitation: text().notNull(),
  connected_at: tz(),
  disconnected_at: tz(),
  last_successful_snapshot_id: uuid().references(
    (): AnyPgColumn => dataSnapshots.id,
  ),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 7. source_credentials
// ---------------------------------------------------------------------------
export const sourceCredentials = app.table("source_credentials", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  source_connection_id: uuid()
    .notNull()
    .references(() => sourceConnections.id),
  cipher_version: smallint().notNull().default(1),
  encrypted_payload: bytea().notNull(),
  key_version: text().notNull(),
  expires_at: tz(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 8. oauth_intents
// ---------------------------------------------------------------------------
export const oauthIntents = app.table("oauth_intents", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  initiated_by: uuid().notNull(),
  provider: text().notNull(),
  state_hash: bytea().notNull(),
  pkce_verifier_cipher: bytea().notNull(),
  token_cipher: bytea(),
  candidate_properties: jsonb().$type<JsonArray>(),
  redirect_path: text().notNull(),
  status: text().notNull().default("initiated"),
  failure_code: text(),
  expires_at: tz().notNull(),
  consumed_at: tz(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 9. import_previews
// ---------------------------------------------------------------------------
export const importPreviews = app.table("import_previews", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  created_by: uuid().notNull(),
  token_hash: bytea().notNull(),
  template_id: text().notNull(),
  raw_object_key: text().notNull(),
  file_checksum: text().notNull(),
  row_count: integer().notNull(),
  detected_columns: jsonb().$type<JsonArray>().notNull(),
  suggested_mapping: jsonb().$type<JsonObject>().notNull(),
  preview_rows: jsonb().$type<JsonArray>().notNull(),
  validation_errors: jsonb()
    .$type<JsonArray>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  validation_warnings: jsonb()
    .$type<JsonArray>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  status: text().notNull().default("previewed"),
  expires_at: tz().notNull(),
  consumed_at: tz(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 10. async_runs
// ---------------------------------------------------------------------------
export const asyncRuns = app.table("async_runs", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  kind: text().notNull(),
  status: text().notNull().default("queued"),
  active_key: text(),
  contract_version: text().notNull().default("2026-07-21"),
  request_payload: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  progress: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(
      sql`'{"phase":"queued","current":0,"total":null,"messageKey":"run.queued"}'::jsonb`,
    ),
  last_error_code: text(),
  last_error_summary: text(),
  result_type: text(),
  result_id: uuid(),
  attempt_count: integer().notNull().default(0),
  initiated_by: uuid().notNull(),
  queued_at: tz().notNull().defaultNow(),
  started_at: tz(),
  completed_at: tz(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 11. collection_runs  (id shares async_runs.id)
// ---------------------------------------------------------------------------
export const collectionRuns = app.table("collection_runs", {
  id: uuid()
    .primaryKey()
    .references(() => asyncRuns.id),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  source_connection_id: uuid().references(() => sourceConnections.id),
  import_preview_id: uuid().references(() => importPreviews.id),
  crawl_seed_site_page_id: uuid().references(
    (): AnyPgColumn => sitePages.id,
  ),
  crawl_seed_url: text(),
  provider: text().notNull(),
  operation: text().notNull(),
  method_version: text().notNull(),
  parameters_hash: text().notNull(),
  source_window: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{"start":null,"end":null}'::jsonb`),
  provider_usage: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  row_count: integer(),
  stop_reason: text(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 12. data_snapshots  (append-only)
// ---------------------------------------------------------------------------
export const dataSnapshots = app.table("data_snapshots", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  collection_run_id: uuid()
    .notNull()
    .references(() => collectionRuns.id),
  source_connection_id: uuid().references(() => sourceConnections.id),
  provider: text().notNull(),
  dataset_key: text().notNull(),
  schema_version: text().notNull(),
  method_version: text().notNull(),
  captured_at: tz().notNull(),
  source_window: jsonb().$type<JsonObject>().notNull(),
  availability: text().notNull(),
  limitation: text().notNull(),
  raw_object_key: text(),
  row_count: integer().notNull(),
  checksum: text().notNull(),
  summary: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 12a. product_profile_runs  (id shares async_runs.id)
// ---------------------------------------------------------------------------
export const productProfileRuns = app.table("product_profile_runs", {
  id: uuid()
    .primaryKey()
    .references(() => asyncRuns.id),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  base_icp_profile_id: uuid()
    .notNull()
    .references(() => icpProfiles.id),
  base_icp_profile_version: integer().notNull(),
  base_icp_profile_content_hash: text().notNull(),
  source_snapshot_id: uuid()
    .notNull()
    .references(() => dataSnapshots.id),
  synthesis_version: text().notNull(),
  prompt_set_version: text().notNull(),
  input_manifest: jsonb().$type<JsonObject>().notNull(),
  input_hash: text().notNull(),
  prompt_input_hash: text(),
  result_icp_profile_id: uuid().references(() => icpProfiles.id),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 12b. product_profile_invocation_attempts  (durable pre-call reservation)
// ---------------------------------------------------------------------------
export const productProfileInvocationAttempts = app.table(
  "product_profile_invocation_attempts",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    product_profile_run_id: uuid()
      .notNull()
      .references(() => productProfileRuns.id),
    ordinal: smallint().notNull(),
    async_attempt_count: integer().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    prompt_set_version: text().notNull(),
    input_hash: text().notNull(),
    planned_analysis_invocation_id: uuid().notNull(),
    status: text().notNull().default("reserved"),
    analysis_invocation_id: uuid().references(
      (): AnyPgColumn => analysisInvocations.id,
    ),
    terminal_error_code: text(),
    reserved_at: tz().notNull().defaultNow(),
    provider_returned_at: tz(),
    finalized_at: tz(),
  },
);

// ---------------------------------------------------------------------------
// 13. normalized_observations  (append-only)
// ---------------------------------------------------------------------------
export const normalizedObservations = app.table("normalized_observations", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  snapshot_id: uuid()
    .notNull()
    .references(() => dataSnapshots.id),
  site_page_id: uuid().references(
    (): AnyPgColumn => sitePages.id,
  ),
  provider: text().notNull(),
  metric_key: text().notNull(),
  subject_type: text().notNull(),
  subject_ref: text().notNull(),
  observed_at: tz().notNull(),
  availability: text().notNull(),
  value_numeric: numeric(),
  value_text: text(),
  value_json: jsonb().$type<unknown>(),
  unit: text(),
  origin: text().notNull(),
  method: text().notNull().default("observed"),
  grade: text().notNull(),
  support: text().notNull().default("context"),
  limitation: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 14. provider_discrepancies
// ---------------------------------------------------------------------------
export const providerDiscrepancies = app.table("provider_discrepancies", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  metric_key: text().notNull(),
  subject_type: text().notNull(),
  subject_ref: text().notNull(),
  left_observation_id: uuid()
    .notNull()
    .references(() => normalizedObservations.id),
  right_observation_id: uuid()
    .notNull()
    .references(() => normalizedObservations.id),
  resolution: text().notNull().default("unresolved"),
  resolution_note: text(),
  resolved_by: uuid(),
  resolved_at: tz(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 15. diagnostic_runs  (id shares async_runs.id)
// ---------------------------------------------------------------------------
export const diagnosticRuns = app.table("diagnostic_runs", {
  id: uuid()
    .primaryKey()
    .references(() => asyncRuns.id),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  icp_profile_id: uuid()
    .notNull()
    .references(() => icpProfiles.id),
  icp_profile_version: integer().notNull(),
  rule_set_version: text().notNull(),
  prompt_set_version: text().notNull(),
  output_locale: text().notNull(),
  input_manifest: jsonb().$type<JsonObject>().notNull(),
  input_hash: text().notNull(),
  coverage: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 16. diagnostic_run_rules  (composite PK, append-only)
// ---------------------------------------------------------------------------
export const diagnosticRunRules = app.table(
  "diagnostic_run_rules",
  {
    diagnostic_run_id: uuid()
      .notNull()
      .references(() => diagnosticRuns.id),
    rule_id: text().notNull(),
    rule_version: integer().notNull(),
    domain: text().notNull(),
    status: text().notNull(),
    reason: text(),
    metrics: jsonb()
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    duration_ms: integer().notNull(),
    created_at: tz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.diagnostic_run_id, t.rule_id, t.rule_version] }),
  ],
);

// ---------------------------------------------------------------------------
// 17. analysis_invocations  (append-only)
// ---------------------------------------------------------------------------
export const analysisInvocations = app.table("analysis_invocations", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  async_run_id: uuid().references(() => asyncRuns.id),
  diagnostic_run_id: uuid().references(() => diagnosticRuns.id),
  task: text().notNull(),
  provider: text().notNull(),
  model: text().notNull(),
  prompt_set_version: text().notNull(),
  input_hash: text().notNull(),
  output_hash: text(),
  status: text().notNull(),
  input_tokens: integer(),
  output_tokens: integer(),
  cost_usd: numeric({ precision: 12, scale: 6 }),
  latency_ms: integer().notNull(),
  error_code: text(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 18. evidence  (append-only)
// ---------------------------------------------------------------------------
export const evidence = app.table("evidence", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  diagnostic_run_id: uuid()
    .notNull()
    .references(() => diagnosticRuns.id),
  snapshot_id: uuid().references(() => dataSnapshots.id),
  collection_run_id: uuid().references(() => collectionRuns.id),
  analysis_invocation_id: uuid().references(() => analysisInvocations.id),
  source_provider: text().notNull(),
  origin: text().notNull(),
  method: text().notNull(),
  grade: text().notNull(),
  availability: text().notNull(),
  support: text().notNull(),
  subject_refs: jsonb().$type<JsonArray>().notNull(),
  claim: text().notNull(),
  observed_at: tz().notNull(),
  limitation: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 19. findings
// ---------------------------------------------------------------------------
export const findings = app.table("findings", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  finding_key: text().notNull(),
  rule_id: text().notNull(),
  rule_version: integer().notNull(),
  rule_family: text().notNull(),
  intent: text().notNull(),
  domain: text().notNull(),
  title_key: text().notNull(),
  title_args: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  summary: text().notNull(),
  summary_locale: text().notNull(),
  summary_invocation_id: uuid().references(() => analysisInvocations.id),
  subject_refs: jsonb().$type<JsonArray>().notNull(),
  severity: text().notNull(),
  confidence: text().notNull(),
  review_state: text().notNull().default("unreviewed"),
  review_revision: integer().notNull().default(0),
  review_reason: text(),
  review_note: text(),
  active: boolean().notNull().default(true),
  regressed: boolean().notNull().default(false),
  first_seen_run_id: uuid()
    .notNull()
    .references(() => diagnosticRuns.id),
  last_seen_run_id: uuid()
    .notNull()
    .references(() => diagnosticRuns.id),
  first_seen_at: tz().notNull(),
  last_seen_at: tz().notNull(),
  resolved_at: tz(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 20. finding_observations  (append-only)
// ---------------------------------------------------------------------------
export const findingObservations = app.table("finding_observations", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  finding_id: uuid()
    .notNull()
    .references(() => findings.id),
  diagnostic_run_id: uuid()
    .notNull()
    .references(() => diagnosticRuns.id),
  evidence_id: uuid()
    .notNull()
    .references(() => evidence.id),
  role: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 21. finding_review_events  (append-only)
// ---------------------------------------------------------------------------
export const findingReviewEvents = app.table("finding_review_events", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  finding_id: uuid()
    .notNull()
    .references(() => findings.id),
  from_state: text().notNull(),
  to_state: text().notNull(),
  revision: integer().notNull(),
  reason: text(),
  note: text(),
  actor_id: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 22. actions
// ---------------------------------------------------------------------------
export const actions = app.table("actions", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  source_finding_id: uuid()
    .notNull()
    .references(() => findings.id),
  source_diagnostic_run_id: uuid()
    .notNull()
    .references(() => diagnosticRuns.id),
  action_key: text().notNull(),
  template_id: text().notNull(),
  template_version: integer().notNull().default(1),
  title: text().notNull(),
  description: text().notNull(),
  content_locale: text().notNull(),
  priority_band: text().notNull(),
  roadmap_lane: text().notNull(),
  status: text().notNull().default("candidate"),
  effort: text().notNull(),
  risk: text().notNull(),
  expected_outcome: text().notNull(),
  evidence_refs: jsonb()
    .$type<JsonArray>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  revision: integer().notNull().default(1),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 23. action_override_audit  (append-only)
// ---------------------------------------------------------------------------
export const actionOverrideAudit = app.table("action_override_audit", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  action_id: uuid()
    .notNull()
    .references(() => actions.id),
  from_revision: integer().notNull(),
  to_revision: integer().notNull(),
  old_values: jsonb().$type<JsonObject>().notNull(),
  new_values: jsonb().$type<JsonObject>().notNull(),
  reason: text().notNull(),
  note: text(),
  actor_id: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 24. execution_artifacts
// ---------------------------------------------------------------------------
export const executionArtifacts = app.table("execution_artifacts", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  action_id: uuid()
    .notNull()
    .references(() => actions.id),
  artifact_type: text().notNull(),
  status: text().notNull().default("generating"),
  generation_mode: text().notNull(),
  output_locale: text().notNull(),
  current_revision: integer().notNull().default(0),
  validation_state: text().notNull().default("pending"),
  content_hash: text(),
  latest_generation_run_id: uuid().references(() => asyncRuns.id),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 25. artifact_revisions  (append-only)
// ---------------------------------------------------------------------------
export const artifactRevisions = app.table("artifact_revisions", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  artifact_id: uuid()
    .notNull()
    .references(() => executionArtifacts.id),
  revision: integer().notNull(),
  output_locale: text().notNull(),
  content_format: text().notNull(),
  content_text: text(),
  content_json: jsonb().$type<unknown>(),
  content_hash: text().notNull(),
  generated_by: text().notNull(),
  editor_id: uuid(),
  analysis_invocation_id: uuid().references(() => analysisInvocations.id),
  note: text(),
  validation_errors: jsonb()
    .$type<JsonArray>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 26. export_bundles
// ---------------------------------------------------------------------------
export const exportBundles = app.table("export_bundles", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  async_run_id: uuid()
    .notNull()
    .references(() => asyncRuns.id),
  kind: text().notNull(),
  schema_version: text().notNull().default("signalframe.service-bundle.0.3.0"),
  output_locale: text().notNull(),
  object_key: text(),
  checksum: text(),
  byte_size: bigint({ mode: "number" }),
  item_counts: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  manifest: jsonb().$type<JsonObject>(),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 27. idempotency_keys
// ---------------------------------------------------------------------------
export const idempotencyKeys = app.table("idempotency_keys", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  scope: text().notNull(),
  idempotency_key: text().notNull(),
  request_hash: text().notNull(),
  status: text().notNull().default("in_progress"),
  response_status: integer(),
  response_body: jsonb().$type<unknown>(),
  resource_type: text(),
  resource_id: uuid(),
  expires_at: tz().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 28. telemetry_events  (append-only)
// ---------------------------------------------------------------------------
export const telemetryEvents = app.table("telemetry_events", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid().references(() => clientProjects.id),
  event_name: text().notNull(),
  actor_id: uuid(),
  properties: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 29. capability_runs  (async_run_id shares async_runs.id)
// ---------------------------------------------------------------------------
export const capabilityRuns = app.table("capability_runs", {
  async_run_id: uuid()
    .primaryKey()
    .references(() => asyncRuns.id),
  capability_id: text().notNull(),
  capability_version: text().notNull(),
  input_manifest_hash: text().notNull(),
  mode: text().notNull(),
  side_effect_class: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 30. audit_runs  (tenant-scoped projection over canonical runs)
// ---------------------------------------------------------------------------
export const auditRuns = app.table("audit_runs", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  diagnostic_run_id: uuid()
    .notNull()
    .references(() => diagnosticRuns.id),
  capability_run_id: uuid()
    .notNull()
    .references(() => capabilityRuns.async_run_id),
  scope_kind: text().notNull(),
  scope_key: text().notNull(),
  projection_version: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 31. audit_module_results  (composite PK, append-once)
// ---------------------------------------------------------------------------
export const auditModuleResults = app.table(
  "audit_module_results",
  {
    audit_run_id: uuid()
      .notNull()
      .references(() => auditRuns.id),
    module_id: text().notNull(),
    coverage_state: text().notNull(),
    summary: jsonb()
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: tz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.audit_run_id, t.module_id] })],
);

// ---------------------------------------------------------------------------
// 32. site_pages  (project-scoped mutable URL identity)
// ---------------------------------------------------------------------------
export const sitePages = app.table("site_pages", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  normalized_url: text().notNull(),
  normalized_url_hash: text().notNull(),
  template_key: text(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 33. page_snapshots  (append-only projection of data_snapshots)
// ---------------------------------------------------------------------------
export const pageSnapshots = app.table("page_snapshots", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_page_id: uuid()
    .notNull()
    .references(() => sitePages.id),
  data_snapshot_id: uuid()
    .notNull()
    .references(() => dataSnapshots.id),
  content_hash: text().notNull(),
  // Nullable only for immutable rows written before migration 0012. The
  // database check/trigger requires this field on every new PageSnapshot.
  canonical_extract: text(),
  extract: jsonb().$type<JsonObject>().notNull(),
  captured_at: tz().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 36. finding_targets  (append-only per-DiagnosticRun target membership)
// ---------------------------------------------------------------------------
export const findingTargets = app.table("finding_targets", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  finding_id: uuid()
    .notNull()
    .references(() => findings.id),
  diagnostic_run_id: uuid()
    .notNull()
    .references(() => diagnosticRuns.id),
  relation: text().notNull(),
  target_kind: text().notNull(),
  target_ref: text().notNull(),
  resolution_state: text().notNull(),
  basis_kind: text().notNull(),
  site_page_id: uuid().references(() => sitePages.id),
  page_snapshot_id: uuid().references(() => pageSnapshots.id),
  source_observation_id: uuid().references(() => normalizedObservations.id),
  member_ref: text(),
  limitation: text(),
  // The insert trigger replaces this placeholder with the canonical DB hash.
  relation_key: text().notNull().default(sql`repeat('0', 64)`),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 37. keyword_occurrences  (append-only canonical source membership)
// ---------------------------------------------------------------------------
export const keywordOccurrences = app.table("keyword_occurrences", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  data_snapshot_id: uuid().references(() => dataSnapshots.id),
  normalized_observation_id: uuid().references(
    () => normalizedObservations.id,
  ),
  display_keyword: text().notNull(),
  normalized_keyword: text().notNull(),
  market: text().notNull(),
  language_tag: text().notNull(),
  query_kind: text().notNull(),
  source_kind: text().notNull(),
  scope_basis: text().notNull(),
  source_pointer: text(),
  source_ref: text().notNull(),
  collected_at: tz().notNull(),
  provider_data_as_of: tz(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 38. keyword_entities  (stable project-scoped keyword identity)
// ---------------------------------------------------------------------------
export const keywordEntities = app.table("keyword_entities", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  display_keyword: text().notNull(),
  normalized_keyword: text().notNull(),
  market: text().notNull(),
  language_tag: text().notNull(),
  query_kind: text().notNull(),
  status: text().notNull().default("candidate"),
  intent: text(),
  buyer_stage: text(),
  cluster_key: text(),
  mapping_decision: text().notNull().default("unassigned"),
  mapped_site_page_id: uuid().references(() => sitePages.id),
  mapping_review_state: text().notNull().default("unreviewed"),
  mapping_revision: integer().notNull().default(0),
  first_seen_at: tz().notNull(),
  last_seen_at: tz().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 39. keyword_entity_sources  (append-only entity/occurrence provenance)
// ---------------------------------------------------------------------------
export const keywordEntitySources = app.table(
  "keyword_entity_sources",
  {
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    keyword_entity_id: uuid()
      .notNull()
      .references(() => keywordEntities.id),
    keyword_occurrence_id: uuid()
      .notNull()
      .references(() => keywordOccurrences.id),
    created_at: tz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.keyword_entity_id, t.keyword_occurrence_id],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Aggregate schema (consumed by drizzle(pool, { schema })).
// ---------------------------------------------------------------------------
export const schema = {
  workspaces,
  operatorProfiles,
  clientProjects,
  sites,
  icpProfiles,
  sourceConnections,
  sourceCredentials,
  oauthIntents,
  importPreviews,
  asyncRuns,
  collectionRuns,
  dataSnapshots,
  productProfileRuns,
  productProfileInvocationAttempts,
  normalizedObservations,
  providerDiscrepancies,
  diagnosticRuns,
  diagnosticRunRules,
  analysisInvocations,
  evidence,
  findings,
  findingObservations,
  findingReviewEvents,
  actions,
  actionOverrideAudit,
  executionArtifacts,
  artifactRevisions,
  exportBundles,
  idempotencyKeys,
  telemetryEvents,
  capabilityRuns,
  auditRuns,
  auditModuleResults,
  sitePages,
  pageSnapshots,
  findingTargets,
  keywordOccurrences,
  keywordEntities,
  keywordEntitySources,
} as const;
