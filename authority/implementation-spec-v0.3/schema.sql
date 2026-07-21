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
  SELECT '0006_observability_metrics'::text AS migration_version;

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
