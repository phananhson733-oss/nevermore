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
