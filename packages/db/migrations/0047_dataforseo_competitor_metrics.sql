BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Search Landscape v3 is the composite organic + optional fixed-cohort AI
-- identity. Historical v1/v2 Snapshots remain readable and immutable.
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
      'dataforseo.search_landscape.v2',
      'dataforseo.search_landscape.v3',
      'dataforseo.backlinks.v1',
      'geo.answer_citations.v1',
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
  ) NOT VALID;

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
      AND NEW.method_version IN (
        'dataforseo.search_landscape.v1',
        'dataforseo.search_landscape.v2',
        'dataforseo.search_landscape.v3'
      )
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
            AND snapshot.dataset_key = NEW.method_version
            AND snapshot.schema_version = NEW.method_version
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
     AND snapshot.dataset_key IN (
       'dataforseo.search_landscape.v1',
       'dataforseo.search_landscape.v2',
       'dataforseo.search_landscape.v3'
     )
     AND snapshot.schema_version = snapshot.dataset_key
     AND snapshot.method_version = snapshot.dataset_key
     AND snapshot.source_connection_id IS NOT NULL
    JOIN app.collection_runs collection
      ON collection.id = snapshot.collection_run_id
     AND collection.workspace_id = NEW.workspace_id
     AND collection.project_id = NEW.project_id
     AND collection.site_id = snapshot.site_id
     AND collection.source_connection_id = snapshot.source_connection_id
     AND collection.provider = 'dataforseo'
     AND collection.operation = 'search_landscape'
     AND collection.method_version = snapshot.method_version
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
      AND (
        (
          snapshot.dataset_key = 'dataforseo.search_landscape.v1'
          AND observation.metric_key = 'dataforseo.competitor_domain.v1'
        )
        OR (
          snapshot.dataset_key = 'dataforseo.search_landscape.v2'
          AND observation.metric_key IN (
            'dataforseo.competitor_domain.v1',
            'dataforseo.serp_competitor.v1'
          )
        )
        OR (
          snapshot.dataset_key = 'dataforseo.search_landscape.v3'
          AND observation.metric_key IN (
            'dataforseo.competitor_domain.v2',
            'dataforseo.serp_competitor.v1'
          )
        )
      )
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

CREATE OR REPLACE FUNCTION app.enforce_ai_citation_competitor_origin_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entity_domain text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION 'AI citation competitor origins are append-only'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.origin_kind <> 'ai_citation' THEN
    RAISE EXCEPTION 'AI citation guard received another origin kind'
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
    RAISE EXCEPTION 'AI citation origin does not match an active scoped entity'
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
     AND snapshot.dataset_key = 'dataforseo.search_landscape.v3'
     AND snapshot.schema_version = 'dataforseo.search_landscape.v3'
     AND snapshot.method_version = 'dataforseo.search_landscape.v3'
     AND snapshot.source_connection_id IS NOT NULL
    JOIN app.collection_runs collection
      ON collection.id = snapshot.collection_run_id
     AND collection.workspace_id = NEW.workspace_id
     AND collection.project_id = NEW.project_id
     AND collection.site_id = snapshot.site_id
     AND collection.source_connection_id = snapshot.source_connection_id
     AND collection.provider = 'dataforseo'
     AND collection.operation = 'search_landscape'
     AND collection.method_version = 'dataforseo.search_landscape.v3'
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
      AND observation.metric_key = 'dataforseo.competitor_ai_citation.v1'
      AND observation.subject_type = 'site'
      AND observation.subject_ref = entity_domain
      AND observation.origin = 'vendor_observation'
      AND observation.grade = 'B'
      AND observation.availability = 'available'
      AND observation.support = 'supports'
      AND observation.observed_at = NEW.observed_at
      AND observation.value_json ->> 'competitorDomain' = entity_domain
      AND (observation.value_json ->> 'observedQueries')::integer > 0
      AND NEW.source_pointer = '/valueJson/competitorDomain'
  ) THEN
    RAISE EXCEPTION 'AI citation origin does not match canonical observed aggregate lineage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitor_origins_lineage_guard
  ON app.competitor_origin_occurrences;
DROP TRIGGER IF EXISTS competitor_origins_serp_lineage_guard
  ON app.competitor_origin_occurrences;
DROP TRIGGER IF EXISTS competitor_origins_ai_citation_lineage_guard
  ON app.competitor_origin_occurrences;
CREATE TRIGGER competitor_origins_lineage_guard
  BEFORE INSERT OR UPDATE ON app.competitor_origin_occurrences
  FOR EACH ROW
  WHEN (NEW.origin_kind NOT IN ('serp_overlap','ai_citation'))
  EXECUTE FUNCTION app.enforce_competitor_origin_lineage();
CREATE TRIGGER competitor_origins_serp_lineage_guard
  BEFORE INSERT OR UPDATE ON app.competitor_origin_occurrences
  FOR EACH ROW
  WHEN (NEW.origin_kind = 'serp_overlap')
  EXECUTE FUNCTION app.enforce_serp_overlap_competitor_origin_lineage();
CREATE TRIGGER competitor_origins_ai_citation_lineage_guard
  BEFORE INSERT OR UPDATE ON app.competitor_origin_occurrences
  FOR EACH ROW
  WHEN (NEW.origin_kind = 'ai_citation')
  EXECUTE FUNCTION app.enforce_ai_citation_competitor_origin_lineage();

CREATE OR REPLACE FUNCTION app.upsert_ai_citation_competitor_origin(
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
    RAISE EXCEPTION 'AI citation competitor source shape is invalid'
      USING ERRCODE = '23514';
  END IF;

  SELECT observation.observed_at
  INTO selected_observed_at
  FROM app.normalized_observations observation
  WHERE observation.id = selected_normalized_observation_id;
  IF selected_observed_at IS NULL THEN
    RAISE EXCEPTION 'AI citation Observation is absent'
      USING ERRCODE = '23514';
  END IF;

  source_lock_key := 'ai_citation:'
    || selected_normalized_observation_id::text || ':'
    || selected_source_pointer;
  PERFORM pg_advisory_xact_lock(hashtextextended(source_lock_key, 0));

  SELECT *
  INTO occurrence_row
  FROM app.competitor_origin_occurrences occurrence
  WHERE occurrence.origin_kind = 'ai_citation'
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
      RAISE EXCEPTION 'AI citation source replay conflicts with immutable provenance'
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
    'ai_citation',
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
        OR (
          run.operation = 'search_landscape'
          AND run.method_version = 'dataforseo.search_landscape.v2'
          AND snapshot.dataset_key = 'dataforseo.search_landscape.v2'
          AND snapshot.schema_version = 'dataforseo.search_landscape.v2'
          AND snapshot.method_version = 'dataforseo.search_landscape.v2'
          AND NEW.metric_key IN (
            'csv.keyword_gap.v1',
            'dataforseo.competitor_domain.v1',
            'dataforseo.serp_competitor.v1'
          )
        )
        OR (
          run.operation = 'search_landscape'
          AND run.method_version = 'dataforseo.search_landscape.v3'
          AND snapshot.dataset_key = 'dataforseo.search_landscape.v3'
          AND snapshot.schema_version = 'dataforseo.search_landscape.v3'
          AND snapshot.method_version = 'dataforseo.search_landscape.v3'
          AND NEW.metric_key IN (
            'csv.keyword_gap.v1',
            'dataforseo.competitor_domain.v2',
            'dataforseo.serp_competitor.v1',
            'dataforseo.competitor_ai_citation.v1'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'DataForSEO observation does not match its exact Snapshot lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.metric_key IN (
    'dataforseo.competitor_domain.v1',
    'dataforseo.serp_competitor.v1'
  ) THEN
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
       OR jsonb_typeof(NEW.value_json -> 'averagePosition') <> 'number'
       OR (NEW.value_json ->> 'averagePosition')::numeric < 0
       OR jsonb_typeof(
         NEW.value_json -> 'organicEstimatedTrafficVolume'
       ) <> 'number'
       OR (
         NEW.value_json ->> 'organicEstimatedTrafficVolume'
       )::numeric < 0
       OR (NEW.value_json ->> 'marketCode') !~ '^[A-Z]{2}$'
       OR (NEW.value_json ->> 'languageCode') !~ '^[a-z]{2,3}$' THEN
      RAISE EXCEPTION 'DataForSEO competitor observation common shape is invalid'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.metric_key = 'dataforseo.competitor_domain.v1' AND (
      value_key_count <> 8
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
      OR jsonb_typeof(NEW.value_json -> 'intersections') <> 'number'
      OR (NEW.value_json ->> 'intersections') !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(NEW.value_json -> 'summedPosition') <> 'number'
      OR (NEW.value_json ->> 'summedPosition')::numeric < 0
    ) THEN
      RAISE EXCEPTION 'DataForSEO competitor-domain observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.metric_key = 'dataforseo.serp_competitor.v1' AND (
      value_key_count <> 12
      OR NOT (
        NEW.value_json ?& ARRAY[
          'targetDomain',
          'competitorDomain',
          'averagePosition',
          'medianPosition',
          'rating',
          'organicEstimatedTrafficVolume',
          'keywordsCount',
          'visibility',
          'relevantSerpItems',
          'seedCount',
          'marketCode',
          'languageCode'
        ]::text[]
      )
      OR jsonb_typeof(NEW.value_json -> 'medianPosition') <> 'number'
      OR (NEW.value_json ->> 'medianPosition')::numeric < 0
      OR jsonb_typeof(NEW.value_json -> 'rating') <> 'number'
      OR (NEW.value_json ->> 'rating')::numeric < 0
      OR jsonb_typeof(NEW.value_json -> 'keywordsCount') <> 'number'
      OR (NEW.value_json ->> 'keywordsCount') !~ '^(0|[1-9][0-9]*)$'
      OR jsonb_typeof(NEW.value_json -> 'visibility') <> 'number'
      OR (NEW.value_json ->> 'visibility')::numeric < 0
      OR jsonb_typeof(NEW.value_json -> 'relevantSerpItems') <> 'number'
      OR (NEW.value_json ->> 'relevantSerpItems') !~ '^(0|[1-9][0-9]*)$'
      OR jsonb_typeof(NEW.value_json -> 'seedCount') <> 'number'
      OR (NEW.value_json ->> 'seedCount') !~ '^[1-9][0-9]*$'
    ) THEN
      RAISE EXCEPTION 'DataForSEO SERP-competitor observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.metric_key = 'dataforseo.competitor_domain.v2' THEN
    IF NEW.subject_type <> 'site'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.availability <> 'available'
       OR NEW.value_numeric IS NOT NULL
       OR NEW.value_text IS NOT NULL
       OR NEW.unit IS NOT NULL
       OR NEW.support <> 'supports'
       OR NOT app.is_dataforseo_competitor_domain_v2(NEW.value_json)
       OR NEW.subject_ref IS DISTINCT FROM
          NEW.value_json ->> 'competitorDomain' THEN
      RAISE EXCEPTION 'DataForSEO competitor-domain v2 observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.metric_key = 'dataforseo.competitor_ai_citation.v1' THEN
    IF NEW.subject_type <> 'site'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.availability <> 'available'
       OR NEW.value_numeric IS NOT NULL
       OR NEW.value_text IS NOT NULL
       OR NEW.unit IS NOT NULL
       OR NEW.support <> 'supports'
       OR NOT app.is_dataforseo_competitor_ai_citation_v1(NEW.value_json)
       OR NEW.subject_ref IS DISTINCT FROM
          NEW.value_json ->> 'competitorDomain'
       OR NEW.limitation IS NULL
       OR length(NEW.limitation) NOT BETWEEN 1 AND 2000
       OR NEW.limitation <> btrim(NEW.limitation) THEN
      RAISE EXCEPTION 'DataForSEO competitor AI-citation observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Provider origins are immutable pointers; no unavailable aggregate is an
-- origin, and a measured zero is allowed only after at least one observed query.
ALTER TABLE app.competitor_origin_occurrences
  DROP CONSTRAINT IF EXISTS competitor_origin_occurrences_origin_kind_check,
  DROP CONSTRAINT IF EXISTS competitor_origin_occurrences_check;
ALTER TABLE app.competitor_origin_occurrences
  ADD CONSTRAINT competitor_origin_occurrences_origin_kind_check CHECK (
    origin_kind IN (
      'product_profile',
      'csv_keyword_gap',
      'manual',
      'serp_overlap',
      'ai_citation'
    )
  ) NOT VALID,
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
      origin_kind IN ('serp_overlap','ai_citation')
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
  ) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS competitor_origins_ai_citation_identity_idx
  ON app.competitor_origin_occurrences(
    normalized_observation_id,
    source_pointer
  )
  WHERE origin_kind = 'ai_citation';

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
          AND run.method_version IN (
            'dataforseo.search_landscape.v1',
            'dataforseo.search_landscape.v2',
            'dataforseo.search_landscape.v3'
          )
          AND NEW.dataset_key = run.method_version
          AND NEW.schema_version = run.method_version
          AND NEW.method_version = run.method_version
        )
      )
  ) THEN
    RAISE EXCEPTION 'DataForSEO snapshot does not match an exact collection identity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.is_dataforseo_competitor_domain_v2(
  candidate jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  intersections numeric;
  target_organic_keyword_count numeric;
  serp_overlap numeric;
BEGIN
  IF jsonb_typeof(candidate) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(candidate)) <> 10
     OR NOT (candidate ?& ARRAY[
       'targetDomain',
       'competitorDomain',
       'intersections',
       'targetOrganicKeywordCount',
       'serpOverlap',
       'averagePosition',
       'summedPosition',
       'organicEstimatedTrafficVolume',
       'marketCode',
       'languageCode'
     ]::text[])
     OR NOT app.is_normalized_competitor_domain(candidate ->> 'targetDomain')
     OR NOT app.is_normalized_competitor_domain(candidate ->> 'competitorDomain')
     OR candidate ->> 'targetDomain' = candidate ->> 'competitorDomain'
     OR jsonb_typeof(candidate -> 'intersections') <> 'number'
     OR (candidate ->> 'intersections') !~ '^[1-9][0-9]*$'
     OR (candidate ->> 'intersections')::numeric > 9007199254740991
     OR jsonb_typeof(candidate -> 'targetOrganicKeywordCount') <> 'number'
     OR (candidate ->> 'targetOrganicKeywordCount') !~ '^[1-9][0-9]*$'
     OR (candidate ->> 'targetOrganicKeywordCount')::numeric > 9007199254740991
     OR jsonb_typeof(candidate -> 'serpOverlap') <> 'number'
     OR jsonb_typeof(candidate -> 'averagePosition') <> 'number'
     OR (candidate ->> 'averagePosition')::numeric < 0
     OR jsonb_typeof(candidate -> 'summedPosition') <> 'number'
     OR (candidate ->> 'summedPosition')::numeric < 0
     OR jsonb_typeof(candidate -> 'organicEstimatedTrafficVolume') <> 'number'
     OR (candidate ->> 'organicEstimatedTrafficVolume')::numeric < 0
     OR (candidate ->> 'marketCode') !~ '^[A-Z]{2}$'
     OR (candidate ->> 'languageCode') !~ '^[a-z]{2,3}$' THEN
    RETURN false;
  END IF;

  intersections := (candidate ->> 'intersections')::numeric;
  target_organic_keyword_count :=
    (candidate ->> 'targetOrganicKeywordCount')::numeric;
  serp_overlap := (candidate ->> 'serpOverlap')::numeric;
  IF intersections > target_organic_keyword_count
     OR serp_overlap <= 0
     OR serp_overlap > 1
     OR serp_overlap IS DISTINCT FROM
        round(intersections / target_organic_keyword_count, 12) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app.is_dataforseo_competitor_ai_citation_v1(
  candidate jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  attempted_queries integer;
  observed_queries integer;
  cited_queries integer;
  unavailable_queries integer;
  observed_outcomes integer := 0;
  cited_outcomes integer := 0;
  unavailable_outcomes integer := 0;
  outcome jsonb;
  outcome_key_count integer;
  seen_entity_ids text[] := ARRAY[]::text[];
  seen_query_hashes text[] := ARRAY[]::text[];
  entity_id text;
  query_hash text;
  query_revision integer;
  outcome_availability text;
  outcome_cited boolean;
BEGIN
  IF jsonb_typeof(candidate) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(candidate)) <> 13
     OR NOT (candidate ?& ARRAY[
       'targetDomain',
       'competitorDomain',
       'attemptedQueries',
       'observedQueries',
       'citedQueries',
       'unavailableQueries',
       'cohortCoverage',
       'querySetHash',
       'platform',
       'model',
       'marketCode',
       'languageTag',
       'queryOutcomes'
     ]::text[])
     OR NOT app.is_normalized_competitor_domain(candidate ->> 'targetDomain')
     OR NOT app.is_normalized_competitor_domain(candidate ->> 'competitorDomain')
     OR candidate ->> 'targetDomain' = candidate ->> 'competitorDomain'
     OR jsonb_typeof(candidate -> 'attemptedQueries') <> 'number'
     OR jsonb_typeof(candidate -> 'observedQueries') <> 'number'
     OR jsonb_typeof(candidate -> 'citedQueries') <> 'number'
     OR jsonb_typeof(candidate -> 'unavailableQueries') <> 'number'
     OR (candidate ->> 'attemptedQueries') !~ '^(0|[1-9][0-9]*)$'
     OR (candidate ->> 'observedQueries') !~ '^(0|[1-9][0-9]*)$'
     OR (candidate ->> 'citedQueries') !~ '^(0|[1-9][0-9]*)$'
     OR (candidate ->> 'unavailableQueries') !~ '^(0|[1-9][0-9]*)$'
     OR candidate ->> 'cohortCoverage' NOT IN ('complete','partial')
     OR (candidate ->> 'querySetHash') !~ '^[a-f0-9]{64}$'
     OR candidate ->> 'platform' <> 'chat_gpt'
     OR length(candidate ->> 'model') NOT BETWEEN 1 AND 160
     OR candidate ->> 'model' <> btrim(candidate ->> 'model')
     OR (candidate ->> 'marketCode') !~ '^[A-Z]{2}$'
     OR NOT app.is_bcp47_language_tag(candidate ->> 'languageTag')
     OR jsonb_typeof(candidate -> 'queryOutcomes') <> 'array'
     OR jsonb_array_length(candidate -> 'queryOutcomes') <> 20 THEN
    RETURN false;
  END IF;

  attempted_queries := (candidate ->> 'attemptedQueries')::integer;
  observed_queries := (candidate ->> 'observedQueries')::integer;
  cited_queries := (candidate ->> 'citedQueries')::integer;
  unavailable_queries := (candidate ->> 'unavailableQueries')::integer;
  IF attempted_queries <> 20
     OR observed_queries <= 0
     OR observed_queries > attempted_queries
     OR observed_queries + unavailable_queries <> attempted_queries
     OR cited_queries > observed_queries
     OR candidate ->> 'cohortCoverage' IS DISTINCT FROM
        (CASE WHEN observed_queries = 20 THEN 'complete' ELSE 'partial' END) THEN
    RETURN false;
  END IF;

  FOR outcome IN
    SELECT value FROM jsonb_array_elements(candidate -> 'queryOutcomes')
  LOOP
    IF jsonb_typeof(outcome) <> 'object' THEN
      RETURN false;
    END IF;
    SELECT count(*)::integer
      INTO outcome_key_count
      FROM jsonb_object_keys(outcome);
    IF outcome_key_count <> 5
       OR NOT (outcome ?& ARRAY[
         'queryEntityId',
         'queryRevision',
         'queryHash',
         'availability',
         'cited'
       ]::text[])
       OR (outcome ->> 'queryEntityId') !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(outcome -> 'queryRevision') <> 'number'
       OR (outcome ->> 'queryRevision') !~ '^[1-9][0-9]*$'
       OR (outcome ->> 'queryRevision')::numeric > 2147483647
       OR (outcome ->> 'queryHash') !~ '^[a-f0-9]{64}$'
       OR outcome ->> 'availability' NOT IN ('available','unavailable')
       OR jsonb_typeof(outcome -> 'cited') <> 'boolean' THEN
      RETURN false;
    END IF;

    entity_id := outcome ->> 'queryEntityId';
    query_revision := (outcome ->> 'queryRevision')::integer;
    query_hash := outcome ->> 'queryHash';
    outcome_availability := outcome ->> 'availability';
    outcome_cited := (outcome ->> 'cited')::boolean;
    IF entity_id = ANY(seen_entity_ids)
       OR query_hash = ANY(seen_query_hashes)
       OR query_revision < 1
       OR (outcome_availability = 'unavailable' AND outcome_cited) THEN
      RETURN false;
    END IF;
    seen_entity_ids := array_append(seen_entity_ids, entity_id);
    seen_query_hashes := array_append(seen_query_hashes, query_hash);

    IF outcome_availability = 'available' THEN
      observed_outcomes := observed_outcomes + 1;
      IF outcome_cited THEN
        cited_outcomes := cited_outcomes + 1;
      END IF;
    ELSE
      unavailable_outcomes := unavailable_outcomes + 1;
    END IF;
  END LOOP;

  RETURN observed_outcomes = observed_queries
    AND cited_outcomes = cited_queries
    AND unavailable_outcomes = unavailable_queries;
END;
$$;

-- Analysis Refresh keeps the historical five/six-step plan shapes; only the
-- exact DataForSEO child/Snapshot identity gains the current v3 member.
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
          NEW.ordinal = 5
          AND NEW.step_key = 'dataforseo_backlinks'
          AND NOT NEW.required
        )
        OR (
          NEW.ordinal = 6
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
    WHEN 'growth_audit' THEN NULL
    ELSE NEW.step_key
  END;

  IF NEW.child_async_run_id IS NOT NULL THEN
    expected_child_kind := CASE
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
            AND collection.operation = 'backlinks'
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
          AND snapshot.dataset_key = 'dataforseo.backlinks.v1'
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

ALTER TABLE app.data_snapshots
  VALIDATE CONSTRAINT data_snapshots_dataset_key_check;
ALTER TABLE app.competitor_origin_occurrences
  VALIDATE CONSTRAINT competitor_origin_occurrences_origin_kind_check;
ALTER TABLE app.competitor_origin_occurrences
  VALIDATE CONSTRAINT competitor_origin_occurrences_check;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0047_dataforseo_competitor_metrics'::text AS migration_version;

COMMIT;
