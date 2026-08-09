BEGIN;

-- Collection projections validate every client input before reaching SQL, then
-- send at most one provider page per call. The existing scalar authorities
-- remain the exact-lineage gate; this wrapper removes remote round trips while
-- keeping the whole page atomic under retry or a corrupt member.
CREATE OR REPLACE FUNCTION app.upsert_keyword_library_occurrences_batch(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_inputs jsonb
)
RETURNS TABLE (
  input_ordinal integer,
  occurrence_id uuid,
  entity_id uuid
)
LANGUAGE plpgsql
AS $$
DECLARE
  selected_input jsonb;
  selected_ordinal bigint;
BEGIN
  IF selected_inputs IS NULL
     OR jsonb_typeof(selected_inputs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'keyword occurrence batch must be a JSON array'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(selected_inputs) > 500 THEN
    RAISE EXCEPTION 'keyword occurrence batch exceeds 500 inputs'
      USING ERRCODE = '23514';
  END IF;

  FOR selected_input, selected_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(selected_inputs) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(selected_input) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(selected_input)) <> 14
       OR NOT selected_input ?& ARRAY[
         'occurrenceId',
         'dataSnapshotId',
         'observationId',
         'displayKeyword',
         'normalizedKeyword',
         'market',
         'languageTag',
         'queryKind',
         'sourceKind',
         'scopeBasis',
         'sourcePointer',
         'sourceRef',
         'collectedAt',
         'providerDataAsOf'
       ]::text[] THEN
      RAISE EXCEPTION 'keyword occurrence batch member has an invalid shape'
        USING ERRCODE = '23514';
    END IF;

    RETURN QUERY
    SELECT
      selected_ordinal::integer,
      result.occurrence_id,
      result.entity_id
    FROM app.upsert_keyword_library_occurrence(
      selected_workspace_id,
      selected_project_id,
      (selected_input ->> 'occurrenceId')::uuid,
      (selected_input ->> 'dataSnapshotId')::uuid,
      (selected_input ->> 'observationId')::uuid,
      selected_input ->> 'displayKeyword',
      selected_input ->> 'normalizedKeyword',
      selected_input ->> 'market',
      selected_input ->> 'languageTag',
      selected_input ->> 'queryKind',
      selected_input ->> 'sourceKind',
      selected_input ->> 'scopeBasis',
      selected_input ->> 'sourcePointer',
      selected_input ->> 'sourceRef',
      (selected_input ->> 'collectedAt')::timestamptz,
      (selected_input ->> 'providerDataAsOf')::timestamptz
    ) AS result;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION app.upsert_competitor_origins_batch(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_inputs jsonb
)
RETURNS TABLE (
  input_ordinal integer,
  occurrence_id uuid,
  competitor_id uuid
)
LANGUAGE plpgsql
AS $$
DECLARE
  selected_input jsonb;
  selected_ordinal bigint;
  selected_analysis_scope text[];
BEGIN
  IF selected_inputs IS NULL
     OR jsonb_typeof(selected_inputs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'competitor origin batch must be a JSON array'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(selected_inputs) > 500 THEN
    RAISE EXCEPTION 'competitor origin batch exceeds 500 inputs'
      USING ERRCODE = '23514';
  END IF;

  FOR selected_input, selected_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(selected_inputs) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(selected_input) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(selected_input)) <> 16
       OR NOT selected_input ?& ARRAY[
         'domain',
         'name',
         'originKind',
         'productProfileId',
         'profileVersion',
         'candidateId',
         'fieldProvenancePath',
         'evidenceRefs',
         'sourceReviewStatus',
         'sourceRelationship',
         'sourceAnalysisScope',
         'snapshotId',
         'observationId',
         'importPreviewId',
         'sourcePointer',
         'manualEntryId'
       ]::text[] THEN
      RAISE EXCEPTION 'competitor origin batch member has an invalid shape'
        USING ERRCODE = '23514';
    END IF;

    IF jsonb_typeof(selected_input -> 'sourceAnalysisScope') NOT IN (
      'array',
      'null'
    ) THEN
      RAISE EXCEPTION 'competitor origin sourceAnalysisScope must be an array or null'
        USING ERRCODE = '23514';
    END IF;

    IF jsonb_typeof(selected_input -> 'sourceAnalysisScope') = 'array' THEN
      SELECT array_agg(value ORDER BY ordinality)
      INTO selected_analysis_scope
      FROM jsonb_array_elements_text(
        selected_input -> 'sourceAnalysisScope'
      ) WITH ORDINALITY AS item(value, ordinality);
      selected_analysis_scope := coalesce(
        selected_analysis_scope,
        ARRAY[]::text[]
      );
    ELSE
      selected_analysis_scope := NULL;
    END IF;

    IF selected_input ->> 'originKind' IN ('serp_overlap', 'ai_citation')
       AND (
         selected_input ->> 'name' IS NOT NULL
         OR selected_input ->> 'productProfileId' IS NOT NULL
         OR selected_input ->> 'profileVersion' IS NOT NULL
         OR selected_input ->> 'candidateId' IS NOT NULL
         OR selected_input ->> 'fieldProvenancePath' IS NOT NULL
         OR selected_input ->> 'evidenceRefs' IS NOT NULL
         OR selected_input ->> 'sourceReviewStatus' IS NOT NULL
         OR selected_input ->> 'sourceRelationship' IS NOT NULL
         OR selected_input ->> 'sourceAnalysisScope' IS NOT NULL
         OR selected_input ->> 'importPreviewId' IS NOT NULL
         OR selected_input ->> 'manualEntryId' IS NOT NULL
       ) THEN
      RAISE EXCEPTION 'provider competitor origin contains irrelevant lineage fields'
        USING ERRCODE = '23514';
    END IF;

    IF selected_input ->> 'originKind' = 'serp_overlap' THEN
      RETURN QUERY
      SELECT
        selected_ordinal::integer,
        result.occurrence_id,
        result.competitor_id
      FROM app.upsert_serp_overlap_competitor_origin(
        selected_workspace_id,
        selected_project_id,
        selected_input ->> 'domain',
        (selected_input ->> 'snapshotId')::uuid,
        (selected_input ->> 'observationId')::uuid,
        selected_input ->> 'sourcePointer'
      ) AS result;
    ELSIF selected_input ->> 'originKind' = 'ai_citation' THEN
      RETURN QUERY
      SELECT
        selected_ordinal::integer,
        result.occurrence_id,
        result.competitor_id
      FROM app.upsert_ai_citation_competitor_origin(
        selected_workspace_id,
        selected_project_id,
        selected_input ->> 'domain',
        (selected_input ->> 'snapshotId')::uuid,
        (selected_input ->> 'observationId')::uuid,
        selected_input ->> 'sourcePointer'
      ) AS result;
    ELSE
      RETURN QUERY
      SELECT
        selected_ordinal::integer,
        result.occurrence_id,
        result.competitor_id
      FROM app.upsert_competitor_origin(
        selected_workspace_id,
        selected_project_id,
        selected_input ->> 'domain',
        selected_input ->> 'name',
        selected_input ->> 'originKind',
        (selected_input ->> 'productProfileId')::uuid,
        (selected_input ->> 'profileVersion')::integer,
        (selected_input ->> 'candidateId')::uuid,
        selected_input ->> 'fieldProvenancePath',
        nullif(selected_input -> 'evidenceRefs', 'null'::jsonb),
        selected_input ->> 'sourceReviewStatus',
        selected_input ->> 'sourceRelationship',
        selected_analysis_scope,
        (selected_input ->> 'snapshotId')::uuid,
        (selected_input ->> 'observationId')::uuid,
        (selected_input ->> 'importPreviewId')::uuid,
        selected_input ->> 'sourcePointer',
        (selected_input ->> 'manualEntryId')::uuid
      ) AS result;
    END IF;
  END LOOP;
END;
$$;

-- Detection and convergence stay inside one server call and transaction. The
-- caller already holds the exact project/provider/window advisory transaction
-- lock, so the insert and canonical replay read cannot race an equal-window
-- collection commit.
CREATE OR REPLACE FUNCTION app.detect_provider_discrepancies_for_snapshot(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_snapshot_id uuid
)
RETURNS TABLE (
  id uuid,
  workspace_id uuid,
  project_id uuid,
  metric_key text,
  subject_type text,
  subject_ref text,
  left_observation_id uuid,
  right_observation_id uuid,
  resolution text,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO app.provider_discrepancies (
    workspace_id,
    project_id,
    metric_key,
    subject_type,
    subject_ref,
    left_observation_id,
    right_observation_id
  )
  WITH candidate_pairs AS MATERIALIZED (
    SELECT DISTINCT
      current_observation.metric_key,
      current_observation.subject_type,
      current_observation.subject_ref,
      least(current_observation.id, prior_observation.id) AS left_observation_id,
      greatest(current_observation.id, prior_observation.id) AS right_observation_id
    FROM app.normalized_observations current_observation
    JOIN app.data_snapshots current_snapshot
      ON current_snapshot.id = current_observation.snapshot_id
     AND current_snapshot.workspace_id = selected_workspace_id
     AND current_snapshot.project_id = selected_project_id
    JOIN app.normalized_observations prior_observation
      ON prior_observation.provider = current_observation.provider
     AND prior_observation.metric_key = current_observation.metric_key
     AND prior_observation.subject_type = current_observation.subject_type
     AND prior_observation.subject_ref = current_observation.subject_ref
     AND prior_observation.snapshot_id <> current_observation.snapshot_id
     AND prior_observation.workspace_id = selected_workspace_id
     AND prior_observation.project_id = selected_project_id
    JOIN app.data_snapshots prior_snapshot
      ON prior_snapshot.id = prior_observation.snapshot_id
     AND prior_snapshot.workspace_id = selected_workspace_id
     AND prior_snapshot.project_id = selected_project_id
     AND prior_snapshot.source_window = current_snapshot.source_window
    WHERE current_observation.snapshot_id = selected_snapshot_id
      AND current_observation.workspace_id = selected_workspace_id
      AND current_observation.project_id = selected_project_id
      AND (
        prior_observation.availability IS DISTINCT FROM current_observation.availability
        OR prior_observation.value_numeric IS DISTINCT FROM current_observation.value_numeric
        OR prior_observation.value_text IS DISTINCT FROM current_observation.value_text
        OR prior_observation.value_json IS DISTINCT FROM current_observation.value_json
      )
  )
  SELECT
    selected_workspace_id,
    selected_project_id,
    candidate.metric_key,
    candidate.subject_type,
    candidate.subject_ref,
    candidate.left_observation_id,
    candidate.right_observation_id
  FROM candidate_pairs candidate
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  WITH candidate_pairs AS MATERIALIZED (
    SELECT DISTINCT
      current_observation.metric_key,
      current_observation.subject_type,
      current_observation.subject_ref,
      least(current_observation.id, prior_observation.id) AS left_observation_id,
      greatest(current_observation.id, prior_observation.id) AS right_observation_id
    FROM app.normalized_observations current_observation
    JOIN app.data_snapshots current_snapshot
      ON current_snapshot.id = current_observation.snapshot_id
     AND current_snapshot.workspace_id = selected_workspace_id
     AND current_snapshot.project_id = selected_project_id
    JOIN app.normalized_observations prior_observation
      ON prior_observation.provider = current_observation.provider
     AND prior_observation.metric_key = current_observation.metric_key
     AND prior_observation.subject_type = current_observation.subject_type
     AND prior_observation.subject_ref = current_observation.subject_ref
     AND prior_observation.snapshot_id <> current_observation.snapshot_id
     AND prior_observation.workspace_id = selected_workspace_id
     AND prior_observation.project_id = selected_project_id
    JOIN app.data_snapshots prior_snapshot
      ON prior_snapshot.id = prior_observation.snapshot_id
     AND prior_snapshot.workspace_id = selected_workspace_id
     AND prior_snapshot.project_id = selected_project_id
     AND prior_snapshot.source_window = current_snapshot.source_window
    WHERE current_observation.snapshot_id = selected_snapshot_id
      AND current_observation.workspace_id = selected_workspace_id
      AND current_observation.project_id = selected_project_id
      AND (
        prior_observation.availability IS DISTINCT FROM current_observation.availability
        OR prior_observation.value_numeric IS DISTINCT FROM current_observation.value_numeric
        OR prior_observation.value_text IS DISTINCT FROM current_observation.value_text
        OR prior_observation.value_json IS DISTINCT FROM current_observation.value_json
      )
  )
  SELECT
    existing.id,
    existing.workspace_id,
    existing.project_id,
    existing.metric_key,
    existing.subject_type,
    existing.subject_ref,
    existing.left_observation_id,
    existing.right_observation_id,
    existing.resolution,
    existing.created_at
  FROM app.provider_discrepancies existing
  JOIN candidate_pairs candidate
    ON candidate.left_observation_id = existing.left_observation_id
   AND candidate.right_observation_id = existing.right_observation_id
   AND candidate.metric_key = existing.metric_key
   AND candidate.subject_type = existing.subject_type
   AND candidate.subject_ref = existing.subject_ref
  WHERE existing.workspace_id = selected_workspace_id
    AND existing.project_id = selected_project_id
  ORDER BY
    existing.metric_key,
    existing.subject_type,
    existing.subject_ref,
    existing.left_observation_id,
    existing.right_observation_id;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0049_projection_batch_writes'::text AS migration_version;

COMMIT;
