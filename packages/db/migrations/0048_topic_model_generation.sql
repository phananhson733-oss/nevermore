BEGIN;

SET LOCAL lock_timeout = '5s';

-- Topic Model generation is an internal Analysis Refresh child with its own
-- typed resource and model-call lineage. Preserve every historical literal.
ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_kind_check CHECK (kind IN (
    'collection',
    'diagnostic',
    'artifact_generation',
    'export',
    'product_profile_synthesis',
    'content_shadow',
    'publication',
    'measurement',
    'analysis_refresh',
    'topic_model_generation'
  ));

ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_result_type_check CHECK (
    result_type IS NULL OR result_type IN (
      'collection_run',
      'diagnostic_run',
      'artifact',
      'export',
      'icp_profile',
      'flow_shadow_run',
      'publication_attempt',
      'measurement_window',
      'analysis_refresh_run',
      'topic_model_generation_run'
    )
  );

ALTER TABLE app.analysis_invocations
  DROP CONSTRAINT IF EXISTS analysis_invocations_task_check;
ALTER TABLE app.analysis_invocations
  ADD CONSTRAINT analysis_invocations_task_check CHECK (task IN (
    'finding_summary',
    'artifact_generation',
    'product_profile_synthesis',
    'content_shadow_draft',
    'topic_model_generation'
  ));

-- Lifecycle truth remains solely in async_runs. This row freezes one bounded
-- input object and can bind exactly one confirmed Topic Model revision.
CREATE TABLE IF NOT EXISTS app.topic_model_generation_runs (
  id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  analysis_refresh_run_id uuid NOT NULL
    REFERENCES app.analysis_refresh_runs(id) ON DELETE RESTRICT,
  generation_version text NOT NULL CHECK (
    length(generation_version) BETWEEN 1 AND 200
    AND generation_version = btrim(generation_version)
  ),
  prompt_set_version text NOT NULL CHECK (
    length(prompt_set_version) BETWEEN 1 AND 200
    AND prompt_set_version = btrim(prompt_set_version)
  ),
  input_manifest jsonb NOT NULL CHECK (
    jsonb_typeof(input_manifest) = 'object'
    AND octet_length(input_manifest::text) <= 262144
    AND input_manifest ->> 'schemaVersion' =
      'topic-model-generation-input.v1'
  ),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  prompt_input_hash text CHECK (
    prompt_input_hash IS NULL OR prompt_input_hash ~ '^[a-f0-9]{64}$'
  ),
  result_topic_model_revision_id uuid
    REFERENCES app.topic_model_revisions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_refresh_run_id)
);

CREATE INDEX IF NOT EXISTS topic_model_generation_runs_project_created_idx
  ON app.topic_model_generation_runs(
    workspace_id,
    project_id,
    created_at DESC,
    id DESC
  );
CREATE UNIQUE INDEX IF NOT EXISTS topic_model_generation_runs_result_revision_idx
  ON app.topic_model_generation_runs(result_topic_model_revision_id)
  WHERE result_topic_model_revision_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.enforce_topic_model_generation_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.result_topic_model_revision_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Topic Model generation run must begin without a result revision'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.analysis_refresh_runs parent
      ON parent.id = NEW.analysis_refresh_run_id
     AND parent.workspace_id = NEW.workspace_id
     AND parent.project_id = NEW.project_id
     AND parent.plan_manifest ->> 'version' = 'analysis-refresh.plan.v3'
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'topic_model_generation'
      AND run.result_type = 'topic_model_generation_run'
      AND run.result_id = NEW.id
      AND NEW.input_manifest ->> 'analysisRefreshRunId' =
        NEW.analysis_refresh_run_id::text
      AND NEW.input_manifest ->> 'projectId' = NEW.project_id::text
  ) THEN
    RAISE EXCEPTION
      'Topic Model generation run provenance does not match its parent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.result_topic_model_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions revision
    JOIN app.analysis_invocations invocation
      ON invocation.id::text =
        revision.generation_basis ->> 'analysisInvocationId'
     AND invocation.workspace_id = NEW.workspace_id
     AND invocation.project_id = NEW.project_id
     AND invocation.async_run_id = NEW.id
     AND invocation.diagnostic_run_id IS NULL
     AND invocation.task = 'topic_model_generation'
     AND invocation.status = 'succeeded'
     AND invocation.output_hash IS NOT NULL
     AND invocation.error_code IS NULL
     AND NEW.prompt_input_hash IS NOT NULL
     AND invocation.input_hash = NEW.prompt_input_hash
    WHERE revision.id = NEW.result_topic_model_revision_id
      AND revision.workspace_id = NEW.workspace_id
      AND revision.project_id = NEW.project_id
      AND revision.status = 'confirmed'
      AND revision.generation_basis ->> 'origin' = 'llm_auto_confirmed'
      AND revision.generation_basis ->> 'generationVersion' =
        NEW.generation_version
      AND revision.generation_basis ->> 'promptSetVersion' =
        NEW.prompt_set_version
      AND revision.generation_basis ->> 'inputHash' = NEW.input_hash
  ) THEN
    RAISE EXCEPTION
      'Topic Model generation result lacks successful immutable lineage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_topic_model_generation_run_frozen_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Topic Model generation run is durable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.analysis_refresh_run_id IS DISTINCT FROM
       OLD.analysis_refresh_run_id
     OR NEW.generation_version IS DISTINCT FROM OLD.generation_version
     OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
     OR NEW.input_manifest IS DISTINCT FROM OLD.input_manifest
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Topic Model generation frozen input is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.prompt_input_hash IS NOT NULL
     AND NEW.prompt_input_hash IS DISTINCT FROM OLD.prompt_input_hash THEN
    RAISE EXCEPTION
      'Topic Model generation prompt input hash is immutable once set'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.result_topic_model_revision_id IS NOT NULL
     AND NEW.result_topic_model_revision_id IS DISTINCT FROM
       OLD.result_topic_model_revision_id THEN
    RAISE EXCEPTION
      'Topic Model generation result revision is immutable once set'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_model_generation_runs_provenance_guard
  ON app.topic_model_generation_runs;
CREATE TRIGGER topic_model_generation_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.topic_model_generation_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_model_generation_run_provenance();

DROP TRIGGER IF EXISTS topic_model_generation_runs_frozen_input_guard
  ON app.topic_model_generation_runs;
CREATE TRIGGER topic_model_generation_runs_frozen_input_guard
  BEFORE UPDATE OR DELETE ON app.topic_model_generation_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_model_generation_run_frozen_input();

-- The generic result points at the typed run from enqueue onward. The exact
-- confirmed Topic revision is the typed row's one-shot terminal result.
CREATE OR REPLACE FUNCTION app.enforce_topic_model_generation_async_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.kind = 'topic_model_generation'
     AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Topic Model generation async kind is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.kind IS DISTINCT FROM 'topic_model_generation' THEN
    RETURN NEW;
  END IF;

  IF NEW.result_type IS DISTINCT FROM 'topic_model_generation_run'
     OR NEW.result_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION
      'Topic Model generation async result must point at its typed run'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'partial' THEN
    RAISE EXCEPTION 'Topic Model generation does not support partial results'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'completed' AND NOT EXISTS (
    SELECT 1
    FROM app.topic_model_generation_runs generation_run
    WHERE generation_run.id = NEW.id
      AND generation_run.workspace_id = NEW.workspace_id
      AND generation_run.project_id = NEW.project_id
      AND generation_run.result_topic_model_revision_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Completed Topic Model generation requires one result revision'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('failed','cancelled') AND EXISTS (
    SELECT 1
    FROM app.topic_model_generation_runs generation_run
    WHERE generation_run.id = NEW.id
      AND generation_run.workspace_id = NEW.workspace_id
      AND generation_run.project_id = NEW.project_id
      AND generation_run.result_topic_model_revision_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Unsuccessful Topic Model generation cannot carry a result revision'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS async_runs_topic_model_generation_result_guard
  ON app.async_runs;
CREATE TRIGGER async_runs_topic_model_generation_result_guard
  BEFORE INSERT OR UPDATE ON app.async_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_model_generation_async_result();

-- Invocation ledger.
-- A model call consumes budget before leaving the worker. This durable ledger
-- serializes retries by exact AsyncRun attempt and stores only bounded metadata
-- and hashes: never a prompt, response, or model-produced text.
CREATE TABLE IF NOT EXISTS app.topic_model_generation_invocation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  topic_model_generation_run_id uuid NOT NULL
    REFERENCES app.topic_model_generation_runs(id) ON DELETE RESTRICT,
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
  UNIQUE (topic_model_generation_run_id, ordinal),
  UNIQUE (topic_model_generation_run_id, async_attempt_count),
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

CREATE INDEX IF NOT EXISTS topic_model_generation_invocation_attempts_project_idx
  ON app.topic_model_generation_invocation_attempts(
    project_id,
    reserved_at DESC,
    id ASC
  );
CREATE INDEX IF NOT EXISTS topic_model_generation_invocation_attempts_unresolved_idx
  ON app.topic_model_generation_invocation_attempts(topic_model_generation_run_id, ordinal)
  WHERE status IN ('reserved','outcome_unknown');

CREATE OR REPLACE FUNCTION app.enforce_topic_model_generation_invocation_attempt_transition()
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
      RAISE EXCEPTION 'Topic Model invocation attempt must begin as a reservation'
        USING ERRCODE = '23514';
    END IF;
    PERFORM 1
    FROM app.async_runs run
    JOIN app.topic_model_generation_runs generation_run ON generation_run.id = run.id
    WHERE run.id = NEW.topic_model_generation_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'topic_model_generation'
      AND run.status = 'running'
      AND run.attempt_count = NEW.async_attempt_count
      AND generation_run.workspace_id = NEW.workspace_id
      AND generation_run.project_id = NEW.project_id
      AND generation_run.prompt_set_version = NEW.prompt_set_version
      AND generation_run.prompt_input_hash = NEW.input_hash
    FOR UPDATE OF run, generation_run;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Topic Model invocation reservation scope or delivery is stale'
        USING ERRCODE = '23514';
    END IF;

    SELECT coalesce(max(attempt.ordinal), 0)::integer + 1
    INTO expected_ordinal
    FROM app.topic_model_generation_invocation_attempts attempt
    WHERE attempt.topic_model_generation_run_id = NEW.topic_model_generation_run_id;
    IF expected_ordinal > 3 OR NEW.ordinal IS DISTINCT FROM expected_ordinal THEN
      RAISE EXCEPTION 'Topic Model invocation ordinal must be allocated sequentially by the database'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Topic Model invocation attempts are append-only'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.topic_model_generation_run_id IS DISTINCT FROM OLD.topic_model_generation_run_id
     OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
     OR NEW.async_attempt_count IS DISTINCT FROM OLD.async_attempt_count
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.planned_analysis_invocation_id IS DISTINCT FROM OLD.planned_analysis_invocation_id
     OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at THEN
    RAISE EXCEPTION 'Topic Model invocation reservation identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'terminal Topic Model invocation attempt is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status NOT IN ('succeeded','failed','rejected','outcome_unknown') THEN
    RAISE EXCEPTION 'Topic Model invocation reservation must transition once to terminal'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('succeeded','failed','rejected') AND NOT EXISTS (
    SELECT 1
    FROM app.analysis_invocations invocation
    WHERE invocation.id = NEW.planned_analysis_invocation_id
      AND invocation.id = NEW.analysis_invocation_id
      AND invocation.workspace_id = NEW.workspace_id
      AND invocation.project_id = NEW.project_id
      AND invocation.async_run_id = NEW.topic_model_generation_run_id
      AND invocation.diagnostic_run_id IS NULL
      AND invocation.task = 'topic_model_generation'
      AND invocation.provider = NEW.provider
      AND invocation.model = NEW.model
      AND invocation.prompt_set_version = NEW.prompt_set_version
      AND invocation.input_hash = NEW.input_hash
      AND invocation.status = NEW.status
      AND invocation.error_code IS NOT DISTINCT FROM NEW.terminal_error_code
  ) THEN
    RAISE EXCEPTION 'terminal Topic Model invocation does not match its analysis ledger'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS topic_model_generation_invocation_attempts_transition_guard
  ON app.topic_model_generation_invocation_attempts;
CREATE TRIGGER topic_model_generation_invocation_attempts_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.topic_model_generation_invocation_attempts
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_topic_model_generation_invocation_attempt_transition();

CREATE OR REPLACE FUNCTION app.reserve_topic_model_generation_invocation_attempt(
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
  generation_run app.topic_model_generation_runs%ROWTYPE;
  existing_attempt app.topic_model_generation_invocation_attempts%ROWTYPE;
  unresolved_attempt app.topic_model_generation_invocation_attempts%ROWTYPE;
  reserved_attempt app.topic_model_generation_invocation_attempts%ROWTYPE;
  invocation_count integer;
  next_ordinal integer;
BEGIN
  SELECT generation.*
  INTO generation_run
  FROM app.async_runs run
  JOIN app.topic_model_generation_runs generation ON generation.id = run.id
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'topic_model_generation'
    AND run.status = 'running'
    AND run.attempt_count = p_async_attempt_count
    AND generation.workspace_id = p_workspace_id
    AND generation.project_id = p_project_id
  FOR UPDATE OF run, generation;

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
     OR p_prompt_set_version IS DISTINCT FROM generation_run.prompt_set_version
     OR p_input_hash IS NULL
     OR p_input_hash !~ '^[a-f0-9]{64}$'
     OR (generation_run.prompt_input_hash IS NOT NULL
       AND generation_run.prompt_input_hash IS DISTINCT FROM p_input_hash) THEN
    RETURN jsonb_build_object('kind', 'configuration_mismatch');
  END IF;

  SELECT attempt.*
  INTO existing_attempt
  FROM app.topic_model_generation_invocation_attempts attempt
  WHERE attempt.topic_model_generation_run_id = p_run_id
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
  FROM app.topic_model_generation_invocation_attempts attempt
  WHERE attempt.topic_model_generation_run_id = p_run_id
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
  FROM app.topic_model_generation_invocation_attempts attempt
  WHERE attempt.topic_model_generation_run_id = p_run_id;

  IF invocation_count >= 3 OR next_ordinal > 3 THEN
    RETURN jsonb_build_object('kind', 'budget_exhausted');
  END IF;

  IF generation_run.prompt_input_hash IS NULL THEN
    UPDATE app.topic_model_generation_runs
    SET prompt_input_hash = p_input_hash
    WHERE id = p_run_id
      AND workspace_id = p_workspace_id
      AND project_id = p_project_id
      AND prompt_input_hash IS NULL;
  END IF;

  INSERT INTO app.topic_model_generation_invocation_attempts (
    workspace_id,
    project_id,
    topic_model_generation_run_id,
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

CREATE OR REPLACE FUNCTION app.finalize_topic_model_generation_invocation_attempt(
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
  reservation app.topic_model_generation_invocation_attempts%ROWTYPE;
  normalized_cost numeric(12,6);
BEGIN
  PERFORM 1
  FROM app.async_runs run
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'topic_model_generation'
    AND run.status = 'running'
    AND run.attempt_count = p_async_attempt_count
  FOR UPDATE OF run;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_reservation');
  END IF;

  SELECT attempt.*
  INTO reservation
  FROM app.topic_model_generation_invocation_attempts attempt
  WHERE attempt.id = p_reservation_id
    AND attempt.workspace_id = p_workspace_id
    AND attempt.project_id = p_project_id
    AND attempt.topic_model_generation_run_id = p_run_id
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
        AND invocation.task = 'topic_model_generation'
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
       FROM app.topic_model_generation_runs generation_run
       WHERE generation_run.id = p_run_id
         AND generation_run.workspace_id = p_workspace_id
         AND generation_run.project_id = p_project_id
         AND generation_run.prompt_input_hash = reservation.input_hash
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
    'topic_model_generation',
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

  UPDATE app.topic_model_generation_invocation_attempts
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

CREATE OR REPLACE FUNCTION app.mark_topic_model_generation_invocation_outcome_unknown(
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
  reservation app.topic_model_generation_invocation_attempts%ROWTYPE;
BEGIN
  PERFORM 1
  FROM app.async_runs run
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'topic_model_generation'
    AND run.status = 'running'
    AND run.attempt_count = p_async_attempt_count
  FOR UPDATE OF run;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_reservation');
  END IF;

  SELECT attempt.*
  INTO reservation
  FROM app.topic_model_generation_invocation_attempts attempt
  WHERE attempt.id = p_reservation_id
    AND attempt.workspace_id = p_workspace_id
    AND attempt.project_id = p_project_id
    AND attempt.topic_model_generation_run_id = p_run_id
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

  UPDATE app.topic_model_generation_invocation_attempts
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

-- A manual or migration-confirmed model retains its human/server actor. Only
-- the exact initial LLM generation basis may be actorless; the mutation trigger
-- below additionally proves the successful invocation and generation run.
ALTER TABLE app.topic_model_revisions
  DROP CONSTRAINT IF EXISTS topic_model_revisions_state_check;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT constraint_def.conname
    FROM pg_constraint constraint_def
    WHERE constraint_def.conrelid =
        'app.topic_model_revisions'::regclass
      AND constraint_def.contype = 'c'
      AND position(
        'status = ''draft'''
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
      AND position(
        'confirmed_by'
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
  LOOP
    EXECUTE format(
      'ALTER TABLE app.topic_model_revisions DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE app.topic_model_revisions
  ADD CONSTRAINT topic_model_revisions_state_check CHECK (
    (
      status = 'draft'
      AND confirmed_by IS NULL
      AND confirmed_at IS NULL
      AND content_hash IS NULL
    )
    OR (
      status = 'confirmed'
      AND confirmed_at IS NOT NULL
      AND confirmed_at >= created_at
      AND content_hash IS NOT NULL
      AND (
        (
          confirmed_by IS NOT NULL
          AND generation_basis ->> 'origin' IS DISTINCT FROM
            'llm_auto_confirmed'
        )
        OR (
          confirmed_by IS NULL
          AND revision = 1
          AND generation_basis ?& ARRAY[
            'origin',
            'generationVersion',
            'baseTopicModelRevision',
            'analysisInvocationId',
            'promptSetVersion',
            'inputHash',
            'keywordGroupCount',
            'keywordCount',
            'reason'
          ]::text[]
          AND generation_basis - ARRAY[
            'origin',
            'generationVersion',
            'baseTopicModelRevision',
            'analysisInvocationId',
            'promptSetVersion',
            'inputHash',
            'keywordGroupCount',
            'keywordCount',
            'reason'
          ]::text[] = '{}'::jsonb
          AND generation_basis ->> 'origin' = 'llm_auto_confirmed'
          AND jsonb_typeof(
            generation_basis -> 'baseTopicModelRevision'
          ) = 'null'
          AND jsonb_typeof(
            generation_basis -> 'generationVersion'
          ) = 'string'
          AND length(
            generation_basis ->> 'generationVersion'
          ) BETWEEN 1 AND 200
          AND generation_basis ->> 'generationVersion' = btrim(
            generation_basis ->> 'generationVersion'
          )
          AND jsonb_typeof(
            generation_basis -> 'analysisInvocationId'
          ) = 'string'
          AND generation_basis ->> 'analysisInvocationId' ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND jsonb_typeof(
            generation_basis -> 'promptSetVersion'
          ) = 'string'
          AND length(
            generation_basis ->> 'promptSetVersion'
          ) BETWEEN 1 AND 200
          AND generation_basis ->> 'promptSetVersion' = btrim(
            generation_basis ->> 'promptSetVersion'
          )
          AND jsonb_typeof(generation_basis -> 'inputHash') = 'string'
          AND generation_basis ->> 'inputHash' ~ '^[a-f0-9]{64}$'
          AND jsonb_typeof(
            generation_basis -> 'keywordGroupCount'
          ) = 'number'
          AND generation_basis ->> 'keywordGroupCount' ~
            '^(0|[1-9][0-9]{0,8})$'
          AND jsonb_typeof(
            generation_basis -> 'keywordCount'
          ) = 'number'
          AND generation_basis ->> 'keywordCount' ~
            '^(0|[1-9][0-9]{0,8})$'
          AND jsonb_typeof(generation_basis -> 'reason') = 'string'
          AND length(generation_basis ->> 'reason') BETWEEN 3 AND 4000
          AND generation_basis ->> 'reason' = btrim(
            generation_basis ->> 'reason'
          )
        )
      )
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION app.enforce_topic_model_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  auto_confirmation boolean;
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

  auto_confirmation :=
    NEW.revision = 1
    AND NEW.generation_basis ?& ARRAY[
      'origin',
      'generationVersion',
      'baseTopicModelRevision',
      'analysisInvocationId',
      'promptSetVersion',
      'inputHash',
      'keywordGroupCount',
      'keywordCount',
      'reason'
    ]::text[]
    AND NEW.generation_basis - ARRAY[
      'origin',
      'generationVersion',
      'baseTopicModelRevision',
      'analysisInvocationId',
      'promptSetVersion',
      'inputHash',
      'keywordGroupCount',
      'keywordCount',
      'reason'
    ]::text[] = '{}'::jsonb
    AND NEW.generation_basis ->> 'origin' = 'llm_auto_confirmed'
    AND jsonb_typeof(
      NEW.generation_basis -> 'baseTopicModelRevision'
    ) = 'null'
    AND jsonb_typeof(NEW.generation_basis -> 'generationVersion') =
      'string'
    AND length(
      NEW.generation_basis ->> 'generationVersion'
    ) BETWEEN 1 AND 200
    AND NEW.generation_basis ->> 'generationVersion' = btrim(
      NEW.generation_basis ->> 'generationVersion'
    )
    AND jsonb_typeof(
      NEW.generation_basis -> 'analysisInvocationId'
    ) = 'string'
    AND NEW.generation_basis ->> 'analysisInvocationId' ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND jsonb_typeof(NEW.generation_basis -> 'promptSetVersion') =
      'string'
    AND length(
      NEW.generation_basis ->> 'promptSetVersion'
    ) BETWEEN 1 AND 200
    AND NEW.generation_basis ->> 'promptSetVersion' = btrim(
      NEW.generation_basis ->> 'promptSetVersion'
    )
    AND jsonb_typeof(NEW.generation_basis -> 'inputHash') = 'string'
    AND NEW.generation_basis ->> 'inputHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(NEW.generation_basis -> 'keywordGroupCount') =
      'number'
    AND NEW.generation_basis ->> 'keywordGroupCount' ~
      '^(0|[1-9][0-9]{0,8})$'
    AND jsonb_typeof(NEW.generation_basis -> 'keywordCount') = 'number'
    AND NEW.generation_basis ->> 'keywordCount' ~
      '^(0|[1-9][0-9]{0,8})$'
    AND jsonb_typeof(NEW.generation_basis -> 'reason') = 'string'
    AND length(NEW.generation_basis ->> 'reason') BETWEEN 3 AND 4000
    AND NEW.generation_basis ->> 'reason' = btrim(
      NEW.generation_basis ->> 'reason'
    );

  IF NEW.status = 'confirmed'
     AND NEW.root_topic_node_id IS NOT DISTINCT FROM
       OLD.root_topic_node_id
     AND NEW.generation_basis IS NOT DISTINCT FROM OLD.generation_basis
     AND NEW.evidence_refs IS NOT DISTINCT FROM OLD.evidence_refs
     AND NEW.edit_revision IS NOT DISTINCT FROM OLD.edit_revision
     AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at
     AND NEW.confirmed_at IS NOT NULL
     AND NEW.content_hash IS NOT NULL THEN
    IF auto_confirmation THEN
      IF NEW.confirmed_by IS NOT NULL OR NOT EXISTS (
        SELECT 1
        FROM app.analysis_invocations invocation
        JOIN app.topic_model_generation_invocation_attempts attempt
          ON attempt.analysis_invocation_id = invocation.id
         AND attempt.planned_analysis_invocation_id = invocation.id
         AND attempt.status = 'succeeded'
         AND attempt.workspace_id = NEW.workspace_id
         AND attempt.project_id = NEW.project_id
        JOIN app.topic_model_generation_runs generation
          ON generation.id = invocation.async_run_id
         AND generation.id = attempt.topic_model_generation_run_id
         AND generation.workspace_id = NEW.workspace_id
         AND generation.project_id = NEW.project_id
         AND generation.result_topic_model_revision_id IS NULL
         AND generation.generation_version =
           NEW.generation_basis ->> 'generationVersion'
         AND generation.prompt_set_version =
           NEW.generation_basis ->> 'promptSetVersion'
         AND generation.input_hash =
           NEW.generation_basis ->> 'inputHash'
         AND generation.prompt_input_hash = invocation.input_hash
        JOIN app.async_runs run
          ON run.id = generation.id
         AND run.workspace_id = NEW.workspace_id
         AND run.project_id = NEW.project_id
         AND run.kind = 'topic_model_generation'
         AND run.status = 'running'
         AND run.result_type = 'topic_model_generation_run'
         AND run.result_id = run.id
        WHERE invocation.id::text =
            NEW.generation_basis ->> 'analysisInvocationId'
          AND invocation.workspace_id = NEW.workspace_id
          AND invocation.project_id = NEW.project_id
          AND invocation.diagnostic_run_id IS NULL
          AND invocation.task = 'topic_model_generation'
          AND invocation.status = 'succeeded'
          AND invocation.output_hash IS NOT NULL
          AND invocation.error_code IS NULL
      ) THEN
        RAISE EXCEPTION
          'actorless Topic Model confirmation lacks successful generation lineage'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.confirmed_by IS NULL
       OR NEW.generation_basis ->> 'origin' = 'llm_auto_confirmed' THEN
      RAISE EXCEPTION
        'manual Topic Model confirmation requires a human actor'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Topic Model confirmation may only freeze the draft'
    USING ERRCODE = '23514';
END;
$$;

-- Terminalize the typed result and AsyncRun lifecycle in one fenced statement.
-- Replaying the exact terminal request is idempotent; every other terminal
-- replay is a conflict and a stale delivery cannot mutate either ledger.
CREATE OR REPLACE FUNCTION app.terminalize_topic_model_generation_run(
  p_workspace_id uuid,
  p_project_id uuid,
  p_run_id uuid,
  p_async_attempt_count integer,
  p_status text,
  p_result_topic_model_revision_id uuid,
  p_last_error_code text,
  p_last_error_summary text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  generation_run app.topic_model_generation_runs%ROWTYPE;
  async_run app.async_runs%ROWTYPE;
BEGIN
  SELECT run.*
  INTO async_run
  FROM app.async_runs run
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'topic_model_generation'
    AND run.result_type = 'topic_model_generation_run'
    AND run.result_id = run.id
  FOR UPDATE;

  IF NOT FOUND OR async_run.attempt_count IS DISTINCT FROM
      p_async_attempt_count THEN
    RETURN jsonb_build_object('kind', 'stale');
  END IF;

  SELECT generation.*
  INTO generation_run
  FROM app.topic_model_generation_runs generation
  WHERE generation.id = p_run_id
    AND generation.workspace_id = p_workspace_id
    AND generation.project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale');
  END IF;

  IF async_run.status IN ('completed','failed','cancelled','partial') THEN
    IF async_run.status = p_status
       AND async_run.result_type = 'topic_model_generation_run'
       AND async_run.result_id = p_run_id
       AND (
         (
           p_status = 'completed'
           AND p_result_topic_model_revision_id IS NOT NULL
           AND generation_run.result_topic_model_revision_id =
             p_result_topic_model_revision_id
           AND p_last_error_code IS NULL
           AND p_last_error_summary IS NULL
           AND async_run.last_error_code IS NULL
           AND async_run.last_error_summary IS NULL
         )
         OR (
           p_status IN ('failed','cancelled')
           AND p_result_topic_model_revision_id IS NULL
           AND generation_run.result_topic_model_revision_id IS NULL
           AND async_run.last_error_code = p_last_error_code
           AND async_run.last_error_summary = p_last_error_summary
         )
       ) THEN
      RETURN jsonb_build_object(
        'kind', 'terminalized',
        'run', to_jsonb(generation_run)
      );
    END IF;
    RETURN jsonb_build_object(
      'kind', 'conflict',
      'run', to_jsonb(generation_run)
    );
  END IF;

  IF async_run.status IS DISTINCT FROM 'running' THEN
    RETURN jsonb_build_object('kind', 'stale');
  END IF;

  IF p_status IS NULL
     OR p_status NOT IN ('completed','failed','cancelled')
     OR (
       p_status = 'completed'
       AND (
         p_result_topic_model_revision_id IS NULL
         OR p_last_error_code IS NOT NULL
         OR p_last_error_summary IS NOT NULL
         OR (
           generation_run.result_topic_model_revision_id IS NOT NULL
           AND generation_run.result_topic_model_revision_id IS DISTINCT FROM
             p_result_topic_model_revision_id
         )
       )
     )
     OR (
       p_status IN ('failed','cancelled')
       AND (
         p_result_topic_model_revision_id IS NOT NULL
         OR generation_run.result_topic_model_revision_id IS NOT NULL
         OR p_last_error_code IS NULL
         OR p_last_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
         OR p_last_error_summary IS NULL
         OR length(p_last_error_summary) NOT BETWEEN 1 AND 2000
         OR p_last_error_summary IS DISTINCT FROM
           btrim(p_last_error_summary)
       )
     ) THEN
    RETURN jsonb_build_object(
      'kind', 'conflict',
      'run', to_jsonb(generation_run)
    );
  END IF;

  IF p_status = 'completed' THEN
    UPDATE app.topic_model_generation_runs
    SET result_topic_model_revision_id = p_result_topic_model_revision_id
    WHERE id = p_run_id
      AND workspace_id = p_workspace_id
      AND project_id = p_project_id
      AND (
        result_topic_model_revision_id IS NULL
        OR result_topic_model_revision_id =
          p_result_topic_model_revision_id
      )
    RETURNING * INTO generation_run;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'kind', 'conflict',
        'run', NULL
      );
    END IF;
  END IF;

  UPDATE app.async_runs
  SET status = p_status,
      completed_at = clock_timestamp(),
      last_error_code = p_last_error_code,
      last_error_summary = p_last_error_summary
  WHERE id = p_run_id
    AND workspace_id = p_workspace_id
    AND project_id = p_project_id
    AND kind = 'topic_model_generation'
    AND status = 'running'
    AND attempt_count = p_async_attempt_count
    AND result_type = 'topic_model_generation_run'
    AND result_id = id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Topic Model generation delivery changed while locked'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'kind', 'terminalized',
    'run', to_jsonb(generation_run)
  );
END;
$$;

-- A non-null invocation pointer is the typed marker for an LLM fallback.
-- Existing deterministic suggestions, provider facts, and user decisions keep
-- the pointer null; a generated fallback must be a canonical system decision.
ALTER TABLE app.keyword_review_decisions
  ADD COLUMN IF NOT EXISTS analysis_invocation_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_def
    WHERE constraint_def.conrelid =
        'app.keyword_review_decisions'::regclass
      AND constraint_def.conname =
        'keyword_review_decisions_analysis_invocation_fk'
  ) THEN
    ALTER TABLE app.keyword_review_decisions
      ADD CONSTRAINT keyword_review_decisions_analysis_invocation_fk
      FOREIGN KEY (analysis_invocation_id)
      REFERENCES app.analysis_invocations(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE app.keyword_review_decisions
  DROP CONSTRAINT IF EXISTS
    keyword_review_decisions_analysis_invocation_shape_check;
ALTER TABLE app.keyword_review_decisions
  ADD CONSTRAINT
    keyword_review_decisions_analysis_invocation_shape_check CHECK (
      analysis_invocation_id IS NULL
      OR (
        decision_origin = 'system_suggestion'
        AND status = 'approved'
        AND intent IN (
          'informational',
          'navigational',
          'commercial',
          'transactional'
        )
        AND topic_node_id IS NOT NULL
        AND topic_model_revision IS NOT NULL
        AND review_state = 'confirmed'
        AND assignment_invalidated_by IS NULL
        AND decided_by IS NULL
      )
    ) NOT VALID;

CREATE OR REPLACE FUNCTION
  app.enforce_keyword_review_analysis_invocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.analysis_invocation_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Leave referential absence to the FK so callers receive the canonical
  -- foreign-key violation. Existing but mismatched invocations are rejected
  -- below with the capability-specific lineage constraint.
  IF NOT EXISTS (
    SELECT 1
    FROM app.analysis_invocations invocation
    WHERE invocation.id = NEW.analysis_invocation_id
  ) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.analysis_invocations invocation
    JOIN app.topic_model_generation_invocation_attempts attempt
      ON attempt.analysis_invocation_id = invocation.id
     AND attempt.planned_analysis_invocation_id = invocation.id
     AND attempt.status = 'succeeded'
     AND attempt.workspace_id = NEW.workspace_id
     AND attempt.project_id = NEW.project_id
    JOIN app.topic_model_generation_runs generation
      ON generation.id = invocation.async_run_id
     AND generation.id = attempt.topic_model_generation_run_id
     AND generation.workspace_id = NEW.workspace_id
     AND generation.project_id = NEW.project_id
     AND generation.prompt_input_hash = invocation.input_hash
     AND generation.prompt_set_version = invocation.prompt_set_version
    JOIN app.topic_model_revisions model
      ON model.workspace_id = NEW.workspace_id
     AND model.project_id = NEW.project_id
     AND model.revision = NEW.topic_model_revision
     AND model.status = 'confirmed'
     AND model.generation_basis ->> 'origin' = 'llm_auto_confirmed'
     AND model.generation_basis ->> 'analysisInvocationId' =
       invocation.id::text
     AND model.generation_basis ->> 'generationVersion' =
       generation.generation_version
     AND model.generation_basis ->> 'promptSetVersion' =
       generation.prompt_set_version
     AND model.generation_basis ->> 'inputHash' = generation.input_hash
     AND (
       generation.result_topic_model_revision_id IS NULL
       OR generation.result_topic_model_revision_id = model.id
     )
    WHERE invocation.id = NEW.analysis_invocation_id
      AND invocation.workspace_id = NEW.workspace_id
      AND invocation.project_id = NEW.project_id
      AND invocation.diagnostic_run_id IS NULL
      AND invocation.task = 'topic_model_generation'
      AND invocation.status = 'succeeded'
      AND invocation.output_hash IS NOT NULL
      AND invocation.error_code IS NULL
  ) THEN
    RAISE EXCEPTION
      'generated Keyword intent lacks matching successful Topic invocation'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_review_decisions_analysis_invocation_guard
  ON app.keyword_review_decisions;
CREATE TRIGGER keyword_review_decisions_analysis_invocation_guard
  BEFORE INSERT ON app.keyword_review_decisions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_keyword_review_analysis_invocation();

-- Analysis Refresh v3 adds one optional Topic generation step while preserving
-- the exact immutable v1 and v2 manifests for historical readers.
ALTER TABLE app.analysis_refresh_runs
  DROP CONSTRAINT IF EXISTS analysis_refresh_runs_plan_manifest_check,
  DROP CONSTRAINT IF EXISTS analysis_refresh_runs_plan_hash_check,
  DROP CONSTRAINT IF EXISTS analysis_refresh_runs_plan_contract_check;
ALTER TABLE app.analysis_refresh_runs
  ADD CONSTRAINT analysis_refresh_runs_plan_contract_check CHECK (
    (
      plan_manifest = jsonb_build_object(
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
      AND plan_hash =
        'd725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af'
    )
    OR (
      plan_manifest = jsonb_build_object(
        'version', 'analysis-refresh.plan.v2',
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
            'stepKey', 'dataforseo_backlinks',
            'required', false
          ),
          jsonb_build_object(
            'ordinal', 6,
            'stepKey', 'growth_audit',
            'required', true
          )
        )
      )
      AND plan_hash =
        '3049a718f77263f766e47d0d7318a9414520d07c8ab92960f50c85b864977c65'
    )
    OR (
      plan_manifest = jsonb_build_object(
        'version', 'analysis-refresh.plan.v3',
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
            'stepKey', 'dataforseo_backlinks',
            'required', false
          ),
          jsonb_build_object(
            'ordinal', 6,
            'stepKey', 'topic_model',
            'required', false
          ),
          jsonb_build_object(
            'ordinal', 7,
            'stepKey', 'growth_audit',
            'required', true
          )
        )
      )
      AND plan_hash =
        'fc527bb7203d61ce126625a0b2bb4bffb59fe5999d9f6b78e5aa05409918368b'
    )
  ) NOT VALID;

-- The historical state-shape CHECK was anonymous. Drop only the constraint
-- whose definition owns the state/result matrix, leaving the column enum and
-- unrelated checks untouched.
ALTER TABLE app.analysis_refresh_steps
  DROP CONSTRAINT IF EXISTS analysis_refresh_steps_ordinal_check,
  DROP CONSTRAINT IF EXISTS analysis_refresh_steps_step_key_check,
  DROP CONSTRAINT IF EXISTS analysis_refresh_steps_plan_position_check,
  DROP CONSTRAINT IF EXISTS analysis_refresh_steps_state_shape_check;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT constraint_def.conname
    FROM pg_constraint constraint_def
    WHERE constraint_def.conrelid =
        'app.analysis_refresh_steps'::regclass
      AND constraint_def.contype = 'c'
      AND position(
        'state = ''pending'''
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
      AND position(
        'result_snapshot_id'
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
  LOOP
    EXECUTE format(
      'ALTER TABLE app.analysis_refresh_steps DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE app.analysis_refresh_steps
  ADD CONSTRAINT analysis_refresh_steps_ordinal_check CHECK (
    ordinal BETWEEN 1 AND 7
  ) NOT VALID,
  ADD CONSTRAINT analysis_refresh_steps_step_key_check CHECK (
    step_key IN (
      'crawl',
      'gsc',
      'ga4',
      'dataforseo',
      'dataforseo_backlinks',
      'topic_model',
      'growth_audit'
    )
  ) NOT VALID,
  ADD CONSTRAINT analysis_refresh_steps_plan_position_check CHECK (
    (ordinal = 1 AND step_key = 'crawl' AND required)
    OR (ordinal = 2 AND step_key = 'gsc' AND NOT required)
    OR (ordinal = 3 AND step_key = 'ga4' AND NOT required)
    OR (ordinal = 4 AND step_key = 'dataforseo' AND NOT required)
    OR (ordinal = 5 AND step_key = 'dataforseo_backlinks' AND NOT required)
    OR (ordinal = 5 AND step_key = 'growth_audit' AND required)
    OR (ordinal = 6 AND step_key = 'topic_model' AND NOT required)
    OR (ordinal = 6 AND step_key = 'growth_audit' AND required)
    OR (ordinal = 7 AND step_key = 'growth_audit' AND required)
  ) NOT VALID,
  ADD CONSTRAINT analysis_refresh_steps_state_shape_check CHECK (
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
        (
          step_key IN ('growth_audit','topic_model')
          AND result_snapshot_id IS NULL
        )
        OR (
          step_key NOT IN ('growth_audit','topic_model')
          AND result_snapshot_id IS NOT NULL
        )
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
  ) NOT VALID;

-- Select child identity from the frozen parent plan; Topic is never accepted
-- as a collection or diagnostic child.
CREATE OR REPLACE FUNCTION app.enforce_analysis_refresh_step_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_site_id uuid;
  parent_icp_profile_id uuid;
  parent_plan_version text;
  expected_child_kind text;
  expected_provider text;
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

  SELECT
    parent.site_id,
    parent.icp_profile_id,
    parent.plan_manifest ->> 'version'
  INTO parent_site_id, parent_icp_profile_id, parent_plan_version
  FROM app.analysis_refresh_runs parent
  WHERE parent.id = NEW.analysis_refresh_run_id
    AND parent.workspace_id = NEW.workspace_id
    AND parent.project_id = NEW.project_id;

  IF parent_site_id IS NULL THEN
    RAISE EXCEPTION 'analysis refresh step parent scope mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      parent_plan_version = 'analysis-refresh.plan.v1'
      AND (
        (NEW.ordinal = 1 AND NEW.step_key = 'crawl' AND NEW.required)
        OR (
          NEW.ordinal = 2
          AND NEW.step_key = 'gsc'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 3
          AND NEW.step_key = 'ga4'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 4
          AND NEW.step_key = 'dataforseo'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 5
          AND NEW.step_key = 'growth_audit'
          AND NEW.required
        )
      )
    )
    OR (
      parent_plan_version = 'analysis-refresh.plan.v2'
      AND (
        (NEW.ordinal = 1 AND NEW.step_key = 'crawl' AND NEW.required)
        OR (
          NEW.ordinal = 2
          AND NEW.step_key = 'gsc'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 3
          AND NEW.step_key = 'ga4'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 4
          AND NEW.step_key = 'dataforseo'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 5 AND NEW.step_key = 'dataforseo_backlinks' AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 6 AND NEW.step_key = 'growth_audit' AND NEW.required
        )
      )
    )
    OR (
      parent_plan_version = 'analysis-refresh.plan.v3'
      AND (
        (NEW.ordinal = 1 AND NEW.step_key = 'crawl' AND NEW.required)
        OR (
          NEW.ordinal = 2
          AND NEW.step_key = 'gsc'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 3
          AND NEW.step_key = 'ga4'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 4
          AND NEW.step_key = 'dataforseo'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 5
          AND NEW.step_key = 'dataforseo_backlinks'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 6
          AND NEW.step_key = 'topic_model'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 7
          AND NEW.step_key = 'growth_audit'
          AND NEW.required
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'analysis refresh step does not match its frozen parent plan'
      USING ERRCODE = '23514';
  END IF;

  expected_provider := CASE NEW.step_key
    WHEN 'dataforseo_backlinks' THEN 'dataforseo'
    WHEN 'topic_model' THEN NULL
    WHEN 'growth_audit' THEN NULL
    ELSE NEW.step_key
  END;

  IF NEW.child_async_run_id IS NOT NULL THEN
    expected_child_kind := CASE
      WHEN NEW.step_key = 'growth_audit' THEN 'diagnostic'
      WHEN NEW.step_key = 'topic_model' THEN 'topic_model_generation'
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
    ELSIF NEW.step_key = 'topic_model' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM app.topic_model_generation_runs generation
        WHERE generation.id = NEW.child_async_run_id
          AND generation.workspace_id = NEW.workspace_id
          AND generation.project_id = NEW.project_id
          AND generation.analysis_refresh_run_id =
            NEW.analysis_refresh_run_id
      ) THEN
        RAISE EXCEPTION
          'analysis refresh Topic Model child provenance mismatch'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1
      FROM app.collection_runs collection
      WHERE collection.id = NEW.child_async_run_id
        AND collection.workspace_id = NEW.workspace_id
        AND collection.project_id = NEW.project_id
        AND collection.site_id = parent_site_id
        AND collection.provider = expected_provider
        AND (
          NEW.step_key NOT IN ('dataforseo','dataforseo_backlinks')
          OR (
            NEW.step_key = 'dataforseo'
            AND collection.operation = 'search_landscape'
            AND collection.method_version IN (
              'dataforseo.search_landscape.v1',
              'dataforseo.search_landscape.v2',
              'dataforseo.search_landscape.v3'
            )
          )
          OR (
            NEW.step_key = 'dataforseo_backlinks'
            AND
            collection.operation = 'backlinks'
            AND collection.method_version = 'dataforseo.backlinks.v1'
          )
        )
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
      AND snapshot.provider = expected_provider
      AND snapshot.collection_run_id = NEW.child_async_run_id
      AND (
        NEW.step_key NOT IN ('dataforseo','dataforseo_backlinks')
        OR (
          NEW.step_key = 'dataforseo'
          AND snapshot.dataset_key IN (
            'dataforseo.search_landscape.v1',
            'dataforseo.search_landscape.v2',
            'dataforseo.search_landscape.v3'
          )
          AND snapshot.schema_version = snapshot.dataset_key
          AND snapshot.method_version = snapshot.dataset_key
          AND EXISTS (
            SELECT 1
            FROM app.collection_runs collection
            WHERE collection.id = NEW.child_async_run_id
              AND collection.workspace_id = NEW.workspace_id
              AND collection.project_id = NEW.project_id
              AND collection.site_id = parent_site_id
              AND collection.provider = 'dataforseo'
              AND collection.operation = 'search_landscape'
              AND collection.method_version = snapshot.method_version
          )
        )
        OR (
          NEW.step_key = 'dataforseo_backlinks'
          AND
          snapshot.dataset_key = 'dataforseo.backlinks.v1'
          AND snapshot.schema_version = 'dataforseo.backlinks.v1'
          AND snapshot.method_version = 'dataforseo.backlinks.v1'
        )
      )
  ) THEN
    RAISE EXCEPTION 'analysis refresh result Snapshot provenance mismatch'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Validate all exact historical/current contracts through the lower-lock path.
ALTER TABLE app.analysis_refresh_runs
  VALIDATE CONSTRAINT analysis_refresh_runs_plan_contract_check;
ALTER TABLE app.analysis_refresh_steps
  VALIDATE CONSTRAINT analysis_refresh_steps_ordinal_check,
  VALIDATE CONSTRAINT analysis_refresh_steps_step_key_check,
  VALIDATE CONSTRAINT analysis_refresh_steps_plan_position_check,
  VALIDATE CONSTRAINT analysis_refresh_steps_state_shape_check;
ALTER TABLE app.keyword_review_decisions
  VALIDATE CONSTRAINT
    keyword_review_decisions_analysis_invocation_shape_check;
ALTER TABLE app.topic_model_revisions
  VALIDATE CONSTRAINT topic_model_revisions_state_check;

-- Internal ledgers and mutators are never browser-facing. PUBLIC is revoked so
-- future grants cannot accidentally inherit execution; Supabase roles are
-- revoked conditionally for disposable/local PostgreSQL installations too.
REVOKE ALL ON app.topic_model_generation_runs FROM PUBLIC;
REVOKE ALL ON app.topic_model_generation_invocation_attempts FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.reserve_topic_model_generation_invocation_attempt(
    uuid, uuid, uuid, integer, text, text, text, text
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.finalize_topic_model_generation_invocation_attempt(
    uuid, uuid, uuid, integer, uuid, text, text, text, text, text,
    text, integer, integer, numeric, integer, text
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.mark_topic_model_generation_invocation_outcome_unknown(
    uuid, uuid, uuid, integer, uuid, text
  )
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.terminalize_topic_model_generation_run(
    uuid, uuid, uuid, integer, text, uuid, text, text
  )
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE
      'REVOKE ALL ON app.topic_model_generation_runs FROM anon';
    EXECUTE
      'REVOKE ALL ON app.topic_model_generation_invocation_attempts FROM anon';
    EXECUTE
      'REVOKE ALL ON FUNCTION app.reserve_topic_model_generation_invocation_attempt(uuid, uuid, uuid, integer, text, text, text, text) FROM anon';
    EXECUTE
      'REVOKE ALL ON FUNCTION app.finalize_topic_model_generation_invocation_attempt(uuid, uuid, uuid, integer, uuid, text, text, text, text, text, text, integer, integer, numeric, integer, text) FROM anon';
    EXECUTE
      'REVOKE ALL ON FUNCTION app.mark_topic_model_generation_invocation_outcome_unknown(uuid, uuid, uuid, integer, uuid, text) FROM anon';
    EXECUTE
      'REVOKE ALL ON FUNCTION app.terminalize_topic_model_generation_run(uuid, uuid, uuid, integer, text, uuid, text, text) FROM anon';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  ) THEN
    EXECUTE
      'REVOKE ALL ON app.topic_model_generation_runs FROM authenticated';
    EXECUTE
      'REVOKE ALL ON app.topic_model_generation_invocation_attempts FROM authenticated';
    EXECUTE
      'REVOKE ALL ON FUNCTION app.reserve_topic_model_generation_invocation_attempt(uuid, uuid, uuid, integer, text, text, text, text) FROM authenticated';
    EXECUTE
      'REVOKE ALL ON FUNCTION app.finalize_topic_model_generation_invocation_attempt(uuid, uuid, uuid, integer, uuid, text, text, text, text, text, text, integer, integer, numeric, integer, text) FROM authenticated';
    EXECUTE
      'REVOKE ALL ON FUNCTION app.mark_topic_model_generation_invocation_outcome_unknown(uuid, uuid, uuid, integer, uuid, text) FROM authenticated';
    EXECUTE
      'REVOKE ALL ON FUNCTION app.terminalize_topic_model_generation_run(uuid, uuid, uuid, integer, text, uuid, text, text) FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0048_topic_model_generation'::text AS migration_version;

COMMIT;
