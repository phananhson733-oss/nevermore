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
