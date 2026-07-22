-- SignalFrame Service Delivery MVP 0.3.0
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
  confirmed_icp_profile_id uuid,
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
  market_codes text[] NOT NULL CHECK (cardinality(market_codes) BETWEEN 0 AND 20),
  language_codes text[] NOT NULL CHECK (cardinality(language_codes) BETWEEN 0 AND 20),
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
  contract_version text NOT NULL DEFAULT '2026-07-21',
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
  rule_set_version text NOT NULL CHECK (
    rule_set_version IN ('mvp.rules.0.2.0', 'mvp.rules.0.2.1')
  ),
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
  CHECK (origin <> 'user_provided' OR source_provider = 'csv'),
  CONSTRAINT evidence_source_lineage_required CHECK (
    (
      analysis_invocation_id IS NULL
      OR (
        snapshot_id IS NULL
        AND collection_run_id IS NULL
        AND source_provider = 'llm'
        AND origin = 'generated'
        AND method = 'generated'
      )
    )
    AND (
      source_provider <> 'llm'
      OR analysis_invocation_id IS NOT NULL
    )
    AND (
      source_provider NOT IN ('crawl','gsc','ga4','csv','dataforseo')
      OR (
        snapshot_id IS NOT NULL
        AND collection_run_id IS NOT NULL
        AND analysis_invocation_id IS NULL
      )
    )
  )
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
  source_diagnostic_run_id uuid NOT NULL,
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
  schema_version text NOT NULL DEFAULT 'signalframe.service-bundle.0.3.0',
  CONSTRAINT export_bundles_schema_version_check
    CHECK (schema_version IN ('signalframe.service-bundle.0.2.0','signalframe.service-bundle.0.3.0')),
  output_locale text NOT NULL CHECK (output_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  object_key text,
  checksum text CHECK (checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$'),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  item_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(item_counts) = 'object'),
  manifest jsonb CHECK (manifest IS NULL OR jsonb_typeof(manifest) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
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

-- Capability execution extends the canonical async-run ledger. The primary key
-- is the owning async run, so this table cannot become a second run lifecycle.
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

-- Customer-facing audit state is an immutable projection over canonical runs;
-- status remains owned by the referenced async run.
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

-- Durable URL identity only. Metrics and extracted content remain attributable
-- to immutable page/data snapshots.
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

CREATE TABLE IF NOT EXISTS app.page_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  data_snapshot_id uuid NOT NULL REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  canonical_extract text,
  extract jsonb NOT NULL CHECK (jsonb_typeof(extract) = 'object'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT page_snapshots_canonical_extract_required
    CHECK (canonical_extract IS NOT NULL),
  UNIQUE (site_page_id, data_snapshot_id, content_hash),
  CONSTRAINT page_snapshots_site_page_data_snapshot_key
    UNIQUE (site_page_id, data_snapshot_id)
);

CREATE INDEX IF NOT EXISTS page_snapshots_page_captured_idx
  ON app.page_snapshots(site_page_id, captured_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS page_snapshots_project_captured_idx
  ON app.page_snapshots(project_id, captured_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS page_snapshots_verified_source_identity_idx
  ON app.page_snapshots(site_page_id, data_snapshot_id)
  WHERE canonical_extract IS NOT NULL;

-- Duplicated tenant keys are read-model accelerators, never free-form labels.
-- Every projection is checked against its canonical parent lineage before it
-- can become customer-visible.
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

DROP TRIGGER IF EXISTS audit_runs_provenance_guard ON app.audit_runs;
CREATE TRIGGER audit_runs_provenance_guard BEFORE INSERT ON app.audit_runs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_audit_run_provenance();

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

-- URL-first Product Profile starts before market/language discovery. Empty
-- arrays mean unknown, never an inferred default. A separate confirmed pointer
-- freezes the reviewed version consumed by downstream audits while the current
-- pointer may advance to a later working draft.
ALTER TABLE app.client_projects
  ADD COLUMN IF NOT EXISTS confirmed_icp_profile_id uuid;

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
ALTER TABLE app.sites VALIDATE CONSTRAINT sites_market_codes_check;
ALTER TABLE app.sites VALIDATE CONSTRAINT sites_language_codes_check;

-- Freeze every Action to the exact append-only DiagnosticRun observation that
-- existed when the Action was first created. Existing rows are never inferred
-- from the mutable Finding projection.
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
    WHERE conname = 'client_projects_confirmed_icp_profile_fk'
      AND conrelid = 'app.client_projects'::regclass
  ) THEN
    ALTER TABLE app.client_projects
      ADD CONSTRAINT client_projects_confirmed_icp_profile_fk
      FOREIGN KEY (confirmed_icp_profile_id) REFERENCES app.icp_profiles(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'actions_source_diagnostic_run_fk'
      AND conrelid = 'app.actions'::regclass
  ) THEN
    ALTER TABLE app.actions
      ADD CONSTRAINT actions_source_diagnostic_run_fk
      FOREIGN KEY (source_diagnostic_run_id) REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT;
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

-- Backward-compatible activation: before the confirmed pointer existed, a
-- complete current profile was the reviewed downstream input.
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

-- Cumulative migration 0012's executable statements are embedded exactly so
-- this standalone schema preserves the same guards as an upgraded database.
-- BEGIN EXACT EXECUTABLE MIGRATION 0012_page_snapshot_lineage_hardening
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
-- END EXACT EXECUTABLE MIGRATION 0012_page_snapshot_lineage_hardening

-- This trigger predates migration 0012, but now binds directly to the single
-- canonical function definition embedded above.
DROP TRIGGER IF EXISTS site_pages_provenance_guard ON app.site_pages;
CREATE TRIGGER site_pages_provenance_guard BEFORE INSERT OR UPDATE ON app.site_pages
  FOR EACH ROW EXECUTE FUNCTION app.enforce_site_page_provenance();

-- Cumulative migration 0013's executable statements are embedded exactly so
-- current diagnostics and rules retain runtime-migration lineage.
-- BEGIN EXACT EXECUTABLE MIGRATION 0013_exact_url_variant_rules
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
-- END EXACT EXECUTABLE MIGRATION 0013_exact_url_variant_rules

-- Product Profile synthesis is executable authority only because migration
-- 0014, the application schema, repositories, worker, and public contract are
-- active together. The bounded body below is statement-for-statement exact.
-- BEGIN EXACT EXECUTABLE MIGRATION 0014_product_profile_synthesis
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
-- END EXACT EXECUTABLE MIGRATION 0014_product_profile_synthesis

-- The URL-first Crawl seed is frozen at command acceptance. This is the exact
-- executable body of migration 0015, including its replacement of the earlier
-- collection provenance guard with the stricter seed-aware definition.
-- BEGIN EXACT EXECUTABLE MIGRATION 0015_frozen_crawl_seed
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
-- END EXACT EXECUTABLE MIGRATION 0015_frozen_crawl_seed

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
DROP TRIGGER IF EXISTS idempotency_keys_set_updated_at ON app.idempotency_keys;
CREATE TRIGGER idempotency_keys_set_updated_at BEFORE UPDATE ON app.idempotency_keys
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS site_pages_set_updated_at ON app.site_pages;
CREATE TRIGGER site_pages_set_updated_at BEFORE UPDATE ON app.site_pages
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

-- Runtime-safe migration identity for technical health signals (spec §15.2).
-- A view keeps migration identity separate from the frozen table inventory.
CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0015_frozen_crawl_seed'::text AS migration_version;

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
