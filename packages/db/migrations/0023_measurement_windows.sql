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
