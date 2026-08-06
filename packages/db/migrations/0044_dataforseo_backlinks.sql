BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- DataForSEO Backlinks is an optional, bounded Provider collection. Keep the
-- historical ranked-keyword and Search Landscape identities unchanged and
-- route only the new method through the new guards below.
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
      'search_landscape',
      'backlinks'
    )
  ) NOT VALID;

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
      'dataforseo.backlinks.v1',
      'geo.answer_citations.v1',
      'voc.interview_summary.v1',
      'voc.user_review.v1'
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION app.enforce_dataforseo_backlinks_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT (
    NEW.provider = 'dataforseo'
    AND NEW.operation = 'backlinks'
    AND NEW.method_version = 'dataforseo.backlinks.v1'
  ) THEN
    RAISE EXCEPTION 'DataForSEO Backlinks collection identity is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'DataForSEO Backlinks collection run must begin unfinished'
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
    RAISE EXCEPTION 'DataForSEO Backlinks collection source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NULL
     OR NEW.import_preview_id IS NOT NULL
     OR NEW.crawl_seed_site_page_id IS NOT NULL
     OR NEW.crawl_seed_url IS NOT NULL THEN
    RAISE EXCEPTION 'DataForSEO Backlinks collection source shape is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    JOIN app.sites site
      ON site.id = NEW.site_id
     AND site.workspace_id = NEW.workspace_id
     AND site.project_id = NEW.project_id
     AND site.is_primary
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
    RAISE EXCEPTION 'DataForSEO Backlinks collection scope or source connection is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'DataForSEO Backlinks collection outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.source_connection_id = NEW.source_connection_id
        AND snapshot.provider = 'dataforseo'
        AND snapshot.dataset_key = 'dataforseo.backlinks.v1'
        AND snapshot.schema_version = 'dataforseo.backlinks.v1'
        AND snapshot.method_version = 'dataforseo.backlinks.v1'
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
    ) THEN
      RAISE EXCEPTION 'DataForSEO Backlinks outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_runs_dataforseo_provenance_guard
  ON app.collection_runs;
DROP TRIGGER IF EXISTS collection_runs_dataforseo_backlinks_provenance_guard
  ON app.collection_runs;
CREATE TRIGGER collection_runs_dataforseo_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider = 'dataforseo' AND NEW.operation <> 'backlinks')
  EXECUTE FUNCTION app.enforce_dataforseo_collection_run_provenance();
CREATE TRIGGER collection_runs_dataforseo_backlinks_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  WHEN (NEW.provider = 'dataforseo' AND NEW.operation = 'backlinks')
  EXECUTE FUNCTION app.enforce_dataforseo_backlinks_collection_run_provenance();

CREATE OR REPLACE FUNCTION app.enforce_dataforseo_backlinks_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider <> 'dataforseo'
     OR NEW.dataset_key <> 'dataforseo.backlinks.v1'
     OR NEW.schema_version <> 'dataforseo.backlinks.v1'
     OR NEW.method_version <> 'dataforseo.backlinks.v1'
     OR NEW.source_connection_id IS NULL THEN
    RAISE EXCEPTION 'DataForSEO Backlinks snapshot identity is invalid'
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
      AND run.operation = 'backlinks'
      AND run.method_version = 'dataforseo.backlinks.v1'
      AND run.import_preview_id IS NULL
  ) THEN
    RAISE EXCEPTION 'DataForSEO Backlinks snapshot does not match its exact collection identity'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_snapshots_dataforseo_provenance_guard
  ON app.data_snapshots;
DROP TRIGGER IF EXISTS data_snapshots_dataforseo_backlinks_provenance_guard
  ON app.data_snapshots;
CREATE TRIGGER data_snapshots_dataforseo_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (
    NEW.provider = 'dataforseo'
    AND NEW.dataset_key <> 'dataforseo.backlinks.v1'
  )
  EXECUTE FUNCTION app.enforce_dataforseo_data_snapshot_provenance();
CREATE TRIGGER data_snapshots_dataforseo_backlinks_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  WHEN (
    NEW.provider = 'dataforseo'
    AND NEW.dataset_key = 'dataforseo.backlinks.v1'
  )
  EXECUTE FUNCTION app.enforce_dataforseo_backlinks_data_snapshot_provenance();

CREATE OR REPLACE FUNCTION app.enforce_dataforseo_backlinks_observation_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  value_key_count integer;
  verification jsonb;
BEGIN
  IF NEW.provider <> 'dataforseo'
     OR NEW.origin <> 'vendor_observation'
     OR NEW.grade <> 'B'
     OR NEW.availability <> 'available'
     OR NEW.value_numeric IS NOT NULL
     OR NEW.value_text IS NOT NULL
     OR jsonb_typeof(NEW.value_json) <> 'object'
     OR NEW.unit IS NOT NULL
     OR NEW.support <> 'supports'
     OR NEW.metric_key NOT IN (
       'dataforseo.backlink_summary.v1',
       'dataforseo.backlink.v1',
       'dataforseo.referring_domain.v1',
       'dataforseo.backlink_page.v1'
     ) THEN
    RAISE EXCEPTION 'DataForSEO Backlinks observation trust identity is invalid'
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
     AND run.operation = 'backlinks'
     AND run.method_version = 'dataforseo.backlinks.v1'
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
      AND snapshot.dataset_key = 'dataforseo.backlinks.v1'
      AND snapshot.schema_version = 'dataforseo.backlinks.v1'
      AND snapshot.method_version = 'dataforseo.backlinks.v1'
      AND snapshot.captured_at = NEW.observed_at
  ) THEN
    RAISE EXCEPTION 'DataForSEO Backlinks observation does not match its exact Snapshot lineage'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)::integer
  INTO value_key_count
  FROM jsonb_object_keys(NEW.value_json);

  IF NEW.metric_key = 'dataforseo.backlink_summary.v1' THEN
    IF NEW.subject_type <> 'site'
       OR NEW.site_page_id IS NOT NULL
       OR value_key_count <> 4
       OR NOT (NEW.value_json ?& ARRAY[
         'targetDomain', 'rank', 'backlinks', 'referringDomains'
       ]::text[])
       OR NOT app.is_normalized_competitor_domain(
         NEW.value_json ->> 'targetDomain'
       )
       OR NEW.subject_ref IS DISTINCT FROM NEW.value_json ->> 'targetDomain'
       OR jsonb_typeof(NEW.value_json -> 'rank') <> 'number'
       OR jsonb_typeof(NEW.value_json -> 'backlinks') <> 'number'
       OR jsonb_typeof(NEW.value_json -> 'referringDomains') <> 'number'
       OR (NEW.value_json ->> 'rank') !~ '^(0|[1-9][0-9]?|100)(\.[0-9]+)?$'
       OR (NEW.value_json ->> 'backlinks') !~ '^(0|[1-9][0-9]*)$'
       OR (NEW.value_json ->> 'referringDomains') !~ '^(0|[1-9][0-9]*)$' THEN
      RAISE EXCEPTION 'DataForSEO backlink summary observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.metric_key = 'dataforseo.backlink.v1' THEN
    verification := NEW.value_json -> 'verification';
    IF NEW.subject_type <> 'url'
       OR value_key_count <> 12
       OR NOT (NEW.value_json ?& ARRAY[
         'sourceRef',
         'referringDomain',
         'sourceUrl',
         'targetUrl',
         'sourceRank',
         'linkKind',
         'anchorText',
         'firstSeenAt',
         'lastSeenAt',
         'isNew',
         'isLost',
         'verification'
       ]::text[])
       OR length(NEW.value_json ->> 'sourceRef') NOT BETWEEN 1 AND 500
       OR NOT app.is_normalized_competitor_domain(
         NEW.value_json ->> 'referringDomain'
       )
       OR (NEW.value_json ->> 'sourceUrl') !~ '^https?://'
       OR (NEW.value_json ->> 'targetUrl') !~ '^https?://'
       OR NEW.subject_ref IS DISTINCT FROM NEW.value_json ->> 'targetUrl'
       OR jsonb_typeof(NEW.value_json -> 'sourceRank') <> 'number'
       OR (NEW.value_json ->> 'sourceRank') !~ '^(0|[1-9][0-9]?|100)(\.[0-9]+)?$'
       OR NEW.value_json ->> 'linkKind' NOT IN (
         'dofollow', 'nofollow', 'ugc', 'sponsored', 'unknown'
       )
       OR jsonb_typeof(NEW.value_json -> 'isNew') <> 'boolean'
       OR jsonb_typeof(NEW.value_json -> 'isLost') <> 'boolean'
       OR length(NEW.value_json ->> 'firstSeenAt') NOT BETWEEN 1 AND 80
       OR length(NEW.value_json ->> 'lastSeenAt') NOT BETWEEN 1 AND 80
       OR (
         NEW.site_page_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM app.site_pages page
           JOIN app.data_snapshots snapshot
             ON snapshot.id = NEW.snapshot_id
            AND snapshot.workspace_id = NEW.workspace_id
            AND snapshot.project_id = NEW.project_id
            AND snapshot.site_id = page.site_id
           WHERE page.id = NEW.site_page_id
             AND page.workspace_id = NEW.workspace_id
             AND page.project_id = NEW.project_id
             AND page.normalized_url = NEW.subject_ref
         )
       ) THEN
      RAISE EXCEPTION 'DataForSEO backlink detail observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;

    IF verification IS NOT NULL
       AND jsonb_typeof(verification) <> 'null' THEN
      IF jsonb_typeof(verification) <> 'object'
         OR verification ->> 'status' NOT IN (
           'verified', 'absent', 'blocked', 'inconclusive'
         )
         OR length(verification ->> 'checkedAt') NOT BETWEEN 1 AND 80
         OR (
           verification ->> 'finalUrl' IS NOT NULL
           AND (verification ->> 'finalUrl') !~ '^https?://'
         )
         OR (
           verification -> 'httpStatus' IS NOT NULL
           AND jsonb_typeof(verification -> 'httpStatus') <> 'null'
           AND (
             jsonb_typeof(verification -> 'httpStatus') <> 'number'
             OR (verification ->> 'httpStatus') !~ '^[1-5][0-9][0-9]$'
           )
         )
         OR (
           verification ->> 'limitation' IS NOT NULL
           AND length(verification ->> 'limitation') NOT BETWEEN 1 AND 2000
         )
         OR (
           verification ->> 'status' IN ('verified','absent')
           AND verification ->> 'limitation' IS NOT NULL
         )
         OR (
           verification ->> 'status' IN ('blocked','inconclusive')
           AND verification ->> 'limitation' IS NULL
         ) THEN
        RAISE EXCEPTION 'DataForSEO backlink verification shape is invalid'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF NEW.metric_key = 'dataforseo.referring_domain.v1' THEN
    IF NEW.subject_type <> 'site'
       OR NEW.site_page_id IS NOT NULL
       OR value_key_count NOT IN (4, 5)
       OR NOT (NEW.value_json ?& ARRAY[
         'targetDomain', 'referringDomain', 'rank', 'backlinks'
       ]::text[])
       OR NOT app.is_normalized_competitor_domain(
         NEW.value_json ->> 'targetDomain'
       )
       OR NOT app.is_normalized_competitor_domain(
         NEW.value_json ->> 'referringDomain'
       )
       OR NEW.subject_ref IS DISTINCT FROM NEW.value_json ->> 'referringDomain'
       OR jsonb_typeof(NEW.value_json -> 'rank') <> 'number'
       OR (NEW.value_json ->> 'rank') !~ '^(0|[1-9][0-9]?|100)(\.[0-9]+)?$'
       OR jsonb_typeof(NEW.value_json -> 'backlinks') <> 'number'
       OR (NEW.value_json ->> 'backlinks') !~ '^(0|[1-9][0-9]*)$' THEN
      RAISE EXCEPTION 'DataForSEO referring-domain observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.subject_type <> 'url'
       OR value_key_count <> 5
       OR NOT (NEW.value_json ?& ARRAY[
         'sourceRef', 'targetUrl', 'title', 'backlinks', 'referringDomains'
       ]::text[])
       OR length(NEW.value_json ->> 'sourceRef') NOT BETWEEN 1 AND 500
       OR (NEW.value_json ->> 'targetUrl') !~ '^https?://'
       OR NEW.subject_ref IS DISTINCT FROM NEW.value_json ->> 'targetUrl'
       OR jsonb_typeof(NEW.value_json -> 'backlinks') <> 'number'
       OR (NEW.value_json ->> 'backlinks') !~ '^(0|[1-9][0-9]*)$'
       OR jsonb_typeof(NEW.value_json -> 'referringDomains') <> 'number'
       OR (NEW.value_json ->> 'referringDomains') !~ '^(0|[1-9][0-9]*)$'
       OR (
         NEW.value_json ->> 'title' IS NOT NULL
         AND length(NEW.value_json ->> 'title') NOT BETWEEN 1 AND 500
       )
       OR (
         NEW.site_page_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM app.site_pages page
           JOIN app.data_snapshots snapshot
             ON snapshot.id = NEW.snapshot_id
            AND snapshot.workspace_id = NEW.workspace_id
            AND snapshot.project_id = NEW.project_id
            AND snapshot.site_id = page.site_id
           WHERE page.id = NEW.site_page_id
             AND page.workspace_id = NEW.workspace_id
             AND page.project_id = NEW.project_id
             AND page.normalized_url = NEW.subject_ref
         )
       ) THEN
      RAISE EXCEPTION 'DataForSEO backlink-page observation shape is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalized_observations_dataforseo_provenance_guard
  ON app.normalized_observations;
DROP TRIGGER IF EXISTS normalized_observations_dataforseo_backlinks_provenance_guard
  ON app.normalized_observations;
CREATE TRIGGER normalized_observations_dataforseo_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (
    NEW.provider = 'dataforseo'
    AND NEW.metric_key NOT IN (
      'dataforseo.backlink_summary.v1',
      'dataforseo.backlink.v1',
      'dataforseo.referring_domain.v1',
      'dataforseo.backlink_page.v1'
    )
  )
  EXECUTE FUNCTION app.enforce_dataforseo_observation_provenance();
CREATE TRIGGER normalized_observations_dataforseo_backlinks_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  WHEN (
    NEW.provider = 'dataforseo'
    AND NEW.metric_key IN (
      'dataforseo.backlink_summary.v1',
      'dataforseo.backlink.v1',
      'dataforseo.referring_domain.v1',
      'dataforseo.backlink_page.v1'
    )
  )
  EXECUTE FUNCTION app.enforce_dataforseo_backlinks_observation_provenance();

-- The existing Growth Map tables remain the read model. Add DataForSEO as its
-- own authority scale and persist crawler verification independently from the
-- Provider fact. An inconclusive check never mutates Provider availability.
ALTER TABLE app.backlink_authority_snapshots
  DROP CONSTRAINT IF EXISTS backlink_authority_snapshots_provider_check,
  DROP CONSTRAINT IF EXISTS backlink_authority_snapshots_authority_metric_kind_check;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT constraint_def.conname
    FROM pg_constraint constraint_def
    WHERE constraint_def.conrelid =
      'app.backlink_authority_snapshots'::regclass
      AND constraint_def.contype = 'c'
      AND (
        (
          position(
            'source_kind = ''provider_import'''
            IN pg_get_constraintdef(constraint_def.oid)
          ) > 0
          AND position(
            'source_kind = ''manual_csv'''
            IN pg_get_constraintdef(constraint_def.oid)
          ) > 0
        )
        OR (
          position(
            'provider = ''ahrefs'''
            IN pg_get_constraintdef(constraint_def.oid)
          ) > 0
          AND position(
            'authority_metric_kind = ''domain_rating'''
            IN pg_get_constraintdef(constraint_def.oid)
          ) > 0
        )
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE app.backlink_authority_snapshots DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE app.backlink_authority_snapshots
  ADD CONSTRAINT backlink_authority_snapshots_provider_check CHECK (
    provider IN ('ahrefs','moz','dataforseo','manual_csv','search_derived')
  ) NOT VALID,
  ADD CONSTRAINT backlink_authority_snapshots_authority_metric_kind_check
  CHECK (
    authority_metric_kind IS NULL
    OR authority_metric_kind IN (
      'domain_rating', 'domain_authority', 'dataforseo_rank'
    )
  ) NOT VALID,
  ADD CONSTRAINT backlink_authority_snapshots_source_shape_check CHECK (
    (
      source_kind = 'provider_import'
      AND provider IN ('ahrefs','moz','dataforseo')
      AND import_preview_id IS NULL
      AND (
        (
          availability = 'available'
          AND index_scope = 'provider_index'
          AND total_backlinks IS NOT NULL
          AND total_referring_domains IS NOT NULL
          AND observed_backlinks IS NULL
          AND observed_referring_domains IS NULL
          AND authority_metric_kind IS NOT NULL
          AND authority_metric_value IS NOT NULL
          AND limitation IS NULL
        )
        OR (
          availability = 'unavailable'
          AND index_scope = 'unavailable'
          AND total_backlinks IS NULL
          AND total_referring_domains IS NULL
          AND observed_backlinks IS NULL
          AND observed_referring_domains IS NULL
          AND authority_metric_kind IS NULL
          AND authority_metric_value IS NULL
          AND limitation IS NOT NULL
        )
      )
    )
    OR (
      source_kind = 'manual_csv'
      AND provider = 'manual_csv'
      AND availability = 'partial'
      AND index_scope = 'observed_subset'
      AND total_backlinks IS NULL
      AND total_referring_domains IS NULL
      AND observed_backlinks IS NOT NULL
      AND observed_referring_domains IS NOT NULL
      AND authority_metric_kind IS NULL
      AND authority_metric_value IS NULL
      AND import_preview_id IS NOT NULL
      AND limitation IS NOT NULL
    )
    OR (
      source_kind = 'search_derived'
      AND provider = 'search_derived'
      AND availability = 'partial'
      AND index_scope = 'observed_subset'
      AND total_backlinks IS NULL
      AND total_referring_domains IS NULL
      AND observed_backlinks IS NOT NULL
      AND observed_referring_domains IS NOT NULL
      AND authority_metric_kind IS NULL
      AND authority_metric_value IS NULL
      AND import_preview_id IS NULL
      AND limitation IS NOT NULL
    )
  ) NOT VALID,
  ADD CONSTRAINT backlink_authority_snapshots_provider_metric_check CHECK (
    (
      provider = 'ahrefs'
      AND (
        authority_metric_kind IS NULL
        OR authority_metric_kind = 'domain_rating'
      )
    )
    OR (
      provider = 'moz'
      AND (
        authority_metric_kind IS NULL
        OR authority_metric_kind = 'domain_authority'
      )
    )
    OR (
      provider = 'dataforseo'
      AND (
        authority_metric_kind IS NULL
        OR authority_metric_kind = 'dataforseo_rank'
      )
    )
    OR (
      provider IN ('manual_csv','search_derived')
      AND authority_metric_kind IS NULL
    )
  ) NOT VALID;

ALTER TABLE app.backlink_facts
  DROP CONSTRAINT IF EXISTS backlink_facts_source_authority_metric_kind_check,
  DROP CONSTRAINT IF EXISTS backlink_facts_anchor_text_check,
  DROP CONSTRAINT IF EXISTS backlink_facts_seen_window_check,
  DROP CONSTRAINT IF EXISTS backlink_facts_verification_status_check,
  DROP CONSTRAINT IF EXISTS backlink_facts_verification_final_url_check,
  DROP CONSTRAINT IF EXISTS backlink_facts_verification_http_status_check,
  DROP CONSTRAINT IF EXISTS backlink_facts_verification_limitation_check,
  DROP CONSTRAINT IF EXISTS backlink_facts_verification_truth_check;
ALTER TABLE app.backlink_facts
  ADD COLUMN IF NOT EXISTS anchor_text text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_new boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_lost boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_final_url text,
  ADD COLUMN IF NOT EXISTS verification_http_status integer,
  ADD COLUMN IF NOT EXISTS verification_limitation text,
  ADD CONSTRAINT backlink_facts_source_authority_metric_kind_check CHECK (
    source_authority_metric_kind IS NULL
    OR source_authority_metric_kind IN (
      'domain_rating', 'domain_authority', 'dataforseo_rank'
    )
  ) NOT VALID,
  ADD CONSTRAINT backlink_facts_anchor_text_check CHECK (
    anchor_text IS NULL
    OR (
      length(anchor_text) BETWEEN 1 AND 2000
      AND anchor_text = btrim(anchor_text)
      AND anchor_text !~ '[[:cntrl:]]'
    )
  ) NOT VALID,
  ADD CONSTRAINT backlink_facts_seen_window_check CHECK (
    first_seen_at IS NULL
    OR last_seen_at IS NULL
    OR first_seen_at <= last_seen_at
  ) NOT VALID,
  ADD CONSTRAINT backlink_facts_verification_status_check CHECK (
    verification_status IN (
      'not_checked', 'verified', 'absent', 'blocked', 'inconclusive'
    )
  ) NOT VALID,
  ADD CONSTRAINT backlink_facts_verification_final_url_check CHECK (
    verification_final_url IS NULL
    OR (
      length(verification_final_url) BETWEEN 1 AND 2048
      AND verification_final_url = btrim(verification_final_url)
      AND verification_final_url ~ '^https?://'
    )
  ) NOT VALID,
  ADD CONSTRAINT backlink_facts_verification_http_status_check CHECK (
    verification_http_status IS NULL
    OR verification_http_status BETWEEN 100 AND 599
  ) NOT VALID,
  ADD CONSTRAINT backlink_facts_verification_limitation_check CHECK (
    verification_limitation IS NULL
    OR (
      length(verification_limitation) BETWEEN 1 AND 2000
      AND verification_limitation = btrim(verification_limitation)
      AND verification_limitation !~ '[[:cntrl:]]'
    )
  ) NOT VALID,
  ADD CONSTRAINT backlink_facts_verification_truth_check CHECK (
    (
      verification_status = 'not_checked'
      AND verified_at IS NULL
      AND verification_final_url IS NULL
      AND verification_http_status IS NULL
      AND verification_limitation IS NULL
    )
    OR (
      verification_status = 'verified'
      AND verified_at IS NOT NULL
      AND verification_final_url IS NOT NULL
      AND verification_http_status BETWEEN 200 AND 299
      AND verification_limitation IS NULL
    )
    OR (
      verification_status = 'absent'
      AND verified_at IS NULL
      AND verification_final_url IS NOT NULL
      AND verification_http_status BETWEEN 200 AND 299
      AND verification_limitation IS NULL
    )
    OR (
      verification_status IN ('blocked','inconclusive')
      AND verified_at IS NULL
      AND verification_limitation IS NOT NULL
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION app.enforce_backlink_authority_snapshot_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  competitor app.competitor_entities%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    JOIN app.sites site
      ON site.workspace_id = project.workspace_id
     AND site.project_id = project.id
     AND site.id = NEW.site_id
     AND site.is_primary
    WHERE project.workspace_id = NEW.workspace_id
      AND project.id = NEW.project_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'backlink snapshot does not belong to the exact primary site and project scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.subject_kind = 'approved_competitor' THEN
    SELECT *
    INTO competitor
    FROM app.competitor_entities candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND candidate.project_id = NEW.project_id
      AND candidate.id = NEW.competitor_id;
    IF NOT FOUND OR competitor.review_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'backlink snapshot competitor is not approved in the exact project scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.source_kind = 'manual_csv' AND NOT EXISTS (
    SELECT 1
    FROM app.import_previews preview
    WHERE preview.workspace_id = NEW.workspace_id
      AND preview.project_id = NEW.project_id
      AND preview.site_id = NEW.site_id
      AND preview.id = NEW.import_preview_id
      AND preview.template_id = 'backlink_v1'
      AND preview.status = 'consumed'
      AND preview.file_checksum = NEW.checksum
      AND preview.row_count = NEW.row_count
  ) THEN
    RAISE EXCEPTION 'manual backlink snapshot requires its exact consumed backlink CSV preview'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider = 'dataforseo' THEN
    IF NEW.availability <> 'available'
       OR NEW.subject_kind <> 'primary_site'
       OR NEW.source_kind <> 'provider_import'
       OR NEW.source_ref !~ '^dfs-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR NOT EXISTS (
         SELECT 1
         FROM app.data_snapshots snapshot
         WHERE 'dfs-' || snapshot.id::text = NEW.source_ref
           AND snapshot.workspace_id = NEW.workspace_id
           AND snapshot.project_id = NEW.project_id
           AND snapshot.site_id = NEW.site_id
           AND snapshot.provider = 'dataforseo'
           AND snapshot.dataset_key = 'dataforseo.backlinks.v1'
           AND snapshot.schema_version = 'dataforseo.backlinks.v1'
           AND snapshot.method_version = 'dataforseo.backlinks.v1'
           AND snapshot.captured_at = NEW.captured_at
           AND snapshot.availability = NEW.availability
           AND snapshot.checksum = NEW.checksum
           AND snapshot.row_count = NEW.row_count
           AND EXISTS (
             SELECT 1
             FROM app.normalized_observations observation
             WHERE observation.snapshot_id = snapshot.id
               AND observation.workspace_id = NEW.workspace_id
               AND observation.project_id = NEW.project_id
               AND observation.provider = 'dataforseo'
               AND observation.metric_key =
                 'dataforseo.backlink_summary.v1'
               AND observation.subject_type = 'site'
               AND observation.origin = 'vendor_observation'
               AND observation.grade = 'B'
               AND observation.availability = 'available'
               AND observation.observed_at = NEW.captured_at
               AND observation.value_json ->> 'targetDomain' =
                 observation.subject_ref
               AND (observation.value_json ->> 'rank')::numeric =
                 NEW.authority_metric_value
               AND (observation.value_json ->> 'backlinks')::bigint =
                 NEW.total_backlinks
               AND (
                 observation.value_json ->> 'referringDomains'
               )::bigint = NEW.total_referring_domains
           )
       ) THEN
      RAISE EXCEPTION 'DataForSEO backlink snapshot does not match its exact canonical Snapshot evidence'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_backlink_fact_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot app.backlink_authority_snapshots%ROWTYPE;
  page app.site_pages%ROWTYPE;
  primary_site app.sites%ROWTYPE;
  expected_authority_kind text;
BEGIN
  SELECT *
  INTO snapshot
  FROM app.backlink_authority_snapshots candidate
  WHERE candidate.workspace_id = NEW.workspace_id
    AND candidate.project_id = NEW.project_id
    AND candidate.site_id = NEW.site_id
    AND candidate.id = NEW.snapshot_id;
  IF NOT FOUND OR snapshot.availability = 'unavailable' THEN
    RAISE EXCEPTION 'backlink fact does not match its snapshot or exact target SitePage'
      USING ERRCODE = '23514';
  END IF;

  IF snapshot.subject_kind = 'approved_competitor'
     AND NEW.target_site_page_id IS NOT NULL THEN
    RAISE EXCEPTION 'competitor backlink facts cannot claim a primary-site SitePage'
      USING ERRCODE = '23514';
  END IF;

  IF snapshot.subject_kind = 'primary_site' THEN
    SELECT *
    INTO primary_site
    FROM app.sites candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND candidate.project_id = NEW.project_id
      AND candidate.id = NEW.site_id
      AND candidate.is_primary;
    IF NOT FOUND
       OR primary_site.host IS DISTINCT FROM lower(primary_site.host)
       OR primary_site.origin NOT IN (
         'http://' || primary_site.host,
         'https://' || primary_site.host
       ) THEN
      RAISE EXCEPTION 'primary-site backlink fact has no canonical Site origin authority'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.target_site_page_id IS NOT NULL THEN
    SELECT *
    INTO page
    FROM app.site_pages candidate
    WHERE candidate.workspace_id = NEW.workspace_id
      AND candidate.project_id = NEW.project_id
      AND candidate.site_id = NEW.site_id
      AND candidate.id = NEW.target_site_page_id;
    IF NOT FOUND OR page.normalized_url IS DISTINCT FROM NEW.target_url THEN
      RAISE EXCEPTION 'backlink fact does not match its snapshot or exact target SitePage'
        USING ERRCODE = '23514';
    END IF;
  ELSIF snapshot.subject_kind = 'primary_site'
     AND NOT (
       NEW.target_url = primary_site.origin
       OR left(
         NEW.target_url,
         length(primary_site.origin) + 1
       ) IN (
         primary_site.origin || '/',
         primary_site.origin || '?',
         primary_site.origin || '#'
       )
     ) THEN
    RAISE EXCEPTION 'primary-site backlink fact target URL is outside its canonical Site origin'
      USING ERRCODE = '23514';
  END IF;

  expected_authority_kind := CASE snapshot.provider
    WHEN 'ahrefs' THEN 'domain_rating'
    WHEN 'moz' THEN 'domain_authority'
    WHEN 'dataforseo' THEN 'dataforseo_rank'
    ELSE NULL
  END;
  IF NEW.source_authority_metric_kind IS NOT NULL
     AND (
       snapshot.source_kind IS DISTINCT FROM 'provider_import'
       OR expected_authority_kind IS NULL
       OR NEW.source_authority_metric_kind IS DISTINCT FROM expected_authority_kind
     ) THEN
    RAISE EXCEPTION 'backlink fact authority metric does not belong to its Provider snapshot'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- New Analysis Refresh parents freeze a six-step plan. Historical five-step
-- parents remain exact and resumable; the step mutation trigger chooses the
-- identity map from the immutable parent manifest instead of guessing by row.
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
  ) NOT VALID;

ALTER TABLE app.analysis_refresh_steps
  DROP CONSTRAINT IF EXISTS analysis_refresh_steps_ordinal_check,
  DROP CONSTRAINT IF EXISTS analysis_refresh_steps_step_key_check,
  DROP CONSTRAINT IF EXISTS analysis_refresh_steps_plan_position_check;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT constraint_def.conname
    FROM pg_constraint constraint_def
    WHERE constraint_def.conrelid = 'app.analysis_refresh_steps'::regclass
      AND constraint_def.contype = 'c'
      AND position(
        'ordinal = 1'
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
      AND position(
        'step_key = ''crawl'''
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
    ordinal BETWEEN 1 AND 6
  ) NOT VALID,
  ADD CONSTRAINT analysis_refresh_steps_step_key_check CHECK (
    step_key IN (
      'crawl',
      'gsc',
      'ga4',
      'dataforseo',
      'dataforseo_backlinks',
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
    OR (ordinal = 6 AND step_key = 'growth_audit' AND required)
  ) NOT VALID;

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
              'dataforseo.search_landscape.v2'
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
            'dataforseo.search_landscape.v2'
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

-- Validate widened checks without the long ACCESS EXCLUSIVE scan caused by a
-- directly validated ADD CONSTRAINT. The short DDL locks above are bounded by
-- lock_timeout; validation uses PostgreSQL's lower-lock validation path.
ALTER TABLE app.collection_runs
  VALIDATE CONSTRAINT collection_runs_operation_check;
ALTER TABLE app.data_snapshots
  VALIDATE CONSTRAINT data_snapshots_dataset_key_check;
ALTER TABLE app.backlink_authority_snapshots
  VALIDATE CONSTRAINT backlink_authority_snapshots_provider_check,
  VALIDATE CONSTRAINT backlink_authority_snapshots_authority_metric_kind_check,
  VALIDATE CONSTRAINT backlink_authority_snapshots_source_shape_check,
  VALIDATE CONSTRAINT backlink_authority_snapshots_provider_metric_check;
ALTER TABLE app.backlink_facts
  VALIDATE CONSTRAINT backlink_facts_source_authority_metric_kind_check,
  VALIDATE CONSTRAINT backlink_facts_anchor_text_check,
  VALIDATE CONSTRAINT backlink_facts_seen_window_check,
  VALIDATE CONSTRAINT backlink_facts_verification_status_check,
  VALIDATE CONSTRAINT backlink_facts_verification_final_url_check,
  VALIDATE CONSTRAINT backlink_facts_verification_http_status_check,
  VALIDATE CONSTRAINT backlink_facts_verification_limitation_check,
  VALIDATE CONSTRAINT backlink_facts_verification_truth_check;
ALTER TABLE app.analysis_refresh_runs
  VALIDATE CONSTRAINT analysis_refresh_runs_plan_contract_check;
ALTER TABLE app.analysis_refresh_steps
  VALIDATE CONSTRAINT analysis_refresh_steps_ordinal_check,
  VALIDATE CONSTRAINT analysis_refresh_steps_step_key_check,
  VALIDATE CONSTRAINT analysis_refresh_steps_plan_position_check;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0044_dataforseo_backlinks'::text AS migration_version;

COMMIT;
