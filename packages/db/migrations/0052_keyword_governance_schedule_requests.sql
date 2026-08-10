BEGIN;

SET LOCAL lock_timeout = '5s';

-- Durable, payload-free scheduling outbox. Source commits append one exact
-- identity in their own transaction; dispatchers only exchange fixed codes and
-- database-owned lease tokens. The generated key is the canonical replay key.
CREATE TABLE IF NOT EXISTS app.keyword_governance_schedule_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  source_kind text NOT NULL,
  source_ref text NOT NULL,
  initiated_by uuid NOT NULL,
  dispatch_key text GENERATED ALWAYS AS (
    'keyword-governance-schedule.v1:'
      || workspace_id::text || ':' || project_id::text || ':'
      || source_kind || ':' || source_ref
  ) STORED NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  last_error_code text,
  CONSTRAINT keyword_governance_schedule_requests_project_scope_fk
    FOREIGN KEY (workspace_id, project_id)
    REFERENCES app.client_projects(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT keyword_governance_schedule_requests_dispatch_key_uk
    UNIQUE (dispatch_key),
  CONSTRAINT keyword_governance_schedule_requests_source_kind_ck CHECK (
    source_kind IN (
      'analysis_refresh',
      'csv_keyword_gap_import',
      'topic_model_confirmation_system',
      'topic_model_confirmation_manual',
      'generation_continuation'
    )
  ),
  CONSTRAINT keyword_governance_schedule_requests_source_ref_ck CHECK (
    length(source_ref) BETWEEN 1 AND 500
    AND source_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  ),
  CONSTRAINT keyword_governance_schedule_requests_attempt_count_ck CHECK (
    attempt_count BETWEEN 0 AND 2147483647
  ),
  CONSTRAINT keyword_governance_schedule_requests_error_code_ck CHECK (
    last_error_code IS NULL OR last_error_code =
      'KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED'
  ),
  CONSTRAINT keyword_governance_schedule_requests_claim_shape_ck CHECK (
    (
      claim_token IS NULL
      AND claimed_at IS NULL
      AND claim_expires_at IS NULL
      AND completed_at IS NULL
    ) OR (
      claim_token IS NOT NULL
      AND claimed_at IS NOT NULL
      AND claim_expires_at IS NOT NULL
      AND claim_expires_at > claimed_at
      AND last_error_code IS NULL
    )
  ),
  CONSTRAINT keyword_governance_schedule_requests_completion_shape_ck CHECK (
    completed_at IS NULL OR (
      claim_token IS NOT NULL
      AND claimed_at IS NOT NULL
      AND claim_expires_at IS NOT NULL
      AND completed_at >= claimed_at
      AND last_error_code IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS
  keyword_governance_schedule_requests_due_idx
  ON app.keyword_governance_schedule_requests(
    next_attempt_at,
    requested_at,
    id
  )
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS
  keyword_governance_schedule_requests_source_idx
  ON app.keyword_governance_schedule_requests(
    workspace_id,
    project_id,
    source_kind,
    source_ref
  );

-- Immutable request identity plus three legal transitions: claim/reclaim,
-- release, and completion. This rejects ad-hoc lifecycle mutation even for a
-- caller that bypasses the repository functions.
CREATE OR REPLACE FUNCTION
  app.enforce_keyword_governance_schedule_request_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Keyword governance schedule requests are durable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_immutable_ck';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.attempt_count <> 0
       OR NEW.claim_token IS NOT NULL
       OR NEW.claimed_at IS NOT NULL
       OR NEW.claim_expires_at IS NOT NULL
       OR NEW.completed_at IS NOT NULL
       OR NEW.last_error_code IS NOT NULL THEN
      RAISE EXCEPTION 'Keyword governance schedule request must begin unclaimed'
        USING ERRCODE = '23514',
          CONSTRAINT = 'keyword_governance_schedule_requests_initial_state_ck';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'Keyword governance schedule request identity is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_immutable_ck';
  END IF;

  IF OLD.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Completed Keyword governance schedule request is immutable'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_terminal_ck';
  END IF;

  -- A claim replaces an absent or expired lease and increments exactly once.
  IF NEW.claim_token IS NOT NULL
     AND NEW.completed_at IS NULL
     AND NEW.last_error_code IS NULL
     AND NEW.claim_token IS DISTINCT FROM OLD.claim_token
     AND NEW.claimed_at IS NOT NULL
     AND NEW.claim_expires_at > NEW.claimed_at
     AND NEW.attempt_count = OLD.attempt_count + 1
     AND NEW.next_attempt_at IS NOT DISTINCT FROM OLD.next_attempt_at
     AND (
       OLD.claim_token IS NULL
       OR OLD.claim_expires_at <= NEW.claimed_at
     ) THEN
    RETURN NEW;
  END IF;

  -- Completion preserves the exact live lease as its durable receipt.
  IF OLD.claim_token IS NOT NULL
     AND NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token
     AND NEW.claimed_at IS NOT DISTINCT FROM OLD.claimed_at
     AND NEW.claim_expires_at IS NOT DISTINCT FROM OLD.claim_expires_at
     AND NEW.attempt_count = OLD.attempt_count
     AND NEW.next_attempt_at IS NOT DISTINCT FROM OLD.next_attempt_at
     AND NEW.completed_at IS NOT NULL
     AND NEW.completed_at >= NEW.claimed_at
     AND NEW.completed_at < NEW.claim_expires_at
     AND NEW.last_error_code IS NULL THEN
    RETURN NEW;
  END IF;

  -- Release clears the lease, records only the fixed public-safe code, and
  -- moves the request to a database-owned retry instant.
  IF OLD.claim_token IS NOT NULL
     AND NEW.claim_token IS NULL
     AND NEW.claimed_at IS NULL
     AND NEW.claim_expires_at IS NULL
     AND NEW.attempt_count = OLD.attempt_count
     AND NEW.completed_at IS NULL
     AND NEW.next_attempt_at > OLD.next_attempt_at
     AND NEW.last_error_code =
       'KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Illegal Keyword governance schedule request transition'
    USING ERRCODE = '23514',
      CONSTRAINT = 'keyword_governance_schedule_requests_transition_ck';
END;
$$;

DROP TRIGGER IF EXISTS keyword_governance_schedule_requests_mutation_guard
  ON app.keyword_governance_schedule_requests;
CREATE TRIGGER keyword_governance_schedule_requests_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON app.keyword_governance_schedule_requests
  FOR EACH ROW EXECUTE FUNCTION
    app.enforce_keyword_governance_schedule_request_mutation();

CREATE OR REPLACE FUNCTION app.insert_keyword_governance_schedule_request(
  p_workspace_id uuid,
  p_project_id uuid,
  p_source_kind text,
  p_source_ref text,
  p_initiated_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  request_row app.keyword_governance_schedule_requests%ROWTYPE;
  was_inserted boolean := false;
BEGIN
  IF p_workspace_id IS NULL
     OR p_project_id IS NULL
     OR p_initiated_by IS NULL
     OR p_source_kind NOT IN (
       'analysis_refresh',
       'csv_keyword_gap_import',
       'topic_model_confirmation_system',
       'topic_model_confirmation_manual',
       'generation_continuation'
     )
     OR p_source_ref IS NULL
     OR length(p_source_ref) NOT BETWEEN 1 AND 500
     OR p_source_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$' THEN
    RAISE EXCEPTION 'Keyword governance schedule request identity is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_identity_ck';
  END IF;

  INSERT INTO app.keyword_governance_schedule_requests(
    workspace_id,
    project_id,
    source_kind,
    source_ref,
    initiated_by
  ) VALUES (
    p_workspace_id,
    p_project_id,
    p_source_kind,
    p_source_ref,
    p_initiated_by
  )
  ON CONFLICT (dispatch_key) DO NOTHING
  RETURNING * INTO request_row;
  was_inserted := FOUND;

  IF NOT was_inserted THEN
    SELECT request.* INTO request_row
    FROM app.keyword_governance_schedule_requests request
    WHERE request.workspace_id = p_workspace_id
      AND request.project_id = p_project_id
      AND request.source_kind = p_source_kind
      AND request.source_ref = p_source_ref;
  END IF;

  IF NOT FOUND OR request_row.initiated_by IS DISTINCT FROM p_initiated_by THEN
    RAISE EXCEPTION 'Keyword governance schedule replay identity conflicts'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'keyword_governance_schedule_requests_dispatch_replay_ck';
  END IF;

  RETURN jsonb_build_object(
    'kind', CASE WHEN was_inserted THEN 'inserted' ELSE 'existing' END,
    'request', to_jsonb(request_row)
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.claim_keyword_governance_schedule_request(
  p_workspace_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_lease_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  request_row app.keyword_governance_schedule_requests%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL
     OR p_project_id IS NULL
     OR p_request_id IS NULL
     OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'Keyword governance schedule claim is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_claim_input_ck';
  END IF;

  WITH candidate AS MATERIALIZED (
    SELECT request.id
    FROM app.keyword_governance_schedule_requests request
    WHERE request.id = p_request_id
      AND request.workspace_id = p_workspace_id
      AND request.project_id = p_project_id
      AND request.completed_at IS NULL
      AND request.next_attempt_at <= clock_timestamp()
      AND (
        request.claim_token IS NULL
        OR request.claim_expires_at <= clock_timestamp()
      )
      AND request.attempt_count < 2147483647
    FOR UPDATE SKIP LOCKED
  )
  UPDATE app.keyword_governance_schedule_requests request
  SET claim_token = gen_random_uuid(),
      claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp()
        + make_interval(secs => p_lease_seconds),
      attempt_count = request.attempt_count + 1,
      last_error_code = NULL
  FROM candidate
  WHERE request.id = candidate.id
  RETURNING request.* INTO request_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'unavailable');
  END IF;
  RETURN jsonb_build_object(
    'kind', 'claimed',
    'request', to_jsonb(request_row)
  );
END;
$$;

CREATE OR REPLACE FUNCTION
  app.claim_keyword_governance_schedule_request_by_source(
    p_workspace_id uuid,
    p_project_id uuid,
    p_source_kind text,
    p_source_ref text,
    p_lease_seconds integer
  )
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  request_row app.keyword_governance_schedule_requests%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL
     OR p_project_id IS NULL
     OR p_source_kind NOT IN (
       'analysis_refresh',
       'csv_keyword_gap_import',
       'topic_model_confirmation_system',
       'topic_model_confirmation_manual',
       'generation_continuation'
     )
     OR p_source_ref IS NULL
     OR length(p_source_ref) NOT BETWEEN 1 AND 500
     OR p_source_ref !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$'
     OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'Keyword governance schedule source claim is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_claim_input_ck';
  END IF;

  WITH candidate AS MATERIALIZED (
    SELECT request.id
    FROM app.keyword_governance_schedule_requests request
    WHERE request.workspace_id = p_workspace_id
      AND request.project_id = p_project_id
      AND request.source_kind = p_source_kind
      AND request.source_ref = p_source_ref
      AND request.completed_at IS NULL
      AND request.next_attempt_at <= clock_timestamp()
      AND (
        request.claim_token IS NULL
        OR request.claim_expires_at <= clock_timestamp()
      )
      AND request.attempt_count < 2147483647
    FOR UPDATE SKIP LOCKED
  )
  UPDATE app.keyword_governance_schedule_requests request
  SET claim_token = gen_random_uuid(),
      claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp()
        + make_interval(secs => p_lease_seconds),
      attempt_count = request.attempt_count + 1,
      last_error_code = NULL
  FROM candidate
  WHERE request.id = candidate.id
  RETURNING request.* INTO request_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'unavailable');
  END IF;
  RETURN jsonb_build_object(
    'kind', 'claimed',
    'request', to_jsonb(request_row)
  );
END;
$$;

CREATE OR REPLACE FUNCTION
  app.claim_due_keyword_governance_schedule_requests(
    p_limit integer,
    p_lease_seconds integer
  )
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  claimed_rows jsonb;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 100
     OR p_lease_seconds NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'Keyword governance schedule due claim is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_claim_input_ck';
  END IF;

  WITH due AS MATERIALIZED (
    SELECT request.id
    FROM app.keyword_governance_schedule_requests request
    WHERE request.completed_at IS NULL
      AND request.next_attempt_at <= clock_timestamp()
      AND (
        request.claim_token IS NULL
        OR request.claim_expires_at <= clock_timestamp()
      )
      AND request.attempt_count < 2147483647
    ORDER BY request.next_attempt_at, request.requested_at, request.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE app.keyword_governance_schedule_requests request
    SET claim_token = gen_random_uuid(),
        claimed_at = clock_timestamp(),
        claim_expires_at = clock_timestamp()
          + make_interval(secs => p_lease_seconds),
        attempt_count = request.attempt_count + 1,
        last_error_code = NULL
    FROM due
    WHERE request.id = due.id
    RETURNING request.*
  )
  SELECT coalesce(
    jsonb_agg(
      to_jsonb(claimed)
      ORDER BY claimed.next_attempt_at, claimed.requested_at, claimed.id
    ),
    '[]'::jsonb
  ) INTO claimed_rows
  FROM claimed;

  RETURN claimed_rows;
END;
$$;

CREATE OR REPLACE FUNCTION app.complete_keyword_governance_schedule_request(
  p_workspace_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  request_row app.keyword_governance_schedule_requests%ROWTYPE;
  settled_at timestamptz := clock_timestamp();
BEGIN
  IF p_workspace_id IS NULL
     OR p_project_id IS NULL
     OR p_request_id IS NULL
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'Keyword governance schedule completion is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_settle_input_ck';
  END IF;

  UPDATE app.keyword_governance_schedule_requests request
  SET completed_at = settled_at,
      last_error_code = NULL
  WHERE request.id = p_request_id
    AND request.workspace_id = p_workspace_id
    AND request.project_id = p_project_id
    AND request.completed_at IS NULL
    AND request.claim_token = p_claim_token
    AND request.claim_expires_at > settled_at
  RETURNING request.* INTO request_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'completed',
      'request', to_jsonb(request_row)
    );
  END IF;

  -- Exact replay is idempotent; a different scope or token remains opaque.
  SELECT request.* INTO request_row
  FROM app.keyword_governance_schedule_requests request
  WHERE request.id = p_request_id
    AND request.workspace_id = p_workspace_id
    AND request.project_id = p_project_id
    AND request.completed_at IS NOT NULL
    AND request.claim_token = p_claim_token;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'completed',
      'request', to_jsonb(request_row)
    );
  END IF;
  RETURN jsonb_build_object('kind', 'stale');
END;
$$;

CREATE OR REPLACE FUNCTION app.release_keyword_governance_schedule_request(
  p_workspace_id uuid,
  p_project_id uuid,
  p_request_id uuid,
  p_claim_token uuid,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  request_row app.keyword_governance_schedule_requests%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL
     OR p_project_id IS NULL
     OR p_request_id IS NULL
     OR p_claim_token IS NULL
     OR p_error_code IS DISTINCT FROM
       'KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED' THEN
    RAISE EXCEPTION 'Keyword governance schedule release is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT = 'keyword_governance_schedule_requests_settle_input_ck';
  END IF;

  UPDATE app.keyword_governance_schedule_requests request
  SET claim_token = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      next_attempt_at = clock_timestamp() + interval '1 second',
      last_error_code =
        'KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED'
  WHERE request.id = p_request_id
    AND request.workspace_id = p_workspace_id
    AND request.project_id = p_project_id
    AND request.completed_at IS NULL
    AND request.claim_token = p_claim_token
    AND request.claim_expires_at > clock_timestamp()
  RETURNING request.* INTO request_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale');
  END IF;
  RETURN jsonb_build_object(
    'kind', 'released',
    'request', to_jsonb(request_row)
  );
END;
$$;

-- A generation that intentionally asks for a continuation publishes the next
-- durable source event in the exact terminal transaction. Invalid or opaque
-- terminal summaries never create dispatchable work.
CREATE OR REPLACE FUNCTION
  app.append_keyword_governance_generation_continuation_request()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  disposition jsonb;
  should_append boolean := false;
BEGIN
  IF OLD.status <> 'running'
     OR NEW.kind <> 'keyword_governance_suggestion_generation'
     OR NEW.result_type <>
       'keyword_governance_suggestion_generation_run'
     OR NEW.result_id IS DISTINCT FROM NEW.id
     OR NOT EXISTS (
       SELECT 1
       FROM app.keyword_governance_suggestion_generation_runs generation
       WHERE generation.id = NEW.id
         AND generation.workspace_id = NEW.workspace_id
         AND generation.project_id = NEW.project_id
         AND generation.generation_version =
           'keyword-governance-suggestion-generation.v1'
         AND generation.prompt_set_version =
           'keyword-governance-suggestion.prompt.v1'
         AND generation.input_hash ~ '^[a-f0-9]{64}$'
     )
     OR NEW.completed_at IS NULL
     OR jsonb_typeof(NEW.progress) <> 'object'
     OR NOT (NEW.progress ?& ARRAY[
       'schemaVersion',
       'candidateCount',
       'suggestionCount',
       'limitations',
       'terminalDisposition'
     ]::text[])
     OR NEW.progress - ARRAY[
       'schemaVersion',
       'candidateCount',
       'suggestionCount',
       'limitations',
       'terminalDisposition'
     ]::text[] <> '{}'::jsonb
     OR NEW.progress ->> 'schemaVersion' <>
       'keyword-governance-suggestion-generation-outcome.v1'
     OR jsonb_typeof(NEW.progress -> 'candidateCount') <> 'number'
     OR jsonb_typeof(NEW.progress -> 'suggestionCount') <> 'number'
     OR jsonb_typeof(NEW.progress -> 'limitations') <> 'array'
     OR jsonb_typeof(NEW.progress -> 'terminalDisposition') <> 'object' THEN
    RETURN NEW;
  END IF;

  disposition := NEW.progress -> 'terminalDisposition';
  IF NEW.status = 'completed'
     AND NEW.last_error_code IS NULL
     AND NEW.last_error_summary IS NULL
     AND disposition = jsonb_build_object(
       'kind', 'completed', 'requestNextBatch', true
     ) THEN
    should_append := true;
  ELSIF NEW.status = 'cancelled'
        AND NEW.last_error_summary =
          'Keyword governance suggestion generation was superseded.'
        AND disposition = jsonb_build_object(
          'kind', 'reschedule',
          'reason', 'stale_authority',
          'requestNextBatch', true
        )
        AND NEW.last_error_code =
          'KEYWORD_GOVERNANCE_SUGGESTION_AUTHORITY_STALE' THEN
    should_append := true;
  ELSIF NEW.status = 'cancelled'
        AND NEW.last_error_summary =
          'Keyword governance suggestion generation was superseded.'
        AND disposition = jsonb_build_object(
          'kind', 'reschedule',
          'reason', 'concurrent_human',
          'requestNextBatch', true
        )
        AND NEW.last_error_code =
          'KEYWORD_GOVERNANCE_SUGGESTION_CONCURRENT_HUMAN' THEN
    should_append := true;
  ELSIF NEW.status = 'cancelled'
        AND NEW.last_error_summary =
          'Keyword governance suggestion generation was superseded.'
        AND disposition = jsonb_build_object(
          'kind', 'reschedule',
          'reason', 'conflict',
          'requestNextBatch', true
        )
        AND NEW.last_error_code =
          'KEYWORD_GOVERNANCE_SUGGESTION_BATCH_CONFLICT' THEN
    should_append := true;
  END IF;

  IF should_append THEN
    PERFORM app.insert_keyword_governance_schedule_request(
      NEW.workspace_id,
      NEW.project_id,
      'generation_continuation',
      NEW.id::text,
      NEW.initiated_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_governance_generation_continuation_schedule
  ON app.async_runs;
CREATE TRIGGER keyword_governance_generation_continuation_schedule
  AFTER UPDATE OF status ON app.async_runs
  FOR EACH ROW EXECUTE FUNCTION
    app.append_keyword_governance_generation_continuation_request();

-- One bounded project-authority sweep is shared by every producer. It takes
-- the same topic-governance writer lock as the freezer and batch inserter, and
-- only terminalizes pending rows whose complete frozen authority is no longer
-- current. A caller can loop on the deterministic 100-row bound.
CREATE OR REPLACE FUNCTION
  app.supersede_stale_pending_keyword_review_suggestions(
    p_workspace_id uuid,
    p_project_id uuid
  )
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  changed integer;
BEGIN
  IF p_workspace_id IS NULL OR p_project_id IS NULL THEN
    RAISE EXCEPTION 'Keyword suggestion invalidation scope is invalid'
      USING ERRCODE = '23514',
        CONSTRAINT =
          'supersede_stale_pending_keyword_review_suggestions_scope_ck';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || p_workspace_id::text || ':'
      || p_project_id::text,
    0
  ));
  PERFORM 1
  FROM app.client_projects project
  WHERE project.id = p_project_id
    AND project.workspace_id = p_workspace_id
    AND project.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  WITH locked_project AS MATERIALIZED (
    SELECT project.id,
      project.workspace_id,
      project.default_delivery_locale,
      project.confirmed_icp_profile_id
    FROM app.client_projects project
    WHERE project.id = p_project_id
      AND project.workspace_id = p_workspace_id
      AND project.archived_at IS NULL
  ), pending_authority AS MATERIALIZED (
    SELECT suggestion.id,
      (
        generation.input_hash = suggestion.input_hash
        AND generation.prompt_input_hash IS NOT NULL
        AND generation.result_output_hash = suggestion.output_hash
        AND generation.generation_version = suggestion.generation_version
        AND generation.prompt_set_version = suggestion.prompt_set_version
        AND run.kind = 'keyword_governance_suggestion_generation'
        AND run.result_type =
          'keyword_governance_suggestion_generation_run'
        AND run.result_id = generation.id
        AND run.status = 'completed'
        AND EXISTS (
          SELECT 1
          FROM app.icp_profiles profile
          INNER JOIN app.sites primary_site
            ON primary_site.workspace_id = locked_project.workspace_id
           AND primary_site.project_id = locked_project.id
           AND primary_site.is_primary
           AND generation.input_manifest ->> 'marketCode' =
             ANY(primary_site.market_codes)
           AND generation.input_manifest ->> 'languageTag' =
             ANY(primary_site.language_codes)
          WHERE profile.id = locked_project.confirmed_icp_profile_id
            AND profile.workspace_id = locked_project.workspace_id
            AND profile.project_id = locked_project.id
            AND profile.status = 'complete'
            AND locked_project.default_delivery_locale =
              generation.input_manifest ->> 'languageTag'
            AND profile.id = (generation.input_manifest #>>
              '{confirmedProductProfile,productProfileId}')::uuid
            AND profile.version = (generation.input_manifest #>>
              '{confirmedProductProfile,version}')::integer
            AND profile.content_hash = generation.input_manifest #>>
              '{confirmedProductProfile,contentHash}'
            AND (
              SELECT count(*)
              FROM jsonb_array_elements(profile.profile -> 'targetMarkets')
                market(value)
              WHERE market.value ->> 'priority' = 'primary'
            ) = 1
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(profile.profile -> 'targetMarkets')
                market(value)
              WHERE market.value ->> 'priority' = 'primary'
                AND market.value ->> 'marketCode' =
                  generation.input_manifest ->> 'marketCode'
            )
        )
        AND EXISTS (
          SELECT 1
          FROM app.topic_model_revisions topic_model
          WHERE topic_model.id = (generation.input_manifest #>>
              '{confirmedTopicModel,topicModelRevisionId}')::uuid
            AND topic_model.workspace_id = suggestion.workspace_id
            AND topic_model.project_id = suggestion.project_id
            AND topic_model.revision = (generation.input_manifest #>>
              '{confirmedTopicModel,revision}')::integer
            AND topic_model.status = 'confirmed'
            AND topic_model.content_hash = generation.input_manifest #>>
              '{confirmedTopicModel,contentHash}'
            AND NOT EXISTS (
              SELECT 1
              FROM app.topic_model_revisions newer_topic
              WHERE newer_topic.workspace_id = topic_model.workspace_id
                AND newer_topic.project_id = topic_model.project_id
                AND newer_topic.status = 'confirmed'
                AND newer_topic.revision > topic_model.revision
            )
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            generation.input_manifest -> 'candidates'
          ) frozen(value)
          INNER JOIN app.keyword_entities keyword
            ON keyword.id = suggestion.keyword_entity_id
           AND keyword.workspace_id = suggestion.workspace_id
           AND keyword.project_id = suggestion.project_id
          INNER JOIN app.keyword_review_decisions current_decision
            ON current_decision.workspace_id = keyword.workspace_id
           AND current_decision.project_id = keyword.project_id
           AND current_decision.keyword_entity_id = keyword.id
           AND current_decision.governance_revision = keyword.mapping_revision
           AND current_decision.status = keyword.status
           AND current_decision.intent IS NOT DISTINCT FROM keyword.intent
           AND current_decision.buyer_stage IS NOT DISTINCT FROM
             keyword.buyer_stage
           AND current_decision.mapping_decision = keyword.mapping_decision
           AND current_decision.mapped_site_page_id IS NOT DISTINCT FROM
             keyword.mapped_site_page_id
           AND current_decision.review_state = keyword.mapping_review_state
          WHERE (frozen.value ->> 'ordinal')::integer =
              suggestion.output_ordinal
            AND (frozen.value ->> 'keywordId')::uuid =
              suggestion.keyword_entity_id
            AND (frozen.value ->> 'expectedGovernanceRevision')::integer =
              suggestion.expected_governance_revision
            AND keyword.mapping_revision =
              suggestion.expected_governance_revision
            AND keyword.query_kind = 'search_query'
            AND keyword.status = 'candidate'
            AND keyword.mapping_review_state = 'unreviewed'
            AND keyword.display_keyword =
              frozen.value ->> 'displayKeyword'
            AND keyword.normalized_keyword =
              frozen.value ->> 'normalizedKeyword'
            AND keyword.market = generation.input_manifest ->> 'marketCode'
            AND keyword.language_tag =
              generation.input_manifest ->> 'languageTag'
            AND NOT EXISTS (
              SELECT 1
              FROM app.keyword_review_decisions decision
              WHERE decision.workspace_id = suggestion.workspace_id
                AND decision.project_id = suggestion.project_id
                AND decision.keyword_entity_id = suggestion.keyword_entity_id
                AND decision.decision_origin = 'user'
            )
            AND (
              (
                frozen.value #>>
                  '{deterministicEvidence,currentTopicKey}' IS NULL
                AND current_decision.topic_node_id IS NULL
              )
              OR (
                frozen.value #>>
                  '{deterministicEvidence,currentTopicKey}' IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(
                    generation.input_manifest -> 'topicAllowlist'
                  ) allowed_topic(value)
                  INNER JOIN app.topic_node_revisions current_topic
                    ON current_topic.workspace_id = keyword.workspace_id
                   AND current_topic.project_id = keyword.project_id
                   AND current_topic.topic_node_id =
                     (allowed_topic.value ->> 'topicNodeId')::uuid
                   AND current_topic.topic_model_revision =
                     (generation.input_manifest #>>
                       '{confirmedTopicModel,revision}')::integer
                   AND current_topic.lifecycle_state = 'active'
                  WHERE allowed_topic.value ->> 'topicKey' =
                    frozen.value #>>
                      '{deterministicEvidence,currentTopicKey}'
                    AND current_decision.topic_node_id =
                      current_topic.topic_node_id
                    AND current_decision.topic_model_revision =
                      current_topic.topic_model_revision
                )
              )
            )
            AND (
              (
                frozen.value #>>
                  '{deterministicEvidence,currentPageKey}' IS NULL
                AND keyword.mapped_site_page_id IS NULL
              )
              OR (
                frozen.value #>>
                  '{deterministicEvidence,currentPageKey}' IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(
                    generation.input_manifest -> 'pageAllowlist'
                  ) allowed_page(value)
                  INNER JOIN app.site_pages current_page
                    ON current_page.id =
                      (allowed_page.value ->> 'sitePageId')::uuid
                   AND current_page.workspace_id = keyword.workspace_id
                   AND current_page.project_id = keyword.project_id
                  INNER JOIN app.sites current_site
                    ON current_site.id = current_page.site_id
                   AND current_site.workspace_id = current_page.workspace_id
                   AND current_site.project_id = current_page.project_id
                   AND current_site.is_primary
                  WHERE allowed_page.value ->> 'pageKey' =
                    frozen.value #>>
                      '{deterministicEvidence,currentPageKey}'
                    AND keyword.mapped_site_page_id = current_page.id
                )
              )
            )
            AND app.current_keyword_governance_suggestion_occurrence_ids(
              suggestion.workspace_id,
              suggestion.project_id,
              suggestion.keyword_entity_id,
              frozen.value ->> 'displayKeyword',
              frozen.value ->> 'normalizedKeyword',
              generation.input_manifest ->> 'marketCode',
              generation.input_manifest ->> 'languageTag'
            ) IS NOT DISTINCT FROM (
              SELECT coalesce(
                jsonb_agg(value::uuid ORDER BY value::uuid),
                '[]'::jsonb
              )
              FROM jsonb_array_elements_text(
                frozen.value #>
                  '{deterministicEvidence,sourceOccurrenceIds}'
              ) occurrence_id(value)
            )
        )
        AND (
          suggestion.suggested_topic_node_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM app.topic_node_revisions suggested_topic
            WHERE suggested_topic.workspace_id = suggestion.workspace_id
              AND suggested_topic.project_id = suggestion.project_id
              AND suggested_topic.topic_node_id =
                suggestion.suggested_topic_node_id
              AND suggested_topic.topic_model_revision =
                suggestion.suggested_topic_model_revision
              AND suggested_topic.lifecycle_state = 'active'
          )
        )
        AND (
          suggestion.suggested_mapped_site_page_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM app.site_pages suggested_page
            INNER JOIN app.sites suggested_site
              ON suggested_site.id = suggested_page.site_id
             AND suggested_site.workspace_id = suggested_page.workspace_id
             AND suggested_site.project_id = suggested_page.project_id
             AND suggested_site.is_primary
            WHERE suggested_page.id =
                suggestion.suggested_mapped_site_page_id
              AND suggested_page.workspace_id = suggestion.workspace_id
              AND suggested_page.project_id = suggestion.project_id
          )
        )
        AND EXISTS (
          SELECT 1
          FROM app.analysis_invocations invocation
          INNER JOIN
            app.keyword_governance_suggestion_invocation_attempts attempt
            ON attempt.analysis_invocation_id = invocation.id
           AND attempt.status = 'succeeded'
          WHERE invocation.id = suggestion.analysis_invocation_id
            AND invocation.workspace_id = suggestion.workspace_id
            AND invocation.project_id = suggestion.project_id
            AND invocation.async_run_id = suggestion.generation_run_id
            AND invocation.task =
              'keyword_governance_suggestion_generation'
            AND invocation.status = 'succeeded'
            AND invocation.input_hash = generation.prompt_input_hash
            AND invocation.output_hash = suggestion.output_hash
        )
      ) AS authority_current
    FROM app.keyword_review_suggestions suggestion
    INNER JOIN app.keyword_governance_suggestion_generation_runs generation
      ON generation.id = suggestion.generation_run_id
     AND generation.workspace_id = suggestion.workspace_id
     AND generation.project_id = suggestion.project_id
    INNER JOIN app.async_runs run ON run.id = generation.id
    CROSS JOIN locked_project
    WHERE suggestion.workspace_id = p_workspace_id
      AND suggestion.project_id = p_project_id
      AND suggestion.status = 'pending'
  ), stale_pending AS MATERIALIZED (
    SELECT pending_authority.id
    FROM pending_authority
    WHERE pending_authority.authority_current IS NOT TRUE
    ORDER BY pending_authority.id
    LIMIT 100
  )
  UPDATE app.keyword_review_suggestions suggestion
  SET status = 'superseded',
      superseded_by_suggestion_id = NULL,
      resolved_at = clock_timestamp()
  FROM stale_pending
  WHERE suggestion.id = stale_pending.id
    AND suggestion.status = 'pending';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

REVOKE ALL ON app.keyword_governance_schedule_requests FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.enforce_keyword_governance_schedule_request_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.insert_keyword_governance_schedule_request(
    uuid, uuid, text, text, uuid
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.claim_keyword_governance_schedule_request(
    uuid, uuid, uuid, integer
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.claim_keyword_governance_schedule_request_by_source(
    uuid, uuid, text, text, integer
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.claim_due_keyword_governance_schedule_requests(integer, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.complete_keyword_governance_schedule_request(uuid, uuid, uuid, uuid)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.release_keyword_governance_schedule_request(
    uuid, uuid, uuid, uuid, text
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.append_keyword_governance_generation_continuation_request()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.supersede_stale_pending_keyword_review_suggestions(uuid, uuid)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.keyword_governance_schedule_requests FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.enforce_keyword_governance_schedule_request_mutation() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.insert_keyword_governance_schedule_request(uuid, uuid, text, text, uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.claim_keyword_governance_schedule_request(uuid, uuid, uuid, integer) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.claim_keyword_governance_schedule_request_by_source(uuid, uuid, text, text, integer) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.claim_due_keyword_governance_schedule_requests(integer, integer) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.complete_keyword_governance_schedule_request(uuid, uuid, uuid, uuid) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.release_keyword_governance_schedule_request(uuid, uuid, uuid, uuid, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.append_keyword_governance_generation_continuation_request() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.supersede_stale_pending_keyword_review_suggestions(uuid, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.keyword_governance_schedule_requests FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.enforce_keyword_governance_schedule_request_mutation() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.insert_keyword_governance_schedule_request(uuid, uuid, text, text, uuid) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.claim_keyword_governance_schedule_request(uuid, uuid, uuid, integer) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.claim_keyword_governance_schedule_request_by_source(uuid, uuid, text, text, integer) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.claim_due_keyword_governance_schedule_requests(integer, integer) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.complete_keyword_governance_schedule_request(uuid, uuid, uuid, uuid) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.release_keyword_governance_schedule_request(uuid, uuid, uuid, uuid, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.append_keyword_governance_generation_continuation_request() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.supersede_stale_pending_keyword_review_suggestions(uuid, uuid) FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0052_keyword_governance_schedule_requests'::text
    AS migration_version;

COMMIT;
