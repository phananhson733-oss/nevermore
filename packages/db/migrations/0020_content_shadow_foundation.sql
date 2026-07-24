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
