BEGIN;

-- VOC is an internal evidence authority for the existing Growth Map Keyword
-- Library. It is deliberately not a SourceConnection: customers manage only
-- the product's explicit external connections, while these frozen research
-- and public-review observations retain their own immutable lineage.
ALTER TABLE app.collection_runs
  DROP CONSTRAINT IF EXISTS collection_runs_provider_check,
  DROP CONSTRAINT IF EXISTS collection_runs_operation_check;
ALTER TABLE app.collection_runs
  ADD CONSTRAINT collection_runs_provider_check CHECK (
    provider IN (
      'crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo', 'voc'
    )
  ),
  ADD CONSTRAINT collection_runs_operation_check CHECK (
    operation IN (
      'site_graph',
      'search_analytics',
      'organic_landing',
      'keyword_gap_import',
      'ai_citation_monitor',
      'keyword_evidence_collection'
    )
  );

ALTER TABLE app.data_snapshots
  DROP CONSTRAINT IF EXISTS data_snapshots_provider_check,
  DROP CONSTRAINT IF EXISTS data_snapshots_dataset_key_check;
ALTER TABLE app.data_snapshots
  ADD CONSTRAINT data_snapshots_provider_check CHECK (
    provider IN (
      'crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo', 'voc'
    )
  ),
  ADD CONSTRAINT data_snapshots_dataset_key_check CHECK (
    dataset_key IN (
      'crawl.site_graph.v1',
      'gsc.page_query_daily.v1',
      'ga4.organic_landing_daily.v1',
      'csv.keyword_gap.v1',
      'dataforseo.ranked_keywords.v1',
      'geo.answer_citations.v1',
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
  );

ALTER TABLE app.normalized_observations
  DROP CONSTRAINT IF EXISTS normalized_observations_provider_check;
ALTER TABLE app.normalized_observations
  ADD CONSTRAINT normalized_observations_provider_check CHECK (
    provider IN (
      'crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo', 'voc'
    )
  );

ALTER TABLE app.keyword_occurrences
  DROP CONSTRAINT IF EXISTS keyword_occurrences_source_kind_check;
ALTER TABLE app.keyword_occurrences
  ADD CONSTRAINT keyword_occurrences_source_kind_check CHECK (
    source_kind IN (
      'csv_import',
      'dataforseo_ranked',
      'gsc_top_query',
      'interview_summary',
      'user_review',
      'manual'
    )
  );

-- Keep the complete pre-0029 canonical guard for every existing provider and
-- route only VOC rows through a smaller provider-specific authority. This
-- prevents the new source from weakening Crawl/GSC/GA4/CSV/DataForSEO/GEO.
CREATE OR REPLACE FUNCTION app.enforce_voc_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> 'voc'
     OR NEW.operation <> 'keyword_evidence_collection'
     OR NEW.method_version NOT IN (
       'voc.interview_summary.v1',
       'voc.user_review.v1'
     ) THEN
    RAISE EXCEPTION 'VOC collection run has an unsupported provider, operation, or method'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'VOC collection run must be inserted as an unfinished placeholder'
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
    RAISE EXCEPTION 'VOC collection run source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NOT NULL
     OR NEW.import_preview_id IS NOT NULL
     OR NEW.crawl_seed_site_page_id IS NOT NULL
     OR NEW.crawl_seed_url IS NOT NULL THEN
    RAISE EXCEPTION 'VOC is an internal evidence source, not a customer-managed connection or import preview'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'collection'
  ) THEN
    RAISE EXCEPTION 'VOC collection run scope does not match its async run and site'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'VOC collection run outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.provider = 'voc'
        AND snapshot.method_version = NEW.method_version
        AND snapshot.source_connection_id IS NULL
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
    ) THEN
      RAISE EXCEPTION 'VOC collection run outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_runs_provenance_guard
  ON app.collection_runs;
DROP TRIGGER IF EXISTS collection_runs_voc_provenance_guard
  ON app.collection_runs;
CREATE TRIGGER collection_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc')
  EXECUTE FUNCTION app.enforce_collection_run_provenance();
CREATE TRIGGER collection_runs_voc_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider = 'voc')
  EXECUTE FUNCTION app.enforce_voc_collection_run_provenance();

CREATE OR REPLACE FUNCTION app.enforce_voc_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_scope jsonb;
  timing jsonb;
  expected_source_kind text;
  expected_basis text;
  expected_platform text;
  data_as_of text;
BEGIN
  IF NEW.provider <> 'voc'
     OR NEW.dataset_key NOT IN (
       'voc.interview_summary.v1',
       'voc.user_review.v1'
     )
     OR NEW.method_version <> NEW.dataset_key
     OR NEW.source_connection_id IS NOT NULL THEN
    RAISE EXCEPTION 'VOC snapshot provider, dataset, method, or internal-source identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = 'voc'
      AND run.operation = 'keyword_evidence_collection'
      AND run.method_version = NEW.dataset_key
      AND run.source_connection_id IS NULL
      AND run.import_preview_id IS NULL
  ) THEN
    RAISE EXCEPTION 'VOC snapshot provenance does not match its internal collection run'
      USING ERRCODE = '23514';
  END IF;

  evidence_scope := NEW.summary -> 'keywordEvidenceScope';
  timing := NEW.summary -> 'timing';
  expected_source_kind := CASE NEW.dataset_key
    WHEN 'voc.interview_summary.v1' THEN 'interview_summary'
    WHEN 'voc.user_review.v1' THEN 'user_review'
  END;
  expected_basis := CASE expected_source_kind
    WHEN 'interview_summary' THEN 'customer_research'
    WHEN 'user_review' THEN 'public_review_platform'
  END;
  expected_platform := evidence_scope ->> 'reviewPlatform';
  data_as_of := timing ->> 'dataAsOf';

  IF jsonb_typeof(evidence_scope) <> 'object'
     OR jsonb_typeof(timing) <> 'object'
     OR evidence_scope ->> 'sourceKind' <> expected_source_kind
     OR evidence_scope ->> 'basis' <> expected_basis
     OR evidence_scope ->> 'marketCode' !~ '^[A-Z]{2}$'
     OR NOT app.is_bcp47_language_tag(
       evidence_scope ->> 'languageTag'
     )
     OR jsonb_typeof(timing -> 'collectedAt') <> 'string'
     OR (timing ->> 'collectedAt')::timestamptz <> NEW.captured_at
     OR NOT (timing ? 'dataAsOf')
     OR jsonb_typeof(timing -> 'dataAsOf') NOT IN ('string', 'null')
     OR (
       data_as_of IS NOT NULL
       AND data_as_of::timestamptz > NEW.captured_at
     )
     OR (
       expected_source_kind = 'interview_summary'
       AND evidence_scope ? 'reviewPlatform'
     )
     OR (
       expected_source_kind = 'user_review'
       AND expected_platform NOT IN (
         'app_store', 'g2', 'capterra', 'other'
       )
     ) THEN
    RAISE EXCEPTION 'VOC snapshot lacks a valid frozen evidence scope or timing manifest'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_snapshots_provenance_guard
  ON app.data_snapshots;
DROP TRIGGER IF EXISTS data_snapshots_voc_provenance_guard
  ON app.data_snapshots;
CREATE TRIGGER data_snapshots_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc')
  EXECUTE FUNCTION app.enforce_data_snapshot_provenance();
CREATE TRIGGER data_snapshots_voc_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (NEW.provider = 'voc')
  EXECUTE FUNCTION app.enforce_voc_data_snapshot_provenance();

-- One normalized VOC Observation carries only a single extracted Keyword and
-- bounded customer-safe evidence metadata. Raw interview transcripts, review
-- bodies, authors, and participant data belong in protected raw storage and
-- cannot enter this customer-facing projection.
CREATE OR REPLACE FUNCTION app.enforce_voc_keyword_evidence_observation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_row app.data_snapshots%ROWTYPE;
  source_kind text;
  evidence_scope jsonb;
  timing jsonb;
  keyword_value text;
  market_code text;
  language_tag text;
  evidence_label text;
  source_record_hash text;
  review_platform text;
  source_url text;
  provider_data_as_of text;
  allowed_keys text[];
BEGIN
  SELECT * INTO snapshot_row
  FROM app.data_snapshots snapshot
  WHERE snapshot.id = NEW.snapshot_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.project_id = NEW.project_id
    AND snapshot.provider = 'voc'
    AND snapshot.dataset_key IN (
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
    AND snapshot.source_connection_id IS NULL
  FOR SHARE;

  source_kind := CASE snapshot_row.dataset_key
    WHEN 'voc.interview_summary.v1' THEN 'interview_summary'
    WHEN 'voc.user_review.v1' THEN 'user_review'
  END;
  evidence_scope := snapshot_row.summary -> 'keywordEvidenceScope';
  timing := snapshot_row.summary -> 'timing';
  keyword_value := NEW.value_json ->> 'keyword';
  market_code := NEW.value_json ->> 'marketCode';
  language_tag := NEW.value_json ->> 'languageCode';
  evidence_label := NEW.value_json ->> 'evidenceLabel';
  source_record_hash := NEW.value_json ->> 'sourceRecordHash';
  review_platform := NEW.value_json ->> 'reviewPlatform';
  source_url := NEW.value_json ->> 'sourceUrl';
  provider_data_as_of := NEW.value_json ->> 'providerDataAsOf';
  allowed_keys := CASE source_kind
    WHEN 'interview_summary' THEN ARRAY[
      'keyword',
      'marketCode',
      'languageCode',
      'providerDataAsOf',
      'evidenceLabel',
      'sourceRecordHash'
    ]
    WHEN 'user_review' THEN ARRAY[
      'keyword',
      'marketCode',
      'languageCode',
      'providerDataAsOf',
      'evidenceLabel',
      'sourceRecordHash',
      'reviewPlatform',
      'sourceUrl'
    ]
  END;

  IF snapshot_row.id IS NULL
     OR NEW.provider <> 'voc'
     OR NEW.metric_key <> 'voc.keyword_evidence.v1'
     OR NEW.subject_type <> 'keyword_cluster'
     OR NEW.site_page_id IS NOT NULL
     OR NEW.observed_at <> snapshot_row.captured_at
     OR NEW.availability <> 'available'
     OR NEW.value_numeric IS NOT NULL
     OR NEW.value_text IS NOT NULL
     OR NEW.unit IS NOT NULL
     OR NEW.method <> 'observed'
     OR NEW.support <> 'context'
     OR jsonb_typeof(NEW.value_json) <> 'object'
     OR NEW.value_json - allowed_keys <> '{}'::jsonb
     OR array_length(allowed_keys, 1) <> (
       SELECT count(*) FROM jsonb_object_keys(NEW.value_json)
     )
     OR length(keyword_value) NOT BETWEEN 1 AND 500
     OR keyword_value <> btrim(keyword_value)
     OR market_code <> evidence_scope ->> 'marketCode'
     OR language_tag <> evidence_scope ->> 'languageTag'
     OR source_record_hash !~ '^[0-9a-f]{64}$'
     OR NEW.subject_ref <> 'voc:' || source_record_hash
     OR length(evidence_label) NOT BETWEEN 1 AND 200
     OR evidence_label <> btrim(evidence_label)
     OR provider_data_as_of IS DISTINCT FROM timing ->> 'dataAsOf'
     OR (
       provider_data_as_of IS NOT NULL
       AND provider_data_as_of::timestamptz > NEW.observed_at
     )
     OR (
       source_kind = 'interview_summary'
       AND (
         NEW.origin <> 'user_provided'
         OR NEW.grade <> 'C'
         OR review_platform IS NOT NULL
         OR source_url IS NOT NULL
       )
     )
     OR (
       source_kind = 'user_review'
       AND (
         NEW.origin <> 'direct_public'
         OR NEW.grade <> 'B'
         OR review_platform NOT IN (
           'app_store', 'g2', 'capterra', 'other'
         )
         OR review_platform <> evidence_scope ->> 'reviewPlatform'
         OR (
           source_url IS NOT NULL
           AND (
             length(source_url) > 2048
             OR source_url !~ '^https://'
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'VOC normalized Keyword evidence is not bounded, de-identified, or canonically scoped'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalized_observations_provenance_guard
  ON app.normalized_observations;
DROP TRIGGER IF EXISTS normalized_observations_voc_provenance_guard
  ON app.normalized_observations;
CREATE TRIGGER normalized_observations_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (NEW.provider <> 'voc')
  EXECUTE FUNCTION app.enforce_normalized_observation_provenance();
CREATE TRIGGER normalized_observations_voc_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (NEW.provider = 'voc')
  EXECUTE FUNCTION app.enforce_voc_keyword_evidence_observation();

CREATE OR REPLACE FUNCTION app.enforce_voc_keyword_occurrence_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  observation_row app.normalized_observations%ROWTYPE;
  snapshot_row app.data_snapshots%ROWTYPE;
  collection_row app.collection_runs%ROWTYPE;
  expected_dataset text;
  expected_scope_basis text;
  evidence_keyword text;
  evidence_market text;
  evidence_language text;
  evidence_data_as_of text;
BEGIN
  expected_dataset := CASE NEW.source_kind
    WHEN 'interview_summary' THEN 'voc.interview_summary.v1'
    WHEN 'user_review' THEN 'voc.user_review.v1'
  END;
  expected_scope_basis := CASE NEW.source_kind
    WHEN 'interview_summary' THEN 'user_provided'
    WHEN 'user_review' THEN 'provider_collection_scope'
  END;

  SELECT * INTO observation_row
  FROM app.normalized_observations observation
  WHERE observation.id = NEW.normalized_observation_id
    AND observation.workspace_id = NEW.workspace_id
    AND observation.project_id = NEW.project_id
    AND observation.provider = 'voc'
    AND observation.metric_key = 'voc.keyword_evidence.v1'
    AND observation.observed_at = NEW.collected_at
  FOR SHARE;

  SELECT * INTO snapshot_row
  FROM app.data_snapshots snapshot
  WHERE snapshot.id = NEW.data_snapshot_id
    AND snapshot.id = observation_row.snapshot_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.project_id = NEW.project_id
    AND snapshot.provider = 'voc'
    AND snapshot.dataset_key = expected_dataset
    AND snapshot.source_connection_id IS NULL
  FOR SHARE;

  SELECT * INTO collection_row
  FROM app.collection_runs collection
  WHERE collection.id = snapshot_row.collection_run_id
    AND collection.workspace_id = NEW.workspace_id
    AND collection.project_id = NEW.project_id
    AND collection.site_id = snapshot_row.site_id
    AND collection.provider = 'voc'
    AND collection.operation = 'keyword_evidence_collection'
    AND collection.method_version = expected_dataset
    AND collection.source_connection_id IS NULL
    AND collection.import_preview_id IS NULL
  FOR SHARE;

  evidence_keyword := observation_row.value_json ->> 'keyword';
  evidence_market := observation_row.value_json ->> 'marketCode';
  evidence_language := observation_row.value_json ->> 'languageCode';
  evidence_data_as_of :=
    observation_row.value_json ->> 'providerDataAsOf';

  IF NEW.source_kind NOT IN ('interview_summary', 'user_review')
     OR observation_row.id IS NULL
     OR snapshot_row.id IS NULL
     OR collection_row.id IS NULL
     OR NEW.scope_basis <> expected_scope_basis
     OR NEW.source_pointer <> '/valueJson/keyword'
     OR NEW.source_ref <> (
       'observation:' || NEW.normalized_observation_id::text
       || '#/valueJson/keyword'
     )
     OR NEW.query_kind <> 'search_query'
     OR regexp_replace(
       lower(btrim(evidence_keyword)),
       '[[:space:]]+',
       ' ',
       'g'
     ) <> NEW.normalized_keyword
     OR upper(evidence_market) <> NEW.market
     OR lower(evidence_language) <> lower(NEW.language_tag)
     OR evidence_data_as_of IS DISTINCT FROM (
       snapshot_row.summary #>> '{timing,dataAsOf}'
     )
     OR (
       evidence_data_as_of IS NULL
       AND NEW.provider_data_as_of IS NOT NULL
     )
     OR (
       evidence_data_as_of IS NOT NULL
       AND (
         NEW.provider_data_as_of IS NULL
         OR evidence_data_as_of::timestamptz
           <> NEW.provider_data_as_of
       )
     ) THEN
    RAISE EXCEPTION 'VOC Keyword occurrence lacks exact immutable evidence lineage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_occurrences_lineage_guard
  ON app.keyword_occurrences;
DROP TRIGGER IF EXISTS keyword_occurrences_voc_lineage_guard
  ON app.keyword_occurrences;
CREATE TRIGGER keyword_occurrences_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  WHEN (
    NEW.source_kind NOT IN ('interview_summary', 'user_review')
  )
  EXECUTE FUNCTION app.enforce_keyword_occurrence_lineage();
CREATE TRIGGER keyword_occurrences_voc_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  WHEN (
    NEW.source_kind IN ('interview_summary', 'user_review')
  )
  EXECUTE FUNCTION app.enforce_voc_keyword_occurrence_lineage();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0029_keyword_voc_sources'::text AS migration_version;

COMMIT;
