BEGIN;

-- Search Landscape v2 keeps every historical DataForSEO identity readable
-- while admitting the exact 1-100 / seed-fallback collection contract.
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
      'geo.answer_citations.v1',
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
  );

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
        'dataforseo.search_landscape.v2'
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
            'dataforseo.search_landscape.v2'
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
       'dataforseo.search_landscape.v2'
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

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0037_dataforseo_search_landscape_v2'::text AS migration_version;

COMMIT;
