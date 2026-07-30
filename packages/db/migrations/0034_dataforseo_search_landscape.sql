BEGIN;

-- Search Landscape is one atomic DataForSEO collection identity. It preserves
-- the two historical ranked-keyword Snapshot identities without allowing
-- arbitrary provider/operation/method combinations.
ALTER TABLE app.collection_runs
  DROP CONSTRAINT IF EXISTS collection_runs_operation_check;
ALTER TABLE app.collection_runs
  ADD CONSTRAINT collection_runs_operation_check CHECK (
    operation IN (
      'site_graph',
      'search_analytics',
      'organic_landing',
      'keyword_gap_import',
      'ai_citation_monitor',
      'keyword_evidence_collection',
      'search_landscape'
    )
  );

ALTER TABLE app.data_snapshots
  DROP CONSTRAINT IF EXISTS data_snapshots_dataset_key_check;
ALTER TABLE app.data_snapshots
  ADD CONSTRAINT data_snapshots_dataset_key_check CHECK (
    dataset_key IN (
      'crawl.site_graph.v1',
      'gsc.page_query_daily.v1',
      'ga4.organic_landing_daily.v1',
      'csv.keyword_gap.v1',
      'dataforseo.ranked_keywords.v1',
      'dataforseo.search_landscape.v1',
      'geo.answer_citations.v1',
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
  );

-- DataForSEO gets a provider-specific guard so both legacy identities and the
-- new composite identity are exact. Other providers continue through the
-- unchanged pre-0034 guard; VOC retains its dedicated authority.
CREATE OR REPLACE FUNCTION app.enforce_dataforseo_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> 'dataforseo' THEN
    RAISE EXCEPTION 'DataForSEO collection guard received another provider'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'DataForSEO collection run must begin unfinished'
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
    RAISE EXCEPTION 'DataForSEO collection source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      NEW.operation = 'keyword_gap_import'
      AND NEW.method_version = 'dataforseo.ranked_keywords.v1'
    )
    OR (
      NEW.operation = 'search_landscape'
      AND NEW.method_version = 'dataforseo.search_landscape.v1'
    )
  ) THEN
    RAISE EXCEPTION 'DataForSEO collection operation and method are not an exact supported pair'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NULL
     OR NEW.import_preview_id IS NOT NULL
     OR NEW.crawl_seed_site_page_id IS NOT NULL
     OR NEW.crawl_seed_url IS NOT NULL THEN
    RAISE EXCEPTION 'DataForSEO collection source shape is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
    JOIN app.source_connections source
      ON source.id = NEW.source_connection_id
     AND source.workspace_id = NEW.workspace_id
     AND source.project_id = NEW.project_id
     AND source.site_id = NEW.site_id
     AND source.provider = 'dataforseo'
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'collection'
  ) THEN
    RAISE EXCEPTION 'DataForSEO collection scope or source connection is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'DataForSEO collection outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.provider = 'dataforseo'
        AND snapshot.method_version = NEW.method_version
        AND snapshot.source_connection_id = NEW.source_connection_id
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
        AND (
          (
            NEW.operation = 'keyword_gap_import'
            AND snapshot.dataset_key IN (
              'csv.keyword_gap.v1',
              'dataforseo.ranked_keywords.v1'
            )
          )
          OR (
            NEW.operation = 'search_landscape'
            AND snapshot.dataset_key = 'dataforseo.search_landscape.v1'
          )
        )
    ) THEN
      RAISE EXCEPTION 'DataForSEO collection outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_runs_provenance_guard
  ON app.collection_runs;
DROP TRIGGER IF EXISTS collection_runs_dataforseo_provenance_guard
  ON app.collection_runs;
CREATE TRIGGER collection_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc' AND NEW.provider <> 'dataforseo')
  EXECUTE FUNCTION app.enforce_collection_run_provenance();
CREATE TRIGGER collection_runs_dataforseo_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider = 'dataforseo')
  EXECUTE FUNCTION app.enforce_dataforseo_collection_run_provenance();

CREATE OR REPLACE FUNCTION app.enforce_dataforseo_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> 'dataforseo'
     OR NEW.source_connection_id IS NULL THEN
    RAISE EXCEPTION 'DataForSEO snapshot source identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    JOIN app.source_connections source
      ON source.id = NEW.source_connection_id
     AND source.id = run.source_connection_id
     AND source.workspace_id = NEW.workspace_id
     AND source.project_id = NEW.project_id
     AND source.site_id = NEW.site_id
     AND source.provider = 'dataforseo'
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = 'dataforseo'
      AND run.import_preview_id IS NULL
      AND (
        (
          run.operation = 'keyword_gap_import'
          AND run.method_version = 'dataforseo.ranked_keywords.v1'
          AND NEW.dataset_key IN (
            'csv.keyword_gap.v1',
            'dataforseo.ranked_keywords.v1'
          )
          AND NEW.schema_version = 'dataforseo.ranked_keywords.v1'
          AND NEW.method_version = 'dataforseo.ranked_keywords.v1'
        )
        OR (
          run.operation = 'search_landscape'
          AND run.method_version = 'dataforseo.search_landscape.v1'
          AND NEW.dataset_key = 'dataforseo.search_landscape.v1'
          AND NEW.schema_version = 'dataforseo.search_landscape.v1'
          AND NEW.method_version = 'dataforseo.search_landscape.v1'
        )
      )
  ) THEN
    RAISE EXCEPTION 'DataForSEO snapshot does not match an exact collection identity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_snapshots_provenance_guard
  ON app.data_snapshots;
DROP TRIGGER IF EXISTS data_snapshots_dataforseo_provenance_guard
  ON app.data_snapshots;
CREATE TRIGGER data_snapshots_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc' AND NEW.provider <> 'dataforseo')
  EXECUTE FUNCTION app.enforce_data_snapshot_provenance();
CREATE TRIGGER data_snapshots_dataforseo_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (NEW.provider = 'dataforseo')
  EXECUTE FUNCTION app.enforce_dataforseo_data_snapshot_provenance();

CREATE OR REPLACE FUNCTION app.enforce_dataforseo_observation_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  value_key_count integer;
BEGIN
  IF NEW.provider <> 'dataforseo'
     OR NEW.origin <> 'vendor_observation'
     OR NEW.grade <> 'B' THEN
    RAISE EXCEPTION 'DataForSEO observation trust identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    JOIN app.collection_runs run
      ON run.id = snapshot.collection_run_id
     AND run.workspace_id = snapshot.workspace_id
     AND run.project_id = snapshot.project_id
     AND run.site_id = snapshot.site_id
     AND run.source_connection_id = snapshot.source_connection_id
     AND run.provider = 'dataforseo'
    JOIN app.source_connections source
      ON source.id = snapshot.source_connection_id
     AND source.workspace_id = snapshot.workspace_id
     AND source.project_id = snapshot.project_id
     AND source.site_id = snapshot.site_id
     AND source.provider = 'dataforseo'
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
      AND snapshot.provider = 'dataforseo'
      AND snapshot.captured_at = NEW.observed_at
      AND (
        (
          run.operation = 'keyword_gap_import'
          AND run.method_version = 'dataforseo.ranked_keywords.v1'
          AND snapshot.dataset_key IN (
            'csv.keyword_gap.v1',
            'dataforseo.ranked_keywords.v1'
          )
          AND snapshot.schema_version = 'dataforseo.ranked_keywords.v1'
          AND snapshot.method_version = 'dataforseo.ranked_keywords.v1'
          AND NEW.metric_key = 'csv.keyword_gap.v1'
        )
        OR (
          run.operation = 'search_landscape'
          AND run.method_version = 'dataforseo.search_landscape.v1'
          AND snapshot.dataset_key = 'dataforseo.search_landscape.v1'
          AND snapshot.schema_version = 'dataforseo.search_landscape.v1'
          AND snapshot.method_version = 'dataforseo.search_landscape.v1'
          AND NEW.metric_key IN (
            'csv.keyword_gap.v1',
            'dataforseo.competitor_domain.v1'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'DataForSEO observation does not match its exact Snapshot lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.metric_key = 'dataforseo.competitor_domain.v1' THEN
    IF jsonb_typeof(NEW.value_json) = 'object' THEN
      SELECT count(*)::integer
      INTO value_key_count
      FROM jsonb_object_keys(NEW.value_json);
    ELSE
      value_key_count := 0;
    END IF;

    IF NEW.subject_type <> 'site'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.availability <> 'available'
       OR NEW.value_numeric IS NOT NULL
       OR NEW.value_text IS NOT NULL
       OR NEW.value_json IS NULL
       OR NEW.unit IS NOT NULL
       OR NEW.support <> 'supports'
       OR value_key_count <> 8
       OR NOT (
         NEW.value_json ?& ARRAY[
           'targetDomain',
           'competitorDomain',
           'intersections',
           'averagePosition',
           'summedPosition',
           'organicEstimatedTrafficVolume',
           'marketCode',
           'languageCode'
         ]::text[]
       )
       OR NOT app.is_normalized_competitor_domain(
         NEW.value_json ->> 'targetDomain'
       )
       OR NOT app.is_normalized_competitor_domain(
         NEW.value_json ->> 'competitorDomain'
       )
       OR NEW.value_json ->> 'targetDomain'
          = NEW.value_json ->> 'competitorDomain'
       OR NEW.subject_ref IS DISTINCT FROM
          NEW.value_json ->> 'competitorDomain'
       OR jsonb_typeof(NEW.value_json -> 'intersections') <> 'number'
       OR (NEW.value_json ->> 'intersections') !~ '^[1-9][0-9]*$'
       OR jsonb_typeof(NEW.value_json -> 'averagePosition') <> 'number'
       OR (NEW.value_json ->> 'averagePosition')::numeric < 0
       OR jsonb_typeof(NEW.value_json -> 'summedPosition') <> 'number'
       OR (NEW.value_json ->> 'summedPosition')::numeric < 0
       OR jsonb_typeof(
         NEW.value_json -> 'organicEstimatedTrafficVolume'
       ) <> 'number'
       OR (
         NEW.value_json ->> 'organicEstimatedTrafficVolume'
       )::numeric < 0
       OR (NEW.value_json ->> 'marketCode') !~ '^[A-Z]{2}$'
       OR (NEW.value_json ->> 'languageCode') !~ '^[a-z]{2,3}$' THEN
      RAISE EXCEPTION 'DataForSEO competitor-domain observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalized_observations_provenance_guard
  ON app.normalized_observations;
DROP TRIGGER IF EXISTS normalized_observations_dataforseo_provenance_guard
  ON app.normalized_observations;
CREATE TRIGGER normalized_observations_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc' AND NEW.provider <> 'dataforseo')
  EXECUTE FUNCTION app.enforce_normalized_observation_provenance();
CREATE TRIGGER normalized_observations_dataforseo_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (NEW.provider = 'dataforseo')
  EXECUTE FUNCTION app.enforce_dataforseo_observation_provenance();

-- A SERP overlap is an immutable pointer to one exact competitor-domain
-- Observation in the composite Snapshot. It never carries inferred names,
-- relationships, or approved analysis scopes.
ALTER TABLE app.competitor_origin_occurrences
  DROP CONSTRAINT IF EXISTS competitor_origin_occurrences_origin_kind_check,
  DROP CONSTRAINT IF EXISTS competitor_origin_occurrences_check;
ALTER TABLE app.competitor_origin_occurrences
  ADD CONSTRAINT competitor_origin_occurrences_origin_kind_check CHECK (
    origin_kind IN (
      'product_profile',
      'csv_keyword_gap',
      'manual',
      'serp_overlap'
    )
  ),
  ADD CONSTRAINT competitor_origin_occurrences_check CHECK (
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
    OR (
      origin_kind = 'serp_overlap'
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
      AND import_preview_id IS NULL
      AND source_pointer = '/valueJson/competitorDomain'
      AND manual_entry_id IS NULL
      AND observed_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_serp_identity_idx
  ON app.competitor_origin_occurrences(
    normalized_observation_id,
    source_pointer
  )
  WHERE origin_kind = 'serp_overlap';

CREATE OR REPLACE FUNCTION app.enforce_serp_overlap_competitor_origin_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_domain text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'SERP overlap competitor origins are append-only'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.origin_kind <> 'serp_overlap' THEN
    RAISE EXCEPTION 'SERP overlap guard received another origin kind'
      USING ERRCODE = '23514';
  END IF;

  SELECT entity.domain
  INTO entity_domain
  FROM app.competitor_entities entity
  JOIN app.client_projects project
    ON project.id = entity.project_id
   AND project.workspace_id = entity.workspace_id
   AND project.archived_at IS NULL
  WHERE entity.id = NEW.competitor_id
    AND entity.workspace_id = NEW.workspace_id
    AND entity.project_id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERP overlap origin does not match an active scoped entity'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.normalized_observations observation
    JOIN app.data_snapshots snapshot
      ON snapshot.id = observation.snapshot_id
     AND snapshot.id = NEW.data_snapshot_id
     AND snapshot.workspace_id = NEW.workspace_id
     AND snapshot.project_id = NEW.project_id
     AND snapshot.provider = 'dataforseo'
     AND snapshot.dataset_key = 'dataforseo.search_landscape.v1'
     AND snapshot.schema_version = 'dataforseo.search_landscape.v1'
     AND snapshot.method_version = 'dataforseo.search_landscape.v1'
     AND snapshot.source_connection_id IS NOT NULL
    JOIN app.collection_runs collection
      ON collection.id = snapshot.collection_run_id
     AND collection.workspace_id = NEW.workspace_id
     AND collection.project_id = NEW.project_id
     AND collection.site_id = snapshot.site_id
     AND collection.source_connection_id = snapshot.source_connection_id
     AND collection.provider = 'dataforseo'
     AND collection.operation = 'search_landscape'
     AND collection.method_version = 'dataforseo.search_landscape.v1'
     AND collection.import_preview_id IS NULL
    JOIN app.source_connections source
      ON source.id = snapshot.source_connection_id
     AND source.workspace_id = NEW.workspace_id
     AND source.project_id = NEW.project_id
     AND source.site_id = snapshot.site_id
     AND source.provider = 'dataforseo'
    WHERE observation.id = NEW.normalized_observation_id
      AND observation.workspace_id = NEW.workspace_id
      AND observation.project_id = NEW.project_id
      AND observation.provider = 'dataforseo'
      AND observation.metric_key = 'dataforseo.competitor_domain.v1'
      AND observation.subject_type = 'site'
      AND observation.subject_ref = entity_domain
      AND observation.origin = 'vendor_observation'
      AND observation.grade = 'B'
      AND observation.availability = 'available'
      AND observation.support = 'supports'
      AND observation.observed_at = NEW.observed_at
      AND observation.value_json ->> 'competitorDomain' = entity_domain
      AND NEW.source_pointer = '/valueJson/competitorDomain'
  ) THEN
    RAISE EXCEPTION 'SERP overlap origin does not match canonical composite Observation lineage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitor_origins_lineage_guard
  ON app.competitor_origin_occurrences;
DROP TRIGGER IF EXISTS competitor_origins_serp_lineage_guard
  ON app.competitor_origin_occurrences;
DROP TRIGGER IF EXISTS competitor_origins_delete_guard
  ON app.competitor_origin_occurrences;
CREATE TRIGGER competitor_origins_lineage_guard
  BEFORE INSERT OR UPDATE ON app.competitor_origin_occurrences
  FOR EACH ROW
  WHEN (NEW.origin_kind <> 'serp_overlap')
  EXECUTE FUNCTION app.enforce_competitor_origin_lineage();
CREATE TRIGGER competitor_origins_serp_lineage_guard
  BEFORE INSERT OR UPDATE ON app.competitor_origin_occurrences
  FOR EACH ROW
  WHEN (NEW.origin_kind = 'serp_overlap')
  EXECUTE FUNCTION app.enforce_serp_overlap_competitor_origin_lineage();
CREATE TRIGGER competitor_origins_delete_guard
  BEFORE DELETE ON app.competitor_origin_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_competitor_origin_lineage();

-- The source identity serializes independently from the stable domain. A new
-- entity starts as an unreviewed candidate; an existing entity's human
-- governance is deliberately never updated by provider discovery.
CREATE OR REPLACE FUNCTION app.upsert_serp_overlap_competitor_origin(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_domain text,
  selected_data_snapshot_id uuid,
  selected_normalized_observation_id uuid,
  selected_source_pointer text
)
RETURNS TABLE (occurrence_id uuid, competitor_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  entity_row app.competitor_entities%ROWTYPE;
  occurrence_row app.competitor_origin_occurrences%ROWTYPE;
  selected_observed_at timestamptz;
  source_lock_key text;
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
     OR selected_data_snapshot_id IS NULL
     OR selected_normalized_observation_id IS NULL
     OR selected_source_pointer IS DISTINCT FROM
        '/valueJson/competitorDomain' THEN
    RAISE EXCEPTION 'SERP overlap competitor source shape is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT observation.observed_at
  INTO selected_observed_at
  FROM app.normalized_observations observation
  WHERE observation.id = selected_normalized_observation_id;
  IF selected_observed_at IS NULL THEN
    RAISE EXCEPTION 'SERP overlap Observation is absent'
      USING ERRCODE = '23514';
  END IF;

  source_lock_key := 'serp_overlap:'
    || selected_normalized_observation_id::text || ':'
    || selected_source_pointer;
  PERFORM pg_advisory_xact_lock(hashtextextended(source_lock_key, 0));

  SELECT *
  INTO occurrence_row
  FROM app.competitor_origin_occurrences occurrence
  WHERE occurrence.origin_kind = 'serp_overlap'
    AND occurrence.normalized_observation_id =
      selected_normalized_observation_id
    AND occurrence.source_pointer = selected_source_pointer;

  IF occurrence_row.id IS NOT NULL THEN
    SELECT *
    INTO entity_row
    FROM app.competitor_entities entity
    WHERE entity.id = occurrence_row.competitor_id;
    IF occurrence_row.workspace_id IS DISTINCT FROM selected_workspace_id
       OR occurrence_row.project_id IS DISTINCT FROM selected_project_id
       OR entity_row.workspace_id IS DISTINCT FROM selected_workspace_id
       OR entity_row.project_id IS DISTINCT FROM selected_project_id
       OR entity_row.domain IS DISTINCT FROM selected_domain
       OR occurrence_row.source_name IS NOT NULL
       OR occurrence_row.data_snapshot_id IS DISTINCT FROM
          selected_data_snapshot_id
       OR occurrence_row.normalized_observation_id IS DISTINCT FROM
          selected_normalized_observation_id
       OR occurrence_row.import_preview_id IS NOT NULL
       OR occurrence_row.source_pointer IS DISTINCT FROM
          selected_source_pointer
       OR occurrence_row.manual_entry_id IS NOT NULL
       OR occurrence_row.observed_at IS DISTINCT FROM
          selected_observed_at THEN
      RAISE EXCEPTION 'SERP overlap source replay conflicts with immutable provenance'
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
    NULL,
    'candidate',
    NULL,
    ARRAY[]::text[]
  )
  ON CONFLICT (project_id, domain) DO NOTHING
  RETURNING * INTO entity_row;

  IF entity_row.id IS NULL THEN
    SELECT *
    INTO entity_row
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
    workspace_id,
    project_id,
    competitor_id,
    origin_kind,
    source_name,
    data_snapshot_id,
    normalized_observation_id,
    import_preview_id,
    source_pointer,
    manual_entry_id,
    observed_at
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    entity_row.id,
    'serp_overlap',
    NULL,
    selected_data_snapshot_id,
    selected_normalized_observation_id,
    NULL,
    selected_source_pointer,
    NULL,
    selected_observed_at
  )
  RETURNING * INTO occurrence_row;

  RETURN QUERY SELECT occurrence_row.id, entity_row.id;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0034_dataforseo_search_landscape'::text AS migration_version;

COMMIT;
