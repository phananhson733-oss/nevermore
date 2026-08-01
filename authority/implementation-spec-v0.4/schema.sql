-- Nevermore active authority schema.
-- GENERATED FILE: do not hand-edit.
-- Source: ordered packages/db/migrations/*.sql.
-- Regenerate with authority/implementation-spec-v0.4/scripts/generate-schema.mjs.
-- BEGIN EXACT ORDERED MIGRATION 0001_init.sql
-- SignalFrame Service Delivery MVP 0.2.0
-- PostgreSQL 15+ reference DDL. pg-boss manages its own separate schema.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, public;

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'table %.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

-- Final defense for the Artifact state machine. Besides constraining the legal
-- status edges, it binds each content-producing edge to exactly one immutable
-- revision and each regeneration edge to a fresh owning AsyncRun.
CREATE OR REPLACE FUNCTION app.enforce_artifact_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- A content edit while already draft is a same-status revision update. Other
  -- same-status metadata updates are deliberately outside this status guard.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'draft'
     AND NEW.current_revision = OLD.current_revision + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready' AND NEW.status = 'draft'
     AND NEW.current_revision = OLD.current_revision + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'failed'
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status IN ('ready', 'archived')
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready' AND NEW.status = 'archived'
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('draft', 'ready', 'failed') AND NEW.status = 'generating'
     AND NEW.current_revision = OLD.current_revision
     AND NEW.latest_generation_run_id IS NOT NULL
     AND NEW.latest_generation_run_id IS DISTINCT FROM OLD.latest_generation_run_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'artifact status transition is not allowed'
    USING ERRCODE = '23514';
END;
$$;

-- Export bytes are uploaded before the canonical database commit. Bind the
-- eventual object reference to exactly one bundle/run/project and permit only
-- the single placeholder -> finalized transition. This keeps a same-project
-- wrong-run key from being signed or retained as somebody else's bundle.
CREATE OR REPLACE FUNCTION app.enforce_export_bundle_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_matches boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.async_run_id IS DISTINCT FROM OLD.async_run_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.output_locale IS DISTINCT FROM OLD.output_locale
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'export bundle identity is immutable'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.object_key IS NOT NULL OR NEW.object_key IS NULL THEN
      RAISE EXCEPTION 'export bundle may be finalized exactly once'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM app.async_runs AS run
    WHERE run.id = NEW.async_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'export'
  ) INTO run_matches;

  IF NOT run_matches THEN
    RAISE EXCEPTION 'export bundle run scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS app.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.operator_profiles (
  user_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.client_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  client_name text NOT NULL CHECK (length(btrim(client_name)) BETWEEN 1 AND 160),
  project_name text NOT NULL CHECK (length(btrim(project_name)) BETWEEN 1 AND 160),
  stage text NOT NULL DEFAULT 'setup'
    CHECK (stage IN ('setup','collecting','ready_to_diagnose','diagnosing','planning','executing','delivered')),
  default_delivery_locale text NOT NULL
    CHECK (default_delivery_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  current_icp_profile_id uuid,
  archived_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_projects_workspace_updated_idx
  ON app.client_projects(workspace_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin ~ '^https?://'),
  host text NOT NULL CHECK (length(host) BETWEEN 1 AND 253),
  market_codes text[] NOT NULL CHECK (cardinality(market_codes) BETWEEN 1 AND 20),
  language_codes text[] NOT NULL CHECK (cardinality(language_codes) BETWEEN 1 AND 20),
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, origin)
);

CREATE UNIQUE INDEX IF NOT EXISTS sites_one_primary_per_project_idx
  ON app.sites(project_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS app.icp_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  status text NOT NULL CHECK (status IN ('draft','complete')),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version),
  UNIQUE (project_id, content_hash)
);

CREATE TABLE IF NOT EXISTS app.source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('crawl','gsc','ga4','csv','dataforseo')),
  connection_type text NOT NULL CHECK (connection_type IN ('public','oauth','file_import','api_key_stub')),
  state text NOT NULL CHECK (state IN ('connecting','connected','syncing','available','partial','stale','permission_denied','unavailable','disconnected')),
  external_ref text,
  scopes text[] NOT NULL DEFAULT '{}',
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  limitation text NOT NULL CHECK (length(btrim(limitation)) >= 1),
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_successful_snapshot_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'disconnected') = (disconnected_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS source_connections_one_active_provider_idx
  ON app.source_connections(project_id, provider)
  WHERE disconnected_at IS NULL;

CREATE INDEX IF NOT EXISTS source_connections_project_idx
  ON app.source_connections(project_id, provider, updated_at DESC);

CREATE TABLE IF NOT EXISTS app.source_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  source_connection_id uuid NOT NULL UNIQUE REFERENCES app.source_connections(id) ON DELETE CASCADE,
  cipher_version smallint NOT NULL DEFAULT 1 CHECK (cipher_version >= 1),
  encrypted_payload bytea NOT NULL CHECK (octet_length(encrypted_payload) >= 32),
  key_version text NOT NULL CHECK (length(btrim(key_version)) >= 1),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.oauth_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  initiated_by uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('gsc','ga4')),
  state_hash bytea NOT NULL UNIQUE CHECK (octet_length(state_hash) = 32),
  pkce_verifier_cipher bytea NOT NULL CHECK (octet_length(pkce_verifier_cipher) >= 32),
  token_cipher bytea,
  candidate_properties jsonb CHECK (candidate_properties IS NULL OR jsonb_typeof(candidate_properties) = 'array'),
  redirect_path text NOT NULL CHECK (redirect_path ~ '^/p/[0-9a-f-]+/sources$'),
  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','properties_ready','consumed','expired','failed')),
  failure_code text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'properties_ready') = (candidate_properties IS NOT NULL AND token_cipher IS NOT NULL)
         OR status <> 'properties_ready'),
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL) OR status <> 'consumed')
);

CREATE INDEX IF NOT EXISTS oauth_intents_expiry_idx
  ON app.oauth_intents(status, expires_at);

CREATE TABLE IF NOT EXISTS app.import_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  template_id text NOT NULL CHECK (template_id = 'keyword_gap_v1'),
  raw_object_key text NOT NULL CHECK (length(btrim(raw_object_key)) >= 1),
  file_checksum text NOT NULL CHECK (file_checksum ~ '^[a-f0-9]{64}$'),
  row_count integer NOT NULL CHECK (row_count BETWEEN 0 AND 200000),
  detected_columns jsonb NOT NULL CHECK (jsonb_typeof(detected_columns) = 'array'),
  suggested_mapping jsonb NOT NULL CHECK (jsonb_typeof(suggested_mapping) = 'object'),
  preview_rows jsonb NOT NULL CHECK (jsonb_typeof(preview_rows) = 'array' AND jsonb_array_length(preview_rows) <= 20),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_errors) = 'array'),
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_warnings) = 'array'),
  status text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','consumed','expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL) OR status <> 'consumed')
);

CREATE INDEX IF NOT EXISTS import_previews_expiry_idx
  ON app.import_previews(status, expires_at);

CREATE TABLE IF NOT EXISTS app.async_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('collection','diagnostic','artifact_generation','export')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','partial','failed','cancelled')),
  active_key text,
  contract_version text NOT NULL DEFAULT '0.2.0',
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_payload) = 'object'),
  progress jsonb NOT NULL DEFAULT '{"phase":"queued","current":0,"total":null,"messageKey":"run.queued"}'::jsonb
    CHECK (jsonb_typeof(progress) = 'object'),
  last_error_code text,
  last_error_summary text,
  result_type text CHECK (result_type IS NULL OR result_type IN ('collection_run','diagnostic_run','artifact','export')),
  result_id uuid,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  initiated_by uuid NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((result_type IS NULL) = (result_id IS NULL)),
  CHECK ((status IN ('completed','partial','failed','cancelled')) = (completed_at IS NOT NULL)),
  CHECK (status <> 'running' OR started_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS async_runs_one_active_key_idx
  ON app.async_runs(project_id, active_key)
  WHERE active_key IS NOT NULL AND status IN ('queued','running');

CREATE INDEX IF NOT EXISTS async_runs_project_status_idx
  ON app.async_runs(project_id, status, queued_at DESC);

CREATE TABLE IF NOT EXISTS app.collection_runs (
  id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  source_connection_id uuid REFERENCES app.source_connections(id) ON DELETE RESTRICT,
  import_preview_id uuid REFERENCES app.import_previews(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('crawl','gsc','ga4','csv','dataforseo')),
  operation text NOT NULL CHECK (operation IN ('site_graph','search_analytics','organic_landing','keyword_gap_import')),
  method_version text NOT NULL CHECK (length(btrim(method_version)) >= 1),
  parameters_hash text NOT NULL CHECK (parameters_hash ~ '^[a-f0-9]{64}$'),
  source_window jsonb NOT NULL DEFAULT '{"start":null,"end":null}'::jsonb CHECK (jsonb_typeof(source_window) = 'object'),
  provider_usage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_usage) = 'object'),
  row_count integer CHECK (row_count IS NULL OR row_count >= 0),
  stop_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((provider = 'csv') = (import_preview_id IS NOT NULL) OR provider <> 'csv')
);

CREATE TABLE IF NOT EXISTS app.data_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  collection_run_id uuid NOT NULL REFERENCES app.collection_runs(id) ON DELETE RESTRICT,
  source_connection_id uuid REFERENCES app.source_connections(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('crawl','gsc','ga4','csv','dataforseo')),
  dataset_key text NOT NULL CHECK (dataset_key IN ('crawl.site_graph.v1','gsc.page_query_daily.v1','ga4.organic_landing_daily.v1','csv.keyword_gap.v1')),
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) >= 1),
  method_version text NOT NULL CHECK (length(btrim(method_version)) >= 1),
  captured_at timestamptz NOT NULL,
  source_window jsonb NOT NULL CHECK (jsonb_typeof(source_window) = 'object'),
  availability text NOT NULL CHECK (availability IN ('available','partial','unavailable')),
  limitation text NOT NULL CHECK (length(btrim(limitation)) >= 1),
  raw_object_key text,
  row_count integer NOT NULL CHECK (row_count >= 0),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_run_id, dataset_key)
);

CREATE INDEX IF NOT EXISTS data_snapshots_project_provider_idx
  ON app.data_snapshots(project_id, provider, captured_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.normalized_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('crawl','gsc','ga4','csv','dataforseo')),
  metric_key text NOT NULL CHECK (length(btrim(metric_key)) >= 1),
  subject_type text NOT NULL CHECK (subject_type IN ('site','url','query','keyword_cluster','user_agent','page_set')),
  subject_ref text NOT NULL CHECK (length(btrim(subject_ref)) >= 1),
  observed_at timestamptz NOT NULL,
  availability text NOT NULL CHECK (availability IN ('available','partial','unavailable')),
  value_numeric numeric,
  value_text text,
  value_json jsonb,
  unit text,
  origin text NOT NULL CHECK (origin IN ('first_party','direct_public','vendor_observation','user_provided')),
  method text NOT NULL DEFAULT 'observed' CHECK (method = 'observed'),
  grade text NOT NULL CHECK (grade IN ('A','B','C')),
  support text NOT NULL DEFAULT 'context' CHECK (support IN ('supports','contradicts','context')),
  limitation text NOT NULL CHECK (length(btrim(limitation)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (availability = 'available' AND
      ((CASE WHEN value_numeric IS NULL THEN 0 ELSE 1 END) +
       (CASE WHEN value_text IS NULL THEN 0 ELSE 1 END) +
       (CASE WHEN value_json IS NULL THEN 0 ELSE 1 END)) = 1)
    OR
    (availability <> 'available' AND value_numeric IS NULL AND value_text IS NULL AND value_json IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS normalized_observations_lookup_idx
  ON app.normalized_observations(project_id, metric_key, subject_type, subject_ref);
CREATE INDEX IF NOT EXISTS normalized_observations_snapshot_idx
  ON app.normalized_observations(snapshot_id, id);

CREATE TABLE IF NOT EXISTS app.provider_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  metric_key text NOT NULL,
  subject_type text NOT NULL,
  subject_ref text NOT NULL,
  left_observation_id uuid NOT NULL REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  right_observation_id uuid NOT NULL REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  resolution text NOT NULL DEFAULT 'unresolved' CHECK (resolution IN ('unresolved','accepted_left','accepted_right','context_only')),
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (left_observation_id <> right_observation_id),
  CHECK ((resolution = 'unresolved') = (resolved_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_discrepancies_pair_idx
  ON app.provider_discrepancies(project_id, left_observation_id, right_observation_id);

CREATE TABLE IF NOT EXISTS app.diagnostic_runs (
  id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  icp_profile_id uuid NOT NULL REFERENCES app.icp_profiles(id) ON DELETE RESTRICT,
  icp_profile_version integer NOT NULL CHECK (icp_profile_version >= 1),
  rule_set_version text NOT NULL CHECK (rule_set_version = 'mvp.rules.0.2.0'),
  prompt_set_version text NOT NULL CHECK (prompt_set_version = 'mvp.prompts.0.2.0'),
  output_locale text NOT NULL CHECK (output_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  input_manifest jsonb NOT NULL CHECK (jsonb_typeof(input_manifest) = 'object'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  coverage jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coverage) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.diagnostic_run_rules (
  diagnostic_run_id uuid NOT NULL REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  rule_id text NOT NULL CHECK (rule_id ~ '^(TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3}$'),
  rule_version integer NOT NULL CHECK (rule_version >= 1),
  domain text NOT NULL CHECK (domain IN ('technical_seo','search_performance','content_intent','conversion_journey','geo_ai')),
  status text NOT NULL CHECK (status IN ('pass','candidate','skipped','inconclusive')),
  reason text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diagnostic_run_id, rule_id, rule_version)
);

CREATE TABLE IF NOT EXISTS app.analysis_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  async_run_id uuid REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  diagnostic_run_id uuid REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  task text NOT NULL CHECK (task IN ('finding_summary','artifact_generation')),
  provider text NOT NULL CHECK (provider IN ('openai','google')),
  model text NOT NULL CHECK (length(btrim(model)) >= 1),
  prompt_set_version text NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  output_hash text CHECK (output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('succeeded','failed','rejected')),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_usd numeric(12,6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analysis_invocations_project_idx
  ON app.analysis_invocations(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  diagnostic_run_id uuid NOT NULL REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  snapshot_id uuid REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  collection_run_id uuid REFERENCES app.collection_runs(id) ON DELETE RESTRICT,
  analysis_invocation_id uuid REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  source_provider text NOT NULL CHECK (source_provider IN ('crawl','gsc','ga4','csv','dataforseo','system','llm')),
  origin text NOT NULL CHECK (origin IN ('first_party','direct_public','vendor_observation','user_provided','derived','generated')),
  method text NOT NULL CHECK (method IN ('observed','computed','inferred','generated')),
  grade text NOT NULL CHECK (grade IN ('A','B','C')),
  availability text NOT NULL CHECK (availability IN ('available','partial','unavailable')),
  support text NOT NULL CHECK (support IN ('supports','contradicts','context')),
  subject_refs jsonb NOT NULL CHECK (jsonb_typeof(subject_refs) = 'array' AND jsonb_array_length(subject_refs) >= 1),
  claim text NOT NULL CHECK (length(btrim(claim)) >= 1),
  observed_at timestamptz NOT NULL,
  limitation text NOT NULL CHECK (length(btrim(limitation)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (origin <> 'generated' OR (analysis_invocation_id IS NOT NULL AND method = 'generated')),
  CHECK (method <> 'generated' OR origin = 'generated'),
  CHECK (origin <> 'first_party' OR source_provider IN ('gsc','ga4')),
  CHECK (origin <> 'direct_public' OR source_provider = 'crawl'),
  CHECK (origin <> 'user_provided' OR source_provider = 'csv')
);

CREATE INDEX IF NOT EXISTS evidence_run_idx
  ON app.evidence(diagnostic_run_id, id);

CREATE TABLE IF NOT EXISTS app.findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  finding_key text NOT NULL CHECK (finding_key ~ '^[a-f0-9]{64}$'),
  rule_id text NOT NULL CHECK (rule_id ~ '^(TECH|SEARCH|CONTENT|CRO|GEO)-[A-Z]+-[0-9]{3}$'),
  rule_version integer NOT NULL CHECK (rule_version >= 1),
  rule_family text NOT NULL,
  intent text NOT NULL,
  domain text NOT NULL CHECK (domain IN ('technical_seo','search_performance','content_intent','conversion_journey','geo_ai')),
  title_key text NOT NULL,
  title_args jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(title_args) = 'object'),
  summary text NOT NULL CHECK (length(btrim(summary)) >= 1),
  summary_locale text NOT NULL CHECK (summary_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  summary_invocation_id uuid REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  subject_refs jsonb NOT NULL CHECK (jsonb_typeof(subject_refs) = 'array' AND jsonb_array_length(subject_refs) >= 1),
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  confidence text NOT NULL CHECK (confidence IN ('high','medium','low','inconclusive')),
  review_state text NOT NULL DEFAULT 'unreviewed'
    CHECK (review_state IN ('unreviewed','confirmed','ignored','needs_more_data')),
  review_revision integer NOT NULL DEFAULT 0 CHECK (review_revision >= 0),
  review_reason text,
  review_note text,
  active boolean NOT NULL DEFAULT true,
  regressed boolean NOT NULL DEFAULT false,
  first_seen_run_id uuid NOT NULL REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  last_seen_run_id uuid NOT NULL REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, finding_key),
  CHECK (review_state <> 'ignored' OR length(btrim(review_reason)) >= 3),
  CHECK (review_state <> 'needs_more_data' OR length(btrim(review_note)) >= 3),
  CHECK (active OR resolved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS findings_project_filter_idx
  ON app.findings(project_id, active, review_state, domain, last_seen_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.finding_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  finding_id uuid NOT NULL REFERENCES app.findings(id) ON DELETE RESTRICT,
  diagnostic_run_id uuid NOT NULL REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  evidence_id uuid NOT NULL REFERENCES app.evidence(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('primary','supporting','contradicting','context')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, diagnostic_run_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS finding_observations_finding_run_idx
  ON app.finding_observations(finding_id, diagnostic_run_id);

CREATE TABLE IF NOT EXISTS app.finding_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  finding_id uuid NOT NULL REFERENCES app.findings(id) ON DELETE RESTRICT,
  from_state text NOT NULL CHECK (from_state IN ('unreviewed','confirmed','ignored','needs_more_data')),
  to_state text NOT NULL CHECK (to_state IN ('confirmed','ignored','needs_more_data')),
  revision integer NOT NULL CHECK (revision >= 1),
  reason text,
  note text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, revision),
  CHECK (to_state <> 'ignored' OR length(btrim(reason)) >= 3),
  CHECK (to_state <> 'needs_more_data' OR length(btrim(note)) >= 3)
);

CREATE TABLE IF NOT EXISTS app.actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  source_finding_id uuid NOT NULL REFERENCES app.findings(id) ON DELETE RESTRICT,
  action_key text NOT NULL CHECK (action_key ~ '^[a-f0-9]{64}$'),
  template_id text NOT NULL,
  template_version integer NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  title text NOT NULL CHECK (length(btrim(title)) >= 1),
  description text NOT NULL CHECK (length(btrim(description)) >= 1),
  content_locale text NOT NULL CHECK (content_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  priority_band text NOT NULL CHECK (priority_band IN ('critical','high','medium','low')),
  roadmap_lane text NOT NULL CHECK (roadmap_lane IN ('now','next','later')),
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','planned','in_progress','blocked','done','dismissed')),
  effort text NOT NULL CHECK (effort IN ('small','medium','large')),
  risk text NOT NULL CHECK (risk IN ('low','medium','high')),
  expected_outcome text NOT NULL CHECK (length(btrim(expected_outcome)) >= 1),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs) = 'array'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, action_key),
  UNIQUE (source_finding_id, template_id)
);

CREATE INDEX IF NOT EXISTS actions_plan_idx
  ON app.actions(project_id, roadmap_lane, priority_band, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.action_override_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  from_revision integer NOT NULL CHECK (from_revision >= 1),
  to_revision integer NOT NULL CHECK (to_revision = from_revision + 1),
  old_values jsonb NOT NULL CHECK (jsonb_typeof(old_values) = 'object'),
  new_values jsonb NOT NULL CHECK (jsonb_typeof(new_values) = 'object'),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  note text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id, to_revision)
);

CREATE TABLE IF NOT EXISTS app.execution_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  artifact_type text NOT NULL CHECK (artifact_type IN ('content_brief','metadata_rewrite','technical_ticket')),
  status text NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating','draft','ready','failed','archived')),
  generation_mode text NOT NULL CHECK (generation_mode IN ('template','structured_llm')),
  output_locale text NOT NULL CHECK (output_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  current_revision integer NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  validation_state text NOT NULL DEFAULT 'pending' CHECK (validation_state IN ('pending','valid','invalid')),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  latest_generation_run_id uuid REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('generating','failed') OR current_revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS execution_artifacts_one_active_type_idx
  ON app.execution_artifacts(action_id, artifact_type)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS execution_artifacts_project_idx
  ON app.execution_artifacts(project_id, status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.artifact_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision >= 1),
  output_locale text NOT NULL CHECK (output_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  content_format text NOT NULL CHECK (content_format IN ('markdown','json','csv')),
  content_text text,
  content_json jsonb,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  generated_by text NOT NULL CHECK (generated_by IN ('template','llm','operator')),
  editor_id uuid,
  analysis_invocation_id uuid REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  note text,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_errors) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, revision),
  CHECK (
    (content_format = 'json' AND content_json IS NOT NULL AND content_text IS NULL)
    OR
    (content_format IN ('markdown','csv') AND content_text IS NOT NULL AND content_json IS NULL)
  ),
  CHECK ((generated_by = 'llm') = (analysis_invocation_id IS NOT NULL) OR generated_by <> 'llm')
);

CREATE TABLE IF NOT EXISTS app.export_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  async_run_id uuid NOT NULL UNIQUE REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('service_bundle','client_bundle')),
  schema_version text NOT NULL DEFAULT 'signalframe.service-bundle.0.2.0'
    CHECK (schema_version = 'signalframe.service-bundle.0.2.0'),
  output_locale text NOT NULL CHECK (output_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  object_key text,
  checksum text CHECK (checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$'),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  item_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(item_counts) = 'object'),
  manifest jsonb CHECK (manifest IS NULL OR jsonb_typeof(manifest) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_bundles_object_key_invariant CHECK (
    (
      object_key IS NULL
      AND checksum IS NULL
      AND byte_size IS NULL
      AND manifest IS NULL
    )
    OR
    (
      object_key IS NOT NULL
      AND checksum IS NOT NULL
      AND byte_size IS NOT NULL
      AND manifest IS NOT NULL
      AND octet_length(object_key) <= 1024
      AND cardinality(string_to_array(object_key, '/')) = 4
      AND object_key =
        'export/' || project_id::text || '/' || async_run_id::text || '/' ||
        split_part(object_key, '/', 4)
      AND split_part(object_key, '/', 4) ~ '^[A-Za-z0-9._-]+$'
      AND split_part(object_key, '/', 4) NOT IN ('.', '..')
    )
  )
);

CREATE INDEX IF NOT EXISTS export_bundles_project_idx
  ON app.export_bundles(project_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (length(btrim(scope)) >= 1),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed')),
  response_status integer CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  response_body jsonb,
  resource_type text,
  resource_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scope, idempotency_key),
  CHECK ((resource_type IS NULL) = (resource_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idempotency_keys_expiry_idx
  ON app.idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS app.telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  event_name text NOT NULL CHECK (event_name IN ('project_created','source_snapshot_ready','diagnostic_completed','action_confirmed','export_ready')),
  actor_id uuid,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(properties) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telemetry_events_name_created_idx
  ON app.telemetry_events(event_name, created_at DESC);

-- Deferred circular references are added after both sides exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_projects_current_icp_profile_fk'
      AND conrelid = 'app.client_projects'::regclass
  ) THEN
    ALTER TABLE app.client_projects
      ADD CONSTRAINT client_projects_current_icp_profile_fk
      FOREIGN KEY (current_icp_profile_id) REFERENCES app.icp_profiles(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'source_connections_last_snapshot_fk'
      AND conrelid = 'app.source_connections'::regclass
  ) THEN
    ALTER TABLE app.source_connections
      ADD CONSTRAINT source_connections_last_snapshot_fk
      FOREIGN KEY (last_successful_snapshot_id) REFERENCES app.data_snapshots(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

-- Mutable projections receive server timestamps.
DROP TRIGGER IF EXISTS workspaces_set_updated_at ON app.workspaces;
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON app.workspaces
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS operator_profiles_set_updated_at ON app.operator_profiles;
CREATE TRIGGER operator_profiles_set_updated_at BEFORE UPDATE ON app.operator_profiles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS client_projects_set_updated_at ON app.client_projects;
CREATE TRIGGER client_projects_set_updated_at BEFORE UPDATE ON app.client_projects
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS sites_set_updated_at ON app.sites;
CREATE TRIGGER sites_set_updated_at BEFORE UPDATE ON app.sites
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS source_connections_set_updated_at ON app.source_connections;
CREATE TRIGGER source_connections_set_updated_at BEFORE UPDATE ON app.source_connections
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS source_credentials_set_updated_at ON app.source_credentials;
CREATE TRIGGER source_credentials_set_updated_at BEFORE UPDATE ON app.source_credentials
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS oauth_intents_set_updated_at ON app.oauth_intents;
CREATE TRIGGER oauth_intents_set_updated_at BEFORE UPDATE ON app.oauth_intents
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS import_previews_set_updated_at ON app.import_previews;
CREATE TRIGGER import_previews_set_updated_at BEFORE UPDATE ON app.import_previews
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS async_runs_set_updated_at ON app.async_runs;
CREATE TRIGGER async_runs_set_updated_at BEFORE UPDATE ON app.async_runs
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS provider_discrepancies_set_updated_at ON app.provider_discrepancies;
CREATE TRIGGER provider_discrepancies_set_updated_at BEFORE UPDATE ON app.provider_discrepancies
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS findings_set_updated_at ON app.findings;
CREATE TRIGGER findings_set_updated_at BEFORE UPDATE ON app.findings
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS actions_set_updated_at ON app.actions;
CREATE TRIGGER actions_set_updated_at BEFORE UPDATE ON app.actions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS execution_artifacts_set_updated_at ON app.execution_artifacts;
CREATE TRIGGER execution_artifacts_set_updated_at BEFORE UPDATE ON app.execution_artifacts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS execution_artifacts_status_transition_guard ON app.execution_artifacts;
CREATE TRIGGER execution_artifacts_status_transition_guard
  BEFORE UPDATE OF status ON app.execution_artifacts
  FOR EACH ROW EXECUTE FUNCTION app.enforce_artifact_status_transition();
DROP TRIGGER IF EXISTS export_bundles_invariant_guard ON app.export_bundles;
CREATE TRIGGER export_bundles_invariant_guard
  BEFORE INSERT OR UPDATE ON app.export_bundles
  FOR EACH ROW EXECUTE FUNCTION app.enforce_export_bundle_invariants();
DROP TRIGGER IF EXISTS idempotency_keys_set_updated_at ON app.idempotency_keys;
CREATE TRIGGER idempotency_keys_set_updated_at BEFORE UPDATE ON app.idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Canonical historical records are append-only. Jobs insert them only when complete.
DROP TRIGGER IF EXISTS icp_profiles_append_only ON app.icp_profiles;
CREATE TRIGGER icp_profiles_append_only BEFORE UPDATE OR DELETE ON app.icp_profiles
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS data_snapshots_append_only ON app.data_snapshots;
CREATE TRIGGER data_snapshots_append_only BEFORE UPDATE OR DELETE ON app.data_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS normalized_observations_append_only ON app.normalized_observations;
CREATE TRIGGER normalized_observations_append_only BEFORE UPDATE OR DELETE ON app.normalized_observations
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS diagnostic_run_rules_append_only ON app.diagnostic_run_rules;
CREATE TRIGGER diagnostic_run_rules_append_only BEFORE UPDATE OR DELETE ON app.diagnostic_run_rules
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS analysis_invocations_append_only ON app.analysis_invocations;
CREATE TRIGGER analysis_invocations_append_only BEFORE UPDATE OR DELETE ON app.analysis_invocations
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS evidence_append_only ON app.evidence;
CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON app.evidence
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS finding_observations_append_only ON app.finding_observations;
CREATE TRIGGER finding_observations_append_only BEFORE UPDATE OR DELETE ON app.finding_observations
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS finding_review_events_append_only ON app.finding_review_events;
CREATE TRIGGER finding_review_events_append_only BEFORE UPDATE OR DELETE ON app.finding_review_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS action_override_audit_append_only ON app.action_override_audit;
CREATE TRIGGER action_override_audit_append_only BEFORE UPDATE OR DELETE ON app.action_override_audit
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS artifact_revisions_append_only ON app.artifact_revisions;
CREATE TRIGGER artifact_revisions_append_only BEFORE UPDATE OR DELETE ON app.artifact_revisions
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();
DROP TRIGGER IF EXISTS telemetry_events_append_only ON app.telemetry_events;
CREATE TRIGGER telemetry_events_append_only BEFORE UPDATE OR DELETE ON app.telemetry_events
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- Runtime-safe migration identity for technical health signals (spec §15.2).
-- A view keeps the frozen 28-table application inventory unchanged.
CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0001_init'::text AS migration_version;

-- The browser must not access canonical tables directly through the Supabase Data API.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA app FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated';
  END IF;
END;
$$;

COMMIT;
-- END EXACT ORDERED MIGRATION 0001_init.sql

-- BEGIN EXACT ORDERED MIGRATION 0002_async_run_terminal_invariant.sql
BEGIN;

-- AsyncRun terminal states are irreversible (spec §5.2). Repository attempt
-- fencing is the primary guard; this trigger is the final invariant for direct
-- SQL and any future writer that bypasses the repository CAS.
CREATE OR REPLACE FUNCTION app.reject_async_run_terminal_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'partial', 'failed', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'async run terminal status is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS async_runs_terminal_status_immutable ON app.async_runs;
CREATE TRIGGER async_runs_terminal_status_immutable
  BEFORE UPDATE OF status ON app.async_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_async_run_terminal_transition();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0002_async_run_terminal_invariant'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0002_async_run_terminal_invariant.sql

-- BEGIN EXACT ORDERED MIGRATION 0003_artifact_status_transition.sql
BEGIN;

-- Artifact state-machine backstop for databases that already applied 0001.
CREATE OR REPLACE FUNCTION app.enforce_artifact_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'draft'
     AND NEW.current_revision = OLD.current_revision + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready' AND NEW.status = 'draft'
     AND NEW.current_revision = OLD.current_revision + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'failed'
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status IN ('ready', 'archived')
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready' AND NEW.status = 'archived'
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('draft', 'ready', 'failed') AND NEW.status = 'generating'
     AND NEW.current_revision = OLD.current_revision
     AND NEW.latest_generation_run_id IS NOT NULL
     AND NEW.latest_generation_run_id IS DISTINCT FROM OLD.latest_generation_run_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'artifact status transition is not allowed'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS execution_artifacts_status_transition_guard
  ON app.execution_artifacts;
CREATE TRIGGER execution_artifacts_status_transition_guard
  BEFORE UPDATE OF status ON app.execution_artifacts
  FOR EACH ROW EXECUTE FUNCTION app.enforce_artifact_status_transition();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0003_artifact_status_transition'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0003_artifact_status_transition.sql

-- BEGIN EXACT ORDERED MIGRATION 0004_artifact_revision_output_locale.sql
BEGIN;

-- Revision locale is immutable provenance. Existing deployments previously
-- stored it only on the mutable artifact head, so backfill the best available
-- value before making the revision-level field mandatory.
ALTER TABLE app.artifact_revisions
  ADD COLUMN IF NOT EXISTS output_locale text;

-- The append-only guard must be removed only for this transactional backfill;
-- the DDL lock and transaction keep application writers from observing a gap.
DROP TRIGGER IF EXISTS artifact_revisions_append_only
  ON app.artifact_revisions;

UPDATE app.artifact_revisions AS revision
SET output_locale = artifact.output_locale
FROM app.execution_artifacts AS artifact
WHERE revision.artifact_id = artifact.id
  AND revision.output_locale IS NULL;

ALTER TABLE app.artifact_revisions
  ALTER COLUMN output_locale SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'app.artifact_revisions'::regclass
      AND conname = 'artifact_revisions_output_locale_check'
  ) THEN
    ALTER TABLE app.artifact_revisions
      ADD CONSTRAINT artifact_revisions_output_locale_check
      CHECK (output_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
  END IF;
END;
$$;

CREATE TRIGGER artifact_revisions_append_only
  BEFORE UPDATE OR DELETE ON app.artifact_revisions
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0004_artifact_revision_output_locale'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0004_artifact_revision_output_locale.sql

-- BEGIN EXACT ORDERED MIGRATION 0005_artifact_transition_invariants.sql
BEGIN;

-- Upgrade databases that already installed the original status-only guard.
-- Content-producing edges advance exactly one revision, status-only edges keep
-- the pointer fixed, and regeneration is always owned by a fresh AsyncRun.
CREATE OR REPLACE FUNCTION app.enforce_artifact_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'draft'
     AND NEW.current_revision = OLD.current_revision + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready' AND NEW.status = 'draft'
     AND NEW.current_revision = OLD.current_revision + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'failed'
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status IN ('ready', 'archived')
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready' AND NEW.status = 'archived'
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('draft', 'ready', 'failed') AND NEW.status = 'generating'
     AND NEW.current_revision = OLD.current_revision
     AND NEW.latest_generation_run_id IS NOT NULL
     AND NEW.latest_generation_run_id IS DISTINCT FROM OLD.latest_generation_run_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'artifact status transition is not allowed'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS execution_artifacts_status_transition_guard
  ON app.execution_artifacts;
CREATE TRIGGER execution_artifacts_status_transition_guard
  BEFORE UPDATE OF status ON app.execution_artifacts
  FOR EACH ROW EXECUTE FUNCTION app.enforce_artifact_status_transition();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0005_artifact_transition_invariants'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0005_artifact_transition_invariants.sql

-- BEGIN EXACT ORDERED MIGRATION 0006_observability_metrics.sql
BEGIN;

-- Existing databases receive the same queryable migration identity as fresh
-- installs. This is a view rather than a bookkeeping table so the frozen
-- 28-table product contract remains exact.
CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0006_observability_metrics'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0006_observability_metrics.sql

-- BEGIN EXACT ORDERED MIGRATION 0007_export_bundle_invariants.sql
BEGIN;

-- Bind each ExportBundle to the exact export AsyncRun/project named by its
-- object key. Only one placeholder -> finalized transition is legal; after the
-- key is committed, all bundle identity and object metadata are immutable.
CREATE OR REPLACE FUNCTION app.enforce_export_bundle_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_matches boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.async_run_id IS DISTINCT FROM OLD.async_run_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.output_locale IS DISTINCT FROM OLD.output_locale
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'export bundle identity is immutable'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.object_key IS NOT NULL OR NEW.object_key IS NULL THEN
      RAISE EXCEPTION 'export bundle may be finalized exactly once'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM app.async_runs AS run
    WHERE run.id = NEW.async_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'export'
  ) INTO run_matches;

  IF NOT run_matches THEN
    RAISE EXCEPTION 'export bundle run scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.export_bundles'::regclass
      AND conname = 'export_bundles_object_key_invariant'
  ) THEN
    ALTER TABLE app.export_bundles
      ADD CONSTRAINT export_bundles_object_key_invariant CHECK (
        (
          object_key IS NULL
          AND checksum IS NULL
          AND byte_size IS NULL
          AND manifest IS NULL
        )
        OR
        (
          object_key IS NOT NULL
          AND checksum IS NOT NULL
          AND byte_size IS NOT NULL
          AND manifest IS NOT NULL
          AND octet_length(object_key) <= 1024
          AND cardinality(string_to_array(object_key, '/')) = 4
          AND object_key =
            'export/' || project_id::text || '/' || async_run_id::text || '/' ||
            split_part(object_key, '/', 4)
          AND split_part(object_key, '/', 4) ~ '^[A-Za-z0-9._-]+$'
          AND split_part(object_key, '/', 4) NOT IN ('.', '..')
        )
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE app.export_bundles
  VALIDATE CONSTRAINT export_bundles_object_key_invariant;

-- Validate the cross-table identity for pre-existing rows before installing
-- the prospective trigger. A mismatch aborts the migration rather than making
-- corrupted bundles downloadable under a new release.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.export_bundles AS bundle
    LEFT JOIN app.async_runs AS run
      ON run.id = bundle.async_run_id
     AND run.workspace_id = bundle.workspace_id
     AND run.project_id = bundle.project_id
     AND run.kind = 'export'
    WHERE run.id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing export bundle run scope is invalid'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS export_bundles_invariant_guard
  ON app.export_bundles;
CREATE TRIGGER export_bundles_invariant_guard
  BEFORE INSERT OR UPDATE ON app.export_bundles
  FOR EACH ROW EXECUTE FUNCTION app.enforce_export_bundle_invariants();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0007_export_bundle_invariants'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0007_export_bundle_invariants.sql

-- BEGIN EXACT ORDERED MIGRATION 0008_bcp47_locale_grammar.sql
BEGIN;

-- RFC 5646 language-tag validation shared by every canonical locale column.
-- This deliberately validates the structural grammar without a live IANA
-- registry dependency: registry availability must never become a write-path
-- dependency, while grandfathered tags remain valid permanently.
CREATE OR REPLACE FUNCTION app.is_bcp47_language_tag(candidate text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  parts text[];
  part_count integer;
  part_index integer := 1;
  extlang_count integer := 0;
  first_child_index integer;
  normalized text;
  seen_variants text[] := ARRAY[]::text[];
  seen_singletons text[] := ARRAY[]::text[];
BEGIN
  IF candidate IS NULL
     OR char_length(candidate) NOT BETWEEN 2 AND 255
     OR candidate !~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$' THEN
    RETURN false;
  END IF;

  normalized := lower(candidate);
  IF normalized = ANY (ARRAY[
    'art-lojban', 'cel-gaulish', 'en-gb-oed', 'i-ami', 'i-bnn',
    'i-default', 'i-enochian', 'i-hak', 'i-klingon', 'i-lux',
    'i-mingo', 'i-navajo', 'i-pwn', 'i-tao', 'i-tay', 'i-tsu',
    'no-bok', 'no-nyn', 'sgn-be-fr', 'sgn-be-nl', 'sgn-ch-de',
    'zh-guoyu', 'zh-hakka', 'zh-min', 'zh-min-nan', 'zh-xiang'
  ]::text[]) THEN
    RETURN true;
  END IF;

  parts := string_to_array(candidate, '-');
  part_count := cardinality(parts);

  -- A private-use-only tag starts with x and requires at least one 1-8
  -- character alphanumeric subtag.
  IF lower(parts[1]) = 'x' THEN
    IF part_count < 2 THEN
      RETURN false;
    END IF;
    FOR part_index IN 2..part_count LOOP
      IF char_length(parts[part_index]) NOT BETWEEN 1 AND 8
         OR parts[part_index] !~ '^[A-Za-z0-9]+$' THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  -- language = 2*3ALPHA [extlang] / 4ALPHA / 5*8ALPHA
  IF char_length(parts[1]) NOT BETWEEN 2 AND 8
     OR parts[1] !~ '^[A-Za-z]+$' THEN
    RETURN false;
  END IF;
  part_index := 2;

  IF char_length(parts[1]) <= 3 THEN
    WHILE part_index <= part_count
      AND extlang_count < 3
      AND char_length(parts[part_index]) = 3
      AND parts[part_index] ~ '^[A-Za-z]+$'
    LOOP
      part_index := part_index + 1;
      extlang_count := extlang_count + 1;
    END LOOP;
  END IF;

  -- Optional script and region, in that order.
  IF part_index <= part_count
     AND char_length(parts[part_index]) = 4
     AND parts[part_index] ~ '^[A-Za-z]+$' THEN
    part_index := part_index + 1;
  END IF;
  IF part_index <= part_count
     AND (
       parts[part_index] ~ '^[A-Za-z]{2}$'
       OR parts[part_index] ~ '^[0-9]{3}$'
     ) THEN
    part_index := part_index + 1;
  END IF;

  -- Variants precede extensions and cannot repeat case-insensitively.
  WHILE part_index <= part_count
    AND parts[part_index] ~ '^([A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})$'
  LOOP
    normalized := lower(parts[part_index]);
    IF normalized = ANY (seen_variants) THEN
      RETURN false;
    END IF;
    seen_variants := array_append(seen_variants, normalized);
    part_index := part_index + 1;
  END LOOP;

  -- Each non-x singleton introduces one or more 2-8 character extension
  -- subtags, and the singleton cannot repeat case-insensitively.
  WHILE part_index <= part_count
    AND parts[part_index] ~ '^[0-9A-WY-Za-wy-z]$'
  LOOP
    normalized := lower(parts[part_index]);
    IF normalized = ANY (seen_singletons) THEN
      RETURN false;
    END IF;
    seen_singletons := array_append(seen_singletons, normalized);
    part_index := part_index + 1;
    first_child_index := part_index;

    WHILE part_index <= part_count
      AND char_length(parts[part_index]) BETWEEN 2 AND 8
      AND parts[part_index] ~ '^[A-Za-z0-9]+$'
    LOOP
      part_index := part_index + 1;
    END LOOP;
    IF part_index = first_child_index THEN
      RETURN false;
    END IF;
  END LOOP;

  -- Optional trailing private-use sequence.
  IF part_index <= part_count AND lower(parts[part_index]) = 'x' THEN
    part_index := part_index + 1;
    first_child_index := part_index;
    WHILE part_index <= part_count
      AND char_length(parts[part_index]) BETWEEN 1 AND 8
      AND parts[part_index] ~ '^[A-Za-z0-9]+$'
    LOOP
      part_index := part_index + 1;
    END LOOP;
    IF part_index = first_child_index THEN
      RETURN false;
    END IF;
  END IF;

  RETURN part_index > part_count;
END;
$$;

CREATE OR REPLACE FUNCTION app.are_bcp47_language_tags(candidates text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  candidate text;
BEGIN
  IF candidates IS NULL THEN
    RETURN false;
  END IF;
  FOREACH candidate IN ARRAY candidates LOOP
    IF NOT app.is_bcp47_language_tag(candidate) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE app.client_projects
  DROP CONSTRAINT IF EXISTS client_projects_default_delivery_locale_check;
ALTER TABLE app.client_projects
  ADD CONSTRAINT client_projects_default_delivery_locale_check
  CHECK (app.is_bcp47_language_tag(default_delivery_locale)) NOT VALID;

ALTER TABLE app.sites
  DROP CONSTRAINT IF EXISTS sites_language_codes_bcp47_check;
ALTER TABLE app.sites
  ADD CONSTRAINT sites_language_codes_bcp47_check
  CHECK (app.are_bcp47_language_tags(language_codes)) NOT VALID;

ALTER TABLE app.diagnostic_runs
  DROP CONSTRAINT IF EXISTS diagnostic_runs_output_locale_check;
ALTER TABLE app.diagnostic_runs
  ADD CONSTRAINT diagnostic_runs_output_locale_check
  CHECK (app.is_bcp47_language_tag(output_locale)) NOT VALID;

ALTER TABLE app.findings
  DROP CONSTRAINT IF EXISTS findings_summary_locale_check;
ALTER TABLE app.findings
  ADD CONSTRAINT findings_summary_locale_check
  CHECK (app.is_bcp47_language_tag(summary_locale)) NOT VALID;

ALTER TABLE app.actions
  DROP CONSTRAINT IF EXISTS actions_content_locale_check;
ALTER TABLE app.actions
  ADD CONSTRAINT actions_content_locale_check
  CHECK (app.is_bcp47_language_tag(content_locale)) NOT VALID;

ALTER TABLE app.execution_artifacts
  DROP CONSTRAINT IF EXISTS execution_artifacts_output_locale_check;
ALTER TABLE app.execution_artifacts
  ADD CONSTRAINT execution_artifacts_output_locale_check
  CHECK (app.is_bcp47_language_tag(output_locale)) NOT VALID;

ALTER TABLE app.artifact_revisions
  DROP CONSTRAINT IF EXISTS artifact_revisions_output_locale_check;
ALTER TABLE app.artifact_revisions
  ADD CONSTRAINT artifact_revisions_output_locale_check
  CHECK (app.is_bcp47_language_tag(output_locale)) NOT VALID;

ALTER TABLE app.export_bundles
  DROP CONSTRAINT IF EXISTS export_bundles_output_locale_check;
ALTER TABLE app.export_bundles
  ADD CONSTRAINT export_bundles_output_locale_check
  CHECK (app.is_bcp47_language_tag(output_locale)) NOT VALID;

ALTER TABLE app.client_projects
  VALIDATE CONSTRAINT client_projects_default_delivery_locale_check;
ALTER TABLE app.sites
  VALIDATE CONSTRAINT sites_language_codes_bcp47_check;
ALTER TABLE app.diagnostic_runs
  VALIDATE CONSTRAINT diagnostic_runs_output_locale_check;
ALTER TABLE app.findings
  VALIDATE CONSTRAINT findings_summary_locale_check;
ALTER TABLE app.actions
  VALIDATE CONSTRAINT actions_content_locale_check;
ALTER TABLE app.execution_artifacts
  VALIDATE CONSTRAINT execution_artifacts_output_locale_check;
ALTER TABLE app.artifact_revisions
  VALIDATE CONSTRAINT artifact_revisions_output_locale_check;
ALTER TABLE app.export_bundles
  VALIDATE CONSTRAINT export_bundles_output_locale_check;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0008_bcp47_locale_grammar'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0008_bcp47_locale_grammar.sql

-- BEGIN EXACT ORDERED MIGRATION 0009_async_run_contract_version.sql
BEGIN;

-- The product release version and the asynchronous-run HTTP contract version
-- are independent. Keep database-generated rows aligned with the current
-- contract even when a caller omits the column explicitly.
ALTER TABLE app.async_runs
  ALTER COLUMN contract_version SET DEFAULT '2026-07-18';

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0009_async_run_contract_version'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0009_async_run_contract_version.sql

-- BEGIN EXACT ORDERED MIGRATION 0010_growth_audit_slice1.sql
BEGIN;

-- A capability run is a typed extension of the canonical async run ledger. Its
-- primary key is deliberately the async run id: there is no second lifecycle or
-- mutable status for a capability execution.
CREATE TABLE IF NOT EXISTS app.capability_runs (
  async_run_id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  capability_id text NOT NULL CHECK (length(btrim(capability_id)) >= 1),
  capability_version text NOT NULL CHECK (length(btrim(capability_version)) >= 1),
  input_manifest_hash text NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  mode text NOT NULL CHECK (mode IN ('production','shadow','simulation')),
  side_effect_class text NOT NULL
    CHECK (side_effect_class IN ('read_only','internal_write','external_write')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Customer-facing audit state is a projection over the existing canonical
-- diagnostic and capability runs. It intentionally has no status column.
CREATE TABLE IF NOT EXISTS app.audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  diagnostic_run_id uuid NOT NULL UNIQUE
    REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  capability_run_id uuid NOT NULL UNIQUE
    REFERENCES app.capability_runs(async_run_id) ON DELETE RESTRICT,
  scope_kind text NOT NULL CHECK (scope_kind IN ('site','template','url')),
  scope_key text NOT NULL CHECK (length(btrim(scope_key)) >= 1),
  projection_version text NOT NULL CHECK (length(btrim(projection_version)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (diagnostic_run_id = capability_run_id)
);

CREATE INDEX IF NOT EXISTS audit_runs_project_created_idx
  ON app.audit_runs(project_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.audit_module_results (
  audit_run_id uuid NOT NULL REFERENCES app.audit_runs(id) ON DELETE RESTRICT,
  module_id text NOT NULL CHECK (module_id IN (
    'performance',
    'accessibility',
    'best_practices_security',
    'technical_search',
    'content_intent',
    'ai_geo',
    'links_architecture',
    'compliance_measurement'
  )),
  coverage_state text NOT NULL
    CHECK (coverage_state IN ('available','partial','stale','no_data')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_run_id, module_id)
);

-- One durable URL identity per project. Metrics and extracted content do not
-- live here; they remain attributable to immutable page/data snapshots.
CREATE TABLE IF NOT EXISTS app.site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  normalized_url text NOT NULL CHECK (length(btrim(normalized_url)) >= 1),
  normalized_url_hash text NOT NULL CHECK (normalized_url_hash ~ '^[a-f0-9]{64}$'),
  template_key text CHECK (template_key IS NULL OR length(btrim(template_key)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, normalized_url_hash)
);

CREATE INDEX IF NOT EXISTS site_pages_project_updated_idx
  ON app.site_pages(project_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS site_pages_site_idx
  ON app.site_pages(site_id, id);

-- A page snapshot is only a traceable projection of one canonical source
-- snapshot. The extract is immutable; recrawls append a new row.
CREATE TABLE IF NOT EXISTS app.page_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  data_snapshot_id uuid NOT NULL REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  extract jsonb NOT NULL CHECK (jsonb_typeof(extract) = 'object'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_page_id, data_snapshot_id, content_hash)
);

CREATE INDEX IF NOT EXISTS page_snapshots_page_captured_idx
  ON app.page_snapshots(site_page_id, captured_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS page_snapshots_project_captured_idx
  ON app.page_snapshots(project_id, captured_at DESC, id DESC);

-- Duplicated tenant keys are read-model accelerators, never free-form labels.
-- Validate every new projection against its canonical parent lineage so a
-- faulty worker cannot splice records from different projects.
CREATE OR REPLACE FUNCTION app.enforce_audit_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.diagnostic_run_id IS DISTINCT FROM NEW.capability_run_id OR NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic
    JOIN app.async_runs run ON run.id = diagnostic.id
    JOIN app.capability_runs capability
      ON capability.async_run_id = diagnostic.id
    WHERE diagnostic.id = NEW.diagnostic_run_id
      AND diagnostic.workspace_id = NEW.workspace_id
      AND diagnostic.project_id = NEW.project_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'audit run provenance does not match its canonical run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_site_page_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.sites site
    WHERE site.id = NEW.site_id
      AND site.workspace_id = NEW.workspace_id
      AND site.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'site page provenance does not match its canonical site'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_page_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.site_pages page
    JOIN app.data_snapshots snapshot
      ON snapshot.id = NEW.data_snapshot_id
     AND snapshot.site_id = page.site_id
    WHERE page.id = NEW.site_page_id
      AND page.workspace_id = NEW.workspace_id
      AND page.project_id = NEW.project_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'page snapshot provenance does not match its canonical sources'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_runs_provenance_guard ON app.audit_runs;
CREATE TRIGGER audit_runs_provenance_guard BEFORE INSERT ON app.audit_runs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_audit_run_provenance();

DROP TRIGGER IF EXISTS site_pages_provenance_guard ON app.site_pages;
CREATE TRIGGER site_pages_provenance_guard BEFORE INSERT OR UPDATE ON app.site_pages
  FOR EACH ROW EXECUTE FUNCTION app.enforce_site_page_provenance();

DROP TRIGGER IF EXISTS page_snapshots_provenance_guard ON app.page_snapshots;
CREATE TRIGGER page_snapshots_provenance_guard BEFORE INSERT ON app.page_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.enforce_page_snapshot_provenance();

DROP TRIGGER IF EXISTS site_pages_set_updated_at ON app.site_pages;
CREATE TRIGGER site_pages_set_updated_at BEFORE UPDATE ON app.site_pages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

DROP TRIGGER IF EXISTS capability_runs_append_only ON app.capability_runs;
CREATE TRIGGER capability_runs_append_only BEFORE UPDATE OR DELETE ON app.capability_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS audit_runs_append_only ON app.audit_runs;
CREATE TRIGGER audit_runs_append_only BEFORE UPDATE OR DELETE ON app.audit_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS audit_module_results_append_only ON app.audit_module_results;
CREATE TRIGGER audit_module_results_append_only BEFORE UPDATE OR DELETE ON app.audit_module_results
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS page_snapshots_append_only ON app.page_snapshots;
CREATE TRIGGER page_snapshots_append_only BEFORE UPDATE OR DELETE ON app.page_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- Keep the existing server-only table access model. The application enforces
-- tenant scope in repositories; browser roles never receive direct table access.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.capability_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.audit_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.audit_module_results FROM anon';
    EXECUTE 'REVOKE ALL ON app.site_pages FROM anon';
    EXECUTE 'REVOKE ALL ON app.page_snapshots FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.capability_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.audit_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.audit_module_results FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.site_pages FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.page_snapshots FROM authenticated';
  END IF;
END;
$$;

-- Activate the current HTTP/export defaults without invalidating immutable
-- historical v0.2 export rows during an in-place upgrade.
ALTER TABLE app.async_runs
  ALTER COLUMN contract_version SET DEFAULT '2026-07-21';

ALTER TABLE app.export_bundles
  DROP CONSTRAINT IF EXISTS export_bundles_schema_version_check,
  ALTER COLUMN schema_version SET DEFAULT 'signalframe.service-bundle.0.3.0';

ALTER TABLE app.export_bundles
  ADD CONSTRAINT export_bundles_schema_version_check
  CHECK (schema_version IN (
    'signalframe.service-bundle.0.2.0',
    'signalframe.service-bundle.0.3.0'
  ));

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0010_growth_audit_slice1'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0010_growth_audit_slice1.sql

-- BEGIN EXACT ORDERED MIGRATION 0011_product_profile_foundation.sql
BEGIN;

-- The current pointer remains the operator's working draft. Downstream audit
-- inputs need a separate pointer that advances only after profile review.
ALTER TABLE app.client_projects
  ADD COLUMN IF NOT EXISTS confirmed_icp_profile_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_projects_confirmed_icp_profile_fk'
      AND conrelid = 'app.client_projects'::regclass
  ) THEN
    ALTER TABLE app.client_projects
      ADD CONSTRAINT client_projects_confirmed_icp_profile_fk
      FOREIGN KEY (confirmed_icp_profile_id)
      REFERENCES app.icp_profiles(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

-- A URL-first project honestly starts without reviewed market or language
-- knowledge. Empty arrays mean unknown; the upper bound still protects rows
-- from unbounded projection payloads.
ALTER TABLE app.sites
  DROP CONSTRAINT IF EXISTS sites_market_codes_check;
ALTER TABLE app.sites
  ADD CONSTRAINT sites_market_codes_check
  CHECK (cardinality(market_codes) BETWEEN 0 AND 20) NOT VALID;

ALTER TABLE app.sites
  DROP CONSTRAINT IF EXISTS sites_language_codes_check;
ALTER TABLE app.sites
  ADD CONSTRAINT sites_language_codes_check
  CHECK (cardinality(language_codes) BETWEEN 0 AND 20) NOT VALID;

ALTER TABLE app.sites
  VALIDATE CONSTRAINT sites_market_codes_check;
ALTER TABLE app.sites
  VALIDATE CONSTRAINT sites_language_codes_check;

-- Pointer provenance is a database invariant, not an application convention.
-- This prevents a faulty scoped write from splicing another project's immutable
-- profile into either the working or confirmed project state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.client_projects project
    LEFT JOIN app.icp_profiles profile
      ON profile.id = project.current_icp_profile_id
     AND profile.workspace_id = project.workspace_id
     AND profile.project_id = project.id
    WHERE project.current_icp_profile_id IS NOT NULL
      AND profile.id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing current ICP profile provenance does not match client project'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.client_projects project
    LEFT JOIN app.icp_profiles profile
      ON profile.id = project.confirmed_icp_profile_id
     AND profile.workspace_id = project.workspace_id
     AND profile.project_id = project.id
     AND profile.status = 'complete'
    WHERE project.confirmed_icp_profile_id IS NOT NULL
      AND profile.id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing confirmed ICP profile is not complete project provenance'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Preserve legacy readiness: before the confirmed pointer existed, a complete
-- current profile was the reviewed downstream input. Backfill only verified
-- same-project complete rows; drafts remain unconfirmed.
UPDATE app.client_projects project
SET confirmed_icp_profile_id = profile.id
FROM app.icp_profiles profile
WHERE project.confirmed_icp_profile_id IS NULL
  AND project.current_icp_profile_id = profile.id
  AND profile.workspace_id = project.workspace_id
  AND profile.project_id = project.id
  AND profile.status = 'complete';

CREATE OR REPLACE FUNCTION app.enforce_client_project_icp_profile_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_icp_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.icp_profiles profile
    WHERE profile.id = NEW.current_icp_profile_id
      AND profile.workspace_id = NEW.workspace_id
      AND profile.project_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'current ICP profile provenance does not match client project'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.confirmed_icp_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.icp_profiles profile
    WHERE profile.id = NEW.confirmed_icp_profile_id
      AND profile.workspace_id = NEW.workspace_id
      AND profile.project_id = NEW.id
      AND profile.status = 'complete'
  ) THEN
    RAISE EXCEPTION 'confirmed ICP profile must be complete and match client project provenance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_projects_icp_profile_provenance_guard
  ON app.client_projects;
CREATE TRIGGER client_projects_icp_profile_provenance_guard
  BEFORE INSERT OR UPDATE ON app.client_projects
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_client_project_icp_profile_provenance();

-- An Action is attributable to the exact immutable DiagnosticRun that
-- observed its source Finding when the Action was first created. Existing
-- deployments are backfilled only from append-only finding observations that
-- already existed at Action creation time. Mutable Finding projections are
-- deliberately excluded from this derivation.
ALTER TABLE app.actions
  ADD COLUMN IF NOT EXISTS source_diagnostic_run_id uuid;

WITH ranked_action_sources AS (
  SELECT
    action.id AS action_id,
    observation.diagnostic_run_id,
    row_number() OVER (
      PARTITION BY action.id
      ORDER BY
        greatest(observation.created_at, diagnostic_run.created_at) DESC,
        observation.created_at DESC,
        diagnostic_run.created_at DESC,
        observation.id DESC
    ) AS source_rank
  FROM app.actions action
  JOIN app.finding_observations observation
    ON observation.finding_id = action.source_finding_id
   AND observation.workspace_id = action.workspace_id
   AND observation.project_id = action.project_id
  JOIN app.diagnostic_runs diagnostic_run
    ON diagnostic_run.id = observation.diagnostic_run_id
   AND diagnostic_run.workspace_id = action.workspace_id
   AND diagnostic_run.project_id = action.project_id
  JOIN app.evidence source_evidence
    ON source_evidence.id = observation.evidence_id
   AND source_evidence.diagnostic_run_id = observation.diagnostic_run_id
   AND source_evidence.workspace_id = action.workspace_id
   AND source_evidence.project_id = action.project_id
  WHERE action.source_diagnostic_run_id IS NULL
    AND observation.created_at <= action.created_at
    AND diagnostic_run.created_at <= action.created_at
)
UPDATE app.actions action
SET source_diagnostic_run_id = ranked.diagnostic_run_id
FROM ranked_action_sources ranked
WHERE action.id = ranked.action_id
  AND ranked.source_rank = 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.actions action
    WHERE action.source_diagnostic_run_id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing action cannot be traced to an observed diagnostic run'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE app.actions
  ALTER COLUMN source_diagnostic_run_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'actions_source_diagnostic_run_fk'
      AND conrelid = 'app.actions'::regclass
  ) THEN
    ALTER TABLE app.actions
      ADD CONSTRAINT actions_source_diagnostic_run_fk
      FOREIGN KEY (source_diagnostic_run_id)
      REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_action_source_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.source_finding_id IS DISTINCT FROM OLD.source_finding_id
    OR NEW.source_diagnostic_run_id IS DISTINCT FROM OLD.source_diagnostic_run_id
  ) THEN
    RAISE EXCEPTION 'action source lineage is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.findings finding
    WHERE finding.id = NEW.source_finding_id
      AND finding.workspace_id = NEW.workspace_id
      AND finding.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'action source finding scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic_run
    WHERE diagnostic_run.id = NEW.source_diagnostic_run_id
      AND diagnostic_run.workspace_id = NEW.workspace_id
      AND diagnostic_run.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'action source diagnostic run scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.finding_observations observation
    JOIN app.evidence source_evidence
      ON source_evidence.id = observation.evidence_id
     AND source_evidence.diagnostic_run_id = observation.diagnostic_run_id
     AND source_evidence.workspace_id = observation.workspace_id
     AND source_evidence.project_id = observation.project_id
    WHERE observation.finding_id = NEW.source_finding_id
      AND observation.diagnostic_run_id = NEW.source_diagnostic_run_id
      AND observation.workspace_id = NEW.workspace_id
      AND observation.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'action source diagnostic run did not observe the finding'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM app.findings finding
    WHERE finding.id = NEW.source_finding_id
      AND finding.workspace_id = NEW.workspace_id
      AND finding.project_id = NEW.project_id
      AND finding.last_seen_run_id = NEW.source_diagnostic_run_id
  ) THEN
    RAISE EXCEPTION 'action source diagnostic run is not the finding current run'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS actions_source_lineage_guard ON app.actions;
CREATE TRIGGER actions_source_lineage_guard
  BEFORE INSERT OR UPDATE ON app.actions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_action_source_lineage();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0011_product_profile_foundation'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0011_product_profile_foundation.sql

-- BEGIN EXACT ORDERED MIGRATION 0012_page_snapshot_lineage_hardening.sql
BEGIN;

-- The supported repository writer derives RFC 8785/JCS bytes and `content_hash`
-- from `extract`, then retains those exact bytes here. PostgreSQL proves only
-- that the retained bytes parse to the same jsonb value and hash to
-- `content_hash`; it does not independently prove RFC 8785 canonicality. This
-- avoids silently introducing a second JSON canonicalizer. Historical rows stay
-- byte-for-byte immutable: a null canonical_extract explicitly means the
-- application serialization bytes were not retained before this migration.
ALTER TABLE app.page_snapshots
  ADD COLUMN IF NOT EXISTS canonical_extract text;

-- SitePage identity is the exact persisted normalized URL, addressed by the
-- SHA-256 of its UTF-8 bytes. Earlier writers used JCS hashes. Refuse to merge
-- two durable page identities during the derived-field backfill, then replace
-- only the hash; PageSnapshot foreign keys continue to reference the same ids.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.site_pages
    GROUP BY project_id,
      encode(
        digest(convert_to(normalized_url, 'UTF8'), 'sha256'),
        'hex'
      )
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'site page URL duplicates or SHA-256 collision prevent identity backfill'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE app.site_pages
  DROP CONSTRAINT IF EXISTS site_pages_project_id_normalized_url_hash_key;

UPDATE app.site_pages
SET normalized_url_hash = encode(
  digest(convert_to(normalized_url, 'UTF8'), 'sha256'),
  'hex'
)
WHERE normalized_url_hash IS DISTINCT FROM encode(
  digest(convert_to(normalized_url, 'UTF8'), 'sha256'),
  'hex'
);

ALTER TABLE app.site_pages
  ADD CONSTRAINT site_pages_project_id_normalized_url_hash_key
  UNIQUE (project_id, normalized_url_hash);

CREATE OR REPLACE FUNCTION app.enforce_site_page_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.normalized_url IS DISTINCT FROM OLD.normalized_url
    OR NEW.normalized_url_hash IS DISTINCT FROM OLD.normalized_url_hash
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'site page durable identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.normalized_url_hash IS DISTINCT FROM encode(
    digest(convert_to(NEW.normalized_url, 'UTF8'), 'sha256'),
    'hex'
  ) THEN
    RAISE EXCEPTION 'site page URL hash does not match its normalized URL'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.sites site
    WHERE site.id = NEW.site_id
      AND site.workspace_id = NEW.workspace_id
      AND site.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'site page provenance does not match its canonical site'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Canonical collection lineage begins at the accepted AsyncRun and Site. A
-- foreign Site/source connection/import preview must never be able to mint a
-- same-project snapshot that later looks trustworthy.
CREATE OR REPLACE FUNCTION app.enforce_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'collection run must be inserted as an unfinished placeholder'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.source_connection_id IS DISTINCT FROM OLD.source_connection_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.method_version IS DISTINCT FROM OLD.method_version
    OR NEW.parameters_hash IS DISTINCT FROM OLD.parameters_hash
    OR NEW.import_preview_id IS DISTINCT FROM OLD.import_preview_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'collection run source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'collection run outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.provider = NEW.provider
        AND snapshot.method_version = NEW.method_version
        AND snapshot.source_connection_id IS NOT DISTINCT FROM NEW.source_connection_id
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
    ) THEN
      RAISE EXCEPTION 'collection run outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.operation = 'site_graph')
    OR (NEW.provider = 'gsc' AND NEW.operation = 'search_analytics')
    OR (NEW.provider = 'ga4' AND NEW.operation = 'organic_landing')
    OR (NEW.provider IN ('csv','dataforseo') AND NEW.operation = 'keyword_gap_import')
  ) THEN
    RAISE EXCEPTION 'collection run operation does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider <> 'csv' AND NEW.source_connection_id IS NULL THEN
    RAISE EXCEPTION 'collection run provider requires a canonical source connection'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider <> 'csv' AND NEW.import_preview_id IS NOT NULL THEN
    RAISE EXCEPTION 'only CSV collection runs may reference an import preview'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'collection'
  ) THEN
    RAISE EXCEPTION 'collection run scope does not match its async run and site'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.source_connections source
    WHERE source.id = NEW.source_connection_id
      AND source.workspace_id = NEW.workspace_id
      AND source.project_id = NEW.project_id
      AND source.site_id = NEW.site_id
      AND source.provider = NEW.provider
  ) THEN
    RAISE EXCEPTION 'collection run source connection provenance is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.import_preview_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.import_previews preview
    WHERE preview.id = NEW.import_preview_id
      AND preview.workspace_id = NEW.workspace_id
      AND preview.project_id = NEW.project_id
      AND preview.site_id = NEW.site_id
      AND preview.template_id = 'keyword_gap_v1'
  ) THEN
    RAISE EXCEPTION 'collection run import preview provenance is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_runs_provenance_guard ON app.collection_runs;
CREATE TRIGGER collection_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_collection_run_provenance();

-- A DataSnapshot is an immutable output of exactly one collection run. Provider,
-- site, source connection, and method version are copied facts, not caller-owned
-- labels. Dataset/provider pairings are likewise fixed for the current schemas.
CREATE OR REPLACE FUNCTION app.enforce_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = NEW.provider
      AND run.method_version = NEW.method_version
      AND run.source_connection_id IS NOT DISTINCT FROM NEW.source_connection_id
  ) THEN
    RAISE EXCEPTION 'data snapshot provenance does not match its collection run'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.dataset_key = 'crawl.site_graph.v1')
    OR (NEW.provider = 'gsc' AND NEW.dataset_key = 'gsc.page_query_daily.v1')
    OR (NEW.provider = 'ga4' AND NEW.dataset_key = 'ga4.organic_landing_daily.v1')
    OR (NEW.provider IN ('csv','dataforseo') AND NEW.dataset_key = 'csv.keyword_gap.v1')
  ) THEN
    RAISE EXCEPTION 'data snapshot dataset does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_snapshots_provenance_guard ON app.data_snapshots;
CREATE TRIGGER data_snapshots_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_data_snapshot_provenance();

-- Observations inherit source identity and capture time from their immutable
-- snapshot. The grade/origin mapping is fixed by spec §7.7 so a lower-trust
-- vendor or CSV row cannot relabel itself as first-party evidence.
CREATE OR REPLACE FUNCTION app.enforce_normalized_observation_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
      AND snapshot.provider = NEW.provider
      AND snapshot.captured_at = NEW.observed_at
  ) THEN
    RAISE EXCEPTION 'observation provenance does not match its immutable snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND (
        (
          snapshot.provider = 'crawl'
          AND snapshot.dataset_key = 'crawl.site_graph.v1'
          AND NEW.metric_key IN (
            'crawl.page.v1','crawl.robots.v1','crawl.sitemap.v1'
          )
        )
        OR (
          snapshot.provider = 'gsc'
          AND snapshot.dataset_key = 'gsc.page_query_daily.v1'
          AND NEW.metric_key = 'gsc.page.v1'
        )
        OR (
          snapshot.provider = 'ga4'
          AND snapshot.dataset_key = 'ga4.organic_landing_daily.v1'
          AND NEW.metric_key = 'ga4.landing.v1'
        )
        OR (
          snapshot.provider IN ('csv','dataforseo')
          AND snapshot.dataset_key = 'csv.keyword_gap.v1'
          AND NEW.metric_key = 'csv.keyword_gap.v1'
        )
      )
  ) THEN
    RAISE EXCEPTION 'observation metric does not belong to its provider dataset'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider IN ('gsc','ga4') AND NEW.origin = 'first_party' AND NEW.grade = 'A')
    OR (NEW.provider = 'crawl' AND NEW.origin = 'direct_public' AND NEW.grade = 'B')
    OR (NEW.provider = 'dataforseo' AND NEW.origin = 'vendor_observation' AND NEW.grade = 'B')
    OR (NEW.provider = 'csv' AND NEW.origin = 'user_provided' AND NEW.grade = 'C')
  ) THEN
    RAISE EXCEPTION 'observation trust label does not match its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalized_observations_provenance_guard ON app.normalized_observations;
CREATE TRIGGER normalized_observations_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_normalized_observation_provenance();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'page_snapshots_canonical_extract_required'
      AND conrelid = 'app.page_snapshots'::regclass
  ) THEN
    ALTER TABLE app.page_snapshots
      ADD CONSTRAINT page_snapshots_canonical_extract_required
      CHECK (canonical_extract IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

-- Fresh databases validate the requirement immediately. Upgraded databases
-- retain a visible NOT VALID marker until an external, provenance-preserving
-- backfill can supply the original bytes; PostgreSQL still enforces the check
-- for every new insert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.page_snapshots WHERE canonical_extract IS NULL
  ) THEN
    ALTER TABLE app.page_snapshots
      VALIDATE CONSTRAINT page_snapshots_canonical_extract_required;
  END IF;
END;
$$;

-- Every verified (post-0012) projection has exactly one row per page/source
-- pair. This index is deployable even when immutable legacy history already
-- contains a conflicting pair; such rows stay explicitly unverified.
CREATE UNIQUE INDEX IF NOT EXISTS page_snapshots_verified_source_identity_idx
  ON app.page_snapshots(site_page_id, data_snapshot_id)
  WHERE canonical_extract IS NOT NULL;

-- Where existing history already satisfies the stronger global invariant,
-- promote it to a full constraint. If legacy duplicates exist, preserve them
-- unchanged; the trigger below prevents any new row from extending the conflict.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.page_snapshots
    GROUP BY site_page_id, data_snapshot_id
    HAVING count(*) > 1
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'page_snapshots_site_page_data_snapshot_key'
      AND conrelid = 'app.page_snapshots'::regclass
  ) THEN
    ALTER TABLE app.page_snapshots
      ADD CONSTRAINT page_snapshots_site_page_data_snapshot_key
      UNIQUE (site_page_id, data_snapshot_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_page_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_captured_at timestamptz;
  source_page_url text;
  canonical_extract_json jsonb;
BEGIN
  IF NEW.canonical_extract IS NULL THEN
    RAISE EXCEPTION 'new page snapshots require retained extract bytes'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.page_snapshots existing
    WHERE existing.site_page_id = NEW.site_page_id
      AND existing.data_snapshot_id = NEW.data_snapshot_id
      AND existing.canonical_extract IS NULL
  ) THEN
    RAISE EXCEPTION 'page snapshot source identity already exists in legacy history'
      USING ERRCODE = '23505';
  END IF;

  SELECT snapshot.captured_at, page.normalized_url
  INTO source_captured_at, source_page_url
  FROM app.site_pages page
  JOIN app.data_snapshots snapshot
    ON snapshot.id = NEW.data_snapshot_id
   AND snapshot.site_id = page.site_id
  WHERE page.id = NEW.site_page_id
    AND page.workspace_id = NEW.workspace_id
    AND page.project_id = NEW.project_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.project_id = NEW.project_id
    AND snapshot.provider = 'crawl'
    AND snapshot.dataset_key = 'crawl.site_graph.v1';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'page snapshot provenance does not match its canonical sources'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.captured_at IS DISTINCT FROM source_captured_at THEN
    RAISE EXCEPTION 'page snapshot capture time does not match its canonical source snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.extract ->> 'schemaVersion' IS DISTINCT FROM 'crawl.page-extract.v1'
     OR NEW.extract #>> '{projection,fetchUrl}' IS DISTINCT FROM source_page_url THEN
    RAISE EXCEPTION 'page snapshot extract identity does not match its durable site page'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    canonical_extract_json := NEW.canonical_extract::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'page snapshot retained extract bytes are not valid JSON'
      USING ERRCODE = '23514';
  END;

  IF canonical_extract_json IS DISTINCT FROM NEW.extract THEN
    RAISE EXCEPTION 'page snapshot retained extract bytes do not match its jsonb extract'
      USING ERRCODE = '23514';
  END IF;

  IF encode(
       digest(convert_to(NEW.canonical_extract, 'UTF8'), 'sha256'),
       'hex'
     ) IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'page snapshot content hash does not match its retained extract bytes'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS page_snapshots_provenance_guard ON app.page_snapshots;
CREATE TRIGGER page_snapshots_provenance_guard
  BEFORE INSERT ON app.page_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_page_snapshot_provenance();

-- A DiagnosticRun may update only its derived coverage projection. Every input
-- column and the JCS content address remain immutable after enqueue so a result
-- can always be replayed against the exact frozen context it names.
CREATE OR REPLACE FUNCTION app.enforce_diagnostic_run_frozen_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'diagnostic run frozen input is append-only'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.icp_profile_id IS DISTINCT FROM OLD.icp_profile_id
     OR NEW.icp_profile_version IS DISTINCT FROM OLD.icp_profile_version
     OR NEW.rule_set_version IS DISTINCT FROM OLD.rule_set_version
     OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
     OR NEW.output_locale IS DISTINCT FROM OLD.output_locale
     OR NEW.input_manifest IS DISTINCT FROM OLD.input_manifest
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'diagnostic run frozen input is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diagnostic_runs_frozen_input_guard ON app.diagnostic_runs;
CREATE TRIGGER diagnostic_runs_frozen_input_guard
  BEFORE UPDATE OR DELETE ON app.diagnostic_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_diagnostic_run_frozen_input();

-- Evidence has three mutually exclusive provenance shapes:
--   * source-backed rows name one frozen snapshot/run and use either the
--     provider's observed axes or the replayable derived axes from spec §7.7;
--   * deterministic system rows are lineage-free derived/computed/B facts;
--   * generated LLM rows name one successful immutable invocation and grade C.
-- Historical rows remain readable: NOT VALID preserves legacy history while
-- enforcing the invariant for every row inserted after this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'evidence_source_lineage_required'
      AND conrelid = 'app.evidence'::regclass
      AND obj_description(oid, 'pg_constraint') = 'signalframe.evidence-provenance.v2'
      AND pg_get_constraintdef(oid) LIKE '%source_provider = ''system''%'
      AND pg_get_constraintdef(oid) LIKE '%origin = ''derived''%'
      AND pg_get_constraintdef(oid) LIKE '%method = ''computed''%'
      AND pg_get_constraintdef(oid) LIKE '%method = ''inferred''%'
      AND pg_get_constraintdef(oid) LIKE '%grade = ''C''%'
  ) THEN
    ALTER TABLE app.evidence
      DROP CONSTRAINT IF EXISTS evidence_source_lineage_required;

    ALTER TABLE app.evidence
      ADD CONSTRAINT evidence_source_lineage_required
      CHECK (
        (
          analysis_invocation_id IS NOT NULL
          AND snapshot_id IS NULL
          AND collection_run_id IS NULL
          AND source_provider = 'llm'
          AND origin = 'generated'
          AND method = 'generated'
          AND grade = 'C'
        )
        OR (
          analysis_invocation_id IS NULL
          AND snapshot_id IS NOT NULL
          AND collection_run_id IS NOT NULL
          AND source_provider IN ('crawl','gsc','ga4','csv','dataforseo')
          AND (
            (
              method = 'observed'
              AND (
                (
                  source_provider IN ('gsc','ga4')
                  AND origin = 'first_party'
                  AND grade = 'A'
                )
                OR (
                  source_provider = 'crawl'
                  AND origin = 'direct_public'
                  AND grade = 'B'
                )
                OR (
                  source_provider = 'dataforseo'
                  AND origin = 'vendor_observation'
                  AND grade = 'B'
                )
                OR (
                  source_provider = 'csv'
                  AND origin = 'user_provided'
                  AND grade = 'C'
                )
              )
            )
            OR (
              origin = 'derived'
              AND method = 'computed'
              AND grade = 'B'
            )
            OR (
              origin = 'derived'
              AND method = 'inferred'
              AND grade = 'C'
            )
          )
        )
        OR (
          analysis_invocation_id IS NULL
          AND snapshot_id IS NULL
          AND collection_run_id IS NULL
          AND source_provider = 'system'
          AND origin = 'derived'
          AND method = 'computed'
          AND grade = 'B'
        )
      ) NOT VALID;
  END IF;
END;
$$;

COMMENT ON CONSTRAINT evidence_source_lineage_required ON app.evidence IS
  'signalframe.evidence-provenance.v2';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.evidence
    WHERE NOT (
      (
        analysis_invocation_id IS NOT NULL
        AND snapshot_id IS NULL
        AND collection_run_id IS NULL
        AND source_provider = 'llm'
        AND origin = 'generated'
        AND method = 'generated'
        AND grade = 'C'
      )
      OR (
        analysis_invocation_id IS NULL
        AND snapshot_id IS NOT NULL
        AND collection_run_id IS NOT NULL
        AND source_provider IN ('crawl','gsc','ga4','csv','dataforseo')
        AND (
          (
            method = 'observed'
            AND (
              (
                source_provider IN ('gsc','ga4')
                AND origin = 'first_party'
                AND grade = 'A'
              )
              OR (
                source_provider = 'crawl'
                AND origin = 'direct_public'
                AND grade = 'B'
              )
              OR (
                source_provider = 'dataforseo'
                AND origin = 'vendor_observation'
                AND grade = 'B'
              )
              OR (
                source_provider = 'csv'
                AND origin = 'user_provided'
                AND grade = 'C'
              )
            )
          )
          OR (
            origin = 'derived'
            AND method = 'computed'
            AND grade = 'B'
          )
          OR (
            origin = 'derived'
            AND method = 'inferred'
            AND grade = 'C'
          )
        )
      )
      OR (
        analysis_invocation_id IS NULL
        AND snapshot_id IS NULL
        AND collection_run_id IS NULL
        AND source_provider = 'system'
        AND origin = 'derived'
        AND method = 'computed'
        AND grade = 'B'
      )
    )
  ) THEN
    ALTER TABLE app.evidence
      VALIDATE CONSTRAINT evidence_source_lineage_required;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_evidence_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_captured_at timestamptz;
BEGIN
  IF NEW.analysis_invocation_id IS NOT NULL THEN
    IF NEW.snapshot_id IS NOT NULL OR NEW.collection_run_id IS NOT NULL THEN
      RAISE EXCEPTION 'invocation-backed evidence cannot also claim source snapshot lineage'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source_provider <> 'llm'
       OR NEW.origin <> 'generated'
       OR NEW.method <> 'generated'
       OR NEW.grade <> 'C' THEN
      RAISE EXCEPTION 'invocation-backed evidence must be generated LLM grade-C evidence'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app.analysis_invocations invocation
      JOIN app.diagnostic_runs diagnostic
        ON diagnostic.id = NEW.diagnostic_run_id
       AND diagnostic.workspace_id = NEW.workspace_id
       AND diagnostic.project_id = NEW.project_id
      WHERE invocation.id = NEW.analysis_invocation_id
        AND invocation.workspace_id = NEW.workspace_id
        AND invocation.project_id = NEW.project_id
        AND invocation.diagnostic_run_id = NEW.diagnostic_run_id
        AND invocation.async_run_id = NEW.diagnostic_run_id
        AND invocation.task = 'finding_summary'
        AND invocation.status = 'succeeded'
        AND invocation.output_hash IS NOT NULL
        AND invocation.prompt_set_version = diagnostic.prompt_set_version
    ) THEN
      RAISE EXCEPTION 'evidence invocation provenance does not match its diagnostic run'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.source_provider = 'llm' THEN
    RAISE EXCEPTION 'LLM evidence requires immutable invocation lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_provider = 'system' THEN
    IF NEW.snapshot_id IS NOT NULL OR NEW.collection_run_id IS NOT NULL THEN
      RAISE EXCEPTION 'system evidence cannot claim source snapshot lineage'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.origin <> 'derived'
       OR NEW.method <> 'computed'
       OR NEW.grade <> 'B' THEN
      RAISE EXCEPTION 'system evidence must be deterministic derived/computed/B evidence'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app.diagnostic_runs diagnostic
      WHERE diagnostic.id = NEW.diagnostic_run_id
        AND diagnostic.workspace_id = NEW.workspace_id
        AND diagnostic.project_id = NEW.project_id
    ) THEN
      RAISE EXCEPTION 'system evidence provenance does not match its diagnostic run'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.source_provider NOT IN ('crawl','gsc','ga4','csv','dataforseo') THEN
    RAISE EXCEPTION 'evidence source provider is not supported'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.snapshot_id IS NULL OR NEW.collection_run_id IS NULL THEN
    RAISE EXCEPTION 'source-backed evidence requires snapshot and collection lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      NEW.method = 'observed'
      AND (
        (
          NEW.source_provider IN ('gsc','ga4')
          AND NEW.origin = 'first_party'
          AND NEW.grade = 'A'
        )
        OR (
          NEW.source_provider = 'crawl'
          AND NEW.origin = 'direct_public'
          AND NEW.grade = 'B'
        )
        OR (
          NEW.source_provider = 'dataforseo'
          AND NEW.origin = 'vendor_observation'
          AND NEW.grade = 'B'
        )
        OR (
          NEW.source_provider = 'csv'
          AND NEW.origin = 'user_provided'
          AND NEW.grade = 'C'
        )
      )
    )
    OR (
      NEW.origin = 'derived'
      AND NEW.method = 'computed'
      AND NEW.grade = 'B'
    )
    OR (
      NEW.origin = 'derived'
      AND NEW.method = 'inferred'
      AND NEW.grade = 'C'
    )
  ) THEN
    RAISE EXCEPTION 'evidence trust axes do not match observed or derived semantics'
      USING ERRCODE = '23514';
  END IF;

  SELECT snapshot.captured_at
  INTO source_captured_at
  FROM app.data_snapshots snapshot
  WHERE snapshot.id = NEW.snapshot_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.project_id = NEW.project_id
    AND snapshot.collection_run_id = NEW.collection_run_id
    AND snapshot.provider = NEW.source_provider;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence source lineage does not match its immutable snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.observed_at IS DISTINCT FROM source_captured_at THEN
    RAISE EXCEPTION 'evidence observation time does not match its source snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic
    JOIN app.data_snapshots snapshot
      ON snapshot.id = NEW.snapshot_id
     AND snapshot.workspace_id = NEW.workspace_id
     AND snapshot.project_id = NEW.project_id
     AND snapshot.site_id = diagnostic.site_id
     AND snapshot.collection_run_id = NEW.collection_run_id
     AND snapshot.provider = NEW.source_provider
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(diagnostic.input_manifest -> 'snapshots') = 'array'
        THEN diagnostic.input_manifest -> 'snapshots'
        ELSE '[]'::jsonb
      END
    ) AS frozen_snapshot(entry)
    WHERE diagnostic.id = NEW.diagnostic_run_id
      AND diagnostic.workspace_id = NEW.workspace_id
      AND diagnostic.project_id = NEW.project_id
      AND frozen_snapshot.entry ->> 'snapshotId' = NEW.snapshot_id::text
      AND frozen_snapshot.entry ->> 'provider' = NEW.source_provider
      AND frozen_snapshot.entry ->> 'datasetKey' = snapshot.dataset_key
      AND frozen_snapshot.entry ->> 'schemaVersion' = snapshot.schema_version
      AND frozen_snapshot.entry ->> 'methodVersion' = snapshot.method_version
      AND frozen_snapshot.entry ->> 'checksum' = snapshot.checksum
      AND frozen_snapshot.entry ->> 'availability' = snapshot.availability
      AND frozen_snapshot.entry -> 'sourceWindow' = snapshot.source_window
      AND (frozen_snapshot.entry ->> 'capturedAt')::timestamptz = snapshot.captured_at
      AND diagnostic.input_manifest ->> 'projectId' = diagnostic.project_id::text
      AND diagnostic.input_manifest ->> 'siteId' = diagnostic.site_id::text
      AND diagnostic.input_manifest ->> 'ruleSetVersion' = diagnostic.rule_set_version
      AND diagnostic.input_manifest ->> 'promptSetVersion' = diagnostic.prompt_set_version
      AND diagnostic.input_manifest ->> 'deliveryLocale' = diagnostic.output_locale
      AND diagnostic.input_manifest #>> '{icp,id}' = diagnostic.icp_profile_id::text
      AND (diagnostic.input_manifest #>> '{icp,version}')::integer = diagnostic.icp_profile_version
  ) THEN
    RAISE EXCEPTION 'evidence snapshot is not frozen in its diagnostic input manifest'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_provenance_guard ON app.evidence;
CREATE TRIGGER evidence_provenance_guard
  BEFORE INSERT ON app.evidence
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_evidence_provenance();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0012_page_snapshot_lineage_hardening'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0012_page_snapshot_lineage_hardening.sql

-- BEGIN EXACT ORDERED MIGRATION 0013_exact_url_variant_rules.sql
BEGIN;

-- mvp.rules.0.2.1 keeps the same eleven deterministic rule identities but
-- upgrades the three technical rules that consume exact slash/non-slash page
-- variants. Historical 0.2.0 DiagnosticRuns remain immutable and readable.
ALTER TABLE app.diagnostic_runs
  DROP CONSTRAINT IF EXISTS diagnostic_runs_rule_set_version_check;

ALTER TABLE app.diagnostic_runs
  ADD CONSTRAINT diagnostic_runs_rule_set_version_check
  CHECK (rule_set_version IN ('mvp.rules.0.2.0', 'mvp.rules.0.2.1'));

-- Current diagnostics freeze a complete, self-consistent manifest. Historical
-- 0.2.0 rows stay readable, but no new 0.2.1 row may reference a foreign Site,
-- stale crawl method, or self-reported snapshot metadata.
CREATE OR REPLACE FUNCTION app.enforce_current_diagnostic_manifest()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_count integer;
  matched_snapshot_count integer;
  distinct_snapshot_count integer;
  distinct_provider_count integer;
BEGIN
  IF NEW.rule_set_version <> 'mvp.rules.0.2.1' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.input_manifest -> 'snapshots') <> 'array'
     OR jsonb_typeof(NEW.input_manifest -> 'icp') <> 'object'
     OR NEW.input_manifest ->> 'projectId' <> NEW.project_id::text
     OR NEW.input_manifest ->> 'siteId' <> NEW.site_id::text
     OR NEW.input_manifest ->> 'ruleSetVersion' <> NEW.rule_set_version
     OR NEW.input_manifest ->> 'promptSetVersion' <> NEW.prompt_set_version
     OR NEW.input_manifest ->> 'deliveryLocale' <> NEW.output_locale
     OR NEW.input_manifest #>> '{icp,id}' <> NEW.icp_profile_id::text
     OR (NEW.input_manifest #>> '{icp,version}')::integer <> NEW.icp_profile_version
     OR NOT EXISTS (
       SELECT 1
       FROM app.icp_profiles icp
       WHERE icp.id = NEW.icp_profile_id
         AND icp.workspace_id = NEW.workspace_id
         AND icp.project_id = NEW.project_id
         AND icp.version = NEW.icp_profile_version
         AND icp.status = 'complete'
         AND icp.content_hash = NEW.input_manifest #>> '{icp,contentHash}'
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest does not match its frozen run and ICP'
      USING ERRCODE = '23514';
  END IF;

  snapshot_count := jsonb_array_length(NEW.input_manifest -> 'snapshots');
  SELECT
    count(*),
    count(DISTINCT entry ->> 'snapshotId'),
    count(DISTINCT entry ->> 'provider')
  INTO matched_snapshot_count, distinct_snapshot_count, distinct_provider_count
  FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
  JOIN app.data_snapshots snapshot
    ON snapshot.id = (entry ->> 'snapshotId')::uuid
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
   AND snapshot.site_id = NEW.site_id
   AND snapshot.provider = entry ->> 'provider'
   AND snapshot.dataset_key = entry ->> 'datasetKey'
   AND snapshot.schema_version = entry ->> 'schemaVersion'
   AND snapshot.method_version = entry ->> 'methodVersion'
   AND snapshot.checksum = entry ->> 'checksum'
   AND snapshot.availability = entry ->> 'availability'
   AND snapshot.source_window = entry -> 'sourceWindow'
   AND snapshot.captured_at = (entry ->> 'capturedAt')::timestamptz;

  IF snapshot_count = 0
     OR matched_snapshot_count <> snapshot_count
     OR distinct_snapshot_count <> snapshot_count
     OR distinct_provider_count <> snapshot_count
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
       WHERE entry ->> 'provider' = 'crawl'
         AND entry ->> 'methodVersion' = 'crawl.site_graph.v2'
         AND entry ->> 'availability' IN ('available','partial')
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest snapshot selection is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diagnostic_runs_current_manifest_guard ON app.diagnostic_runs;
CREATE TRIGGER diagnostic_runs_current_manifest_guard
  BEFORE INSERT ON app.diagnostic_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_current_diagnostic_manifest();

CREATE OR REPLACE FUNCTION app.expected_diagnostic_rule_version(
  selected_rule_set text,
  selected_rule_id text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN selected_rule_id NOT IN (
      'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005',
      'SEARCH-CTR-004','SEARCH-DECAY-002','CONTENT-COVERAGE-001',
      'CONTENT-GAP-011','CRO-PATH-001','CRO-LANDING-003',
      'GEO-ENTITY-001','GEO-CRAWLER-002'
    ) THEN NULL
    WHEN selected_rule_set = 'mvp.rules.0.2.1'
      AND selected_rule_id IN (
        'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005'
      ) THEN 2
    WHEN selected_rule_set IN ('mvp.rules.0.2.0','mvp.rules.0.2.1') THEN 1
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION app.enforce_diagnostic_rule_version_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_version integer;
BEGIN
  SELECT app.expected_diagnostic_rule_version(run.rule_set_version, NEW.rule_id)
  INTO expected_version
  FROM app.diagnostic_runs run
  WHERE run.id = NEW.diagnostic_run_id;

  IF expected_version IS NULL OR NEW.rule_version <> expected_version THEN
    RAISE EXCEPTION 'diagnostic rule version does not match its frozen rule set'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diagnostic_run_rules_version_guard ON app.diagnostic_run_rules;
CREATE TRIGGER diagnostic_run_rules_version_guard
  BEFORE INSERT ON app.diagnostic_run_rules
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_diagnostic_rule_version_lineage();

CREATE OR REPLACE FUNCTION app.enforce_finding_rule_version_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_version integer;
BEGIN
  SELECT app.expected_diagnostic_rule_version(run.rule_set_version, NEW.rule_id)
  INTO expected_version
  FROM app.diagnostic_runs run
  WHERE run.id = NEW.last_seen_run_id
    AND run.workspace_id = NEW.workspace_id
    AND run.project_id = NEW.project_id;

  IF expected_version IS NULL OR NEW.rule_version <> expected_version THEN
    RAISE EXCEPTION 'finding rule version does not match its last-seen diagnostic run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS findings_rule_version_guard ON app.findings;
CREATE TRIGGER findings_rule_version_guard
  BEFORE INSERT OR UPDATE OF rule_id, rule_version, last_seen_run_id
  ON app.findings
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_finding_rule_version_lineage();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0013_exact_url_variant_rules'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0013_exact_url_variant_rules.sql

-- BEGIN EXACT ORDERED MIGRATION 0014_product_profile_synthesis.sql
BEGIN;

-- Product Profile synthesis is a first-class asynchronous command. Preserve
-- every historical enum value while activating the new run/result/task axes.
ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_kind_check
  CHECK (kind IN (
    'collection',
    'diagnostic',
    'artifact_generation',
    'export',
    'product_profile_synthesis'
  ));

ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_result_type_check
  CHECK (
    result_type IS NULL OR result_type IN (
      'collection_run',
      'diagnostic_run',
      'artifact',
      'export',
      'icp_profile'
    )
  );

ALTER TABLE app.analysis_invocations
  DROP CONSTRAINT IF EXISTS analysis_invocations_task_check;
ALTER TABLE app.analysis_invocations
  ADD CONSTRAINT analysis_invocations_task_check
  CHECK (task IN (
    'finding_summary',
    'artifact_generation',
    'product_profile_synthesis'
  ));

-- This row is a frozen-input run ledger. Canonical Product Profile lifecycle
-- truth remains append-only app.icp_profiles; there is deliberately no second
-- status column here.
CREATE TABLE IF NOT EXISTS app.product_profile_runs (
  id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  base_icp_profile_id uuid NOT NULL
    REFERENCES app.icp_profiles(id) ON DELETE RESTRICT,
  base_icp_profile_version integer NOT NULL
    CHECK (base_icp_profile_version >= 1),
  base_icp_profile_content_hash text NOT NULL
    CHECK (base_icp_profile_content_hash ~ '^[a-f0-9]{64}$'),
  source_snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  synthesis_version text NOT NULL
    CHECK (length(btrim(synthesis_version)) >= 1),
  prompt_set_version text NOT NULL
    CHECK (length(btrim(prompt_set_version)) >= 1),
  input_manifest jsonb NOT NULL
    CHECK (jsonb_typeof(input_manifest) = 'object'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  prompt_input_hash text
    CHECK (prompt_input_hash IS NULL OR prompt_input_hash ~ '^[a-f0-9]{64}$'),
  result_icp_profile_id uuid
    REFERENCES app.icp_profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_profile_runs_project_created_idx
  ON app.product_profile_runs(project_id, created_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS product_profile_runs_base_profile_idx
  ON app.product_profile_runs(base_icp_profile_id, created_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS product_profile_runs_source_snapshot_idx
  ON app.product_profile_runs(source_snapshot_id, id ASC);
CREATE INDEX IF NOT EXISTS product_profile_runs_result_profile_idx
  ON app.product_profile_runs(result_icp_profile_id)
  WHERE result_icp_profile_id IS NOT NULL;

-- A provider call consumes budget before the network request leaves the
-- worker. This ledger makes that reservation durable and serializes retries by
-- the exact AsyncRun delivery epoch. It intentionally stores only bounded
-- metadata and content hashes, never prompts or model output.
CREATE TABLE IF NOT EXISTS app.product_profile_invocation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  product_profile_run_id uuid NOT NULL
    REFERENCES app.product_profile_runs(id) ON DELETE RESTRICT,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  async_attempt_count integer NOT NULL CHECK (async_attempt_count >= 1),
  provider text NOT NULL CHECK (provider IN ('openai','google')),
  model text NOT NULL CHECK (
    length(model) BETWEEN 1 AND 200
    AND model = btrim(model)
  ),
  prompt_set_version text NOT NULL CHECK (
    length(prompt_set_version) BETWEEN 1 AND 200
    AND prompt_set_version = btrim(prompt_set_version)
  ),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  planned_analysis_invocation_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved','succeeded','failed','rejected','outcome_unknown')),
  analysis_invocation_id uuid UNIQUE
    REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  terminal_error_code text CHECK (
    terminal_error_code IS NULL
    OR terminal_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  provider_returned_at timestamptz,
  finalized_at timestamptz,
  UNIQUE (product_profile_run_id, ordinal),
  UNIQUE (product_profile_run_id, async_attempt_count),
  CHECK (
    (status = 'reserved'
      AND analysis_invocation_id IS NULL
      AND terminal_error_code IS NULL
      AND provider_returned_at IS NULL
      AND finalized_at IS NULL)
    OR
    (status = 'succeeded'
      AND analysis_invocation_id = planned_analysis_invocation_id
      AND terminal_error_code IS NULL
      AND provider_returned_at IS NOT NULL
      AND finalized_at IS NOT NULL)
    OR
    (status IN ('failed','rejected')
      AND analysis_invocation_id = planned_analysis_invocation_id
      AND terminal_error_code IS NOT NULL
      AND provider_returned_at IS NOT NULL
      AND finalized_at IS NOT NULL)
    OR
    (status = 'outcome_unknown'
      AND analysis_invocation_id IS NULL
      AND terminal_error_code IS NOT NULL
      AND provider_returned_at IS NOT NULL
      AND finalized_at IS NOT NULL)
  ),
  CHECK (
    provider_returned_at IS NULL
    OR finalized_at IS NULL
    OR provider_returned_at <= finalized_at
  ),
  CHECK (
    provider_returned_at IS NULL
    OR reserved_at <= provider_returned_at
  )
);

CREATE INDEX IF NOT EXISTS product_profile_invocation_attempts_project_idx
  ON app.product_profile_invocation_attempts(
    project_id,
    reserved_at DESC,
    id ASC
  );
CREATE INDEX IF NOT EXISTS product_profile_invocation_attempts_unresolved_idx
  ON app.product_profile_invocation_attempts(product_profile_run_id, ordinal)
  WHERE status IN ('reserved','outcome_unknown');

CREATE OR REPLACE FUNCTION app.enforce_product_profile_invocation_attempt_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_ordinal integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'reserved'
       OR NEW.analysis_invocation_id IS NOT NULL
       OR NEW.terminal_error_code IS NOT NULL
       OR NEW.provider_returned_at IS NOT NULL
       OR NEW.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'provider invocation attempt must begin as a reservation'
        USING ERRCODE = '23514';
    END IF;
    PERFORM 1
    FROM app.async_runs run
    JOIN app.product_profile_runs profile_run ON profile_run.id = run.id
    WHERE run.id = NEW.product_profile_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'product_profile_synthesis'
      AND run.status = 'running'
      AND run.attempt_count = NEW.async_attempt_count
      AND profile_run.workspace_id = NEW.workspace_id
      AND profile_run.project_id = NEW.project_id
      AND profile_run.prompt_set_version = NEW.prompt_set_version
      AND profile_run.prompt_input_hash = NEW.input_hash
    FOR UPDATE OF run, profile_run;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider invocation reservation scope or delivery is stale'
        USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(max(attempt.ordinal), 0)::integer + 1
    INTO expected_ordinal
    FROM app.product_profile_invocation_attempts attempt
    WHERE attempt.product_profile_run_id = NEW.product_profile_run_id;
    IF expected_ordinal > 3 OR NEW.ordinal IS DISTINCT FROM expected_ordinal THEN
      RAISE EXCEPTION 'provider invocation ordinal must be allocated sequentially by the database'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider invocation attempts are append-only'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.product_profile_run_id IS DISTINCT FROM OLD.product_profile_run_id
     OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
     OR NEW.async_attempt_count IS DISTINCT FROM OLD.async_attempt_count
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.planned_analysis_invocation_id IS DISTINCT FROM OLD.planned_analysis_invocation_id
     OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at THEN
    RAISE EXCEPTION 'provider invocation reservation identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'terminal provider invocation attempt is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status NOT IN ('succeeded','failed','rejected','outcome_unknown') THEN
    RAISE EXCEPTION 'provider invocation reservation must transition once to terminal'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('succeeded','failed','rejected') AND NOT EXISTS (
    SELECT 1
    FROM app.analysis_invocations invocation
    WHERE invocation.id = NEW.planned_analysis_invocation_id
      AND invocation.id = NEW.analysis_invocation_id
      AND invocation.workspace_id = NEW.workspace_id
      AND invocation.project_id = NEW.project_id
      AND invocation.async_run_id = NEW.product_profile_run_id
      AND invocation.diagnostic_run_id IS NULL
      AND invocation.task = 'product_profile_synthesis'
      AND invocation.provider = NEW.provider
      AND invocation.model = NEW.model
      AND invocation.prompt_set_version = NEW.prompt_set_version
      AND invocation.input_hash = NEW.input_hash
      AND invocation.status = NEW.status
      AND invocation.error_code IS NOT DISTINCT FROM NEW.terminal_error_code
  ) THEN
    RAISE EXCEPTION 'terminal provider invocation does not match its analysis ledger'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_profile_invocation_attempts_transition_guard
  ON app.product_profile_invocation_attempts;
CREATE TRIGGER product_profile_invocation_attempts_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.product_profile_invocation_attempts
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_product_profile_invocation_attempt_transition();

CREATE OR REPLACE FUNCTION app.reserve_product_profile_invocation_attempt(
  p_workspace_id uuid,
  p_project_id uuid,
  p_run_id uuid,
  p_async_attempt_count integer,
  p_provider text,
  p_model text,
  p_prompt_set_version text,
  p_input_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  profile_run app.product_profile_runs%ROWTYPE;
  existing_attempt app.product_profile_invocation_attempts%ROWTYPE;
  unresolved_attempt app.product_profile_invocation_attempts%ROWTYPE;
  reserved_attempt app.product_profile_invocation_attempts%ROWTYPE;
  invocation_count integer;
  next_ordinal integer;
BEGIN
  SELECT profile.*
  INTO profile_run
  FROM app.async_runs run
  JOIN app.product_profile_runs profile ON profile.id = run.id
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'product_profile_synthesis'
    AND run.status = 'running'
    AND run.attempt_count = p_async_attempt_count
    AND profile.workspace_id = p_workspace_id
    AND profile.project_id = p_project_id
  FOR UPDATE OF run, profile;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale');
  END IF;

  IF p_async_attempt_count < 1
     OR p_provider IS NULL
     OR p_provider NOT IN ('openai','google')
     OR p_model IS NULL
     OR length(p_model) NOT BETWEEN 1 AND 200
     OR p_model IS DISTINCT FROM btrim(p_model)
     OR p_prompt_set_version IS NULL
     OR length(p_prompt_set_version) NOT BETWEEN 1 AND 200
     OR p_prompt_set_version IS DISTINCT FROM btrim(p_prompt_set_version)
     OR p_prompt_set_version IS DISTINCT FROM profile_run.prompt_set_version
     OR p_input_hash IS NULL
     OR p_input_hash !~ '^[a-f0-9]{64}$'
     OR (profile_run.prompt_input_hash IS NOT NULL
       AND profile_run.prompt_input_hash IS DISTINCT FROM p_input_hash) THEN
    RETURN jsonb_build_object('kind', 'configuration_mismatch');
  END IF;

  SELECT attempt.*
  INTO existing_attempt
  FROM app.product_profile_invocation_attempts attempt
  WHERE attempt.product_profile_run_id = p_run_id
    AND attempt.async_attempt_count = p_async_attempt_count;

  IF FOUND THEN
    IF existing_attempt.workspace_id = p_workspace_id
       AND existing_attempt.project_id = p_project_id
       AND existing_attempt.provider = p_provider
       AND existing_attempt.model = p_model
       AND existing_attempt.prompt_set_version = p_prompt_set_version
       AND existing_attempt.input_hash = p_input_hash THEN
      RETURN jsonb_build_object(
        'kind', 'existing',
        'reservation', to_jsonb(existing_attempt)
      );
    END IF;
    RETURN jsonb_build_object('kind', 'configuration_mismatch');
  END IF;

  SELECT attempt.*
  INTO unresolved_attempt
  FROM app.product_profile_invocation_attempts attempt
  WHERE attempt.product_profile_run_id = p_run_id
    AND attempt.async_attempt_count < p_async_attempt_count
    AND attempt.status IN ('reserved','outcome_unknown')
  ORDER BY attempt.ordinal ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'unresolved',
      'reservation', to_jsonb(unresolved_attempt)
    );
  END IF;

  SELECT count(*)::integer, coalesce(max(attempt.ordinal), 0)::integer + 1
  INTO invocation_count, next_ordinal
  FROM app.product_profile_invocation_attempts attempt
  WHERE attempt.product_profile_run_id = p_run_id;

  IF invocation_count >= 3 OR next_ordinal > 3 THEN
    RETURN jsonb_build_object('kind', 'budget_exhausted');
  END IF;

  IF profile_run.prompt_input_hash IS NULL THEN
    UPDATE app.product_profile_runs
    SET prompt_input_hash = p_input_hash
    WHERE id = p_run_id
      AND workspace_id = p_workspace_id
      AND project_id = p_project_id
      AND prompt_input_hash IS NULL;
  END IF;

  INSERT INTO app.product_profile_invocation_attempts (
    workspace_id,
    project_id,
    product_profile_run_id,
    ordinal,
    async_attempt_count,
    provider,
    model,
    prompt_set_version,
    input_hash,
    planned_analysis_invocation_id
  ) VALUES (
    p_workspace_id,
    p_project_id,
    p_run_id,
    next_ordinal,
    p_async_attempt_count,
    p_provider,
    p_model,
    p_prompt_set_version,
    p_input_hash,
    gen_random_uuid()
  )
  RETURNING * INTO reserved_attempt;

  RETURN jsonb_build_object(
    'kind', 'reserved',
    'reservation', to_jsonb(reserved_attempt)
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.finalize_product_profile_invocation_attempt(
  p_workspace_id uuid,
  p_project_id uuid,
  p_run_id uuid,
  p_async_attempt_count integer,
  p_reservation_id uuid,
  p_provider text,
  p_model text,
  p_prompt_set_version text,
  p_input_hash text,
  p_output_hash text,
  p_status text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric,
  p_latency_ms integer,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  reservation app.product_profile_invocation_attempts%ROWTYPE;
  normalized_cost numeric(12,6);
BEGIN
  SELECT attempt.*
  INTO reservation
  FROM app.product_profile_invocation_attempts attempt
  WHERE attempt.id = p_reservation_id
    AND attempt.workspace_id = p_workspace_id
    AND attempt.project_id = p_project_id
    AND attempt.product_profile_run_id = p_run_id
    AND attempt.async_attempt_count = p_async_attempt_count
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_reservation');
  END IF;

  IF p_provider IS DISTINCT FROM reservation.provider
     OR p_model IS DISTINCT FROM reservation.model
     OR p_prompt_set_version IS DISTINCT FROM reservation.prompt_set_version
     OR p_input_hash IS DISTINCT FROM reservation.input_hash
     OR p_status IS NULL
     OR p_status NOT IN ('succeeded','failed','rejected')
     OR p_latency_ms IS NULL OR p_latency_ms < 0
     OR (p_input_tokens IS NOT NULL AND p_input_tokens < 0)
     OR (p_output_tokens IS NOT NULL AND p_output_tokens < 0)
     OR (p_cost_usd IS NOT NULL AND (
       p_cost_usd < 0
       OR round(p_cost_usd, 6) >= 1000000
     ))
     OR (p_status = 'succeeded' AND (
       p_output_hash IS NULL
       OR p_output_hash !~ '^[a-f0-9]{64}$'
       OR p_error_code IS NOT NULL
     ))
     OR (p_status IN ('failed','rejected') AND (
       p_output_hash IS NOT NULL
       OR p_error_code IS NULL
       OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
     )) THEN
    RETURN jsonb_build_object(
      'kind', 'conflict',
      'reservation', to_jsonb(reservation)
    );
  END IF;

  normalized_cost := CASE
    WHEN p_cost_usd IS NULL THEN NULL
    ELSE round(p_cost_usd, 6)
  END;

  IF reservation.status IN ('succeeded','failed','rejected') THEN
    IF EXISTS (
      SELECT 1
      FROM app.analysis_invocations invocation
      WHERE invocation.id = reservation.planned_analysis_invocation_id
        AND invocation.id = reservation.analysis_invocation_id
        AND invocation.workspace_id = p_workspace_id
        AND invocation.project_id = p_project_id
        AND invocation.async_run_id = p_run_id
        AND invocation.diagnostic_run_id IS NULL
        AND invocation.task = 'product_profile_synthesis'
        AND invocation.provider = p_provider
        AND invocation.model = p_model
        AND invocation.prompt_set_version = p_prompt_set_version
        AND invocation.input_hash = p_input_hash
        AND invocation.output_hash IS NOT DISTINCT FROM p_output_hash
        AND invocation.status = p_status
        AND invocation.input_tokens IS NOT DISTINCT FROM p_input_tokens
        AND invocation.output_tokens IS NOT DISTINCT FROM p_output_tokens
        AND invocation.cost_usd IS NOT DISTINCT FROM normalized_cost
        AND invocation.latency_ms = p_latency_ms
        AND invocation.error_code IS NOT DISTINCT FROM p_error_code
    ) THEN
      RETURN jsonb_build_object(
        'kind', 'finalized',
        'reservation', to_jsonb(reservation),
        'invocationId', reservation.analysis_invocation_id
      );
    END IF;
    RETURN jsonb_build_object(
      'kind', 'conflict',
      'reservation', to_jsonb(reservation)
    );
  END IF;

  IF reservation.status IS DISTINCT FROM 'reserved'
     OR NOT EXISTS (
       SELECT 1
       FROM app.product_profile_runs profile_run
       WHERE profile_run.id = p_run_id
         AND profile_run.workspace_id = p_workspace_id
         AND profile_run.project_id = p_project_id
         AND profile_run.prompt_input_hash = reservation.input_hash
     ) THEN
    RETURN jsonb_build_object(
      'kind', 'conflict',
      'reservation', to_jsonb(reservation)
    );
  END IF;

  INSERT INTO app.analysis_invocations (
    id,
    workspace_id,
    project_id,
    async_run_id,
    diagnostic_run_id,
    task,
    provider,
    model,
    prompt_set_version,
    input_hash,
    output_hash,
    status,
    input_tokens,
    output_tokens,
    cost_usd,
    latency_ms,
    error_code
  ) VALUES (
    reservation.planned_analysis_invocation_id,
    p_workspace_id,
    p_project_id,
    p_run_id,
    NULL,
    'product_profile_synthesis',
    p_provider,
    p_model,
    p_prompt_set_version,
    p_input_hash,
    p_output_hash,
    p_status,
    p_input_tokens,
    p_output_tokens,
    normalized_cost,
    p_latency_ms,
    p_error_code
  );

  UPDATE app.product_profile_invocation_attempts
  SET status = p_status,
      analysis_invocation_id = planned_analysis_invocation_id,
      terminal_error_code = p_error_code,
      provider_returned_at = clock_timestamp(),
      finalized_at = clock_timestamp()
  WHERE id = p_reservation_id
  RETURNING * INTO reservation;

  RETURN jsonb_build_object(
    'kind', 'finalized',
    'reservation', to_jsonb(reservation),
    'invocationId', reservation.analysis_invocation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.mark_product_profile_invocation_outcome_unknown(
  p_workspace_id uuid,
  p_project_id uuid,
  p_run_id uuid,
  p_async_attempt_count integer,
  p_reservation_id uuid,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  reservation app.product_profile_invocation_attempts%ROWTYPE;
BEGIN
  SELECT attempt.*
  INTO reservation
  FROM app.product_profile_invocation_attempts attempt
  WHERE attempt.id = p_reservation_id
    AND attempt.workspace_id = p_workspace_id
    AND attempt.project_id = p_project_id
    AND attempt.product_profile_run_id = p_run_id
    AND attempt.async_attempt_count = p_async_attempt_count
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_reservation');
  END IF;

  IF reservation.status IN ('succeeded','failed','rejected') THEN
    RETURN jsonb_build_object(
      'kind', 'finalized',
      'reservation', to_jsonb(reservation),
      'invocationId', reservation.analysis_invocation_id
    );
  END IF;

  IF p_error_code IS NULL
     OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$' THEN
    RETURN jsonb_build_object(
      'kind', 'conflict',
      'reservation', to_jsonb(reservation)
    );
  END IF;

  IF reservation.status = 'outcome_unknown' THEN
    IF reservation.terminal_error_code = p_error_code THEN
      RETURN jsonb_build_object(
        'kind', 'marked',
        'reservation', to_jsonb(reservation)
      );
    END IF;
    RETURN jsonb_build_object(
      'kind', 'conflict',
      'reservation', to_jsonb(reservation)
    );
  END IF;

  IF reservation.status IS DISTINCT FROM 'reserved' THEN
    RETURN jsonb_build_object(
      'kind', 'conflict',
      'reservation', to_jsonb(reservation)
    );
  END IF;

  UPDATE app.product_profile_invocation_attempts
  SET status = 'outcome_unknown',
      terminal_error_code = p_error_code,
      provider_returned_at = clock_timestamp(),
      finalized_at = clock_timestamp()
  WHERE id = p_reservation_id
  RETURNING * INTO reservation;

  RETURN jsonb_build_object(
    'kind', 'marked',
    'reservation', to_jsonb(reservation)
  );
END;
$$;

-- Validate every canonical evidence anchor of a versioned Product Profile in
-- one scoped database read. The Web service calls this function as a clean 422
-- preflight; the icp_profiles trigger calls the same function as the final,
-- authoritative insert guard.
CREATE OR REPLACE FUNCTION app.validate_product_profile_provenance(
  p_workspace_id uuid,
  p_project_id uuid,
  p_profile jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  issues jsonb := '[]'::jsonb;
  source_site_text text;
  source_snapshot_text text;
  analysis_invocation_text text;
  v_source_site_id uuid;
  v_source_snapshot_id uuid;
  v_analysis_invocation_id uuid;
  provenance_entry jsonb;
  evidence_refs jsonb;
  evidence_ref jsonb;
  ref_kind text;
  ref_id_text text;
  entry_index integer;
  ref_index integer;
  ref_path text;
  page_snapshot_snapshot_id uuid;
  page_snapshot_site_id uuid;
  observation_snapshot_id uuid;
BEGIN
  IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
     OR p_profile ->> 'profileSchemaVersion'
       IS DISTINCT FROM 'product-profile.0.3.0' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'issues', jsonb_build_array(jsonb_build_object(
        'code', 'unsupported_profile_schema',
        'path', '/profileSchemaVersion'
      ))
    );
  END IF;

  source_site_text := p_profile ->> 'sourceSiteId';
  source_snapshot_text := p_profile ->> 'sourceSnapshotId';
  analysis_invocation_text := p_profile ->> 'analysisInvocationId';

  IF source_site_text IS NULL
     OR source_site_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'source_site_missing',
      'path', '/sourceSiteId'
    ));
  ELSE
    v_source_site_id := source_site_text::uuid;
    IF NOT EXISTS (
      SELECT 1
      FROM app.sites site
      WHERE site.id = v_source_site_id
        AND site.workspace_id = p_workspace_id
        AND site.project_id = p_project_id
    ) THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'source_site_missing',
        'path', '/sourceSiteId'
      ));
    END IF;
  END IF;

  IF source_snapshot_text IS NOT NULL THEN
    IF source_snapshot_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'source_snapshot_missing',
        'path', '/sourceSnapshotId'
      ));
    ELSE
      v_source_snapshot_id := source_snapshot_text::uuid;
      IF v_source_site_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM app.data_snapshots snapshot
        WHERE snapshot.id = v_source_snapshot_id
          AND snapshot.workspace_id = p_workspace_id
          AND snapshot.project_id = p_project_id
          AND snapshot.site_id = v_source_site_id
      ) THEN
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'source_snapshot_site_mismatch',
          'path', '/sourceSnapshotId'
        ));
      END IF;
    END IF;
  END IF;

  IF analysis_invocation_text IS NOT NULL THEN
    IF analysis_invocation_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      issues := issues || jsonb_build_array(jsonb_build_object(
        'code', 'analysis_invocation_missing',
        'path', '/analysisInvocationId'
      ));
    ELSE
      v_analysis_invocation_id := analysis_invocation_text::uuid;
      IF NOT EXISTS (
        SELECT 1
        FROM app.analysis_invocations invocation
        JOIN app.product_profile_runs profile_run
          ON profile_run.id = invocation.async_run_id
         AND profile_run.workspace_id = p_workspace_id
         AND profile_run.project_id = p_project_id
         AND profile_run.site_id = v_source_site_id
         AND profile_run.source_snapshot_id = v_source_snapshot_id
         AND profile_run.prompt_input_hash = invocation.input_hash
        WHERE invocation.id = v_analysis_invocation_id
          AND invocation.workspace_id = p_workspace_id
          AND invocation.project_id = p_project_id
          AND invocation.task = 'product_profile_synthesis'
          AND invocation.status = 'succeeded'
          AND invocation.output_hash IS NOT NULL
          AND invocation.error_code IS NULL
      ) THEN
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'analysis_invocation_task_mismatch',
          'path', '/analysisInvocationId'
        ));
      END IF;
    END IF;
  END IF;

  IF ((source_snapshot_text IS NULL)::integer
      + (analysis_invocation_text IS NULL)::integer
      + ((p_profile ->> 'generatedAt') IS NULL)::integer) NOT IN (0, 3) THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'incomplete_synthesis_lineage',
      'path', '/sourceSnapshotId'
    ));
  END IF;

  IF jsonb_typeof(p_profile -> 'fieldProvenance') IS DISTINCT FROM 'array' THEN
    issues := issues || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_field_provenance',
      'path', '/fieldProvenance'
    ));
  ELSE
    FOR provenance_entry, entry_index IN
      SELECT value, (ordinality - 1)::integer
      FROM jsonb_array_elements(p_profile -> 'fieldProvenance')
        WITH ORDINALITY AS entries(value, ordinality)
    LOOP
      evidence_refs := provenance_entry -> 'evidenceRefs';
      IF jsonb_typeof(evidence_refs) IS DISTINCT FROM 'array' THEN
        issues := issues || jsonb_build_array(jsonb_build_object(
          'code', 'invalid_evidence_refs',
          'path', '/fieldProvenance/' || entry_index::text || '/evidenceRefs'
        ));
        CONTINUE;
      END IF;

      FOR evidence_ref, ref_index IN
        SELECT value, (ordinality - 1)::integer
        FROM jsonb_array_elements(evidence_refs)
          WITH ORDINALITY AS refs(value, ordinality)
      LOOP
        ref_kind := evidence_ref ->> 'kind';
        ref_path := '/fieldProvenance/' || entry_index::text
          || '/evidenceRefs/' || ref_index::text;

        IF ref_kind IN ('declaredHint','userEdit') THEN
          IF evidence_ref ?| ARRAY[
            'snapshotId',
            'pageSnapshotId',
            'observationId',
            'analysisInvocationId'
          ] THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'declared_reference_contains_canonical_id',
              'path', ref_path
            ));
          END IF;
          CONTINUE;
        END IF;

        IF ref_kind NOT IN (
          'snapshot',
          'pageSnapshot',
          'observation',
          'analysisInvocation'
        ) THEN
          issues := issues || jsonb_build_array(jsonb_build_object(
            'code', 'unsupported_evidence_reference',
            'path', ref_path
          ));
          CONTINUE;
        END IF;

        IF v_source_site_id IS NULL OR v_source_snapshot_id IS NULL THEN
          issues := issues || jsonb_build_array(jsonb_build_object(
            'code', 'canonical_lineage_missing',
            'path', ref_path,
            'refKind', ref_kind
          ));
          CONTINUE;
        END IF;

        IF ref_kind = 'snapshot' THEN
          ref_id_text := evidence_ref ->> 'snapshotId';
          IF ref_id_text IS NULL OR ref_id_text IS DISTINCT FROM source_snapshot_text THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'snapshot_reference_mismatch',
              'path', ref_path || '/snapshotId',
              'refKind', ref_kind,
              'refId', ref_id_text
            ));
          END IF;
        ELSIF ref_kind = 'pageSnapshot' THEN
          ref_id_text := evidence_ref ->> 'pageSnapshotId';
          IF ref_id_text IS NULL
             OR ref_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'page_snapshot_missing',
              'path', ref_path || '/pageSnapshotId',
              'refKind', ref_kind,
              'refId', ref_id_text
            ));
          ELSE
            SELECT page_snapshot.data_snapshot_id, site_page.site_id
            INTO page_snapshot_snapshot_id, page_snapshot_site_id
            FROM app.page_snapshots page_snapshot
            JOIN app.site_pages site_page
              ON site_page.id = page_snapshot.site_page_id
             AND site_page.workspace_id = p_workspace_id
             AND site_page.project_id = p_project_id
            WHERE page_snapshot.id = ref_id_text::uuid
              AND page_snapshot.workspace_id = p_workspace_id
              AND page_snapshot.project_id = p_project_id;

            IF NOT FOUND THEN
              issues := issues || jsonb_build_array(jsonb_build_object(
                'code', 'page_snapshot_missing',
                'path', ref_path || '/pageSnapshotId',
                'refKind', ref_kind,
                'refId', ref_id_text
              ));
            ELSE
              IF page_snapshot_snapshot_id IS DISTINCT FROM v_source_snapshot_id THEN
                issues := issues || jsonb_build_array(jsonb_build_object(
                  'code', 'page_snapshot_snapshot_mismatch',
                  'path', ref_path || '/pageSnapshotId',
                  'refKind', ref_kind,
                  'refId', ref_id_text
                ));
              END IF;
              IF page_snapshot_site_id IS DISTINCT FROM v_source_site_id THEN
                issues := issues || jsonb_build_array(jsonb_build_object(
                  'code', 'page_snapshot_site_mismatch',
                  'path', ref_path || '/pageSnapshotId',
                  'refKind', ref_kind,
                  'refId', ref_id_text
                ));
              END IF;
            END IF;
          END IF;
        ELSIF ref_kind = 'observation' THEN
          ref_id_text := evidence_ref ->> 'observationId';
          IF ref_id_text IS NULL
             OR ref_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'observation_missing',
              'path', ref_path || '/observationId',
              'refKind', ref_kind,
              'refId', ref_id_text
            ));
          ELSE
            SELECT observation.snapshot_id
            INTO observation_snapshot_id
            FROM app.normalized_observations observation
            WHERE observation.id = ref_id_text::uuid
              AND observation.workspace_id = p_workspace_id
              AND observation.project_id = p_project_id;

            IF NOT FOUND THEN
              issues := issues || jsonb_build_array(jsonb_build_object(
                'code', 'observation_missing',
                'path', ref_path || '/observationId',
                'refKind', ref_kind,
                'refId', ref_id_text
              ));
            ELSIF observation_snapshot_id IS DISTINCT FROM v_source_snapshot_id THEN
              issues := issues || jsonb_build_array(jsonb_build_object(
                'code', 'observation_snapshot_mismatch',
                'path', ref_path || '/observationId',
                'refKind', ref_kind,
                'refId', ref_id_text
              ));
            END IF;
          END IF;
        ELSE
          ref_id_text := evidence_ref ->> 'analysisInvocationId';
          IF v_analysis_invocation_id IS NULL
             OR ref_id_text IS NULL
             OR ref_id_text IS DISTINCT FROM analysis_invocation_text THEN
            issues := issues || jsonb_build_array(jsonb_build_object(
              'code', 'analysis_invocation_reference_mismatch',
              'path', ref_path || '/analysisInvocationId',
              'refKind', ref_kind,
              'refId', ref_id_text
            ));
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(issues) = 0,
    'issues', issues
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_icp_profile_product_profile_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  validation jsonb;
BEGIN
  IF NEW.profile ->> 'profileSchemaVersion'
     IS DISTINCT FROM 'product-profile.0.3.0' THEN
    RETURN NEW;
  END IF;

  validation := app.validate_product_profile_provenance(
    NEW.workspace_id,
    NEW.project_id,
    NEW.profile
  );
  IF validation ->> 'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Product Profile provenance is invalid'
      USING ERRCODE = '23514', DETAIL = validation::text;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS icp_profiles_product_profile_provenance_guard
  ON app.icp_profiles;
CREATE TRIGGER icp_profiles_product_profile_provenance_guard
  BEFORE INSERT ON app.icp_profiles
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_icp_profile_product_profile_provenance();

-- Re-derive every duplicated scope and frozen source from canonical immutable
-- parents. The manifest is intentionally not re-hashed in PostgreSQL: it is JCS
-- addressed by the repository, while SQL freezes the retained object/hash pair
-- and binds its canonical identifiers to first-class columns.
CREATE OR REPLACE FUNCTION app.enforce_product_profile_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.result_icp_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'product profile run must be inserted as an unfinished placeholder'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW.input_manifest) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'product profile run manifest must be an object'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
    JOIN app.icp_profiles base_profile
      ON base_profile.id = NEW.base_icp_profile_id
     AND base_profile.workspace_id = NEW.workspace_id
     AND base_profile.project_id = NEW.project_id
     AND base_profile.version = NEW.base_icp_profile_version
     AND base_profile.content_hash = NEW.base_icp_profile_content_hash
    JOIN app.data_snapshots source_snapshot
      ON source_snapshot.id = NEW.source_snapshot_id
     AND source_snapshot.workspace_id = NEW.workspace_id
     AND source_snapshot.project_id = NEW.project_id
     AND source_snapshot.site_id = NEW.site_id
     AND source_snapshot.provider = 'crawl'
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'product_profile_synthesis'
      AND NEW.input_manifest ->> 'projectId' = NEW.project_id::text
      AND NEW.input_manifest ->> 'siteId' = NEW.site_id::text
      AND NEW.input_manifest #>> '{baseProfile,id}' = base_profile.id::text
      AND NEW.input_manifest #>> '{baseProfile,version}' = base_profile.version::text
      AND NEW.input_manifest #>> '{baseProfile,contentHash}' = base_profile.content_hash
      AND NEW.input_manifest #>> '{baseProfile,status}' = base_profile.status
      AND NEW.input_manifest #>> '{crawlSnapshot,id}' = source_snapshot.id::text
  ) THEN
    RAISE EXCEPTION 'product profile run provenance does not match its canonical inputs'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.result_icp_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.icp_profiles result_profile
    JOIN app.analysis_invocations invocation
      ON invocation.id::text = result_profile.profile ->> 'analysisInvocationId'
     AND invocation.workspace_id = NEW.workspace_id
     AND invocation.project_id = NEW.project_id
     AND invocation.async_run_id = NEW.id
     AND invocation.diagnostic_run_id IS NULL
     AND invocation.task = 'product_profile_synthesis'
     AND invocation.status = 'succeeded'
     AND invocation.prompt_set_version = NEW.prompt_set_version
     AND NEW.prompt_input_hash IS NOT NULL
     AND invocation.input_hash = NEW.prompt_input_hash
     AND invocation.output_hash IS NOT NULL
    WHERE result_profile.id = NEW.result_icp_profile_id
      AND result_profile.workspace_id = NEW.workspace_id
      AND result_profile.project_id = NEW.project_id
      AND result_profile.status = 'draft'
      AND result_profile.profile ->> 'sourceSiteId' = NEW.site_id::text
      AND result_profile.profile ->> 'sourceSnapshotId' = NEW.source_snapshot_id::text
      AND result_profile.profile ->> 'sourceSnapshotId' =
        NEW.input_manifest #>> '{crawlSnapshot,id}'
      AND result_profile.profile ->> 'sourcePageUrl' =
        NEW.input_manifest ->> 'sourcePageUrl'
  ) THEN
    RAISE EXCEPTION 'product profile run result lacks successful immutable synthesis lineage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_product_profile_run_frozen_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'product profile run frozen input is append-only'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.base_icp_profile_id IS DISTINCT FROM OLD.base_icp_profile_id
     OR NEW.base_icp_profile_version IS DISTINCT FROM OLD.base_icp_profile_version
     OR NEW.base_icp_profile_content_hash IS DISTINCT FROM OLD.base_icp_profile_content_hash
     OR NEW.source_snapshot_id IS DISTINCT FROM OLD.source_snapshot_id
     OR NEW.synthesis_version IS DISTINCT FROM OLD.synthesis_version
     OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
     OR NEW.input_manifest IS DISTINCT FROM OLD.input_manifest
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'product profile run frozen input is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.result_icp_profile_id IS NOT NULL
     AND NEW.result_icp_profile_id IS DISTINCT FROM OLD.result_icp_profile_id THEN
    RAISE EXCEPTION 'product profile run result is immutable once set'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.prompt_input_hash IS NOT NULL
     AND NEW.prompt_input_hash IS DISTINCT FROM OLD.prompt_input_hash THEN
    RAISE EXCEPTION 'product profile run prompt input hash is immutable once set'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_profile_runs_provenance_guard
  ON app.product_profile_runs;
CREATE TRIGGER product_profile_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.product_profile_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_product_profile_run_provenance();

DROP TRIGGER IF EXISTS product_profile_runs_frozen_input_guard
  ON app.product_profile_runs;
CREATE TRIGGER product_profile_runs_frozen_input_guard
  BEFORE UPDATE OR DELETE ON app.product_profile_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_product_profile_run_frozen_input();

-- The generic AsyncRun result columns are a projection of the canonical
-- Product Profile run ledger, not an independently writable reference. Product
-- Profile synthesis has no meaningful partial result: it either produces one
-- traceable draft, or terminates without a result.
CREATE OR REPLACE FUNCTION app.enforce_product_profile_async_result_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.kind = 'product_profile_synthesis'
     AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'product profile synthesis async run kind is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind IS DISTINCT FROM 'product_profile_synthesis' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'partial' THEN
    RAISE EXCEPTION 'product profile synthesis does not support partial results'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'completed' THEN
    IF NEW.result_type IS DISTINCT FROM 'icp_profile'
       OR NEW.result_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM app.product_profile_runs profile_run
         WHERE profile_run.id = NEW.id
           AND profile_run.workspace_id = NEW.workspace_id
           AND profile_run.project_id = NEW.project_id
           AND profile_run.result_icp_profile_id = NEW.result_id
       ) THEN
      RAISE EXCEPTION 'completed product profile synthesis result must match its run ledger'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.result_type IS NOT NULL OR NEW.result_id IS NOT NULL THEN
    RAISE EXCEPTION 'non-completed product profile synthesis cannot carry a result'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS async_runs_product_profile_result_guard
  ON app.async_runs;
CREATE TRIGGER async_runs_product_profile_result_guard
  BEFORE INSERT OR UPDATE ON app.async_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_product_profile_async_result_provenance();

-- Browser roles never receive direct table access; all reads and writes pass
-- through scoped server repositories.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.product_profile_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.product_profile_invocation_attempts FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.product_profile_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.product_profile_invocation_attempts FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0014_product_profile_synthesis'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0014_product_profile_synthesis.sql

-- BEGIN EXACT ORDERED MIGRATION 0015_frozen_crawl_seed.sql
BEGIN;

-- A URL-first Product Profile may name a deep product page. Freeze that exact
-- SitePage identity when the Crawl command is accepted so a later profile edit
-- cannot silently change what the already-queued run will fetch.
ALTER TABLE app.collection_runs
  ADD COLUMN IF NOT EXISTS crawl_seed_site_page_id uuid,
  ADD COLUMN IF NOT EXISTS crawl_seed_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_runs_crawl_seed_site_page_fk'
      AND conrelid = 'app.collection_runs'::regclass
  ) THEN
    ALTER TABLE app.collection_runs
      ADD CONSTRAINT collection_runs_crawl_seed_site_page_fk
      FOREIGN KEY (crawl_seed_site_page_id)
      REFERENCES app.site_pages(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_runs_crawl_seed_pair_check'
      AND conrelid = 'app.collection_runs'::regclass
  ) THEN
    ALTER TABLE app.collection_runs
      ADD CONSTRAINT collection_runs_crawl_seed_pair_check
      CHECK (
        (crawl_seed_site_page_id IS NULL) = (crawl_seed_url IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_runs_crawl_seed_provider_check'
      AND conrelid = 'app.collection_runs'::regclass
  ) THEN
    ALTER TABLE app.collection_runs
      ADD CONSTRAINT collection_runs_crawl_seed_provider_check
      CHECK (crawl_seed_site_page_id IS NULL OR provider = 'crawl');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_runs_crawl_seed_url_check'
      AND conrelid = 'app.collection_runs'::regclass
  ) THEN
    ALTER TABLE app.collection_runs
      ADD CONSTRAINT collection_runs_crawl_seed_url_check
      CHECK (
        crawl_seed_url IS NULL
        OR length(crawl_seed_url) BETWEEN 1 AND 2048
      );
  END IF;
END;
$$;

-- Retain the full CollectionRun provenance contract while adding the frozen
-- seed pair. The seed must resolve to one exact, canonical SitePage row in the
-- same workspace/project/Site, including the exact UTF-8 URL hash.
CREATE OR REPLACE FUNCTION app.enforce_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'collection run must be inserted as an unfinished placeholder'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.source_connection_id IS DISTINCT FROM OLD.source_connection_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.method_version IS DISTINCT FROM OLD.method_version
    OR NEW.parameters_hash IS DISTINCT FROM OLD.parameters_hash
    OR NEW.import_preview_id IS DISTINCT FROM OLD.import_preview_id
    OR NEW.crawl_seed_site_page_id IS DISTINCT FROM OLD.crawl_seed_site_page_id
    OR NEW.crawl_seed_url IS DISTINCT FROM OLD.crawl_seed_url
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'collection run source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'collection run outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.provider = NEW.provider
        AND snapshot.method_version = NEW.method_version
        AND snapshot.source_connection_id IS NOT DISTINCT FROM NEW.source_connection_id
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
    ) THEN
      RAISE EXCEPTION 'collection run outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.operation = 'site_graph')
    OR (NEW.provider = 'gsc' AND NEW.operation = 'search_analytics')
    OR (NEW.provider = 'ga4' AND NEW.operation = 'organic_landing')
    OR (NEW.provider IN ('csv','dataforseo') AND NEW.operation = 'keyword_gap_import')
  ) THEN
    RAISE EXCEPTION 'collection run operation does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider <> 'csv' AND NEW.source_connection_id IS NULL THEN
    RAISE EXCEPTION 'collection run provider requires a canonical source connection'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider <> 'csv' AND NEW.import_preview_id IS NOT NULL THEN
    RAISE EXCEPTION 'only CSV collection runs may reference an import preview'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'collection'
  ) THEN
    RAISE EXCEPTION 'collection run scope does not match its async run and site'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.source_connections source
    WHERE source.id = NEW.source_connection_id
      AND source.workspace_id = NEW.workspace_id
      AND source.project_id = NEW.project_id
      AND source.site_id = NEW.site_id
      AND source.provider = NEW.provider
  ) THEN
    RAISE EXCEPTION 'collection run source connection provenance is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.import_preview_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.import_previews preview
    WHERE preview.id = NEW.import_preview_id
      AND preview.workspace_id = NEW.workspace_id
      AND preview.project_id = NEW.project_id
      AND preview.site_id = NEW.site_id
      AND preview.template_id = 'keyword_gap_v1'
  ) THEN
    RAISE EXCEPTION 'collection run import preview provenance is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.crawl_seed_site_page_id IS NULL)
     IS DISTINCT FROM (NEW.crawl_seed_url IS NULL) THEN
    RAISE EXCEPTION 'collection run Crawl seed id and URL must be present together'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.crawl_seed_site_page_id IS NOT NULL THEN
    IF NEW.provider <> 'crawl' THEN
      RAISE EXCEPTION 'only Crawl collection runs may reference a seed SitePage'
        USING ERRCODE = '23514';
    END IF;

    IF length(NEW.crawl_seed_url) NOT BETWEEN 1 AND 2048 THEN
      RAISE EXCEPTION 'collection run Crawl seed URL is outside the supported bound'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app.site_pages page
      WHERE page.id = NEW.crawl_seed_site_page_id
        AND page.workspace_id = NEW.workspace_id
        AND page.project_id = NEW.project_id
        AND page.site_id = NEW.site_id
        AND page.normalized_url = NEW.crawl_seed_url
        AND page.normalized_url_hash = encode(
          digest(convert_to(NEW.crawl_seed_url, 'UTF8'), 'sha256'),
          'hex'
        )
    ) THEN
      RAISE EXCEPTION 'collection run Crawl seed does not match its exact SitePage identity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_runs_provenance_guard ON app.collection_runs;
CREATE TRIGGER collection_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_collection_run_provenance();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0015_frozen_crawl_seed'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0015_frozen_crawl_seed.sql

-- BEGIN EXACT ORDERED MIGRATION 0016_observation_site_page_lineage.sql
BEGIN;

-- URL observations keep their aggregation subject_ref, while this nullable
-- foreign key records the exact SitePage selected by the collection commit.
-- A null remains meaningful: historical evidence may be unavailable, and a
-- canonical GSC/GA4 subject may correspond to multiple exact fetch variants.
ALTER TABLE app.normalized_observations
  ADD COLUMN IF NOT EXISTS site_page_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'normalized_observations_site_page_fk'
      AND conrelid = 'app.normalized_observations'::regclass
  ) THEN
    ALTER TABLE app.normalized_observations
      ADD CONSTRAINT normalized_observations_site_page_fk
      FOREIGN KEY (site_page_id)
      REFERENCES app.site_pages(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'normalized_observations_site_page_subject_check'
      AND conrelid = 'app.normalized_observations'::regclass
  ) THEN
    ALTER TABLE app.normalized_observations
      ADD CONSTRAINT normalized_observations_site_page_subject_check
      CHECK (site_page_id IS NULL OR subject_type = 'url');
  END IF;
END;
$$;

-- SitePage can also be created by Product Profile and future URL-first flows.
-- Put every writer on the same canonical-subject transaction lock as analytics
-- resolution, so `/path` cannot race `/path/` between the candidate read and
-- the append-only Observation insert.
CREATE OR REPLACE FUNCTION app.lock_site_page_canonical_subjects(
  workspace_id uuid,
  project_id uuid,
  site_id uuid,
  subject_refs text[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  canonical_subject text;
BEGIN
  IF workspace_id IS NULL OR project_id IS NULL OR site_id IS NULL THEN
    RAISE EXCEPTION 'canonical subject lock requires complete project Site scope'
      USING ERRCODE = '22023';
  END IF;
  IF subject_refs IS NULL OR cardinality(subject_refs) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'canonical subject lock requires 1 to 500 subjects'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(subject_refs) AS candidate(subject_ref)
    WHERE candidate.subject_ref IS NULL
      OR length(candidate.subject_ref) NOT BETWEEN 1 AND 2048
  ) THEN
    RAISE EXCEPTION 'canonical subjects must contain 1 to 2048 characters'
      USING ERRCODE = '22023';
  END IF;

  -- A PL/pgSQL loop makes acquisition order an execution guarantee. A target-
  -- list function under SQL ORDER BY may be evaluated before the sort.
  FOR canonical_subject IN
    SELECT DISTINCT candidate.subject_ref
    FROM unnest(subject_refs) AS candidate(subject_ref)
    ORDER BY candidate.subject_ref
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      workspace_id::text || ':' ||
      project_id::text || ':' ||
      site_id::text || ':' ||
      canonical_subject,
      5704921::bigint
    ));
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION app.lock_site_page_canonical_subject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base_url text;
  query_suffix text;
  canonical_subject text;
BEGIN
  base_url := split_part(NEW.normalized_url, '?', 1);
  query_suffix := CASE
    WHEN strpos(NEW.normalized_url, '?') = 0 THEN ''
    ELSE substring(NEW.normalized_url FROM strpos(NEW.normalized_url, '?'))
  END;
  canonical_subject := CASE
    WHEN base_url ~ '^https?://[^/]+/$' THEN NEW.normalized_url
    WHEN right(base_url, 1) = '/'
      THEN left(base_url, length(base_url) - 1) || query_suffix
    ELSE NEW.normalized_url
  END;

  PERFORM app.lock_site_page_canonical_subjects(
    NEW.workspace_id,
    NEW.project_id,
    NEW.site_id,
    ARRAY[canonical_subject]
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_pages_canonical_subject_lock ON app.site_pages;
CREATE TRIGGER site_pages_canonical_subject_lock
  BEFORE INSERT ON app.site_pages
  FOR EACH ROW
  EXECUTE FUNCTION app.lock_site_page_canonical_subject();

-- Re-derive duplicated scope from canonical rows. Crawl observations additionally
-- prove the exact HTTP fact through value_json.fetchUrl. GSC/GA4 observations
-- may bind only to the exact or trailing-slash fetch variant of subject_ref.
CREATE OR REPLACE FUNCTION app.enforce_normalized_observation_site_page_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  page_normalized_url text;
  snapshot_site_id uuid;
  base_url text;
  query_suffix text;
  canonical_subject text;
  slash_variant text;
  candidate_count integer;
  is_analytics_page boolean;
BEGIN
  is_analytics_page := (
    (NEW.provider = 'gsc' AND NEW.metric_key = 'gsc.page.v1')
    OR (NEW.provider = 'ga4' AND NEW.metric_key = 'ga4.landing.v1')
  );

  IF is_analytics_page THEN
    IF NEW.subject_type <> 'url' THEN
      RAISE EXCEPTION 'analytics page observation requires a URL subject'
        USING ERRCODE = '23514';
    END IF;

    SELECT snapshot.site_id
    INTO snapshot_site_id
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id;
    IF snapshot_site_id IS NULL THEN
      RAISE EXCEPTION 'analytics observation snapshot does not match its project scope'
        USING ERRCODE = '23514';
    END IF;

    -- This is intentionally byte-for-byte equivalent to the SitePage INSERT
    -- trigger's canonical-subject derivation and lock key. Direct SQL writers
    -- therefore cannot race this cardinality proof with a slash-variant page.
    base_url := split_part(NEW.subject_ref, '?', 1);
    query_suffix := CASE
      WHEN strpos(NEW.subject_ref, '?') = 0 THEN ''
      ELSE substring(NEW.subject_ref FROM strpos(NEW.subject_ref, '?'))
    END;
    canonical_subject := CASE
      WHEN base_url ~ '^https?://[^/]+/$' THEN NEW.subject_ref
      WHEN right(base_url, 1) = '/'
        THEN left(base_url, length(base_url) - 1) || query_suffix
      ELSE NEW.subject_ref
    END;

    PERFORM app.lock_site_page_canonical_subjects(
      NEW.workspace_id,
      NEW.project_id,
      snapshot_site_id,
      ARRAY[canonical_subject]
    );

    slash_variant := CASE
      WHEN base_url ~ '^https?://[^/]+/$' THEN NULL
      WHEN strpos(canonical_subject, '?') = 0 THEN canonical_subject || '/'
      ELSE left(canonical_subject, strpos(canonical_subject, '?') - 1)
        || '/'
        || substring(canonical_subject FROM strpos(canonical_subject, '?'))
    END;

    SELECT count(*)
    INTO candidate_count
    FROM app.site_pages page
    WHERE page.workspace_id = NEW.workspace_id
      AND page.project_id = NEW.project_id
      AND page.site_id = snapshot_site_id
      AND (
        page.normalized_url = canonical_subject
        OR page.normalized_url = slash_variant
      );
  END IF;

  IF NEW.site_page_id IS NULL THEN
    IF TG_OP = 'INSERT'
       AND NEW.provider = 'crawl'
       AND NEW.metric_key = 'crawl.page.v1' THEN
      RAISE EXCEPTION 'Crawl page observation requires an exact SitePage lineage'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' AND is_analytics_page THEN
      IF candidate_count <= 1 THEN
        RAISE EXCEPTION 'analytics URL observation requires its unambiguous SitePage lineage'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.subject_type <> 'url' THEN
    RAISE EXCEPTION 'only URL observations may reference a SitePage'
      USING ERRCODE = '23514';
  END IF;

  SELECT page.normalized_url
  INTO page_normalized_url
  FROM app.site_pages page
  JOIN app.data_snapshots snapshot
    ON snapshot.id = NEW.snapshot_id
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
  WHERE page.id = NEW.site_page_id
    AND page.workspace_id = NEW.workspace_id
    AND page.project_id = NEW.project_id
    AND page.site_id = snapshot.site_id;

  IF page_normalized_url IS NULL THEN
    RAISE EXCEPTION 'observation SitePage does not match its snapshot Site scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider = 'crawl' AND NEW.metric_key = 'crawl.page.v1' THEN
    IF NEW.value_json ->> 'fetchUrl' IS DISTINCT FROM page_normalized_url THEN
      RAISE EXCEPTION 'Crawl observation does not match its exact fetch SitePage'
        USING ERRCODE = '23514';
    END IF;
    base_url := split_part(page_normalized_url, '?', 1);
    query_suffix := CASE
      WHEN strpos(page_normalized_url, '?') = 0 THEN ''
      ELSE substring(page_normalized_url FROM strpos(page_normalized_url, '?'))
    END;
    canonical_subject := CASE
      WHEN base_url ~ '^https?://[^/]+/$' THEN page_normalized_url
      WHEN right(base_url, 1) = '/'
        THEN left(base_url, length(base_url) - 1) || query_suffix
      ELSE page_normalized_url
    END;
    IF NEW.subject_ref IS DISTINCT FROM canonical_subject THEN
      RAISE EXCEPTION 'Crawl observation subject does not match its canonical fetch identity'
        USING ERRCODE = '23514';
    END IF;
  ELSIF is_analytics_page THEN
    IF page_normalized_url IS DISTINCT FROM canonical_subject
       AND page_normalized_url IS DISTINCT FROM slash_variant THEN
      RAISE EXCEPTION 'analytics observation SitePage is not a canonical exact variant'
        USING ERRCODE = '23514';
    END IF;
    IF candidate_count <> 1 THEN
      RAISE EXCEPTION 'analytics observation SitePage lineage is ambiguous'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalized_observations_site_page_guard
  ON app.normalized_observations;
CREATE TRIGGER normalized_observations_site_page_guard
  BEFORE INSERT OR UPDATE OF site_page_id ON app.normalized_observations
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_normalized_observation_site_page_lineage();

-- Migration-only provenance enrichment. The immutable provider facts and their
-- aggregation subject_ref are untouched. The append-only trigger is restored
-- before this transaction commits, so application writes remain insert-only.
DROP TRIGGER IF EXISTS normalized_observations_append_only
  ON app.normalized_observations;

-- Crawl carries the exact fetch URL in its immutable projection. Match exact
-- bytes and the snapshot's Site; anything absent or inconsistent stays null.
WITH crawl_candidates AS (
  SELECT
    observation.id AS observation_id,
    page.id AS site_page_id,
    observation.subject_ref,
    page.normalized_url,
    split_part(page.normalized_url, '?', 1) AS base_url,
    CASE
      WHEN strpos(page.normalized_url, '?') = 0 THEN ''
      ELSE substring(page.normalized_url FROM strpos(page.normalized_url, '?'))
    END AS query_suffix
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = observation.workspace_id
   AND snapshot.project_id = observation.project_id
   AND snapshot.provider = observation.provider
  JOIN app.site_pages page
    ON page.workspace_id = observation.workspace_id
   AND page.project_id = observation.project_id
   AND page.site_id = snapshot.site_id
   AND page.normalized_url = observation.value_json ->> 'fetchUrl'
  WHERE observation.site_page_id IS NULL
    AND observation.provider = 'crawl'
    AND observation.metric_key = 'crawl.page.v1'
    AND observation.subject_type = 'url'
    AND jsonb_typeof(observation.value_json) = 'object'
), exact_crawl_lineage AS (
  SELECT candidate.observation_id, candidate.site_page_id
  FROM crawl_candidates candidate
  WHERE candidate.subject_ref = CASE
    WHEN candidate.base_url ~ '^https?://[^/]+/$'
      THEN candidate.normalized_url
    WHEN right(candidate.base_url, 1) = '/'
      THEN left(candidate.base_url, length(candidate.base_url) - 1)
        || candidate.query_suffix
    ELSE candidate.normalized_url
  END
)
UPDATE app.normalized_observations observation
SET site_page_id = lineage.site_page_id
FROM exact_crawl_lineage lineage
WHERE observation.id = lineage.observation_id;

-- Analytics subject_ref is an aggregation key. Build its only two possible
-- exact fetch identities (one for a root subject), then link only a cardinality
-- of exactly one. A count of zero or more than one is deliberately left null.
WITH analytics_inputs AS (
  SELECT
    observation.id AS observation_id,
    observation.workspace_id,
    observation.project_id,
    snapshot.site_id,
    observation.subject_ref,
    split_part(observation.subject_ref, '?', 1) AS base_url,
    CASE
      WHEN strpos(observation.subject_ref, '?') = 0 THEN ''
      ELSE substring(
        observation.subject_ref FROM strpos(observation.subject_ref, '?')
      )
    END AS query_suffix
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = observation.workspace_id
   AND snapshot.project_id = observation.project_id
   AND snapshot.provider = observation.provider
  WHERE observation.site_page_id IS NULL
    AND observation.subject_type = 'url'
    AND (
      (observation.provider = 'gsc' AND observation.metric_key = 'gsc.page.v1')
      OR (
        observation.provider = 'ga4'
        AND observation.metric_key = 'ga4.landing.v1'
      )
    )
), analytics_subjects AS (
  SELECT
    input.*,
    CASE
      WHEN input.base_url ~ '^https?://[^/]+/$' THEN input.subject_ref
      WHEN right(input.base_url, 1) = '/'
        THEN left(input.base_url, length(input.base_url) - 1)
          || input.query_suffix
      ELSE input.subject_ref
    END AS canonical_subject
  FROM analytics_inputs input
), analytics_variants AS (
  SELECT
    subject.*,
    CASE
      WHEN subject.base_url ~ '^https?://[^/]+/$' THEN NULL
      WHEN strpos(subject.canonical_subject, '?') = 0
        THEN subject.canonical_subject || '/'
      ELSE left(
        subject.canonical_subject,
        strpos(subject.canonical_subject, '?') - 1
      ) || '/' || substring(
        subject.canonical_subject
        FROM strpos(subject.canonical_subject, '?')
      )
    END AS slash_variant
  FROM analytics_subjects subject
), analytics_candidates AS (
  SELECT subject.observation_id, page.id AS site_page_id
  FROM analytics_variants subject
  JOIN app.site_pages page
    ON page.workspace_id = subject.workspace_id
   AND page.project_id = subject.project_id
   AND page.site_id = subject.site_id
   AND (
     page.normalized_url = subject.canonical_subject
     OR page.normalized_url = subject.slash_variant
   )
), unique_analytics_lineage AS (
  SELECT
    observation_id,
    max(site_page_id::text)::uuid AS site_page_id
  FROM analytics_candidates
  GROUP BY observation_id
  HAVING count(*) = 1
)
UPDATE app.normalized_observations observation
SET site_page_id = lineage.site_page_id
FROM unique_analytics_lineage lineage
WHERE observation.id = lineage.observation_id;

CREATE TRIGGER normalized_observations_append_only
  BEFORE UPDATE OR DELETE ON app.normalized_observations
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE INDEX IF NOT EXISTS normalized_observations_site_page_metric_idx
  ON app.normalized_observations(
    project_id,
    site_page_id,
    metric_key,
    observed_at DESC,
    id DESC
  )
  WHERE site_page_id IS NOT NULL;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0016_observation_site_page_lineage'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0016_observation_site_page_lineage.sql

-- BEGIN EXACT ORDERED MIGRATION 0017_finding_target_ledger.sql
BEGIN;

-- Per-run target membership is an immutable fact, separate from the mutable
-- cross-run Finding projection. Historical Findings are intentionally not
-- backfilled: deriving page membership from current subject_refs would invent
-- lineage. A historical run without rows remains explicitly unavailable.
CREATE TABLE IF NOT EXISTS app.finding_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  finding_id uuid NOT NULL
    REFERENCES app.findings(id) ON DELETE RESTRICT,
  diagnostic_run_id uuid NOT NULL
    REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  relation text NOT NULL CHECK (relation IN (
    'direct_url',
    'affected_by_template',
    'affected_by_site',
    'affected_by_page_set',
    'affected_by_http_status',
    'affected_by_canonical_issue',
    'affected_by_keyword_cluster',
    'affected_by_user_agent'
  )),
  target_kind text NOT NULL CHECK (target_kind IN (
    'url',
    'template',
    'site',
    'page_set',
    'http_status',
    'canonical_issue',
    'keyword_cluster',
    'user_agent'
  )),
  target_ref text NOT NULL,
  resolution_state text NOT NULL CHECK (resolution_state IN (
    'resolved','unresolved','definition_only'
  )),
  basis_kind text NOT NULL CHECK (basis_kind IN (
    'crawl_exact_fetch',
    'observation_site_page',
    'unresolved_observation',
    'target_definition'
  )),
  site_page_id uuid
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  page_snapshot_id uuid
    REFERENCES app.page_snapshots(id) ON DELETE RESTRICT,
  source_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  member_ref text,
  limitation text,
  -- The BEFORE INSERT guard always replaces this placeholder with a hash of
  -- the complete semantic tuple. The default lets writers omit a derived key.
  relation_key text NOT NULL DEFAULT repeat('0', 64)
    CHECK (relation_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (relation = 'direct_url' AND target_kind = 'url')
    OR (relation = 'affected_by_template' AND target_kind = 'template')
    OR (relation = 'affected_by_site' AND target_kind = 'site')
    OR (relation = 'affected_by_page_set' AND target_kind = 'page_set')
    OR (
      relation = 'affected_by_http_status'
      AND target_kind = 'http_status'
    )
    OR (
      relation = 'affected_by_canonical_issue'
      AND target_kind = 'canonical_issue'
    )
    OR (
      relation = 'affected_by_keyword_cluster'
      AND target_kind = 'keyword_cluster'
    )
    OR (
      relation = 'affected_by_user_agent'
      AND target_kind = 'user_agent'
    )
  ),
  CHECK (
    length(target_ref) BETWEEN 1 AND
      CASE WHEN target_kind = 'url' THEN 2048 ELSE 500 END
    AND target_ref = btrim(target_ref)
  ),
  CHECK (
    member_ref IS NULL
    OR (
      length(member_ref) BETWEEN 1 AND 2048
      AND member_ref = btrim(member_ref)
    )
  ),
  CHECK (
    limitation IS NULL
    OR (
      length(limitation) BETWEEN 1 AND 2000
      AND limitation = btrim(limitation)
    )
  ),
  CHECK (resolution_state <> 'resolved' OR limitation IS NULL),
  CHECK (
    target_kind <> 'http_status'
    OR target_ref ~ '^[1-5][0-9]{2}$'
  ),
  CHECK (
    target_kind <> 'canonical_issue'
    OR target_ref IN (
      'reciprocal','broken_target','sitemap_contradiction'
    )
  ),
  UNIQUE (finding_id, diagnostic_run_id, relation_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS finding_targets_one_direct_root_idx
  ON app.finding_targets(finding_id, diagnostic_run_id)
  WHERE relation = 'direct_url';

CREATE UNIQUE INDEX IF NOT EXISTS finding_targets_one_definition_root_idx
  ON app.finding_targets(finding_id, diagnostic_run_id)
  WHERE resolution_state = 'definition_only';

CREATE UNIQUE INDEX IF NOT EXISTS finding_targets_one_observation_member_idx
  ON app.finding_targets(
    finding_id,
    diagnostic_run_id,
    source_observation_id
  )
  WHERE source_observation_id IS NOT NULL;

-- jsonb has a deterministic canonical text representation for this bounded
-- all-string/null tuple. Hashing it in the database keeps every writer on one
-- identity implementation and includes nullable provenance anchors explicitly.
CREATE OR REPLACE FUNCTION app.finding_target_relation_key(
  selected_relation text,
  selected_target_kind text,
  selected_target_ref text,
  selected_resolution_state text,
  selected_basis_kind text,
  selected_site_page_id uuid,
  selected_page_snapshot_id uuid,
  selected_source_observation_id uuid,
  selected_member_ref text,
  selected_limitation text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      convert_to(
        jsonb_build_object(
          'relation', selected_relation,
          'targetKind', selected_target_kind,
          'targetRef', selected_target_ref,
          'resolutionState', selected_resolution_state,
          'basisKind', selected_basis_kind,
          'sitePageId', selected_site_page_id,
          'pageSnapshotId', selected_page_snapshot_id,
          'sourceObservationId', selected_source_observation_id,
          'memberRef', selected_member_ref,
          'limitation', selected_limitation
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION app.enforce_finding_target_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  finding_last_seen_run_id uuid;
  finding_rule_id text;
  expected_relation text;
  diagnostic_site_id uuid;
  observation_provider text;
  observation_metric_key text;
  observation_subject_ref text;
  observation_site_page_id uuid;
  observation_snapshot_id uuid;
  observation_fetch_url text;
  observation_final_status text;
  page_normalized_url text;
  page_template_key text;
BEGIN
  NEW.relation_key := app.finding_target_relation_key(
    NEW.relation,
    NEW.target_kind,
    NEW.target_ref,
    NEW.resolution_state,
    NEW.basis_kind,
    NEW.site_page_id,
    NEW.page_snapshot_id,
    NEW.source_observation_id,
    NEW.member_ref,
    NEW.limitation
  );

  -- A worker retry may replay an immutable row after a later DiagnosticRun
  -- has advanced the mutable Finding projection. BEFORE triggers run before
  -- ON CONFLICT, so let only a scope- and tuple-exact historical row reach the
  -- repository's declared conflict arbiter. A novel stale-run row continues
  -- into the current-sighting guard below and is rejected.
  IF EXISTS (
    SELECT 1
    FROM app.finding_targets existing
    WHERE existing.workspace_id = NEW.workspace_id
      AND existing.project_id = NEW.project_id
      AND existing.site_id = NEW.site_id
      AND existing.finding_id = NEW.finding_id
      AND existing.diagnostic_run_id = NEW.diagnostic_run_id
      AND existing.relation_key = NEW.relation_key
      AND existing.relation = NEW.relation
      AND existing.target_kind = NEW.target_kind
      AND existing.target_ref = NEW.target_ref
      AND existing.resolution_state = NEW.resolution_state
      AND existing.basis_kind = NEW.basis_kind
      AND existing.site_page_id IS NOT DISTINCT FROM NEW.site_page_id
      AND existing.page_snapshot_id IS NOT DISTINCT FROM NEW.page_snapshot_id
      AND existing.source_observation_id IS NOT DISTINCT FROM
        NEW.source_observation_id
      AND existing.member_ref IS NOT DISTINCT FROM NEW.member_ref
      AND existing.limitation IS NOT DISTINCT FROM NEW.limitation
  ) THEN
    RETURN NEW;
  END IF;

  -- A target row is written only in the transaction that first creates or
  -- re-hits the Finding for this exact DiagnosticRun. Lock the projection so a
  -- concurrent later run cannot advance last_seen while this insert commits.
  SELECT finding.last_seen_run_id, finding.rule_id
  INTO finding_last_seen_run_id, finding_rule_id
  FROM app.findings finding
  WHERE finding.id = NEW.finding_id
    AND finding.workspace_id = NEW.workspace_id
    AND finding.project_id = NEW.project_id
  FOR UPDATE;

  IF NOT FOUND
     OR finding_last_seen_run_id IS DISTINCT FROM NEW.diagnostic_run_id THEN
    RAISE EXCEPTION 'Finding target does not match its current Finding sighting'
      USING ERRCODE = '23514';
  END IF;

  SELECT diagnostic.site_id
  INTO diagnostic_site_id
  FROM app.diagnostic_runs diagnostic
  WHERE diagnostic.id = NEW.diagnostic_run_id
    AND diagnostic.workspace_id = NEW.workspace_id
    AND diagnostic.project_id = NEW.project_id
  FOR SHARE;

  IF NOT FOUND OR diagnostic_site_id IS DISTINCT FROM NEW.site_id THEN
    RAISE EXCEPTION 'Finding target does not match its DiagnosticRun Site scope'
      USING ERRCODE = '23514';
  END IF;

  expected_relation := CASE finding_rule_id
    WHEN 'TECH-HTTP-001' THEN 'affected_by_http_status'
    WHEN 'TECH-CANONICAL-002' THEN 'affected_by_canonical_issue'
    WHEN 'TECH-LINKGRAPH-005' THEN 'affected_by_page_set'
    WHEN 'SEARCH-CTR-004' THEN 'direct_url'
    WHEN 'SEARCH-DECAY-002' THEN 'direct_url'
    WHEN 'CONTENT-COVERAGE-001' THEN 'affected_by_page_set'
    WHEN 'CONTENT-GAP-011' THEN 'affected_by_keyword_cluster'
    WHEN 'CRO-PATH-001' THEN 'affected_by_page_set'
    WHEN 'CRO-LANDING-003' THEN 'direct_url'
    WHEN 'GEO-ENTITY-001' THEN 'affected_by_page_set'
    WHEN 'GEO-CRAWLER-002' THEN 'affected_by_user_agent'
    ELSE NULL
  END;

  IF expected_relation IS NULL OR NEW.relation IS DISTINCT FROM expected_relation THEN
    RAISE EXCEPTION 'Finding target root does not match its diagnostic rule'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN (
       'TECH-HTTP-001',
       'TECH-CANONICAL-002',
       'TECH-LINKGRAPH-005',
       'CRO-PATH-001',
       'GEO-ENTITY-001'
     )
     AND NOT (
       NEW.resolution_state = 'resolved'
       AND NEW.basis_kind = 'crawl_exact_fetch'
     ) THEN
    RAISE EXCEPTION 'Finding target rule requires resolved exact Crawl members'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN (
       'CONTENT-COVERAGE-001',
       'CONTENT-GAP-011',
       'GEO-CRAWLER-002'
     )
     AND NOT (
       NEW.resolution_state = 'definition_only'
       AND NEW.basis_kind = 'target_definition'
     ) THEN
    RAISE EXCEPTION 'Finding target rule requires one definition-only root'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN ('SEARCH-CTR-004','SEARCH-DECAY-002')
     AND NOT (
       (
         NEW.resolution_state = 'resolved'
         AND NEW.basis_kind = 'observation_site_page'
       )
       OR (
         NEW.resolution_state = 'unresolved'
         AND NEW.basis_kind = 'unresolved_observation'
       )
     ) THEN
    RAISE EXCEPTION 'Search Finding target requires resolved or unresolved GSC lineage'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id = 'CRO-LANDING-003'
     AND NOT (
       (
         NEW.resolution_state = 'resolved'
         AND NEW.basis_kind = 'observation_site_page'
       )
       OR (
         NEW.resolution_state = 'unresolved'
         AND NEW.basis_kind = 'unresolved_observation'
       )
     ) THEN
    RAISE EXCEPTION 'CRO landing target requires resolved or unresolved GA4 lineage'
      USING ERRCODE = '23514';
  END IF;

  -- Locking the durable Finding row above serializes every direct-SQL writer,
  -- including concurrent first inserts. Re-check the committed ledger only
  -- after that lock, so one Finding/run can never split into multiple roots.
  IF EXISTS (
    SELECT 1
    FROM app.finding_targets existing
    WHERE existing.finding_id = NEW.finding_id
      AND existing.diagnostic_run_id = NEW.diagnostic_run_id
      AND (
        existing.relation IS DISTINCT FROM NEW.relation
        OR existing.target_kind IS DISTINCT FROM NEW.target_kind
        OR existing.target_ref IS DISTINCT FROM NEW.target_ref
        OR (
          existing.resolution_state = 'definition_only'
        ) IS DISTINCT FROM (
          NEW.resolution_state = 'definition_only'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Finding target rows cannot diverge from their per-run root'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolution_state = 'definition_only' THEN
    IF NEW.basis_kind <> 'target_definition'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.page_snapshot_id IS NOT NULL
       OR NEW.source_observation_id IS NOT NULL
       OR NEW.member_ref IS NOT NULL
       OR NEW.relation NOT IN (
         'affected_by_template',
         'affected_by_site',
         'affected_by_page_set',
         'affected_by_keyword_cluster',
         'affected_by_user_agent'
       ) THEN
      RAISE EXCEPTION 'Finding target definition has invalid provenance shape'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_observation_id IS NULL OR NEW.member_ref IS NULL THEN
    RAISE EXCEPTION 'Observation-backed Finding target requires immutable source identity'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    observation.provider,
    observation.metric_key,
    observation.subject_ref,
    observation.site_page_id,
    observation.snapshot_id,
    observation.value_json ->> 'fetchUrl',
    observation.value_json ->> 'finalStatus'
  INTO
    observation_provider,
    observation_metric_key,
    observation_subject_ref,
    observation_site_page_id,
    observation_snapshot_id,
    observation_fetch_url,
    observation_final_status
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = observation.workspace_id
   AND snapshot.project_id = observation.project_id
   AND snapshot.provider = observation.provider
   AND snapshot.site_id = NEW.site_id
  WHERE observation.id = NEW.source_observation_id
    AND observation.workspace_id = NEW.workspace_id
    AND observation.project_id = NEW.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finding target Observation does not match its Site scope'
      USING ERRCODE = '23514';
  END IF;

  -- The Observation's complete immutable DataSnapshot identity must be frozen
  -- in this exact run. An ID-only or stale manifest entry is insufficient.
  IF NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic
    JOIN app.data_snapshots snapshot
      ON snapshot.id = observation_snapshot_id
     AND snapshot.workspace_id = NEW.workspace_id
     AND snapshot.project_id = NEW.project_id
     AND snapshot.site_id = NEW.site_id
     AND snapshot.provider = observation_provider
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(diagnostic.input_manifest -> 'snapshots') = 'array'
        THEN diagnostic.input_manifest -> 'snapshots'
        ELSE '[]'::jsonb
      END
    ) AS frozen_snapshot(entry)
    WHERE diagnostic.id = NEW.diagnostic_run_id
      AND diagnostic.workspace_id = NEW.workspace_id
      AND diagnostic.project_id = NEW.project_id
      AND diagnostic.site_id = NEW.site_id
      AND frozen_snapshot.entry ->> 'snapshotId' = snapshot.id::text
      AND frozen_snapshot.entry ->> 'provider' = snapshot.provider
      AND frozen_snapshot.entry ->> 'datasetKey' = snapshot.dataset_key
      AND frozen_snapshot.entry ->> 'schemaVersion' = snapshot.schema_version
      AND frozen_snapshot.entry ->> 'methodVersion' = snapshot.method_version
      AND frozen_snapshot.entry ->> 'checksum' = snapshot.checksum
      AND frozen_snapshot.entry ->> 'availability' = snapshot.availability
      AND frozen_snapshot.entry -> 'sourceWindow' = snapshot.source_window
      AND (frozen_snapshot.entry ->> 'capturedAt')::timestamptz =
        snapshot.captured_at
  ) THEN
    RAISE EXCEPTION 'Finding target Observation is not frozen in its DiagnosticRun manifest'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN ('SEARCH-CTR-004','SEARCH-DECAY-002')
     AND (
       observation_provider <> 'gsc'
       OR observation_metric_key <> 'gsc.page.v1'
     ) THEN
    RAISE EXCEPTION 'Search Finding target requires a frozen GSC page Observation'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id = 'CRO-LANDING-003'
     AND (
       observation_provider <> 'ga4'
       OR observation_metric_key <> 'ga4.landing.v1'
     ) THEN
    RAISE EXCEPTION 'CRO landing Finding target requires a frozen GA4 landing Observation'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolution_state = 'unresolved' THEN
    IF NEW.basis_kind <> 'unresolved_observation'
       OR NEW.relation <> 'direct_url'
       OR NEW.target_kind <> 'url'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.page_snapshot_id IS NOT NULL
       OR observation_site_page_id IS NOT NULL
       OR NOT (
         (observation_provider = 'gsc' AND observation_metric_key = 'gsc.page.v1')
         OR (
           observation_provider = 'ga4'
           AND observation_metric_key = 'ga4.landing.v1'
         )
       )
       OR NEW.member_ref IS DISTINCT FROM observation_subject_ref
       OR NEW.target_ref IS DISTINCT FROM observation_subject_ref
       OR NEW.limitation IS NULL THEN
      RAISE EXCEPTION 'Unresolved Finding target does not prove an ambiguous analytics Observation'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.resolution_state <> 'resolved'
     OR NEW.basis_kind NOT IN ('crawl_exact_fetch','observation_site_page')
     OR NEW.site_page_id IS NULL
     OR NEW.limitation IS NOT NULL
     OR observation_site_page_id IS DISTINCT FROM NEW.site_page_id THEN
    RAISE EXCEPTION 'Resolved Finding target requires exact Observation SitePage lineage'
      USING ERRCODE = '23514';
  END IF;

  SELECT page.normalized_url, page.template_key
  INTO page_normalized_url, page_template_key
  FROM app.site_pages page
  WHERE page.id = NEW.site_page_id
    AND page.workspace_id = NEW.workspace_id
    AND page.project_id = NEW.project_id
    AND page.site_id = NEW.site_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolved Finding target SitePage does not match its Site scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'direct_url'
     AND NEW.target_ref IS DISTINCT FROM page_normalized_url THEN
    RAISE EXCEPTION 'Direct Finding target does not match the exact SitePage URL'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'affected_by_template'
     AND (
       page_template_key IS NULL
       OR NEW.target_ref IS DISTINCT FROM page_template_key
     ) THEN
    RAISE EXCEPTION 'Template Finding target does not match the SitePage template'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.basis_kind = 'crawl_exact_fetch' THEN
    IF observation_provider <> 'crawl'
       OR observation_metric_key <> 'crawl.page.v1'
       OR NEW.page_snapshot_id IS NULL
       OR NEW.member_ref IS DISTINCT FROM observation_fetch_url
       OR page_normalized_url IS DISTINCT FROM observation_fetch_url
       OR NOT EXISTS (
         SELECT 1
         FROM app.page_snapshots page_snapshot
         WHERE page_snapshot.id = NEW.page_snapshot_id
           AND page_snapshot.workspace_id = NEW.workspace_id
           AND page_snapshot.project_id = NEW.project_id
           AND page_snapshot.site_page_id = NEW.site_page_id
           AND page_snapshot.data_snapshot_id = observation_snapshot_id
       ) THEN
      RAISE EXCEPTION 'Crawl Finding target does not match its exact fetch snapshot'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT (
         (observation_provider = 'gsc' AND observation_metric_key = 'gsc.page.v1')
         OR (
           observation_provider = 'ga4'
           AND observation_metric_key = 'ga4.landing.v1'
         )
       )
       OR NEW.member_ref IS DISTINCT FROM observation_subject_ref THEN
      RAISE EXCEPTION 'Analytics Finding target does not match its immutable Observation subject'
        USING ERRCODE = '23514';
    END IF;

    -- Analytics membership comes from Observation.site_page_id. An optional
    -- PageSnapshot is contextual content only and must be the crawl snapshot
    -- for the same page frozen in this DiagnosticRun.
    IF NEW.page_snapshot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM app.page_snapshots page_snapshot
      JOIN app.data_snapshots snapshot
        ON snapshot.id = page_snapshot.data_snapshot_id
       AND snapshot.workspace_id = NEW.workspace_id
       AND snapshot.project_id = NEW.project_id
       AND snapshot.site_id = NEW.site_id
       AND snapshot.provider = 'crawl'
       AND snapshot.dataset_key = 'crawl.site_graph.v1'
      JOIN app.diagnostic_runs diagnostic
        ON diagnostic.id = NEW.diagnostic_run_id
       AND diagnostic.workspace_id = NEW.workspace_id
       AND diagnostic.project_id = NEW.project_id
       AND diagnostic.site_id = NEW.site_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(diagnostic.input_manifest -> 'snapshots') = 'array'
          THEN diagnostic.input_manifest -> 'snapshots'
          ELSE '[]'::jsonb
        END
      ) AS frozen_snapshot(entry)
      WHERE page_snapshot.id = NEW.page_snapshot_id
        AND page_snapshot.workspace_id = NEW.workspace_id
        AND page_snapshot.project_id = NEW.project_id
        AND page_snapshot.site_page_id = NEW.site_page_id
        AND frozen_snapshot.entry ->> 'snapshotId' = snapshot.id::text
        AND frozen_snapshot.entry ->> 'provider' = snapshot.provider
        AND frozen_snapshot.entry ->> 'datasetKey' = snapshot.dataset_key
        AND frozen_snapshot.entry ->> 'schemaVersion' = snapshot.schema_version
        AND frozen_snapshot.entry ->> 'methodVersion' = snapshot.method_version
        AND frozen_snapshot.entry ->> 'checksum' = snapshot.checksum
        AND frozen_snapshot.entry ->> 'availability' = snapshot.availability
        AND frozen_snapshot.entry -> 'sourceWindow' = snapshot.source_window
        AND (frozen_snapshot.entry ->> 'capturedAt')::timestamptz =
          snapshot.captured_at
    ) THEN
      RAISE EXCEPTION 'Analytics Finding target PageSnapshot is not a frozen crawl page'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.relation IN (
       'affected_by_http_status',
       'affected_by_canonical_issue'
     )
     AND NEW.basis_kind <> 'crawl_exact_fetch' THEN
    RAISE EXCEPTION 'HTTP and canonical Finding targets require exact Crawl membership'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'affected_by_http_status'
     AND NEW.target_ref IS DISTINCT FROM observation_final_status THEN
    RAISE EXCEPTION 'HTTP Finding target does not match the Crawl final status'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finding_targets_lineage_guard
  ON app.finding_targets;
CREATE TRIGGER finding_targets_lineage_guard
  BEFORE INSERT ON app.finding_targets
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_finding_target_lineage();

DROP TRIGGER IF EXISTS finding_targets_append_only
  ON app.finding_targets;
CREATE TRIGGER finding_targets_append_only
  BEFORE UPDATE OR DELETE ON app.finding_targets
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE INDEX IF NOT EXISTS finding_targets_site_page_read_idx
  ON app.finding_targets(
    project_id,
    diagnostic_run_id,
    site_page_id,
    finding_id
  )
  WHERE resolution_state = 'resolved' AND site_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finding_targets_finding_run_read_idx
  ON app.finding_targets(
    project_id,
    diagnostic_run_id,
    finding_id,
    relation_key,
    id
  );

CREATE INDEX IF NOT EXISTS finding_targets_operational_idx
  ON app.finding_targets(
    project_id,
    diagnostic_run_id,
    resolution_state,
    relation,
    created_at,
    id
  )
  WHERE resolution_state IN ('unresolved','definition_only');

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0017_finding_target_ledger'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0017_finding_target_ledger.sql

-- BEGIN EXACT ORDERED MIGRATION 0018_keyword_library_foundation.sql
BEGIN;

-- DataForSEO historically reused the CSV keyword-gap dataset key. Preserve
-- those immutable rows, but allow new collection writers to state the actual
-- provider operation without rewriting history.
ALTER TABLE app.data_snapshots
  DROP CONSTRAINT IF EXISTS data_snapshots_dataset_key_check;
ALTER TABLE app.data_snapshots
  ADD CONSTRAINT data_snapshots_dataset_key_check CHECK (dataset_key IN (
    'crawl.site_graph.v1',
    'gsc.page_query_daily.v1',
    'ga4.organic_landing_daily.v1',
    'csv.keyword_gap.v1',
    'dataforseo.ranked_keywords.v1'
  ));

CREATE OR REPLACE FUNCTION app.enforce_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = NEW.provider
      AND run.method_version = NEW.method_version
      AND run.source_connection_id IS NOT DISTINCT FROM NEW.source_connection_id
  ) THEN
    RAISE EXCEPTION 'data snapshot provenance does not match its collection run'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.dataset_key = 'crawl.site_graph.v1')
    OR (NEW.provider = 'gsc' AND NEW.dataset_key = 'gsc.page_query_daily.v1')
    OR (NEW.provider = 'ga4' AND NEW.dataset_key = 'ga4.organic_landing_daily.v1')
    OR (NEW.provider = 'csv' AND NEW.dataset_key = 'csv.keyword_gap.v1')
    OR (
      NEW.provider = 'dataforseo'
      AND NEW.dataset_key IN (
        'csv.keyword_gap.v1',
        'dataforseo.ranked_keywords.v1'
      )
    )
  ) THEN
    RAISE EXCEPTION 'data snapshot dataset does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_normalized_observation_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
      AND snapshot.provider = NEW.provider
      AND snapshot.captured_at = NEW.observed_at
  ) THEN
    RAISE EXCEPTION 'observation provenance does not match its immutable snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND (
        (
          snapshot.provider = 'crawl'
          AND snapshot.dataset_key = 'crawl.site_graph.v1'
          AND NEW.metric_key IN (
            'crawl.page.v1','crawl.robots.v1','crawl.sitemap.v1'
          )
        )
        OR (
          snapshot.provider = 'gsc'
          AND snapshot.dataset_key = 'gsc.page_query_daily.v1'
          AND NEW.metric_key = 'gsc.page.v1'
        )
        OR (
          snapshot.provider = 'ga4'
          AND snapshot.dataset_key = 'ga4.organic_landing_daily.v1'
          AND NEW.metric_key = 'ga4.landing.v1'
        )
        OR (
          snapshot.provider = 'csv'
          AND snapshot.dataset_key = 'csv.keyword_gap.v1'
          AND NEW.metric_key = 'csv.keyword_gap.v1'
        )
        OR (
          snapshot.provider = 'dataforseo'
          AND (
            (
              snapshot.dataset_key = 'csv.keyword_gap.v1'
              AND NEW.metric_key = 'csv.keyword_gap.v1'
            )
            OR (
              snapshot.dataset_key = 'dataforseo.ranked_keywords.v1'
              AND NEW.metric_key = 'csv.keyword_gap.v1'
            )
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'observation metric does not belong to its provider dataset'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider IN ('gsc','ga4') AND NEW.origin = 'first_party' AND NEW.grade = 'A')
    OR (NEW.provider = 'crawl' AND NEW.origin = 'direct_public' AND NEW.grade = 'B')
    OR (
      NEW.provider = 'dataforseo'
      AND NEW.origin = 'vendor_observation'
      AND NEW.grade = 'B'
    )
    OR (NEW.provider = 'csv' AND NEW.origin = 'user_provided' AND NEW.grade = 'C')
  ) THEN
    RAISE EXCEPTION 'observation trust label does not match its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- A provider occurrence points to the canonical Snapshot and exact normalized
-- Observation that own all provider metrics. A manual occurrence is itself the
-- immutable source record and has no fabricated provider lineage. Search
-- volume, rank, current URL, competitor rank and KD are never duplicated here.
CREATE TABLE IF NOT EXISTS app.keyword_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  data_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  normalized_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  display_keyword text NOT NULL,
  normalized_keyword text NOT NULL,
  market text NOT NULL,
  language_tag text NOT NULL,
  query_kind text NOT NULL CHECK (
    query_kind IN ('search_query','generative_query')
  ),
  source_kind text NOT NULL CHECK (
    source_kind IN (
      'csv_import',
      'dataforseo_ranked',
      'gsc_top_query',
      'manual'
    )
  ),
  scope_basis text NOT NULL CHECK (
    scope_basis IN (
      'provider_collection_scope',
      'user_provided',
      'project_context',
      'manual'
    )
  ),
  source_pointer text,
  source_ref text NOT NULL,
  collected_at timestamptz NOT NULL,
  provider_data_as_of timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    length(display_keyword) BETWEEN 1 AND 500
    AND display_keyword = btrim(display_keyword)
  ),
  CHECK (
    length(normalized_keyword) BETWEEN 1 AND 500
    AND normalized_keyword = btrim(normalized_keyword)
    AND normalized_keyword = lower(normalized_keyword)
    AND normalized_keyword !~ '[[:space:]]{2,}'
  ),
  CHECK (market ~ '^[A-Z]{2}$'),
  CHECK (app.is_bcp47_language_tag(language_tag)),
  CHECK (
    source_pointer IS NULL
    OR source_pointer = '/valueJson/keyword'
    OR source_pointer ~ '^/valueJson/topQueries/[0-9]/query$'
  ),
  CHECK (
    length(source_ref) BETWEEN 1 AND 2048
    AND source_ref = btrim(source_ref)
  ),
  CHECK (
    (
      source_kind = 'manual'
      AND scope_basis = 'manual'
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND source_pointer IS NULL
      AND provider_data_as_of IS NULL
    )
    OR (
      source_kind <> 'manual'
      AND scope_basis <> 'manual'
      AND data_snapshot_id IS NOT NULL
      AND normalized_observation_id IS NOT NULL
      AND source_pointer IS NOT NULL
    )
  ),
  UNIQUE (project_id, source_kind, source_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS keyword_occurrences_observation_pointer_idx
  ON app.keyword_occurrences(normalized_observation_id, source_pointer)
  WHERE normalized_observation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS keyword_occurrences_project_collected_idx
  ON app.keyword_occurrences(project_id, collected_at DESC, id DESC);

-- Stable keyword identity. Cluster membership and Existing Page/New Asset are
-- governed review decisions, never part of the identity tuple.
CREATE TABLE IF NOT EXISTS app.keyword_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  display_keyword text NOT NULL,
  normalized_keyword text NOT NULL,
  market text NOT NULL,
  language_tag text NOT NULL,
  query_kind text NOT NULL CHECK (
    query_kind IN ('search_query','generative_query')
  ),
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','approved','excluded','parked')),
  intent text,
  buyer_stage text,
  cluster_key text,
  mapping_decision text NOT NULL DEFAULT 'unassigned'
    CHECK (mapping_decision IN ('unassigned','existing_page','new_asset')),
  mapped_site_page_id uuid
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  mapping_review_state text NOT NULL DEFAULT 'unreviewed'
    CHECK (mapping_review_state IN ('unreviewed','confirmed')),
  mapping_revision integer NOT NULL DEFAULT 0 CHECK (mapping_revision >= 0),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    length(display_keyword) BETWEEN 1 AND 500
    AND display_keyword = btrim(display_keyword)
  ),
  CHECK (
    length(normalized_keyword) BETWEEN 1 AND 500
    AND normalized_keyword = btrim(normalized_keyword)
    AND normalized_keyword = lower(normalized_keyword)
    AND normalized_keyword !~ '[[:space:]]{2,}'
  ),
  CHECK (market ~ '^[A-Z]{2}$'),
  CHECK (app.is_bcp47_language_tag(language_tag)),
  CHECK (
    intent IS NULL OR (
      length(intent) BETWEEN 1 AND 100 AND intent = btrim(intent)
    )
  ),
  CHECK (
    buyer_stage IS NULL OR (
      length(buyer_stage) BETWEEN 1 AND 100 AND buyer_stage = btrim(buyer_stage)
    )
  ),
  CHECK (
    cluster_key IS NULL OR (
      length(cluster_key) BETWEEN 1 AND 200 AND cluster_key = btrim(cluster_key)
    )
  ),
  CHECK (
    (mapping_decision = 'existing_page' AND mapped_site_page_id IS NOT NULL)
    OR (
      mapping_decision IN ('unassigned','new_asset')
      AND mapped_site_page_id IS NULL
    )
  ),
  CHECK (first_seen_at <= last_seen_at),
  UNIQUE (
    project_id,
    normalized_keyword,
    market,
    language_tag,
    query_kind
  )
);

CREATE INDEX IF NOT EXISTS keyword_entities_project_created_idx
  ON app.keyword_entities(project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS keyword_entities_project_review_idx
  ON app.keyword_entities(
    project_id,
    status,
    mapping_review_state,
    updated_at DESC,
    id DESC
  );

CREATE TABLE IF NOT EXISTS app.keyword_entity_sources (
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  keyword_entity_id uuid NOT NULL
    REFERENCES app.keyword_entities(id) ON DELETE RESTRICT,
  keyword_occurrence_id uuid NOT NULL
    REFERENCES app.keyword_occurrences(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (keyword_entity_id, keyword_occurrence_id)
);

CREATE INDEX IF NOT EXISTS keyword_entity_sources_project_occurrence_idx
  ON app.keyword_entity_sources(
    project_id,
    keyword_occurrence_id,
    keyword_entity_id
  );

CREATE OR REPLACE FUNCTION app.enforce_keyword_occurrence_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observation_provider text;
  observation_metric_key text;
  observation_origin text;
  observation_keyword text;
  observation_market text;
  observation_language text;
  collection_market text;
  collection_language text;
  context_basis text;
  context_market text;
  context_language text;
  snapshot_data_as_of text;
  observation_data_as_of text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword occurrence project is absent or archived'
      USING ERRCODE = '23514';
  END IF;

  -- A manual entry is itself the immutable source record. It must not invent a
  -- provider Snapshot or Observation merely to satisfy a shared table shape.
  IF NEW.source_kind = 'manual' THEN
    IF NEW.scope_basis <> 'manual'
       OR NEW.data_snapshot_id IS NOT NULL
       OR NEW.normalized_observation_id IS NOT NULL
       OR NEW.source_pointer IS NOT NULL
       OR NEW.provider_data_as_of IS NOT NULL
       OR NEW.source_ref IS DISTINCT FROM ('manual:' || NEW.id::text) THEN
      RAISE EXCEPTION 'manual keyword occurrence has invalid first-class provenance'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT
    observation.provider,
    observation.metric_key,
    observation.origin,
    CASE
      WHEN NEW.source_pointer = '/valueJson/keyword'
        THEN observation.value_json ->> 'keyword'
      WHEN NEW.source_pointer ~ '^/valueJson/topQueries/[0-9]/query$'
        THEN observation.value_json #>> ARRAY[
          'topQueries',
          substring(
            NEW.source_pointer
            FROM '^/valueJson/topQueries/([0-9])/query$'
          ),
          'query'
        ]
      ELSE NULL
    END,
    observation.value_json ->> 'marketCode',
    observation.value_json ->> 'languageCode',
    snapshot.summary #>> '{collectionScope,marketCode}',
    snapshot.summary #>> '{collectionScope,languageTag}',
    snapshot.summary #>> '{keywordLibraryContext,basis}',
    snapshot.summary #>> '{keywordLibraryContext,marketCode}',
    snapshot.summary #>> '{keywordLibraryContext,languageTag}',
    snapshot.summary #>> '{timing,dataAsOf}',
    observation.value_json ->> 'providerDataAsOf'
  INTO
    observation_provider,
    observation_metric_key,
    observation_origin,
    observation_keyword,
    observation_market,
    observation_language,
    collection_market,
    collection_language,
    context_basis,
    context_market,
    context_language,
    snapshot_data_as_of,
    observation_data_as_of
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = NEW.data_snapshot_id
   AND snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
  WHERE observation.id = NEW.normalized_observation_id
    AND observation.workspace_id = NEW.workspace_id
    AND observation.project_id = NEW.project_id
    AND observation.observed_at = NEW.collected_at;

  IF observation_provider IS NULL THEN
    RAISE EXCEPTION 'keyword occurrence lacks canonical Observation lineage'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (
      NEW.source_kind = 'csv_import'
      AND NEW.scope_basis = 'user_provided'
      AND NEW.source_pointer = '/valueJson/keyword'
      AND observation_provider = 'csv'
      AND observation_metric_key = 'csv.keyword_gap.v1'
    )
    OR (
      NEW.source_kind = 'dataforseo_ranked'
      AND NEW.scope_basis = 'provider_collection_scope'
      AND NEW.source_pointer = '/valueJson/keyword'
      AND observation_provider = 'dataforseo'
      AND observation_metric_key = 'csv.keyword_gap.v1'
    )
    OR (
      NEW.source_kind = 'gsc_top_query'
      AND NEW.scope_basis = 'project_context'
      AND NEW.source_pointer ~ '^/valueJson/topQueries/[0-9]/query$'
      AND observation_provider = 'gsc'
      AND observation_metric_key = 'gsc.page.v1'
    )
  ) THEN
    RAISE EXCEPTION 'keyword occurrence source kind/pointer is not supported by its Observation'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.query_kind <> 'search_query' THEN
    RAISE EXCEPTION 'current canonical keyword sources produce SearchQuery only'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.source_kind = 'dataforseo_ranked' THEN
    IF collection_market IS NULL OR collection_language IS NULL THEN
      RAISE EXCEPTION 'DataForSEO keyword occurrence requires frozen provider collection scope'
        USING ERRCODE = '23514';
    END IF;
    observation_market := collection_market;
    observation_language := collection_language;
  ELSIF NEW.source_kind = 'gsc_top_query' THEN
    -- Search Analytics has no market/language request filter. This explicitly
    -- frozen project context is not presented as provider collection scope.
    IF context_basis IS DISTINCT FROM 'project_context'
       OR context_market IS NULL
       OR context_language IS NULL THEN
      RAISE EXCEPTION 'GSC keyword occurrence requires frozen Keyword Library project context'
        USING ERRCODE = '23514';
    END IF;
    observation_market := context_market;
    observation_language := context_language;
  END IF;
  IF NEW.source_ref IS DISTINCT FROM (
    'observation:' || NEW.normalized_observation_id::text || '#' ||
    NEW.source_pointer
  ) THEN
    RAISE EXCEPTION 'keyword occurrence source ref is not its canonical Observation pointer'
      USING ERRCODE = '23514';
  END IF;
  IF observation_keyword IS NULL OR regexp_replace(
    lower(btrim(observation_keyword)),
    '[[:space:]]+',
    ' ',
    'g'
  ) IS DISTINCT FROM NEW.normalized_keyword THEN
    RAISE EXCEPTION 'keyword occurrence identity does not match Observation keyword'
      USING ERRCODE = '23514';
  END IF;
  IF observation_market IS NULL OR upper(observation_market) IS DISTINCT FROM NEW.market THEN
    RAISE EXCEPTION 'keyword occurrence market does not match Observation provenance'
      USING ERRCODE = '23514';
  END IF;
  IF observation_language IS NULL OR lower(observation_language) IS DISTINCT FROM lower(NEW.language_tag) THEN
    RAISE EXCEPTION 'keyword occurrence language does not match Observation provenance'
      USING ERRCODE = '23514';
  END IF;
  IF coalesce(observation_data_as_of, snapshot_data_as_of) IS NULL THEN
    IF NEW.provider_data_as_of IS NOT NULL THEN
      RAISE EXCEPTION 'keyword provider data timestamp lacks canonical provenance'
      USING ERRCODE = '23514';
    END IF;
  ELSIF observation_data_as_of IS NOT NULL
     AND snapshot_data_as_of IS NOT NULL
     AND observation_data_as_of::timestamptz IS DISTINCT FROM
       snapshot_data_as_of::timestamptz THEN
    RAISE EXCEPTION 'canonical keyword provider timestamps contradict each other'
      USING ERRCODE = '23514';
  ELSIF NEW.provider_data_as_of IS NULL OR coalesce(
    observation_data_as_of,
    snapshot_data_as_of
  )::timestamptz IS DISTINCT FROM NEW.provider_data_as_of THEN
    RAISE EXCEPTION 'keyword provider data timestamp omits or conflicts with canonical provenance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_occurrences_lineage_guard
  ON app.keyword_occurrences;
CREATE TRIGGER keyword_occurrences_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_occurrence_lineage();

DROP TRIGGER IF EXISTS keyword_occurrences_append_only
  ON app.keyword_occurrences;
CREATE TRIGGER keyword_occurrences_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION app.enforce_keyword_entity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  review_changed boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword entity project is absent or archived'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.mapping_decision = 'existing_page' AND NOT EXISTS (
    SELECT 1
    FROM app.site_pages page
    WHERE page.id = NEW.mapped_site_page_id
      AND page.workspace_id = NEW.workspace_id
      AND page.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'keyword Existing Page mapping is outside project scope'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.display_keyword IS DISTINCT FROM OLD.display_keyword
     OR NEW.normalized_keyword IS DISTINCT FROM OLD.normalized_keyword
     OR NEW.market IS DISTINCT FROM OLD.market
     OR NEW.language_tag IS DISTINCT FROM OLD.language_tag
     OR NEW.query_kind IS DISTINCT FROM OLD.query_kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'keyword stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.first_seen_at > OLD.first_seen_at
     OR NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'keyword observation window may only expand'
      USING ERRCODE = '23514';
  END IF;

  review_changed :=
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.intent IS DISTINCT FROM OLD.intent
    OR NEW.buyer_stage IS DISTINCT FROM OLD.buyer_stage
    OR NEW.cluster_key IS DISTINCT FROM OLD.cluster_key
    OR NEW.mapping_decision IS DISTINCT FROM OLD.mapping_decision
    OR NEW.mapped_site_page_id IS DISTINCT FROM OLD.mapped_site_page_id
    OR NEW.mapping_review_state IS DISTINCT FROM OLD.mapping_review_state;

  IF review_changed AND NEW.mapping_revision <> OLD.mapping_revision + 1 THEN
    RAISE EXCEPTION 'keyword review update must advance exactly one revision'
      USING ERRCODE = '23514';
  END IF;
  IF NOT review_changed AND NEW.mapping_revision <> OLD.mapping_revision THEN
    RAISE EXCEPTION 'keyword mapping revision cannot advance without a review change'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_entities_mutation_guard
  ON app.keyword_entities;
CREATE TRIGGER keyword_entities_mutation_guard
  BEFORE INSERT OR UPDATE ON app.keyword_entities
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_entity_mutation();

DROP TRIGGER IF EXISTS keyword_entities_no_delete
  ON app.keyword_entities;
CREATE TRIGGER keyword_entities_no_delete
  BEFORE DELETE ON app.keyword_entities
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION app.enforce_keyword_entity_source_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    JOIN app.keyword_entities entity
      ON entity.id = NEW.keyword_entity_id
     AND entity.workspace_id = NEW.workspace_id
     AND entity.project_id = NEW.project_id
    JOIN app.keyword_occurrences occurrence
      ON occurrence.id = NEW.keyword_occurrence_id
     AND occurrence.workspace_id = NEW.workspace_id
     AND occurrence.project_id = NEW.project_id
     AND occurrence.normalized_keyword = entity.normalized_keyword
     AND occurrence.market = entity.market
     AND occurrence.language_tag = entity.language_tag
     AND occurrence.query_kind = entity.query_kind
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword entity source membership has invalid project provenance'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_entity_sources_lineage_guard
  ON app.keyword_entity_sources;
CREATE TRIGGER keyword_entity_sources_lineage_guard
  BEFORE INSERT ON app.keyword_entity_sources
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_entity_source_lineage();

DROP TRIGGER IF EXISTS keyword_entity_sources_append_only
  ON app.keyword_entity_sources;
CREATE TRIGGER keyword_entity_sources_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_entity_sources
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

-- A single SQL call owns occurrence dedupe, stable entity convergence and
-- membership. The unique constraints serialize concurrent retries; a replay
-- with changed semantic bytes fails rather than mutating immutable provenance.
CREATE OR REPLACE FUNCTION app.upsert_keyword_library_occurrence(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_occurrence_id uuid,
  selected_data_snapshot_id uuid,
  selected_normalized_observation_id uuid,
  selected_display_keyword text,
  selected_normalized_keyword text,
  selected_market text,
  selected_language_tag text,
  selected_query_kind text,
  selected_source_kind text,
  selected_scope_basis text,
  selected_source_pointer text,
  selected_source_ref text,
  selected_collected_at timestamptz,
  selected_provider_data_as_of timestamptz
)
RETURNS TABLE (occurrence_id uuid, entity_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  occurrence_row app.keyword_occurrences%ROWTYPE;
  entity_row app.keyword_entities%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = selected_project_id
      AND project.workspace_id = selected_workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword library project is absent or archived'
      USING ERRCODE = '23514';
  END IF;
  IF (selected_source_kind = 'manual') IS DISTINCT FROM
     (selected_occurrence_id IS NOT NULL) THEN
    RAISE EXCEPTION 'manual entry id is required only for manual occurrences'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_occurrences (
    id,
    workspace_id,
    project_id,
    data_snapshot_id,
    normalized_observation_id,
    display_keyword,
    normalized_keyword,
    market,
    language_tag,
    query_kind,
    source_kind,
    scope_basis,
    source_pointer,
    source_ref,
    collected_at,
    provider_data_as_of
  ) VALUES (
    coalesce(selected_occurrence_id, gen_random_uuid()),
    selected_workspace_id,
    selected_project_id,
    selected_data_snapshot_id,
    selected_normalized_observation_id,
    selected_display_keyword,
    selected_normalized_keyword,
    selected_market,
    selected_language_tag,
    selected_query_kind,
    selected_source_kind,
    selected_scope_basis,
    selected_source_pointer,
    selected_source_ref,
    selected_collected_at,
    selected_provider_data_as_of
  )
  ON CONFLICT (project_id, source_kind, source_ref) DO NOTHING
  RETURNING * INTO occurrence_row;

  IF occurrence_row.id IS NULL THEN
    SELECT *
    INTO occurrence_row
    FROM app.keyword_occurrences occurrence
    WHERE occurrence.project_id = selected_project_id
      AND occurrence.source_kind = selected_source_kind
      AND occurrence.source_ref = selected_source_ref;
  END IF;

  IF occurrence_row.id IS NULL
     OR (
       selected_source_kind = 'manual'
       AND occurrence_row.id IS DISTINCT FROM selected_occurrence_id
     )
     OR occurrence_row.workspace_id IS DISTINCT FROM selected_workspace_id
     OR occurrence_row.project_id IS DISTINCT FROM selected_project_id
     OR occurrence_row.data_snapshot_id IS DISTINCT FROM selected_data_snapshot_id
     OR occurrence_row.normalized_observation_id IS DISTINCT FROM selected_normalized_observation_id
     OR occurrence_row.display_keyword IS DISTINCT FROM selected_display_keyword
     OR occurrence_row.normalized_keyword IS DISTINCT FROM selected_normalized_keyword
     OR occurrence_row.market IS DISTINCT FROM selected_market
     OR occurrence_row.language_tag IS DISTINCT FROM selected_language_tag
     OR occurrence_row.query_kind IS DISTINCT FROM selected_query_kind
     OR occurrence_row.source_kind IS DISTINCT FROM selected_source_kind
     OR occurrence_row.scope_basis IS DISTINCT FROM selected_scope_basis
     OR occurrence_row.source_pointer IS DISTINCT FROM selected_source_pointer
     OR occurrence_row.source_ref IS DISTINCT FROM selected_source_ref
     OR occurrence_row.collected_at IS DISTINCT FROM selected_collected_at
     OR occurrence_row.provider_data_as_of IS DISTINCT FROM selected_provider_data_as_of THEN
    RAISE EXCEPTION 'keyword source occurrence conflicts with immutable provenance'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_entities (
    workspace_id,
    project_id,
    display_keyword,
    normalized_keyword,
    market,
    language_tag,
    query_kind,
    first_seen_at,
    last_seen_at
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    selected_display_keyword,
    selected_normalized_keyword,
    selected_market,
    selected_language_tag,
    selected_query_kind,
    selected_collected_at,
    selected_collected_at
  )
  ON CONFLICT (
    project_id,
    normalized_keyword,
    market,
    language_tag,
    query_kind
  ) DO UPDATE SET
    first_seen_at = least(
      app.keyword_entities.first_seen_at,
      EXCLUDED.first_seen_at
    ),
    last_seen_at = greatest(
      app.keyword_entities.last_seen_at,
      EXCLUDED.last_seen_at
    )
  RETURNING * INTO entity_row;

  IF entity_row.workspace_id IS DISTINCT FROM selected_workspace_id THEN
    RAISE EXCEPTION 'keyword stable identity conflicts with workspace scope'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_entity_sources (
    workspace_id,
    project_id,
    keyword_entity_id,
    keyword_occurrence_id
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    entity_row.id,
    occurrence_row.id
  )
  ON CONFLICT (keyword_entity_id, keyword_occurrence_id) DO NOTHING;

  RETURN QUERY SELECT occurrence_row.id, entity_row.id;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0018_keyword_library_foundation'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0018_keyword_library_foundation.sql

-- BEGIN EXACT ORDERED MIGRATION 0019_competitor_library_foundation.sql
BEGIN;

-- Competitors are stable project/domain identities. A domain is deliberately
-- narrower than a URL: lowercase ASCII hostname, no scheme, credentials, port,
-- path or wildcard. IDNs must arrive in canonical punycode form.
CREATE OR REPLACE FUNCTION app.is_normalized_competitor_domain(candidate text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT length(candidate) BETWEEN 1 AND 253
    AND candidate = btrim(candidate)
    AND candidate = lower(candidate)
    AND candidate ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$';
$$;

CREATE OR REPLACE FUNCTION app.is_competitor_analysis_scope(candidate text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  scope text;
BEGIN
  IF cardinality(candidate) NOT BETWEEN 0 AND 5 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(candidate) value
    WHERE value IS NULL
       OR value NOT IN (
         'positioning',
         'product_capability',
         'keyword_gap',
         'content',
         'serp_visibility'
       )
  ) THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM unnest(candidate) value)
     IS DISTINCT FROM
     (SELECT count(DISTINCT value) FROM unnest(candidate) value) THEN
    RETURN false;
  END IF;
  FOREACH scope IN ARRAY candidate LOOP
    IF scope IS DISTINCT FROM btrim(scope) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- Product Profile evidence references remain typed JSON objects. A UUID list
-- would lose whether an anchor was a Snapshot, Observation, user edit, etc.
CREATE OR REPLACE FUNCTION app.is_typed_product_profile_evidence_refs(
  candidate jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  evidence_ref jsonb;
  ref_kind text;
  ref_id text;
  target_id text;
  expected_keys integer;
  seen_ids text[] := ARRAY[]::text[];
  uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'array'
     OR jsonb_array_length(candidate) NOT BETWEEN 1 AND 50 THEN
    RETURN false;
  END IF;

  FOR evidence_ref IN SELECT value FROM jsonb_array_elements(candidate)
  LOOP
    IF jsonb_typeof(evidence_ref) IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    ref_kind := evidence_ref ->> 'kind';
    ref_id := evidence_ref ->> 'evidenceRefId';
    IF ref_id IS NULL OR ref_id !~ uuid_pattern OR ref_id = ANY(seen_ids) THEN
      RETURN false;
    END IF;
    seen_ids := array_append(seen_ids, ref_id);

    CASE ref_kind
      WHEN 'declaredHint', 'userEdit' THEN
        expected_keys := 2;
        target_id := NULL;
      WHEN 'snapshot' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'snapshotId';
      WHEN 'pageSnapshot' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'pageSnapshotId';
      WHEN 'observation' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'observationId';
      WHEN 'analysisInvocation' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'analysisInvocationId';
      ELSE
        RETURN false;
    END CASE;

    IF (SELECT count(*) FROM jsonb_object_keys(evidence_ref))
       IS DISTINCT FROM expected_keys THEN
      RETURN false;
    END IF;
    IF expected_keys = 3 AND (target_id IS NULL OR target_id !~ uuid_pattern) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE IF NOT EXISTS app.competitor_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  domain text NOT NULL CHECK (app.is_normalized_competitor_domain(domain)),
  name text CHECK (
    name IS NULL
    OR (length(name) BETWEEN 1 AND 160 AND name = btrim(name))
  ),
  review_status text NOT NULL DEFAULT 'candidate'
    CHECK (review_status IN ('candidate','approved','excluded')),
  relationship text CHECK (
    relationship IS NULL
    OR relationship IN (
      'direct',
      'indirect',
      'status_quo',
      'benchmark',
      'publisher'
    )
  ),
  analysis_scope text[] NOT NULL DEFAULT '{}'
    CHECK (app.is_competitor_analysis_scope(analysis_scope)),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, domain),
  CHECK (
    (
      review_status = 'approved'
      AND relationship IS NOT NULL
      AND cardinality(analysis_scope) BETWEEN 1 AND 5
    )
    OR (
      review_status IN ('candidate','excluded')
      AND relationship IS NULL
      AND cardinality(analysis_scope) = 0
    )
  )
);

CREATE INDEX IF NOT EXISTS competitor_entities_project_created_idx
  ON app.competitor_entities(project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS competitor_entities_project_status_idx
  ON app.competitor_entities(project_id, review_status, created_at DESC, id DESC);

-- One immutable row is one exact origin occurrence. Only a canonical confirmed
-- Product Profile version, a canonical CSV Observation pointer, or a manual
-- entry may be represented in v1. There is intentionally no DataForSEO, SERP,
-- or AI-citation discriminator in this table.
CREATE TABLE IF NOT EXISTS app.competitor_origin_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  origin_kind text NOT NULL CHECK (
    origin_kind IN ('product_profile','csv_keyword_gap','manual')
  ),
  source_name text CHECK (
    source_name IS NULL
    OR (
      length(source_name) BETWEEN 1 AND 160
      AND source_name = btrim(source_name)
    )
  ),
  product_profile_id uuid
    REFERENCES app.icp_profiles(id) ON DELETE RESTRICT,
  profile_version integer CHECK (
    profile_version IS NULL OR profile_version >= 1
  ),
  candidate_id uuid,
  field_provenance_path text,
  evidence_refs jsonb,
  source_review_status text CHECK (
    source_review_status IS NULL
    OR source_review_status IN ('candidate','approved','excluded')
  ),
  source_relationship text CHECK (
    source_relationship IS NULL
    OR source_relationship IN ('direct','indirect')
  ),
  source_analysis_scope text[],
  data_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  normalized_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  import_preview_id uuid
    REFERENCES app.import_previews(id) ON DELETE RESTRICT,
  source_pointer text,
  manual_entry_id uuid,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    source_analysis_scope IS NULL
    OR app.is_competitor_analysis_scope(source_analysis_scope)
  ),
  CHECK (
    evidence_refs IS NULL
    OR app.is_typed_product_profile_evidence_refs(evidence_refs)
  ),
  CHECK (
    (
      origin_kind = 'product_profile'
      AND source_name IS NOT NULL
      AND product_profile_id IS NOT NULL
      AND profile_version IS NOT NULL
      AND candidate_id IS NOT NULL
      AND field_provenance_path IS NOT NULL
      AND evidence_refs IS NOT NULL
      AND source_review_status IS NOT NULL
      AND source_analysis_scope IS NOT NULL
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND import_preview_id IS NULL
      AND source_pointer IS NULL
      AND manual_entry_id IS NULL
      AND observed_at IS NULL
    )
    OR (
      origin_kind = 'csv_keyword_gap'
      AND source_name IS NULL
      AND product_profile_id IS NULL
      AND profile_version IS NULL
      AND candidate_id IS NULL
      AND field_provenance_path IS NULL
      AND evidence_refs IS NULL
      AND source_review_status IS NULL
      AND source_relationship IS NULL
      AND source_analysis_scope IS NULL
      AND data_snapshot_id IS NOT NULL
      AND normalized_observation_id IS NOT NULL
      AND import_preview_id IS NOT NULL
      AND source_pointer = '/valueJson/competitorDomain'
      AND manual_entry_id IS NULL
      AND observed_at IS NOT NULL
    )
    OR (
      origin_kind = 'manual'
      AND product_profile_id IS NULL
      AND profile_version IS NULL
      AND candidate_id IS NULL
      AND field_provenance_path IS NULL
      AND evidence_refs IS NULL
      AND source_review_status IS NULL
      AND source_relationship IS NULL
      AND source_analysis_scope IS NULL
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND import_preview_id IS NULL
      AND source_pointer IS NULL
      AND manual_entry_id IS NOT NULL
      AND id = manual_entry_id
      AND observed_at IS NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_profile_identity_idx
  ON app.competitor_origin_occurrences(
    product_profile_id,
    profile_version,
    candidate_id
  )
  WHERE origin_kind = 'product_profile';
CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_csv_identity_idx
  ON app.competitor_origin_occurrences(
    normalized_observation_id,
    source_pointer
  )
  WHERE origin_kind = 'csv_keyword_gap';
CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_manual_identity_idx
  ON app.competitor_origin_occurrences(manual_entry_id)
  WHERE origin_kind = 'manual';
CREATE INDEX IF NOT EXISTS competitor_origins_entity_observed_idx
  ON app.competitor_origin_occurrences(
    competitor_id,
    observed_at DESC NULLS LAST,
    created_at DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION app.enforce_competitor_entity_governance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'competitor stable identities cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'competitor project is absent, archived, or cross-workspace'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.revision IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'competitor governance must begin at revision zero'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.domain IS DISTINCT FROM OLD.domain
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'competitor stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision IS DISTINCT FROM OLD.revision + 1 THEN
    RAISE EXCEPTION 'competitor governance revision must advance exactly once'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.review_status IS NOT DISTINCT FROM OLD.review_status
     AND NEW.relationship IS NOT DISTINCT FROM OLD.relationship
     AND NEW.analysis_scope IS NOT DISTINCT FROM OLD.analysis_scope THEN
    RAISE EXCEPTION 'competitor revision requires a governance change'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitor_entities_governance_guard
  ON app.competitor_entities;
CREATE TRIGGER competitor_entities_governance_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.competitor_entities
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_entity_governance();

CREATE OR REPLACE FUNCTION app.enforce_competitor_origin_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_row app.competitor_entities%ROWTYPE;
  profile_row app.icp_profiles%ROWTYPE;
  profile_candidate jsonb;
  candidate_index integer;
  candidate_count integer;
  provenance_count integer;
  provenance_derivation text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'competitor origin occurrences are append-only'
      USING ERRCODE = '23514';
  END IF;

  SELECT entity.*
  INTO entity_row
  FROM app.competitor_entities entity
  JOIN app.client_projects project
    ON project.id = entity.project_id
   AND project.workspace_id = entity.workspace_id
   AND project.archived_at IS NULL
  WHERE entity.id = NEW.competitor_id
    AND entity.workspace_id = NEW.workspace_id
    AND entity.project_id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'competitor origin does not match an active scoped entity'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.origin_kind = 'product_profile' THEN
    SELECT profile.*
    INTO profile_row
    FROM app.icp_profiles profile
    JOIN app.client_projects project
      ON project.id = profile.project_id
     AND project.workspace_id = profile.workspace_id
     AND project.confirmed_icp_profile_id = profile.id
    WHERE profile.id = NEW.product_profile_id
      AND profile.workspace_id = NEW.workspace_id
      AND profile.project_id = NEW.project_id
      AND profile.version = NEW.profile_version
      AND profile.status = 'complete'
      AND profile.profile ->> 'profileSchemaVersion'
        = 'product-profile.0.3.0';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'competitor Product Profile source is not the confirmed scoped version'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer
    INTO candidate_count
    FROM jsonb_array_elements(profile_row.profile -> 'competitorCandidates') item
    WHERE item ->> 'candidateId' = NEW.candidate_id::text;
    IF candidate_count IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'competitor candidate identity is absent or ambiguous'
        USING ERRCODE = '23514';
    END IF;
    SELECT item, (ordinality - 1)::integer
    INTO profile_candidate, candidate_index
    FROM jsonb_array_elements(profile_row.profile -> 'competitorCandidates')
      WITH ORDINALITY candidate(item, ordinality)
    WHERE item ->> 'candidateId' = NEW.candidate_id::text;

    IF profile_candidate ->> 'domain' IS DISTINCT FROM entity_row.domain
       OR profile_candidate ->> 'name' IS DISTINCT FROM NEW.source_name
       OR profile_candidate ->> 'reviewStatus'
         IS DISTINCT FROM NEW.source_review_status
       OR profile_candidate ->> 'relationship'
         IS DISTINCT FROM NEW.source_relationship
       OR profile_candidate -> 'analysisScope'
         IS DISTINCT FROM to_jsonb(NEW.source_analysis_scope) THEN
      RAISE EXCEPTION 'competitor origin drifted from the immutable Product Profile candidate'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.source_review_status = 'approved'
       AND (
         NEW.source_relationship IS NULL
         OR NEW.source_relationship NOT IN ('direct','indirect')
         OR cardinality(NEW.source_analysis_scope) = 0
       ) THEN
      RAISE EXCEPTION 'approved Product Profile competitor is not actionable'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.field_provenance_path NOT IN (
      '/competitorCandidates',
      '/competitorCandidates/' || candidate_index::text
    ) THEN
      RAISE EXCEPTION 'competitor field provenance path does not cover its candidate'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(*)::integer, min(entry ->> 'derivation')
    INTO provenance_count, provenance_derivation
    FROM jsonb_array_elements(profile_row.profile -> 'fieldProvenance') entry
    WHERE entry ->> 'path' = NEW.field_provenance_path
      AND entry -> 'evidenceRefs' = NEW.evidence_refs;
    IF provenance_count IS DISTINCT FROM 1
       OR provenance_derivation IS NULL
       OR provenance_derivation NOT IN (
         'declared',
         'observed',
         'computed',
         'inferred'
       ) THEN
      RAISE EXCEPTION 'competitor source does not match projectable Product Profile provenance'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.origin_kind = 'csv_keyword_gap' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM app.normalized_observations observation
      JOIN app.data_snapshots snapshot
        ON snapshot.id = observation.snapshot_id
       AND snapshot.id = NEW.data_snapshot_id
       AND snapshot.workspace_id = NEW.workspace_id
       AND snapshot.project_id = NEW.project_id
       AND snapshot.provider = 'csv'
       AND snapshot.dataset_key = 'csv.keyword_gap.v1'
       AND snapshot.method_version = 'csv.keyword_gap.v1'
      JOIN app.collection_runs collection_run
        ON collection_run.id = snapshot.collection_run_id
       AND collection_run.workspace_id = NEW.workspace_id
       AND collection_run.project_id = NEW.project_id
       AND collection_run.site_id = snapshot.site_id
       AND collection_run.provider = 'csv'
       AND collection_run.operation = 'keyword_gap_import'
       AND collection_run.method_version = 'csv.keyword_gap.v1'
       AND collection_run.source_connection_id
         IS NOT DISTINCT FROM snapshot.source_connection_id
       AND collection_run.import_preview_id = NEW.import_preview_id
      LEFT JOIN app.source_connections source_connection
        ON source_connection.id = snapshot.source_connection_id
       AND source_connection.workspace_id = NEW.workspace_id
       AND source_connection.project_id = NEW.project_id
       AND source_connection.site_id = snapshot.site_id
       AND source_connection.provider = 'csv'
      JOIN app.import_previews preview
        ON preview.id = collection_run.import_preview_id
       AND preview.workspace_id = NEW.workspace_id
       AND preview.project_id = NEW.project_id
       AND preview.site_id = snapshot.site_id
       AND preview.template_id = 'keyword_gap_v1'
       AND preview.status = 'consumed'
      WHERE observation.id = NEW.normalized_observation_id
        AND observation.workspace_id = NEW.workspace_id
        AND observation.project_id = NEW.project_id
        AND observation.provider = 'csv'
        AND observation.metric_key = 'csv.keyword_gap.v1'
        AND observation.origin = 'user_provided'
        AND observation.grade = 'C'
        AND observation.availability = 'available'
        AND observation.observed_at = NEW.observed_at
        AND observation.value_json ->> 'competitorDomain' = entity_row.domain
        AND NEW.source_pointer = '/valueJson/competitorDomain'
        AND (
          snapshot.source_connection_id IS NULL
          OR source_connection.id IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION 'competitor CSV origin does not match canonical Observation lineage'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.origin_kind = 'manual' THEN
    IF NEW.id IS DISTINCT FROM NEW.manual_entry_id THEN
      RAISE EXCEPTION 'manual competitor occurrence must retain its entry identity'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported competitor origin kind'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitor_origins_lineage_guard
  ON app.competitor_origin_occurrences;
CREATE TRIGGER competitor_origins_lineage_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.competitor_origin_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_origin_lineage();

-- A single statement serializes an exact source identity, converges the stable
-- domain entity, and appends the origin. Existing governance is never touched.
CREATE OR REPLACE FUNCTION app.upsert_competitor_origin(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_domain text,
  selected_name text,
  selected_origin_kind text,
  selected_product_profile_id uuid,
  selected_profile_version integer,
  selected_candidate_id uuid,
  selected_field_provenance_path text,
  selected_evidence_refs jsonb,
  selected_source_review_status text,
  selected_source_relationship text,
  selected_source_analysis_scope text[],
  selected_data_snapshot_id uuid,
  selected_normalized_observation_id uuid,
  selected_import_preview_id uuid,
  selected_source_pointer text,
  selected_manual_entry_id uuid
)
RETURNS TABLE (occurrence_id uuid, competitor_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  entity_row app.competitor_entities%ROWTYPE;
  occurrence_row app.competitor_origin_occurrences%ROWTYPE;
  selected_observed_at timestamptz;
  source_lock_key text;
  seed_review_status text := 'candidate';
  seed_relationship text := NULL;
  seed_analysis_scope text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = selected_project_id
      AND project.workspace_id = selected_workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'competitor project is absent or archived'
      USING ERRCODE = '23514';
  END IF;
  IF selected_domain IS NULL
     OR NOT app.is_normalized_competitor_domain(selected_domain)
     OR (
       selected_name IS NOT NULL
       AND (
         length(selected_name) NOT BETWEEN 1 AND 160
         OR selected_name IS DISTINCT FROM btrim(selected_name)
       )
     ) THEN
    RAISE EXCEPTION 'competitor identity is not canonical'
      USING ERRCODE = '23514';
  END IF;

  IF selected_origin_kind = 'product_profile' THEN
    IF selected_name IS NULL
       OR selected_product_profile_id IS NULL
       OR selected_profile_version IS NULL
       OR selected_profile_version < 1
       OR selected_candidate_id IS NULL
       OR selected_field_provenance_path IS NULL
       OR selected_evidence_refs IS NULL
       OR NOT app.is_typed_product_profile_evidence_refs(selected_evidence_refs)
       OR selected_source_review_status IS NULL
       OR selected_source_review_status NOT IN ('candidate','approved','excluded')
       OR selected_source_relationship IS NOT NULL
          AND selected_source_relationship NOT IN ('direct','indirect')
       OR selected_source_analysis_scope IS NULL
       OR NOT app.is_competitor_analysis_scope(selected_source_analysis_scope)
       OR selected_data_snapshot_id IS NOT NULL
       OR selected_normalized_observation_id IS NOT NULL
       OR selected_import_preview_id IS NOT NULL
       OR selected_source_pointer IS NOT NULL
       OR selected_manual_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'Product Profile competitor source shape is invalid'
        USING ERRCODE = '23514';
    END IF;
    IF selected_source_review_status = 'approved'
       AND (
         selected_source_relationship IS NULL
         OR selected_source_relationship NOT IN ('direct','indirect')
         OR cardinality(selected_source_analysis_scope) = 0
       ) THEN
      RAISE EXCEPTION 'approved Product Profile competitor source is incomplete'
        USING ERRCODE = '23514';
    END IF;
    source_lock_key := selected_origin_kind || ':'
      || selected_product_profile_id::text || ':'
      || selected_profile_version::text || ':'
      || selected_candidate_id::text;
    seed_review_status := selected_source_review_status;
    IF seed_review_status = 'approved' THEN
      seed_relationship := selected_source_relationship;
      seed_analysis_scope := selected_source_analysis_scope;
    END IF;
  ELSIF selected_origin_kind = 'csv_keyword_gap' THEN
    IF selected_name IS NOT NULL
       OR selected_product_profile_id IS NOT NULL
       OR selected_profile_version IS NOT NULL
       OR selected_candidate_id IS NOT NULL
       OR selected_field_provenance_path IS NOT NULL
       OR selected_evidence_refs IS NOT NULL
       OR selected_source_review_status IS NOT NULL
       OR selected_source_relationship IS NOT NULL
       OR selected_source_analysis_scope IS NOT NULL
       OR selected_data_snapshot_id IS NULL
       OR selected_normalized_observation_id IS NULL
       OR selected_import_preview_id IS NULL
       OR selected_source_pointer IS DISTINCT FROM '/valueJson/competitorDomain'
       OR selected_manual_entry_id IS NOT NULL THEN
      RAISE EXCEPTION 'CSV competitor source shape is invalid'
        USING ERRCODE = '23514';
    END IF;
    SELECT observation.observed_at
    INTO selected_observed_at
    FROM app.normalized_observations observation
    WHERE observation.id = selected_normalized_observation_id;
    source_lock_key := selected_origin_kind || ':'
      || selected_normalized_observation_id::text || ':'
      || selected_source_pointer;
  ELSIF selected_origin_kind = 'manual' THEN
    IF selected_product_profile_id IS NOT NULL
       OR selected_profile_version IS NOT NULL
       OR selected_candidate_id IS NOT NULL
       OR selected_field_provenance_path IS NOT NULL
       OR selected_evidence_refs IS NOT NULL
       OR selected_source_review_status IS NOT NULL
       OR selected_source_relationship IS NOT NULL
       OR selected_source_analysis_scope IS NOT NULL
       OR selected_data_snapshot_id IS NOT NULL
       OR selected_normalized_observation_id IS NOT NULL
       OR selected_import_preview_id IS NOT NULL
       OR selected_source_pointer IS NOT NULL
       OR selected_manual_entry_id IS NULL THEN
      RAISE EXCEPTION 'manual competitor source shape is invalid'
        USING ERRCODE = '23514';
    END IF;
    source_lock_key := selected_origin_kind || ':'
      || selected_manual_entry_id::text;
  ELSE
    RAISE EXCEPTION 'unsupported competitor origin kind'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    source_lock_key,
    0
  ));

  IF selected_origin_kind = 'product_profile' THEN
    SELECT * INTO occurrence_row
    FROM app.competitor_origin_occurrences occurrence
    WHERE occurrence.origin_kind = 'product_profile'
      AND occurrence.product_profile_id = selected_product_profile_id
      AND occurrence.profile_version = selected_profile_version
      AND occurrence.candidate_id = selected_candidate_id;
  ELSIF selected_origin_kind = 'csv_keyword_gap' THEN
    SELECT * INTO occurrence_row
    FROM app.competitor_origin_occurrences occurrence
    WHERE occurrence.origin_kind = 'csv_keyword_gap'
      AND occurrence.normalized_observation_id = selected_normalized_observation_id
      AND occurrence.source_pointer = selected_source_pointer;
  ELSE
    SELECT * INTO occurrence_row
    FROM app.competitor_origin_occurrences occurrence
    WHERE occurrence.origin_kind = 'manual'
      AND occurrence.manual_entry_id = selected_manual_entry_id;
  END IF;

  IF occurrence_row.id IS NOT NULL THEN
    SELECT * INTO entity_row
    FROM app.competitor_entities entity
    WHERE entity.id = occurrence_row.competitor_id;
    IF occurrence_row.workspace_id IS DISTINCT FROM selected_workspace_id
       OR occurrence_row.project_id IS DISTINCT FROM selected_project_id
       OR entity_row.workspace_id IS DISTINCT FROM selected_workspace_id
       OR entity_row.project_id IS DISTINCT FROM selected_project_id
       OR entity_row.domain IS DISTINCT FROM selected_domain
       OR occurrence_row.origin_kind IS DISTINCT FROM selected_origin_kind
       OR occurrence_row.source_name IS DISTINCT FROM selected_name
       OR occurrence_row.product_profile_id IS DISTINCT FROM selected_product_profile_id
       OR occurrence_row.profile_version IS DISTINCT FROM selected_profile_version
       OR occurrence_row.candidate_id IS DISTINCT FROM selected_candidate_id
       OR occurrence_row.field_provenance_path IS DISTINCT FROM selected_field_provenance_path
       OR occurrence_row.evidence_refs IS DISTINCT FROM selected_evidence_refs
       OR occurrence_row.source_review_status IS DISTINCT FROM selected_source_review_status
       OR occurrence_row.source_relationship IS DISTINCT FROM selected_source_relationship
       OR occurrence_row.source_analysis_scope IS DISTINCT FROM selected_source_analysis_scope
       OR occurrence_row.data_snapshot_id IS DISTINCT FROM selected_data_snapshot_id
       OR occurrence_row.normalized_observation_id IS DISTINCT FROM selected_normalized_observation_id
       OR occurrence_row.import_preview_id IS DISTINCT FROM selected_import_preview_id
       OR occurrence_row.source_pointer IS DISTINCT FROM selected_source_pointer
       OR occurrence_row.manual_entry_id IS DISTINCT FROM selected_manual_entry_id
       OR occurrence_row.observed_at IS DISTINCT FROM selected_observed_at THEN
      RAISE EXCEPTION 'competitor source replay conflicts with immutable provenance'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT occurrence_row.id, entity_row.id;
    RETURN;
  END IF;

  INSERT INTO app.competitor_entities (
    workspace_id,
    project_id,
    domain,
    name,
    review_status,
    relationship,
    analysis_scope
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    selected_domain,
    selected_name,
    seed_review_status,
    seed_relationship,
    seed_analysis_scope
  )
  ON CONFLICT (project_id, domain) DO NOTHING
  RETURNING * INTO entity_row;

  IF entity_row.id IS NULL THEN
    SELECT * INTO entity_row
    FROM app.competitor_entities entity
    WHERE entity.project_id = selected_project_id
      AND entity.domain = selected_domain;
  END IF;
  IF entity_row.id IS NULL
     OR entity_row.workspace_id IS DISTINCT FROM selected_workspace_id THEN
    RAISE EXCEPTION 'competitor stable domain conflicts with workspace scope'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.competitor_origin_occurrences (
    id,
    workspace_id,
    project_id,
    competitor_id,
    origin_kind,
    source_name,
    product_profile_id,
    profile_version,
    candidate_id,
    field_provenance_path,
    evidence_refs,
    source_review_status,
    source_relationship,
    source_analysis_scope,
    data_snapshot_id,
    normalized_observation_id,
    import_preview_id,
    source_pointer,
    manual_entry_id,
    observed_at
  ) VALUES (
    coalesce(selected_manual_entry_id, gen_random_uuid()),
    selected_workspace_id,
    selected_project_id,
    entity_row.id,
    selected_origin_kind,
    selected_name,
    selected_product_profile_id,
    selected_profile_version,
    selected_candidate_id,
    selected_field_provenance_path,
    selected_evidence_refs,
    selected_source_review_status,
    selected_source_relationship,
    selected_source_analysis_scope,
    selected_data_snapshot_id,
    selected_normalized_observation_id,
    selected_import_preview_id,
    selected_source_pointer,
    selected_manual_entry_id,
    selected_observed_at
  )
  RETURNING * INTO occurrence_row;

  RETURN QUERY SELECT occurrence_row.id, entity_row.id;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0019_competitor_library_foundation'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0019_competitor_library_foundation.sql

-- BEGIN EXACT ORDERED MIGRATION 0020_content_shadow_foundation.sql
BEGIN;

-- Content Shadow is a first-class shadow-mode capability run. Preserve every
-- historical async-run kind (notably 0014 product_profile_synthesis) while
-- activating the new content_shadow kind and its flow_shadow_run result type.
ALTER TABLE app.async_runs DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs ADD CONSTRAINT async_runs_kind_check
  CHECK (kind IN (
    'collection',
    'diagnostic',
    'artifact_generation',
    'export',
    'product_profile_synthesis',
    'content_shadow'
  ));

ALTER TABLE app.async_runs DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs ADD CONSTRAINT async_runs_result_type_check
  CHECK (result_type IS NULL OR result_type IN (
    'collection_run',
    'diagnostic_run',
    'artifact',
    'export',
    'icp_profile',
    'flow_shadow_run'
  ));

-- english_blog_draft is not a new table: it is an execution_artifact whose type
-- is english_blog_draft, minted only by the Content Shadow worker against the
-- same source Action as its content_brief.
ALTER TABLE app.execution_artifacts
  DROP CONSTRAINT IF EXISTS execution_artifacts_artifact_type_check;
ALTER TABLE app.execution_artifacts
  ADD CONSTRAINT execution_artifacts_artifact_type_check
  CHECK (artifact_type IN (
    'content_brief',
    'metadata_rewrite',
    'technical_ticket',
    'english_blog_draft'
  ));

-- A Content Shadow run is a tenant-scoped projection over one canonical
-- content_shadow capability run. Like audit_runs it has no status column: run
-- lifecycle truth stays in async_runs.status and the phase is derived from
-- which append-only child rows exist. Every input is frozen for deterministic
-- re-render and content-addressed by content_hash.
CREATE TABLE IF NOT EXISTS app.flow_shadow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  capability_run_id uuid NOT NULL UNIQUE
    REFERENCES app.capability_runs(async_run_id) ON DELETE RESTRICT,
  source_finding_id uuid NOT NULL REFERENCES app.findings(id) ON DELETE RESTRICT,
  source_action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  content_brief_artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  content_brief_revision integer NOT NULL CHECK (content_brief_revision >= 1),
  flow_adapter_version text NOT NULL
    CHECK (length(btrim(flow_adapter_version)) BETWEEN 1 AND 200),
  frozen_input_manifest jsonb NOT NULL
    CHECK (jsonb_typeof(frozen_input_manifest) = 'object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  projection_version text NOT NULL CHECK (length(btrim(projection_version)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flow_shadow_runs_project_created_idx
  ON app.flow_shadow_runs(project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS flow_shadow_runs_action_idx
  ON app.flow_shadow_runs(project_id, source_action_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS flow_shadow_runs_content_hash_idx
  ON app.flow_shadow_runs(project_id, content_hash);

-- Read-only research facts for one shadow run. Not an ArtifactType: it is a
-- provenance-guarded child of the run, one pack per run.
CREATE TABLE IF NOT EXISTS app.flow_shadow_research_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  flow_shadow_run_id uuid NOT NULL
    REFERENCES app.flow_shadow_runs(id) ON DELETE RESTRICT,
  analysis_invocation_id uuid
    REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  pack jsonb NOT NULL CHECK (jsonb_typeof(pack) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_shadow_run_id)
);
CREATE INDEX IF NOT EXISTS flow_shadow_research_packs_run_idx
  ON app.flow_shadow_research_packs(project_id, flow_shadow_run_id, id);

-- SEO/GEO + Factual Review verdict for one evaluated draft revision. Append-only
-- ledger; unsupported claims are blocked or flagged needs_review.
CREATE TABLE IF NOT EXISTS app.flow_shadow_qa_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  flow_shadow_run_id uuid NOT NULL
    REFERENCES app.flow_shadow_runs(id) ON DELETE RESTRICT,
  evaluated_artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  evaluated_revision integer NOT NULL CHECK (evaluated_revision >= 1),
  analysis_invocation_id uuid
    REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  verdict text NOT NULL CHECK (verdict IN ('passed','needs_review','blocked')),
  claims jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(claims) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_shadow_run_id, evaluated_artifact_id, evaluated_revision)
);
CREATE INDEX IF NOT EXISTS flow_shadow_qa_gates_run_idx
  ON app.flow_shadow_qa_gates(project_id, flow_shadow_run_id, created_at DESC, id DESC);

-- The canonical run must be a content_shadow shadow-mode internal_write run, the
-- source Finding must be a confirmed content-brief-rule Finding whose frozen
-- diagnosis still owns the Action, and the content_brief revision must exist and
-- belong to the same Action. A faulty worker cannot splice a foreign lineage.
CREATE OR REPLACE FUNCTION app.enforce_flow_shadow_run_provenance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  finding_rule_id text; finding_review_state text; finding_last_seen_run_id uuid;
  action_finding_id uuid; action_status text; action_diag_run_id uuid;
  brief_action_id uuid; brief_type text; brief_current_revision integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.capability_runs capability
    JOIN app.async_runs run ON run.id = capability.async_run_id
    WHERE capability.async_run_id = NEW.capability_run_id
      AND run.workspace_id = NEW.workspace_id AND run.project_id = NEW.project_id
      AND run.kind = 'content_shadow'
      AND capability.mode = 'shadow' AND capability.side_effect_class = 'internal_write'
  ) THEN RAISE EXCEPTION 'flow shadow run capability provenance does not match its canonical run' USING ERRCODE='23514'; END IF;

  SELECT finding.rule_id, finding.review_state, finding.last_seen_run_id
  INTO finding_rule_id, finding_review_state, finding_last_seen_run_id
  FROM app.findings finding
  WHERE finding.id = NEW.source_finding_id AND finding.workspace_id = NEW.workspace_id AND finding.project_id = NEW.project_id;
  IF NOT FOUND OR finding_review_state IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'flow shadow run requires a confirmed source Finding' USING ERRCODE='23514'; END IF;
  IF finding_rule_id NOT IN ('SEARCH-DECAY-002','CONTENT-COVERAGE-001','CONTENT-GAP-011','CRO-LANDING-003') THEN
    RAISE EXCEPTION 'flow shadow run source Finding is not a content-brief rule' USING ERRCODE='23514'; END IF;

  SELECT action.source_finding_id, action.status, action.source_diagnostic_run_id
  INTO action_finding_id, action_status, action_diag_run_id
  FROM app.actions action
  WHERE action.id = NEW.source_action_id AND action.workspace_id = NEW.workspace_id AND action.project_id = NEW.project_id;
  IF NOT FOUND OR action_finding_id IS DISTINCT FROM NEW.source_finding_id OR action_status = 'dismissed' THEN
    RAISE EXCEPTION 'flow shadow run Action does not match its confirmed Finding' USING ERRCODE='23514'; END IF;

  IF finding_last_seen_run_id IS DISTINCT FROM action_diag_run_id THEN
    RAISE EXCEPTION 'flow shadow run Finding moved beyond its frozen diagnosis' USING ERRCODE='23514'; END IF;

  SELECT artifact.action_id, artifact.artifact_type, artifact.current_revision
  INTO brief_action_id, brief_type, brief_current_revision
  FROM app.execution_artifacts artifact
  WHERE artifact.id = NEW.content_brief_artifact_id AND artifact.workspace_id = NEW.workspace_id AND artifact.project_id = NEW.project_id;
  IF NOT FOUND OR brief_action_id IS DISTINCT FROM NEW.source_action_id
     OR brief_type IS DISTINCT FROM 'content_brief' OR brief_current_revision < NEW.content_brief_revision THEN
    RAISE EXCEPTION 'flow shadow run content_brief provenance is invalid' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.artifact_revisions rev
    WHERE rev.artifact_id = NEW.content_brief_artifact_id AND rev.revision = NEW.content_brief_revision
      AND rev.workspace_id = NEW.workspace_id AND rev.project_id = NEW.project_id
  ) THEN RAISE EXCEPTION 'flow shadow run frozen content_brief revision does not exist' USING ERRCODE='23514'; END IF;

  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION app.enforce_flow_shadow_child_provenance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.flow_shadow_runs run
    WHERE run.id = NEW.flow_shadow_run_id AND run.workspace_id = NEW.workspace_id AND run.project_id = NEW.project_id
  ) THEN RAISE EXCEPTION 'flow shadow child provenance does not match its canonical run' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS flow_shadow_runs_provenance_guard ON app.flow_shadow_runs;
CREATE TRIGGER flow_shadow_runs_provenance_guard BEFORE INSERT ON app.flow_shadow_runs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_flow_shadow_run_provenance();
DROP TRIGGER IF EXISTS flow_shadow_runs_append_only ON app.flow_shadow_runs;
CREATE TRIGGER flow_shadow_runs_append_only BEFORE UPDATE OR DELETE ON app.flow_shadow_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS flow_shadow_research_packs_provenance_guard ON app.flow_shadow_research_packs;
CREATE TRIGGER flow_shadow_research_packs_provenance_guard BEFORE INSERT ON app.flow_shadow_research_packs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_flow_shadow_child_provenance();
DROP TRIGGER IF EXISTS flow_shadow_research_packs_append_only ON app.flow_shadow_research_packs;
CREATE TRIGGER flow_shadow_research_packs_append_only BEFORE UPDATE OR DELETE ON app.flow_shadow_research_packs
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS flow_shadow_qa_gates_provenance_guard ON app.flow_shadow_qa_gates;
CREATE TRIGGER flow_shadow_qa_gates_provenance_guard BEFORE INSERT ON app.flow_shadow_qa_gates
  FOR EACH ROW EXECUTE FUNCTION app.enforce_flow_shadow_child_provenance();
DROP TRIGGER IF EXISTS flow_shadow_qa_gates_append_only ON app.flow_shadow_qa_gates;
CREATE TRIGGER flow_shadow_qa_gates_append_only BEFORE UPDATE OR DELETE ON app.flow_shadow_qa_gates
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- The browser must not access these canonical tables directly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.flow_shadow_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.flow_shadow_research_packs FROM anon';
    EXECUTE 'REVOKE ALL ON app.flow_shadow_qa_gates FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.flow_shadow_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.flow_shadow_research_packs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.flow_shadow_qa_gates FROM authenticated';
  END IF;
END; $$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0020_content_shadow_foundation'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0020_content_shadow_foundation.sql

-- BEGIN EXACT ORDERED MIGRATION 0021_content_shadow_invocation_task.sql
BEGIN;

-- The Content Shadow draft is minted through the pinned markdown LLM envelope,
-- so it records an AnalysisInvocation like every other model call. `task` is a
-- closed vocabulary enforced in the database, so admitting the shadow pipeline's
-- own task value is DDL, not only a TypeScript union. Every historical task is
-- preserved; this widens the CHECK and never narrows it.
ALTER TABLE app.analysis_invocations
  DROP CONSTRAINT IF EXISTS analysis_invocations_task_check;
ALTER TABLE app.analysis_invocations
  ADD CONSTRAINT analysis_invocations_task_check
  CHECK (task IN (
    'finding_summary',
    'artifact_generation',
    'product_profile_synthesis',
    'content_shadow_draft'
  ));

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0021_content_shadow_invocation_task'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0021_content_shadow_invocation_task.sql

-- BEGIN EXACT ORDERED MIGRATION 0022_publication_foundation.sql
BEGIN;

-- Publication is a first-class async run. Preserve every historical kind and
-- result type while widening the closed database vocabulary.
ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_kind_check
  CHECK (kind IN (
    'collection',
    'diagnostic',
    'artifact_generation',
    'export',
    'product_profile_synthesis',
    'content_shadow',
    'publication'
  ));

ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_result_type_check
  CHECK (
    result_type IS NULL OR result_type IN (
      'collection_run',
      'diagnostic_run',
      'artifact',
      'export',
      'icp_profile',
      'flow_shadow_run',
      'publication_attempt'
    )
  );

-- A server-issued grant is the durable authority and credential boundary.
-- GitHub stores installation/account/permission lineage only. WordPress stores
-- AES-GCM ciphertext and key metadata; there is no dangling vault:// pointer.
CREATE TABLE IF NOT EXISTS app.delivery_authorization_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  purpose text NOT NULL
    CHECK (purpose IN ('connector_configuration', 'publish', 'rollback')),
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'consumed', 'revoked', 'expired')),
  destination_ref uuid,
  destination_revision integer
    CHECK (destination_revision IS NULL OR destination_revision >= 1),
  target_ref text
    CHECK (
      target_ref IS NULL
      OR length(btrim(target_ref)) BETWEEN 1 AND 2048
    ),
  requested_scope jsonb NOT NULL
    CHECK (jsonb_typeof(requested_scope) = 'object'),
  requested_scope_hash text NOT NULL
    CHECK (requested_scope_hash ~ '^[a-f0-9]{64}$'),
  authorization_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  authorization_snapshot_hash text NOT NULL
    CHECK (authorization_snapshot_hash ~ '^[a-f0-9]{64}$'),
  encrypted_payload bytea,
  cipher_version smallint CHECK (cipher_version IS NULL OR cipher_version >= 1),
  key_version text
    CHECK (key_version IS NULL OR length(btrim(key_version)) >= 1),
  secret_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(secret_metadata) = 'object'),
  expires_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text
    CHECK (
      revocation_reason IS NULL
      OR length(btrim(revocation_reason)) BETWEEN 3 AND 1000
    ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  CHECK (
    (
      destination_ref IS NULL
      AND destination_revision IS NULL
      AND target_ref IS NULL
    )
    OR (
      destination_ref IS NOT NULL
      AND destination_revision IS NOT NULL
      AND target_ref IS NOT NULL
    )
  ),
  CHECK (
    purpose = 'connector_configuration'
    OR expires_at IS NOT NULL
  ),
  CHECK (
    state <> 'consumed'
    OR expires_at IS NULL
    OR consumed_at <= expires_at
  ),
  CHECK (
    (
      provider_kind = 'github'
      AND encrypted_payload IS NULL
      AND cipher_version IS NULL
      AND key_version IS NULL
      AND secret_metadata = '{}'::jsonb
    )
    OR (
      provider_kind = 'wordpress'
      AND encrypted_payload IS NOT NULL
      AND octet_length(encrypted_payload) >= 32
      AND cipher_version IS NOT NULL
      AND key_version IS NOT NULL
    )
  ),
  CHECK (
    (
      state = 'ready'
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND revoked_by IS NULL
      AND revocation_reason IS NULL
    )
    OR (
      state = 'consumed'
      AND consumed_at IS NOT NULL
      AND revoked_at IS NULL
      AND revoked_by IS NULL
      AND revocation_reason IS NULL
    )
    OR (
      state = 'revoked'
      AND revoked_at IS NOT NULL
      AND revoked_by IS NOT NULL
      AND revocation_reason IS NOT NULL
    )
    OR (
      state = 'expired'
      AND expires_at IS NOT NULL
      AND consumed_at IS NULL
      AND revoked_at IS NULL
      AND revoked_by IS NULL
      AND revocation_reason IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS delivery_authorization_grants_project_state_idx
  ON app.delivery_authorization_grants(
    workspace_id,
    project_id,
    state,
    expires_at,
    created_at DESC,
    id DESC
  );

-- A ready Artifact is not approval authority. This append-only event ledger
-- binds one authenticated reviewer to one exact immutable revision and QA gate.
CREATE TABLE IF NOT EXISTS app.artifact_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL
    REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
  artifact_revision integer NOT NULL CHECK (artifact_revision >= 1),
  artifact_content_hash text NOT NULL
    CHECK (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  event_kind text NOT NULL
    CHECK (event_kind IN ('approved', 'revoked', 'superseded')),
  supersedes_approval_event_id uuid,
  supersedes_approval_event_kind text,
  event_actor_id uuid NOT NULL,
  reviewer_actor_id uuid,
  qa_gate_version text NOT NULL
    CHECK (length(btrim(qa_gate_version)) BETWEEN 1 AND 100),
  qa_gate_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(qa_gate_snapshot) = 'object'),
  qa_gate_snapshot_hash text NOT NULL
    CHECK (qa_gate_snapshot_hash ~ '^[a-f0-9]{64}$'),
  customer_acknowledgement jsonb NOT NULL
    CHECK (
      jsonb_typeof(customer_acknowledgement) = 'object'
      AND customer_acknowledgement ? 'customerAcknowledgementId'
      AND customer_acknowledgement ? 'actorId'
      AND customer_acknowledgement ? 'acknowledgedAt'
      AND customer_acknowledgement ? 'acknowledgementScope'
    ),
  customer_acknowledgement_hash text NOT NULL
    CHECK (customer_acknowledgement_hash ~ '^[a-f0-9]{64}$'),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (id, event_kind),
  FOREIGN KEY (
    supersedes_approval_event_id,
    supersedes_approval_event_kind
  )
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  CHECK (
    (
      event_kind = 'approved'
      AND supersedes_approval_event_id IS NULL
      AND supersedes_approval_event_kind IS NULL
      AND reviewer_actor_id IS NOT NULL
      AND event_actor_id = reviewer_actor_id
      AND reason IS NULL
    )
    OR (
      event_kind IN ('revoked', 'superseded')
      AND supersedes_approval_event_id IS NOT NULL
      AND supersedes_approval_event_kind = 'approved'
      AND reviewer_actor_id IS NULL
      AND length(btrim(reason)) >= 3
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS artifact_approval_events_one_approval_per_revision_idx
  ON app.artifact_approval_events(
    workspace_id,
    project_id,
    artifact_revision_id
  )
  WHERE event_kind = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS artifact_approval_events_one_terminal_per_event_idx
  ON app.artifact_approval_events(supersedes_approval_event_id)
  WHERE event_kind IN ('revoked', 'superseded');

CREATE INDEX IF NOT EXISTS artifact_approval_events_artifact_timeline_idx
  ON app.artifact_approval_events(
    workspace_id,
    project_id,
    artifact_id,
    created_at,
    id
  );

-- Delivery connections are append-only revisions. Each non-revocation revision
-- consumes one exact connector_configuration grant.
CREATE TABLE IF NOT EXISTS app.publication_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_ref uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  supersedes_id uuid
    REFERENCES app.publication_destinations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  target_ref text NOT NULL
    CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  state text NOT NULL
    CHECK (state IN ('pending', 'ready', 'unavailable', 'revoked')),
  authorization_grant_id uuid NOT NULL
    REFERENCES app.delivery_authorization_grants(id) ON DELETE RESTRICT,
  provider_scope jsonb NOT NULL
    CHECK (jsonb_typeof(provider_scope) = 'object'),
  provider_scope_hash text NOT NULL
    CHECK (provider_scope_hash ~ '^[a-f0-9]{64}$'),
  authorization_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  authorization_snapshot_hash text NOT NULL
    CHECK (authorization_snapshot_hash ~ '^[a-f0-9]{64}$'),
  readiness_observation jsonb NOT NULL
    CHECK (jsonb_typeof(readiness_observation) = 'object'),
  limitation text
    CHECK (
      limitation IS NULL
      OR length(btrim(limitation)) BETWEEN 1 AND 2000
    ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, destination_ref, revision),
  UNIQUE (workspace_id, project_id, id),
  CHECK (
    (revision = 1 AND supersedes_id IS NULL)
    OR (revision > 1 AND supersedes_id IS NOT NULL)
  ),
  CHECK (
    state <> 'revoked'
    OR (revision > 1 AND supersedes_id IS NOT NULL)
  ),
  CHECK (state <> 'ready' OR limitation IS NULL),
  CHECK (
    state NOT IN ('unavailable', 'revoked')
    OR limitation IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS publication_destinations_project_ref_revision_idx
  ON app.publication_destinations(
    workspace_id,
    project_id,
    destination_ref,
    revision DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS publication_destinations_one_consuming_grant_idx
  ON app.publication_destinations(authorization_grant_id)
  WHERE state <> 'revoked';

-- A preview is server-issued publication authority, not browser-owned plan
-- data. Each issued event freezes one exact Artifact Revision, approval,
-- Destination Revision, provider plan and rollback plan. Revocation and
-- supersession are append-only terminal events that preserve that lineage.
CREATE TABLE IF NOT EXISTS app.publication_preview_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_ref text NOT NULL
    CHECK (
      length(preview_ref) BETWEEN 32 AND 1024
      AND preview_ref ~ '^[A-Za-z0-9._~-]+$'
    ),
  event_kind text NOT NULL
    CHECK (event_kind IN ('issued', 'revoked', 'superseded')),
  supersedes_preview_event_id uuid,
  supersedes_preview_event_kind text,
  preview_kind text NOT NULL
    CHECK (preview_kind IN ('publish', 'rollback')),
  facts_schema_version text NOT NULL
    CHECK (length(btrim(facts_schema_version)) BETWEEN 1 AND 100),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  destination_id uuid NOT NULL
    REFERENCES app.publication_destinations(id) ON DELETE RESTRICT,
  destination_ref uuid NOT NULL,
  destination_revision integer NOT NULL CHECK (destination_revision >= 1),
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  target_ref text NOT NULL
    CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL
    REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
  artifact_revision integer NOT NULL CHECK (artifact_revision >= 1),
  artifact_content_hash text NOT NULL
    CHECK (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  artifact_approval_event_id uuid NOT NULL,
  artifact_approval_event_kind text NOT NULL,
  source_publication_attempt_id uuid,
  source_change_receipt_id uuid,
  provider_plan jsonb NOT NULL
    CHECK (
      jsonb_typeof(provider_plan) = 'object'
      AND provider_plan ? 'providerKind'
    ),
  remote_precondition jsonb NOT NULL
    CHECK (
      jsonb_typeof(remote_precondition) = 'object'
      AND remote_precondition ? 'kind'
    ),
  rollback_plan jsonb NOT NULL
    CHECK (
      jsonb_typeof(rollback_plan) = 'object'
      AND rollback_plan ? 'providerKind'
    ),
  preview_checksum text NOT NULL
    CHECK (preview_checksum ~ '^[a-f0-9]{64}$'),
  content_checksum text NOT NULL
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  facts_hash text NOT NULL CHECK (facts_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  event_actor_id uuid NOT NULL,
  idempotency_key text NOT NULL
    CHECK (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key ~ '^[ -~]+$'
    ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  reason text
    CHECK (
      reason IS NULL
      OR length(btrim(reason)) BETWEEN 3 AND 2000
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (id, event_kind),
  UNIQUE (workspace_id, project_id, idempotency_key),
  FOREIGN KEY (
    supersedes_preview_event_id,
    supersedes_preview_event_kind
  )
    REFERENCES app.publication_preview_events(id, event_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    artifact_approval_event_id,
    artifact_approval_event_kind
  )
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  CHECK (artifact_approval_event_kind = 'approved'),
  CHECK (preview_checksum = artifact_content_hash),
  CHECK (provider_plan->>'providerKind' = provider_kind),
  CHECK (rollback_plan->>'providerKind' = provider_kind),
  CHECK (expires_at > created_at),
  CHECK (
    (
      event_kind = 'issued'
      AND supersedes_preview_event_id IS NULL
      AND supersedes_preview_event_kind IS NULL
      AND reason IS NULL
    )
    OR (
      event_kind IN ('revoked', 'superseded')
      AND supersedes_preview_event_id IS NOT NULL
      AND supersedes_preview_event_kind = 'issued'
      AND reason IS NOT NULL
    )
  ),
  CHECK (
    (
      preview_kind = 'publish'
      AND source_publication_attempt_id IS NULL
      AND source_change_receipt_id IS NULL
    )
    OR (
      preview_kind = 'rollback'
      AND source_publication_attempt_id IS NOT NULL
      AND source_change_receipt_id IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS publication_preview_events_issued_ref_idx
  ON app.publication_preview_events(
    workspace_id,
    project_id,
    preview_ref
  )
  WHERE event_kind = 'issued';

CREATE UNIQUE INDEX IF NOT EXISTS publication_preview_events_one_terminal_per_event_idx
  ON app.publication_preview_events(supersedes_preview_event_id)
  WHERE event_kind IN ('revoked', 'superseded');

CREATE INDEX IF NOT EXISTS publication_preview_events_project_ref_timeline_idx
  ON app.publication_preview_events(
    workspace_id,
    project_id,
    preview_ref,
    created_at,
    id
  );

CREATE INDEX IF NOT EXISTS publication_preview_events_artifact_destination_idx
  ON app.publication_preview_events(
    workspace_id,
    project_id,
    artifact_revision_id,
    destination_ref,
    destination_revision,
    created_at DESC
  )
  WHERE event_kind = 'issued';

-- Frozen external-write requests. Lifecycle status is intentionally absent:
-- app.async_runs is the only queued/running/terminal truth.
CREATE TABLE IF NOT EXISTS app.publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_kind text NOT NULL
    CHECK (attempt_kind IN ('publish', 'rollback')),
  source_publication_attempt_id uuid
    REFERENCES app.publication_attempts(id) ON DELETE RESTRICT,
  source_change_receipt_id uuid,
  preview_event_id uuid NOT NULL,
  preview_event_kind text NOT NULL
    CHECK (preview_event_kind = 'issued'),
  preview_facts_hash text NOT NULL
    CHECK (preview_facts_hash ~ '^[a-f0-9]{64}$'),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  async_run_id uuid NOT NULL UNIQUE
    REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  destination_id uuid NOT NULL
    REFERENCES app.publication_destinations(id) ON DELETE RESTRICT,
  destination_ref uuid NOT NULL,
  destination_revision integer NOT NULL CHECK (destination_revision >= 1),
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  target_ref text NOT NULL
    CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL
    REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
  approved_artifact_revision integer NOT NULL
    CHECK (approved_artifact_revision >= 1),
  approved_artifact_content_hash text NOT NULL
    CHECK (approved_artifact_content_hash ~ '^[a-f0-9]{64}$'),
  publication_approval_event_id uuid,
  publication_approval_event_kind text,
  source_approval_event_id uuid,
  source_approval_event_kind text,
  side_effect_class text NOT NULL CHECK (side_effect_class = 'external_write'),
  authorization_grant_id uuid NOT NULL UNIQUE
    REFERENCES app.delivery_authorization_grants(id) ON DELETE RESTRICT,
  authorization_purpose text NOT NULL
    CHECK (authorization_purpose IN ('publish', 'rollback')),
  authorization_snapshot jsonb NOT NULL
    CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  authorization_snapshot_hash text NOT NULL
    CHECK (authorization_snapshot_hash ~ '^[a-f0-9]{64}$'),
  preview_ref text NOT NULL
    CHECK (length(btrim(preview_ref)) BETWEEN 1 AND 1024),
  preview_checksum text NOT NULL
    CHECK (preview_checksum ~ '^[a-f0-9]{64}$'),
  content_checksum text NOT NULL
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  remote_precondition jsonb NOT NULL
    CHECK (
      jsonb_typeof(remote_precondition) = 'object'
      AND remote_precondition ? 'kind'
    ),
  rollback_plan jsonb NOT NULL
    CHECK (jsonb_typeof(rollback_plan) = 'object'),
  idempotency_key text NOT NULL
    CHECK (
      length(idempotency_key) BETWEEN 1 AND 128
      AND idempotency_key ~ '^[ -~]+$'
    ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, idempotency_key),
  UNIQUE (workspace_id, project_id, preview_event_id),
  UNIQUE (
    workspace_id,
    project_id,
    destination_ref,
    destination_revision,
    request_hash
  ),
  FOREIGN KEY (
    preview_event_id,
    preview_event_kind
  )
    REFERENCES app.publication_preview_events(id, event_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    publication_approval_event_id,
    publication_approval_event_kind
  )
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    source_approval_event_id,
    source_approval_event_kind
  )
    REFERENCES app.artifact_approval_events(id, event_kind)
    ON DELETE RESTRICT,
  CHECK (
    (
      attempt_kind = 'publish'
      AND source_publication_attempt_id IS NULL
      AND source_change_receipt_id IS NULL
      AND publication_approval_event_id IS NOT NULL
      AND publication_approval_event_kind = 'approved'
      AND source_approval_event_id IS NULL
      AND source_approval_event_kind IS NULL
      AND authorization_purpose = 'publish'
    )
    OR (
      attempt_kind = 'rollback'
      AND source_publication_attempt_id IS NOT NULL
      AND source_change_receipt_id IS NOT NULL
      AND publication_approval_event_id IS NULL
      AND publication_approval_event_kind IS NULL
      AND source_approval_event_id IS NOT NULL
      AND source_approval_event_kind = 'approved'
      AND authorization_purpose = 'rollback'
    )
  )
);

CREATE INDEX IF NOT EXISTS publication_attempts_target_timeline_idx
  ON app.publication_attempts(
    workspace_id,
    project_id,
    target_ref,
    requested_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS publication_attempts_source_idx
  ON app.publication_attempts(
    workspace_id,
    project_id,
    source_publication_attempt_id
  )
  WHERE source_publication_attempt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.publication_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  publication_attempt_id uuid NOT NULL
    REFERENCES app.publication_attempts(id) ON DELETE RESTRICT,
  receipt_kind text NOT NULL
    CHECK (receipt_kind IN ('delivery_receipt', 'change_receipt')),
  predecessor_delivery_receipt_id uuid
    REFERENCES app.publication_receipts(id) ON DELETE RESTRICT,
  provider_kind text NOT NULL CHECK (provider_kind IN ('github', 'wordpress')),
  provider_request_id text
    CHECK (
      provider_request_id IS NULL
      OR length(btrim(provider_request_id)) BETWEEN 1 AND 512
    ),
  remote_scope_ref text NOT NULL
    CHECK (length(btrim(remote_scope_ref)) BETWEEN 1 AND 1024),
  remote_object_kind text NOT NULL
    CHECK (
      remote_object_kind IN (
        'github_pull_request',
        'github_merge',
        'wordpress_post',
        'wordpress_revision'
      )
    ),
  remote_object_id text NOT NULL
    CHECK (length(btrim(remote_object_id)) BETWEEN 1 AND 512),
  remote_revision text NOT NULL
    CHECK (length(btrim(remote_revision)) BETWEEN 1 AND 512),
  delivery_url text CHECK (delivery_url IS NULL OR delivery_url ~ '^https?://'),
  live_canonical_url text
    CHECK (live_canonical_url IS NULL OR live_canonical_url ~ '^https?://'),
  artifact_content_hash text NOT NULL
    CHECK (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  content_checksum text NOT NULL
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  verification_state text NOT NULL
    CHECK (
      verification_state IN (
        'provider_accepted',
        'pending',
        'verified_live',
        'unavailable'
      )
    ),
  remote_facts jsonb NOT NULL CHECK (jsonb_typeof(remote_facts) = 'object'),
  evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(evidence_refs) = 'array'),
  limitation text
    CHECK (
      limitation IS NULL
      OR length(btrim(limitation)) BETWEEN 1 AND 2000
    ),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (publication_attempt_id, receipt_kind),
  CHECK (
    (
      receipt_kind = 'delivery_receipt'
      AND predecessor_delivery_receipt_id IS NULL
      AND live_canonical_url IS NULL
      AND verification_state IN ('provider_accepted', 'pending', 'unavailable')
      AND remote_object_kind IN ('github_pull_request', 'wordpress_post')
      AND (
        verification_state <> 'unavailable'
        OR limitation IS NOT NULL
      )
    )
    OR (
      receipt_kind = 'change_receipt'
      AND predecessor_delivery_receipt_id IS NOT NULL
      AND verification_state = 'verified_live'
      AND live_canonical_url IS NOT NULL
      AND jsonb_array_length(evidence_refs) >= 1
      AND limitation IS NULL
      AND remote_object_kind IN ('github_merge', 'wordpress_revision')
    )
  ),
  CHECK (
    (
      provider_kind = 'github'
      AND remote_object_kind IN ('github_pull_request', 'github_merge')
    )
    OR (
      provider_kind = 'wordpress'
      AND remote_object_kind IN ('wordpress_post', 'wordpress_revision')
    )
  )
);

ALTER TABLE app.publication_attempts
  ADD CONSTRAINT publication_attempts_source_change_receipt_fk
  FOREIGN KEY (source_change_receipt_id)
  REFERENCES app.publication_receipts(id)
  ON DELETE RESTRICT;

ALTER TABLE app.publication_preview_events
  ADD CONSTRAINT publication_preview_events_source_attempt_fk
  FOREIGN KEY (source_publication_attempt_id)
  REFERENCES app.publication_attempts(id)
  ON DELETE RESTRICT;

ALTER TABLE app.publication_preview_events
  ADD CONSTRAINT publication_preview_events_source_change_receipt_fk
  FOREIGN KEY (source_change_receipt_id)
  REFERENCES app.publication_receipts(id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS publication_receipts_attempt_timeline_idx
  ON app.publication_receipts(
    workspace_id,
    project_id,
    publication_attempt_id,
    observed_at,
    id
  );

COMMENT ON COLUMN app.publication_attempts.approved_artifact_content_hash IS
  'JCS SHA-256 identity of the approved Artifact content object';
COMMENT ON COLUMN app.publication_preview_events.preview_checksum IS
  'JCS SHA-256 identity of the exact immutable Artifact Revision';
COMMENT ON COLUMN app.publication_preview_events.content_checksum IS
  'SHA-256 of the exact UTF-8 content bytes the provider plan will write';
COMMENT ON COLUMN app.publication_preview_events.facts_hash IS
  'JCS SHA-256 of the complete server-issued publication preview facts';
COMMENT ON COLUMN app.publication_attempts.preview_checksum IS
  'JCS SHA-256 identity of the exact approved Artifact preview';
COMMENT ON COLUMN app.publication_attempts.content_checksum IS
  'SHA-256 of the exact UTF-8 content bytes submitted to the provider';
COMMENT ON COLUMN app.publication_receipts.artifact_content_hash IS
  'JCS SHA-256 identity of the approved Artifact bound to this receipt';
COMMENT ON COLUMN app.publication_receipts.content_checksum IS
  'SHA-256 of the exact provider content bytes observed by this receipt';

CREATE OR REPLACE FUNCTION app.enforce_delivery_authorization_grant_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM app.sites site_row
        JOIN app.client_projects project_row
          ON project_row.id = site_row.project_id
         AND project_row.workspace_id = site_row.workspace_id
       WHERE site_row.id = NEW.site_id
         AND site_row.workspace_id = NEW.workspace_id
         AND site_row.project_id = NEW.project_id
         AND project_row.id = NEW.project_id
         AND project_row.archived_at IS NULL
    ) THEN
      RAISE EXCEPTION
        'delivery authorization grant requires an active same-scope site and project'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.purpose IN ('publish', 'rollback')
       AND (NEW.expires_at IS NULL OR NEW.expires_at <= now()) THEN
      RAISE EXCEPTION
        'publish and rollback authorization grants require a future expiry'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.provider_kind IS DISTINCT FROM OLD.provider_kind
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.destination_ref IS DISTINCT FROM OLD.destination_ref
     OR NEW.destination_revision IS DISTINCT FROM OLD.destination_revision
     OR NEW.target_ref IS DISTINCT FROM OLD.target_ref
     OR NEW.requested_scope IS DISTINCT FROM OLD.requested_scope
     OR NEW.requested_scope_hash IS DISTINCT FROM OLD.requested_scope_hash
     OR NEW.authorization_snapshot IS DISTINCT FROM OLD.authorization_snapshot
     OR NEW.authorization_snapshot_hash IS DISTINCT FROM OLD.authorization_snapshot_hash
     OR NEW.encrypted_payload IS DISTINCT FROM OLD.encrypted_payload
     OR NEW.cipher_version IS DISTINCT FROM OLD.cipher_version
     OR NEW.key_version IS DISTINCT FROM OLD.key_version
     OR NEW.secret_metadata IS DISTINCT FROM OLD.secret_metadata
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'delivery authorization grant immutable facts cannot change'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'ready' AND NEW.state IN ('consumed', 'revoked', 'expired') THEN
    RETURN NEW;
  END IF;
  IF OLD.state = 'consumed' AND NEW.state = 'revoked' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'delivery authorization grant transition is invalid'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_artifact_approval_event_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  artifact_row app.execution_artifacts%ROWTYPE;
  revision_row app.artifact_revisions%ROWTYPE;
  source_row app.artifact_approval_events%ROWTYPE;
BEGIN
  IF NEW.event_kind = 'approved' THEN
    SELECT * INTO artifact_row
      FROM app.execution_artifacts
     WHERE id = NEW.artifact_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
     FOR UPDATE;
    SELECT * INTO revision_row
      FROM app.artifact_revisions
     WHERE id = NEW.artifact_revision_id
       AND artifact_id = NEW.artifact_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id;
    IF artifact_row.id IS NULL
       OR revision_row.id IS NULL
       OR artifact_row.status <> 'ready'
       OR artifact_row.validation_state <> 'valid'
       OR artifact_row.current_revision <> NEW.artifact_revision
       OR artifact_row.content_hash IS DISTINCT FROM NEW.artifact_content_hash
       OR revision_row.revision <> NEW.artifact_revision
       OR revision_row.content_hash IS DISTINCT FROM NEW.artifact_content_hash THEN
      RAISE EXCEPTION 'approval requires the exact current ready Artifact Revision'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO source_row
    FROM app.artifact_approval_events
   WHERE id = NEW.supersedes_approval_event_id
     AND event_kind = 'approved'
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND artifact_id = NEW.artifact_id
   FOR UPDATE;
  IF source_row.id IS NULL
     OR NEW.artifact_revision_id IS DISTINCT FROM source_row.artifact_revision_id
     OR NEW.artifact_revision IS DISTINCT FROM source_row.artifact_revision
     OR NEW.artifact_content_hash IS DISTINCT FROM source_row.artifact_content_hash
     OR NEW.qa_gate_version IS DISTINCT FROM source_row.qa_gate_version
     OR NEW.qa_gate_snapshot IS DISTINCT FROM source_row.qa_gate_snapshot
     OR NEW.qa_gate_snapshot_hash IS DISTINCT FROM source_row.qa_gate_snapshot_hash
     OR NEW.customer_acknowledgement IS DISTINCT FROM source_row.customer_acknowledgement
     OR NEW.customer_acknowledgement_hash IS DISTINCT FROM source_row.customer_acknowledgement_hash THEN
    RAISE EXCEPTION 'terminal approval event must preserve source approval lineage'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_publication_destination_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  predecessor app.publication_destinations%ROWTYPE;
  grant_row app.delivery_authorization_grants%ROWTYPE;
BEGIN
  IF NEW.revision = 1 THEN
    IF EXISTS (
      SELECT 1 FROM app.publication_destinations
       WHERE workspace_id = NEW.workspace_id
         AND project_id = NEW.project_id
         AND destination_ref = NEW.destination_ref
    ) THEN
      RAISE EXCEPTION 'destination revision 1 already exists'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO predecessor
      FROM app.publication_destinations
     WHERE id = NEW.supersedes_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND destination_ref = NEW.destination_ref
     FOR UPDATE;
    IF predecessor.id IS NULL
       OR predecessor.revision <> NEW.revision - 1
       OR predecessor.site_id IS DISTINCT FROM NEW.site_id
       OR predecessor.provider_kind IS DISTINCT FROM NEW.provider_kind
       OR predecessor.target_ref IS DISTINCT FROM NEW.target_ref THEN
      RAISE EXCEPTION 'destination revision does not supersede its exact predecessor'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT * INTO grant_row
    FROM app.delivery_authorization_grants
   WHERE id = NEW.authorization_grant_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND provider_kind = NEW.provider_kind
   FOR UPDATE;
  IF grant_row.id IS NULL THEN
    RAISE EXCEPTION 'destination authorization grant scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'revoked' THEN
    IF NEW.revision = 1
       OR predecessor.state = 'revoked'
       OR NEW.authorization_grant_id IS DISTINCT FROM predecessor.authorization_grant_id
       OR NEW.authorization_snapshot IS DISTINCT FROM predecessor.authorization_snapshot
       OR NEW.authorization_snapshot_hash IS DISTINCT FROM predecessor.authorization_snapshot_hash THEN
      RAISE EXCEPTION 'revocation must preserve predecessor authorization lineage'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF grant_row.purpose <> 'connector_configuration'
     OR grant_row.state <> 'ready'
     OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= now())
     OR grant_row.destination_ref IS DISTINCT FROM NEW.destination_ref
     OR grant_row.destination_revision IS DISTINCT FROM NEW.revision
     OR grant_row.target_ref IS DISTINCT FROM NEW.target_ref
     OR NOT (NEW.provider_scope @> grant_row.requested_scope)
     OR grant_row.authorization_snapshot IS DISTINCT FROM NEW.authorization_snapshot
     OR grant_row.authorization_snapshot_hash IS DISTINCT FROM NEW.authorization_snapshot_hash THEN
    RAISE EXCEPTION 'destination requires a current exact connector authorization grant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_publication_preview_event_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_project_id uuid;
  destination_row app.publication_destinations%ROWTYPE;
  artifact_row app.execution_artifacts%ROWTYPE;
  revision_row app.artifact_revisions%ROWTYPE;
  approval_row app.artifact_approval_events%ROWTYPE;
  source_attempt app.publication_attempts%ROWTYPE;
  source_row app.publication_preview_events%ROWTYPE;
  expected_source_approval uuid;
BEGIN
  -- Terminal events are allowed after project archive because they only reduce
  -- authority. They must target one still-current issued event and repeat every
  -- immutable publication fact byte-for-byte.
  IF NEW.event_kind <> 'issued' THEN
    SELECT * INTO source_row
      FROM app.publication_preview_events
     WHERE id = NEW.supersedes_preview_event_id
       AND event_kind = 'issued'
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND preview_ref = NEW.preview_ref
     FOR UPDATE;
    IF source_row.id IS NULL
       OR source_row.expires_at <= now()
       OR EXISTS (
         SELECT 1
           FROM app.publication_preview_events terminal
          WHERE terminal.supersedes_preview_event_id = source_row.id
       )
       OR EXISTS (
         SELECT 1
           FROM app.publication_attempts consumed_attempt
          WHERE consumed_attempt.workspace_id = NEW.workspace_id
            AND consumed_attempt.project_id = NEW.project_id
            AND consumed_attempt.preview_event_id = source_row.id
       )
       OR NEW.preview_kind IS DISTINCT FROM source_row.preview_kind
       OR NEW.facts_schema_version IS DISTINCT FROM source_row.facts_schema_version
       OR NEW.workspace_id IS DISTINCT FROM source_row.workspace_id
       OR NEW.project_id IS DISTINCT FROM source_row.project_id
       OR NEW.site_id IS DISTINCT FROM source_row.site_id
       OR NEW.destination_id IS DISTINCT FROM source_row.destination_id
       OR NEW.destination_ref IS DISTINCT FROM source_row.destination_ref
       OR NEW.destination_revision IS DISTINCT FROM source_row.destination_revision
       OR NEW.provider_kind IS DISTINCT FROM source_row.provider_kind
       OR NEW.target_ref IS DISTINCT FROM source_row.target_ref
       OR NEW.action_id IS DISTINCT FROM source_row.action_id
       OR NEW.artifact_id IS DISTINCT FROM source_row.artifact_id
       OR NEW.artifact_revision_id IS DISTINCT FROM source_row.artifact_revision_id
       OR NEW.artifact_revision IS DISTINCT FROM source_row.artifact_revision
       OR NEW.artifact_content_hash IS DISTINCT FROM source_row.artifact_content_hash
       OR NEW.artifact_approval_event_id IS DISTINCT FROM source_row.artifact_approval_event_id
       OR NEW.artifact_approval_event_kind IS DISTINCT FROM source_row.artifact_approval_event_kind
       OR NEW.source_publication_attempt_id IS DISTINCT FROM source_row.source_publication_attempt_id
       OR NEW.source_change_receipt_id IS DISTINCT FROM source_row.source_change_receipt_id
       OR NEW.provider_plan IS DISTINCT FROM source_row.provider_plan
       OR NEW.remote_precondition IS DISTINCT FROM source_row.remote_precondition
       OR NEW.rollback_plan IS DISTINCT FROM source_row.rollback_plan
       OR NEW.preview_checksum IS DISTINCT FROM source_row.preview_checksum
       OR NEW.content_checksum IS DISTINCT FROM source_row.content_checksum
       OR NEW.facts_hash IS DISTINCT FROM source_row.facts_hash
       OR NEW.expires_at IS DISTINCT FROM source_row.expires_at THEN
      RAISE EXCEPTION
        'terminal preview event must preserve the exact issued preview lineage'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT project_row.id INTO active_project_id
    FROM app.sites site_row
    JOIN app.client_projects project_row
      ON project_row.id = site_row.project_id
     AND project_row.workspace_id = site_row.workspace_id
   WHERE site_row.id = NEW.site_id
     AND site_row.workspace_id = NEW.workspace_id
     AND site_row.project_id = NEW.project_id
     AND project_row.id = NEW.project_id
     AND project_row.archived_at IS NULL
   FOR SHARE OF site_row, project_row;
  IF active_project_id IS NULL OR NEW.expires_at <= now() THEN
    RAISE EXCEPTION
      'issued publication preview requires an active project and future expiry'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO destination_row
    FROM app.publication_destinations candidate_destination
   WHERE candidate_destination.id = NEW.destination_id
     AND candidate_destination.workspace_id = NEW.workspace_id
     AND candidate_destination.project_id = NEW.project_id
     AND candidate_destination.site_id = NEW.site_id
     AND candidate_destination.destination_ref = NEW.destination_ref
     AND candidate_destination.revision = NEW.destination_revision
     AND candidate_destination.provider_kind = NEW.provider_kind
     AND candidate_destination.target_ref = NEW.target_ref
     AND candidate_destination.state = 'ready'
   FOR SHARE;
  IF destination_row.id IS NULL
     OR EXISTS (
       SELECT 1
         FROM app.publication_destinations newer
        WHERE newer.workspace_id = NEW.workspace_id
          AND newer.project_id = NEW.project_id
          AND newer.destination_ref = NEW.destination_ref
          AND newer.revision > NEW.destination_revision
     ) THEN
    RAISE EXCEPTION
      'issued publication preview requires the latest ready destination'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO artifact_row
    FROM app.execution_artifacts
   WHERE id = NEW.artifact_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND action_id = NEW.action_id
   FOR SHARE;
  SELECT * INTO revision_row
    FROM app.artifact_revisions
   WHERE id = NEW.artifact_revision_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND artifact_id = NEW.artifact_id
     AND revision = NEW.artifact_revision
     AND content_hash = NEW.artifact_content_hash
   FOR SHARE;
  IF artifact_row.id IS NULL
     OR revision_row.id IS NULL
     OR NEW.preview_checksum IS DISTINCT FROM NEW.artifact_content_hash THEN
    RAISE EXCEPTION
      'issued publication preview Artifact lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.preview_kind = 'publish' THEN
    IF artifact_row.status <> 'ready'
       OR artifact_row.validation_state <> 'valid'
       OR artifact_row.current_revision <> NEW.artifact_revision
       OR artifact_row.content_hash IS DISTINCT FROM
         NEW.artifact_content_hash THEN
      RAISE EXCEPTION
        'publish preview requires the exact current ready Artifact Revision'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO approval_row
      FROM app.artifact_approval_events candidate_approval
     WHERE candidate_approval.id = NEW.artifact_approval_event_id
       AND candidate_approval.workspace_id = NEW.workspace_id
       AND candidate_approval.project_id = NEW.project_id
       AND candidate_approval.event_kind = 'approved'
       AND candidate_approval.artifact_id = NEW.artifact_id
       AND candidate_approval.artifact_revision_id = NEW.artifact_revision_id
       AND candidate_approval.artifact_revision = NEW.artifact_revision
       AND candidate_approval.artifact_content_hash = NEW.artifact_content_hash
     FOR SHARE;
    IF approval_row.id IS NULL
       OR EXISTS (
         SELECT 1
           FROM app.artifact_approval_events terminal
          WHERE terminal.workspace_id = NEW.workspace_id
            AND terminal.project_id = NEW.project_id
            AND terminal.supersedes_approval_event_id = approval_row.id
       ) THEN
      RAISE EXCEPTION
        'publish preview requires one current exact Artifact approval'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO source_attempt
      FROM app.publication_attempts
     WHERE id = NEW.source_publication_attempt_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND site_id = NEW.site_id
       AND destination_ref = NEW.destination_ref
       AND provider_kind = NEW.provider_kind
       AND target_ref = NEW.target_ref
     FOR SHARE;
    expected_source_approval := COALESCE(
      source_attempt.publication_approval_event_id,
      source_attempt.source_approval_event_id
    );
    IF source_attempt.id IS NULL
       OR expected_source_approval IS DISTINCT FROM NEW.artifact_approval_event_id
       OR source_attempt.action_id IS DISTINCT FROM NEW.action_id
       OR source_attempt.artifact_id IS DISTINCT FROM NEW.artifact_id
       OR source_attempt.artifact_revision_id IS DISTINCT FROM NEW.artifact_revision_id
       OR source_attempt.approved_artifact_revision IS DISTINCT FROM NEW.artifact_revision
       OR source_attempt.approved_artifact_content_hash IS DISTINCT FROM NEW.artifact_content_hash
       OR NOT EXISTS (
         SELECT 1
           FROM app.publication_receipts source_change
          WHERE source_change.id = NEW.source_change_receipt_id
            AND source_change.publication_attempt_id = source_attempt.id
            AND source_change.workspace_id = NEW.workspace_id
            AND source_change.project_id = NEW.project_id
            AND source_change.site_id = NEW.site_id
            AND source_change.provider_kind = NEW.provider_kind
            AND source_change.receipt_kind = 'change_receipt'
            AND source_change.verification_state = 'verified_live'
            AND source_change.artifact_content_hash =
              source_attempt.approved_artifact_content_hash
            AND source_change.content_checksum = source_attempt.content_checksum
       ) THEN
      RAISE EXCEPTION
        'rollback preview requires a same-scope source with verified change'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_publication_attempt_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_project_id uuid;
  preview_row app.publication_preview_events%ROWTYPE;
  destination_row app.publication_destinations%ROWTYPE;
  grant_row app.delivery_authorization_grants%ROWTYPE;
  artifact_row app.execution_artifacts%ROWTYPE;
  approval_row app.artifact_approval_events%ROWTYPE;
  source_attempt app.publication_attempts%ROWTYPE;
  expected_source_approval uuid;
BEGIN
  SELECT project_row.id INTO active_project_id
    FROM app.sites site_row
    JOIN app.client_projects project_row
      ON project_row.id = site_row.project_id
     AND project_row.workspace_id = site_row.workspace_id
   WHERE site_row.id = NEW.site_id
     AND site_row.workspace_id = NEW.workspace_id
     AND site_row.project_id = NEW.project_id
     AND project_row.id = NEW.project_id
     AND project_row.archived_at IS NULL
   FOR SHARE OF site_row, project_row;

  SELECT * INTO preview_row
    FROM app.publication_preview_events candidate_preview
   WHERE candidate_preview.id = NEW.preview_event_id
     AND candidate_preview.workspace_id = NEW.workspace_id
     AND candidate_preview.project_id = NEW.project_id
     AND candidate_preview.event_kind = 'issued'
     AND candidate_preview.preview_ref = NEW.preview_ref
     AND candidate_preview.expires_at > now()
   FOR UPDATE;
  IF active_project_id IS NULL
     OR preview_row.id IS NULL
     OR EXISTS (
       SELECT 1
         FROM app.publication_preview_events terminal
        WHERE terminal.workspace_id = NEW.workspace_id
          AND terminal.project_id = NEW.project_id
          AND terminal.supersedes_preview_event_id = preview_row.id
     ) THEN
    RAISE EXCEPTION
      'publication attempt requires one current unexpired issued preview'
      USING ERRCODE = '23514';
  END IF;

  IF preview_row.facts_hash IS DISTINCT FROM NEW.preview_facts_hash
     OR preview_row.provider_plan->>'providerKind' IS DISTINCT FROM NEW.provider_kind
     OR preview_row.preview_kind IS DISTINCT FROM NEW.attempt_kind
     OR preview_row.site_id IS DISTINCT FROM NEW.site_id
     OR preview_row.destination_id IS DISTINCT FROM NEW.destination_id
     OR preview_row.destination_ref IS DISTINCT FROM NEW.destination_ref
     OR preview_row.destination_revision IS DISTINCT FROM NEW.destination_revision
     OR preview_row.provider_kind IS DISTINCT FROM NEW.provider_kind
     OR preview_row.target_ref IS DISTINCT FROM NEW.target_ref
     OR preview_row.action_id IS DISTINCT FROM NEW.action_id
     OR preview_row.artifact_id IS DISTINCT FROM NEW.artifact_id
     OR preview_row.artifact_revision_id IS DISTINCT FROM NEW.artifact_revision_id
     OR preview_row.artifact_revision IS DISTINCT FROM NEW.approved_artifact_revision
     OR preview_row.artifact_content_hash IS DISTINCT FROM NEW.approved_artifact_content_hash
     OR preview_row.preview_checksum IS DISTINCT FROM NEW.preview_checksum
     OR preview_row.content_checksum IS DISTINCT FROM NEW.content_checksum
     OR preview_row.remote_precondition IS DISTINCT FROM NEW.remote_precondition
     OR preview_row.rollback_plan IS DISTINCT FROM NEW.rollback_plan THEN
    RAISE EXCEPTION
      'publication attempt facts must match the exact issued preview'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.preview_checksum <> NEW.approved_artifact_content_hash THEN
    RAISE EXCEPTION
      'publication attempt preview checksum must match the exact approved Artifact Revision'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM app.async_runs run
     WHERE run.id = NEW.async_run_id
       AND run.workspace_id = NEW.workspace_id
       AND run.project_id = NEW.project_id
       AND run.kind = 'publication'
       AND run.result_type = 'publication_attempt'
       AND run.result_id = NEW.id
       AND run.active_key =
         'publication:' || NEW.destination_ref::text || ':' || NEW.target_ref
  ) THEN
    RAISE EXCEPTION 'publication attempt async run lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO destination_row
    FROM app.publication_destinations
   WHERE id = NEW.destination_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND destination_ref = NEW.destination_ref
     AND revision = NEW.destination_revision
     AND provider_kind = NEW.provider_kind
     AND target_ref = NEW.target_ref
     AND state = 'ready'
   FOR SHARE;
  IF destination_row.id IS NULL
     OR EXISTS (
       SELECT 1 FROM app.publication_destinations newer
        WHERE newer.workspace_id = NEW.workspace_id
          AND newer.project_id = NEW.project_id
          AND newer.destination_ref = NEW.destination_ref
          AND newer.revision > NEW.destination_revision
     ) THEN
    RAISE EXCEPTION 'publication attempt requires the latest ready destination'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO grant_row
    FROM app.delivery_authorization_grants
   WHERE id = NEW.authorization_grant_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND provider_kind = NEW.provider_kind
     AND purpose = NEW.authorization_purpose
     AND state = 'ready'
     AND destination_ref = NEW.destination_ref
     AND destination_revision = NEW.destination_revision
     AND target_ref = NEW.target_ref
   FOR UPDATE;
  IF grant_row.id IS NULL
     OR (grant_row.expires_at IS NOT NULL AND grant_row.expires_at <= now())
     OR NOT (destination_row.provider_scope @> grant_row.requested_scope)
     OR grant_row.authorization_snapshot IS DISTINCT FROM NEW.authorization_snapshot
     OR grant_row.authorization_snapshot_hash IS DISTINCT FROM NEW.authorization_snapshot_hash THEN
    RAISE EXCEPTION 'publication attempt authorization grant is stale or invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO artifact_row
    FROM app.execution_artifacts
   WHERE id = NEW.artifact_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
   FOR SHARE;
  IF artifact_row.id IS NULL
     OR artifact_row.action_id IS DISTINCT FROM NEW.action_id
     OR NOT EXISTS (
       SELECT 1 FROM app.artifact_revisions revision
        WHERE revision.id = NEW.artifact_revision_id
          AND revision.workspace_id = NEW.workspace_id
          AND revision.project_id = NEW.project_id
          AND revision.artifact_id = NEW.artifact_id
          AND revision.revision = NEW.approved_artifact_revision
          AND revision.content_hash = NEW.approved_artifact_content_hash
     ) THEN
    RAISE EXCEPTION 'publication attempt Artifact lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attempt_kind = 'publish' THEN
    IF artifact_row.status <> 'ready'
       OR artifact_row.validation_state <> 'valid'
       OR artifact_row.current_revision <> NEW.approved_artifact_revision
       OR artifact_row.content_hash IS DISTINCT FROM
         NEW.approved_artifact_content_hash
       OR preview_row.artifact_approval_event_id IS DISTINCT FROM
         NEW.publication_approval_event_id
       OR preview_row.source_publication_attempt_id IS NOT NULL
       OR preview_row.source_change_receipt_id IS NOT NULL THEN
      RAISE EXCEPTION
        'publish attempt preview approval lineage is invalid'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO approval_row
      FROM app.artifact_approval_events
     WHERE id = NEW.publication_approval_event_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND event_kind = 'approved'
       AND artifact_id = NEW.artifact_id
       AND artifact_revision_id = NEW.artifact_revision_id
       AND artifact_revision = NEW.approved_artifact_revision
       AND artifact_content_hash = NEW.approved_artifact_content_hash
     FOR SHARE;
    IF approval_row.id IS NULL
       OR EXISTS (
         SELECT 1 FROM app.artifact_approval_events terminal
          WHERE terminal.workspace_id = NEW.workspace_id
            AND terminal.project_id = NEW.project_id
            AND terminal.supersedes_approval_event_id = approval_row.id
       ) THEN
      RAISE EXCEPTION 'publish attempt requires a current exact approval and preview'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF preview_row.artifact_approval_event_id IS DISTINCT FROM
         NEW.source_approval_event_id
       OR preview_row.source_publication_attempt_id IS DISTINCT FROM
         NEW.source_publication_attempt_id
       OR preview_row.source_change_receipt_id IS DISTINCT FROM
         NEW.source_change_receipt_id THEN
      RAISE EXCEPTION
        'rollback attempt preview source lineage is invalid'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO source_attempt
      FROM app.publication_attempts
     WHERE id = NEW.source_publication_attempt_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND site_id = NEW.site_id
       AND destination_ref = NEW.destination_ref
       AND provider_kind = NEW.provider_kind
       AND target_ref = NEW.target_ref
     FOR SHARE;
    expected_source_approval := COALESCE(
      source_attempt.publication_approval_event_id,
      source_attempt.source_approval_event_id
    );
    IF source_attempt.id IS NULL
       OR expected_source_approval IS DISTINCT FROM NEW.source_approval_event_id
       OR source_attempt.artifact_id IS DISTINCT FROM NEW.artifact_id
       OR source_attempt.artifact_revision_id IS DISTINCT FROM NEW.artifact_revision_id
       OR source_attempt.approved_artifact_revision IS DISTINCT FROM NEW.approved_artifact_revision
       OR source_attempt.approved_artifact_content_hash IS DISTINCT FROM NEW.approved_artifact_content_hash
       OR NOT EXISTS (
         SELECT 1 FROM app.publication_receipts source_change
          WHERE source_change.id = NEW.source_change_receipt_id
            AND source_change.publication_attempt_id = source_attempt.id
            AND source_change.workspace_id = NEW.workspace_id
            AND source_change.project_id = NEW.project_id
            AND source_change.site_id = NEW.site_id
            AND source_change.provider_kind = NEW.provider_kind
            AND source_change.receipt_kind = 'change_receipt'
            AND source_change.verification_state = 'verified_live'
            AND source_change.artifact_content_hash =
              source_attempt.approved_artifact_content_hash
            AND source_change.content_checksum =
              source_attempt.content_checksum
       ) THEN
      RAISE EXCEPTION 'rollback requires a same-scope source with verified change'
        USING ERRCODE = '23514';
    END IF;
    -- Historical source approval is lineage only. No terminal-event check is
    -- performed here: a later revocation cannot make an occurred live change
    -- impossible to roll back.
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_publication_receipt_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempt_row app.publication_attempts%ROWTYPE;
  predecessor app.publication_receipts%ROWTYPE;
BEGIN
  SELECT * INTO attempt_row
    FROM app.publication_attempts
   WHERE id = NEW.publication_attempt_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND provider_kind = NEW.provider_kind
     AND approved_artifact_content_hash = NEW.artifact_content_hash
     AND content_checksum = NEW.content_checksum
   FOR SHARE;
  IF attempt_row.id IS NULL THEN
    RAISE EXCEPTION 'publication receipt attempt lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.receipt_kind <> 'change_receipt' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO predecessor
    FROM app.publication_receipts
   WHERE id = NEW.predecessor_delivery_receipt_id
   FOR KEY SHARE;
  IF predecessor.id IS NULL
     OR predecessor.receipt_kind <> 'delivery_receipt'
     OR predecessor.publication_attempt_id <> NEW.publication_attempt_id
     OR predecessor.provider_kind <> NEW.provider_kind
     OR predecessor.artifact_content_hash <> NEW.artifact_content_hash
     OR predecessor.content_checksum <> NEW.content_checksum
     OR predecessor.remote_scope_ref <> NEW.remote_scope_ref
     OR predecessor.observed_at >= NEW.observed_at THEN
    RAISE EXCEPTION
      'change_receipt requires an earlier same-attempt delivery_receipt with matching provider, Artifact hash, content checksum, and remote scope'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_authorization_grants_transition_guard
  ON app.delivery_authorization_grants;
CREATE TRIGGER delivery_authorization_grants_transition_guard
BEFORE INSERT OR UPDATE ON app.delivery_authorization_grants
FOR EACH ROW
EXECUTE FUNCTION app.enforce_delivery_authorization_grant_transition();

DROP TRIGGER IF EXISTS delivery_authorization_grants_no_delete
  ON app.delivery_authorization_grants;
CREATE TRIGGER delivery_authorization_grants_no_delete
BEFORE DELETE ON app.delivery_authorization_grants
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS artifact_approval_events_lineage_guard
  ON app.artifact_approval_events;
CREATE TRIGGER artifact_approval_events_lineage_guard
BEFORE INSERT ON app.artifact_approval_events
FOR EACH ROW EXECUTE FUNCTION app.enforce_artifact_approval_event_lineage();

DROP TRIGGER IF EXISTS publication_destinations_lineage_guard
  ON app.publication_destinations;
CREATE TRIGGER publication_destinations_lineage_guard
BEFORE INSERT ON app.publication_destinations
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_destination_lineage();

DROP TRIGGER IF EXISTS publication_preview_events_lineage_guard
  ON app.publication_preview_events;
CREATE TRIGGER publication_preview_events_lineage_guard
BEFORE INSERT ON app.publication_preview_events
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_preview_event_lineage();

DROP TRIGGER IF EXISTS publication_attempts_lineage_guard
  ON app.publication_attempts;
CREATE TRIGGER publication_attempts_lineage_guard
BEFORE INSERT ON app.publication_attempts
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_attempt_lineage();

DROP TRIGGER IF EXISTS publication_receipts_lineage_guard
  ON app.publication_receipts;
CREATE TRIGGER publication_receipts_lineage_guard
BEFORE INSERT ON app.publication_receipts
FOR EACH ROW EXECUTE FUNCTION app.enforce_publication_receipt_lineage();

DROP TRIGGER IF EXISTS artifact_approval_events_append_only
  ON app.artifact_approval_events;
CREATE TRIGGER artifact_approval_events_append_only
BEFORE UPDATE OR DELETE ON app.artifact_approval_events
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS publication_destinations_append_only
  ON app.publication_destinations;
CREATE TRIGGER publication_destinations_append_only
BEFORE UPDATE OR DELETE ON app.publication_destinations
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS publication_preview_events_append_only
  ON app.publication_preview_events;
CREATE TRIGGER publication_preview_events_append_only
BEFORE UPDATE OR DELETE ON app.publication_preview_events
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS publication_attempts_append_only
  ON app.publication_attempts;
CREATE TRIGGER publication_attempts_append_only
BEFORE UPDATE OR DELETE ON app.publication_attempts
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS publication_receipts_append_only
  ON app.publication_receipts;
CREATE TRIGGER publication_receipts_append_only
BEFORE UPDATE OR DELETE ON app.publication_receipts
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- Browser roles never access canonical publication authority or ciphertext.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.delivery_authorization_grants FROM anon';
    EXECUTE 'REVOKE ALL ON app.artifact_approval_events FROM anon';
    EXECUTE 'REVOKE ALL ON app.publication_destinations FROM anon';
    EXECUTE 'REVOKE ALL ON app.publication_preview_events FROM anon';
    EXECUTE 'REVOKE ALL ON app.publication_attempts FROM anon';
    EXECUTE 'REVOKE ALL ON app.publication_receipts FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.delivery_authorization_grants FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.artifact_approval_events FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.publication_destinations FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.publication_preview_events FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.publication_attempts FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.publication_receipts FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0022_publication_foundation'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0022_publication_foundation.sql

-- BEGIN EXACT ORDERED MIGRATION 0023_measurement_windows.sql
BEGIN;

-- Measurement is an asynchronous, read-only provider collection. The final
-- immutable record is inserted only after all provider windows have closed.
ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_kind_check
  CHECK (kind IN (
    'collection',
    'diagnostic',
    'artifact_generation',
    'export',
    'product_profile_synthesis',
    'content_shadow',
    'publication',
    'measurement'
  ));

ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_result_type_check
  CHECK (
    result_type IS NULL OR result_type IN (
      'collection_run',
      'diagnostic_run',
      'artifact',
      'export',
      'icp_profile',
      'flow_shadow_run',
      'publication_attempt',
      'measurement_window'
    )
  );

-- Measurement creation retries keep their authority for the lifetime of the
-- run ledger. The same client key may never be rebound after a terminal run.
ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_measurement_idempotency_key_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_measurement_idempotency_key_check
  CHECK (
    kind <> 'measurement'
    OR (
      (request_payload ->> 'operation')
        IS NOT DISTINCT FROM 'measurement_window'
      AND request_payload ? 'idempotencyKey'
      AND jsonb_typeof(request_payload -> 'idempotencyKey')
        IS NOT DISTINCT FROM 'string'
      AND length(request_payload ->> 'idempotencyKey') BETWEEN 1 AND 128
      AND octet_length(request_payload ->> 'idempotencyKey') =
        length(request_payload ->> 'idempotencyKey')
      AND (request_payload ->> 'idempotencyKey') !~ '[[:cntrl:]]'
      AND jsonb_typeof(request_payload -> 'requestHash')
        IS NOT DISTINCT FROM 'string'
      AND (request_payload ->> 'requestHash') ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(request_payload -> 'frozenFacts')
        IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(
        request_payload #> '{frozenFacts,changeReceiptId}'
      ) IS NOT DISTINCT FROM 'string'
      AND (
        request_payload #>> '{frozenFacts,changeReceiptId}'
      ) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      AND result_type = 'measurement_window'
      AND result_id IS NOT NULL
      AND active_key = 'measurement:' ||
        (request_payload #>> '{frozenFacts,changeReceiptId}')
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS async_runs_measurement_idempotency_idx
  ON app.async_runs(
    workspace_id,
    project_id,
    (request_payload ->> 'idempotencyKey')
  )
  WHERE kind = 'measurement';

-- The outcome anchor is a verified Change Receipt. Delivery Receipt lineage
-- is optional and exists only for the customer timeline/audit projection.
CREATE TABLE IF NOT EXISTS app.measurement_windows (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  async_run_id uuid NOT NULL UNIQUE
    REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  target_kind text NOT NULL CHECK (target_kind = 'url'),
  target_ref text NOT NULL
    CHECK (length(btrim(target_ref)) BETWEEN 1 AND 2048),
  site_page_id uuid NOT NULL
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  action_id uuid NOT NULL REFERENCES app.actions(id) ON DELETE RESTRICT,
  artifact_id uuid NOT NULL
    REFERENCES app.execution_artifacts(id) ON DELETE RESTRICT,
  artifact_revision_id uuid NOT NULL
    REFERENCES app.artifact_revisions(id) ON DELETE RESTRICT,
  artifact_revision integer NOT NULL CHECK (artifact_revision >= 1),
  artifact_content_hash text NOT NULL
    CHECK (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  content_checksum text NOT NULL
    CHECK (content_checksum ~ '^[a-f0-9]{64}$'),
  publication_attempt_id uuid NOT NULL
    REFERENCES app.publication_attempts(id) ON DELETE RESTRICT,
  verified_change_receipt_id uuid NOT NULL
    REFERENCES app.publication_receipts(id) ON DELETE RESTRICT,
  timeline_delivery_receipt_id uuid
    REFERENCES app.publication_receipts(id) ON DELETE RESTRICT,
  before_start_at timestamptz NOT NULL,
  before_end_at timestamptz NOT NULL,
  after_start_at timestamptz NOT NULL,
  after_end_at timestamptz NOT NULL,
  timezone text NOT NULL
    CHECK (length(btrim(timezone)) BETWEEN 1 AND 100),
  url text NOT NULL CHECK (url ~ '^https?://'),
  canonical_url text NOT NULL CHECK (canonical_url ~ '^https?://'),
  interpretation text NOT NULL
    CHECK (interpretation = 'observational_non_causal'),
  state text NOT NULL CHECK (state IN (
    'technical_verified',
    'observed',
    'insufficient_data',
    'unavailable',
    'regressed'
  )),
  technical_verification_ref uuid,
  limitation text
    CHECK (
      limitation IS NULL
      OR length(btrim(limitation)) BETWEEN 1 AND 4000
    ),
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, verified_change_receipt_id, result_hash),
  CHECK (
    before_start_at < before_end_at
    AND after_start_at < after_end_at
    AND before_end_at <= after_start_at
    AND recorded_at >= after_end_at
  ),
  CHECK (
    state NOT IN ('insufficient_data', 'unavailable')
    OR limitation IS NOT NULL
  ),
  CHECK (
    state <> 'technical_verified'
    OR technical_verification_ref IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS measurement_windows_target_history_idx
  ON app.measurement_windows(
    workspace_id,
    project_id,
    target_kind,
    target_ref,
    site_page_id,
    recorded_at DESC,
    id DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS measurement_windows_change_window_idx
  ON app.measurement_windows(
    workspace_id,
    project_id,
    verified_change_receipt_id,
    before_start_at,
    before_end_at,
    after_start_at,
    after_end_at
  );

-- Canonical provider snapshots predate this contract and expose two source
-- window encodings. Date-only {start,end} is inclusive at both ends; ISO
-- {startAt,endAt} (and legacy timestamp {start,end}) is already half-open.
-- Normalize both to the contract's UTC half-open shape before comparison.
CREATE OR REPLACE FUNCTION app.normalize_measurement_source_window(
  source_window jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  start_text text;
  end_text text;
  start_at timestamptz;
  end_at timestamptz;
BEGIN
  IF jsonb_typeof(source_window) <> 'object' THEN
    RAISE EXCEPTION 'measurement source window must be an object'
      USING ERRCODE = '23514';
  END IF;

  IF source_window ? 'startAt' OR source_window ? 'endAt' THEN
    IF NOT (source_window ? 'startAt')
       OR NOT (source_window ? 'endAt')
       OR jsonb_typeof(source_window -> 'startAt')
         IS DISTINCT FROM 'string'
       OR jsonb_typeof(source_window -> 'endAt')
         IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION
        'measurement half-open source window requires startAt and endAt'
        USING ERRCODE = '23514';
    END IF;
    start_text := source_window ->> 'startAt';
    end_text := source_window ->> 'endAt';
    IF start_text !~* '(Z|[+-][0-9]{2}:[0-9]{2})$'
       OR end_text !~* '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
      RAISE EXCEPTION
        'measurement half-open source window must use an absolute offset'
        USING ERRCODE = '23514';
    END IF;
    start_at := start_text::timestamptz;
    end_at := end_text::timestamptz;
  ELSIF source_window ? 'start' OR source_window ? 'end' THEN
    IF NOT (source_window ? 'start')
       OR NOT (source_window ? 'end')
       OR jsonb_typeof(source_window -> 'start')
         IS DISTINCT FROM 'string'
       OR jsonb_typeof(source_window -> 'end')
         IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION
        'measurement source window requires start and end'
        USING ERRCODE = '23514';
    END IF;
    start_text := source_window ->> 'start';
    end_text := source_window ->> 'end';
    IF start_text ~ '^\d{4}-\d{2}-\d{2}$'
       AND end_text ~ '^\d{4}-\d{2}-\d{2}$' THEN
      start_at := start_text::date::timestamp AT TIME ZONE 'UTC';
      end_at :=
        (end_text::date + 1)::timestamp AT TIME ZONE 'UTC';
    ELSE
      IF start_text !~* '(Z|[+-][0-9]{2}:[0-9]{2})$'
         OR end_text !~* '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
        RAISE EXCEPTION
          'measurement timestamp source window must use an absolute offset'
          USING ERRCODE = '23514';
      END IF;
      start_at := start_text::timestamptz;
      end_at := end_text::timestamptz;
    END IF;
  ELSE
    RAISE EXCEPTION
      'measurement source window has no supported interval keys'
      USING ERRCODE = '23514';
  END IF;

  IF start_at >= end_at THEN
    RAISE EXCEPTION 'measurement source window must be non-empty'
      USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object(
    'startAt',
    to_char(
      start_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS'
    ) ||
      rtrim(
        right(
          to_char(start_at AT TIME ZONE 'UTC', 'US'),
          3
        ),
        '0'
      ) ||
      'Z',
    'endAt',
    to_char(
      end_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS'
    ) ||
      rtrim(
        right(
          to_char(end_at AT TIME ZONE 'UTC', 'US'),
          3
        ),
        '0'
      ) ||
      'Z'
  );
END;
$$;

-- GSC and GA4 projections reference the canonical snapshots and normalized
-- observations already held by the collection pipeline. Metrics below are a
-- bounded before/after projection, not a second copy of provider raw data.
-- One canonical gsc.page.v1 Observation may intentionally back both phases:
-- its single 56-day value_json contains previous28d and current28d. Therefore
-- GSC does not require distinct baseline/outcome Snapshot or Observation ids.
-- GA4 remains different: each phase is an independently collected source and
-- its table below requires distinct Snapshot and Observation identities.
CREATE TABLE IF NOT EXISTS app.measurement_gsc_dimensions (
  measurement_window_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  state text NOT NULL CHECK (
    state IN ('observed', 'insufficient_data', 'unavailable', 'regressed')
  ),
  baseline_source_ref uuid,
  baseline_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  baseline_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  baseline_covered_window jsonb,
  baseline_observed_at timestamptz,
  baseline_freshness text CHECK (
    baseline_freshness IS NULL
    OR baseline_freshness IN ('current', 'stale', 'unknown')
  ),
  outcome_source_ref uuid,
  outcome_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  outcome_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  outcome_covered_window jsonb,
  outcome_observed_at timestamptz,
  outcome_freshness text CHECK (
    outcome_freshness IS NULL
    OR outcome_freshness IN ('current', 'stale', 'unknown')
  ),
  sample_baseline bigint,
  sample_outcome bigint,
  sample_unit text NOT NULL CHECK (sample_unit = 'impressions'),
  coverage text NOT NULL CHECK (coverage IN ('complete', 'partial', 'none')),
  limitation text CHECK (
    limitation IS NULL
    OR length(btrim(limitation)) BETWEEN 1 AND 4000
  ),
  clicks_baseline bigint,
  clicks_outcome bigint,
  impressions_baseline bigint,
  impressions_outcome bigint,
  ctr_baseline numeric,
  ctr_outcome numeric,
  average_position_baseline numeric,
  average_position_outcome numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id, measurement_window_id)
    REFERENCES app.measurement_windows(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  CHECK (
    num_nonnulls(
      baseline_source_ref,
      baseline_snapshot_id,
      baseline_observation_id,
      baseline_covered_window,
      baseline_observed_at,
      baseline_freshness
    ) IN (0, 6)
  ),
  CHECK (
    num_nonnulls(
      outcome_source_ref,
      outcome_snapshot_id,
      outcome_observation_id,
      outcome_covered_window,
      outcome_observed_at,
      outcome_freshness
    ) IN (0, 6)
  ),
  CHECK (
    baseline_covered_window IS NULL
    OR (
      jsonb_typeof(baseline_covered_window) = 'object'
      AND baseline_covered_window - ARRAY['startAt', 'endAt']::text[] = '{}'::jsonb
      AND baseline_covered_window ? 'startAt'
      AND baseline_covered_window ? 'endAt'
      AND jsonb_typeof(baseline_covered_window -> 'startAt') = 'string'
      AND jsonb_typeof(baseline_covered_window -> 'endAt') = 'string'
      AND (baseline_covered_window ->> 'startAt')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}([0-9]{0,2}[1-9])?Z$'
      AND (baseline_covered_window ->> 'endAt')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}([0-9]{0,2}[1-9])?Z$'
      AND baseline_covered_window =
        app.normalize_measurement_source_window(baseline_covered_window)
    )
  ),
  CHECK (
    outcome_covered_window IS NULL
    OR (
      jsonb_typeof(outcome_covered_window) = 'object'
      AND outcome_covered_window - ARRAY['startAt', 'endAt']::text[] = '{}'::jsonb
      AND outcome_covered_window ? 'startAt'
      AND outcome_covered_window ? 'endAt'
      AND jsonb_typeof(outcome_covered_window -> 'startAt') = 'string'
      AND jsonb_typeof(outcome_covered_window -> 'endAt') = 'string'
      AND (outcome_covered_window ->> 'startAt')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}([0-9]{0,2}[1-9])?Z$'
      AND (outcome_covered_window ->> 'endAt')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}([0-9]{0,2}[1-9])?Z$'
      AND outcome_covered_window =
        app.normalize_measurement_source_window(outcome_covered_window)
    )
  ),
  CHECK (
    baseline_source_ref IS NULL
    OR outcome_source_ref IS NULL
    OR baseline_source_ref = outcome_source_ref
  ),
  CHECK (
    (sample_baseline IS NULL OR sample_baseline >= 0)
    AND (sample_outcome IS NULL OR sample_outcome >= 0)
    AND (clicks_baseline IS NULL OR clicks_baseline >= 0)
    AND (clicks_outcome IS NULL OR clicks_outcome >= 0)
    AND (impressions_baseline IS NULL OR impressions_baseline >= 0)
    AND (impressions_outcome IS NULL OR impressions_outcome >= 0)
    AND (ctr_baseline IS NULL OR ctr_baseline BETWEEN 0 AND 1)
    AND (ctr_outcome IS NULL OR ctr_outcome BETWEEN 0 AND 1)
    AND (
      average_position_baseline IS NULL
      OR average_position_baseline > 0
    )
    AND (
      average_position_outcome IS NULL
      OR average_position_outcome > 0
    )
  ),
  CHECK (
    baseline_source_ref IS NOT NULL
    OR (
      sample_baseline IS NULL
      AND clicks_baseline IS NULL
      AND impressions_baseline IS NULL
      AND ctr_baseline IS NULL
      AND average_position_baseline IS NULL
    )
  ),
  CHECK (
    outcome_source_ref IS NOT NULL
    OR (
      sample_outcome IS NULL
      AND clicks_outcome IS NULL
      AND impressions_outcome IS NULL
      AND ctr_outcome IS NULL
      AND average_position_outcome IS NULL
    )
  ),
  CHECK (
    coverage <> 'none'
    OR (
      sample_baseline IS NULL
      AND sample_outcome IS NULL
      AND clicks_baseline IS NULL
      AND clicks_outcome IS NULL
      AND impressions_baseline IS NULL
      AND impressions_outcome IS NULL
      AND ctr_baseline IS NULL
      AND ctr_outcome IS NULL
      AND average_position_baseline IS NULL
      AND average_position_outcome IS NULL
    )
  ),
  CHECK (
    (
      state = 'unavailable'
      AND baseline_source_ref IS NULL
      AND outcome_source_ref IS NULL
      AND coverage = 'none'
      AND limitation IS NOT NULL
    )
    OR (
      state = 'insufficient_data'
      AND (
        baseline_source_ref IS NOT NULL
        OR outcome_source_ref IS NOT NULL
      )
      AND coverage IN ('partial', 'none')
      AND limitation IS NOT NULL
    )
    OR (
      state IN ('observed', 'regressed')
      AND baseline_source_ref IS NOT NULL
      AND outcome_source_ref IS NOT NULL
    )
  ),
  CHECK (
    state NOT IN ('observed', 'regressed')
    OR (
      coverage <> 'none'
      AND sample_baseline > 0
      AND sample_outcome > 0
      AND (
        (clicks_baseline IS NOT NULL AND clicks_outcome IS NOT NULL)
        OR (
          impressions_baseline IS NOT NULL
          AND impressions_outcome IS NOT NULL
        )
        OR (ctr_baseline IS NOT NULL AND ctr_outcome IS NOT NULL)
        OR (
          average_position_baseline IS NOT NULL
          AND average_position_outcome IS NOT NULL
        )
      )
    )
  ),
  CHECK (
    (
      (baseline_freshness IS NULL OR baseline_freshness = 'current')
      AND (outcome_freshness IS NULL OR outcome_freshness = 'current')
      AND coverage <> 'partial'
    )
    OR limitation IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS app.measurement_ga4_dimensions (
  measurement_window_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  state text NOT NULL CHECK (
    state IN ('observed', 'insufficient_data', 'unavailable', 'regressed')
  ),
  baseline_source_ref uuid,
  baseline_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  baseline_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  baseline_covered_window jsonb,
  baseline_observed_at timestamptz,
  baseline_freshness text CHECK (
    baseline_freshness IS NULL
    OR baseline_freshness IN ('current', 'stale', 'unknown')
  ),
  outcome_source_ref uuid,
  outcome_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  outcome_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  outcome_covered_window jsonb,
  outcome_observed_at timestamptz,
  outcome_freshness text CHECK (
    outcome_freshness IS NULL
    OR outcome_freshness IN ('current', 'stale', 'unknown')
  ),
  sample_baseline bigint,
  sample_outcome bigint,
  sample_unit text NOT NULL CHECK (sample_unit = 'sessions'),
  coverage text NOT NULL CHECK (coverage IN ('complete', 'partial', 'none')),
  limitation text CHECK (
    limitation IS NULL
    OR length(btrim(limitation)) BETWEEN 1 AND 4000
  ),
  direct_conversion_definition_id uuid,
  direct_event_names text[],
  direct_counting_method text CHECK (
    direct_counting_method IS NULL
    OR direct_counting_method IN (
      'once_per_event',
      'once_per_session',
      'once_per_user'
    )
  ),
  direct_attribution_boundary text CHECK (
    direct_attribution_boundary IS NULL
    OR direct_attribution_boundary = 'ga4_reported_primary_touchpoint'
  ),
  direct_lookback_window_days integer CHECK (
    direct_lookback_window_days IS NULL
    OR direct_lookback_window_days BETWEEN 1 AND 90
  ),
  assisted_conversion_definition_id uuid,
  assisted_event_names text[],
  assisted_counting_method text CHECK (
    assisted_counting_method IS NULL
    OR assisted_counting_method IN (
      'once_per_event',
      'once_per_session',
      'once_per_user'
    )
  ),
  assisted_attribution_boundary text CHECK (
    assisted_attribution_boundary IS NULL
    OR assisted_attribution_boundary = 'path_touchpoint_not_primary'
  ),
  assisted_lookback_window_days integer CHECK (
    assisted_lookback_window_days IS NULL
    OR assisted_lookback_window_days BETWEEN 1 AND 90
  ),
  sessions_baseline bigint,
  sessions_outcome bigint,
  engaged_sessions_baseline bigint,
  engaged_sessions_outcome bigint,
  direct_conversions_baseline bigint,
  direct_conversions_outcome bigint,
  assisted_conversions_baseline bigint,
  assisted_conversions_outcome bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, measurement_window_id),
  FOREIGN KEY (workspace_id, project_id, measurement_window_id)
    REFERENCES app.measurement_windows(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  CHECK (
    num_nonnulls(
      baseline_source_ref,
      baseline_snapshot_id,
      baseline_observation_id,
      baseline_covered_window,
      baseline_observed_at,
      baseline_freshness
    ) IN (0, 6)
  ),
  CHECK (
    num_nonnulls(
      outcome_source_ref,
      outcome_snapshot_id,
      outcome_observation_id,
      outcome_covered_window,
      outcome_observed_at,
      outcome_freshness
    ) IN (0, 6)
  ),
  CHECK (
    baseline_covered_window IS NULL
    OR (
      jsonb_typeof(baseline_covered_window) = 'object'
      AND baseline_covered_window - ARRAY['startAt', 'endAt']::text[] = '{}'::jsonb
      AND baseline_covered_window ? 'startAt'
      AND baseline_covered_window ? 'endAt'
      AND jsonb_typeof(baseline_covered_window -> 'startAt') = 'string'
      AND jsonb_typeof(baseline_covered_window -> 'endAt') = 'string'
      AND (baseline_covered_window ->> 'startAt')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}([0-9]{0,2}[1-9])?Z$'
      AND (baseline_covered_window ->> 'endAt')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}([0-9]{0,2}[1-9])?Z$'
      AND baseline_covered_window =
        app.normalize_measurement_source_window(baseline_covered_window)
    )
  ),
  CHECK (
    outcome_covered_window IS NULL
    OR (
      jsonb_typeof(outcome_covered_window) = 'object'
      AND outcome_covered_window - ARRAY['startAt', 'endAt']::text[] = '{}'::jsonb
      AND outcome_covered_window ? 'startAt'
      AND outcome_covered_window ? 'endAt'
      AND jsonb_typeof(outcome_covered_window -> 'startAt') = 'string'
      AND jsonb_typeof(outcome_covered_window -> 'endAt') = 'string'
      AND (outcome_covered_window ->> 'startAt')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}([0-9]{0,2}[1-9])?Z$'
      AND (outcome_covered_window ->> 'endAt')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}([0-9]{0,2}[1-9])?Z$'
      AND outcome_covered_window =
        app.normalize_measurement_source_window(outcome_covered_window)
    )
  ),
  CHECK (
    baseline_source_ref IS NULL
    OR outcome_source_ref IS NULL
    OR baseline_source_ref = outcome_source_ref
  ),
  CHECK (
    baseline_snapshot_id IS NULL
    OR outcome_snapshot_id IS NULL
    OR baseline_snapshot_id <> outcome_snapshot_id
  ),
  CHECK (
    baseline_observation_id IS NULL
    OR outcome_observation_id IS NULL
    OR baseline_observation_id <> outcome_observation_id
  ),
  CHECK (
    num_nonnulls(
      direct_conversion_definition_id,
      direct_event_names,
      direct_counting_method,
      direct_attribution_boundary,
      direct_lookback_window_days
    ) IN (0, 5)
  ),
  CHECK (
    num_nonnulls(
      assisted_conversion_definition_id,
      assisted_event_names,
      assisted_counting_method,
      assisted_attribution_boundary,
      assisted_lookback_window_days
    ) IN (0, 5)
  ),
  CHECK (
    direct_conversion_definition_id IS NULL
    OR assisted_conversion_definition_id IS NULL
    OR direct_conversion_definition_id <> assisted_conversion_definition_id
  ),
  CHECK (
    direct_event_names IS NULL
    OR cardinality(direct_event_names) BETWEEN 1 AND 50
  ),
  CHECK (
    assisted_event_names IS NULL
    OR cardinality(assisted_event_names) BETWEEN 1 AND 50
  ),
  CHECK (
    (sample_baseline IS NULL OR sample_baseline >= 0)
    AND (sample_outcome IS NULL OR sample_outcome >= 0)
    AND (sessions_baseline IS NULL OR sessions_baseline >= 0)
    AND (sessions_outcome IS NULL OR sessions_outcome >= 0)
    AND (
      engaged_sessions_baseline IS NULL
      OR engaged_sessions_baseline >= 0
    )
    AND (
      engaged_sessions_outcome IS NULL
      OR engaged_sessions_outcome >= 0
    )
    AND (
      direct_conversions_baseline IS NULL
      OR direct_conversions_baseline >= 0
    )
    AND (
      direct_conversions_outcome IS NULL
      OR direct_conversions_outcome >= 0
    )
    AND (
      assisted_conversions_baseline IS NULL
      OR assisted_conversions_baseline >= 0
    )
    AND (
      assisted_conversions_outcome IS NULL
      OR assisted_conversions_outcome >= 0
    )
  ),
  CHECK (
    baseline_source_ref IS NOT NULL
    OR (
      sample_baseline IS NULL
      AND sessions_baseline IS NULL
      AND engaged_sessions_baseline IS NULL
      AND direct_conversions_baseline IS NULL
      AND assisted_conversions_baseline IS NULL
    )
  ),
  CHECK (
    outcome_source_ref IS NOT NULL
    OR (
      sample_outcome IS NULL
      AND sessions_outcome IS NULL
      AND engaged_sessions_outcome IS NULL
      AND direct_conversions_outcome IS NULL
      AND assisted_conversions_outcome IS NULL
    )
  ),
  CHECK (
    coverage <> 'none'
    OR (
      sample_baseline IS NULL
      AND sample_outcome IS NULL
      AND sessions_baseline IS NULL
      AND sessions_outcome IS NULL
      AND engaged_sessions_baseline IS NULL
      AND engaged_sessions_outcome IS NULL
      AND direct_conversions_baseline IS NULL
      AND direct_conversions_outcome IS NULL
      AND assisted_conversions_baseline IS NULL
      AND assisted_conversions_outcome IS NULL
    )
  ),
  CHECK (
    direct_conversion_definition_id IS NOT NULL
    OR (
      direct_conversions_baseline IS NULL
      AND direct_conversions_outcome IS NULL
    )
  ),
  CHECK (
    assisted_conversion_definition_id IS NOT NULL
    OR (
      assisted_conversions_baseline IS NULL
      AND assisted_conversions_outcome IS NULL
    )
  ),
  CHECK (
    (
      state = 'unavailable'
      AND baseline_source_ref IS NULL
      AND outcome_source_ref IS NULL
      AND direct_conversion_definition_id IS NULL
      AND assisted_conversion_definition_id IS NULL
      AND coverage = 'none'
      AND limitation IS NOT NULL
    )
    OR (
      state = 'insufficient_data'
      AND (
        baseline_source_ref IS NOT NULL
        OR outcome_source_ref IS NOT NULL
      )
      AND coverage IN ('partial', 'none')
      AND limitation IS NOT NULL
    )
    OR (
      state IN ('observed', 'regressed')
      AND baseline_source_ref IS NOT NULL
      AND outcome_source_ref IS NOT NULL
      AND direct_conversion_definition_id IS NOT NULL
      AND assisted_conversion_definition_id IS NOT NULL
    )
  ),
  CHECK (
    state NOT IN ('observed', 'regressed')
    OR (
      coverage <> 'none'
      AND sample_baseline > 0
      AND sample_outcome > 0
      AND (
        (sessions_baseline IS NOT NULL AND sessions_outcome IS NOT NULL)
        OR (
          engaged_sessions_baseline IS NOT NULL
          AND engaged_sessions_outcome IS NOT NULL
        )
        OR (
          direct_conversions_baseline IS NOT NULL
          AND direct_conversions_outcome IS NOT NULL
        )
        OR (
          assisted_conversions_baseline IS NOT NULL
          AND assisted_conversions_outcome IS NOT NULL
        )
      )
    )
  ),
  CHECK (
    (
      (baseline_freshness IS NULL OR baseline_freshness = 'current')
      AND (outcome_freshness IS NULL OR outcome_freshness = 'current')
      AND coverage <> 'partial'
    )
    OR limitation IS NOT NULL
  )
);

-- No canonical GEO observation writer exists yet. Persist an explicit
-- unavailable dimension so callers can distinguish that absence from zero.
CREATE TABLE IF NOT EXISTS app.measurement_geo_dimensions (
  measurement_window_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  state text NOT NULL CHECK (state = 'unavailable'),
  baseline_source_ref uuid,
  baseline_snapshot_id uuid,
  baseline_covered_window jsonb,
  baseline_observed_at timestamptz,
  baseline_freshness text,
  outcome_source_ref uuid,
  outcome_snapshot_id uuid,
  outcome_covered_window jsonb,
  outcome_observed_at timestamptz,
  outcome_freshness text,
  sample_baseline bigint,
  sample_outcome bigint,
  sample_unit text NOT NULL CHECK (sample_unit = 'tracked_queries'),
  coverage text NOT NULL CHECK (coverage IN ('complete', 'partial', 'none')),
  limitation text
    CHECK (
      limitation IS NULL
      OR length(btrim(limitation)) BETWEEN 1 AND 4000
    ),
  tracked_queries_baseline bigint,
  tracked_queries_outcome bigint,
  cited_queries_baseline bigint,
  cited_queries_outcome bigint,
  citations_baseline bigint,
  citations_outcome bigint,
  citation_rate_baseline numeric,
  citation_rate_outcome numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id, measurement_window_id)
    REFERENCES app.measurement_windows(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  CHECK (
    baseline_source_ref IS NULL
    AND baseline_snapshot_id IS NULL
    AND baseline_covered_window IS NULL
    AND baseline_observed_at IS NULL
    AND baseline_freshness IS NULL
    AND outcome_source_ref IS NULL
    AND outcome_snapshot_id IS NULL
    AND outcome_covered_window IS NULL
    AND outcome_observed_at IS NULL
    AND outcome_freshness IS NULL
    AND sample_baseline IS NULL
    AND sample_outcome IS NULL
    AND coverage = 'none'
    AND limitation IS NOT NULL
    AND tracked_queries_baseline IS NULL
    AND tracked_queries_outcome IS NULL
    AND cited_queries_baseline IS NULL
    AND cited_queries_outcome IS NULL
    AND citations_baseline IS NULL
    AND citations_outcome IS NULL
    AND citation_rate_baseline IS NULL
    AND citation_rate_outcome IS NULL
  )
);

CREATE TABLE IF NOT EXISTS app.measurement_utm_identities (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (length(btrim(source)) BETWEEN 1 AND 500),
  medium text NOT NULL CHECK (length(btrim(medium)) BETWEEN 1 AND 500),
  campaign text NOT NULL CHECK (length(btrim(campaign)) BETWEEN 1 AND 500),
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 500),
  identity_hash text NOT NULL CHECK (identity_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (
    workspace_id,
    project_id,
    source,
    medium,
    campaign,
    content
  )
);

CREATE TABLE IF NOT EXISTS app.measurement_ga4_campaigns (
  measurement_window_id uuid NOT NULL,
  utm_identity_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sessions_baseline bigint,
  sessions_outcome bigint,
  direct_conversions_baseline bigint,
  direct_conversions_outcome bigint,
  assisted_conversions_baseline bigint,
  assisted_conversions_outcome bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (measurement_window_id, utm_identity_id),
  FOREIGN KEY (workspace_id, project_id, measurement_window_id)
    REFERENCES app.measurement_ga4_dimensions(
      workspace_id,
      project_id,
      measurement_window_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, utm_identity_id)
    REFERENCES app.measurement_utm_identities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  CHECK (
    (sessions_baseline IS NULL OR sessions_baseline >= 0)
    AND (sessions_outcome IS NULL OR sessions_outcome >= 0)
    AND (
      direct_conversions_baseline IS NULL
      OR direct_conversions_baseline >= 0
    )
    AND (
      direct_conversions_outcome IS NULL
      OR direct_conversions_outcome >= 0
    )
    AND (
      assisted_conversions_baseline IS NULL
      OR assisted_conversions_baseline >= 0
    )
    AND (
      assisted_conversions_outcome IS NULL
      OR assisted_conversions_outcome >= 0
    )
  )
);

CREATE INDEX IF NOT EXISTS measurement_ga4_campaigns_window_idx
  ON app.measurement_ga4_campaigns(
    workspace_id,
    project_id,
    measurement_window_id,
    utm_identity_id
  );

CREATE OR REPLACE FUNCTION app.enforce_measurement_window_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  change_receipt app.publication_receipts%ROWTYPE;
  delivery_receipt app.publication_receipts%ROWTYPE;
  attempt_row app.publication_attempts%ROWTYPE;
BEGIN
  SELECT * INTO change_receipt
    FROM app.publication_receipts
   WHERE id = NEW.verified_change_receipt_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND receipt_kind = 'change_receipt'
     AND verification_state = 'verified_live'
   FOR SHARE;

  SELECT * INTO attempt_row
    FROM app.publication_attempts
   WHERE id = NEW.publication_attempt_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
     AND site_id = NEW.site_id
     AND action_id = NEW.action_id
     AND artifact_id = NEW.artifact_id
     AND artifact_revision_id = NEW.artifact_revision_id
     AND approved_artifact_revision = NEW.artifact_revision
     AND approved_artifact_content_hash = NEW.artifact_content_hash
     AND content_checksum = NEW.content_checksum
   FOR SHARE;

  IF change_receipt.id IS NULL
     OR attempt_row.id IS NULL
     OR change_receipt.publication_attempt_id <> attempt_row.id
     OR change_receipt.artifact_content_hash <> NEW.artifact_content_hash
     OR change_receipt.content_checksum <> NEW.content_checksum
     OR change_receipt.live_canonical_url IS DISTINCT FROM NEW.canonical_url
     OR NEW.before_end_at > change_receipt.observed_at
     OR NEW.after_start_at < change_receipt.observed_at THEN
    RAISE EXCEPTION
      'measurement window requires an exact same-scope verified Change Receipt'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.timeline_delivery_receipt_id IS NOT NULL THEN
    SELECT * INTO delivery_receipt
      FROM app.publication_receipts
     WHERE id = NEW.timeline_delivery_receipt_id
       AND workspace_id = NEW.workspace_id
       AND project_id = NEW.project_id
       AND site_id = NEW.site_id
       AND receipt_kind = 'delivery_receipt'
     FOR SHARE;
    IF delivery_receipt.id IS NULL
       OR change_receipt.predecessor_delivery_receipt_id
          IS DISTINCT FROM delivery_receipt.id
       OR delivery_receipt.publication_attempt_id <> attempt_row.id
       OR delivery_receipt.provider_kind <> change_receipt.provider_kind
       OR delivery_receipt.remote_scope_ref <> change_receipt.remote_scope_ref
       OR delivery_receipt.artifact_content_hash <> NEW.artifact_content_hash
       OR delivery_receipt.content_checksum <> NEW.content_checksum
       OR delivery_receipt.observed_at >= change_receipt.observed_at THEN
      RAISE EXCEPTION
        'timeline Delivery Receipt must be the matching earlier predecessor'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM app.sites site_row
      JOIN app.client_projects project_row
        ON project_row.id = site_row.project_id
       AND project_row.workspace_id = site_row.workspace_id
     WHERE site_row.id = NEW.site_id
       AND site_row.workspace_id = NEW.workspace_id
       AND site_row.project_id = NEW.project_id
       AND project_row.archived_at IS NULL
  )
     OR NOT EXISTS (
       SELECT 1
         FROM app.site_pages page_row
        WHERE page_row.id = NEW.site_page_id
          AND page_row.workspace_id = NEW.workspace_id
          AND page_row.project_id = NEW.project_id
          AND page_row.site_id = NEW.site_id
          AND page_row.normalized_url = NEW.canonical_url
     )
     OR NOT EXISTS (
       SELECT 1
         FROM app.async_runs run
        WHERE run.id = NEW.async_run_id
          AND run.workspace_id = NEW.workspace_id
          AND run.project_id = NEW.project_id
          AND run.kind = 'measurement'
          -- Worker finalization appends evidence while holding the running
          -- attempt, then marks this run terminal in the same transaction.
          AND run.status IN ('running', 'completed', 'partial')
          AND run.active_key =
            'measurement:' || NEW.verified_change_receipt_id::text
          AND run.result_type = 'measurement_window'
          AND run.result_id = NEW.id
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_timezone_names
        WHERE name = NEW.timezone
     ) THEN
    RAISE EXCEPTION
      'measurement window site, page, run, or timezone scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.technical_verification_ref IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM app.async_runs run
        WHERE run.id = NEW.technical_verification_ref
          AND run.workspace_id = NEW.workspace_id
          AND run.project_id = NEW.project_id
          AND run.kind IN ('diagnostic', 'collection')
          AND run.status IN ('completed', 'partial')
     ) THEN
    RAISE EXCEPTION
      'technical verification reference is outside the measurement scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.measurement_provider_phase_is_canonical(
  p_workspace_id uuid,
  p_project_id uuid,
  p_site_id uuid,
  p_site_page_id uuid,
  p_canonical_url text,
  p_provider text,
  p_source_ref uuid,
  p_snapshot_id uuid,
  p_observation_id uuid,
  p_covered_window jsonb,
  p_observed_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM app.data_snapshots snapshot
      JOIN app.normalized_observations observation
        ON observation.id = p_observation_id
       AND observation.snapshot_id = snapshot.id
       AND observation.workspace_id = p_workspace_id
       AND observation.project_id = p_project_id
       AND observation.provider = p_provider
       AND observation.site_page_id = p_site_page_id
       AND observation.metric_key = CASE p_provider
         WHEN 'gsc' THEN 'gsc.page.v1'
         WHEN 'ga4' THEN 'ga4.landing.v1'
         ELSE ''
       END
       AND observation.subject_type = 'url'
       AND observation.subject_ref = p_canonical_url
       AND observation.observed_at = p_observed_at
       AND observation.availability = 'available'
      CROSS JOIN LATERAL (
        SELECT app.normalize_measurement_source_window(
          snapshot.source_window
        ) AS covered_window
      ) normalized
     WHERE snapshot.id = p_snapshot_id
       AND snapshot.workspace_id = p_workspace_id
       AND snapshot.project_id = p_project_id
       AND snapshot.site_id = p_site_id
       AND snapshot.provider = p_provider
       AND snapshot.availability IN ('available', 'partial')
       AND snapshot.dataset_key = CASE p_provider
         WHEN 'gsc' THEN 'gsc.page_query_daily.v1'
         WHEN 'ga4' THEN 'ga4.organic_landing_daily.v1'
         ELSE ''
       END
       AND snapshot.source_connection_id = p_source_ref
       AND normalized.covered_window = p_covered_window
       AND app.normalize_measurement_source_window(p_covered_window) =
         p_covered_window
       AND (
         p_covered_window ->> 'startAt'
       )::timestamptz < (
         p_covered_window ->> 'endAt'
       )::timestamptz
       AND p_observed_at >= (
         p_covered_window ->> 'endAt'
       )::timestamptz
  );
$$;

CREATE OR REPLACE FUNCTION app.enforce_measurement_dimension_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  window_row app.measurement_windows%ROWTYPE;
  expected_provider text;
  baseline_observation_id uuid;
  outcome_observation_id uuid;
  direct_events jsonb;
  assisted_events jsonb;
BEGIN
  SELECT * INTO window_row
    FROM app.measurement_windows
   WHERE id = NEW.measurement_window_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
   FOR SHARE;
  IF window_row.id IS NULL THEN
    RAISE EXCEPTION
      'measurement dimension requires a same-scope measurement window'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'measurement_geo_dimensions' THEN
    -- The table CHECK is the primary invariant; repeat the important boundary
    -- here so a future table rewrite cannot silently invent GEO lineage.
    IF NEW.state <> 'unavailable'
       OR NEW.baseline_source_ref IS NOT NULL
       OR NEW.outcome_source_ref IS NOT NULL
       OR NEW.limitation IS NULL THEN
      RAISE EXCEPTION
        'GEO measurement requires unavailable state and null lineage'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  expected_provider := CASE
    WHEN TG_TABLE_NAME = 'measurement_gsc_dimensions' THEN 'gsc'
    WHEN TG_TABLE_NAME = 'measurement_ga4_dimensions' THEN 'ga4'
    ELSE NULL
  END;
  IF expected_provider IS NULL THEN
    RAISE EXCEPTION 'unsupported measurement dimension provider'
      USING ERRCODE = '23514';
  END IF;

  baseline_observation_id :=
    (to_jsonb(NEW) ->> 'baseline_observation_id')::uuid;
  outcome_observation_id :=
    (to_jsonb(NEW) ->> 'outcome_observation_id')::uuid;

  IF NEW.baseline_source_ref IS NOT NULL
     AND NOT app.measurement_provider_phase_is_canonical(
       NEW.workspace_id,
       NEW.project_id,
       window_row.site_id,
       window_row.site_page_id,
       window_row.canonical_url,
       expected_provider,
       NEW.baseline_source_ref,
       NEW.baseline_snapshot_id,
       baseline_observation_id,
       NEW.baseline_covered_window,
       NEW.baseline_observed_at
     ) THEN
    RAISE EXCEPTION
      'measurement baseline must reuse canonical provider evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.outcome_source_ref IS NOT NULL
     AND NOT app.measurement_provider_phase_is_canonical(
       NEW.workspace_id,
       NEW.project_id,
       window_row.site_id,
       window_row.site_page_id,
       window_row.canonical_url,
       expected_provider,
       NEW.outcome_source_ref,
       NEW.outcome_snapshot_id,
       outcome_observation_id,
       NEW.outcome_covered_window,
       NEW.outcome_observed_at
     ) THEN
    RAISE EXCEPTION
      'measurement outcome must reuse canonical provider evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state IN ('observed', 'regressed')
     AND (
       NEW.baseline_source_ref IS NULL
       OR NEW.outcome_source_ref IS NULL
       OR (
         NEW.baseline_covered_window ->> 'startAt'
       )::timestamptz > window_row.before_start_at
       OR (
         NEW.baseline_covered_window ->> 'endAt'
       )::timestamptz < window_row.before_end_at
       OR (
         NEW.outcome_covered_window ->> 'startAt'
       )::timestamptz > window_row.after_start_at
       OR (
         NEW.outcome_covered_window ->> 'endAt'
       )::timestamptz < window_row.after_end_at
     ) THEN
    RAISE EXCEPTION
      'observed measurement sources must contain their measurement phases'
      USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'measurement_ga4_dimensions' THEN
    direct_events := to_jsonb(NEW) -> 'direct_event_names';
    assisted_events := to_jsonb(NEW) -> 'assisted_event_names';
    IF (
      jsonb_typeof(direct_events) = 'array'
      AND jsonb_array_length(direct_events) <> (
        SELECT count(DISTINCT event_name)
          FROM jsonb_array_elements_text(direct_events)
            AS direct_event(event_name)
      )
    )
       OR (
         jsonb_typeof(assisted_events) = 'array'
         AND jsonb_array_length(assisted_events) <> (
           SELECT count(DISTINCT event_name)
             FROM jsonb_array_elements_text(assisted_events)
               AS assisted_event(event_name)
         )
       ) THEN
      RAISE EXCEPTION
        'GA4 direct and assisted conversion event names must be unique'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_measurement_ga4_campaign_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ga4 app.measurement_ga4_dimensions%ROWTYPE;
BEGIN
  SELECT * INTO ga4
    FROM app.measurement_ga4_dimensions
   WHERE measurement_window_id = NEW.measurement_window_id
     AND workspace_id = NEW.workspace_id
     AND project_id = NEW.project_id
   FOR SHARE;
  IF ga4.measurement_window_id IS NULL THEN
    RAISE EXCEPTION
      'measurement Campaign must belong to the same-scope GA4 dimension'
      USING ERRCODE = '23514';
  END IF;
  IF ga4.state = 'unavailable' THEN
    RAISE EXCEPTION
      'unavailable GA4 measurement cannot persist Campaign lineage'
      USING ERRCODE = '23514';
  END IF;
  IF ga4.coverage = 'none'
     AND (
       NEW.sessions_baseline IS NOT NULL
       OR NEW.sessions_outcome IS NOT NULL
       OR NEW.direct_conversions_baseline IS NOT NULL
       OR NEW.direct_conversions_outcome IS NOT NULL
       OR NEW.assisted_conversions_baseline IS NOT NULL
       OR NEW.assisted_conversions_outcome IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'GA4 Campaign metrics must be null when the dimension has no coverage'
      USING ERRCODE = '23514';
  END IF;
  IF ga4.baseline_source_ref IS NULL
     AND (
       NEW.sessions_baseline IS NOT NULL
       OR NEW.direct_conversions_baseline IS NOT NULL
       OR NEW.assisted_conversions_baseline IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'GA4 Campaign baseline requires canonical baseline lineage'
      USING ERRCODE = '23514';
  END IF;
  IF ga4.outcome_source_ref IS NULL
     AND (
       NEW.sessions_outcome IS NOT NULL
       OR NEW.direct_conversions_outcome IS NOT NULL
       OR NEW.assisted_conversions_outcome IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'GA4 Campaign outcome requires canonical outcome lineage'
      USING ERRCODE = '23514';
  END IF;
  IF ga4.direct_conversion_definition_id IS NULL
     AND (
       NEW.direct_conversions_baseline IS NOT NULL
       OR NEW.direct_conversions_outcome IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'GA4 Campaign direct conversions require a direct definition'
      USING ERRCODE = '23514';
  END IF;
  IF ga4.assisted_conversion_definition_id IS NULL
     AND (
       NEW.assisted_conversions_baseline IS NOT NULL
       OR NEW.assisted_conversions_outcome IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'GA4 Campaign assisted conversions require an assisted definition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_measurement_window_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  gsc app.measurement_gsc_dimensions%ROWTYPE;
  ga4 app.measurement_ga4_dimensions%ROWTYPE;
  geo app.measurement_geo_dimensions%ROWTYPE;
  latest_observed_at timestamptz;
BEGIN
  SELECT * INTO gsc
    FROM app.measurement_gsc_dimensions
   WHERE measurement_window_id = NEW.id;
  SELECT * INTO ga4
    FROM app.measurement_ga4_dimensions
   WHERE measurement_window_id = NEW.id;
  SELECT * INTO geo
    FROM app.measurement_geo_dimensions
   WHERE measurement_window_id = NEW.id;

  IF gsc.measurement_window_id IS NULL
     OR ga4.measurement_window_id IS NULL
     OR geo.measurement_window_id IS NULL THEN
    RAISE EXCEPTION
      'final measurement window requires exactly one GSC, GA4, and GEO dimension'
      USING ERRCODE = '23514';
  END IF;

  -- This deferred check observes the terminal update made later in the same
  -- worker transaction (lock attempt -> append evidence -> set terminal).
  IF NOT EXISTS (
    SELECT 1
      FROM app.async_runs run
     WHERE run.id = NEW.async_run_id
       AND run.workspace_id = NEW.workspace_id
       AND run.project_id = NEW.project_id
       AND run.kind = 'measurement'
       AND run.status IN ('completed', 'partial')
       AND run.active_key =
         'measurement:' || NEW.verified_change_receipt_id::text
       AND run.result_type = 'measurement_window'
       AND run.result_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'final measurement requires its exact terminal measurement run'
      USING ERRCODE = '23514';
  END IF;

  SELECT max(observed_at)
    INTO latest_observed_at
    FROM (
      VALUES
        (gsc.baseline_observed_at),
        (gsc.outcome_observed_at),
        (ga4.baseline_observed_at),
        (ga4.outcome_observed_at)
    ) AS provider_observations(observed_at);
  IF latest_observed_at IS NOT NULL
     AND NEW.recorded_at < latest_observed_at THEN
    RAISE EXCEPTION
      'final measurement cannot predate its provider observations'
      USING ERRCODE = '23514';
  END IF;

  IF (
    'regressed' IN (gsc.state, ga4.state, geo.state)
    AND NEW.state <> 'regressed'
  )
     OR (
       NEW.state = 'regressed'
       AND 'regressed' NOT IN (gsc.state, ga4.state, geo.state)
     )
     OR (
       NEW.state = 'observed'
       AND 'observed' NOT IN (gsc.state, ga4.state, geo.state)
     )
     OR (
       NEW.state = 'unavailable'
       AND NOT (
         gsc.state = 'unavailable'
         AND ga4.state = 'unavailable'
         AND geo.state = 'unavailable'
       )
     )
     OR (
       NEW.state = 'insufficient_data'
       AND (
         'insufficient_data' NOT IN (gsc.state, ga4.state, geo.state)
         OR 'observed' IN (gsc.state, ga4.state, geo.state)
         OR 'regressed' IN (gsc.state, ga4.state, geo.state)
       )
     ) THEN
    RAISE EXCEPTION
      'aggregate measurement state conflicts with provider dimensions'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS measurement_windows_lineage_guard
  ON app.measurement_windows;
CREATE TRIGGER measurement_windows_lineage_guard
BEFORE INSERT ON app.measurement_windows
FOR EACH ROW EXECUTE FUNCTION app.enforce_measurement_window_lineage();

DROP TRIGGER IF EXISTS measurement_gsc_dimensions_lineage_guard
  ON app.measurement_gsc_dimensions;
CREATE TRIGGER measurement_gsc_dimensions_lineage_guard
BEFORE INSERT ON app.measurement_gsc_dimensions
FOR EACH ROW EXECUTE FUNCTION app.enforce_measurement_dimension_lineage();

DROP TRIGGER IF EXISTS measurement_ga4_dimensions_lineage_guard
  ON app.measurement_ga4_dimensions;
CREATE TRIGGER measurement_ga4_dimensions_lineage_guard
BEFORE INSERT ON app.measurement_ga4_dimensions
FOR EACH ROW EXECUTE FUNCTION app.enforce_measurement_dimension_lineage();

DROP TRIGGER IF EXISTS measurement_geo_dimensions_lineage_guard
  ON app.measurement_geo_dimensions;
CREATE TRIGGER measurement_geo_dimensions_lineage_guard
BEFORE INSERT ON app.measurement_geo_dimensions
FOR EACH ROW EXECUTE FUNCTION app.enforce_measurement_dimension_lineage();

DROP TRIGGER IF EXISTS measurement_windows_completeness_guard
  ON app.measurement_windows;
CREATE CONSTRAINT TRIGGER measurement_windows_completeness_guard
AFTER INSERT ON app.measurement_windows
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.enforce_measurement_window_completeness();

CREATE OR REPLACE FUNCTION app.enforce_measurement_utm_identity_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM app.client_projects project_row
     WHERE project_row.id = NEW.project_id
       AND project_row.workspace_id = NEW.workspace_id
       AND project_row.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'measurement UTM identity scope is invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS measurement_utm_identities_scope_guard
  ON app.measurement_utm_identities;
CREATE TRIGGER measurement_utm_identities_scope_guard
BEFORE INSERT ON app.measurement_utm_identities
FOR EACH ROW EXECUTE FUNCTION app.enforce_measurement_utm_identity_scope();

DROP TRIGGER IF EXISTS measurement_ga4_campaigns_lineage_guard
  ON app.measurement_ga4_campaigns;
CREATE TRIGGER measurement_ga4_campaigns_lineage_guard
BEFORE INSERT ON app.measurement_ga4_campaigns
FOR EACH ROW
EXECUTE FUNCTION app.enforce_measurement_ga4_campaign_lineage();

-- All six tables are evidence ledgers. A retry may read the existing exact
-- result hash, but it may never update or delete persisted evidence.
DROP TRIGGER IF EXISTS measurement_windows_append_only
  ON app.measurement_windows;
CREATE TRIGGER measurement_windows_append_only
BEFORE UPDATE OR DELETE ON app.measurement_windows
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS measurement_gsc_dimensions_append_only
  ON app.measurement_gsc_dimensions;
CREATE TRIGGER measurement_gsc_dimensions_append_only
BEFORE UPDATE OR DELETE ON app.measurement_gsc_dimensions
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS measurement_ga4_dimensions_append_only
  ON app.measurement_ga4_dimensions;
CREATE TRIGGER measurement_ga4_dimensions_append_only
BEFORE UPDATE OR DELETE ON app.measurement_ga4_dimensions
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS measurement_geo_dimensions_append_only
  ON app.measurement_geo_dimensions;
CREATE TRIGGER measurement_geo_dimensions_append_only
BEFORE UPDATE OR DELETE ON app.measurement_geo_dimensions
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS measurement_utm_identities_append_only
  ON app.measurement_utm_identities;
CREATE TRIGGER measurement_utm_identities_append_only
BEFORE UPDATE OR DELETE ON app.measurement_utm_identities
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS measurement_ga4_campaigns_append_only
  ON app.measurement_ga4_campaigns;
CREATE TRIGGER measurement_ga4_campaigns_append_only
BEFORE UPDATE OR DELETE ON app.measurement_ga4_campaigns
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.measurement_windows FROM anon';
    EXECUTE 'REVOKE ALL ON app.measurement_gsc_dimensions FROM anon';
    EXECUTE 'REVOKE ALL ON app.measurement_ga4_dimensions FROM anon';
    EXECUTE 'REVOKE ALL ON app.measurement_geo_dimensions FROM anon';
    EXECUTE 'REVOKE ALL ON app.measurement_utm_identities FROM anon';
    EXECUTE 'REVOKE ALL ON app.measurement_ga4_campaigns FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.measurement_windows FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.measurement_gsc_dimensions FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.measurement_ga4_dimensions FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.measurement_geo_dimensions FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.measurement_utm_identities FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.measurement_ga4_campaigns FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0023_measurement_windows'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0023_measurement_windows.sql

-- BEGIN EXACT ORDERED MIGRATION 0024_keyword_governance_foundation.sql
BEGIN;

-- This unpublished migration intentionally follows 0023_measurement_windows.
-- It keeps the current governed Keyword/Competitor projection gate unchanged
-- and remains the Task 4 ordinal for the Topic/Review foundation extensions
-- that will be assembled before this branch is merged.
--
-- 0.2.2 keeps every historical deterministic rule-set replayable while making
-- the governed Keyword/Competitor projection part of each new current run.
ALTER TABLE app.diagnostic_runs
  DROP CONSTRAINT IF EXISTS diagnostic_runs_rule_set_version_check;

ALTER TABLE app.diagnostic_runs
  ADD CONSTRAINT diagnostic_runs_rule_set_version_check
  CHECK (
    rule_set_version IN (
      'mvp.rules.0.2.0',
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2'
    )
  );

-- Historical 0.2.0 rows remain outside the current-manifest gate. New 0.2.1
-- rows retain their exact prior contract; new 0.2.2 rows additionally freeze
-- the strict top-level GovernanceProjectionV1 envelope. The application and
-- pure engine validate its nested canonical facts before persistence/replay.
CREATE OR REPLACE FUNCTION app.enforce_current_diagnostic_manifest()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_count integer;
  matched_snapshot_count integer;
  distinct_snapshot_count integer;
  distinct_provider_count integer;
  governance jsonb;
BEGIN
  IF NEW.rule_set_version NOT IN (
    'mvp.rules.0.2.1',
    'mvp.rules.0.2.2'
  ) THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.input_manifest -> 'snapshots') <> 'array'
     OR jsonb_typeof(NEW.input_manifest -> 'icp') <> 'object'
     OR NEW.input_manifest ->> 'projectId' <> NEW.project_id::text
     OR NEW.input_manifest ->> 'siteId' <> NEW.site_id::text
     OR NEW.input_manifest ->> 'ruleSetVersion' <> NEW.rule_set_version
     OR NEW.input_manifest ->> 'promptSetVersion' <> NEW.prompt_set_version
     OR NEW.input_manifest ->> 'deliveryLocale' <> NEW.output_locale
     OR NEW.input_manifest #>> '{icp,id}' <> NEW.icp_profile_id::text
     OR (NEW.input_manifest #>> '{icp,version}')::integer <> NEW.icp_profile_version
     OR NOT EXISTS (
       SELECT 1
       FROM app.icp_profiles icp
       WHERE icp.id = NEW.icp_profile_id
         AND icp.workspace_id = NEW.workspace_id
         AND icp.project_id = NEW.project_id
         AND icp.version = NEW.icp_profile_version
         AND icp.status = 'complete'
         AND icp.content_hash = NEW.input_manifest #>> '{icp,contentHash}'
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest does not match its frozen run and ICP'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.rule_set_version = 'mvp.rules.0.2.2' THEN
    governance := NEW.input_manifest -> 'governance';
    IF jsonb_typeof(NEW.input_manifest -> 'governance')
         IS DISTINCT FROM 'object'
       OR governance ->> 'projectionVersion'
         IS DISTINCT FROM 'growth-governance.1.0.0'
       OR jsonb_typeof(governance -> 'keywordClusters')
         IS DISTINCT FROM 'array'
       OR jsonb_typeof(governance -> 'competitors')
         IS DISTINCT FROM 'array'
       OR (
         governance
           - ARRAY['projectionVersion', 'keywordClusters', 'competitors']
       ) IS DISTINCT FROM '{}'::jsonb THEN
      RAISE EXCEPTION 'current diagnostic manifest governance projection is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  snapshot_count := jsonb_array_length(NEW.input_manifest -> 'snapshots');
  SELECT
    count(*),
    count(DISTINCT entry ->> 'snapshotId'),
    count(DISTINCT entry ->> 'provider')
  INTO matched_snapshot_count, distinct_snapshot_count, distinct_provider_count
  FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
  JOIN app.data_snapshots snapshot
    ON snapshot.id = (entry ->> 'snapshotId')::uuid
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
   AND snapshot.site_id = NEW.site_id
   AND snapshot.provider = entry ->> 'provider'
   AND snapshot.dataset_key = entry ->> 'datasetKey'
   AND snapshot.schema_version = entry ->> 'schemaVersion'
   AND snapshot.method_version = entry ->> 'methodVersion'
   AND snapshot.checksum = entry ->> 'checksum'
   AND snapshot.availability = entry ->> 'availability'
   AND snapshot.source_window = entry -> 'sourceWindow'
   AND snapshot.captured_at = (entry ->> 'capturedAt')::timestamptz;

  IF snapshot_count = 0
     OR matched_snapshot_count <> snapshot_count
     OR distinct_snapshot_count <> snapshot_count
     OR distinct_provider_count <> snapshot_count
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
       WHERE entry ->> 'provider' = 'crawl'
         AND entry ->> 'methodVersion' = 'crawl.site_graph.v2'
         AND entry ->> 'availability' IN ('available','partial')
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest snapshot selection is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Only CONTENT-GAP-011 changes in 0.2.2. The three exact-URL technical rules
-- keep v2 from 0.2.1; all other registered rules stay at v1.
CREATE OR REPLACE FUNCTION app.expected_diagnostic_rule_version(
  selected_rule_set text,
  selected_rule_id text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN selected_rule_id NOT IN (
      'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005',
      'SEARCH-CTR-004','SEARCH-DECAY-002','CONTENT-COVERAGE-001',
      'CONTENT-GAP-011','CRO-PATH-001','CRO-LANDING-003',
      'GEO-ENTITY-001','GEO-CRAWLER-002'
    ) THEN NULL
    WHEN selected_rule_set = 'mvp.rules.0.2.2'
      AND selected_rule_id = 'CONTENT-GAP-011' THEN 2
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2'
    )
      AND selected_rule_id IN (
        'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005'
      ) THEN 2
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.0',
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2'
    ) THEN 1
    ELSE NULL
  END
$$;

-- Stable Topic identity and Keyword Review authority are scoped by both
-- workspace and project. The legacy tables predate composite foreign keys, so
-- expose their already-true scope identities before the new ledgers reference
-- them. The primary ids remain globally unique; these constraints add no new
-- merge or dedupe behavior.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_projects_workspace_project_key'
      AND conrelid = 'app.client_projects'::regclass
  ) THEN
    ALTER TABLE app.client_projects
      ADD CONSTRAINT client_projects_workspace_project_key
      UNIQUE (workspace_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'site_pages_workspace_project_id_key'
      AND conrelid = 'app.site_pages'::regclass
  ) THEN
    ALTER TABLE app.site_pages
      ADD CONSTRAINT site_pages_workspace_project_id_key
      UNIQUE (workspace_id, project_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'keyword_entities_workspace_project_id_key'
      AND conrelid = 'app.keyword_entities'::regclass
  ) THEN
    ALTER TABLE app.keyword_entities
      ADD CONSTRAINT keyword_entities_workspace_project_id_key
      UNIQUE (workspace_id, project_id, id);
  END IF;
END;
$$;

-- A Topic Model revision is the project-scoped envelope for one complete Topic
-- projection. Confirmation creates a new immutable revision; it never mutates
-- a previously confirmed row. root_topic_node_id stays nullable while a model
-- is drafted; the deferred confirmation guard below still requires a node.
CREATE TABLE IF NOT EXISTS app.topic_model_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  edit_revision integer NOT NULL DEFAULT 0 CHECK (edit_revision >= 0),
  status text NOT NULL
    CHECK (status IN ('draft','confirmed')),
  root_topic_node_id uuid,
  generation_basis jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(generation_basis) = 'object'),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence_refs) = 'array'),
  content_hash text CHECK (
    content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'
  ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  CHECK (
    (
      status = 'draft'
      AND confirmed_by IS NULL
      AND confirmed_at IS NULL
      AND content_hash IS NULL
    )
    OR (
      status = 'confirmed'
      AND confirmed_by IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND confirmed_at >= created_at
      AND content_hash IS NOT NULL
    )
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  UNIQUE (workspace_id, project_id, revision),
  UNIQUE (workspace_id, project_id, id)
);

ALTER TABLE app.topic_model_revisions
  ADD COLUMN IF NOT EXISTS edit_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'topic_model_revisions_edit_revision_check'
      AND conrelid = 'app.topic_model_revisions'::regclass
  ) THEN
    ALTER TABLE app.topic_model_revisions
      ADD CONSTRAINT topic_model_revisions_edit_revision_check
      CHECK (edit_revision >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS topic_model_revisions_project_created_idx
  ON app.topic_model_revisions(
    workspace_id,
    project_id,
    revision DESC,
    created_at DESC
  );

CREATE UNIQUE INDEX IF NOT EXISTS topic_model_revisions_one_draft_idx
  ON app.topic_model_revisions(workspace_id, project_id)
  WHERE status = 'draft';

-- One UUID is the durable Topic Node identity across renames. Split and merge
-- operations create new identities and use topic_node_successors below; they
-- never recycle this id or rewrite the original legacy label.
CREATE TABLE IF NOT EXISTS app.topic_node_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  created_in_revision integer NOT NULL CHECK (created_in_revision >= 1),
  initial_cluster_key text NOT NULL CHECK (
    length(initial_cluster_key) BETWEEN 1 AND 200
    AND initial_cluster_key = btrim(initial_cluster_key)
  ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, created_in_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  UNIQUE (workspace_id, project_id, initial_cluster_key),
  UNIQUE (workspace_id, project_id, id)
);

-- Labels, hierarchy, intent and lifecycle belong to a model revision, not the
-- stable identity. The composite uniqueness is also the exact historical
-- assignment target used by Keyword Review decisions.
CREATE TABLE IF NOT EXISTS app.topic_node_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  topic_node_id uuid NOT NULL,
  topic_model_revision integer NOT NULL CHECK (topic_model_revision >= 1),
  parent_topic_node_id uuid,
  label text NOT NULL CHECK (
    length(label) BETWEEN 1 AND 200
    AND label = btrim(label)
  ),
  description text CHECK (
    description IS NULL
    OR (
      length(description) BETWEEN 1 AND 2000
      AND description = btrim(description)
    )
  ),
  intent_envelope jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(intent_envelope) = 'array'),
  lifecycle_state text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_state IN ('active','superseded')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    parent_topic_node_id IS NULL
    OR parent_topic_node_id <> topic_node_id
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_model_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_node_id)
    REFERENCES app.topic_node_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    parent_topic_node_id,
    topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (
    workspace_id,
    project_id,
    topic_node_id,
    topic_model_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'topic_model_revisions_root_node_fk'
      AND conrelid = 'app.topic_model_revisions'::regclass
  ) THEN
    ALTER TABLE app.topic_model_revisions
      ADD CONSTRAINT topic_model_revisions_root_node_fk
      FOREIGN KEY (
        workspace_id,
        project_id,
        root_topic_node_id,
        revision
      )
      REFERENCES app.topic_node_revisions(
        workspace_id,
        project_id,
        topic_node_id,
        topic_model_revision
      )
      ON DELETE RESTRICT
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS topic_node_revisions_project_model_idx
  ON app.topic_node_revisions(
    workspace_id,
    project_id,
    topic_model_revision DESC,
    label,
    topic_node_id
  );

-- Historical cluster labels are durable resolution records. Closing a current
-- alias sets its upper revision but never deletes or rewrites the row, so frozen
-- Finding/Opportunity/Content Shadow labels remain resolvable.
CREATE TABLE IF NOT EXISTS app.topic_cluster_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  topic_node_id uuid NOT NULL,
  legacy_cluster_key text NOT NULL CHECK (
    length(legacy_cluster_key) BETWEEN 1 AND 200
    AND legacy_cluster_key = btrim(legacy_cluster_key)
  ),
  valid_from_revision integer NOT NULL CHECK (valid_from_revision >= 1),
  valid_to_revision integer,
  alias_kind text NOT NULL
    CHECK (alias_kind IN ('legacy','canonical','rename')),
  is_current boolean NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    valid_to_revision IS NULL
    OR valid_to_revision >= valid_from_revision
  ),
  CHECK (
    (is_current AND valid_to_revision IS NULL)
    OR (NOT is_current AND valid_to_revision IS NOT NULL)
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_node_id)
    REFERENCES app.topic_node_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, valid_from_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    topic_node_id,
    valid_from_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, valid_to_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    legacy_cluster_key,
    valid_from_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS topic_cluster_aliases_current_label_idx
  ON app.topic_cluster_aliases(
    workspace_id,
    project_id,
    legacy_cluster_key
  )
  WHERE is_current;

CREATE INDEX IF NOT EXISTS topic_cluster_aliases_node_history_idx
  ON app.topic_cluster_aliases(
    workspace_id,
    project_id,
    topic_node_id,
    valid_from_revision DESC
  );

-- Successor edges explain split/merge navigation only. They do not rewrite
-- historical evidence or silently transfer Keyword Review authority.
CREATE TABLE IF NOT EXISTS app.topic_node_successors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  predecessor_topic_node_id uuid NOT NULL,
  successor_topic_node_id uuid NOT NULL,
  topic_model_revision integer NOT NULL CHECK (topic_model_revision >= 1),
  successor_kind text NOT NULL
    CHECK (successor_kind IN ('split_into','merged_into')),
  created_by uuid NOT NULL,
  reason text NOT NULL CHECK (
    length(reason) BETWEEN 3 AND 4000
    AND reason = btrim(reason)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (predecessor_topic_node_id <> successor_topic_node_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    predecessor_topic_node_id
  )
    REFERENCES app.topic_node_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    predecessor_topic_node_id,
    topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    successor_topic_node_id
  )
    REFERENCES app.topic_node_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    successor_topic_node_id,
    topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_model_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    predecessor_topic_node_id,
    successor_topic_node_id,
    topic_model_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS topic_node_successors_predecessor_idx
  ON app.topic_node_successors(
    workspace_id,
    project_id,
    predecessor_topic_node_id,
    topic_model_revision DESC
  );

CREATE INDEX IF NOT EXISTS topic_node_successors_successor_idx
  ON app.topic_node_successors(
    workspace_id,
    project_id,
    successor_topic_node_id,
    topic_model_revision DESC
  );

-- One append-only decision freezes the complete row governed by the legacy
-- reviewAndMap command. governance_revision deliberately starts at the current
-- mapping_revision during migration; missing intermediate history is recorded,
-- never reconstructed.
CREATE TABLE IF NOT EXISTS app.keyword_review_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  keyword_entity_id uuid NOT NULL,
  governance_revision integer NOT NULL CHECK (governance_revision >= 0),
  decision_origin text NOT NULL CHECK (
    decision_origin IN ('migration_baseline','user','system_suggestion')
  ),
  status text NOT NULL
    CHECK (status IN ('candidate','approved','excluded','parked')),
  intent text CHECK (
    intent IS NULL
    OR (
      length(intent) BETWEEN 1 AND 100
      AND intent = btrim(intent)
    )
  ),
  buyer_stage text CHECK (
    buyer_stage IS NULL
    OR (
      length(buyer_stage) BETWEEN 1 AND 100
      AND buyer_stage = btrim(buyer_stage)
    )
  ),
  topic_node_id uuid,
  topic_model_revision integer CHECK (
    topic_model_revision IS NULL OR topic_model_revision >= 1
  ),
  cluster_key_at_decision text CHECK (
    cluster_key_at_decision IS NULL
    OR (
      length(cluster_key_at_decision) BETWEEN 1 AND 200
      AND cluster_key_at_decision = btrim(cluster_key_at_decision)
    )
  ),
  mapping_decision text NOT NULL
    CHECK (mapping_decision IN ('unassigned','existing_page','new_asset')),
  mapped_site_page_id uuid,
  review_state text NOT NULL
    CHECK (review_state IN ('unreviewed','confirmed')),
  assignment_invalidated_by text CHECK (
    assignment_invalidated_by IS NULL
    OR assignment_invalidated_by IN (
      'topic_split',
      'topic_merge',
      'topic_retire'
    )
  ),
  decided_by uuid,
  reason text NOT NULL CHECK (
    length(reason) BETWEEN 3 AND 4000
    AND reason = btrim(reason)
  ),
  decided_at timestamptz NOT NULL,
  reviewed_projection jsonb NOT NULL
    CHECK (jsonb_typeof(reviewed_projection) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (topic_node_id IS NULL) = (topic_model_revision IS NULL)
  ),
  CHECK (
    topic_node_id IS NULL OR cluster_key_at_decision IS NOT NULL
  ),
  CHECK (
    assignment_invalidated_by IS NULL OR review_state = 'unreviewed'
  ),
  CHECK (
    (mapping_decision = 'existing_page' AND mapped_site_page_id IS NOT NULL)
    OR (
      mapping_decision IN ('unassigned','new_asset')
      AND mapped_site_page_id IS NULL
    )
  ),
  CHECK (
    (decision_origin = 'migration_baseline' AND decided_by IS NULL)
    OR (decision_origin <> 'migration_baseline' AND decided_by IS NOT NULL)
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, keyword_entity_id)
    REFERENCES app.keyword_entities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, topic_model_revision)
    REFERENCES app.topic_model_revisions(
      workspace_id,
      project_id,
      revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    topic_node_id,
    topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, mapped_site_page_id)
    REFERENCES app.site_pages(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    keyword_entity_id,
    governance_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX IF NOT EXISTS keyword_review_decisions_project_decided_idx
  ON app.keyword_review_decisions(
    workspace_id,
    project_id,
    decided_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS keyword_review_decisions_topic_idx
  ON app.keyword_review_decisions(
    workspace_id,
    project_id,
    topic_node_id,
    topic_model_revision DESC
  )
  WHERE topic_node_id IS NOT NULL;

-- Only a reviewed, non-null legacy cluster can become canonical Topic truth.
-- Projects with only uncategorized or unreviewed keywords receive baseline
-- Keyword Review Decisions below but no fabricated empty confirmed model.
INSERT INTO app.topic_model_revisions (
  id,
  workspace_id,
  project_id,
  revision,
  status,
  root_topic_node_id,
  generation_basis,
  evidence_refs,
  content_hash,
  created_by
)
SELECT
  gen_random_uuid(),
  entity.workspace_id,
  entity.project_id,
  1,
  'draft',
  NULL,
  jsonb_build_object(
    'origin', 'migration_baseline',
    'source', 'reviewed keyword_entities.cluster_key',
    'projectionVersion', 'topic-model.1.0.0',
    'contentHashMethod', 'postgres-jsonb-sha256.migration-baseline.v1',
    'earlierHistoryAvailable', false
  ),
  '[]'::jsonb,
  NULL,
  project.created_by
FROM app.keyword_entities entity
JOIN app.client_projects project
  ON project.workspace_id = entity.workspace_id
 AND project.id = entity.project_id
WHERE entity.mapping_review_state = 'confirmed'
  AND entity.cluster_key IS NOT NULL
GROUP BY
  entity.workspace_id,
  entity.project_id,
  project.created_by
ON CONFLICT (workspace_id, project_id, revision) DO NOTHING;

-- Every distinct reviewed cluster label receives exactly one durable identity.
-- Repeated reviewed keywords converge; an unreviewed legacy label remains only
-- in its Keyword Review baseline snapshot.
INSERT INTO app.topic_node_identities (
  id,
  workspace_id,
  project_id,
  created_in_revision,
  initial_cluster_key,
  created_by
)
SELECT
  gen_random_uuid(),
  entity.workspace_id,
  entity.project_id,
  1,
  entity.cluster_key,
  project.created_by
FROM app.keyword_entities entity
JOIN app.client_projects project
  ON project.workspace_id = entity.workspace_id
 AND project.id = entity.project_id
WHERE entity.mapping_review_state = 'confirmed'
  AND entity.cluster_key IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM app.topic_node_identities existing
    WHERE existing.workspace_id = entity.workspace_id
      AND existing.project_id = entity.project_id
      AND existing.initial_cluster_key = entity.cluster_key
  )
GROUP BY
  entity.workspace_id,
  entity.project_id,
  entity.cluster_key,
  project.created_by
ON CONFLICT (
  workspace_id,
  project_id,
  initial_cluster_key
) DO NOTHING;

INSERT INTO app.topic_node_revisions (
  id,
  workspace_id,
  project_id,
  topic_node_id,
  topic_model_revision,
  parent_topic_node_id,
  label,
  description,
  intent_envelope,
  lifecycle_state,
  created_by
)
SELECT
  gen_random_uuid(),
  identity.workspace_id,
  identity.project_id,
  identity.id,
  1,
  NULL,
  identity.initial_cluster_key,
  NULL,
  '[]'::jsonb,
  'active',
  identity.created_by
FROM app.topic_node_identities identity
WHERE identity.created_in_revision = 1
  AND NOT EXISTS (
    SELECT 1
    FROM app.topic_node_revisions existing
    WHERE existing.workspace_id = identity.workspace_id
      AND existing.project_id = identity.project_id
      AND existing.topic_node_id = identity.id
      AND existing.topic_model_revision = 1
  )
ON CONFLICT (
  workspace_id,
  project_id,
  topic_node_id,
  topic_model_revision
) DO NOTHING;

-- The migration baseline did not have a hierarchy. Choose one deterministic
-- reviewed Topic as the structural root and attach the remaining reviewed
-- Topics beneath it so the confirmed projection is one reachable tree rather
-- than an unrooted forest. This changes no Keyword-to-Topic assignment.
WITH baseline_roots AS (
  SELECT
    model.workspace_id,
    model.project_id,
    model.revision,
    min(node.topic_node_id::text)::uuid AS root_topic_node_id
  FROM app.topic_model_revisions model
  JOIN app.topic_node_revisions node
    ON node.workspace_id = model.workspace_id
   AND node.project_id = model.project_id
   AND node.topic_model_revision = model.revision
  WHERE model.status = 'draft'
    AND model.generation_basis ->> 'origin' = 'migration_baseline'
  GROUP BY model.workspace_id, model.project_id, model.revision
)
UPDATE app.topic_model_revisions model
SET
  root_topic_node_id = root.root_topic_node_id,
  updated_at = statement_timestamp()
FROM baseline_roots root
WHERE model.workspace_id = root.workspace_id
  AND model.project_id = root.project_id
  AND model.revision = root.revision;

WITH baseline_roots AS (
  SELECT
    workspace_id,
    project_id,
    revision,
    root_topic_node_id
  FROM app.topic_model_revisions
  WHERE status = 'draft'
    AND generation_basis ->> 'origin' = 'migration_baseline'
)
UPDATE app.topic_node_revisions node
SET parent_topic_node_id = root.root_topic_node_id
FROM baseline_roots root
WHERE node.workspace_id = root.workspace_id
  AND node.project_id = root.project_id
  AND node.topic_model_revision = root.revision
  AND node.topic_node_id <> root.root_topic_node_id
  AND node.parent_topic_node_id IS NULL;

INSERT INTO app.topic_cluster_aliases (
  id,
  workspace_id,
  project_id,
  topic_node_id,
  legacy_cluster_key,
  valid_from_revision,
  valid_to_revision,
  alias_kind,
  is_current,
  created_by
)
SELECT
  gen_random_uuid(),
  identity.workspace_id,
  identity.project_id,
  identity.id,
  identity.initial_cluster_key,
  1,
  NULL,
  'legacy',
  true,
  identity.created_by
FROM app.topic_node_identities identity
WHERE identity.created_in_revision = 1
  AND NOT EXISTS (
    SELECT 1
    FROM app.topic_cluster_aliases existing
    WHERE existing.workspace_id = identity.workspace_id
      AND existing.project_id = identity.project_id
      AND existing.legacy_cluster_key = identity.initial_cluster_key
      AND existing.valid_from_revision = 1
  )
ON CONFLICT (
  workspace_id,
  project_id,
  legacy_cluster_key,
  valid_from_revision
) DO NOTHING;

-- Confirmation freezes the just-created baseline topology. PostgreSQL does not
-- implement the application JCS helper, so the migration records an explicit
-- versioned hash method and hashes its complete jsonb projection: model facts,
-- root, nodes, aliases and successor relationships. No two different baseline
-- topologies can share bytes merely because their node labels match.
WITH baseline_projection AS (
  SELECT
    model.workspace_id,
    model.project_id,
    model.revision,
    jsonb_build_object(
      'projectId', model.project_id,
      'topicModelRevision', model.revision,
      'state', 'confirmed',
      'rootTopicNodeId', model.root_topic_node_id,
      'generationBasis', model.generation_basis,
      'evidenceRefs', model.evidence_refs,
      'createdAt', model.created_at,
      'createdBy', model.created_by,
      'nodes', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'topicNodeId', node.topic_node_id,
              'parentTopicNodeId', node.parent_topic_node_id,
              'label', node.label,
              'description', node.description,
              'intentEnvelope', node.intent_envelope,
              'lifecycleState', node.lifecycle_state
            )
            ORDER BY node.topic_node_id
          )
          FROM app.topic_node_revisions node
          WHERE node.workspace_id = model.workspace_id
            AND node.project_id = model.project_id
            AND node.topic_model_revision = model.revision
        ),
        '[]'::jsonb
      ),
      'aliases', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'aliasId', alias.id,
              'topicNodeId', alias.topic_node_id,
              'clusterKey', alias.legacy_cluster_key,
              'validFromTopicModelRevision', alias.valid_from_revision,
              'validThroughTopicModelRevision', alias.valid_to_revision,
              'isCurrent', alias.is_current
            )
            ORDER BY
              alias.legacy_cluster_key,
              alias.valid_from_revision,
              alias.id
          )
          FROM app.topic_cluster_aliases alias
          WHERE alias.workspace_id = model.workspace_id
            AND alias.project_id = model.project_id
            AND alias.valid_from_revision <= model.revision
            AND (
              alias.valid_to_revision IS NULL
              OR alias.valid_to_revision >= model.revision
            )
        ),
        '[]'::jsonb
      ),
      'successorRelationships', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'kind', successor.successor_kind,
              'sourceTopicNodeId',
                successor.predecessor_topic_node_id,
              'successorTopicNodeId',
                successor.successor_topic_node_id,
              'topicModelRevision', successor.topic_model_revision
            )
            ORDER BY
              successor.predecessor_topic_node_id,
              successor.successor_topic_node_id,
              successor.successor_kind
          )
          FROM app.topic_node_successors successor
          WHERE successor.workspace_id = model.workspace_id
            AND successor.project_id = model.project_id
            AND successor.topic_model_revision = model.revision
        ),
        '[]'::jsonb
      )
    ) AS projection
  FROM app.topic_model_revisions model
  WHERE model.revision = 1
    AND model.status = 'draft'
    AND model.generation_basis ->> 'origin' = 'migration_baseline'
)
UPDATE app.topic_model_revisions model
SET
  status = 'confirmed',
  content_hash = encode(
    digest(
      convert_to(baseline.projection::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  confirmed_by = model.created_by,
  confirmed_at = statement_timestamp()
FROM baseline_projection baseline
WHERE model.workspace_id = baseline.workspace_id
  AND model.project_id = baseline.project_id
  AND model.revision = baseline.revision;

-- Only the current legacy row can be recovered. A mapping_revision of seven
-- therefore yields one baseline Decision at revision seven, never seven
-- invented events.
INSERT INTO app.keyword_review_decisions (
  id,
  workspace_id,
  project_id,
  keyword_entity_id,
  governance_revision,
  decision_origin,
  status,
  intent,
  buyer_stage,
  topic_node_id,
  topic_model_revision,
  cluster_key_at_decision,
  mapping_decision,
  mapped_site_page_id,
  review_state,
  assignment_invalidated_by,
  decided_by,
  reason,
  decided_at,
  reviewed_projection
)
SELECT
  gen_random_uuid(),
  entity.workspace_id,
  entity.project_id,
  entity.id,
  entity.mapping_revision,
  'migration_baseline',
  entity.status,
  entity.intent,
  entity.buyer_stage,
  identity.id,
  CASE WHEN identity.id IS NULL THEN NULL ELSE 1 END,
  entity.cluster_key,
  entity.mapping_decision,
  entity.mapped_site_page_id,
  entity.mapping_review_state,
  NULL,
  NULL,
  'Migration baseline; earlier Keyword Review history is unavailable.',
  statement_timestamp(),
  jsonb_build_object(
    'projectId', entity.project_id,
    'keywordId', entity.id,
    'status', entity.status,
    'intent', entity.intent,
    'buyerStage', entity.buyer_stage,
    'topicNodeId', identity.id,
    'topicModelRevision',
      CASE WHEN identity.id IS NULL THEN NULL ELSE 1 END,
    'clusterKey', entity.cluster_key,
    'mappingDecision', entity.mapping_decision,
    'mappedSitePageId', entity.mapped_site_page_id,
    'mappingReviewState', entity.mapping_review_state,
    'governanceRevision', entity.mapping_revision,
    'assignmentInvalidatedBy', NULL,
    'earlierHistoryAvailable', false
  )
FROM app.keyword_entities entity
LEFT JOIN app.topic_node_identities identity
  ON identity.workspace_id = entity.workspace_id
 AND identity.project_id = entity.project_id
 AND identity.initial_cluster_key = entity.cluster_key
 AND entity.mapping_review_state = 'confirmed'
WHERE NOT EXISTS (
  SELECT 1
  FROM app.keyword_review_decisions existing
  WHERE existing.workspace_id = entity.workspace_id
    AND existing.project_id = entity.project_id
    AND existing.keyword_entity_id = entity.id
    AND existing.governance_revision = entity.mapping_revision
)
ON CONFLICT (
  workspace_id,
  project_id,
  keyword_entity_id,
  governance_revision
) DO NOTHING;

-- The retained JSON projection is an audit copy of the typed authority, not a
-- second free-form truth. Reject any insert whose full projection diverges.
CREATE OR REPLACE FUNCTION app.enforce_keyword_review_projection()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  governed_keys text[] := ARRAY[
    'projectId',
    'keywordId',
    'governanceRevision',
    'status',
    'intent',
    'buyerStage',
    'topicNodeId',
    'topicModelRevision',
    'clusterKey',
    'mappingDecision',
    'mappedSitePageId',
    'mappingReviewState',
    'assignmentInvalidatedBy',
    'earlierHistoryAvailable'
  ];
BEGIN
  IF NOT (NEW.reviewed_projection ?& governed_keys)
     OR (
       NEW.reviewed_projection - governed_keys
     ) IS DISTINCT FROM '{}'::jsonb
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'projectId'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'keywordId'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'governanceRevision'),
       ''
     ) <> 'number'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'status'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'intent'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'buyerStage'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'topicNodeId'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'topicModelRevision'),
       ''
     ) NOT IN ('number','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'clusterKey'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'mappingDecision'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'mappedSitePageId'),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(NEW.reviewed_projection -> 'mappingReviewState'),
       ''
     ) <> 'string'
     OR coalesce(
       jsonb_typeof(
         NEW.reviewed_projection -> 'assignmentInvalidatedBy'
       ),
       ''
     ) NOT IN ('string','null')
     OR coalesce(
       jsonb_typeof(
         NEW.reviewed_projection -> 'earlierHistoryAvailable'
       ),
       ''
     ) <> 'boolean' THEN
    RAISE EXCEPTION 'Keyword Review projection shape is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reviewed_projection ->> 'projectId'
       IS DISTINCT FROM NEW.project_id::text
     OR NEW.reviewed_projection ->> 'keywordId'
       IS DISTINCT FROM NEW.keyword_entity_id::text
     OR NEW.reviewed_projection ->> 'status'
       IS DISTINCT FROM NEW.status
     OR NEW.reviewed_projection ->> 'intent'
       IS DISTINCT FROM NEW.intent
     OR NEW.reviewed_projection ->> 'buyerStage'
       IS DISTINCT FROM NEW.buyer_stage
     OR NEW.reviewed_projection ->> 'topicNodeId'
       IS DISTINCT FROM NEW.topic_node_id::text
     OR (NEW.reviewed_projection ->> 'topicModelRevision')::integer
       IS DISTINCT FROM NEW.topic_model_revision
     OR NEW.reviewed_projection ->> 'clusterKey'
       IS DISTINCT FROM NEW.cluster_key_at_decision
     OR NEW.reviewed_projection ->> 'mappingDecision'
       IS DISTINCT FROM NEW.mapping_decision
     OR NEW.reviewed_projection ->> 'mappedSitePageId'
       IS DISTINCT FROM NEW.mapped_site_page_id::text
     OR NEW.reviewed_projection ->> 'mappingReviewState'
       IS DISTINCT FROM NEW.review_state
     OR NEW.reviewed_projection ->> 'assignmentInvalidatedBy'
       IS DISTINCT FROM NEW.assignment_invalidated_by
     OR (NEW.reviewed_projection ->> 'governanceRevision')::integer
       IS DISTINCT FROM NEW.governance_revision THEN
    RAISE EXCEPTION 'Keyword Review projection diverges from typed authority'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.decision_origin = 'migration_baseline'
     AND (
       NEW.reviewed_projection ->> 'earlierHistoryAvailable'
         IS DISTINCT FROM 'false'
     ) THEN
    RAISE EXCEPTION 'migration baseline must disclose unavailable earlier history'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_review_decisions_projection_guard
  ON app.keyword_review_decisions;
CREATE TRIGGER keyword_review_decisions_projection_guard
  BEFORE INSERT ON app.keyword_review_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_review_projection();

-- A model has only the contract states draft/confirmed. Node supersession is a
-- Topic Node lifecycle value, not a mutable model state. A draft may be edited
-- and then confirmed once; after confirmation every model fact is immutable.
CREATE OR REPLACE FUNCTION app.enforce_topic_model_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'confirmed Topic Model revisions are immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Topic Model revision identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'confirmed Topic Model revisions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'draft' THEN
    IF NEW.confirmed_by IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
       OR NEW.content_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Topic Model draft cannot carry confirmation facts'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'confirmed'
     AND NEW.root_topic_node_id IS NOT DISTINCT FROM OLD.root_topic_node_id
     AND NEW.generation_basis IS NOT DISTINCT FROM OLD.generation_basis
     AND NEW.evidence_refs IS NOT DISTINCT FROM OLD.evidence_refs
     AND NEW.edit_revision IS NOT DISTINCT FROM OLD.edit_revision
     AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
     AND NEW.confirmed_by IS NOT NULL
     AND NEW.confirmed_at IS NOT NULL
     AND NEW.content_hash IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Topic Model confirmation may only freeze the draft'
    USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION app.validate_confirmed_topic_model_topology()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  node_count integer;
  reachable_count integer;
BEGIN
  IF NEW.status = 'confirmed' THEN
    IF NEW.root_topic_node_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.topic_node_revisions root
      WHERE root.workspace_id = NEW.workspace_id
        AND root.project_id = NEW.project_id
        AND root.topic_model_revision = NEW.revision
        AND root.topic_node_id = NEW.root_topic_node_id
        AND root.parent_topic_node_id IS NULL
        AND root.lifecycle_state = 'active'
    ) THEN
      RAISE EXCEPTION 'confirmed Topic Model must declare a parentless root'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*)
    INTO node_count
    FROM app.topic_node_revisions node
    WHERE node.workspace_id = NEW.workspace_id
      AND node.project_id = NEW.project_id
      AND node.topic_model_revision = NEW.revision;

    WITH RECURSIVE reachable(topic_node_id) AS (
      SELECT NEW.root_topic_node_id
      UNION
      SELECT child.topic_node_id
      FROM app.topic_node_revisions child
      JOIN reachable parent
        ON child.parent_topic_node_id = parent.topic_node_id
      WHERE child.workspace_id = NEW.workspace_id
        AND child.project_id = NEW.project_id
        AND child.topic_model_revision = NEW.revision
    )
    SELECT count(*)
    INTO reachable_count
    FROM reachable;

    IF node_count = 0 OR reachable_count <> node_count THEN
      RAISE EXCEPTION 'every confirmed Topic Node must be reachable from the root'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_model_revisions_mutation_guard
  ON app.topic_model_revisions;
CREATE TRIGGER topic_model_revisions_mutation_guard
  BEFORE UPDATE OR DELETE ON app.topic_model_revisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_model_revision_mutation();

DROP TRIGGER IF EXISTS topic_model_revisions_topology_guard
  ON app.topic_model_revisions;
CREATE CONSTRAINT TRIGGER topic_model_revisions_topology_guard
  AFTER INSERT OR UPDATE ON app.topic_model_revisions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION app.validate_confirmed_topic_model_topology();

CREATE OR REPLACE FUNCTION app.enforce_topic_node_identity_creation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions model
    WHERE model.workspace_id = NEW.workspace_id
      AND model.project_id = NEW.project_id
      AND model.revision = NEW.created_in_revision
      AND model.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Topic Node identity must be created in a draft model'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_node_identities_creation_guard
  ON app.topic_node_identities;
CREATE TRIGGER topic_node_identities_creation_guard
  BEFORE INSERT ON app.topic_node_identities
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_node_identity_creation();

DROP TRIGGER IF EXISTS topic_node_identities_append_only
  ON app.topic_node_identities;
CREATE TRIGGER topic_node_identities_append_only
  BEFORE UPDATE OR DELETE ON app.topic_node_identities
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION app.enforce_topic_node_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  model_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status
    INTO model_status
    FROM app.topic_model_revisions
    WHERE workspace_id = NEW.workspace_id
      AND project_id = NEW.project_id
      AND revision = NEW.topic_model_revision;

    IF model_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Topic Node revisions may be added only to a draft model'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status
  INTO model_status
  FROM app.topic_model_revisions
  WHERE workspace_id = OLD.workspace_id
    AND project_id = OLD.project_id
    AND revision = OLD.topic_model_revision;

  IF model_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'confirmed Topic Node revisions are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.topic_node_id IS DISTINCT FROM OLD.topic_node_id
     OR NEW.topic_model_revision IS DISTINCT FROM OLD.topic_model_revision
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Topic Node revision identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_node_revisions_mutation_guard
  ON app.topic_node_revisions;
CREATE TRIGGER topic_node_revisions_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.topic_node_revisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_node_revision_mutation();

CREATE OR REPLACE FUNCTION app.prevent_topic_parent_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creates_cycle boolean;
BEGIN
  IF NEW.parent_topic_node_id IS NULL THEN
    RETURN NEW;
  END IF;

  WITH RECURSIVE ancestors(topic_node_id) AS (
    SELECT NEW.parent_topic_node_id
    UNION
    SELECT parent.parent_topic_node_id
    FROM app.topic_node_revisions parent
    JOIN ancestors
      ON ancestors.topic_node_id = parent.topic_node_id
    WHERE parent.workspace_id = NEW.workspace_id
      AND parent.project_id = NEW.project_id
      AND parent.topic_model_revision = NEW.topic_model_revision
      AND parent.parent_topic_node_id IS NOT NULL
  )
  SELECT EXISTS (
    SELECT 1
    FROM ancestors
    WHERE topic_node_id = NEW.topic_node_id
  )
  INTO creates_cycle;

  IF creates_cycle THEN
    RAISE EXCEPTION 'Topic Node parent relationships cannot form a cycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_node_revisions_parent_cycle_guard
  ON app.topic_node_revisions;
CREATE TRIGGER topic_node_revisions_parent_cycle_guard
  BEFORE INSERT OR UPDATE ON app.topic_node_revisions
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_topic_parent_cycle();

CREATE OR REPLACE FUNCTION app.prevent_topic_alias_window_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions model
    WHERE model.workspace_id = NEW.workspace_id
      AND model.project_id = NEW.project_id
      AND model.revision = NEW.valid_from_revision
      AND model.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Topic aliases may be added only to a draft model'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.valid_to_revision IS DISTINCT FROM OLD.valid_to_revision
     AND (
       NEW.valid_to_revision IS NULL
       OR NEW.valid_to_revision = 2147483647
       OR NOT EXISTS (
         SELECT 1
         FROM app.topic_model_revisions model
         WHERE model.workspace_id = NEW.workspace_id
           AND model.project_id = NEW.project_id
           AND model.revision = NEW.valid_to_revision + 1
           AND model.status = 'draft'
       )
     ) THEN
    RAISE EXCEPTION 'Topic aliases must close immediately before a draft model'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.topic_cluster_aliases existing
    WHERE existing.workspace_id = NEW.workspace_id
      AND existing.project_id = NEW.project_id
      AND existing.legacy_cluster_key = NEW.legacy_cluster_key
      AND existing.id <> NEW.id
      AND existing.valid_from_revision
        <= coalesce(NEW.valid_to_revision, 2147483647)
      AND NEW.valid_from_revision
        <= coalesce(existing.valid_to_revision, 2147483647)
  ) THEN
    RAISE EXCEPTION 'Topic cluster alias validity windows cannot overlap'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_cluster_aliases_window_guard
  ON app.topic_cluster_aliases;
CREATE TRIGGER topic_cluster_aliases_window_guard
  BEFORE INSERT OR UPDATE ON app.topic_cluster_aliases
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_topic_alias_window_overlap();

CREATE OR REPLACE FUNCTION app.enforce_topic_cluster_alias_retention()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Topic cluster aliases are retained for frozen data'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.topic_node_id IS DISTINCT FROM OLD.topic_node_id
     OR NEW.legacy_cluster_key IS DISTINCT FROM OLD.legacy_cluster_key
     OR NEW.valid_from_revision IS DISTINCT FROM OLD.valid_from_revision
     OR NEW.alias_kind IS DISTINCT FROM OLD.alias_kind
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NOT OLD.is_current
     OR OLD.valid_to_revision IS NOT NULL
     OR NEW.is_current
     OR NEW.valid_to_revision IS NULL THEN
    RAISE EXCEPTION 'Topic cluster alias history is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_cluster_aliases_retention_guard
  ON app.topic_cluster_aliases;
CREATE TRIGGER topic_cluster_aliases_retention_guard
  BEFORE UPDATE OR DELETE ON app.topic_cluster_aliases
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_cluster_alias_retention();

CREATE OR REPLACE FUNCTION app.prevent_topic_successor_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  creates_cycle boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions model
    WHERE model.workspace_id = NEW.workspace_id
      AND model.project_id = NEW.project_id
      AND model.revision = NEW.topic_model_revision
      AND model.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Topic successor relationships may be added only to a draft model'
      USING ERRCODE = '55000';
  END IF;

  WITH RECURSIVE reachable(topic_node_id) AS (
    SELECT NEW.successor_topic_node_id
    UNION
    SELECT successor.successor_topic_node_id
    FROM app.topic_node_successors successor
    JOIN reachable
      ON reachable.topic_node_id = successor.predecessor_topic_node_id
    WHERE successor.workspace_id = NEW.workspace_id
      AND successor.project_id = NEW.project_id
  )
  SELECT EXISTS (
    SELECT 1
    FROM reachable
    WHERE topic_node_id = NEW.predecessor_topic_node_id
  )
  INTO creates_cycle;

  IF creates_cycle THEN
    RAISE EXCEPTION 'Topic successor relationships cannot form a cycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_node_successors_cycle_guard
  ON app.topic_node_successors;
CREATE TRIGGER topic_node_successors_cycle_guard
  BEFORE INSERT ON app.topic_node_successors
  FOR EACH ROW
  EXECUTE FUNCTION app.prevent_topic_successor_cycle();

DROP TRIGGER IF EXISTS topic_node_successors_append_only
  ON app.topic_node_successors;
CREATE TRIGGER topic_node_successors_append_only
  BEFORE UPDATE OR DELETE ON app.topic_node_successors
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS keyword_review_decisions_append_only
  ON app.keyword_review_decisions;
CREATE TRIGGER keyword_review_decisions_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_review_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0024_keyword_governance_foundation'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0024_keyword_governance_foundation.sql

-- BEGIN EXACT ORDERED MIGRATION 0025_keyword_relation_governance.sql
BEGIN;

-- Duplicate/cannibalization is governed inside Growth Map. A relation is a
-- stable unordered Keyword pair; candidates and decisions are immutable
-- evidence revisions. Folding is a read-model choice and never deletes a
-- Keyword Entity, source occurrence, metric Observation, or result history.
CREATE TABLE app.keyword_relation_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  keyword_a_id uuid NOT NULL,
  keyword_b_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (keyword_a_id < keyword_b_id),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, keyword_a_id)
    REFERENCES app.keyword_entities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, keyword_b_id)
    REFERENCES app.keyword_entities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  UNIQUE (workspace_id, project_id, keyword_a_id, keyword_b_id),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX keyword_relation_identities_keyword_a_idx
  ON app.keyword_relation_identities(
    workspace_id,
    project_id,
    keyword_a_id,
    id
  );

CREATE INDEX keyword_relation_identities_keyword_b_idx
  ON app.keyword_relation_identities(
    workspace_id,
    project_id,
    keyword_b_id,
    id
  );

CREATE OR REPLACE FUNCTION app.normalize_keyword_relation_semantic(
  selected_value text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT lower(
    regexp_replace(
      btrim(normalize(selected_value, NFKC)),
      '[[:space:]]+',
      ' ',
      'g'
    )
  )
$$;

CREATE OR REPLACE FUNCTION app.keyword_relation_token_overlap(
  left_keyword text,
  right_keyword text
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  WITH
  left_tokens AS (
    SELECT DISTINCT token
    FROM regexp_split_to_table(
      app.normalize_keyword_relation_semantic(left_keyword),
      '[[:space:]]+'
    ) token
    WHERE token <> ''
  ),
  right_tokens AS (
    SELECT DISTINCT token
    FROM regexp_split_to_table(
      app.normalize_keyword_relation_semantic(right_keyword),
      '[[:space:]]+'
    ) token
    WHERE token <> ''
  ),
  intersection_count AS (
    SELECT count(*)::numeric AS value
    FROM (
      SELECT token FROM left_tokens
      INTERSECT
      SELECT token FROM right_tokens
    ) intersection_tokens
  ),
  union_count AS (
    SELECT count(*)::numeric AS value
    FROM (
      SELECT token FROM left_tokens
      UNION
      SELECT token FROM right_tokens
    ) union_tokens
  )
  SELECT round(
    intersection_count.value / nullif(union_count.value, 0),
    5
  )
  FROM intersection_count, union_count
$$;

CREATE TABLE app.keyword_relation_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  candidate_revision integer NOT NULL DEFAULT 1
    CHECK (candidate_revision >= 1),
  rule_version text NOT NULL
    CHECK (rule_version = 'keyword-relation.1.0.0'),
  keyword_a_id uuid NOT NULL,
  keyword_a_display_keyword text NOT NULL CHECK (
    length(keyword_a_display_keyword) BETWEEN 1 AND 500
    AND keyword_a_display_keyword = btrim(keyword_a_display_keyword)
  ),
  keyword_a_normalized_keyword text NOT NULL CHECK (
    length(keyword_a_normalized_keyword) BETWEEN 1 AND 500
    AND keyword_a_normalized_keyword =
      app.normalize_keyword_relation_semantic(
        keyword_a_normalized_keyword
      )
    AND keyword_a_normalized_keyword =
      app.normalize_keyword_relation_semantic(
        keyword_a_display_keyword
      )
  ),
  keyword_a_governance_revision integer NOT NULL
    CHECK (keyword_a_governance_revision >= 0),
  keyword_a_topic_node_id uuid,
  keyword_a_topic_model_revision integer CHECK (
    keyword_a_topic_model_revision IS NULL
    OR keyword_a_topic_model_revision >= 1
  ),
  keyword_b_id uuid NOT NULL,
  keyword_b_display_keyword text NOT NULL CHECK (
    length(keyword_b_display_keyword) BETWEEN 1 AND 500
    AND keyword_b_display_keyword = btrim(keyword_b_display_keyword)
  ),
  keyword_b_normalized_keyword text NOT NULL CHECK (
    length(keyword_b_normalized_keyword) BETWEEN 1 AND 500
    AND keyword_b_normalized_keyword =
      app.normalize_keyword_relation_semantic(
        keyword_b_normalized_keyword
      )
    AND keyword_b_normalized_keyword =
      app.normalize_keyword_relation_semantic(
        keyword_b_display_keyword
      )
  ),
  keyword_b_governance_revision integer NOT NULL
    CHECK (keyword_b_governance_revision >= 0),
  keyword_b_topic_node_id uuid,
  keyword_b_topic_model_revision integer CHECK (
    keyword_b_topic_model_revision IS NULL
    OR keyword_b_topic_model_revision >= 1
  ),
  mapped_site_page_id uuid NOT NULL,
  normalized_intent text NOT NULL CHECK (
    length(normalized_intent) BETWEEN 1 AND 100
    AND normalized_intent =
      app.normalize_keyword_relation_semantic(normalized_intent)
  ),
  market text NOT NULL CHECK (
    length(market) BETWEEN 2 AND 32
    AND market = upper(market)
  ),
  language_tag text NOT NULL CHECK (
    length(language_tag) BETWEEN 2 AND 64
    AND language_tag = btrim(language_tag)
  ),
  same_confirmed_topic boolean NOT NULL,
  lexical_token_overlap numeric(6,5) NOT NULL CHECK (
    lexical_token_overlap BETWEEN 0 AND 1
  ),
  serp_overlap_availability text NOT NULL CHECK (
    serp_overlap_availability IN ('available','unavailable')
  ),
  serp_overlap numeric(6,5) CHECK (
    serp_overlap IS NULL OR serp_overlap BETWEEN 0 AND 1
  ),
  serp_overlap_limitation text CHECK (
    serp_overlap_limitation IS NULL
    OR (
      length(serp_overlap_limitation) BETWEEN 1 AND 2000
      AND serp_overlap_limitation = btrim(serp_overlap_limitation)
    )
  ),
  evidence_hash text NOT NULL DEFAULT repeat('0', 64) CHECK (
    evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (keyword_a_id < keyword_b_id),
  CHECK (
    (keyword_a_topic_node_id IS NULL) =
      (keyword_a_topic_model_revision IS NULL)
  ),
  CHECK (
    (keyword_b_topic_node_id IS NULL) =
      (keyword_b_topic_model_revision IS NULL)
  ),
  CHECK (
    same_confirmed_topic = (
      keyword_a_topic_node_id IS NOT NULL
      AND keyword_b_topic_node_id IS NOT NULL
      AND keyword_a_topic_node_id = keyword_b_topic_node_id
    )
  ),
  CHECK (
    (
      serp_overlap_availability = 'available'
      AND serp_overlap IS NOT NULL
      AND serp_overlap_limitation IS NULL
    )
    OR (
      serp_overlap_availability = 'unavailable'
      AND serp_overlap IS NULL
      AND serp_overlap_limitation IS NOT NULL
    )
  ),
  FOREIGN KEY (workspace_id, project_id, relation_id)
    REFERENCES app.keyword_relation_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    keyword_a_id,
    keyword_a_governance_revision
  )
    REFERENCES app.keyword_review_decisions(
      workspace_id,
      project_id,
      keyword_entity_id,
      governance_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    keyword_b_id,
    keyword_b_governance_revision
  )
    REFERENCES app.keyword_review_decisions(
      workspace_id,
      project_id,
      keyword_entity_id,
      governance_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, mapped_site_page_id)
    REFERENCES app.site_pages(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    keyword_a_topic_node_id,
    keyword_a_topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    keyword_b_topic_node_id,
    keyword_b_topic_model_revision
  )
    REFERENCES app.topic_node_revisions(
      workspace_id,
      project_id,
      topic_node_id,
      topic_model_revision
    )
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    relation_id,
    candidate_revision
  ),
  UNIQUE (
    workspace_id,
    project_id,
    relation_id,
    evidence_hash
  ),
  UNIQUE (workspace_id, project_id, relation_id, id),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX keyword_relation_candidates_latest_idx
  ON app.keyword_relation_candidates(
    workspace_id,
    project_id,
    relation_id,
    candidate_revision DESC,
    id DESC
  );

CREATE TABLE app.keyword_relation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  relation_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  relation_revision integer NOT NULL CHECK (relation_revision >= 1),
  decision_kind text NOT NULL CHECK (
    decision_kind IN (
      'primary_supporting',
      'keep_separate',
      'park_secondary',
      'needs_research'
    )
  ),
  primary_keyword_id uuid,
  supporting_keyword_id uuid,
  reason text NOT NULL CHECK (
    length(reason) BETWEEN 3 AND 2000
    AND reason = btrim(reason)
  ),
  decided_by uuid NOT NULL,
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      decision_kind = 'primary_supporting'
      AND primary_keyword_id IS NOT NULL
      AND supporting_keyword_id IS NOT NULL
      AND primary_keyword_id <> supporting_keyword_id
    )
    OR (
      decision_kind <> 'primary_supporting'
      AND primary_keyword_id IS NULL
      AND supporting_keyword_id IS NULL
    )
  ),
  FOREIGN KEY (workspace_id, project_id, relation_id)
    REFERENCES app.keyword_relation_identities(
      workspace_id,
      project_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    relation_id,
    candidate_id
  )
    REFERENCES app.keyword_relation_candidates(
      workspace_id,
      project_id,
      relation_id,
      id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, primary_keyword_id)
    REFERENCES app.keyword_entities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, supporting_keyword_id)
    REFERENCES app.keyword_entities(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  UNIQUE (
    workspace_id,
    project_id,
    relation_id,
    relation_revision
  ),
  UNIQUE (workspace_id, project_id, id)
);

CREATE INDEX keyword_relation_decisions_latest_idx
  ON app.keyword_relation_decisions(
    workspace_id,
    project_id,
    relation_id,
    relation_revision DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION app.keyword_relation_candidate_stale_reasons(
  selected_candidate_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  candidate app.keyword_relation_candidates%ROWTYPE;
  keyword_a app.keyword_entities%ROWTYPE;
  keyword_b app.keyword_entities%ROWTYPE;
  decision_a app.keyword_review_decisions%ROWTYPE;
  decision_b app.keyword_review_decisions%ROWTYPE;
  reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO candidate
  FROM app.keyword_relation_candidates
  WHERE id = selected_candidate_id;

  IF candidate.id IS NULL THEN
    RETURN ARRAY['keyword_unavailable']::text[];
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.keyword_relation_candidates newer
    WHERE newer.workspace_id = candidate.workspace_id
      AND newer.project_id = candidate.project_id
      AND newer.relation_id = candidate.relation_id
      AND newer.candidate_revision > candidate.candidate_revision
  ) THEN
    reasons := array_append(reasons, 'candidate_superseded');
  END IF;

  SELECT * INTO keyword_a
  FROM app.keyword_entities
  WHERE workspace_id = candidate.workspace_id
    AND project_id = candidate.project_id
    AND id = candidate.keyword_a_id;
  SELECT * INTO keyword_b
  FROM app.keyword_entities
  WHERE workspace_id = candidate.workspace_id
    AND project_id = candidate.project_id
    AND id = candidate.keyword_b_id;

  IF keyword_a.id IS NULL OR keyword_b.id IS NULL
     OR keyword_a.status <> 'approved'
     OR keyword_b.status <> 'approved'
     OR keyword_a.mapping_review_state <> 'confirmed'
     OR keyword_b.mapping_review_state <> 'confirmed' THEN
    RETURN array_append(reasons, 'keyword_unavailable');
  END IF;

  SELECT * INTO decision_a
  FROM app.keyword_review_decisions
  WHERE workspace_id = candidate.workspace_id
    AND project_id = candidate.project_id
    AND keyword_entity_id = candidate.keyword_a_id
    AND governance_revision = keyword_a.mapping_revision;
  SELECT * INTO decision_b
  FROM app.keyword_review_decisions
  WHERE workspace_id = candidate.workspace_id
    AND project_id = candidate.project_id
    AND keyword_entity_id = candidate.keyword_b_id
    AND governance_revision = keyword_b.mapping_revision;

  IF decision_a.id IS NULL OR decision_b.id IS NULL
     OR decision_a.assignment_invalidated_by IS NOT NULL
     OR decision_b.assignment_invalidated_by IS NOT NULL THEN
    RETURN array_append(reasons, 'keyword_unavailable');
  END IF;

  IF keyword_a.mapping_revision <>
       candidate.keyword_a_governance_revision
     OR keyword_b.mapping_revision <>
       candidate.keyword_b_governance_revision THEN
    reasons := array_append(
      reasons,
      'governance_revision_changed'
    );
  END IF;

  IF keyword_a.mapping_decision <> 'existing_page'
     OR keyword_b.mapping_decision <> 'existing_page'
     OR keyword_a.mapped_site_page_id IS DISTINCT FROM
       candidate.mapped_site_page_id
     OR keyword_b.mapped_site_page_id IS DISTINCT FROM
       candidate.mapped_site_page_id THEN
    reasons := array_append(reasons, 'mapping_changed');
  END IF;

  IF keyword_a.intent IS NULL
     OR keyword_b.intent IS NULL
     OR app.normalize_keyword_relation_semantic(keyword_a.intent)
       IS DISTINCT FROM candidate.normalized_intent
     OR app.normalize_keyword_relation_semantic(keyword_b.intent)
       IS DISTINCT FROM candidate.normalized_intent THEN
    reasons := array_append(reasons, 'intent_changed');
  END IF;

  IF keyword_a.market IS DISTINCT FROM candidate.market
     OR keyword_b.market IS DISTINCT FROM candidate.market THEN
    reasons := array_append(reasons, 'market_changed');
  END IF;

  IF keyword_a.language_tag IS DISTINCT FROM candidate.language_tag
     OR keyword_b.language_tag IS DISTINCT FROM candidate.language_tag THEN
    reasons := array_append(reasons, 'language_changed');
  END IF;

  RETURN reasons;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_keyword_relation_candidate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  relation app.keyword_relation_identities%ROWTYPE;
  keyword_a app.keyword_entities%ROWTYPE;
  keyword_b app.keyword_entities%ROWTYPE;
  decision_a app.keyword_review_decisions%ROWTYPE;
  decision_b app.keyword_review_decisions%ROWTYPE;
  expected_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || NEW.workspace_id::text || ':'
      || NEW.project_id::text,
    0
  ));

  SELECT * INTO relation
  FROM app.keyword_relation_identities
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND id = NEW.relation_id
  FOR UPDATE;

  IF relation.id IS NULL
     OR relation.keyword_a_id <> NEW.keyword_a_id
     OR relation.keyword_b_id <> NEW.keyword_b_id THEN
    RAISE EXCEPTION 'Keyword Relation candidate pair is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO keyword_a
  FROM app.keyword_entities
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND id = NEW.keyword_a_id
  FOR UPDATE;
  SELECT * INTO keyword_b
  FROM app.keyword_entities
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND id = NEW.keyword_b_id
  FOR UPDATE;

  SELECT * INTO decision_a
  FROM app.keyword_review_decisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND keyword_entity_id = NEW.keyword_a_id
    AND governance_revision = NEW.keyword_a_governance_revision;
  SELECT * INTO decision_b
  FROM app.keyword_review_decisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND keyword_entity_id = NEW.keyword_b_id
    AND governance_revision = NEW.keyword_b_governance_revision;

  IF keyword_a.id IS NULL OR keyword_b.id IS NULL
     OR keyword_a.status <> 'approved'
     OR keyword_b.status <> 'approved'
     OR keyword_a.mapping_review_state <> 'confirmed'
     OR keyword_b.mapping_review_state <> 'confirmed'
     OR keyword_a.mapping_decision <> 'existing_page'
     OR keyword_b.mapping_decision <> 'existing_page'
     OR keyword_a.mapped_site_page_id IS DISTINCT FROM
       NEW.mapped_site_page_id
     OR keyword_b.mapped_site_page_id IS DISTINCT FROM
       NEW.mapped_site_page_id
     OR keyword_a.mapping_revision <>
       NEW.keyword_a_governance_revision
     OR keyword_b.mapping_revision <>
       NEW.keyword_b_governance_revision
     OR decision_a.id IS NULL OR decision_b.id IS NULL
     OR decision_a.review_state <> 'confirmed'
     OR decision_b.review_state <> 'confirmed'
     OR decision_a.assignment_invalidated_by IS NOT NULL
     OR decision_b.assignment_invalidated_by IS NOT NULL
     OR decision_a.topic_node_id IS DISTINCT FROM
       NEW.keyword_a_topic_node_id
     OR decision_a.topic_model_revision IS DISTINCT FROM
       NEW.keyword_a_topic_model_revision
     OR decision_b.topic_node_id IS DISTINCT FROM
       NEW.keyword_b_topic_node_id
     OR decision_b.topic_model_revision IS DISTINCT FROM
       NEW.keyword_b_topic_model_revision
     OR NEW.same_confirmed_topic IS DISTINCT FROM (
       decision_a.topic_node_id IS NOT NULL
       AND decision_b.topic_node_id IS NOT NULL
       AND decision_a.topic_node_id = decision_b.topic_node_id
     )
     OR keyword_a.display_keyword IS DISTINCT FROM
       NEW.keyword_a_display_keyword
     OR keyword_b.display_keyword IS DISTINCT FROM
       NEW.keyword_b_display_keyword
     OR keyword_a.normalized_keyword IS DISTINCT FROM
       NEW.keyword_a_normalized_keyword
     OR keyword_b.normalized_keyword IS DISTINCT FROM
       NEW.keyword_b_normalized_keyword
     OR keyword_a.market IS DISTINCT FROM NEW.market
     OR keyword_b.market IS DISTINCT FROM NEW.market
     OR keyword_a.language_tag IS DISTINCT FROM NEW.language_tag
     OR keyword_b.language_tag IS DISTINCT FROM NEW.language_tag
     OR NEW.lexical_token_overlap IS DISTINCT FROM
       app.keyword_relation_token_overlap(
         keyword_a.normalized_keyword,
         keyword_b.normalized_keyword
       )
     OR keyword_a.intent IS NULL
     OR keyword_b.intent IS NULL
     OR app.normalize_keyword_relation_semantic(keyword_a.intent)
       IS DISTINCT FROM NEW.normalized_intent
     OR app.normalize_keyword_relation_semantic(keyword_b.intent)
       IS DISTINCT FROM NEW.normalized_intent THEN
    RAISE EXCEPTION 'Keyword Relation candidate is not current and eligible'
      USING ERRCODE = '23514';
  END IF;

  NEW.candidate_revision := coalesce(
    (
      SELECT max(existing.candidate_revision)
      FROM app.keyword_relation_candidates existing
      WHERE existing.workspace_id = NEW.workspace_id
        AND existing.project_id = NEW.project_id
        AND existing.relation_id = NEW.relation_id
    ),
    0
  ) + 1;

  expected_hash := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'ruleVersion', NEW.rule_version,
          'keywordA', jsonb_build_object(
            'keywordId', NEW.keyword_a_id,
            'displayKeyword', NEW.keyword_a_display_keyword,
            'normalizedKeyword', NEW.keyword_a_normalized_keyword,
            'governanceRevision',
              NEW.keyword_a_governance_revision,
            'topicNodeId', NEW.keyword_a_topic_node_id,
            'topicModelRevision',
              NEW.keyword_a_topic_model_revision
          ),
          'keywordB', jsonb_build_object(
            'keywordId', NEW.keyword_b_id,
            'displayKeyword', NEW.keyword_b_display_keyword,
            'normalizedKeyword', NEW.keyword_b_normalized_keyword,
            'governanceRevision',
              NEW.keyword_b_governance_revision,
            'topicNodeId', NEW.keyword_b_topic_node_id,
            'topicModelRevision',
              NEW.keyword_b_topic_model_revision
          ),
          'mappedSitePageId', NEW.mapped_site_page_id,
          'normalizedIntent', NEW.normalized_intent,
          'market', NEW.market,
          'languageTag', NEW.language_tag,
          'sameConfirmedTopic', NEW.same_confirmed_topic,
          'lexicalTokenOverlap', NEW.lexical_token_overlap,
          'serpOverlapAvailability',
            NEW.serp_overlap_availability,
          'serpOverlap', NEW.serp_overlap,
          'serpOverlapLimitation',
            NEW.serp_overlap_limitation
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  NEW.evidence_hash := expected_hash;
  RETURN NEW;
END;
$$;

CREATE TRIGGER keyword_relation_candidates_insert_guard
  BEFORE INSERT ON app.keyword_relation_candidates
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_relation_candidate_insert();

CREATE TRIGGER keyword_relation_identities_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_relation_identities
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER keyword_relation_candidates_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_relation_candidates
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION app.enforce_keyword_relation_decision_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  relation app.keyword_relation_identities%ROWTYPE;
  candidate app.keyword_relation_candidates%ROWTYPE;
  expected_revision integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || NEW.workspace_id::text || ':'
      || NEW.project_id::text,
    0
  ));

  SELECT * INTO relation
  FROM app.keyword_relation_identities
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND id = NEW.relation_id
  FOR UPDATE;
  SELECT * INTO candidate
  FROM app.keyword_relation_candidates
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND relation_id = NEW.relation_id
    AND id = NEW.candidate_id;

  IF relation.id IS NULL OR candidate.id IS NULL
     OR candidate.candidate_revision <> (
       SELECT max(latest.candidate_revision)
       FROM app.keyword_relation_candidates latest
       WHERE latest.workspace_id = NEW.workspace_id
         AND latest.project_id = NEW.project_id
         AND latest.relation_id = NEW.relation_id
     )
     OR cardinality(
       app.keyword_relation_candidate_stale_reasons(candidate.id)
     ) <> 0 THEN
    RAISE EXCEPTION 'Keyword Relation decision requires the current candidate'
      USING ERRCODE = '55000';
  END IF;

  expected_revision := coalesce(
    (
      SELECT max(existing.relation_revision)
      FROM app.keyword_relation_decisions existing
      WHERE existing.workspace_id = NEW.workspace_id
        AND existing.project_id = NEW.project_id
        AND existing.relation_id = NEW.relation_id
    ),
    0
  ) + 1;
  IF NEW.relation_revision <> expected_revision THEN
    RAISE EXCEPTION 'Keyword Relation decision revision is stale'
      USING ERRCODE = '40001';
  END IF;

  IF NEW.decision_kind = 'primary_supporting' THEN
    IF NOT (
      (
        NEW.primary_keyword_id = relation.keyword_a_id
        AND NEW.supporting_keyword_id = relation.keyword_b_id
      )
      OR (
        NEW.primary_keyword_id = relation.keyword_b_id
        AND NEW.supporting_keyword_id = relation.keyword_a_id
      )
    ) THEN
      RAISE EXCEPTION 'Fold decision must use the exact relation pair'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      WITH latest_decisions AS (
        SELECT DISTINCT ON (
          decision.workspace_id,
          decision.project_id,
          decision.relation_id
        )
          decision.*
        FROM app.keyword_relation_decisions decision
        WHERE decision.workspace_id = NEW.workspace_id
          AND decision.project_id = NEW.project_id
          AND decision.relation_id <> NEW.relation_id
        ORDER BY
          decision.workspace_id,
          decision.project_id,
          decision.relation_id,
          decision.relation_revision DESC,
          decision.id DESC
      )
      SELECT 1
      FROM latest_decisions decision
      WHERE decision.decision_kind = 'primary_supporting'
        AND cardinality(
          app.keyword_relation_candidate_stale_reasons(
            decision.candidate_id
          )
        ) = 0
        AND (
          decision.supporting_keyword_id IN (
            NEW.primary_keyword_id,
            NEW.supporting_keyword_id
          )
          OR decision.primary_keyword_id =
            NEW.supporting_keyword_id
        )
    ) THEN
      RAISE EXCEPTION 'Keyword folds cannot create chains or cycles'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER keyword_relation_decisions_insert_guard
  BEFORE INSERT ON app.keyword_relation_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_relation_decision_insert();

CREATE TRIGGER keyword_relation_decisions_append_only
  BEFORE UPDATE OR DELETE ON app.keyword_relation_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0025_keyword_relation_governance'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0025_keyword_relation_governance.sql

-- BEGIN EXACT ORDERED MIGRATION 0026_action_execution_state.sql
BEGIN;

-- Execution Center remains one of the existing four customer workbench
-- modules. These ledgers are the backend authority for its Action / Artifact
-- task cards; they do not create another customer-facing surface.
--
-- Legacy Action and Artifact rows already carry workspace/project ownership.
-- Expose those exact identities so every new foreign key can fail closed
-- against the full canonical scope instead of trusting a globally unique id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'actions_workspace_project_id_key'
      AND conrelid = 'app.actions'::regclass
  ) THEN
    ALTER TABLE app.actions
      ADD CONSTRAINT actions_workspace_project_id_key
      UNIQUE (workspace_id, project_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'execution_artifacts_workspace_project_action_id_key'
      AND conrelid = 'app.execution_artifacts'::regclass
  ) THEN
    ALTER TABLE app.execution_artifacts
      ADD CONSTRAINT
        execution_artifacts_workspace_project_action_id_key
      UNIQUE (workspace_id, project_id, action_id, id);
  END IF;
END;
$$;

-- A Step Definition is the immutable source of truth for customer-visible
-- numeric business progress. Array order is the step order. A machine async
-- run percentage is intentionally not represented here.
CREATE TABLE app.action_execution_step_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  action_id uuid NOT NULL,
  artifact_id uuid,
  definition_key text NOT NULL CHECK (
    definition_key ~ '^[a-z][a-z0-9_.-]{0,127}$'
  ),
  definition_version integer NOT NULL CHECK (
    definition_version BETWEEN 1 AND 2147483647
  ),
  steps jsonb NOT NULL CHECK (
    jsonb_typeof(steps) = 'array'
    AND jsonb_array_length(steps) BETWEEN 1 AND 100
  ),
  step_count integer NOT NULL CHECK (
    step_count BETWEEN 1 AND 100
    AND step_count = jsonb_array_length(steps)
  ),
  definition_hash text NOT NULL CHECK (
    definition_hash ~ '^[a-f0-9]{64}$'
  ),
  idempotency_key text NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[ -~]+$'
  ),
  request_hash text NOT NULL CHECK (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, action_id)
    REFERENCES app.actions(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    action_id,
    artifact_id
  )
    REFERENCES app.execution_artifacts(
      workspace_id,
      project_id,
      action_id,
      id
    )
    ON DELETE RESTRICT,
  UNIQUE NULLS NOT DISTINCT (
    workspace_id,
    project_id,
    action_id,
    artifact_id,
    definition_key,
    definition_version
  ),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, idempotency_key)
);

CREATE INDEX action_execution_step_definitions_scope_idx
  ON app.action_execution_step_definitions(
    workspace_id,
    project_id,
    action_id,
    artifact_id,
    definition_key,
    definition_version DESC,
    id
  );

CREATE OR REPLACE FUNCTION
  app.enforce_action_execution_step_definition_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  step_value jsonb;
  distinct_step_keys integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'action-execution:' ||
        NEW.workspace_id::text || ':' || NEW.project_id::text,
      0
    )
  );

  FOR step_value IN
    SELECT value FROM jsonb_array_elements(NEW.steps)
  LOOP
    IF jsonb_typeof(step_value) IS DISTINCT FROM 'object'
       OR (step_value - ARRAY['key', 'label']) <> '{}'::jsonb
       OR NOT (step_value ? 'key' AND step_value ? 'label')
       OR jsonb_typeof(step_value -> 'key') IS DISTINCT FROM 'string'
       OR jsonb_typeof(step_value -> 'label') IS DISTINCT FROM 'string'
       OR (step_value ->> 'key')
         !~ '^[a-z][a-z0-9_.-]{0,127}$'
       OR length(step_value ->> 'label') NOT BETWEEN 1 AND 500
       OR step_value ->> 'label' <> btrim(step_value ->> 'label') THEN
      RAISE EXCEPTION 'Action Step Definition contains an invalid step'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  SELECT count(DISTINCT step ->> 'key')
  INTO distinct_step_keys
  FROM jsonb_array_elements(NEW.steps) step;

  IF distinct_step_keys IS DISTINCT FROM NEW.step_count THEN
    RAISE EXCEPTION 'Action Step Definition step keys must be unique'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER action_execution_step_definitions_insert_guard
  BEFORE INSERT ON app.action_execution_step_definitions
  FOR EACH ROW
  EXECUTE FUNCTION
    app.enforce_action_execution_step_definition_insert();

CREATE TRIGGER action_execution_step_definitions_append_only
  BEFORE UPDATE OR DELETE ON app.action_execution_step_definitions
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

-- Every execution state is a server-authored immutable event. The latest row
-- is the current projection; resolving a blocker or completing an Action only
-- appends a new event and therefore retains the complete audit history.
CREATE TABLE app.action_execution_state_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  action_id uuid NOT NULL,
  artifact_id uuid,
  revision integer NOT NULL CHECK (
    revision BETWEEN 1 AND 2147483647
  ),
  expected_revision integer NOT NULL CHECK (
    expected_revision BETWEEN 0 AND 2147483646
  ),
  state text NOT NULL CHECK (
    state IN ('blocked', 'in_progress', 'completed')
  ),
  transition_kind text NOT NULL CHECK (
    transition_kind IN ('state_transition', 'state_update')
  ),
  phase text NOT NULL CHECK (
    length(phase) BETWEEN 1 AND 100
    AND phase = btrim(phase)
  ),
  next_step text CHECK (
    next_step IS NULL
    OR (
      length(next_step) BETWEEN 1 AND 1000
      AND next_step = btrim(next_step)
    )
  ),
  blocker_code text CHECK (
    blocker_code IS NULL
    OR blocker_code ~ '^[a-z][a-z0-9_.-]{0,127}$'
  ),
  blocker_summary text CHECK (
    blocker_summary IS NULL
    OR (
      length(blocker_summary) BETWEEN 1 AND 2000
      AND blocker_summary = btrim(blocker_summary)
    )
  ),
  unlock_condition text CHECK (
    unlock_condition IS NULL
    OR (
      length(unlock_condition) BETWEEN 1 AND 2000
      AND unlock_condition = btrim(unlock_condition)
    )
  ),
  blocker_owner_id uuid,
  blocker_source_kind text CHECK (
    blocker_source_kind IS NULL
    OR blocker_source_kind IN (
      'qa_claim',
      'provider_readiness',
      'approval',
      'dependency',
      'async_failure',
      'manual'
    )
  ),
  blocker_source_ref text CHECK (
    blocker_source_ref IS NULL
    OR (
      length(blocker_source_ref) BETWEEN 1 AND 1000
      AND blocker_source_ref = btrim(blocker_source_ref)
    )
  ),
  blocker_observed_at timestamptz,
  blocker_freshness text CHECK (
    blocker_freshness IS NULL
    OR blocker_freshness IN ('current', 'stale', 'unknown')
  ),
  step_definition_id uuid
    REFERENCES app.action_execution_step_definitions(id)
    ON DELETE RESTRICT,
  step_definition_version integer CHECK (
    step_definition_version IS NULL
    OR step_definition_version BETWEEN 1 AND 2147483647
  ),
  completed_steps integer,
  total_steps integer,
  idempotency_key text NOT NULL CHECK (
    length(idempotency_key) BETWEEN 1 AND 128
    AND idempotency_key ~ '^[ -~]+$'
  ),
  request_hash text NOT NULL
    CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (revision = expected_revision + 1),
  CHECK (
    (
      state = 'blocked'
      AND blocker_code IS NOT NULL
      AND blocker_summary IS NOT NULL
      AND unlock_condition IS NOT NULL
      AND blocker_source_kind IS NOT NULL
      AND blocker_observed_at IS NOT NULL
      AND blocker_freshness IS NOT NULL
      AND step_definition_id IS NULL
      AND step_definition_version IS NULL
      AND completed_steps IS NULL
      AND total_steps IS NULL
    )
    OR (
      state <> 'blocked'
      AND blocker_code IS NULL
      AND blocker_summary IS NULL
      AND unlock_condition IS NULL
      AND blocker_owner_id IS NULL
      AND blocker_source_kind IS NULL
      AND blocker_source_ref IS NULL
      AND blocker_observed_at IS NULL
      AND blocker_freshness IS NULL
    )
  ),
  CHECK (
    (
      state = 'in_progress'
      AND (
        (
          step_definition_id IS NULL
          AND step_definition_version IS NULL
          AND completed_steps IS NULL
          AND total_steps IS NULL
        )
        OR (
          step_definition_id IS NOT NULL
          AND step_definition_version IS NOT NULL
          AND completed_steps IS NOT NULL
          AND total_steps IS NOT NULL
          AND total_steps > 0
          AND completed_steps BETWEEN 0 AND total_steps
        )
      )
    )
    OR (
      state <> 'in_progress'
      AND step_definition_id IS NULL
      AND step_definition_version IS NULL
      AND completed_steps IS NULL
      AND total_steps IS NULL
    )
  ),
  CHECK (
    state <> 'completed'
    OR next_step IS NULL
  ),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, project_id, action_id)
    REFERENCES app.actions(workspace_id, project_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    workspace_id,
    project_id,
    action_id,
    artifact_id
  )
    REFERENCES app.execution_artifacts(
      workspace_id,
      project_id,
      action_id,
      id
    )
    ON DELETE RESTRICT,
  UNIQUE NULLS NOT DISTINCT (
    workspace_id,
    project_id,
    action_id,
    artifact_id,
    revision
  ),
  UNIQUE (workspace_id, project_id, id),
  UNIQUE (workspace_id, project_id, idempotency_key)
);

CREATE INDEX action_execution_state_events_current_idx
  ON app.action_execution_state_events(
    workspace_id,
    project_id,
    action_id,
    artifact_id,
    revision DESC,
    id DESC
  );

CREATE OR REPLACE FUNCTION app.enforce_action_execution_state_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest app.action_execution_state_events%ROWTYPE;
  step_definition app.action_execution_step_definitions%ROWTYPE;
  current_revision integer;
  expected_revision integer;
  expected_transition_kind text;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'action-execution:' ||
        NEW.workspace_id::text || ':' || NEW.project_id::text,
      0
    )
  );

  SELECT event.*
  INTO latest
  FROM app.action_execution_state_events event
  WHERE event.workspace_id = NEW.workspace_id
    AND event.project_id = NEW.project_id
    AND event.action_id = NEW.action_id
    AND event.artifact_id IS NOT DISTINCT FROM NEW.artifact_id
  ORDER BY event.revision DESC, event.id DESC
  LIMIT 1;

  current_revision := COALESCE(latest.revision, 0);
  expected_revision := current_revision + 1;

  IF NEW.expected_revision IS DISTINCT FROM current_revision
     OR NEW.revision IS DISTINCT FROM expected_revision THEN
    RAISE EXCEPTION 'Action Execution State revision is stale'
      USING ERRCODE = '40001';
  END IF;

  IF latest.state = 'completed' THEN
    RAISE EXCEPTION 'Completed Action Execution State is terminal'
      USING ERRCODE = '55000';
  END IF;

  expected_transition_kind := CASE
    WHEN latest.id IS NULL OR latest.state IS DISTINCT FROM NEW.state
      THEN 'state_transition'
    ELSE 'state_update'
  END;

  IF NEW.transition_kind IS DISTINCT FROM expected_transition_kind THEN
    RAISE EXCEPTION 'Action Execution transition classification is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.step_definition_id IS NOT NULL THEN
    SELECT definition.*
    INTO step_definition
    FROM app.action_execution_step_definitions definition
    WHERE definition.id = NEW.step_definition_id
      AND definition.workspace_id = NEW.workspace_id
      AND definition.project_id = NEW.project_id
      AND definition.action_id = NEW.action_id
      AND definition.artifact_id IS NOT DISTINCT FROM NEW.artifact_id;

    IF step_definition.id IS NULL
       OR step_definition.definition_version IS DISTINCT FROM NEW.step_definition_version
       OR step_definition.step_count IS DISTINCT FROM NEW.total_steps THEN
      RAISE EXCEPTION 'Action Execution progress Step Definition is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER action_execution_state_events_insert_guard
  BEFORE INSERT ON app.action_execution_state_events
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_action_execution_state_insert();

CREATE TRIGGER action_execution_state_events_append_only
  BEFORE UPDATE OR DELETE ON app.action_execution_state_events
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0026_action_execution_state'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0026_action_execution_state.sql

-- BEGIN EXACT ORDERED MIGRATION 0027_competitor_dynamic_monitor.sql
BEGIN;

-- Project-level customer choice. V1 intentionally supports one real cadence:
-- calendar-month collection. GET never inserts this row.
CREATE TABLE app.competitor_monitor_settings (
  project_id uuid PRIMARY KEY
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  frequency text NOT NULL CHECK (frequency = 'monthly'),
  revision integer NOT NULL CHECK (revision BETWEEN 0 AND 2147483647),
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id)
);

-- One monitor attempt is still a normal DataForSEO CollectionRun. This typed
-- child freezes why the target is an approved competitor rather than the
-- customer's primary Site. It prevents competitor data from entering the
-- ordinary Keyword Library projection.
CREATE TABLE app.competitor_monitor_runs (
  id uuid PRIMARY KEY
    REFERENCES app.collection_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  analysis_scopes text[] NOT NULL CHECK (
    cardinality(analysis_scopes) BETWEEN 1 AND 5
    AND analysis_scopes <@ ARRAY[
      'positioning',
      'product_capability',
      'keyword_gap',
      'content',
      'serp_visibility'
    ]::text[]
    AND (
      'content' = ANY(analysis_scopes)
      OR 'serp_visibility' = ANY(analysis_scopes)
    )
  ),
  settings_revision integer NOT NULL CHECK (settings_revision >= 0),
  topic_model_revision integer NOT NULL CHECK (topic_model_revision >= 1),
  target_domain text NOT NULL
    CHECK (app.is_normalized_competitor_domain(target_domain)),
  market text NOT NULL CHECK (market ~ '^[A-Z]{2}$'),
  language_tag text NOT NULL CHECK (
    length(language_tag) BETWEEN 1 AND 255
    AND language_tag = btrim(language_tag)
  ),
  scheduled_for timestamptz NOT NULL,
  previous_monitor_run_id uuid
    REFERENCES app.competitor_monitor_runs(id) ON DELETE RESTRICT,
  previous_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, competitor_id, scheduled_for),
  CHECK (
    (previous_monitor_run_id IS NULL) =
      (previous_snapshot_id IS NULL)
  ),
  CHECK (previous_monitor_run_id IS NULL OR previous_monitor_run_id <> id)
);

CREATE INDEX competitor_monitor_runs_competitor_created_idx
  ON app.competitor_monitor_runs(
    workspace_id,
    project_id,
    competitor_id,
    created_at DESC,
    id DESC
  );

-- Exactly one immutable evaluation can follow a completed/partial canonical
-- collection. Even an unavailable comparison names the current real Snapshot;
-- it never represents a missing rank as zero.
CREATE TABLE app.competitor_monitor_evaluations (
  monitor_run_id uuid PRIMARY KEY
    REFERENCES app.competitor_monitor_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  evaluation_state text NOT NULL CHECK (
    evaluation_state IN ('baseline','available','unavailable')
  ),
  result_snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  previous_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  limitation text CHECK (
    limitation IS NULL OR (
      length(limitation) BETWEEN 1 AND 2000
      AND limitation = btrim(limitation)
    )
  ),
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, project_id, monitor_run_id),
  CHECK (
    (
      evaluation_state = 'available'
      AND previous_snapshot_id IS NOT NULL
    )
    OR (
      evaluation_state = 'baseline'
      AND previous_snapshot_id IS NULL
      AND limitation IS NOT NULL
    )
    OR (
      evaluation_state = 'unavailable'
      AND limitation IS NOT NULL
    )
  )
);

CREATE INDEX competitor_monitor_evaluations_competitor_time_idx
  ON app.competitor_monitor_evaluations(
    workspace_id,
    project_id,
    competitor_id,
    evaluated_at DESC,
    monitor_run_id DESC
  );

-- Signals are evidence for an existing Growth Map competitor-library
-- opportunity update. They are not a new product module and do not silently
-- create/approve an Action.
CREATE TABLE app.competitor_monitor_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  competitor_id uuid NOT NULL
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  monitor_run_id uuid NOT NULL
    REFERENCES app.competitor_monitor_evaluations(monitor_run_id)
      ON DELETE RESTRICT,
  signal_kind text NOT NULL CHECK (
    signal_kind IN ('new_content_overlap','rank_gain')
  ),
  topic_node_id uuid NOT NULL
    REFERENCES app.topic_node_identities(id) ON DELETE RESTRICT,
  topic_model_revision integer NOT NULL CHECK (topic_model_revision >= 1),
  keyword_entity_id uuid
    REFERENCES app.keyword_entities(id) ON DELETE RESTRICT,
  content_url text,
  matched_keyword_ids uuid[],
  overlap_ratio numeric,
  publication_evidence text,
  previous_rank numeric,
  current_rank numeric,
  improvement numeric,
  previous_snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  current_snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  limitation text CHECK (
    limitation IS NULL OR (
      length(limitation) BETWEEN 1 AND 2000
      AND limitation = btrim(limitation)
    )
  ),
  detected_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_snapshot_id <> current_snapshot_id),
  CHECK (
    (
      signal_kind = 'rank_gain'
      AND keyword_entity_id IS NOT NULL
      AND content_url IS NULL
      AND matched_keyword_ids IS NULL
      AND overlap_ratio IS NULL
      AND publication_evidence IS NULL
      AND previous_rank > 0
      AND current_rank > 0
      AND improvement = previous_rank - current_rank
      AND improvement > 5
    )
    OR (
      signal_kind = 'new_content_overlap'
      AND keyword_entity_id IS NULL
      AND content_url IS NOT NULL
      AND length(content_url) BETWEEN 1 AND 2048
      AND matched_keyword_ids IS NOT NULL
      AND cardinality(matched_keyword_ids) >= 2
      AND overlap_ratio >= 0.5
      AND overlap_ratio <= 1
      AND publication_evidence = 'first_observed_in_ranked_keywords'
      AND previous_rank IS NULL
      AND current_rank IS NULL
      AND improvement IS NULL
      AND limitation IS NOT NULL
    )
  )
);

CREATE INDEX competitor_monitor_signals_competitor_time_idx
  ON app.competitor_monitor_signals(
    workspace_id,
    project_id,
    competitor_id,
    detected_at DESC,
    id DESC
  );

CREATE UNIQUE INDEX competitor_monitor_signals_rank_unique_idx
  ON app.competitor_monitor_signals(
    project_id,
    monitor_run_id,
    topic_node_id,
    keyword_entity_id
  )
  WHERE signal_kind = 'rank_gain';

CREATE UNIQUE INDEX competitor_monitor_signals_content_unique_idx
  ON app.competitor_monitor_signals(
    project_id,
    monitor_run_id,
    topic_node_id,
    content_url
  )
  WHERE signal_kind = 'new_content_overlap';

CREATE OR REPLACE FUNCTION app.enforce_competitor_monitor_run_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  competitor app.competitor_entities%ROWTYPE;
  setting app.competitor_monitor_settings%ROWTYPE;
  collection app.collection_runs%ROWTYPE;
  run app.async_runs%ROWTYPE;
  topic app.topic_model_revisions%ROWTYPE;
  primary_site app.sites%ROWTYPE;
  source app.source_connections%ROWTYPE;
  latest_confirmed_revision integer;
  latest_evaluation app.competitor_monitor_evaluations%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'competitor-monitor:' ||
        NEW.workspace_id::text || ':' || NEW.project_id::text || ':' ||
        NEW.competitor_id::text,
      0
    )
  );

  SELECT * INTO competitor
  FROM app.competitor_entities
  WHERE id = NEW.competitor_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR UPDATE;
  IF competitor.id IS NULL
     OR competitor.review_status IS DISTINCT FROM 'approved'
     OR competitor.relationship IS NULL
     OR NEW.analysis_scopes IS DISTINCT FROM competitor.analysis_scope
     OR NOT (
       'content' = ANY(competitor.analysis_scope)
       OR 'serp_visibility' = ANY(competitor.analysis_scope)
     ) THEN
    RAISE EXCEPTION 'competitor monitor requires an approved competitor and explicit content or serp_visibility scope'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.target_domain IS DISTINCT FROM
     regexp_replace(competitor.domain, '^www\.', '') THEN
    RAISE EXCEPTION 'competitor monitor target does not match approved competitor'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO setting
  FROM app.competitor_monitor_settings
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR UPDATE;
  IF setting.project_id IS NULL
     OR setting.enabled IS DISTINCT FROM true
     OR setting.frequency IS DISTINCT FROM 'monthly'
     OR setting.revision IS DISTINCT FROM NEW.settings_revision THEN
    RAISE EXCEPTION 'competitor monitor settings are missing, disabled, or stale'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO primary_site
  FROM app.sites
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND is_primary
  FOR UPDATE;
  IF primary_site.id IS NULL
     OR cardinality(primary_site.market_codes) IS DISTINCT FROM 1
     OR cardinality(primary_site.language_codes) IS DISTINCT FROM 1
     OR primary_site.market_codes[1] IS DISTINCT FROM NEW.market
     OR primary_site.language_codes[1] IS DISTINCT FROM NEW.language_tag THEN
    RAISE EXCEPTION 'competitor monitor requires one exact market and language'
      USING ERRCODE = '23514';
  END IF;

  SELECT max(revision) INTO latest_confirmed_revision
  FROM app.topic_model_revisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND status = 'confirmed';
  SELECT * INTO topic
  FROM app.topic_model_revisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND revision = NEW.topic_model_revision;
  IF topic.id IS NULL
     OR topic.status IS DISTINCT FROM 'confirmed'
     OR latest_confirmed_revision IS DISTINCT FROM NEW.topic_model_revision THEN
    RAISE EXCEPTION 'competitor monitor requires the latest confirmed Topic model'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO collection
  FROM app.collection_runs
  WHERE id = NEW.id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id;
  SELECT * INTO run
  FROM app.async_runs
  WHERE id = NEW.id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id;
  IF collection.id IS NULL
     OR collection.site_id IS DISTINCT FROM primary_site.id
     OR collection.provider IS DISTINCT FROM 'dataforseo'
     OR collection.operation IS DISTINCT FROM 'keyword_gap_import'
     OR collection.method_version IS DISTINCT FROM 'dataforseo.ranked_keywords.v1'
     OR collection.source_connection_id IS NULL
     OR run.id IS NULL
     OR run.kind IS DISTINCT FROM 'collection'
     OR run.status IS DISTINCT FROM 'queued'
     OR run.active_key IS DISTINCT FROM
       ('monitor:competitor:' || NEW.competitor_id::text)
     OR run.request_payload ->> 'provider' IS DISTINCT FROM 'dataforseo'
     OR run.request_payload ->> 'operation' IS DISTINCT FROM
       'keyword_gap_import'
     OR run.request_payload #>> '{collectionScope,target}' IS DISTINCT FROM
       NEW.target_domain
     OR run.request_payload #>> '{collectionScope,marketCode}' IS DISTINCT FROM
       NEW.market
     OR run.request_payload #>> '{collectionScope,languageTag}' IS DISTINCT FROM
       NEW.language_tag THEN
    RAISE EXCEPTION 'competitor monitor CollectionRun lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO source
  FROM app.source_connections
  WHERE id = collection.source_connection_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id;
  IF source.id IS NULL
     OR source.provider IS DISTINCT FROM 'dataforseo'
     OR source.site_id IS DISTINCT FROM primary_site.id
     OR source.state IS DISTINCT FROM 'connected'
     OR source.disconnected_at IS NOT NULL THEN
    RAISE EXCEPTION 'competitor monitor DataForSEO source is unavailable'
      USING ERRCODE = '23514';
  END IF;

  SELECT evaluation.* INTO latest_evaluation
  FROM app.competitor_monitor_evaluations evaluation
  WHERE evaluation.workspace_id = NEW.workspace_id
    AND evaluation.project_id = NEW.project_id
    AND evaluation.competitor_id = NEW.competitor_id
  ORDER BY evaluation.evaluated_at DESC, evaluation.monitor_run_id DESC
  LIMIT 1;
  IF (
    latest_evaluation.monitor_run_id IS NULL
    AND (
      NEW.previous_monitor_run_id IS NOT NULL
      OR NEW.previous_snapshot_id IS NOT NULL
    )
  ) OR (
    latest_evaluation.monitor_run_id IS NOT NULL
    AND (
      NEW.previous_monitor_run_id IS DISTINCT FROM
        latest_evaluation.monitor_run_id
      OR NEW.previous_snapshot_id IS DISTINCT FROM
        latest_evaluation.result_snapshot_id
    )
  ) THEN
    RAISE EXCEPTION 'competitor monitor previous collection is stale'
      USING ERRCODE = '40001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER competitor_monitor_runs_insert_guard
  BEFORE INSERT ON app.competitor_monitor_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_monitor_run_insert();

CREATE OR REPLACE FUNCTION app.enforce_competitor_monitor_evaluation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  monitor app.competitor_monitor_runs%ROWTYPE;
  snapshot app.data_snapshots%ROWTYPE;
  previous_snapshot app.data_snapshots%ROWTYPE;
  run app.async_runs%ROWTYPE;
BEGIN
  SELECT * INTO monitor
  FROM app.competitor_monitor_runs
  WHERE id = NEW.monitor_run_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND competitor_id = NEW.competitor_id;
  SELECT * INTO snapshot
  FROM app.data_snapshots
  WHERE id = NEW.result_snapshot_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND collection_run_id = NEW.monitor_run_id;
  SELECT * INTO run FROM app.async_runs WHERE id = NEW.monitor_run_id;
  IF NEW.previous_snapshot_id IS NOT NULL THEN
    SELECT * INTO previous_snapshot
    FROM app.data_snapshots
    WHERE id = NEW.previous_snapshot_id
      AND workspace_id = NEW.workspace_id
      AND project_id = NEW.project_id;
  END IF;
  IF monitor.id IS NULL
     OR snapshot.id IS NULL
     OR snapshot.provider IS DISTINCT FROM 'dataforseo'
     OR snapshot.dataset_key IS DISTINCT FROM
       'dataforseo.ranked_keywords.v1'
     OR snapshot.availability NOT IN ('available','partial','unavailable')
     OR (
       snapshot.availability = 'unavailable'
       AND NEW.evaluation_state IS DISTINCT FROM 'unavailable'
     )
     OR run.status IS DISTINCT FROM 'running'
     OR NEW.previous_snapshot_id IS DISTINCT FROM
       monitor.previous_snapshot_id
     OR (
       NEW.evaluation_state = 'available'
       AND (
         previous_snapshot.id IS NULL
         OR previous_snapshot.provider IS DISTINCT FROM 'dataforseo'
         OR previous_snapshot.dataset_key IS DISTINCT FROM
           'dataforseo.ranked_keywords.v1'
         OR previous_snapshot.availability NOT IN ('available','partial')
         OR snapshot.captured_at - previous_snapshot.captured_at <
           interval '21 days'
         OR snapshot.captured_at - previous_snapshot.captured_at >
           interval '45 days'
       )
     ) THEN
    RAISE EXCEPTION 'competitor monitor evaluation lineage is invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER competitor_monitor_evaluations_insert_guard
  BEFORE INSERT ON app.competitor_monitor_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_monitor_evaluation_insert();

CREATE OR REPLACE FUNCTION app.enforce_competitor_monitor_signal_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  monitor app.competitor_monitor_runs%ROWTYPE;
  evaluation app.competitor_monitor_evaluations%ROWTYPE;
  topic app.topic_node_revisions%ROWTYPE;
  keyword_row app.keyword_entities%ROWTYPE;
  current_snapshot app.data_snapshots%ROWTYPE;
  previous_snapshot app.data_snapshots%ROWTYPE;
  matched_keyword_count integer;
BEGIN
  SELECT * INTO monitor FROM app.competitor_monitor_runs
  WHERE id = NEW.monitor_run_id;
  SELECT * INTO evaluation FROM app.competitor_monitor_evaluations
  WHERE monitor_run_id = NEW.monitor_run_id;
  SELECT * INTO topic FROM app.topic_node_revisions
  WHERE workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND topic_node_id = NEW.topic_node_id
    AND topic_model_revision = NEW.topic_model_revision
    AND lifecycle_state = 'active';
  SELECT * INTO current_snapshot FROM app.data_snapshots
  WHERE id = NEW.current_snapshot_id;
  SELECT * INTO previous_snapshot FROM app.data_snapshots
  WHERE id = NEW.previous_snapshot_id;
  IF NEW.keyword_entity_id IS NOT NULL THEN
    SELECT * INTO keyword_row FROM app.keyword_entities
    WHERE id = NEW.keyword_entity_id
      AND workspace_id = NEW.workspace_id
      AND project_id = NEW.project_id;
  END IF;
  IF NEW.matched_keyword_ids IS NOT NULL THEN
    SELECT count(DISTINCT matched.id)::integer
    INTO matched_keyword_count
    FROM unnest(NEW.matched_keyword_ids) matched(id);
  END IF;
  IF monitor.id IS NULL
     OR evaluation.monitor_run_id IS NULL
     OR evaluation.evaluation_state IS DISTINCT FROM 'available'
     OR monitor.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR monitor.project_id IS DISTINCT FROM NEW.project_id
     OR monitor.competitor_id IS DISTINCT FROM NEW.competitor_id
     OR monitor.topic_model_revision IS DISTINCT FROM
       NEW.topic_model_revision
     OR evaluation.result_snapshot_id IS DISTINCT FROM
       NEW.current_snapshot_id
     OR evaluation.previous_snapshot_id IS DISTINCT FROM
       NEW.previous_snapshot_id
     OR topic.id IS NULL
     OR (
       NEW.signal_kind = 'rank_gain'
       AND (
         NOT ('serp_visibility' = ANY(monitor.analysis_scopes))
         OR keyword_row.id IS NULL
         OR keyword_row.market IS DISTINCT FROM monitor.market
         OR keyword_row.language_tag IS DISTINCT FROM monitor.language_tag
         OR NOT EXISTS (
           SELECT 1
           FROM app.keyword_review_decisions decision
           WHERE decision.workspace_id = NEW.workspace_id
             AND decision.project_id = NEW.project_id
             AND decision.keyword_entity_id = NEW.keyword_entity_id
             AND decision.governance_revision =
               keyword_row.mapping_revision
             AND decision.review_state = 'confirmed'
             AND decision.assignment_invalidated_by IS NULL
             AND decision.topic_model_revision =
               NEW.topic_model_revision
             AND decision.topic_node_id = NEW.topic_node_id
         )
       )
     )
     OR (
       NEW.signal_kind = 'new_content_overlap'
       AND (
         NOT ('content' = ANY(monitor.analysis_scopes))
         OR current_snapshot.availability IS DISTINCT FROM 'available'
         OR previous_snapshot.availability IS DISTINCT FROM 'available'
         OR matched_keyword_count IS DISTINCT FROM
           cardinality(NEW.matched_keyword_ids)
         OR EXISTS (
           SELECT 1
           FROM unnest(NEW.matched_keyword_ids) matched(id)
           WHERE NOT EXISTS (
             SELECT 1
             FROM app.keyword_entities matched_keyword
             INNER JOIN app.keyword_review_decisions decision
               ON decision.workspace_id =
                    matched_keyword.workspace_id
              AND decision.project_id = matched_keyword.project_id
              AND decision.keyword_entity_id = matched_keyword.id
              AND decision.governance_revision =
                    matched_keyword.mapping_revision
              AND decision.review_state = 'confirmed'
              AND decision.assignment_invalidated_by IS NULL
              AND decision.topic_model_revision =
                    NEW.topic_model_revision
              AND decision.topic_node_id = NEW.topic_node_id
             WHERE matched_keyword.id = matched.id
               AND matched_keyword.workspace_id = NEW.workspace_id
               AND matched_keyword.project_id = NEW.project_id
               AND matched_keyword.market = monitor.market
               AND matched_keyword.language_tag =
                    monitor.language_tag
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'competitor monitor signal lineage is invalid'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER competitor_monitor_signals_insert_guard
  BEFORE INSERT ON app.competitor_monitor_signals
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_monitor_signal_insert();

CREATE TRIGGER competitor_monitor_runs_append_only
  BEFORE UPDATE OR DELETE ON app.competitor_monitor_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER competitor_monitor_evaluations_append_only
  BEFORE UPDATE OR DELETE ON app.competitor_monitor_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER competitor_monitor_signals_append_only
  BEFORE UPDATE OR DELETE ON app.competitor_monitor_signals
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0027_competitor_dynamic_monitor'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0027_competitor_dynamic_monitor.sql

-- BEGIN EXACT ORDERED MIGRATION 0028_geo_citation_authority.sql
BEGIN;

-- GEO is an internal evidence provider for the existing four-module
-- workspace. It extends the canonical collection chain; it is not a new
-- customer-facing product module or a fabricated external data connection.
ALTER TABLE app.source_connections
  DROP CONSTRAINT IF EXISTS source_connections_provider_check;
ALTER TABLE app.source_connections
  ADD CONSTRAINT source_connections_provider_check CHECK (
    provider IN ('crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo')
  );

ALTER TABLE app.collection_runs
  DROP CONSTRAINT IF EXISTS collection_runs_provider_check,
  DROP CONSTRAINT IF EXISTS collection_runs_operation_check;
ALTER TABLE app.collection_runs
  ADD CONSTRAINT collection_runs_provider_check CHECK (
    provider IN ('crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo')
  ),
  ADD CONSTRAINT collection_runs_operation_check CHECK (
    operation IN (
      'site_graph',
      'search_analytics',
      'organic_landing',
      'keyword_gap_import',
      'ai_citation_monitor'
    )
  );

ALTER TABLE app.data_snapshots
  DROP CONSTRAINT IF EXISTS data_snapshots_provider_check,
  DROP CONSTRAINT IF EXISTS data_snapshots_dataset_key_check;
ALTER TABLE app.data_snapshots
  ADD CONSTRAINT data_snapshots_provider_check CHECK (
    provider IN ('crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo')
  ),
  ADD CONSTRAINT data_snapshots_dataset_key_check CHECK (
    dataset_key IN (
      'crawl.site_graph.v1',
      'gsc.page_query_daily.v1',
      'ga4.organic_landing_daily.v1',
      'csv.keyword_gap.v1',
      'dataforseo.ranked_keywords.v1',
      'geo.answer_citations.v1'
    )
  );

ALTER TABLE app.normalized_observations
  DROP CONSTRAINT IF EXISTS normalized_observations_provider_check;
ALTER TABLE app.normalized_observations
  ADD CONSTRAINT normalized_observations_provider_check CHECK (
    provider IN ('crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo')
  );

-- Preserve every existing CollectionRun invariant while admitting the one
-- governed GEO provider/operation pair.
CREATE OR REPLACE FUNCTION app.enforce_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'collection run must be inserted as an unfinished placeholder'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.source_connection_id IS DISTINCT FROM OLD.source_connection_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.method_version IS DISTINCT FROM OLD.method_version
    OR NEW.parameters_hash IS DISTINCT FROM OLD.parameters_hash
    OR NEW.import_preview_id IS DISTINCT FROM OLD.import_preview_id
    OR NEW.crawl_seed_site_page_id IS DISTINCT FROM OLD.crawl_seed_site_page_id
    OR NEW.crawl_seed_url IS DISTINCT FROM OLD.crawl_seed_url
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'collection run source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'collection run outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.provider = NEW.provider
        AND snapshot.method_version = NEW.method_version
        AND snapshot.source_connection_id
          IS NOT DISTINCT FROM NEW.source_connection_id
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
    ) THEN
      RAISE EXCEPTION 'collection run outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.operation = 'site_graph')
    OR (NEW.provider = 'gsc' AND NEW.operation = 'search_analytics')
    OR (NEW.provider = 'ga4' AND NEW.operation = 'organic_landing')
    OR (
      NEW.provider IN ('csv', 'dataforseo')
      AND NEW.operation = 'keyword_gap_import'
    )
    OR (
      NEW.provider = 'geo'
      AND NEW.operation = 'ai_citation_monitor'
    )
  ) THEN
    RAISE EXCEPTION 'collection run operation does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider <> 'csv' AND NEW.source_connection_id IS NULL THEN
    RAISE EXCEPTION 'collection run provider requires a canonical source connection'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider <> 'csv' AND NEW.import_preview_id IS NOT NULL THEN
    RAISE EXCEPTION 'only CSV collection runs may reference an import preview'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'collection'
  ) THEN
    RAISE EXCEPTION 'collection run scope does not match its async run and site'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.source_connections source
    WHERE source.id = NEW.source_connection_id
      AND source.workspace_id = NEW.workspace_id
      AND source.project_id = NEW.project_id
      AND source.site_id = NEW.site_id
      AND source.provider = NEW.provider
  ) THEN
    RAISE EXCEPTION 'collection run source connection provenance is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.import_preview_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.import_previews preview
    WHERE preview.id = NEW.import_preview_id
      AND preview.workspace_id = NEW.workspace_id
      AND preview.project_id = NEW.project_id
      AND preview.site_id = NEW.site_id
      AND preview.template_id = 'keyword_gap_v1'
  ) THEN
    RAISE EXCEPTION 'collection run import preview provenance is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.crawl_seed_site_page_id IS NULL)
     IS DISTINCT FROM (NEW.crawl_seed_url IS NULL) THEN
    RAISE EXCEPTION 'collection run Crawl seed id and URL must be present together'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.crawl_seed_site_page_id IS NOT NULL THEN
    IF NEW.provider <> 'crawl' THEN
      RAISE EXCEPTION 'only Crawl collection runs may reference a seed SitePage'
        USING ERRCODE = '23514';
    END IF;
    IF length(NEW.crawl_seed_url) NOT BETWEEN 1 AND 2048 THEN
      RAISE EXCEPTION 'collection run Crawl seed URL is outside the supported bound'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM app.site_pages page
      WHERE page.id = NEW.crawl_seed_site_page_id
        AND page.workspace_id = NEW.workspace_id
        AND page.project_id = NEW.project_id
        AND page.site_id = NEW.site_id
        AND page.normalized_url = NEW.crawl_seed_url
        AND page.normalized_url_hash = encode(
          digest(convert_to(NEW.crawl_seed_url, 'UTF8'), 'sha256'),
          'hex'
        )
    ) THEN
      RAISE EXCEPTION 'collection run Crawl seed does not match its exact SitePage identity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = NEW.provider
      AND run.method_version = NEW.method_version
      AND run.source_connection_id
        IS NOT DISTINCT FROM NEW.source_connection_id
  ) THEN
    RAISE EXCEPTION 'data snapshot provenance does not match its collection run'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.dataset_key = 'crawl.site_graph.v1')
    OR (
      NEW.provider = 'gsc'
      AND NEW.dataset_key = 'gsc.page_query_daily.v1'
    )
    OR (
      NEW.provider = 'ga4'
      AND NEW.dataset_key = 'ga4.organic_landing_daily.v1'
    )
    OR (
      NEW.provider = 'csv'
      AND NEW.dataset_key = 'csv.keyword_gap.v1'
    )
    OR (
      NEW.provider = 'dataforseo'
      AND NEW.dataset_key IN (
        'csv.keyword_gap.v1',
        'dataforseo.ranked_keywords.v1'
      )
    )
    OR (
      NEW.provider = 'geo'
      AND NEW.dataset_key = 'geo.answer_citations.v1'
    )
  ) THEN
    RAISE EXCEPTION 'data snapshot dataset does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider = 'geo' THEN
    IF NEW.schema_version <> '1'
       OR NEW.row_count <= 0
       OR NEW.availability NOT IN ('available', 'partial')
       OR NOT (
         NEW.summary ?& ARRAY[
           'authority',
           'marketCode',
           'languageTag',
           'collectorKind',
           'collectorProviderKey',
           'collectorVersion',
           'queryCount',
           'unavailableQueryCount',
           'citationCount'
         ]::text[]
       )
       OR NEW.summary ->> 'authority' <> 'geo_citation_authority'
       OR (NEW.summary ->> 'marketCode') !~ '^[A-Z]{2}$'
       OR length(NEW.summary ->> 'languageTag') NOT BETWEEN 1 AND 255
       OR NEW.summary ->> 'collectorKind'
          NOT IN ('vendor_api', 'browser_probe', 'manual_verified')
       OR (NEW.summary ->> 'collectorProviderKey')
          !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
       OR length(NEW.summary ->> 'collectorProviderKey')
          NOT BETWEEN 2 AND 100
       OR length(btrim(NEW.summary ->> 'collectorVersion'))
          NOT BETWEEN 1 AND 500
       OR (NEW.summary ->> 'queryCount') !~ '^[0-9]+$'
       OR (NEW.summary ->> 'unavailableQueryCount') !~ '^[0-9]+$'
       OR (NEW.summary ->> 'citationCount') !~ '^[0-9]+$'
       OR (NEW.summary ->> 'queryCount')::bigint <> NEW.row_count
       OR (NEW.summary ->> 'unavailableQueryCount')::bigint
          > NEW.row_count
       OR (
         NEW.availability = 'available'
         AND (NEW.summary ->> 'unavailableQueryCount')::bigint <> 0
       )
       OR (
         NEW.availability = 'partial'
         AND (NEW.summary ->> 'unavailableQueryCount')::bigint = 0
       )
       OR (NEW.summary ->> 'citationCount')::bigint
          > NEW.row_count::bigint * 100
       OR NEW.captured_at < (
         app.normalize_measurement_source_window(NEW.source_window)
           ->> 'endAt'
       )::timestamptz THEN
      RAISE EXCEPTION 'GEO data snapshot summary or capture window is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_normalized_observation_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
      AND snapshot.provider = NEW.provider
      AND snapshot.captured_at = NEW.observed_at
  ) THEN
    RAISE EXCEPTION 'observation provenance does not match its immutable snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND (
        (
          snapshot.provider = 'crawl'
          AND snapshot.dataset_key = 'crawl.site_graph.v1'
          AND NEW.metric_key IN (
            'crawl.page.v1',
            'crawl.robots.v1',
            'crawl.sitemap.v1'
          )
        )
        OR (
          snapshot.provider = 'gsc'
          AND snapshot.dataset_key = 'gsc.page_query_daily.v1'
          AND NEW.metric_key = 'gsc.page.v1'
        )
        OR (
          snapshot.provider = 'ga4'
          AND snapshot.dataset_key = 'ga4.organic_landing_daily.v1'
          AND NEW.metric_key = 'ga4.landing.v1'
        )
        OR (
          snapshot.provider = 'csv'
          AND snapshot.dataset_key = 'csv.keyword_gap.v1'
          AND NEW.metric_key = 'csv.keyword_gap.v1'
        )
        OR (
          snapshot.provider = 'dataforseo'
          AND (
            (
              snapshot.dataset_key = 'csv.keyword_gap.v1'
              AND NEW.metric_key = 'csv.keyword_gap.v1'
            )
            OR (
              snapshot.dataset_key = 'dataforseo.ranked_keywords.v1'
              AND NEW.metric_key = 'csv.keyword_gap.v1'
            )
          )
        )
        OR (
          snapshot.provider = 'geo'
          AND snapshot.dataset_key = 'geo.answer_citations.v1'
          AND NEW.metric_key = 'geo.page_citations.v1'
        )
      )
  ) THEN
    RAISE EXCEPTION 'observation metric does not belong to its provider dataset'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      NEW.provider IN ('gsc', 'ga4')
      AND NEW.origin = 'first_party'
      AND NEW.grade = 'A'
    )
    OR (
      NEW.provider = 'crawl'
      AND NEW.origin = 'direct_public'
      AND NEW.grade = 'B'
    )
    OR (
      NEW.provider = 'dataforseo'
      AND NEW.origin = 'vendor_observation'
      AND NEW.grade = 'B'
    )
    OR (
      NEW.provider = 'csv'
      AND NEW.origin = 'user_provided'
      AND NEW.grade = 'C'
    )
    OR (
      NEW.provider = 'geo'
      AND (
        (
          NEW.origin = 'vendor_observation'
          AND NEW.grade = 'B'
          AND (
            SELECT snapshot.summary ->> 'collectorKind'
            FROM app.data_snapshots snapshot
            WHERE snapshot.id = NEW.snapshot_id
          ) IN ('vendor_api', 'browser_probe')
        )
        OR (
          NEW.origin = 'user_provided'
          AND NEW.grade = 'C'
          AND (
            SELECT snapshot.summary ->> 'collectorKind'
            FROM app.data_snapshots snapshot
            WHERE snapshot.id = NEW.snapshot_id
          ) = 'manual_verified'
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'observation trust label does not match its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- The normalized page aggregate remains the Measurement-facing projection.
-- This guard proves that it resolves to one exact SitePage and that its
-- aggregate fields are typed, non-negative observed facts.
CREATE OR REPLACE FUNCTION app.enforce_geo_normalized_observation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_row app.data_snapshots%ROWTYPE;
  page_row app.site_pages%ROWTYPE;
  tracked_queries bigint;
  cited_queries bigint;
  citations bigint;
  attempted_queries bigint;
  unavailable_queries bigint;
BEGIN
  IF NEW.provider <> 'geo' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO snapshot_row
  FROM app.data_snapshots
  WHERE id = NEW.snapshot_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND provider = 'geo'
    AND dataset_key = 'geo.answer_citations.v1'
  FOR SHARE;

  SELECT * INTO page_row
  FROM app.site_pages
  WHERE id = NEW.site_page_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND site_id = snapshot_row.site_id
    AND normalized_url = NEW.subject_ref
  FOR SHARE;

  IF snapshot_row.id IS NULL
     OR page_row.id IS NULL
     OR NEW.metric_key <> 'geo.page_citations.v1'
     OR NEW.subject_type <> 'url'
     OR NEW.availability NOT IN ('available', 'partial') THEN
    RAISE EXCEPTION 'GEO normalized observation scope or canonical page lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.availability = 'partial' THEN
    IF NEW.value_json IS NOT NULL OR NEW.unit IS NOT NULL THEN
      RAISE EXCEPTION 'partial GEO observation cannot invent aggregate values'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.value_json) <> 'object'
     OR NEW.value_json ->> 'schemaVersion' <> '1'
     OR NEW.value_json ->> 'marketCode'
        IS DISTINCT FROM snapshot_row.summary ->> 'marketCode'
     OR NEW.value_json ->> 'languageTag'
        IS DISTINCT FROM snapshot_row.summary ->> 'languageTag'
     OR (NEW.value_json ->> 'marketCode') !~ '^[A-Z]{2}$'
     OR length(NEW.value_json ->> 'languageTag') NOT BETWEEN 1 AND 255
     OR (NEW.value_json ->> 'querySetHash') !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(NEW.value_json -> 'trackedQueries') <> 'number'
     OR jsonb_typeof(NEW.value_json -> 'citedQueries') <> 'number'
     OR jsonb_typeof(NEW.value_json -> 'citations') <> 'number'
     OR jsonb_typeof(NEW.value_json -> 'attemptedQueries') <> 'number'
     OR jsonb_typeof(NEW.value_json -> 'unavailableQueries') <> 'number'
     OR (NEW.value_json ->> 'trackedQueries') !~ '^[0-9]+$'
     OR (NEW.value_json ->> 'citedQueries') !~ '^[0-9]+$'
     OR (NEW.value_json ->> 'citations') !~ '^[0-9]+$'
     OR (NEW.value_json ->> 'attemptedQueries') !~ '^[0-9]+$'
     OR (NEW.value_json ->> 'unavailableQueries') !~ '^[0-9]+$'
     OR NEW.unit <> 'tracked_queries' THEN
    RAISE EXCEPTION 'GEO normalized observation aggregate is invalid'
      USING ERRCODE = '23514';
  END IF;

  tracked_queries := (NEW.value_json ->> 'trackedQueries')::bigint;
  cited_queries := (NEW.value_json ->> 'citedQueries')::bigint;
  citations := (NEW.value_json ->> 'citations')::bigint;
  attempted_queries := (NEW.value_json ->> 'attemptedQueries')::bigint;
  unavailable_queries :=
    (NEW.value_json ->> 'unavailableQueries')::bigint;

  IF tracked_queries <= 0
     OR cited_queries > tracked_queries
     OR citations < cited_queries
     OR attempted_queries < tracked_queries
     OR unavailable_queries <> attempted_queries - tracked_queries THEN
    RAISE EXCEPTION 'GEO normalized observation counts are invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geo_normalized_observations_lineage_guard
  ON app.normalized_observations;
CREATE TRIGGER geo_normalized_observations_lineage_guard
BEFORE INSERT ON app.normalized_observations
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_normalized_observation_insert();

CREATE TABLE app.geo_query_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  normalized_observation_id uuid NOT NULL
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  canonical_url text NOT NULL
    CHECK (length(canonical_url) BETWEEN 1 AND 2048),
  market_code text NOT NULL CHECK (market_code ~ '^[A-Z]{2}$'),
  language_tag text NOT NULL
    CHECK (length(btrim(language_tag)) BETWEEN 1 AND 255),
  query_text text NOT NULL
    CHECK (length(btrim(query_text)) BETWEEN 1 AND 500),
  query_hash text NOT NULL CHECK (query_hash ~ '^[a-f0-9]{64}$'),
  platform_kind text NOT NULL
    CHECK (platform_kind IN ('known', 'other')),
  platform_key text NOT NULL
    CHECK (length(platform_key) BETWEEN 2 AND 100),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 500),
  collector_kind text NOT NULL CHECK (
    collector_kind IN ('vendor_api', 'browser_probe', 'manual_verified')
  ),
  collector_provider_key text NOT NULL CHECK (
    collector_provider_key
      ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    AND length(collector_provider_key) BETWEEN 2 AND 100
  ),
  collector_version text NOT NULL
    CHECK (length(btrim(collector_version)) BETWEEN 1 AND 500),
  collected_at timestamptz NOT NULL,
  citation_state text NOT NULL CHECK (
    citation_state IN ('cited', 'mentioned', 'unseen', 'unavailable')
  ),
  answer_evidence_excerpt text CHECK (
    answer_evidence_excerpt IS NULL
    OR length(answer_evidence_excerpt) BETWEEN 1 AND 1000
  ),
  answer_content_hash text CHECK (
    answer_content_hash IS NULL
    OR answer_content_hash ~ '^[a-f0-9]{64}$'
  ),
  answer_selector text CHECK (
    answer_selector IS NULL
    OR length(btrim(answer_selector)) BETWEEN 1 AND 500
  ),
  evidence_statements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(evidence_statements) = 'array'
    AND jsonb_array_length(evidence_statements) <= 20
  ),
  limitation text CHECK (
    limitation IS NULL
    OR length(btrim(limitation)) BETWEEN 1 AND 2000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      platform_kind = 'known'
      AND platform_key IN (
        'chatgpt',
        'perplexity',
        'google_ai_overview',
        'gemini',
        'claude',
        'copilot'
      )
    )
    OR (
      platform_kind = 'other'
      AND platform_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    )
  ),
  CHECK (
    num_nonnulls(
      answer_evidence_excerpt,
      answer_content_hash,
      answer_selector
    ) IN (0, 3)
  ),
  CHECK (
    (
      citation_state = 'unavailable'
      AND answer_evidence_excerpt IS NULL
      AND limitation IS NOT NULL
    )
    OR (
      citation_state <> 'unavailable'
      AND answer_evidence_excerpt IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX geo_query_observations_identity_idx
  ON app.geo_query_observations(
    snapshot_id,
    site_page_id,
    query_hash,
    platform_kind,
    platform_key,
    model,
    collector_provider_key
  );

CREATE INDEX geo_query_observations_normalized_idx
  ON app.geo_query_observations(
    workspace_id,
    project_id,
    normalized_observation_id,
    collected_at,
    id
  );

CREATE TABLE app.geo_citation_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  normalized_observation_id uuid NOT NULL
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  query_observation_id uuid NOT NULL
    REFERENCES app.geo_query_observations(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  canonical_url text NOT NULL
    CHECK (length(canonical_url) BETWEEN 1 AND 2048),
  citation_url text NOT NULL
    CHECK (length(citation_url) BETWEEN 1 AND 2048),
  citation_ordinal integer NOT NULL
    CHECK (citation_ordinal BETWEEN 1 AND 1000),
  answer_evidence_excerpt text NOT NULL
    CHECK (length(answer_evidence_excerpt) BETWEEN 1 AND 1000),
  cited_page_excerpt text NOT NULL
    CHECK (length(cited_page_excerpt) BETWEEN 1 AND 1000),
  cited_page_content_hash text NOT NULL
    CHECK (cited_page_content_hash ~ '^[a-f0-9]{64}$'),
  cited_paragraph_hash text NOT NULL
    CHECK (cited_paragraph_hash ~ '^[a-f0-9]{64}$'),
  cited_paragraph_selector text NOT NULL
    CHECK (length(btrim(cited_paragraph_selector)) BETWEEN 1 AND 500),
  cited_paragraph_index integer CHECK (
    cited_paragraph_index IS NULL
    OR cited_paragraph_index BETWEEN 0 AND 1000000
  ),
  evidence_classification text NOT NULL CHECK (
    evidence_classification = 'direct_observation'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (query_observation_id, citation_ordinal)
);

CREATE INDEX geo_citation_occurrences_query_idx
  ON app.geo_citation_occurrences(
    workspace_id,
    project_id,
    query_observation_id,
    citation_ordinal,
    id
  );

CREATE OR REPLACE FUNCTION app.enforce_geo_query_observation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_row app.data_snapshots%ROWTYPE;
  normalized app.normalized_observations%ROWTYPE;
  page_row app.site_pages%ROWTYPE;
  site_row app.sites%ROWTYPE;
  covered_window jsonb;
  statement_row jsonb;
  statement_evidence jsonb;
BEGIN
  SELECT * INTO snapshot_row
  FROM app.data_snapshots
  WHERE id = NEW.snapshot_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND site_id = NEW.site_id
    AND provider = 'geo'
    AND dataset_key = 'geo.answer_citations.v1'
  FOR SHARE;

  SELECT * INTO normalized
  FROM app.normalized_observations
  WHERE id = NEW.normalized_observation_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND snapshot_id = NEW.snapshot_id
    AND site_page_id = NEW.site_page_id
    AND provider = 'geo'
    AND metric_key = 'geo.page_citations.v1'
    AND subject_type = 'url'
    AND subject_ref = NEW.canonical_url
  FOR SHARE;

  SELECT * INTO page_row
  FROM app.site_pages
  WHERE id = NEW.site_page_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND site_id = NEW.site_id
    AND normalized_url = NEW.canonical_url
  FOR SHARE;

  SELECT * INTO site_row
  FROM app.sites
  WHERE id = NEW.site_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR SHARE;

  IF snapshot_row.id IS NULL
     OR normalized.id IS NULL
     OR page_row.id IS NULL
     OR site_row.id IS NULL
     OR NOT (
       page_row.workspace_id = NEW.workspace_id
       AND page_row.project_id = NEW.project_id
       AND page_row.site_id = NEW.site_id
       AND page_row.normalized_url = NEW.canonical_url
     )
     OR NOT (
       normalized.snapshot_id = NEW.snapshot_id
       AND normalized.site_page_id = NEW.site_page_id
       AND normalized.metric_key = 'geo.page_citations.v1'
     )
     OR NOT (NEW.market_code = ANY(site_row.market_codes))
     OR NOT (NEW.language_tag = ANY(site_row.language_codes))
     OR snapshot_row.summary ->> 'marketCode' <> NEW.market_code
     OR snapshot_row.summary ->> 'languageTag' <> NEW.language_tag
     OR snapshot_row.summary ->> 'collectorKind' <> NEW.collector_kind
     OR snapshot_row.summary ->> 'collectorProviderKey'
        <> NEW.collector_provider_key
     OR snapshot_row.summary ->> 'collectorVersion'
        <> NEW.collector_version THEN
    RAISE EXCEPTION 'GEO query observation scope or canonical page lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  covered_window :=
    app.normalize_measurement_source_window(snapshot_row.source_window);
  IF NEW.collected_at < (covered_window ->> 'startAt')::timestamptz
     OR NEW.collected_at >= (covered_window ->> 'endAt')::timestamptz THEN
    RAISE EXCEPTION 'GEO query collection time is outside its immutable snapshot window'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW.evidence_statements) <> 'array'
     OR jsonb_array_length(NEW.evidence_statements) > 20 THEN
    RAISE EXCEPTION 'GEO evidence statements must be a bounded array'
      USING ERRCODE = '23514';
  END IF;

  FOR statement_row IN
    SELECT value
    FROM jsonb_array_elements(NEW.evidence_statements)
  LOOP
    IF jsonb_typeof(statement_row) <> 'object'
       OR NOT (
         statement_row ?& ARRAY[
           'classification',
           'statement',
           'evidence',
           'limitation'
         ]::text[]
       )
       OR statement_row
          - ARRAY[
              'classification',
              'statement',
              'evidence',
              'limitation'
            ]::text[] <> '{}'::jsonb
       OR statement_row ->> 'classification'
          NOT IN ('observation', 'inference')
       OR length(btrim(statement_row ->> 'statement'))
          NOT BETWEEN 1 AND 1000
       OR NOT (statement_row ? 'limitation') THEN
      RAISE EXCEPTION 'GEO evidence statement shape is invalid'
        USING ERRCODE = '23514';
    END IF;

    statement_evidence := statement_row -> 'evidence';
    IF jsonb_typeof(statement_evidence) <> 'object'
       OR NOT (
         statement_evidence ?& ARRAY[
           'excerpt',
           'contentHash',
           'selector'
         ]::text[]
       )
       OR statement_evidence
          - ARRAY['excerpt', 'contentHash', 'selector']::text[]
          <> '{}'::jsonb
       OR length(statement_evidence ->> 'excerpt')
          NOT BETWEEN 1 AND 1000
       OR (statement_evidence ->> 'contentHash')
          !~ '^[a-f0-9]{64}$'
       OR length(btrim(statement_evidence ->> 'selector'))
          NOT BETWEEN 1 AND 500
       OR (
         statement_row ->> 'limitation' IS NOT NULL
         AND length(btrim(statement_row ->> 'limitation'))
           NOT BETWEEN 1 AND 2000
       )
       OR (
         statement_row ->> 'classification' = 'inference'
         AND statement_row ->> 'limitation' IS NULL
       ) THEN
      RAISE EXCEPTION 'GEO evidence statement is unbounded or unsupported'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER geo_query_observations_insert_guard
BEFORE INSERT ON app.geo_query_observations
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_query_observation_insert();

CREATE OR REPLACE FUNCTION app.enforce_geo_citation_occurrence_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  query_row app.geo_query_observations%ROWTYPE;
  site_row app.sites%ROWTYPE;
BEGIN
  SELECT * INTO query_row
  FROM app.geo_query_observations
  WHERE id = NEW.query_observation_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND site_id = NEW.site_id
    AND snapshot_id = NEW.snapshot_id
    AND normalized_observation_id = NEW.normalized_observation_id
    AND site_page_id = NEW.site_page_id
    AND canonical_url = NEW.canonical_url
    AND citation_state = 'cited'
  FOR SHARE;

  SELECT * INTO site_row
  FROM app.sites
  WHERE id = NEW.site_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR SHARE;

  IF query_row.id IS NULL
     OR site_row.id IS NULL
     OR NEW.citation_url <> NEW.canonical_url
     OR substring(
       NEW.citation_url
       FROM '^(https?://[^/?#]+)'
     ) IS DISTINCT FROM site_row.origin THEN
    RAISE EXCEPTION 'GEO citation occurrence scope or evidence lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER geo_citation_occurrences_insert_guard
BEFORE INSERT ON app.geo_citation_occurrences
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_citation_occurrence_insert();

-- Validate the final, transaction-complete detail ledger against the immutable
-- normalized aggregate. Deferred checks let the writer append snapshot,
-- aggregate, queries, and citations atomically without weakening any boundary.
CREATE OR REPLACE FUNCTION app.enforce_geo_evidence_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_id uuid;
  normalized app.normalized_observations%ROWTYPE;
  attempted_queries bigint;
  tracked_queries bigint;
  cited_queries bigint;
  citation_count bigint;
  invalid_state_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'normalized_observations' THEN
    normalized_id := NEW.id;
  ELSIF TG_TABLE_NAME IN (
    'geo_query_observations',
    'geo_citation_occurrences'
  ) THEN
    normalized_id := NEW.normalized_observation_id;
  ELSE
    RAISE EXCEPTION 'unsupported GEO completeness trigger table'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO normalized
  FROM app.normalized_observations
  WHERE id = normalized_id
    AND provider = 'geo'
    AND metric_key = 'geo.page_citations.v1';
  IF normalized.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE citation_state <> 'unavailable'),
    count(*) FILTER (WHERE citation_state = 'cited'),
    count(*) FILTER (
      WHERE (
        citation_state = 'cited'
        AND (
          SELECT count(*)
          FROM app.geo_citation_occurrences occurrence
          WHERE occurrence.query_observation_id = query_row.id
        ) = 0
      )
      OR (
        citation_state <> 'cited'
        AND EXISTS (
          SELECT 1
          FROM app.geo_citation_occurrences occurrence
          WHERE occurrence.query_observation_id = query_row.id
        )
      )
    )
  INTO
    attempted_queries,
    tracked_queries,
    cited_queries,
    invalid_state_count
  FROM app.geo_query_observations query_row
  WHERE query_row.normalized_observation_id = normalized.id
    AND query_row.workspace_id = normalized.workspace_id
    AND query_row.project_id = normalized.project_id
    AND query_row.snapshot_id = normalized.snapshot_id
    AND query_row.site_page_id = normalized.site_page_id;

  SELECT count(*)
  INTO citation_count
  FROM app.geo_citation_occurrences occurrence
  WHERE occurrence.normalized_observation_id = normalized.id
    AND occurrence.workspace_id = normalized.workspace_id
    AND occurrence.project_id = normalized.project_id
    AND occurrence.snapshot_id = normalized.snapshot_id
    AND occurrence.site_page_id = normalized.site_page_id;

  IF attempted_queries = 0 OR invalid_state_count <> 0 THEN
    RAISE EXCEPTION 'GEO detail ledger is incomplete or conflicts with citation state'
      USING ERRCODE = '23514';
  END IF;

  IF normalized.availability = 'partial' THEN
    IF tracked_queries <> 0
       OR cited_queries <> 0
       OR citation_count <> 0
       OR normalized.value_json IS NOT NULL THEN
      RAISE EXCEPTION 'partial GEO aggregate conflicts with its unavailable query ledger'
        USING ERRCODE = '23514';
    END IF;
  ELSIF normalized.availability = 'available' THEN
    IF tracked_queries <= 0
       OR (normalized.value_json ->> 'trackedQueries')::bigint
          <> tracked_queries
       OR (normalized.value_json ->> 'citedQueries')::bigint
          <> cited_queries
       OR (normalized.value_json ->> 'citations')::bigint
          <> citation_count
       OR (normalized.value_json ->> 'attemptedQueries')::bigint
          <> attempted_queries
       OR (normalized.value_json ->> 'unavailableQueries')::bigint
          <> attempted_queries - tracked_queries THEN
      RAISE EXCEPTION 'GEO normalized aggregate conflicts with its immutable detail ledger'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'GEO evidence cannot use an unavailable aggregate as a zero'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER geo_normalized_observations_completeness_guard
AFTER INSERT ON app.normalized_observations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.provider = 'geo')
EXECUTE FUNCTION app.enforce_geo_evidence_completeness();

CREATE CONSTRAINT TRIGGER geo_query_observations_completeness_guard
AFTER INSERT ON app.geo_query_observations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_evidence_completeness();

CREATE CONSTRAINT TRIGGER geo_citation_occurrences_completeness_guard
AFTER INSERT ON app.geo_citation_occurrences
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_evidence_completeness();

CREATE TRIGGER geo_query_observations_append_only
BEFORE UPDATE OR DELETE ON app.geo_query_observations
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER geo_citation_occurrences_append_only
BEFORE UPDATE OR DELETE ON app.geo_citation_occurrences
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- Upgrade the existing GEO Measurement dimension from an explicit unavailable
-- placeholder to nullable canonical baseline/outcome lineage. Missing evidence
-- remains null and never becomes a numeric zero.
ALTER TABLE app.measurement_geo_dimensions
  ADD COLUMN baseline_observation_id uuid,
  ADD COLUMN outcome_observation_id uuid;

ALTER TABLE app.measurement_geo_dimensions
  ADD CONSTRAINT measurement_geo_dimensions_baseline_snapshot_fk
    FOREIGN KEY (baseline_snapshot_id)
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  ADD CONSTRAINT measurement_geo_dimensions_outcome_snapshot_fk
    FOREIGN KEY (outcome_snapshot_id)
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  ADD CONSTRAINT measurement_geo_dimensions_baseline_observation_fk
    FOREIGN KEY (baseline_observation_id)
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT measurement_geo_dimensions_outcome_observation_fk
    FOREIGN KEY (outcome_observation_id)
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'app.measurement_geo_dimensions'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE app.measurement_geo_dimensions DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE app.measurement_geo_dimensions
  ADD CONSTRAINT measurement_geo_dimensions_state_check CHECK (
    state IN ('observed', 'insufficient_data', 'unavailable', 'regressed')
  ),
  ADD CONSTRAINT measurement_geo_dimensions_baseline_freshness_check CHECK (
    baseline_freshness IS NULL
    OR baseline_freshness IN ('current', 'stale', 'unknown')
  ),
  ADD CONSTRAINT measurement_geo_dimensions_outcome_freshness_check CHECK (
    outcome_freshness IS NULL
    OR outcome_freshness IN ('current', 'stale', 'unknown')
  ),
  ADD CONSTRAINT measurement_geo_dimensions_sample_unit_check CHECK (
    sample_unit = 'tracked_queries'
  ),
  ADD CONSTRAINT measurement_geo_dimensions_coverage_check CHECK (
    coverage IN ('complete', 'partial', 'none')
  ),
  ADD CONSTRAINT measurement_geo_dimensions_limitation_check CHECK (
    limitation IS NULL
    OR length(btrim(limitation)) BETWEEN 1 AND 4000
  ),
  ADD CONSTRAINT measurement_geo_dimensions_baseline_lineage_check CHECK (
    num_nonnulls(
      baseline_source_ref,
      baseline_snapshot_id,
      baseline_observation_id,
      baseline_covered_window,
      baseline_observed_at,
      baseline_freshness
    ) IN (0, 6)
  ),
  ADD CONSTRAINT measurement_geo_dimensions_outcome_lineage_check CHECK (
    num_nonnulls(
      outcome_source_ref,
      outcome_snapshot_id,
      outcome_observation_id,
      outcome_covered_window,
      outcome_observed_at,
      outcome_freshness
    ) IN (0, 6)
  ),
  ADD CONSTRAINT measurement_geo_dimensions_baseline_window_check CHECK (
    baseline_covered_window IS NULL
    OR (
      jsonb_typeof(baseline_covered_window) = 'object'
      AND baseline_covered_window
        - ARRAY['startAt', 'endAt']::text[] = '{}'::jsonb
      AND baseline_covered_window ? 'startAt'
      AND baseline_covered_window ? 'endAt'
      AND baseline_covered_window =
        app.normalize_measurement_source_window(baseline_covered_window)
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_outcome_window_check CHECK (
    outcome_covered_window IS NULL
    OR (
      jsonb_typeof(outcome_covered_window) = 'object'
      AND outcome_covered_window
        - ARRAY['startAt', 'endAt']::text[] = '{}'::jsonb
      AND outcome_covered_window ? 'startAt'
      AND outcome_covered_window ? 'endAt'
      AND outcome_covered_window =
        app.normalize_measurement_source_window(outcome_covered_window)
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_same_source_check CHECK (
    baseline_source_ref IS NULL
    OR outcome_source_ref IS NULL
    OR baseline_source_ref = outcome_source_ref
  ),
  ADD CONSTRAINT measurement_geo_dimensions_distinct_snapshots_check CHECK (
    baseline_snapshot_id IS NULL
    OR outcome_snapshot_id IS NULL
    OR baseline_snapshot_id <> outcome_snapshot_id
  ),
  ADD CONSTRAINT measurement_geo_dimensions_distinct_observations_check CHECK (
    baseline_observation_id IS NULL
    OR outcome_observation_id IS NULL
    OR baseline_observation_id <> outcome_observation_id
  ),
  ADD CONSTRAINT measurement_geo_dimensions_numeric_check CHECK (
    (sample_baseline IS NULL OR sample_baseline >= 0)
    AND (sample_outcome IS NULL OR sample_outcome >= 0)
    AND (
      tracked_queries_baseline IS NULL
      OR tracked_queries_baseline > 0
    )
    AND (
      tracked_queries_outcome IS NULL
      OR tracked_queries_outcome > 0
    )
    AND (
      cited_queries_baseline IS NULL
      OR cited_queries_baseline >= 0
    )
    AND (
      cited_queries_outcome IS NULL
      OR cited_queries_outcome >= 0
    )
    AND (citations_baseline IS NULL OR citations_baseline >= 0)
    AND (citations_outcome IS NULL OR citations_outcome >= 0)
    AND (
      citation_rate_baseline IS NULL
      OR citation_rate_baseline BETWEEN 0 AND 1
    )
    AND (
      citation_rate_outcome IS NULL
      OR citation_rate_outcome BETWEEN 0 AND 1
    )
    AND (
      cited_queries_baseline IS NULL
      OR tracked_queries_baseline IS NULL
      OR cited_queries_baseline <= tracked_queries_baseline
    )
    AND (
      cited_queries_outcome IS NULL
      OR tracked_queries_outcome IS NULL
      OR cited_queries_outcome <= tracked_queries_outcome
    )
    AND (
      citations_baseline IS NULL
      OR cited_queries_baseline IS NULL
      OR citations_baseline >= cited_queries_baseline
    )
    AND (
      citations_outcome IS NULL
      OR cited_queries_outcome IS NULL
      OR citations_outcome >= cited_queries_outcome
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_baseline_metrics_check CHECK (
    (
      baseline_source_ref IS NULL
      AND sample_baseline IS NULL
      AND tracked_queries_baseline IS NULL
      AND cited_queries_baseline IS NULL
      AND citations_baseline IS NULL
      AND citation_rate_baseline IS NULL
    )
    OR (
      baseline_source_ref IS NOT NULL
      AND num_nonnulls(
        sample_baseline,
        tracked_queries_baseline,
        cited_queries_baseline,
        citations_baseline,
        citation_rate_baseline
      ) IN (0, 5)
      AND (
        sample_baseline IS NULL
        OR sample_baseline = tracked_queries_baseline
      )
      AND (
        citation_rate_baseline IS NULL
        OR abs(
          citation_rate_baseline
          - cited_queries_baseline::numeric
            / tracked_queries_baseline::numeric
        ) < 0.000000000001
      )
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_outcome_metrics_check CHECK (
    (
      outcome_source_ref IS NULL
      AND sample_outcome IS NULL
      AND tracked_queries_outcome IS NULL
      AND cited_queries_outcome IS NULL
      AND citations_outcome IS NULL
      AND citation_rate_outcome IS NULL
    )
    OR (
      outcome_source_ref IS NOT NULL
      AND num_nonnulls(
        sample_outcome,
        tracked_queries_outcome,
        cited_queries_outcome,
        citations_outcome,
        citation_rate_outcome
      ) IN (0, 5)
      AND (
        sample_outcome IS NULL
        OR sample_outcome = tracked_queries_outcome
      )
      AND (
        citation_rate_outcome IS NULL
        OR abs(
          citation_rate_outcome
          - cited_queries_outcome::numeric
            / tracked_queries_outcome::numeric
        ) < 0.000000000001
      )
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_no_coverage_check CHECK (
    coverage <> 'none'
    OR (
      sample_baseline IS NULL
      AND sample_outcome IS NULL
      AND tracked_queries_baseline IS NULL
      AND tracked_queries_outcome IS NULL
      AND cited_queries_baseline IS NULL
      AND cited_queries_outcome IS NULL
      AND citations_baseline IS NULL
      AND citations_outcome IS NULL
      AND citation_rate_baseline IS NULL
      AND citation_rate_outcome IS NULL
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_state_shape_check CHECK (
    (
      state = 'unavailable'
      AND baseline_source_ref IS NULL
      AND outcome_source_ref IS NULL
      AND coverage = 'none'
      AND limitation IS NOT NULL
    )
    OR (
      state = 'insufficient_data'
      AND (
        baseline_source_ref IS NOT NULL
        OR outcome_source_ref IS NOT NULL
      )
      AND coverage IN ('partial', 'none')
      AND limitation IS NOT NULL
    )
    OR (
      state IN ('observed', 'regressed')
      AND baseline_source_ref IS NOT NULL
      AND outcome_source_ref IS NOT NULL
      AND coverage <> 'none'
      AND sample_baseline > 0
      AND sample_outcome > 0
      AND tracked_queries_baseline IS NOT NULL
      AND tracked_queries_outcome IS NOT NULL
      AND cited_queries_baseline IS NOT NULL
      AND cited_queries_outcome IS NOT NULL
      AND citations_baseline IS NOT NULL
      AND citations_outcome IS NOT NULL
      AND citation_rate_baseline IS NOT NULL
      AND citation_rate_outcome IS NOT NULL
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_limit_context_check CHECK (
    (
      (baseline_freshness IS NULL OR baseline_freshness = 'current')
      AND (outcome_freshness IS NULL OR outcome_freshness = 'current')
      AND coverage <> 'partial'
    )
    OR limitation IS NOT NULL
  );

CREATE OR REPLACE FUNCTION app.measurement_provider_phase_is_canonical(
  p_workspace_id uuid,
  p_project_id uuid,
  p_site_id uuid,
  p_site_page_id uuid,
  p_canonical_url text,
  p_provider text,
  p_source_ref uuid,
  p_snapshot_id uuid,
  p_observation_id uuid,
  p_covered_window jsonb,
  p_observed_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    JOIN app.source_connections source
      ON source.id = p_source_ref
     AND source.id = snapshot.source_connection_id
     AND source.workspace_id = p_workspace_id
     AND source.project_id = p_project_id
     AND source.site_id = p_site_id
     AND source.provider = p_provider
    JOIN app.normalized_observations observation
      ON observation.id = p_observation_id
     AND observation.snapshot_id = snapshot.id
     AND observation.workspace_id = p_workspace_id
     AND observation.project_id = p_project_id
     AND observation.provider = p_provider
     AND observation.site_page_id = p_site_page_id
     AND observation.metric_key = CASE p_provider
       WHEN 'gsc' THEN 'gsc.page.v1'
       WHEN 'ga4' THEN 'ga4.landing.v1'
       WHEN 'geo' THEN 'geo.page_citations.v1'
       ELSE ''
     END
     AND observation.subject_type = 'url'
     AND observation.subject_ref = p_canonical_url
     AND observation.observed_at = p_observed_at
     AND observation.availability = 'available'
    CROSS JOIN LATERAL (
      SELECT app.normalize_measurement_source_window(
        snapshot.source_window
      ) AS covered_window
    ) normalized
    WHERE snapshot.id = p_snapshot_id
      AND snapshot.workspace_id = p_workspace_id
      AND snapshot.project_id = p_project_id
      AND snapshot.site_id = p_site_id
      AND snapshot.provider = p_provider
      AND snapshot.availability IN ('available', 'partial')
      AND snapshot.dataset_key = CASE p_provider
        WHEN 'gsc' THEN 'gsc.page_query_daily.v1'
        WHEN 'ga4' THEN 'ga4.organic_landing_daily.v1'
        WHEN 'geo' THEN 'geo.answer_citations.v1'
        ELSE ''
      END
      AND normalized.covered_window = p_covered_window
      AND app.normalize_measurement_source_window(p_covered_window) =
        p_covered_window
      AND (p_covered_window ->> 'startAt')::timestamptz
        < (p_covered_window ->> 'endAt')::timestamptz
      AND p_observed_at >=
        (p_covered_window ->> 'endAt')::timestamptz
  );
$$;

CREATE OR REPLACE FUNCTION app.enforce_measurement_dimension_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  window_row app.measurement_windows%ROWTYPE;
  expected_provider text;
  baseline_observation_id uuid;
  outcome_observation_id uuid;
  direct_events jsonb;
  assisted_events jsonb;
  baseline_value jsonb;
  outcome_value jsonb;
  dimension_value jsonb;
BEGIN
  SELECT * INTO window_row
  FROM app.measurement_windows
  WHERE id = NEW.measurement_window_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR SHARE;
  IF window_row.id IS NULL THEN
    RAISE EXCEPTION 'measurement dimension requires a same-scope measurement window'
      USING ERRCODE = '23514';
  END IF;

  expected_provider := CASE
    WHEN TG_TABLE_NAME = 'measurement_gsc_dimensions' THEN 'gsc'
    WHEN TG_TABLE_NAME = 'measurement_ga4_dimensions' THEN 'ga4'
    WHEN TG_TABLE_NAME = 'measurement_geo_dimensions' THEN 'geo'
    ELSE NULL
  END;
  IF expected_provider IS NULL THEN
    RAISE EXCEPTION 'unsupported measurement dimension provider'
      USING ERRCODE = '23514';
  END IF;

  baseline_observation_id :=
    (to_jsonb(NEW) ->> 'baseline_observation_id')::uuid;
  outcome_observation_id :=
    (to_jsonb(NEW) ->> 'outcome_observation_id')::uuid;

  IF NEW.baseline_source_ref IS NOT NULL
     AND NOT app.measurement_provider_phase_is_canonical(
       NEW.workspace_id,
       NEW.project_id,
       window_row.site_id,
       window_row.site_page_id,
       window_row.canonical_url,
       expected_provider,
       NEW.baseline_source_ref,
       NEW.baseline_snapshot_id,
       baseline_observation_id,
       NEW.baseline_covered_window,
       NEW.baseline_observed_at
     ) THEN
    RAISE EXCEPTION 'measurement baseline must reuse canonical provider evidence'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.outcome_source_ref IS NOT NULL
     AND NOT app.measurement_provider_phase_is_canonical(
       NEW.workspace_id,
       NEW.project_id,
       window_row.site_id,
       window_row.site_page_id,
       window_row.canonical_url,
       expected_provider,
       NEW.outcome_source_ref,
       NEW.outcome_snapshot_id,
       outcome_observation_id,
       NEW.outcome_covered_window,
       NEW.outcome_observed_at
     ) THEN
    RAISE EXCEPTION 'measurement outcome must reuse canonical provider evidence'
      USING ERRCODE = '23514';
  END IF;

  IF expected_provider = 'geo' THEN
    dimension_value := to_jsonb(NEW);
    IF NEW.baseline_source_ref IS NOT NULL THEN
      SELECT value_json INTO baseline_value
      FROM app.normalized_observations
      WHERE id = baseline_observation_id;
      IF baseline_value IS NULL
         OR (
           dimension_value ->> 'tracked_queries_baseline' IS NOT NULL
           AND (
             (dimension_value ->> 'tracked_queries_baseline')::bigint
                <> (baseline_value ->> 'trackedQueries')::bigint
             OR (dimension_value ->> 'cited_queries_baseline')::bigint
                <> (baseline_value ->> 'citedQueries')::bigint
             OR (dimension_value ->> 'citations_baseline')::bigint
                <> (baseline_value ->> 'citations')::bigint
           )
         ) THEN
        RAISE EXCEPTION 'GEO baseline metrics must equal their canonical page aggregate'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.outcome_source_ref IS NOT NULL THEN
      SELECT value_json INTO outcome_value
      FROM app.normalized_observations
      WHERE id = outcome_observation_id;
      IF outcome_value IS NULL
         OR (
           dimension_value ->> 'tracked_queries_outcome' IS NOT NULL
           AND (
             (dimension_value ->> 'tracked_queries_outcome')::bigint
                <> (outcome_value ->> 'trackedQueries')::bigint
             OR (dimension_value ->> 'cited_queries_outcome')::bigint
                <> (outcome_value ->> 'citedQueries')::bigint
             OR (dimension_value ->> 'citations_outcome')::bigint
                <> (outcome_value ->> 'citations')::bigint
           )
         ) THEN
        RAISE EXCEPTION 'GEO outcome metrics must equal their canonical page aggregate'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.baseline_source_ref IS NOT NULL
     AND (
       (NEW.baseline_covered_window ->> 'startAt')::timestamptz
          >= window_row.before_end_at
       OR (NEW.baseline_covered_window ->> 'endAt')::timestamptz
          <= window_row.before_start_at
     ) THEN
    RAISE EXCEPTION 'measurement baseline evidence must overlap its fixed phase'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.outcome_source_ref IS NOT NULL
     AND (
       (NEW.outcome_covered_window ->> 'startAt')::timestamptz
          >= window_row.after_end_at
       OR (NEW.outcome_covered_window ->> 'endAt')::timestamptz
          <= window_row.after_start_at
     ) THEN
    RAISE EXCEPTION 'measurement outcome evidence must overlap its fixed phase'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state IN ('observed', 'regressed')
     AND expected_provider <> 'geo'
     AND (
       NEW.baseline_source_ref IS NULL
       OR NEW.outcome_source_ref IS NULL
       OR (NEW.baseline_covered_window ->> 'startAt')::timestamptz
          > window_row.before_start_at
       OR (NEW.baseline_covered_window ->> 'endAt')::timestamptz
          < window_row.before_end_at
       OR (NEW.outcome_covered_window ->> 'startAt')::timestamptz
          > window_row.after_start_at
       OR (NEW.outcome_covered_window ->> 'endAt')::timestamptz
          < window_row.after_end_at
     ) THEN
    RAISE EXCEPTION 'observed measurement sources must contain their measurement phases'
      USING ERRCODE = '23514';
  END IF;

  IF expected_provider = 'geo'
     AND NEW.state IN ('observed', 'regressed') THEN
    IF baseline_value ->> 'marketCode'
          IS DISTINCT FROM outcome_value ->> 'marketCode'
       OR baseline_value ->> 'languageTag'
          IS DISTINCT FROM outcome_value ->> 'languageTag'
       OR baseline_value ->> 'querySetHash'
          IS DISTINCT FROM outcome_value ->> 'querySetHash' THEN
      RAISE EXCEPTION 'observed GEO phases require the same market, language, and query cohort'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'measurement_ga4_dimensions' THEN
    direct_events := to_jsonb(NEW) -> 'direct_event_names';
    assisted_events := to_jsonb(NEW) -> 'assisted_event_names';
    IF (
      jsonb_typeof(direct_events) = 'array'
      AND jsonb_array_length(direct_events) <> (
        SELECT count(DISTINCT event_name)
        FROM jsonb_array_elements_text(direct_events)
          AS direct_event(event_name)
      )
    )
       OR (
         jsonb_typeof(assisted_events) = 'array'
         AND jsonb_array_length(assisted_events) <> (
           SELECT count(DISTINCT event_name)
           FROM jsonb_array_elements_text(assisted_events)
             AS assisted_event(event_name)
         )
       ) THEN
      RAISE EXCEPTION 'GA4 direct and assisted conversion event names must be unique'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_measurement_window_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  gsc app.measurement_gsc_dimensions%ROWTYPE;
  ga4 app.measurement_ga4_dimensions%ROWTYPE;
  geo app.measurement_geo_dimensions%ROWTYPE;
  latest_observed_at timestamptz;
BEGIN
  SELECT * INTO gsc
  FROM app.measurement_gsc_dimensions
  WHERE measurement_window_id = NEW.id;
  SELECT * INTO ga4
  FROM app.measurement_ga4_dimensions
  WHERE measurement_window_id = NEW.id;
  SELECT * INTO geo
  FROM app.measurement_geo_dimensions
  WHERE measurement_window_id = NEW.id;

  IF gsc.measurement_window_id IS NULL
     OR ga4.measurement_window_id IS NULL
     OR geo.measurement_window_id IS NULL THEN
    RAISE EXCEPTION 'final measurement window requires exactly one GSC, GA4, and GEO dimension'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    WHERE run.id = NEW.async_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'measurement'
      AND run.status IN ('completed', 'partial')
      AND run.active_key =
        'measurement:' || NEW.verified_change_receipt_id::text
      AND run.result_type = 'measurement_window'
      AND run.result_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'final measurement requires its exact terminal measurement run'
      USING ERRCODE = '23514';
  END IF;

  SELECT max(observed_at)
  INTO latest_observed_at
  FROM (
    VALUES
      (gsc.baseline_observed_at),
      (gsc.outcome_observed_at),
      (ga4.baseline_observed_at),
      (ga4.outcome_observed_at),
      (geo.baseline_observed_at),
      (geo.outcome_observed_at)
  ) AS provider_observations(observed_at);
  IF latest_observed_at IS NOT NULL
     AND NEW.recorded_at < latest_observed_at THEN
    RAISE EXCEPTION 'final measurement cannot predate its provider observations'
      USING ERRCODE = '23514';
  END IF;

  IF (
    'regressed' IN (gsc.state, ga4.state, geo.state)
    AND NEW.state <> 'regressed'
  )
     OR (
       NEW.state = 'regressed'
       AND 'regressed' NOT IN (gsc.state, ga4.state, geo.state)
     )
     OR (
       NEW.state = 'observed'
       AND 'observed' NOT IN (gsc.state, ga4.state, geo.state)
     )
     OR (
       NEW.state = 'unavailable'
       AND NOT (
         gsc.state = 'unavailable'
         AND ga4.state = 'unavailable'
         AND geo.state = 'unavailable'
       )
     )
     OR (
       NEW.state = 'insufficient_data'
       AND (
         'insufficient_data' NOT IN (gsc.state, ga4.state, geo.state)
         OR 'observed' IN (gsc.state, ga4.state, geo.state)
         OR 'regressed' IN (gsc.state, ga4.state, geo.state)
       )
     ) THEN
    RAISE EXCEPTION 'aggregate measurement state conflicts with provider dimensions'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.geo_query_observations FROM anon';
    EXECUTE 'REVOKE ALL ON app.geo_citation_occurrences FROM anon';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  ) THEN
    EXECUTE 'REVOKE ALL ON app.geo_query_observations FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.geo_citation_occurrences FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0028_geo_citation_authority'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0028_geo_citation_authority.sql

-- BEGIN EXACT ORDERED MIGRATION 0029_keyword_voc_sources.sql
BEGIN;

-- VOC is an internal evidence authority for the existing Growth Map Keyword
-- Library. It is deliberately not a SourceConnection: customers manage only
-- the product's explicit external connections, while these frozen research
-- and public-review observations retain their own immutable lineage.
ALTER TABLE app.collection_runs
  DROP CONSTRAINT IF EXISTS collection_runs_provider_check,
  DROP CONSTRAINT IF EXISTS collection_runs_operation_check;
ALTER TABLE app.collection_runs
  ADD CONSTRAINT collection_runs_provider_check CHECK (
    provider IN (
      'crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo', 'voc'
    )
  ),
  ADD CONSTRAINT collection_runs_operation_check CHECK (
    operation IN (
      'site_graph',
      'search_analytics',
      'organic_landing',
      'keyword_gap_import',
      'ai_citation_monitor',
      'keyword_evidence_collection'
    )
  );

ALTER TABLE app.data_snapshots
  DROP CONSTRAINT IF EXISTS data_snapshots_provider_check,
  DROP CONSTRAINT IF EXISTS data_snapshots_dataset_key_check;
ALTER TABLE app.data_snapshots
  ADD CONSTRAINT data_snapshots_provider_check CHECK (
    provider IN (
      'crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo', 'voc'
    )
  ),
  ADD CONSTRAINT data_snapshots_dataset_key_check CHECK (
    dataset_key IN (
      'crawl.site_graph.v1',
      'gsc.page_query_daily.v1',
      'ga4.organic_landing_daily.v1',
      'csv.keyword_gap.v1',
      'dataforseo.ranked_keywords.v1',
      'geo.answer_citations.v1',
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
  );

ALTER TABLE app.normalized_observations
  DROP CONSTRAINT IF EXISTS normalized_observations_provider_check;
ALTER TABLE app.normalized_observations
  ADD CONSTRAINT normalized_observations_provider_check CHECK (
    provider IN (
      'crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo', 'voc'
    )
  );

ALTER TABLE app.keyword_occurrences
  DROP CONSTRAINT IF EXISTS keyword_occurrences_source_kind_check;
ALTER TABLE app.keyword_occurrences
  ADD CONSTRAINT keyword_occurrences_source_kind_check CHECK (
    source_kind IN (
      'csv_import',
      'dataforseo_ranked',
      'gsc_top_query',
      'interview_summary',
      'user_review',
      'manual'
    )
  );

-- Keep the complete pre-0029 canonical guard for every existing provider and
-- route only VOC rows through a smaller provider-specific authority. This
-- prevents the new source from weakening Crawl/GSC/GA4/CSV/DataForSEO/GEO.
CREATE OR REPLACE FUNCTION app.enforce_voc_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> 'voc'
     OR NEW.operation <> 'keyword_evidence_collection'
     OR NEW.method_version NOT IN (
       'voc.interview_summary.v1',
       'voc.user_review.v1'
     ) THEN
    RAISE EXCEPTION 'VOC collection run has an unsupported provider, operation, or method'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'VOC collection run must be inserted as an unfinished placeholder'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.source_connection_id IS DISTINCT FROM OLD.source_connection_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.method_version IS DISTINCT FROM OLD.method_version
    OR NEW.parameters_hash IS DISTINCT FROM OLD.parameters_hash
    OR NEW.import_preview_id IS DISTINCT FROM OLD.import_preview_id
    OR NEW.crawl_seed_site_page_id IS DISTINCT FROM OLD.crawl_seed_site_page_id
    OR NEW.crawl_seed_url IS DISTINCT FROM OLD.crawl_seed_url
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'VOC collection run source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NOT NULL
     OR NEW.import_preview_id IS NOT NULL
     OR NEW.crawl_seed_site_page_id IS NOT NULL
     OR NEW.crawl_seed_url IS NOT NULL THEN
    RAISE EXCEPTION 'VOC is an internal evidence source, not a customer-managed connection or import preview'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'collection'
  ) THEN
    RAISE EXCEPTION 'VOC collection run scope does not match its async run and site'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'VOC collection run outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.provider = 'voc'
        AND snapshot.method_version = NEW.method_version
        AND snapshot.source_connection_id IS NULL
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
    ) THEN
      RAISE EXCEPTION 'VOC collection run outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_runs_provenance_guard
  ON app.collection_runs;
DROP TRIGGER IF EXISTS collection_runs_voc_provenance_guard
  ON app.collection_runs;
CREATE TRIGGER collection_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc')
  EXECUTE FUNCTION app.enforce_collection_run_provenance();
CREATE TRIGGER collection_runs_voc_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider = 'voc')
  EXECUTE FUNCTION app.enforce_voc_collection_run_provenance();

CREATE OR REPLACE FUNCTION app.enforce_voc_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_scope jsonb;
  timing jsonb;
  expected_source_kind text;
  expected_basis text;
  expected_platform text;
  data_as_of text;
BEGIN
  IF NEW.provider <> 'voc'
     OR NEW.dataset_key NOT IN (
       'voc.interview_summary.v1',
       'voc.user_review.v1'
     )
     OR NEW.method_version <> NEW.dataset_key
     OR NEW.source_connection_id IS NOT NULL THEN
    RAISE EXCEPTION 'VOC snapshot provider, dataset, method, or internal-source identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = 'voc'
      AND run.operation = 'keyword_evidence_collection'
      AND run.method_version = NEW.dataset_key
      AND run.source_connection_id IS NULL
      AND run.import_preview_id IS NULL
  ) THEN
    RAISE EXCEPTION 'VOC snapshot provenance does not match its internal collection run'
      USING ERRCODE = '23514';
  END IF;

  evidence_scope := NEW.summary -> 'keywordEvidenceScope';
  timing := NEW.summary -> 'timing';
  expected_source_kind := CASE NEW.dataset_key
    WHEN 'voc.interview_summary.v1' THEN 'interview_summary'
    WHEN 'voc.user_review.v1' THEN 'user_review'
  END;
  expected_basis := CASE expected_source_kind
    WHEN 'interview_summary' THEN 'customer_research'
    WHEN 'user_review' THEN 'public_review_platform'
  END;
  expected_platform := evidence_scope ->> 'reviewPlatform';
  data_as_of := timing ->> 'dataAsOf';

  IF jsonb_typeof(evidence_scope) <> 'object'
     OR jsonb_typeof(timing) <> 'object'
     OR evidence_scope ->> 'sourceKind' <> expected_source_kind
     OR evidence_scope ->> 'basis' <> expected_basis
     OR evidence_scope ->> 'marketCode' !~ '^[A-Z]{2}$'
     OR NOT app.is_bcp47_language_tag(
       evidence_scope ->> 'languageTag'
     )
     OR jsonb_typeof(timing -> 'collectedAt') <> 'string'
     OR (timing ->> 'collectedAt')::timestamptz <> NEW.captured_at
     OR NOT (timing ? 'dataAsOf')
     OR jsonb_typeof(timing -> 'dataAsOf') NOT IN ('string', 'null')
     OR (
       data_as_of IS NOT NULL
       AND data_as_of::timestamptz > NEW.captured_at
     )
     OR (
       expected_source_kind = 'interview_summary'
       AND evidence_scope ? 'reviewPlatform'
     )
     OR (
       expected_source_kind = 'user_review'
       AND expected_platform NOT IN (
         'app_store', 'g2', 'capterra', 'other'
       )
     ) THEN
    RAISE EXCEPTION 'VOC snapshot lacks a valid frozen evidence scope or timing manifest'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_snapshots_provenance_guard
  ON app.data_snapshots;
DROP TRIGGER IF EXISTS data_snapshots_voc_provenance_guard
  ON app.data_snapshots;
CREATE TRIGGER data_snapshots_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc')
  EXECUTE FUNCTION app.enforce_data_snapshot_provenance();
CREATE TRIGGER data_snapshots_voc_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (NEW.provider = 'voc')
  EXECUTE FUNCTION app.enforce_voc_data_snapshot_provenance();

-- One normalized VOC Observation carries only a single extracted Keyword and
-- bounded customer-safe evidence metadata. Raw interview transcripts, review
-- bodies, authors, and participant data belong in protected raw storage and
-- cannot enter this customer-facing projection.
CREATE OR REPLACE FUNCTION app.enforce_voc_keyword_evidence_observation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_row app.data_snapshots%ROWTYPE;
  source_kind text;
  evidence_scope jsonb;
  timing jsonb;
  keyword_value text;
  market_code text;
  language_tag text;
  evidence_label text;
  source_record_hash text;
  review_platform text;
  source_url text;
  provider_data_as_of text;
  allowed_keys text[];
BEGIN
  SELECT * INTO snapshot_row
  FROM app.data_snapshots snapshot
  WHERE snapshot.id = NEW.snapshot_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.project_id = NEW.project_id
    AND snapshot.provider = 'voc'
    AND snapshot.dataset_key IN (
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
    AND snapshot.source_connection_id IS NULL
  FOR SHARE;

  source_kind := CASE snapshot_row.dataset_key
    WHEN 'voc.interview_summary.v1' THEN 'interview_summary'
    WHEN 'voc.user_review.v1' THEN 'user_review'
  END;
  evidence_scope := snapshot_row.summary -> 'keywordEvidenceScope';
  timing := snapshot_row.summary -> 'timing';
  keyword_value := NEW.value_json ->> 'keyword';
  market_code := NEW.value_json ->> 'marketCode';
  language_tag := NEW.value_json ->> 'languageCode';
  evidence_label := NEW.value_json ->> 'evidenceLabel';
  source_record_hash := NEW.value_json ->> 'sourceRecordHash';
  review_platform := NEW.value_json ->> 'reviewPlatform';
  source_url := NEW.value_json ->> 'sourceUrl';
  provider_data_as_of := NEW.value_json ->> 'providerDataAsOf';
  allowed_keys := CASE source_kind
    WHEN 'interview_summary' THEN ARRAY[
      'keyword',
      'marketCode',
      'languageCode',
      'providerDataAsOf',
      'evidenceLabel',
      'sourceRecordHash'
    ]
    WHEN 'user_review' THEN ARRAY[
      'keyword',
      'marketCode',
      'languageCode',
      'providerDataAsOf',
      'evidenceLabel',
      'sourceRecordHash',
      'reviewPlatform',
      'sourceUrl'
    ]
  END;

  IF snapshot_row.id IS NULL
     OR NEW.provider <> 'voc'
     OR NEW.metric_key <> 'voc.keyword_evidence.v1'
     OR NEW.subject_type <> 'keyword_cluster'
     OR NEW.site_page_id IS NOT NULL
     OR NEW.observed_at <> snapshot_row.captured_at
     OR NEW.availability <> 'available'
     OR NEW.value_numeric IS NOT NULL
     OR NEW.value_text IS NOT NULL
     OR NEW.unit IS NOT NULL
     OR NEW.method <> 'observed'
     OR NEW.support <> 'context'
     OR jsonb_typeof(NEW.value_json) <> 'object'
     OR NEW.value_json - allowed_keys <> '{}'::jsonb
     OR array_length(allowed_keys, 1) <> (
       SELECT count(*) FROM jsonb_object_keys(NEW.value_json)
     )
     OR length(keyword_value) NOT BETWEEN 1 AND 500
     OR keyword_value <> btrim(keyword_value)
     OR market_code <> evidence_scope ->> 'marketCode'
     OR language_tag <> evidence_scope ->> 'languageTag'
     OR source_record_hash !~ '^[0-9a-f]{64}$'
     OR NEW.subject_ref <> 'voc:' || source_record_hash
     OR length(evidence_label) NOT BETWEEN 1 AND 200
     OR evidence_label <> btrim(evidence_label)
     OR provider_data_as_of IS DISTINCT FROM timing ->> 'dataAsOf'
     OR (
       provider_data_as_of IS NOT NULL
       AND provider_data_as_of::timestamptz > NEW.observed_at
     )
     OR (
       source_kind = 'interview_summary'
       AND (
         NEW.origin <> 'user_provided'
         OR NEW.grade <> 'C'
         OR review_platform IS NOT NULL
         OR source_url IS NOT NULL
       )
     )
     OR (
       source_kind = 'user_review'
       AND (
         NEW.origin <> 'direct_public'
         OR NEW.grade <> 'B'
         OR review_platform NOT IN (
           'app_store', 'g2', 'capterra', 'other'
         )
         OR review_platform <> evidence_scope ->> 'reviewPlatform'
         OR (
           source_url IS NOT NULL
           AND (
             length(source_url) > 2048
             OR source_url !~ '^https://'
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'VOC normalized Keyword evidence is not bounded, de-identified, or canonically scoped'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalized_observations_provenance_guard
  ON app.normalized_observations;
DROP TRIGGER IF EXISTS normalized_observations_voc_provenance_guard
  ON app.normalized_observations;
CREATE TRIGGER normalized_observations_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc')
  EXECUTE FUNCTION app.enforce_normalized_observation_provenance();
CREATE TRIGGER normalized_observations_voc_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (NEW.provider = 'voc')
  EXECUTE FUNCTION app.enforce_voc_keyword_evidence_observation();

CREATE OR REPLACE FUNCTION app.enforce_voc_keyword_occurrence_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observation_row app.normalized_observations%ROWTYPE;
  snapshot_row app.data_snapshots%ROWTYPE;
  collection_row app.collection_runs%ROWTYPE;
  expected_dataset text;
  expected_scope_basis text;
  evidence_keyword text;
  evidence_market text;
  evidence_language text;
  evidence_data_as_of text;
BEGIN
  expected_dataset := CASE NEW.source_kind
    WHEN 'interview_summary' THEN 'voc.interview_summary.v1'
    WHEN 'user_review' THEN 'voc.user_review.v1'
  END;
  expected_scope_basis := CASE NEW.source_kind
    WHEN 'interview_summary' THEN 'user_provided'
    WHEN 'user_review' THEN 'provider_collection_scope'
  END;

  SELECT * INTO observation_row
  FROM app.normalized_observations observation
  WHERE observation.id = NEW.normalized_observation_id
    AND observation.workspace_id = NEW.workspace_id
    AND observation.project_id = NEW.project_id
    AND observation.provider = 'voc'
    AND observation.metric_key = 'voc.keyword_evidence.v1'
    AND observation.observed_at = NEW.collected_at
  FOR SHARE;

  SELECT * INTO snapshot_row
  FROM app.data_snapshots snapshot
  WHERE snapshot.id = NEW.data_snapshot_id
    AND snapshot.id = observation_row.snapshot_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.project_id = NEW.project_id
    AND snapshot.provider = 'voc'
    AND snapshot.dataset_key = expected_dataset
    AND snapshot.source_connection_id IS NULL
  FOR SHARE;

  SELECT * INTO collection_row
  FROM app.collection_runs collection
  WHERE collection.id = snapshot_row.collection_run_id
    AND collection.workspace_id = NEW.workspace_id
    AND collection.project_id = NEW.project_id
    AND collection.site_id = snapshot_row.site_id
    AND collection.provider = 'voc'
    AND collection.operation = 'keyword_evidence_collection'
    AND collection.method_version = expected_dataset
    AND collection.source_connection_id IS NULL
    AND collection.import_preview_id IS NULL
  FOR SHARE;

  evidence_keyword := observation_row.value_json ->> 'keyword';
  evidence_market := observation_row.value_json ->> 'marketCode';
  evidence_language := observation_row.value_json ->> 'languageCode';
  evidence_data_as_of :=
    observation_row.value_json ->> 'providerDataAsOf';

  IF NEW.source_kind NOT IN ('interview_summary', 'user_review')
     OR observation_row.id IS NULL
     OR snapshot_row.id IS NULL
     OR collection_row.id IS NULL
     OR NEW.scope_basis <> expected_scope_basis
     OR NEW.source_pointer <> '/valueJson/keyword'
     OR NEW.source_ref <> (
       'observation:' || NEW.normalized_observation_id::text
       || '#/valueJson/keyword'
     )
     OR NEW.query_kind <> 'search_query'
     OR regexp_replace(
       lower(btrim(evidence_keyword)),
       '[[:space:]]+',
       ' ',
       'g'
     ) <> NEW.normalized_keyword
     OR upper(evidence_market) <> NEW.market
     OR lower(evidence_language) <> lower(NEW.language_tag)
     OR evidence_data_as_of IS DISTINCT FROM (
       snapshot_row.summary #>> '{timing,dataAsOf}'
     )
     OR (
       evidence_data_as_of IS NULL
       AND NEW.provider_data_as_of IS NOT NULL
     )
     OR (
       evidence_data_as_of IS NOT NULL
       AND (
         NEW.provider_data_as_of IS NULL
         OR evidence_data_as_of::timestamptz
           <> NEW.provider_data_as_of
       )
     ) THEN
    RAISE EXCEPTION 'VOC Keyword occurrence lacks exact immutable evidence lineage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_occurrences_lineage_guard
  ON app.keyword_occurrences;
DROP TRIGGER IF EXISTS keyword_occurrences_voc_lineage_guard
  ON app.keyword_occurrences;
CREATE TRIGGER keyword_occurrences_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  WHEN (
    NEW.source_kind NOT IN ('interview_summary', 'user_review')
  )
  EXECUTE FUNCTION app.enforce_keyword_occurrence_lineage();
CREATE TRIGGER keyword_occurrences_voc_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  WHEN (
    NEW.source_kind IN ('interview_summary', 'user_review')
  )
  EXECUTE FUNCTION app.enforce_voc_keyword_occurrence_lineage();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0029_keyword_voc_sources'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0029_keyword_voc_sources.sql

-- BEGIN EXACT ORDERED MIGRATION 0030_backlink_growth_path.sql
BEGIN;

-- Backlink evidence is an internal path of the existing Growth Map. It does
-- not extend app.source_connections: customer-managed connections remain GSC,
-- GA4, and the reserved GitHub delivery slot in the customer UI.
ALTER TABLE app.import_previews
  DROP CONSTRAINT IF EXISTS import_previews_template_id_check;
ALTER TABLE app.import_previews
  ADD CONSTRAINT import_previews_template_id_check CHECK (
    template_id IN ('keyword_gap_v1','backlink_v1')
  );

-- One row is one immutable authority assertion for the primary site or one
-- already-approved competitor. Provider imports may expose index totals and
-- DR/DA. CSV and built-in search discovery are explicitly observed subsets.
CREATE TABLE app.backlink_authority_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  competitor_id uuid
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  subject_kind text NOT NULL CHECK (
    subject_kind IN ('primary_site','approved_competitor')
  ),
  source_kind text NOT NULL CHECK (
    source_kind IN ('provider_import','manual_csv','search_derived')
  ),
  provider text NOT NULL CHECK (
    provider IN ('ahrefs','moz','manual_csv','search_derived')
  ),
  captured_at timestamptz NOT NULL,
  availability text NOT NULL CHECK (
    availability IN ('available','partial','unavailable')
  ),
  index_scope text NOT NULL CHECK (
    index_scope IN ('provider_index','observed_subset','unavailable')
  ),
  total_backlinks bigint CHECK (
    total_backlinks BETWEEN 0 AND 9007199254740991
  ),
  total_referring_domains bigint CHECK (
    total_referring_domains BETWEEN 0 AND 9007199254740991
  ),
  observed_backlinks bigint CHECK (
    observed_backlinks BETWEEN 0 AND 9007199254740991
  ),
  observed_referring_domains bigint CHECK (
    observed_referring_domains BETWEEN 0 AND 9007199254740991
  ),
  authority_metric_kind text CHECK (
    authority_metric_kind IS NULL
    OR authority_metric_kind IN ('domain_rating','domain_authority')
  ),
  authority_metric_value numeric(6,2) CHECK (
    authority_metric_value BETWEEN 0 AND 100
  ),
  source_ref text NOT NULL CHECK (
    length(source_ref) BETWEEN 1 AND 240
    AND source_ref = btrim(source_ref)
    AND source_ref !~ '[[:cntrl:]]'
    AND position('/' IN source_ref) = 0
    AND position(E'\\' IN source_ref) = 0
    AND position('?' IN source_ref) = 0
    AND position('&' IN source_ref) = 0
    AND position('#' IN source_ref) = 0
    AND position('=' IN source_ref) = 0
  ),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  row_count bigint NOT NULL CHECK (
    row_count BETWEEN 0 AND 9007199254740991
  ),
  import_preview_id uuid
    REFERENCES app.import_previews(id) ON DELETE RESTRICT,
  limitation text CHECK (
    limitation IS NULL
    OR (
      length(limitation) BETWEEN 1 AND 2000
      AND limitation = btrim(limitation)
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      subject_kind = 'primary_site'
      AND competitor_id IS NULL
    )
    OR (
      subject_kind = 'approved_competitor'
      AND competitor_id IS NOT NULL
    )
  ),
  CHECK (
    (
      source_kind = 'provider_import'
      AND provider IN ('ahrefs','moz')
      AND import_preview_id IS NULL
      AND (
        (
          availability = 'available'
          AND index_scope = 'provider_index'
          AND total_backlinks IS NOT NULL
          AND total_referring_domains IS NOT NULL
          AND observed_backlinks IS NULL
          AND observed_referring_domains IS NULL
          AND authority_metric_kind IS NOT NULL
          AND authority_metric_value IS NOT NULL
          AND limitation IS NULL
        )
        OR (
          availability = 'unavailable'
          AND index_scope = 'unavailable'
          AND total_backlinks IS NULL
          AND total_referring_domains IS NULL
          AND observed_backlinks IS NULL
          AND observed_referring_domains IS NULL
          AND authority_metric_kind IS NULL
          AND authority_metric_value IS NULL
          AND limitation IS NOT NULL
        )
      )
    )
    OR (
      source_kind = 'manual_csv'
      AND provider = 'manual_csv'
      AND availability = 'partial'
      AND index_scope = 'observed_subset'
      AND total_backlinks IS NULL
      AND total_referring_domains IS NULL
      AND observed_backlinks IS NOT NULL
      AND observed_referring_domains IS NOT NULL
      AND authority_metric_kind IS NULL
      AND authority_metric_value IS NULL
      AND import_preview_id IS NOT NULL
      AND limitation IS NOT NULL
    )
    OR (
      source_kind = 'search_derived'
      AND provider = 'search_derived'
      AND availability = 'partial'
      AND index_scope = 'observed_subset'
      AND total_backlinks IS NULL
      AND total_referring_domains IS NULL
      AND observed_backlinks IS NOT NULL
      AND observed_referring_domains IS NOT NULL
      AND authority_metric_kind IS NULL
      AND authority_metric_value IS NULL
      AND import_preview_id IS NULL
      AND limitation IS NOT NULL
    )
  ),
  CHECK (
    (
      provider = 'ahrefs'
      AND (
        authority_metric_kind IS NULL
        OR authority_metric_kind = 'domain_rating'
      )
    )
    OR (
      provider = 'moz'
      AND (
        authority_metric_kind IS NULL
        OR authority_metric_kind = 'domain_authority'
      )
    )
    OR (
      provider IN ('manual_csv','search_derived')
      AND authority_metric_kind IS NULL
    )
  ),
  CHECK (
    (authority_metric_kind IS NULL)
    = (authority_metric_value IS NULL)
  )
);

CREATE UNIQUE INDEX backlink_authority_identity_idx
  ON app.backlink_authority_snapshots (
    project_id,
    subject_kind,
    (coalesce(competitor_id, site_id)),
    source_kind,
    provider,
    source_ref
  );
CREATE INDEX backlink_authority_subject_source_idx
  ON app.backlink_authority_snapshots (
    project_id,
    subject_kind,
    competitor_id,
    source_kind,
    provider,
    captured_at DESC,
    id
  );

-- Provider facts may carry the same provider's authority metric for the
-- referring domain. CSV/search-derived facts never carry DR or DA.
CREATE TABLE app.backlink_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL
    REFERENCES app.backlink_authority_snapshots(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  referring_domain text NOT NULL CHECK (
    app.is_normalized_competitor_domain(referring_domain)
  ),
  source_url text NOT NULL CHECK (
    length(source_url) BETWEEN 1 AND 2048
    AND source_url = btrim(source_url)
    AND source_url ~ '^https?://'
  ),
  target_url text NOT NULL CHECK (
    length(target_url) BETWEEN 1 AND 2048
    AND target_url = btrim(target_url)
    AND target_url ~ '^https?://'
  ),
  target_site_page_id uuid
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  source_authority_metric_kind text CHECK (
    source_authority_metric_kind IS NULL
    OR source_authority_metric_kind IN (
      'domain_rating',
      'domain_authority'
    )
  ),
  source_authority_metric_value numeric(6,2) CHECK (
    source_authority_metric_value BETWEEN 0 AND 100
  ),
  link_kind text NOT NULL DEFAULT 'unknown' CHECK (
    link_kind IN ('dofollow','nofollow','ugc','sponsored','unknown')
  ),
  source_ref text NOT NULL CHECK (
    length(source_ref) BETWEEN 1 AND 500
    AND source_ref = btrim(source_ref)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, source_ref),
  CHECK (
    (source_authority_metric_kind IS NULL)
    = (source_authority_metric_value IS NULL)
  )
);

CREATE INDEX backlink_facts_target_page_idx
  ON app.backlink_facts (
    project_id,
    target_site_page_id,
    snapshot_id,
    id
  );
CREATE INDEX backlink_facts_referring_domain_idx
  ON app.backlink_facts (
    project_id,
    referring_domain,
    snapshot_id,
    id
  );

-- Page totals are persisted only when a source explicitly supplied them.
-- A real Provider may persist an exact zero. Missing pages have no row and are
-- never materialized as zero by SQL or the read service.
CREATE TABLE app.backlink_page_metrics (
  snapshot_id uuid NOT NULL
    REFERENCES app.backlink_authority_snapshots(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  title text CHECK (
    title IS NULL
    OR (
      length(title) BETWEEN 1 AND 500
      AND title = btrim(title)
    )
  ),
  backlink_count bigint NOT NULL CHECK (
    backlink_count BETWEEN 0 AND 9007199254740991
  ),
  referring_domain_count bigint NOT NULL CHECK (
    referring_domain_count BETWEEN 0 AND 9007199254740991
  ),
  metric_semantics text NOT NULL CHECK (
    metric_semantics IN ('provider_index_total','observed_fact_count')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, site_page_id)
);

CREATE INDEX backlink_page_metrics_page_idx
  ON app.backlink_page_metrics (
    project_id,
    site_page_id,
    snapshot_id
  );

CREATE OR REPLACE FUNCTION app.enforce_backlink_authority_snapshot_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  competitor app.competitor_entities%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    JOIN app.sites site
      ON site.workspace_id = project.workspace_id
     AND site.project_id = project.id
     AND site.id = NEW.site_id
     AND site.is_primary
    WHERE project.workspace_id = NEW.workspace_id
      AND project.id = NEW.project_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'backlink snapshot does not belong to the exact primary site and project scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.subject_kind = 'approved_competitor' THEN
    SELECT *
    INTO competitor
    FROM app.competitor_entities candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND candidate.project_id = NEW.project_id
      AND candidate.id = NEW.competitor_id;
    IF NOT FOUND OR competitor.review_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'backlink snapshot competitor is not approved in the exact project scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.source_kind = 'manual_csv' AND NOT EXISTS (
    SELECT 1
    FROM app.import_previews preview
    WHERE preview.workspace_id = NEW.workspace_id
      AND preview.project_id = NEW.project_id
      AND preview.site_id = NEW.site_id
      AND preview.id = NEW.import_preview_id
      AND preview.template_id = 'backlink_v1'
      AND preview.status = 'consumed'
      AND preview.file_checksum = NEW.checksum
      AND preview.row_count = NEW.row_count
  ) THEN
    RAISE EXCEPTION 'manual backlink snapshot requires its exact consumed backlink CSV preview'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_backlink_fact_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot app.backlink_authority_snapshots%ROWTYPE;
  page app.site_pages%ROWTYPE;
  primary_site app.sites%ROWTYPE;
  expected_authority_kind text;
BEGIN
  SELECT *
  INTO snapshot
  FROM app.backlink_authority_snapshots candidate
  WHERE candidate.workspace_id = NEW.workspace_id
    AND candidate.project_id = NEW.project_id
    AND candidate.site_id = NEW.site_id
    AND candidate.id = NEW.snapshot_id;
  IF NOT FOUND OR snapshot.availability = 'unavailable' THEN
    RAISE EXCEPTION 'backlink fact does not match its snapshot or exact target SitePage'
      USING ERRCODE = '23514';
  END IF;

  IF snapshot.subject_kind = 'approved_competitor'
     AND NEW.target_site_page_id IS NOT NULL THEN
    RAISE EXCEPTION 'competitor backlink facts cannot claim a primary-site SitePage'
      USING ERRCODE = '23514';
  END IF;

  IF snapshot.subject_kind = 'primary_site' THEN
    SELECT *
    INTO primary_site
    FROM app.sites candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND candidate.project_id = NEW.project_id
      AND candidate.id = NEW.site_id
      AND candidate.is_primary;
    IF NOT FOUND
       OR primary_site.host IS DISTINCT FROM lower(primary_site.host)
       OR primary_site.origin NOT IN (
         'http://' || primary_site.host,
         'https://' || primary_site.host
       ) THEN
      RAISE EXCEPTION 'primary-site backlink fact has no canonical Site origin authority'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.target_site_page_id IS NOT NULL THEN
    SELECT *
    INTO page
    FROM app.site_pages candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND candidate.project_id = NEW.project_id
      AND candidate.site_id = NEW.site_id
      AND candidate.id = NEW.target_site_page_id;
    IF NOT FOUND OR page.normalized_url IS DISTINCT FROM NEW.target_url THEN
      RAISE EXCEPTION 'backlink fact does not match its snapshot or exact target SitePage'
        USING ERRCODE = '23514';
    END IF;
  ELSIF snapshot.subject_kind = 'primary_site'
     AND NOT (
       NEW.target_url = primary_site.origin
       OR left(
         NEW.target_url,
         length(primary_site.origin) + 1
       ) IN (
         primary_site.origin || '/',
         primary_site.origin || '?',
         primary_site.origin || '#'
       )
     ) THEN
    RAISE EXCEPTION 'primary-site backlink fact target URL is outside its canonical Site origin'
      USING ERRCODE = '23514';
  END IF;

  expected_authority_kind := CASE snapshot.provider
    WHEN 'ahrefs' THEN 'domain_rating'
    WHEN 'moz' THEN 'domain_authority'
    ELSE NULL
  END;
  IF NEW.source_authority_metric_kind IS NOT NULL
     AND (
       snapshot.source_kind IS DISTINCT FROM 'provider_import'
       OR expected_authority_kind IS NULL
       OR NEW.source_authority_metric_kind IS DISTINCT FROM expected_authority_kind
     ) THEN
    RAISE EXCEPTION 'backlink fact authority metric does not belong to its Provider snapshot'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_backlink_page_metric_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot app.backlink_authority_snapshots%ROWTYPE;
  page app.site_pages%ROWTYPE;
  expected_semantics text;
BEGIN
  SELECT *
  INTO snapshot
  FROM app.backlink_authority_snapshots candidate
  WHERE candidate.workspace_id = NEW.workspace_id
    AND candidate.project_id = NEW.project_id
    AND candidate.site_id = NEW.site_id
    AND candidate.id = NEW.snapshot_id
    AND candidate.subject_kind = 'primary_site'
    AND candidate.availability <> 'unavailable';

  SELECT *
  INTO page
  FROM app.site_pages candidate
  WHERE candidate.workspace_id = NEW.workspace_id
    AND candidate.project_id = NEW.project_id
    AND candidate.site_id = NEW.site_id
    AND candidate.id = NEW.site_page_id;

  IF snapshot.id IS NULL OR page.id IS NULL THEN
    RAISE EXCEPTION 'backlink page metric does not match its primary-site snapshot and exact SitePage'
      USING ERRCODE = '23514';
  END IF;

  expected_semantics := CASE snapshot.source_kind
    WHEN 'provider_import' THEN 'provider_index_total'
    ELSE 'observed_fact_count'
  END;
  IF NEW.metric_semantics IS DISTINCT FROM expected_semantics THEN
    RAISE EXCEPTION 'backlink page metric semantics do not match its source scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER backlink_authority_snapshots_insert_guard
BEFORE INSERT ON app.backlink_authority_snapshots
FOR EACH ROW
EXECUTE FUNCTION app.enforce_backlink_authority_snapshot_insert();

CREATE TRIGGER backlink_facts_insert_guard
BEFORE INSERT ON app.backlink_facts
FOR EACH ROW
EXECUTE FUNCTION app.enforce_backlink_fact_insert();

CREATE TRIGGER backlink_page_metrics_insert_guard
BEFORE INSERT ON app.backlink_page_metrics
FOR EACH ROW
EXECUTE FUNCTION app.enforce_backlink_page_metric_insert();

CREATE TRIGGER backlink_authority_snapshots_append_only
BEFORE UPDATE OR DELETE ON app.backlink_authority_snapshots
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER backlink_facts_append_only
BEFORE UPDATE OR DELETE ON app.backlink_facts
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER backlink_page_metrics_append_only
BEFORE UPDATE OR DELETE ON app.backlink_page_metrics
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0030_backlink_growth_path'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0030_backlink_growth_path.sql

-- BEGIN EXACT ORDERED MIGRATION 0031_pgcrypto_digest_compatibility.sql
BEGIN;

-- Supabase installs pgcrypto in its managed `extensions` schema. Historical
-- migrations and trigger functions intentionally use a narrow app/public
-- search_path, so expose only the two pgcrypto digest overloads they require in
-- public. A stock PostgreSQL install already owns these signatures in public
-- and must remain untouched.
DO $migration$
DECLARE
  pgcrypto_extension_oid oid;
  pgcrypto_namespace_oid oid;
  pgcrypto_schema name;
  extension_digest_count integer;
  restricted_role name;
BEGIN
  SELECT
    extension_row.oid,
    extension_namespace.oid,
    extension_namespace.nspname
  INTO
    pgcrypto_extension_oid,
    pgcrypto_namespace_oid,
    pgcrypto_schema
  FROM pg_catalog.pg_extension extension_row
  JOIN pg_catalog.pg_namespace extension_namespace
    ON extension_namespace.oid = extension_row.extnamespace
  WHERE extension_row.extname = 'pgcrypto';

  IF pgcrypto_extension_oid IS NULL THEN
    RAISE EXCEPTION 'pgcrypto extension is required for digest compatibility'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)
  INTO extension_digest_count
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_depend dependency
    ON dependency.classid =
         'pg_catalog.pg_proc'::pg_catalog.regclass
   AND dependency.objid = procedure.oid
   AND dependency.refclassid =
         'pg_catalog.pg_extension'::pg_catalog.regclass
   AND dependency.refobjid = pgcrypto_extension_oid
   AND dependency.deptype = 'e'
  WHERE procedure.pronamespace = pgcrypto_namespace_oid
    AND procedure.oid IN (
      pg_catalog.to_regprocedure(
        pg_catalog.format('%I.digest(bytea,text)', pgcrypto_schema)
      ),
      pg_catalog.to_regprocedure(
        pg_catalog.format('%I.digest(text,text)', pgcrypto_schema)
      )
    );

  IF extension_digest_count <> 2 THEN
    RAISE EXCEPTION 'pgcrypto digest overloads are incomplete'
      USING ERRCODE = '55000';
  END IF;

  IF pgcrypto_schema = 'extensions' THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION public.digest(
        data bytea,
        algorithm text
      )
      RETURNS bytea
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      SECURITY INVOKER
      SET search_path = pg_catalog
      AS 'SELECT extensions.digest($1, $2)'
    $function$;

    EXECUTE $function$
      CREATE OR REPLACE FUNCTION public.digest(
        data text,
        algorithm text
      )
      RETURNS bytea
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      SECURITY INVOKER
      SET search_path = pg_catalog
      AS 'SELECT extensions.digest($1, $2)'
    $function$;

    REVOKE EXECUTE ON FUNCTION public.digest(bytea, text) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.digest(text, text) FROM PUBLIC;

    FOR restricted_role IN
      SELECT role_row.rolname
      FROM pg_catalog.pg_roles role_row
      WHERE role_row.rolname IN ('anon', 'authenticated', 'service_role')
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION public.digest(bytea, text) FROM %I',
        restricted_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION public.digest(text, text) FROM %I',
        restricted_role
      );
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles role_row
      WHERE role_row.rolname = 'postgres'
    ) THEN
      GRANT EXECUTE ON FUNCTION public.digest(bytea, text) TO postgres;
      GRANT EXECUTE ON FUNCTION public.digest(text, text) TO postgres;
    END IF;
  ELSIF pgcrypto_schema = 'public' THEN
    -- A stock PostgreSQL pgcrypto installation already provides both exact
    -- extension-owned overloads on the runtime search path.
    NULL;
  ELSE
    RAISE EXCEPTION 'unsupported pgcrypto extension schema'
      USING ERRCODE = '55000';
  END IF;
END;
$migration$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0031_pgcrypto_digest_compatibility'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0031_pgcrypto_digest_compatibility.sql

-- BEGIN EXACT ORDERED MIGRATION 0032_keyword_initial_governance.sql
BEGIN;

-- Automated ingestion suggestions do not have a human decision maker. Keep
-- migration baselines actorless, require an actor for user decisions, and let
-- system suggestions truthfully carry either no actor (ingestion) or the actor
-- that initiated a later system invalidation.
ALTER TABLE app.keyword_review_decisions
  DROP CONSTRAINT keyword_review_decisions_check4;
ALTER TABLE app.keyword_review_decisions
  ADD CONSTRAINT keyword_review_decisions_check4 CHECK (
    (
      decision_origin = 'migration_baseline'
      AND decided_by IS NULL
    )
    OR decision_origin = 'system_suggestion'
    OR (
      decision_origin = 'user'
      AND decided_by IS NOT NULL
    )
  );

-- Review writers resolve one authoritative instant and persist it on both the
-- mutable current projection and append-only Decision. Preserve that explicit
-- instant when governed fields change. Observation-only UPSERTs do not provide
-- a review instant, so the database continues to advance updated_at for them.
CREATE OR REPLACE FUNCTION app.enforce_keyword_entity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  review_changed boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword entity project is absent or archived'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.mapping_decision = 'existing_page' AND NOT EXISTS (
    SELECT 1
    FROM app.site_pages page
    WHERE page.id = NEW.mapped_site_page_id
      AND page.workspace_id = NEW.workspace_id
      AND page.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'keyword Existing Page mapping is outside project scope'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.display_keyword IS DISTINCT FROM OLD.display_keyword
     OR NEW.normalized_keyword IS DISTINCT FROM OLD.normalized_keyword
     OR NEW.market IS DISTINCT FROM OLD.market
     OR NEW.language_tag IS DISTINCT FROM OLD.language_tag
     OR NEW.query_kind IS DISTINCT FROM OLD.query_kind
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'keyword stable identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.first_seen_at > OLD.first_seen_at
     OR NEW.last_seen_at < OLD.last_seen_at THEN
    RAISE EXCEPTION 'keyword observation window may only expand'
      USING ERRCODE = '23514';
  END IF;

  review_changed :=
    NEW.status IS DISTINCT FROM OLD.status
    OR NEW.intent IS DISTINCT FROM OLD.intent
    OR NEW.buyer_stage IS DISTINCT FROM OLD.buyer_stage
    OR NEW.cluster_key IS DISTINCT FROM OLD.cluster_key
    OR NEW.mapping_decision IS DISTINCT FROM OLD.mapping_decision
    OR NEW.mapped_site_page_id IS DISTINCT FROM OLD.mapped_site_page_id
    OR NEW.mapping_review_state IS DISTINCT FROM OLD.mapping_review_state;

  IF review_changed AND NEW.mapping_revision <> OLD.mapping_revision + 1 THEN
    RAISE EXCEPTION 'keyword review update must advance exactly one revision'
      USING ERRCODE = '23514';
  END IF;
  IF NOT review_changed AND NEW.mapping_revision <> OLD.mapping_revision THEN
    RAISE EXCEPTION 'keyword mapping revision cannot advance without a review change'
      USING ERRCODE = '23514';
  END IF;

  IF review_changed THEN
    IF NOT isfinite(NEW.updated_at)
       OR NEW.updated_at <= OLD.updated_at THEN
      RAISE EXCEPTION 'keyword review instant must advance monotonically'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

-- Installing the trigger takes a transactional lock on keyword_entities. Any
-- old in-flight writer that already owns the table lock completes before this
-- DDL; any writer admitted after commit sees the trigger, even if its caller
-- began before the migration. This closes the upgrade window without relying
-- on one repository function as the only insertion path.
CREATE OR REPLACE FUNCTION app.initialize_keyword_review_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mapping_revision = 0
     AND NEW.status = 'candidate'
     AND NEW.intent IS NULL
     AND NEW.buyer_stage IS NULL
     AND NEW.cluster_key IS NULL
     AND NEW.mapping_decision = 'unassigned'
     AND NEW.mapped_site_page_id IS NULL
     AND NEW.mapping_review_state = 'unreviewed' THEN
    INSERT INTO app.keyword_review_decisions (
      workspace_id,
      project_id,
      keyword_entity_id,
      governance_revision,
      decision_origin,
      status,
      intent,
      buyer_stage,
      topic_node_id,
      topic_model_revision,
      cluster_key_at_decision,
      mapping_decision,
      mapped_site_page_id,
      review_state,
      assignment_invalidated_by,
      decided_by,
      reason,
      decided_at,
      reviewed_projection
    ) VALUES (
      NEW.workspace_id,
      NEW.project_id,
      NEW.id,
      0,
      'system_suggestion',
      NEW.status,
      NEW.intent,
      NEW.buyer_stage,
      NULL,
      NULL,
      NEW.cluster_key,
      NEW.mapping_decision,
      NEW.mapped_site_page_id,
      NEW.mapping_review_state,
      NULL,
      NULL,
      'Keyword ingestion generated the initial candidate decision.',
      NEW.created_at,
      jsonb_build_object(
        'projectId', NEW.project_id,
        'keywordId', NEW.id,
        'status', NEW.status,
        'intent', NEW.intent,
        'buyerStage', NEW.buyer_stage,
        'topicNodeId', NULL,
        'topicModelRevision', NULL,
        'clusterKey', NEW.cluster_key,
        'mappingDecision', NEW.mapping_decision,
        'mappedSitePageId', NEW.mapped_site_page_id,
        'mappingReviewState', NEW.mapping_review_state,
        'governanceRevision', 0,
        'assignmentInvalidatedBy', NULL,
        'earlierHistoryAvailable', false
      )
    )
    ON CONFLICT (
      workspace_id,
      project_id,
      keyword_entity_id,
      governance_revision
    ) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_entities_initial_review_decision
  ON app.keyword_entities;
CREATE TRIGGER keyword_entities_initial_review_decision
  AFTER INSERT ON app.keyword_entities
  FOR EACH ROW
  EXECUTE FUNCTION app.initialize_keyword_review_decision();

-- Close the production gap left by default-state entities ingested after 0024.
-- Only the complete revision-zero default is knowable without inventing
-- history. Nonzero or non-default missing-ledger rows remain corrupt so strict
-- readers continue to fail closed.
INSERT INTO app.keyword_review_decisions (
  workspace_id,
  project_id,
  keyword_entity_id,
  governance_revision,
  decision_origin,
  status,
  intent,
  buyer_stage,
  topic_node_id,
  topic_model_revision,
  cluster_key_at_decision,
  mapping_decision,
  mapped_site_page_id,
  review_state,
  assignment_invalidated_by,
  decided_by,
  reason,
  decided_at,
  reviewed_projection
)
SELECT
  entity.workspace_id,
  entity.project_id,
  entity.id,
  0,
  'system_suggestion',
  entity.status,
  entity.intent,
  entity.buyer_stage,
  NULL,
  NULL,
  entity.cluster_key,
  entity.mapping_decision,
  entity.mapped_site_page_id,
  entity.mapping_review_state,
  NULL,
  NULL,
  'Keyword ingestion generated the initial candidate decision.',
  entity.created_at,
  jsonb_build_object(
    'projectId', entity.project_id,
    'keywordId', entity.id,
    'status', entity.status,
    'intent', entity.intent,
    'buyerStage', entity.buyer_stage,
    'topicNodeId', NULL,
    'topicModelRevision', NULL,
    'clusterKey', entity.cluster_key,
    'mappingDecision', entity.mapping_decision,
    'mappedSitePageId', entity.mapped_site_page_id,
    'mappingReviewState', entity.mapping_review_state,
    'governanceRevision', 0,
    'assignmentInvalidatedBy', NULL,
    'earlierHistoryAvailable', false
  )
FROM app.keyword_entities entity
WHERE entity.mapping_revision = 0
  AND entity.status = 'candidate'
  AND entity.intent IS NULL
  AND entity.buyer_stage IS NULL
  AND entity.cluster_key IS NULL
  AND entity.mapping_decision = 'unassigned'
  AND entity.mapped_site_page_id IS NULL
  AND entity.mapping_review_state = 'unreviewed'
  AND NOT EXISTS (
    SELECT 1
    FROM app.keyword_review_decisions existing
    WHERE existing.workspace_id = entity.workspace_id
      AND existing.project_id = entity.project_id
      AND existing.keyword_entity_id = entity.id
  )
ON CONFLICT (
  workspace_id,
  project_id,
  keyword_entity_id,
  governance_revision
) DO NOTHING;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0032_keyword_initial_governance'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0032_keyword_initial_governance.sql

-- BEGIN EXACT ORDERED MIGRATION 0033_analysis_refresh_orchestration.sql
BEGIN;

-- Analysis Refresh is a server-owned orchestration run. It has one lifecycle
-- in async_runs and one immutable typed parent projection below.
ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_kind_check
  CHECK (kind IN (
    'collection',
    'diagnostic',
    'artifact_generation',
    'export',
    'product_profile_synthesis',
    'content_shadow',
    'publication',
    'measurement',
    'analysis_refresh'
  ));

ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_result_type_check
  CHECK (
    result_type IS NULL OR result_type IN (
      'collection_run',
      'diagnostic_run',
      'artifact',
      'export',
      'icp_profile',
      'flow_shadow_run',
      'publication_attempt',
      'measurement_window',
      'analysis_refresh_run'
    )
  );

CREATE TABLE IF NOT EXISTS app.analysis_refresh_runs (
  id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  icp_profile_id uuid NOT NULL
    REFERENCES app.icp_profiles(id) ON DELETE RESTRICT,
  plan_manifest jsonb NOT NULL
    CHECK (
      jsonb_typeof(plan_manifest) = 'object'
      AND plan_manifest = jsonb_build_object(
        'version', 'analysis-refresh.plan.v1',
        'steps', jsonb_build_array(
          jsonb_build_object(
            'ordinal', 1,
            'stepKey', 'crawl',
            'required', true
          ),
          jsonb_build_object(
            'ordinal', 2,
            'stepKey', 'gsc',
            'required', false
          ),
          jsonb_build_object(
            'ordinal', 3,
            'stepKey', 'ga4',
            'required', false
          ),
          jsonb_build_object(
            'ordinal', 4,
            'stepKey', 'dataforseo',
            'required', false
          ),
          jsonb_build_object(
            'ordinal', 5,
            'stepKey', 'growth_audit',
            'required', true
          )
        )
      )
    ),
  plan_hash text NOT NULL CHECK (
    plan_hash =
      'd725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analysis_refresh_runs_project_created_idx
  ON app.analysis_refresh_runs(
    workspace_id,
    project_id,
    created_at DESC,
    id DESC
  );
CREATE INDEX IF NOT EXISTS analysis_refresh_runs_site_created_idx
  ON app.analysis_refresh_runs(
    workspace_id,
    project_id,
    site_id,
    created_at DESC,
    id DESC
  );

CREATE TABLE IF NOT EXISTS app.analysis_refresh_steps (
  analysis_refresh_run_id uuid NOT NULL
    REFERENCES app.analysis_refresh_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
  step_key text NOT NULL CHECK (
    step_key IN ('crawl','gsc','ga4','dataforseo','growth_audit')
  ),
  required boolean NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','running','completed','skipped','failed')),
  child_async_run_id uuid
    REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  result_snapshot_id uuid
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  skip_reason text CHECK (
    skip_reason IS NULL
    OR (
      length(btrim(skip_reason)) BETWEEN 1 AND 500
      AND skip_reason = btrim(skip_reason)
      AND skip_reason !~ '[[:cntrl:]]'
    )
  ),
  error jsonb CHECK (
    error IS NULL OR jsonb_typeof(error) = 'object'
  ),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_refresh_run_id, step_key),
  UNIQUE (analysis_refresh_run_id, ordinal),
  CHECK (
    (ordinal = 1 AND step_key = 'crawl' AND required)
    OR (ordinal = 2 AND step_key = 'gsc' AND NOT required)
    OR (ordinal = 3 AND step_key = 'ga4' AND NOT required)
    OR (ordinal = 4 AND step_key = 'dataforseo' AND NOT required)
    OR (ordinal = 5 AND step_key = 'growth_audit' AND required)
  ),
  CHECK (
    (
      state = 'pending'
      AND child_async_run_id IS NULL
      AND result_snapshot_id IS NULL
      AND skip_reason IS NULL
      AND error IS NULL
      AND started_at IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'running'
      AND child_async_run_id IS NOT NULL
      AND result_snapshot_id IS NULL
      AND skip_reason IS NULL
      AND error IS NULL
      AND started_at IS NOT NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'completed'
      AND child_async_run_id IS NOT NULL
      AND (
        (step_key = 'growth_audit' AND result_snapshot_id IS NULL)
        OR (step_key <> 'growth_audit' AND result_snapshot_id IS NOT NULL)
      )
      AND skip_reason IS NULL
      AND error IS NULL
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
    )
    OR (
      state = 'skipped'
      AND NOT required
      AND child_async_run_id IS NULL
      AND result_snapshot_id IS NULL
      AND skip_reason IS NOT NULL
      AND error IS NULL
      AND started_at IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      state = 'failed'
      AND result_snapshot_id IS NULL
      AND skip_reason IS NULL
      AND error IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS analysis_refresh_steps_project_state_idx
  ON app.analysis_refresh_steps(
    workspace_id,
    project_id,
    state,
    analysis_refresh_run_id,
    ordinal
  );
CREATE INDEX IF NOT EXISTS analysis_refresh_steps_child_run_idx
  ON app.analysis_refresh_steps(
    workspace_id,
    project_id,
    child_async_run_id
  )
  WHERE child_async_run_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS analysis_refresh_steps_child_run_unique_idx
  ON app.analysis_refresh_steps(child_async_run_id)
  WHERE child_async_run_id IS NOT NULL;

-- Duplicated tenant keys are accelerators, never authority. Validate the parent
-- async run, frozen Site/ICP, child run, and result Snapshot in their complete
-- workspace/project scope so a faulty worker cannot splice cross-project rows.
CREATE OR REPLACE FUNCTION app.enforce_analysis_refresh_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.client_projects project
      ON project.id = NEW.project_id
     AND project.workspace_id = NEW.workspace_id
     AND project.confirmed_icp_profile_id = NEW.icp_profile_id
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
     AND site.is_primary
    JOIN app.icp_profiles profile
      ON profile.id = NEW.icp_profile_id
     AND profile.workspace_id = NEW.workspace_id
     AND profile.project_id = NEW.project_id
     AND profile.status = 'complete'
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'analysis_refresh'
      AND run.result_type = 'analysis_refresh_run'
      AND run.result_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'analysis refresh parent provenance does not match its canonical inputs'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_analysis_refresh_step_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_site_id uuid;
  parent_icp_profile_id uuid;
  expected_child_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'analysis refresh steps are durable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.analysis_refresh_run_id IS DISTINCT FROM OLD.analysis_refresh_run_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
    OR NEW.step_key IS DISTINCT FROM OLD.step_key
    OR NEW.required IS DISTINCT FROM OLD.required
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'analysis refresh step identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.state IN ('completed','skipped','failed') THEN
    RAISE EXCEPTION 'terminal analysis refresh step is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.state IS NOT DISTINCT FROM OLD.state
     AND (
       NEW.child_async_run_id IS DISTINCT FROM OLD.child_async_run_id
       OR NEW.result_snapshot_id IS DISTINCT FROM OLD.result_snapshot_id
       OR NEW.skip_reason IS DISTINCT FROM OLD.skip_reason
       OR NEW.error IS DISTINCT FROM OLD.error
       OR NEW.started_at IS DISTINCT FROM OLD.started_at
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
     ) THEN
    RAISE EXCEPTION
      'analysis refresh execution facts require a state transition'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.child_async_run_id IS NOT NULL
     AND NEW.child_async_run_id IS DISTINCT FROM OLD.child_async_run_id THEN
    RAISE EXCEPTION 'analysis refresh child run identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.state IS DISTINCT FROM OLD.state
     AND NOT (
       (OLD.state = 'pending' AND NEW.state IN (
         'running',
         'skipped',
         'failed'
       ))
       OR (OLD.state = 'running' AND NEW.state IN (
         'completed',
         'failed'
       ))
     ) THEN
    RAISE EXCEPTION 'invalid analysis refresh step state transition'
      USING ERRCODE = '23514';
  END IF;

  SELECT parent.site_id, parent.icp_profile_id
  INTO parent_site_id, parent_icp_profile_id
  FROM app.analysis_refresh_runs parent
  WHERE parent.id = NEW.analysis_refresh_run_id
    AND parent.workspace_id = NEW.workspace_id
    AND parent.project_id = NEW.project_id;

  IF parent_site_id IS NULL THEN
    RAISE EXCEPTION 'analysis refresh step parent scope mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.child_async_run_id IS NOT NULL THEN
    expected_child_kind :=
      CASE
        WHEN NEW.step_key = 'growth_audit' THEN 'diagnostic'
        ELSE 'collection'
      END;
    IF NOT EXISTS (
      SELECT 1
      FROM app.async_runs child
      WHERE child.id = NEW.child_async_run_id
        AND child.id <> NEW.analysis_refresh_run_id
        AND child.workspace_id = NEW.workspace_id
        AND child.project_id = NEW.project_id
        AND child.kind = expected_child_kind
    ) THEN
      RAISE EXCEPTION 'analysis refresh child run scope or kind mismatch'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.step_key = 'growth_audit' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM app.diagnostic_runs diagnostic
        WHERE diagnostic.id = NEW.child_async_run_id
          AND diagnostic.workspace_id = NEW.workspace_id
          AND diagnostic.project_id = NEW.project_id
          AND diagnostic.site_id = parent_site_id
          AND diagnostic.icp_profile_id = parent_icp_profile_id
      ) THEN
        RAISE EXCEPTION
          'analysis refresh Growth Audit child provenance mismatch'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1
      FROM app.collection_runs collection
      WHERE collection.id = NEW.child_async_run_id
        AND collection.workspace_id = NEW.workspace_id
        AND collection.project_id = NEW.project_id
        AND collection.site_id = parent_site_id
        AND collection.provider = NEW.step_key
    ) THEN
      RAISE EXCEPTION
        'analysis refresh collection child provenance mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.result_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.result_snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
      AND snapshot.site_id = parent_site_id
      AND snapshot.provider = NEW.step_key
      AND snapshot.collection_run_id = NEW.child_async_run_id
  ) THEN
    RAISE EXCEPTION 'analysis refresh result Snapshot provenance mismatch'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS analysis_refresh_runs_provenance_guard
  ON app.analysis_refresh_runs;
CREATE TRIGGER analysis_refresh_runs_provenance_guard
  BEFORE INSERT ON app.analysis_refresh_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_analysis_refresh_run_provenance();

DROP TRIGGER IF EXISTS analysis_refresh_runs_append_only
  ON app.analysis_refresh_runs;
CREATE TRIGGER analysis_refresh_runs_append_only
  BEFORE UPDATE OR DELETE ON app.analysis_refresh_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS analysis_refresh_steps_mutation_guard
  ON app.analysis_refresh_steps;
CREATE TRIGGER analysis_refresh_steps_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.analysis_refresh_steps
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_analysis_refresh_step_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.analysis_refresh_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.analysis_refresh_steps FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.analysis_refresh_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.analysis_refresh_steps FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0033_analysis_refresh_orchestration'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0033_analysis_refresh_orchestration.sql

-- BEGIN EXACT ORDERED MIGRATION 0034_dataforseo_search_landscape.sql
BEGIN;

-- Search Landscape is one atomic DataForSEO collection identity. It preserves
-- the two historical ranked-keyword Snapshot identities without allowing
-- arbitrary provider/operation/method combinations.
ALTER TABLE app.collection_runs
  DROP CONSTRAINT IF EXISTS collection_runs_operation_check;
ALTER TABLE app.collection_runs
  ADD CONSTRAINT collection_runs_operation_check CHECK (
    operation IN (
      'site_graph',
      'search_analytics',
      'organic_landing',
      'keyword_gap_import',
      'ai_citation_monitor',
      'keyword_evidence_collection',
      'search_landscape'
    )
  );

ALTER TABLE app.data_snapshots
  DROP CONSTRAINT IF EXISTS data_snapshots_dataset_key_check;
ALTER TABLE app.data_snapshots
  ADD CONSTRAINT data_snapshots_dataset_key_check CHECK (
    dataset_key IN (
      'crawl.site_graph.v1',
      'gsc.page_query_daily.v1',
      'ga4.organic_landing_daily.v1',
      'csv.keyword_gap.v1',
      'dataforseo.ranked_keywords.v1',
      'dataforseo.search_landscape.v1',
      'geo.answer_citations.v1',
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
  );

-- DataForSEO gets a provider-specific guard so both legacy identities and the
-- new composite identity are exact. Other providers continue through the
-- unchanged pre-0034 guard; VOC retains its dedicated authority.
CREATE OR REPLACE FUNCTION app.enforce_dataforseo_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> 'dataforseo' THEN
    RAISE EXCEPTION 'DataForSEO collection guard received another provider'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'DataForSEO collection run must begin unfinished'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.source_connection_id IS DISTINCT FROM OLD.source_connection_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.method_version IS DISTINCT FROM OLD.method_version
    OR NEW.parameters_hash IS DISTINCT FROM OLD.parameters_hash
    OR NEW.import_preview_id IS DISTINCT FROM OLD.import_preview_id
    OR NEW.crawl_seed_site_page_id IS DISTINCT FROM OLD.crawl_seed_site_page_id
    OR NEW.crawl_seed_url IS DISTINCT FROM OLD.crawl_seed_url
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'DataForSEO collection source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      NEW.operation = 'keyword_gap_import'
      AND NEW.method_version = 'dataforseo.ranked_keywords.v1'
    )
    OR (
      NEW.operation = 'search_landscape'
      AND NEW.method_version = 'dataforseo.search_landscape.v1'
    )
  ) THEN
    RAISE EXCEPTION 'DataForSEO collection operation and method are not an exact supported pair'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NULL
     OR NEW.import_preview_id IS NOT NULL
     OR NEW.crawl_seed_site_page_id IS NOT NULL
     OR NEW.crawl_seed_url IS NOT NULL THEN
    RAISE EXCEPTION 'DataForSEO collection source shape is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
    JOIN app.source_connections source
      ON source.id = NEW.source_connection_id
     AND source.workspace_id = NEW.workspace_id
     AND source.project_id = NEW.project_id
     AND source.site_id = NEW.site_id
     AND source.provider = 'dataforseo'
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'collection'
  ) THEN
    RAISE EXCEPTION 'DataForSEO collection scope or source connection is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'DataForSEO collection outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.provider = 'dataforseo'
        AND snapshot.method_version = NEW.method_version
        AND snapshot.source_connection_id = NEW.source_connection_id
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
        AND (
          (
            NEW.operation = 'keyword_gap_import'
            AND snapshot.dataset_key IN (
              'csv.keyword_gap.v1',
              'dataforseo.ranked_keywords.v1'
            )
          )
          OR (
            NEW.operation = 'search_landscape'
            AND snapshot.dataset_key = 'dataforseo.search_landscape.v1'
          )
        )
    ) THEN
      RAISE EXCEPTION 'DataForSEO collection outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_runs_provenance_guard
  ON app.collection_runs;
DROP TRIGGER IF EXISTS collection_runs_dataforseo_provenance_guard
  ON app.collection_runs;
CREATE TRIGGER collection_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc' AND NEW.provider <> 'dataforseo')
  EXECUTE FUNCTION app.enforce_collection_run_provenance();
CREATE TRIGGER collection_runs_dataforseo_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider = 'dataforseo')
  EXECUTE FUNCTION app.enforce_dataforseo_collection_run_provenance();

CREATE OR REPLACE FUNCTION app.enforce_dataforseo_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> 'dataforseo'
     OR NEW.source_connection_id IS NULL THEN
    RAISE EXCEPTION 'DataForSEO snapshot source identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    JOIN app.source_connections source
      ON source.id = NEW.source_connection_id
     AND source.id = run.source_connection_id
     AND source.workspace_id = NEW.workspace_id
     AND source.project_id = NEW.project_id
     AND source.site_id = NEW.site_id
     AND source.provider = 'dataforseo'
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = 'dataforseo'
      AND run.import_preview_id IS NULL
      AND (
        (
          run.operation = 'keyword_gap_import'
          AND run.method_version = 'dataforseo.ranked_keywords.v1'
          AND NEW.dataset_key IN (
            'csv.keyword_gap.v1',
            'dataforseo.ranked_keywords.v1'
          )
          AND NEW.schema_version = 'dataforseo.ranked_keywords.v1'
          AND NEW.method_version = 'dataforseo.ranked_keywords.v1'
        )
        OR (
          run.operation = 'search_landscape'
          AND run.method_version = 'dataforseo.search_landscape.v1'
          AND NEW.dataset_key = 'dataforseo.search_landscape.v1'
          AND NEW.schema_version = 'dataforseo.search_landscape.v1'
          AND NEW.method_version = 'dataforseo.search_landscape.v1'
        )
      )
  ) THEN
    RAISE EXCEPTION 'DataForSEO snapshot does not match an exact collection identity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_snapshots_provenance_guard
  ON app.data_snapshots;
DROP TRIGGER IF EXISTS data_snapshots_dataforseo_provenance_guard
  ON app.data_snapshots;
CREATE TRIGGER data_snapshots_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc' AND NEW.provider <> 'dataforseo')
  EXECUTE FUNCTION app.enforce_data_snapshot_provenance();
CREATE TRIGGER data_snapshots_dataforseo_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (NEW.provider = 'dataforseo')
  EXECUTE FUNCTION app.enforce_dataforseo_data_snapshot_provenance();

CREATE OR REPLACE FUNCTION app.enforce_dataforseo_observation_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  value_key_count integer;
BEGIN
  IF NEW.provider <> 'dataforseo'
     OR NEW.origin <> 'vendor_observation'
     OR NEW.grade <> 'B' THEN
    RAISE EXCEPTION 'DataForSEO observation trust identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    JOIN app.collection_runs run
      ON run.id = snapshot.collection_run_id
     AND run.workspace_id = snapshot.workspace_id
     AND run.project_id = snapshot.project_id
     AND run.site_id = snapshot.site_id
     AND run.source_connection_id = snapshot.source_connection_id
     AND run.provider = 'dataforseo'
    JOIN app.source_connections source
      ON source.id = snapshot.source_connection_id
     AND source.workspace_id = snapshot.workspace_id
     AND source.project_id = snapshot.project_id
     AND source.site_id = snapshot.site_id
     AND source.provider = 'dataforseo'
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
      AND snapshot.provider = 'dataforseo'
      AND snapshot.captured_at = NEW.observed_at
      AND (
        (
          run.operation = 'keyword_gap_import'
          AND run.method_version = 'dataforseo.ranked_keywords.v1'
          AND snapshot.dataset_key IN (
            'csv.keyword_gap.v1',
            'dataforseo.ranked_keywords.v1'
          )
          AND snapshot.schema_version = 'dataforseo.ranked_keywords.v1'
          AND snapshot.method_version = 'dataforseo.ranked_keywords.v1'
          AND NEW.metric_key = 'csv.keyword_gap.v1'
        )
        OR (
          run.operation = 'search_landscape'
          AND run.method_version = 'dataforseo.search_landscape.v1'
          AND snapshot.dataset_key = 'dataforseo.search_landscape.v1'
          AND snapshot.schema_version = 'dataforseo.search_landscape.v1'
          AND snapshot.method_version = 'dataforseo.search_landscape.v1'
          AND NEW.metric_key IN (
            'csv.keyword_gap.v1',
            'dataforseo.competitor_domain.v1'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'DataForSEO observation does not match its exact Snapshot lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.metric_key = 'dataforseo.competitor_domain.v1' THEN
    IF jsonb_typeof(NEW.value_json) = 'object' THEN
      SELECT count(*)::integer
      INTO value_key_count
      FROM jsonb_object_keys(NEW.value_json);
    ELSE
      value_key_count := 0;
    END IF;

    IF NEW.subject_type <> 'site'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.availability <> 'available'
       OR NEW.value_numeric IS NOT NULL
       OR NEW.value_text IS NOT NULL
       OR NEW.value_json IS NULL
       OR NEW.unit IS NOT NULL
       OR NEW.support <> 'supports'
       OR value_key_count <> 8
       OR NOT (
         NEW.value_json ?& ARRAY[
           'targetDomain',
           'competitorDomain',
           'intersections',
           'averagePosition',
           'summedPosition',
           'organicEstimatedTrafficVolume',
           'marketCode',
           'languageCode'
         ]::text[]
       )
       OR NOT app.is_normalized_competitor_domain(
         NEW.value_json ->> 'targetDomain'
       )
       OR NOT app.is_normalized_competitor_domain(
         NEW.value_json ->> 'competitorDomain'
       )
       OR NEW.value_json ->> 'targetDomain'
          = NEW.value_json ->> 'competitorDomain'
       OR NEW.subject_ref IS DISTINCT FROM
          NEW.value_json ->> 'competitorDomain'
       OR jsonb_typeof(NEW.value_json -> 'intersections') <> 'number'
       OR (NEW.value_json ->> 'intersections') !~ '^[1-9][0-9]*$'
       OR jsonb_typeof(NEW.value_json -> 'averagePosition') <> 'number'
       OR (NEW.value_json ->> 'averagePosition')::numeric < 0
       OR jsonb_typeof(NEW.value_json -> 'summedPosition') <> 'number'
       OR (NEW.value_json ->> 'summedPosition')::numeric < 0
       OR jsonb_typeof(
         NEW.value_json -> 'organicEstimatedTrafficVolume'
       ) <> 'number'
       OR (
         NEW.value_json ->> 'organicEstimatedTrafficVolume'
       )::numeric < 0
       OR (NEW.value_json ->> 'marketCode') !~ '^[A-Z]{2}$'
       OR (NEW.value_json ->> 'languageCode') !~ '^[a-z]{2,3}$' THEN
      RAISE EXCEPTION 'DataForSEO competitor-domain observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalized_observations_provenance_guard
  ON app.normalized_observations;
DROP TRIGGER IF EXISTS normalized_observations_dataforseo_provenance_guard
  ON app.normalized_observations;
CREATE TRIGGER normalized_observations_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc' AND NEW.provider <> 'dataforseo')
  EXECUTE FUNCTION app.enforce_normalized_observation_provenance();
CREATE TRIGGER normalized_observations_dataforseo_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (NEW.provider = 'dataforseo')
  EXECUTE FUNCTION app.enforce_dataforseo_observation_provenance();

-- A SERP overlap is an immutable pointer to one exact competitor-domain
-- Observation in the composite Snapshot. It never carries inferred names,
-- relationships, or approved analysis scopes.
ALTER TABLE app.competitor_origin_occurrences
  DROP CONSTRAINT IF EXISTS competitor_origin_occurrences_origin_kind_check,
  DROP CONSTRAINT IF EXISTS competitor_origin_occurrences_check;
ALTER TABLE app.competitor_origin_occurrences
  ADD CONSTRAINT competitor_origin_occurrences_origin_kind_check CHECK (
    origin_kind IN (
      'product_profile',
      'csv_keyword_gap',
      'manual',
      'serp_overlap'
    )
  ),
  ADD CONSTRAINT competitor_origin_occurrences_check CHECK (
    (
      origin_kind = 'product_profile'
      AND source_name IS NOT NULL
      AND product_profile_id IS NOT NULL
      AND profile_version IS NOT NULL
      AND candidate_id IS NOT NULL
      AND field_provenance_path IS NOT NULL
      AND evidence_refs IS NOT NULL
      AND source_review_status IS NOT NULL
      AND source_analysis_scope IS NOT NULL
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND import_preview_id IS NULL
      AND source_pointer IS NULL
      AND manual_entry_id IS NULL
      AND observed_at IS NULL
    )
    OR (
      origin_kind = 'csv_keyword_gap'
      AND source_name IS NULL
      AND product_profile_id IS NULL
      AND profile_version IS NULL
      AND candidate_id IS NULL
      AND field_provenance_path IS NULL
      AND evidence_refs IS NULL
      AND source_review_status IS NULL
      AND source_relationship IS NULL
      AND source_analysis_scope IS NULL
      AND data_snapshot_id IS NOT NULL
      AND normalized_observation_id IS NOT NULL
      AND import_preview_id IS NOT NULL
      AND source_pointer = '/valueJson/competitorDomain'
      AND manual_entry_id IS NULL
      AND observed_at IS NOT NULL
    )
    OR (
      origin_kind = 'manual'
      AND product_profile_id IS NULL
      AND profile_version IS NULL
      AND candidate_id IS NULL
      AND field_provenance_path IS NULL
      AND evidence_refs IS NULL
      AND source_review_status IS NULL
      AND source_relationship IS NULL
      AND source_analysis_scope IS NULL
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND import_preview_id IS NULL
      AND source_pointer IS NULL
      AND manual_entry_id IS NOT NULL
      AND id = manual_entry_id
      AND observed_at IS NULL
    )
    OR (
      origin_kind = 'serp_overlap'
      AND source_name IS NULL
      AND product_profile_id IS NULL
      AND profile_version IS NULL
      AND candidate_id IS NULL
      AND field_provenance_path IS NULL
      AND evidence_refs IS NULL
      AND source_review_status IS NULL
      AND source_relationship IS NULL
      AND source_analysis_scope IS NULL
      AND data_snapshot_id IS NOT NULL
      AND normalized_observation_id IS NOT NULL
      AND import_preview_id IS NULL
      AND source_pointer = '/valueJson/competitorDomain'
      AND manual_entry_id IS NULL
      AND observed_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_serp_identity_idx
  ON app.competitor_origin_occurrences(
    normalized_observation_id,
    source_pointer
  )
  WHERE origin_kind = 'serp_overlap';

CREATE OR REPLACE FUNCTION app.enforce_serp_overlap_competitor_origin_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_domain text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'SERP overlap competitor origins are append-only'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.origin_kind <> 'serp_overlap' THEN
    RAISE EXCEPTION 'SERP overlap guard received another origin kind'
      USING ERRCODE = '23514';
  END IF;

  SELECT entity.domain
  INTO entity_domain
  FROM app.competitor_entities entity
  JOIN app.client_projects project
    ON project.id = entity.project_id
   AND project.workspace_id = entity.workspace_id
   AND project.archived_at IS NULL
  WHERE entity.id = NEW.competitor_id
    AND entity.workspace_id = NEW.workspace_id
    AND entity.project_id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERP overlap origin does not match an active scoped entity'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.normalized_observations observation
    JOIN app.data_snapshots snapshot
      ON snapshot.id = observation.snapshot_id
     AND snapshot.id = NEW.data_snapshot_id
     AND snapshot.workspace_id = NEW.workspace_id
     AND snapshot.project_id = NEW.project_id
     AND snapshot.provider = 'dataforseo'
     AND snapshot.dataset_key = 'dataforseo.search_landscape.v1'
     AND snapshot.schema_version = 'dataforseo.search_landscape.v1'
     AND snapshot.method_version = 'dataforseo.search_landscape.v1'
     AND snapshot.source_connection_id IS NOT NULL
    JOIN app.collection_runs collection
      ON collection.id = snapshot.collection_run_id
     AND collection.workspace_id = NEW.workspace_id
     AND collection.project_id = NEW.project_id
     AND collection.site_id = snapshot.site_id
     AND collection.source_connection_id = snapshot.source_connection_id
     AND collection.provider = 'dataforseo'
     AND collection.operation = 'search_landscape'
     AND collection.method_version = 'dataforseo.search_landscape.v1'
     AND collection.import_preview_id IS NULL
    JOIN app.source_connections source
      ON source.id = snapshot.source_connection_id
     AND source.workspace_id = NEW.workspace_id
     AND source.project_id = NEW.project_id
     AND source.site_id = snapshot.site_id
     AND source.provider = 'dataforseo'
    WHERE observation.id = NEW.normalized_observation_id
      AND observation.workspace_id = NEW.workspace_id
      AND observation.project_id = NEW.project_id
      AND observation.provider = 'dataforseo'
      AND observation.metric_key = 'dataforseo.competitor_domain.v1'
      AND observation.subject_type = 'site'
      AND observation.subject_ref = entity_domain
      AND observation.origin = 'vendor_observation'
      AND observation.grade = 'B'
      AND observation.availability = 'available'
      AND observation.support = 'supports'
      AND observation.observed_at = NEW.observed_at
      AND observation.value_json ->> 'competitorDomain' = entity_domain
      AND NEW.source_pointer = '/valueJson/competitorDomain'
  ) THEN
    RAISE EXCEPTION 'SERP overlap origin does not match canonical composite Observation lineage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitor_origins_lineage_guard
  ON app.competitor_origin_occurrences;
DROP TRIGGER IF EXISTS competitor_origins_serp_lineage_guard
  ON app.competitor_origin_occurrences;
DROP TRIGGER IF EXISTS competitor_origins_delete_guard
  ON app.competitor_origin_occurrences;
CREATE TRIGGER competitor_origins_lineage_guard
  BEFORE INSERT OR UPDATE ON app.competitor_origin_occurrences
  FOR EACH ROW
  WHEN (NEW.origin_kind <> 'serp_overlap')
  EXECUTE FUNCTION app.enforce_competitor_origin_lineage();
CREATE TRIGGER competitor_origins_serp_lineage_guard
  BEFORE INSERT OR UPDATE ON app.competitor_origin_occurrences
  FOR EACH ROW
  WHEN (NEW.origin_kind = 'serp_overlap')
  EXECUTE FUNCTION app.enforce_serp_overlap_competitor_origin_lineage();
CREATE TRIGGER competitor_origins_delete_guard
  BEFORE DELETE ON app.competitor_origin_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_origin_lineage();

-- The source identity serializes independently from the stable domain. A new
-- entity starts as an unreviewed candidate; an existing entity's human
-- governance is deliberately never updated by provider discovery.
CREATE OR REPLACE FUNCTION app.upsert_serp_overlap_competitor_origin(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_domain text,
  selected_data_snapshot_id uuid,
  selected_normalized_observation_id uuid,
  selected_source_pointer text
)
RETURNS TABLE (occurrence_id uuid, competitor_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  entity_row app.competitor_entities%ROWTYPE;
  occurrence_row app.competitor_origin_occurrences%ROWTYPE;
  selected_observed_at timestamptz;
  source_lock_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = selected_project_id
      AND project.workspace_id = selected_workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'competitor project is absent or archived'
      USING ERRCODE = '23514';
  END IF;
  IF selected_domain IS NULL
     OR NOT app.is_normalized_competitor_domain(selected_domain)
     OR selected_data_snapshot_id IS NULL
     OR selected_normalized_observation_id IS NULL
     OR selected_source_pointer IS DISTINCT FROM
        '/valueJson/competitorDomain' THEN
    RAISE EXCEPTION 'SERP overlap competitor source shape is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT observation.observed_at
  INTO selected_observed_at
  FROM app.normalized_observations observation
  WHERE observation.id = selected_normalized_observation_id;
  IF selected_observed_at IS NULL THEN
    RAISE EXCEPTION 'SERP overlap Observation is absent'
      USING ERRCODE = '23514';
  END IF;

  source_lock_key := 'serp_overlap:'
    || selected_normalized_observation_id::text || ':'
    || selected_source_pointer;
  PERFORM pg_advisory_xact_lock(hashtextextended(source_lock_key, 0));

  SELECT *
  INTO occurrence_row
  FROM app.competitor_origin_occurrences occurrence
  WHERE occurrence.origin_kind = 'serp_overlap'
    AND occurrence.normalized_observation_id =
      selected_normalized_observation_id
    AND occurrence.source_pointer = selected_source_pointer;

  IF occurrence_row.id IS NOT NULL THEN
    SELECT *
    INTO entity_row
    FROM app.competitor_entities entity
    WHERE entity.id = occurrence_row.competitor_id;
    IF occurrence_row.workspace_id IS DISTINCT FROM selected_workspace_id
       OR occurrence_row.project_id IS DISTINCT FROM selected_project_id
       OR entity_row.workspace_id IS DISTINCT FROM selected_workspace_id
       OR entity_row.project_id IS DISTINCT FROM selected_project_id
       OR entity_row.domain IS DISTINCT FROM selected_domain
       OR occurrence_row.source_name IS NOT NULL
       OR occurrence_row.data_snapshot_id IS DISTINCT FROM
          selected_data_snapshot_id
       OR occurrence_row.normalized_observation_id IS DISTINCT FROM
          selected_normalized_observation_id
       OR occurrence_row.import_preview_id IS NOT NULL
       OR occurrence_row.source_pointer IS DISTINCT FROM
          selected_source_pointer
       OR occurrence_row.manual_entry_id IS NOT NULL
       OR occurrence_row.observed_at IS DISTINCT FROM
          selected_observed_at THEN
      RAISE EXCEPTION 'SERP overlap source replay conflicts with immutable provenance'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT occurrence_row.id, entity_row.id;
    RETURN;
  END IF;

  INSERT INTO app.competitor_entities (
    workspace_id,
    project_id,
    domain,
    name,
    review_status,
    relationship,
    analysis_scope
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    selected_domain,
    NULL,
    'candidate',
    NULL,
    ARRAY[]::text[]
  )
  ON CONFLICT (project_id, domain) DO NOTHING
  RETURNING * INTO entity_row;

  IF entity_row.id IS NULL THEN
    SELECT *
    INTO entity_row
    FROM app.competitor_entities entity
    WHERE entity.project_id = selected_project_id
      AND entity.domain = selected_domain;
  END IF;
  IF entity_row.id IS NULL
     OR entity_row.workspace_id IS DISTINCT FROM selected_workspace_id THEN
    RAISE EXCEPTION 'competitor stable domain conflicts with workspace scope'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.competitor_origin_occurrences (
    workspace_id,
    project_id,
    competitor_id,
    origin_kind,
    source_name,
    data_snapshot_id,
    normalized_observation_id,
    import_preview_id,
    source_pointer,
    manual_entry_id,
    observed_at
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    entity_row.id,
    'serp_overlap',
    NULL,
    selected_data_snapshot_id,
    selected_normalized_observation_id,
    NULL,
    selected_source_pointer,
    NULL,
    selected_observed_at
  )
  RETURNING * INTO occurrence_row;

  RETURN QUERY SELECT occurrence_row.id, entity_row.id;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0034_dataforseo_search_landscape'::text AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0034_dataforseo_search_landscape.sql

-- BEGIN EXACT ORDERED MIGRATION 0035_uuidv8_product_profile_competitor_evidence.sql
BEGIN;

-- Product Profile synthesis deterministically mints candidate and evidence
-- identities as UUIDv8. Migration 0019 accidentally retained the pre-RFC 9562
-- [1-5] version bound, so the database rejected the same evidence references
-- that the application had already validated when a confirmed profile carried
-- a competitor. Keep the typed shape and uniqueness checks unchanged while
-- accepting every UUID version used by the current contracts (1 through 8).
CREATE OR REPLACE FUNCTION app.is_typed_product_profile_evidence_refs(
  candidate jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  evidence_ref jsonb;
  ref_kind text;
  ref_id text;
  target_id text;
  expected_keys integer;
  seen_ids text[] := ARRAY[]::text[];
  uuid_pattern constant text :=
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(candidate) IS DISTINCT FROM 'array'
     OR jsonb_array_length(candidate) NOT BETWEEN 1 AND 50 THEN
    RETURN false;
  END IF;

  FOR evidence_ref IN SELECT value FROM jsonb_array_elements(candidate)
  LOOP
    IF jsonb_typeof(evidence_ref) IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    ref_kind := evidence_ref ->> 'kind';
    ref_id := evidence_ref ->> 'evidenceRefId';
    IF ref_id IS NULL OR ref_id !~ uuid_pattern OR ref_id = ANY(seen_ids) THEN
      RETURN false;
    END IF;
    seen_ids := array_append(seen_ids, ref_id);

    CASE ref_kind
      WHEN 'declaredHint', 'userEdit' THEN
        expected_keys := 2;
        target_id := NULL;
      WHEN 'snapshot' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'snapshotId';
      WHEN 'pageSnapshot' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'pageSnapshotId';
      WHEN 'observation' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'observationId';
      WHEN 'analysisInvocation' THEN
        expected_keys := 3;
        target_id := evidence_ref ->> 'analysisInvocationId';
      ELSE
        RETURN false;
    END CASE;

    IF (SELECT count(*) FROM jsonb_object_keys(evidence_ref))
       IS DISTINCT FROM expected_keys THEN
      RETURN false;
    END IF;
    IF expected_keys = 3 AND (target_id IS NULL OR target_id !~ uuid_pattern) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0035_uuidv8_product_profile_competitor_evidence'::text
    AS migration_version;

COMMIT;
-- END EXACT ORDERED MIGRATION 0035_uuidv8_product_profile_competitor_evidence.sql
