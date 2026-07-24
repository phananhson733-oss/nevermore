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

-- Exact executable 0016 observation-to-SitePage lineage contract. This is the
-- migration body without its transaction frame and final version projection.
-- BEGIN EXACT EXECUTABLE MIGRATION 0016_observation_site_page_lineage

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

-- END EXACT EXECUTABLE MIGRATION 0016_observation_site_page_lineage

-- Exact executable 0017 Finding target ledger contract. This is the immutable
-- per-DiagnosticRun target membership truth; historical rows are not inferred.
-- BEGIN EXACT EXECUTABLE MIGRATION 0017_finding_target_ledger

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
-- END EXACT EXECUTABLE MIGRATION 0017_finding_target_ledger

-- BEGIN EXACT EXECUTABLE MIGRATION 0018_keyword_library_foundation
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
-- END EXACT EXECUTABLE MIGRATION 0018_keyword_library_foundation

-- BEGIN EXACT EXECUTABLE MIGRATION 0019_competitor_library_foundation
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
-- END EXACT EXECUTABLE MIGRATION 0019_competitor_library_foundation

-- Slice 2 Task 2 (migration 0020_content_shadow_foundation): SEO/GEO Content
-- Shadow projection. Shadow-but-no-CMS: internal shadow content drafts are
-- permitted as an internal_write capability; no external CMS/publish write.
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
  SELECT '0019_competitor_library_foundation'::text AS migration_version;

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
