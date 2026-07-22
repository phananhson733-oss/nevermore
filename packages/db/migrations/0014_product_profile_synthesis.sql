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
