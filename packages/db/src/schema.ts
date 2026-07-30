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
// 11. analysis_refresh_runs  (id shares async_runs.id)
// ---------------------------------------------------------------------------
export const analysisRefreshRuns = app.table("analysis_refresh_runs", {
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
  plan_manifest: jsonb().$type<JsonObject>().notNull(),
  plan_hash: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 12. analysis_refresh_steps
// ---------------------------------------------------------------------------
export const analysisRefreshSteps = app.table("analysis_refresh_steps", {
  analysis_refresh_run_id: uuid()
    .notNull()
    .references(() => analysisRefreshRuns.id),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  ordinal: smallint().notNull(),
  step_key: text().notNull(),
  required: boolean().notNull(),
  state: text().notNull().default("pending"),
  child_async_run_id: uuid().references(() => asyncRuns.id),
  result_snapshot_id: uuid().references(
    (): AnyPgColumn => dataSnapshots.id,
  ),
  skip_reason: text(),
  error: jsonb().$type<JsonObject>(),
  started_at: tz(),
  completed_at: tz(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 13. collection_runs  (id shares async_runs.id)
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
  crawl_seed_site_page_id: uuid().references((): AnyPgColumn => sitePages.id),
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
  site_page_id: uuid().references((): AnyPgColumn => sitePages.id),
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
  relation_key: text()
    .notNull()
    .default(sql`repeat('0', 64)`),
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
  normalized_observation_id: uuid().references(() => normalizedObservations.id),
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
// 40. competitor_entities  (stable project-scoped domain identity)
// ---------------------------------------------------------------------------
export const competitorEntities = app.table("competitor_entities", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  domain: text().notNull(),
  name: text(),
  review_status: text().notNull().default("candidate"),
  relationship: text(),
  analysis_scope: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  revision: integer().notNull().default(0),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 41. competitor_origin_occurrences  (append-only exact source lineage)
// ---------------------------------------------------------------------------
export const competitorOriginOccurrences = app.table(
  "competitor_origin_occurrences",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    competitor_id: uuid()
      .notNull()
      .references(() => competitorEntities.id),
    origin_kind: text().notNull(),
    source_name: text(),
    product_profile_id: uuid().references(() => icpProfiles.id),
    profile_version: integer(),
    candidate_id: uuid(),
    field_provenance_path: text(),
    evidence_refs: jsonb().$type<JsonArray>(),
    source_review_status: text(),
    source_relationship: text(),
    source_analysis_scope: text().array(),
    data_snapshot_id: uuid().references(() => dataSnapshots.id),
    normalized_observation_id: uuid().references(
      () => normalizedObservations.id,
    ),
    import_preview_id: uuid().references(() => importPreviews.id),
    source_pointer: text(),
    manual_entry_id: uuid(),
    observed_at: tz(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 42. flow_shadow_runs  (append-only Content Shadow projection over a run)
// ---------------------------------------------------------------------------
export const flowShadowRuns = app.table("flow_shadow_runs", {
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
  capability_run_id: uuid()
    .notNull()
    .references(() => capabilityRuns.async_run_id),
  source_finding_id: uuid()
    .notNull()
    .references(() => findings.id),
  source_action_id: uuid()
    .notNull()
    .references(() => actions.id),
  content_brief_artifact_id: uuid()
    .notNull()
    .references(() => executionArtifacts.id),
  content_brief_revision: integer().notNull(),
  flow_adapter_version: text().notNull(),
  frozen_input_manifest: jsonb().$type<JsonObject>().notNull(),
  content_hash: text().notNull(),
  projection_version: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 43. flow_shadow_research_packs  (append-only research facts, one per run)
// ---------------------------------------------------------------------------
export const flowShadowResearchPacks = app.table("flow_shadow_research_packs", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  flow_shadow_run_id: uuid()
    .notNull()
    .references(() => flowShadowRuns.id),
  analysis_invocation_id: uuid().references(() => analysisInvocations.id),
  content_hash: text().notNull(),
  pack: jsonb().$type<JsonObject>().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 44. flow_shadow_qa_gates  (append-only SEO/GEO + factual review verdicts)
// ---------------------------------------------------------------------------
export const flowShadowQaGates = app.table("flow_shadow_qa_gates", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  flow_shadow_run_id: uuid()
    .notNull()
    .references(() => flowShadowRuns.id),
  evaluated_artifact_id: uuid()
    .notNull()
    .references(() => executionArtifacts.id),
  evaluated_revision: integer().notNull(),
  analysis_invocation_id: uuid().references(() => analysisInvocations.id),
  verdict: text().notNull(),
  claims: jsonb()
    .$type<JsonArray>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 45. artifact_approval_events  (append-only exact-revision approval ledger)
// ---------------------------------------------------------------------------
export const artifactApprovalEvents = app.table("artifact_approval_events", {
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
  artifact_revision_id: uuid()
    .notNull()
    .references(() => artifactRevisions.id),
  artifact_revision: integer().notNull(),
  artifact_content_hash: text().notNull(),
  event_kind: text().notNull(),
  supersedes_approval_event_id: uuid().references(
    (): AnyPgColumn => artifactApprovalEvents.id,
  ),
  supersedes_approval_event_kind: text(),
  event_actor_id: uuid().notNull(),
  reviewer_actor_id: uuid(),
  qa_gate_version: text().notNull(),
  qa_gate_snapshot: jsonb().$type<JsonObject>().notNull(),
  qa_gate_snapshot_hash: text().notNull(),
  customer_acknowledgement: jsonb().$type<JsonObject>().notNull(),
  customer_acknowledgement_hash: text().notNull(),
  reason: text(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 46. delivery_authorization_grants  (scoped encrypted provider authority)
// ---------------------------------------------------------------------------
export const deliveryAuthorizationGrants = app.table(
  "delivery_authorization_grants",
  {
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
    provider_kind: text().notNull(),
    purpose: text().notNull(),
    state: text().notNull().default("ready"),
    destination_ref: uuid(),
    destination_revision: integer(),
    target_ref: text(),
    requested_scope: jsonb().$type<JsonObject>().notNull(),
    requested_scope_hash: text().notNull(),
    authorization_snapshot: jsonb().$type<JsonObject>().notNull(),
    authorization_snapshot_hash: text().notNull(),
    encrypted_payload: bytea(),
    cipher_version: smallint(),
    key_version: text(),
    secret_metadata: jsonb()
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    expires_at: tz(),
    consumed_at: tz(),
    revoked_at: tz(),
    revoked_by: uuid(),
    revocation_reason: text(),
    created_by: uuid().notNull(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 47. publication_destinations  (append-only delivery-connection revisions)
// ---------------------------------------------------------------------------
export const publicationDestinations = app.table("publication_destinations", {
  id: uuid().primaryKey().defaultRandom(),
  destination_ref: uuid().notNull(),
  revision: integer().notNull(),
  supersedes_id: uuid().references(
    (): AnyPgColumn => publicationDestinations.id,
  ),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  provider_kind: text().notNull(),
  target_ref: text().notNull(),
  state: text().notNull(),
  authorization_grant_id: uuid()
    .notNull()
    .references(() => deliveryAuthorizationGrants.id),
  provider_scope: jsonb().$type<JsonObject>().notNull(),
  provider_scope_hash: text().notNull(),
  authorization_snapshot: jsonb().$type<JsonObject>().notNull(),
  authorization_snapshot_hash: text().notNull(),
  readiness_observation: jsonb().$type<JsonObject>().notNull(),
  limitation: text(),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 48. publication_preview_events  (append-only publish/rollback authority)
// ---------------------------------------------------------------------------
export const publicationPreviewEvents = app.table(
  "publication_preview_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    preview_ref: text().notNull(),
    event_kind: text().notNull(),
    supersedes_preview_event_id: uuid().references(
      (): AnyPgColumn => publicationPreviewEvents.id,
    ),
    supersedes_preview_event_kind: text(),
    preview_kind: text().notNull(),
    facts_schema_version: text().notNull(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    site_id: uuid()
      .notNull()
      .references(() => sites.id),
    destination_id: uuid()
      .notNull()
      .references(() => publicationDestinations.id),
    destination_ref: uuid().notNull(),
    destination_revision: integer().notNull(),
    provider_kind: text().notNull(),
    target_ref: text().notNull(),
    action_id: uuid()
      .notNull()
      .references(() => actions.id),
    artifact_id: uuid()
      .notNull()
      .references(() => executionArtifacts.id),
    artifact_revision_id: uuid()
      .notNull()
      .references(() => artifactRevisions.id),
    artifact_revision: integer().notNull(),
    artifact_content_hash: text().notNull(),
    artifact_approval_event_id: uuid()
      .notNull()
      .references(() => artifactApprovalEvents.id),
    artifact_approval_event_kind: text().notNull(),
    source_publication_attempt_id: uuid().references(
      (): AnyPgColumn => publicationAttempts.id,
    ),
    source_change_receipt_id: uuid().references(
      (): AnyPgColumn => publicationReceipts.id,
    ),
    provider_plan: jsonb().$type<JsonObject>().notNull(),
    remote_precondition: jsonb().$type<JsonObject>().notNull(),
    rollback_plan: jsonb().$type<JsonObject>().notNull(),
    preview_checksum: text().notNull(),
    content_checksum: text().notNull(),
    facts_hash: text().notNull(),
    expires_at: tz().notNull(),
    event_actor_id: uuid().notNull(),
    idempotency_key: text().notNull(),
    request_hash: text().notNull(),
    reason: text(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 49. publication_attempts  (append-only external-write reservation ledger)
// ---------------------------------------------------------------------------
export const publicationAttempts = app.table("publication_attempts", {
  id: uuid().primaryKey().defaultRandom(),
  attempt_kind: text().notNull(),
  source_publication_attempt_id: uuid().references(
    (): AnyPgColumn => publicationAttempts.id,
  ),
  source_change_receipt_id: uuid().references(
    (): AnyPgColumn => publicationReceipts.id,
  ),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  async_run_id: uuid()
    .notNull()
    .references(() => asyncRuns.id),
  destination_id: uuid()
    .notNull()
    .references(() => publicationDestinations.id),
  destination_ref: uuid().notNull(),
  destination_revision: integer().notNull(),
  provider_kind: text().notNull(),
  target_ref: text().notNull(),
  action_id: uuid()
    .notNull()
    .references(() => actions.id),
  artifact_id: uuid()
    .notNull()
    .references(() => executionArtifacts.id),
  artifact_revision_id: uuid()
    .notNull()
    .references(() => artifactRevisions.id),
  approved_artifact_revision: integer().notNull(),
  approved_artifact_content_hash: text().notNull(),
  publication_approval_event_id: uuid().references(
    () => artifactApprovalEvents.id,
  ),
  publication_approval_event_kind: text(),
  source_approval_event_id: uuid().references(
    () => artifactApprovalEvents.id,
  ),
  source_approval_event_kind: text(),
  side_effect_class: text().notNull(),
  authorization_grant_id: uuid()
    .notNull()
    .references(() => deliveryAuthorizationGrants.id),
  authorization_purpose: text().notNull(),
  authorization_snapshot: jsonb().$type<JsonObject>().notNull(),
  authorization_snapshot_hash: text().notNull(),
  preview_event_id: uuid()
    .notNull()
    .references(() => publicationPreviewEvents.id),
  preview_event_kind: text().notNull(),
  preview_facts_hash: text().notNull(),
  preview_ref: text().notNull(),
  preview_checksum: text().notNull(),
  content_checksum: text().notNull(),
  remote_precondition: jsonb().$type<JsonObject>().notNull(),
  rollback_plan: jsonb().$type<JsonObject>().notNull(),
  idempotency_key: text().notNull(),
  request_hash: text().notNull(),
  requested_by: uuid().notNull(),
  requested_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 50. publication_receipts  (append-only provider/live verification facts)
// ---------------------------------------------------------------------------
export const publicationReceipts = app.table("publication_receipts", {
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
  publication_attempt_id: uuid()
    .notNull()
    .references(() => publicationAttempts.id),
  receipt_kind: text().notNull(),
  predecessor_delivery_receipt_id: uuid().references(
    (): AnyPgColumn => publicationReceipts.id,
  ),
  provider_kind: text().notNull(),
  provider_request_id: text(),
  remote_scope_ref: text().notNull(),
  remote_object_kind: text().notNull(),
  remote_object_id: text().notNull(),
  remote_revision: text().notNull(),
  delivery_url: text(),
  live_canonical_url: text(),
  artifact_content_hash: text().notNull(),
  content_checksum: text().notNull(),
  verification_state: text().notNull(),
  remote_facts: jsonb().$type<JsonObject>().notNull(),
  evidence_refs: jsonb().$type<JsonArray>().notNull(),
  limitation: text(),
  observed_at: tz().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 51. measurement_windows  (append-only Change Receipt outcome anchors)
// ---------------------------------------------------------------------------
export const measurementWindows = app.table("measurement_windows", {
  id: uuid().primaryKey(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  async_run_id: uuid()
    .notNull()
    .references(() => asyncRuns.id),
  target_kind: text().notNull(),
  target_ref: text().notNull(),
  site_page_id: uuid()
    .notNull()
    .references(() => sitePages.id),
  action_id: uuid()
    .notNull()
    .references(() => actions.id),
  artifact_id: uuid()
    .notNull()
    .references(() => executionArtifacts.id),
  artifact_revision_id: uuid()
    .notNull()
    .references(() => artifactRevisions.id),
  artifact_revision: integer().notNull(),
  artifact_content_hash: text().notNull(),
  content_checksum: text().notNull(),
  publication_attempt_id: uuid()
    .notNull()
    .references(() => publicationAttempts.id),
  verified_change_receipt_id: uuid()
    .notNull()
    .references(() => publicationReceipts.id),
  timeline_delivery_receipt_id: uuid().references(
    () => publicationReceipts.id,
  ),
  before_start_at: tz().notNull(),
  before_end_at: tz().notNull(),
  after_start_at: tz().notNull(),
  after_end_at: tz().notNull(),
  timezone: text().notNull(),
  url: text().notNull(),
  canonical_url: text().notNull(),
  interpretation: text().notNull(),
  state: text().notNull(),
  technical_verification_ref: uuid(),
  limitation: text(),
  result_hash: text().notNull(),
  recorded_at: tz().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 52. measurement_gsc_dimensions  (canonical GSC before/after projection)
// ---------------------------------------------------------------------------
export const measurementGscDimensions = app.table(
  "measurement_gsc_dimensions",
  {
    measurement_window_id: uuid()
      .primaryKey()
      .references(() => measurementWindows.id),
    workspace_id: uuid().notNull(),
    project_id: uuid().notNull(),
    state: text().notNull(),
    baseline_source_ref: uuid(),
    baseline_snapshot_id: uuid()
      .references(() => dataSnapshots.id),
    baseline_observation_id: uuid()
      .references(() => normalizedObservations.id),
    baseline_covered_window: jsonb().$type<JsonObject>(),
    baseline_observed_at: tz(),
    baseline_freshness: text(),
    outcome_source_ref: uuid(),
    outcome_snapshot_id: uuid()
      .references(() => dataSnapshots.id),
    outcome_observation_id: uuid()
      .references(() => normalizedObservations.id),
    outcome_covered_window: jsonb().$type<JsonObject>(),
    outcome_observed_at: tz(),
    outcome_freshness: text(),
    sample_baseline: bigint({ mode: "number" }),
    sample_outcome: bigint({ mode: "number" }),
    sample_unit: text().notNull(),
    coverage: text().notNull(),
    limitation: text(),
    clicks_baseline: bigint({ mode: "number" }),
    clicks_outcome: bigint({ mode: "number" }),
    impressions_baseline: bigint({ mode: "number" }),
    impressions_outcome: bigint({ mode: "number" }),
    ctr_baseline: numeric({ mode: "number" }),
    ctr_outcome: numeric({ mode: "number" }),
    average_position_baseline: numeric({ mode: "number" }),
    average_position_outcome: numeric({ mode: "number" }),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 53. measurement_ga4_dimensions  (canonical GA4 before/after projection)
// ---------------------------------------------------------------------------
export const measurementGa4Dimensions = app.table(
  "measurement_ga4_dimensions",
  {
    measurement_window_id: uuid()
      .primaryKey()
      .references(() => measurementWindows.id),
    workspace_id: uuid().notNull(),
    project_id: uuid().notNull(),
    state: text().notNull(),
    baseline_source_ref: uuid(),
    baseline_snapshot_id: uuid()
      .references(() => dataSnapshots.id),
    baseline_observation_id: uuid()
      .references(() => normalizedObservations.id),
    baseline_covered_window: jsonb().$type<JsonObject>(),
    baseline_observed_at: tz(),
    baseline_freshness: text(),
    outcome_source_ref: uuid(),
    outcome_snapshot_id: uuid()
      .references(() => dataSnapshots.id),
    outcome_observation_id: uuid()
      .references(() => normalizedObservations.id),
    outcome_covered_window: jsonb().$type<JsonObject>(),
    outcome_observed_at: tz(),
    outcome_freshness: text(),
    sample_baseline: bigint({ mode: "number" }),
    sample_outcome: bigint({ mode: "number" }),
    sample_unit: text().notNull(),
    coverage: text().notNull(),
    limitation: text(),
    direct_conversion_definition_id: uuid(),
    direct_event_names: text().array(),
    direct_counting_method: text(),
    direct_attribution_boundary: text(),
    direct_lookback_window_days: integer(),
    assisted_conversion_definition_id: uuid(),
    assisted_event_names: text().array(),
    assisted_counting_method: text(),
    assisted_attribution_boundary: text(),
    assisted_lookback_window_days: integer(),
    sessions_baseline: bigint({ mode: "number" }),
    sessions_outcome: bigint({ mode: "number" }),
    engaged_sessions_baseline: bigint({ mode: "number" }),
    engaged_sessions_outcome: bigint({ mode: "number" }),
    direct_conversions_baseline: bigint({ mode: "number" }),
    direct_conversions_outcome: bigint({ mode: "number" }),
    assisted_conversions_baseline: bigint({ mode: "number" }),
    assisted_conversions_outcome: bigint({ mode: "number" }),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 54. measurement_geo_dimensions  (governed GEO before/after projection)
// ---------------------------------------------------------------------------
export const measurementGeoDimensions = app.table(
  "measurement_geo_dimensions",
  {
    measurement_window_id: uuid()
      .primaryKey()
      .references(() => measurementWindows.id),
    workspace_id: uuid().notNull(),
    project_id: uuid().notNull(),
    state: text().notNull(),
    baseline_source_ref: uuid(),
    baseline_snapshot_id: uuid()
      .references(() => dataSnapshots.id),
    baseline_observation_id: uuid()
      .references(() => normalizedObservations.id),
    baseline_covered_window: jsonb().$type<JsonObject>(),
    baseline_observed_at: tz(),
    baseline_freshness: text(),
    outcome_source_ref: uuid(),
    outcome_snapshot_id: uuid()
      .references(() => dataSnapshots.id),
    outcome_observation_id: uuid()
      .references(() => normalizedObservations.id),
    outcome_covered_window: jsonb().$type<JsonObject>(),
    outcome_observed_at: tz(),
    outcome_freshness: text(),
    sample_baseline: bigint({ mode: "number" }),
    sample_outcome: bigint({ mode: "number" }),
    sample_unit: text().notNull(),
    coverage: text().notNull(),
    limitation: text(),
    tracked_queries_baseline: bigint({ mode: "number" }),
    tracked_queries_outcome: bigint({ mode: "number" }),
    cited_queries_baseline: bigint({ mode: "number" }),
    cited_queries_outcome: bigint({ mode: "number" }),
    citations_baseline: bigint({ mode: "number" }),
    citations_outcome: bigint({ mode: "number" }),
    citation_rate_baseline: numeric({ mode: "number" }),
    citation_rate_outcome: numeric({ mode: "number" }),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 55. measurement_utm_identities  (stable exact UTM tuple)
// ---------------------------------------------------------------------------
export const measurementUtmIdentities = app.table(
  "measurement_utm_identities",
  {
    id: uuid().primaryKey(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    source: text().notNull(),
    medium: text().notNull(),
    campaign: text().notNull(),
    content: text().notNull(),
    identity_hash: text().notNull(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 56. measurement_ga4_campaigns  (optional UTM rows for one GA4 dimension)
// ---------------------------------------------------------------------------
export const measurementGa4Campaigns = app.table(
  "measurement_ga4_campaigns",
  {
    measurement_window_id: uuid()
      .notNull()
      .references(() => measurementWindows.id),
    utm_identity_id: uuid()
      .notNull()
      .references(() => measurementUtmIdentities.id),
    workspace_id: uuid().notNull(),
    project_id: uuid().notNull(),
    sessions_baseline: bigint({ mode: "number" }),
    sessions_outcome: bigint({ mode: "number" }),
    direct_conversions_baseline: bigint({ mode: "number" }),
    direct_conversions_outcome: bigint({ mode: "number" }),
    assisted_conversions_baseline: bigint({ mode: "number" }),
    assisted_conversions_outcome: bigint({ mode: "number" }),
    created_at: tz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.measurement_window_id, t.utm_identity_id],
    }),
  ],
);

// ---------------------------------------------------------------------------
// 57. topic_model_revisions  (draft/confirmed Topic topology revisions)
// ---------------------------------------------------------------------------
export const topicModelRevisions = app.table("topic_model_revisions", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  revision: integer().notNull(),
  edit_revision: integer().notNull().default(0),
  status: text().notNull(),
  // The SQL authority uses a deferred same-model composite FK because a model
  // and its root node are inserted together. Keep the query model nullable and
  // let the migration enforce the stronger cross-row invariant.
  root_topic_node_id: uuid(),
  generation_basis: jsonb()
    .$type<JsonObject>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  evidence_refs: jsonb()
    .$type<JsonArray>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  content_hash: text(),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
  updated_at: tz().notNull().defaultNow(),
  confirmed_by: uuid(),
  confirmed_at: tz(),
});

// ---------------------------------------------------------------------------
// 58. topic_node_identities  (stable Topic ids across model revisions)
// ---------------------------------------------------------------------------
export const topicNodeIdentities = app.table("topic_node_identities", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  created_in_revision: integer().notNull(),
  initial_cluster_key: text().notNull(),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 59. topic_node_revisions  (labels/hierarchy/intent in one Topic model)
// ---------------------------------------------------------------------------
export const topicNodeRevisions = app.table("topic_node_revisions", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  topic_node_id: uuid()
    .notNull()
    .references(() => topicNodeIdentities.id),
  topic_model_revision: integer().notNull(),
  parent_topic_node_id: uuid().references(() => topicNodeIdentities.id),
  label: text().notNull(),
  description: text(),
  intent_envelope: jsonb()
    .$type<JsonArray>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  lifecycle_state: text().notNull().default("active"),
  created_by: uuid().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 60. topic_cluster_aliases  (inclusive historical cluster resolution)
// ---------------------------------------------------------------------------
export const topicClusterAliases = app.table("topic_cluster_aliases", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  topic_node_id: uuid()
    .notNull()
    .references(() => topicNodeIdentities.id),
  legacy_cluster_key: text().notNull(),
  valid_from_revision: integer().notNull(),
  valid_to_revision: integer(),
  alias_kind: text().notNull(),
  is_current: boolean().notNull(),
  created_by: uuid(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 61. topic_node_successors  (append-only split/merge navigation edges)
// ---------------------------------------------------------------------------
export const topicNodeSuccessors = app.table("topic_node_successors", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  predecessor_topic_node_id: uuid()
    .notNull()
    .references(() => topicNodeIdentities.id),
  successor_topic_node_id: uuid()
    .notNull()
    .references(() => topicNodeIdentities.id),
  topic_model_revision: integer().notNull(),
  successor_kind: text().notNull(),
  created_by: uuid().notNull(),
  reason: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 62. keyword_review_decisions  (append-only Topic-aware review authority)
// ---------------------------------------------------------------------------
export const keywordReviewDecisions = app.table("keyword_review_decisions", {
  id: uuid().primaryKey().defaultRandom(),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  keyword_entity_id: uuid()
    .notNull()
    .references(() => keywordEntities.id),
  governance_revision: integer().notNull(),
  decision_origin: text().notNull(),
  status: text().notNull(),
  intent: text(),
  buyer_stage: text(),
  topic_node_id: uuid().references(() => topicNodeIdentities.id),
  topic_model_revision: integer(),
  cluster_key_at_decision: text(),
  mapping_decision: text().notNull(),
  mapped_site_page_id: uuid().references(() => sitePages.id),
  review_state: text().notNull(),
  assignment_invalidated_by: text(),
  decided_by: uuid(),
  reason: text().notNull(),
  decided_at: tz().notNull(),
  reviewed_projection: jsonb().$type<JsonObject>().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 63. keyword_relation_identities  (stable unordered Keyword pair)
// ---------------------------------------------------------------------------
export const keywordRelationIdentities = app.table(
  "keyword_relation_identities",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    keyword_a_id: uuid()
      .notNull()
      .references(() => keywordEntities.id),
    keyword_b_id: uuid()
      .notNull()
      .references(() => keywordEntities.id),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 64. keyword_relation_candidates  (append-only duplicate evidence)
// ---------------------------------------------------------------------------
export const keywordRelationCandidates = app.table(
  "keyword_relation_candidates",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    relation_id: uuid()
      .notNull()
      .references(() => keywordRelationIdentities.id),
    candidate_revision: integer().notNull().default(1),
    rule_version: text().notNull(),
    keyword_a_id: uuid()
      .notNull()
      .references(() => keywordEntities.id),
    keyword_a_display_keyword: text().notNull(),
    keyword_a_normalized_keyword: text().notNull(),
    keyword_a_governance_revision: integer().notNull(),
    keyword_a_topic_node_id: uuid().references(
      () => topicNodeIdentities.id,
    ),
    keyword_a_topic_model_revision: integer(),
    keyword_b_id: uuid()
      .notNull()
      .references(() => keywordEntities.id),
    keyword_b_display_keyword: text().notNull(),
    keyword_b_normalized_keyword: text().notNull(),
    keyword_b_governance_revision: integer().notNull(),
    keyword_b_topic_node_id: uuid().references(
      () => topicNodeIdentities.id,
    ),
    keyword_b_topic_model_revision: integer(),
    mapped_site_page_id: uuid()
      .notNull()
      .references(() => sitePages.id),
    normalized_intent: text().notNull(),
    market: text().notNull(),
    language_tag: text().notNull(),
    same_confirmed_topic: boolean().notNull(),
    lexical_token_overlap: numeric({
      precision: 6,
      scale: 5,
      mode: "number",
    }).notNull(),
    serp_overlap_availability: text().notNull(),
    serp_overlap: numeric({
      precision: 6,
      scale: 5,
      mode: "number",
    }),
    serp_overlap_limitation: text(),
    evidence_hash: text()
      .notNull()
      .default(sql`repeat('0', 64)`),
    generated_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 65. keyword_relation_decisions  (append-only fold/review decisions)
// ---------------------------------------------------------------------------
export const keywordRelationDecisions = app.table(
  "keyword_relation_decisions",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    relation_id: uuid()
      .notNull()
      .references(() => keywordRelationIdentities.id),
    candidate_id: uuid()
      .notNull()
      .references(() => keywordRelationCandidates.id),
    relation_revision: integer().notNull(),
    decision_kind: text().notNull(),
    primary_keyword_id: uuid().references(() => keywordEntities.id),
    supporting_keyword_id: uuid().references(
      () => keywordEntities.id,
    ),
    reason: text().notNull(),
    decided_by: uuid().notNull(),
    decided_at: tz().notNull(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 66. action_execution_step_definitions  (append-only progress authority)
// ---------------------------------------------------------------------------
export const actionExecutionStepDefinitions = app.table(
  "action_execution_step_definitions",
  {
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
    artifact_id: uuid().references(() => executionArtifacts.id),
    definition_key: text().notNull(),
    definition_version: integer().notNull(),
    steps: jsonb()
      .$type<Array<{ key: string; label: string }>>()
      .notNull(),
    step_count: integer().notNull(),
    definition_hash: text().notNull(),
    idempotency_key: text().notNull(),
    request_hash: text().notNull(),
    created_by: uuid().notNull(),
    created_at: tz().notNull(),
  },
);

// ---------------------------------------------------------------------------
// 67. action_execution_state_events  (append-only Action/Artifact state)
// ---------------------------------------------------------------------------
export const actionExecutionStateEvents = app.table(
  "action_execution_state_events",
  {
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
    artifact_id: uuid().references(() => executionArtifacts.id),
    revision: integer().notNull(),
    expected_revision: integer().notNull(),
    state: text().notNull(),
    transition_kind: text().notNull(),
    phase: text().notNull(),
    next_step: text(),
    blocker_code: text(),
    blocker_summary: text(),
    unlock_condition: text(),
    blocker_owner_id: uuid(),
    blocker_source_kind: text(),
    blocker_source_ref: text(),
    blocker_observed_at: tz(),
    blocker_freshness: text(),
    step_definition_id: uuid().references(
      () => actionExecutionStepDefinitions.id,
    ),
    step_definition_version: integer(),
    completed_steps: integer(),
    total_steps: integer(),
    idempotency_key: text().notNull(),
    request_hash: text().notNull(),
    actor_id: uuid().notNull(),
    occurred_at: tz().notNull(),
    created_at: tz().notNull(),
  },
);

// ---------------------------------------------------------------------------
// 68. competitor_monitor_settings  (Growth Map competitor-library cadence)
// ---------------------------------------------------------------------------
export const competitorMonitorSettings = app.table(
  "competitor_monitor_settings",
  {
    project_id: uuid()
      .primaryKey()
      .references(() => clientProjects.id),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    enabled: boolean().notNull(),
    frequency: text().notNull(),
    revision: integer().notNull(),
    updated_by: uuid().notNull(),
    created_at: tz().notNull().defaultNow(),
    updated_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 69. competitor_monitor_runs  (typed DataForSEO CollectionRun lineage)
// ---------------------------------------------------------------------------
export const competitorMonitorRuns = app.table(
  "competitor_monitor_runs",
  {
    id: uuid()
      .primaryKey()
      .references(() => collectionRuns.id),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    competitor_id: uuid()
      .notNull()
      .references(() => competitorEntities.id),
    analysis_scopes: text().array().notNull(),
    settings_revision: integer().notNull(),
    topic_model_revision: integer().notNull(),
    target_domain: text().notNull(),
    market: text().notNull(),
    language_tag: text().notNull(),
    scheduled_for: tz().notNull(),
    previous_monitor_run_id: uuid().references(
      (): AnyPgColumn => competitorMonitorRuns.id,
    ),
    previous_snapshot_id: uuid().references(() => dataSnapshots.id),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 70. competitor_monitor_evaluations  (one immutable evaluation per run)
// ---------------------------------------------------------------------------
export const competitorMonitorEvaluations = app.table(
  "competitor_monitor_evaluations",
  {
    monitor_run_id: uuid()
      .primaryKey()
      .references(() => competitorMonitorRuns.id),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    competitor_id: uuid()
      .notNull()
      .references(() => competitorEntities.id),
    evaluation_state: text().notNull(),
    result_snapshot_id: uuid()
      .notNull()
      .references(() => dataSnapshots.id),
    previous_snapshot_id: uuid().references(() => dataSnapshots.id),
    limitation: text(),
    evaluated_at: tz().notNull(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 71. competitor_monitor_signals  (Growth Map evidence/opportunity basis)
// ---------------------------------------------------------------------------
export const competitorMonitorSignals = app.table(
  "competitor_monitor_signals",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    competitor_id: uuid()
      .notNull()
      .references(() => competitorEntities.id),
    monitor_run_id: uuid()
      .notNull()
      .references(() => competitorMonitorEvaluations.monitor_run_id),
    signal_kind: text().notNull(),
    topic_node_id: uuid()
      .notNull()
      .references(() => topicNodeIdentities.id),
    topic_model_revision: integer().notNull(),
    keyword_entity_id: uuid().references(() => keywordEntities.id),
    content_url: text(),
    matched_keyword_ids: uuid().array(),
    overlap_ratio: numeric({ mode: "number" }),
    publication_evidence: text(),
    previous_rank: numeric({ mode: "number" }),
    current_rank: numeric({ mode: "number" }),
    improvement: numeric({ mode: "number" }),
    previous_snapshot_id: uuid()
      .notNull()
      .references(() => dataSnapshots.id),
    current_snapshot_id: uuid()
      .notNull()
      .references(() => dataSnapshots.id),
    limitation: text(),
    detected_at: tz().notNull(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 72. geo_query_observations  (immutable per-query GEO answer evidence)
// ---------------------------------------------------------------------------
export const geoQueryObservations = app.table(
  "geo_query_observations",
  {
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
    snapshot_id: uuid()
      .notNull()
      .references(() => dataSnapshots.id),
    normalized_observation_id: uuid()
      .notNull()
      .references(() => normalizedObservations.id),
    site_page_id: uuid()
      .notNull()
      .references(() => sitePages.id),
    canonical_url: text().notNull(),
    market_code: text().notNull(),
    language_tag: text().notNull(),
    query_text: text().notNull(),
    query_hash: text().notNull(),
    platform_kind: text().notNull(),
    platform_key: text().notNull(),
    model: text().notNull(),
    collector_kind: text().notNull(),
    collector_provider_key: text().notNull(),
    collector_version: text().notNull(),
    collected_at: tz().notNull(),
    citation_state: text().notNull(),
    answer_evidence_excerpt: text(),
    answer_content_hash: text(),
    answer_selector: text(),
    evidence_statements: jsonb()
      .$type<JsonArray>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    limitation: text(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 73. geo_citation_occurrences  (direct citation and cited-paragraph facts)
// ---------------------------------------------------------------------------
export const geoCitationOccurrences = app.table(
  "geo_citation_occurrences",
  {
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
    snapshot_id: uuid()
      .notNull()
      .references(() => dataSnapshots.id),
    normalized_observation_id: uuid()
      .notNull()
      .references(() => normalizedObservations.id),
    query_observation_id: uuid()
      .notNull()
      .references(() => geoQueryObservations.id),
    site_page_id: uuid()
      .notNull()
      .references(() => sitePages.id),
    canonical_url: text().notNull(),
    citation_url: text().notNull(),
    citation_ordinal: integer().notNull(),
    answer_evidence_excerpt: text().notNull(),
    cited_page_excerpt: text().notNull(),
    cited_page_content_hash: text().notNull(),
    cited_paragraph_hash: text().notNull(),
    cited_paragraph_selector: text().notNull(),
    cited_paragraph_index: integer(),
    evidence_classification: text().notNull(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 74. backlink_authority_snapshots  (immutable Growth Map source authority)
// ---------------------------------------------------------------------------
export const backlinkAuthoritySnapshots = app.table(
  "backlink_authority_snapshots",
  {
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
    competitor_id: uuid().references(() => competitorEntities.id),
    subject_kind: text().notNull(),
    source_kind: text().notNull(),
    provider: text().notNull(),
    captured_at: tz().notNull(),
    availability: text().notNull(),
    index_scope: text().notNull(),
    total_backlinks: bigint({ mode: "number" }),
    total_referring_domains: bigint({ mode: "number" }),
    observed_backlinks: bigint({ mode: "number" }),
    observed_referring_domains: bigint({ mode: "number" }),
    authority_metric_kind: text(),
    authority_metric_value: numeric({
      precision: 6,
      scale: 2,
      mode: "number",
    }),
    source_ref: text().notNull(),
    checksum: text().notNull(),
    row_count: bigint({ mode: "number" }).notNull(),
    import_preview_id: uuid().references(() => importPreviews.id),
    limitation: text(),
    created_at: tz().notNull().defaultNow(),
  },
);

// ---------------------------------------------------------------------------
// 75. backlink_facts  (immutable source URL -> target URL observations)
// ---------------------------------------------------------------------------
export const backlinkFacts = app.table("backlink_facts", {
  id: uuid().primaryKey().defaultRandom(),
  snapshot_id: uuid()
    .notNull()
    .references(() => backlinkAuthoritySnapshots.id),
  workspace_id: uuid()
    .notNull()
    .references(() => workspaces.id),
  project_id: uuid()
    .notNull()
    .references(() => clientProjects.id),
  site_id: uuid()
    .notNull()
    .references(() => sites.id),
  referring_domain: text().notNull(),
  source_url: text().notNull(),
  target_url: text().notNull(),
  target_site_page_id: uuid().references(() => sitePages.id),
  source_authority_metric_kind: text(),
  source_authority_metric_value: numeric({
    precision: 6,
    scale: 2,
    mode: "number",
  }),
  link_kind: text().notNull().default("unknown"),
  source_ref: text().notNull(),
  created_at: tz().notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 76. backlink_page_metrics  (exact persisted page-level source counts)
// ---------------------------------------------------------------------------
export const backlinkPageMetrics = app.table(
  "backlink_page_metrics",
  {
    snapshot_id: uuid()
      .notNull()
      .references(() => backlinkAuthoritySnapshots.id),
    workspace_id: uuid()
      .notNull()
      .references(() => workspaces.id),
    project_id: uuid()
      .notNull()
      .references(() => clientProjects.id),
    site_id: uuid()
      .notNull()
      .references(() => sites.id),
    site_page_id: uuid()
      .notNull()
      .references(() => sitePages.id),
    title: text(),
    backlink_count: bigint({ mode: "number" }).notNull(),
    referring_domain_count: bigint({ mode: "number" }).notNull(),
    metric_semantics: text().notNull(),
    created_at: tz().notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.snapshot_id, table.site_page_id],
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
  analysisRefreshRuns,
  analysisRefreshSteps,
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
  competitorEntities,
  competitorOriginOccurrences,
  flowShadowRuns,
  flowShadowResearchPacks,
  flowShadowQaGates,
  artifactApprovalEvents,
  deliveryAuthorizationGrants,
  publicationDestinations,
  publicationPreviewEvents,
  publicationAttempts,
  publicationReceipts,
  measurementWindows,
  measurementGscDimensions,
  measurementGa4Dimensions,
  measurementGeoDimensions,
  measurementUtmIdentities,
  measurementGa4Campaigns,
  topicModelRevisions,
  topicNodeIdentities,
  topicNodeRevisions,
  topicClusterAliases,
  topicNodeSuccessors,
  keywordReviewDecisions,
  keywordRelationIdentities,
  keywordRelationCandidates,
  keywordRelationDecisions,
  actionExecutionStepDefinitions,
  actionExecutionStateEvents,
  competitorMonitorSettings,
  competitorMonitorRuns,
  competitorMonitorEvaluations,
  competitorMonitorSignals,
  geoQueryObservations,
  geoCitationOccurrences,
  backlinkAuthoritySnapshots,
  backlinkFacts,
  backlinkPageMetrics,
} as const;
