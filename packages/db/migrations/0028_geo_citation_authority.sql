BEGIN;

-- GEO is an internal evidence provider for the existing four-module
-- workspace. It extends the canonical collection chain; it is not a new
-- customer-facing product module or a fabricated external data connection.
ALTER TABLE app.source_connections
  DROP CONSTRAINT IF EXISTS source_connections_provider_check;
ALTER TABLE app.source_connections
  ADD CONSTRAINT source_connections_provider_check CHECK (
    provider IN ('crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo')
  );

ALTER TABLE app.collection_runs
  DROP CONSTRAINT IF EXISTS collection_runs_provider_check,
  DROP CONSTRAINT IF EXISTS collection_runs_operation_check;
ALTER TABLE app.collection_runs
  ADD CONSTRAINT collection_runs_provider_check CHECK (
    provider IN ('crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo')
  ),
  ADD CONSTRAINT collection_runs_operation_check CHECK (
    operation IN (
      'site_graph',
      'search_analytics',
      'organic_landing',
      'keyword_gap_import',
      'ai_citation_monitor'
    )
  );

ALTER TABLE app.data_snapshots
  DROP CONSTRAINT IF EXISTS data_snapshots_provider_check,
  DROP CONSTRAINT IF EXISTS data_snapshots_dataset_key_check;
ALTER TABLE app.data_snapshots
  ADD CONSTRAINT data_snapshots_provider_check CHECK (
    provider IN ('crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo')
  ),
  ADD CONSTRAINT data_snapshots_dataset_key_check CHECK (
    dataset_key IN (
      'crawl.site_graph.v1',
      'gsc.page_query_daily.v1',
      'ga4.organic_landing_daily.v1',
      'csv.keyword_gap.v1',
      'dataforseo.ranked_keywords.v1',
      'geo.answer_citations.v1'
    )
  );

ALTER TABLE app.normalized_observations
  DROP CONSTRAINT IF EXISTS normalized_observations_provider_check;
ALTER TABLE app.normalized_observations
  ADD CONSTRAINT normalized_observations_provider_check CHECK (
    provider IN ('crawl', 'gsc', 'ga4', 'csv', 'dataforseo', 'geo')
  );

-- Preserve every existing CollectionRun invariant while admitting the one
-- governed GEO provider/operation pair.
CREATE OR REPLACE FUNCTION app.enforce_collection_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW.row_count IS NOT NULL
    OR NEW.source_window IS DISTINCT FROM '{"start":null,"end":null}'::jsonb
    OR NEW.provider_usage IS DISTINCT FROM '{}'::jsonb
    OR NEW.stop_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'collection run must be inserted as an unfinished placeholder'
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
    RAISE EXCEPTION 'collection run source identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.row_count IS DISTINCT FROM OLD.row_count
    OR NEW.source_window IS DISTINCT FROM OLD.source_window
    OR NEW.provider_usage IS DISTINCT FROM OLD.provider_usage
    OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason
  ) THEN
    IF OLD.row_count IS NOT NULL THEN
      RAISE EXCEPTION 'collection run outcome is already finalized'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.row_count IS NULL OR NOT EXISTS (
      SELECT 1
      FROM app.data_snapshots snapshot
      WHERE snapshot.collection_run_id = NEW.id
        AND snapshot.workspace_id = NEW.workspace_id
        AND snapshot.project_id = NEW.project_id
        AND snapshot.site_id = NEW.site_id
        AND snapshot.provider = NEW.provider
        AND snapshot.method_version = NEW.method_version
        AND snapshot.source_connection_id
          IS NOT DISTINCT FROM NEW.source_connection_id
        AND snapshot.row_count = NEW.row_count
        AND snapshot.source_window = NEW.source_window
    ) THEN
      RAISE EXCEPTION 'collection run outcome does not match its immutable snapshot'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.operation = 'site_graph')
    OR (NEW.provider = 'gsc' AND NEW.operation = 'search_analytics')
    OR (NEW.provider = 'ga4' AND NEW.operation = 'organic_landing')
    OR (
      NEW.provider IN ('csv', 'dataforseo')
      AND NEW.operation = 'keyword_gap_import'
    )
    OR (
      NEW.provider = 'geo'
      AND NEW.operation = 'ai_citation_monitor'
    )
  ) THEN
    RAISE EXCEPTION 'collection run operation does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider <> 'csv' AND NEW.source_connection_id IS NULL THEN
    RAISE EXCEPTION 'collection run provider requires a canonical source connection'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider <> 'csv' AND NEW.import_preview_id IS NOT NULL THEN
    RAISE EXCEPTION 'only CSV collection runs may reference an import preview'
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
    RAISE EXCEPTION 'collection run scope does not match its async run and site'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.source_connections source
    WHERE source.id = NEW.source_connection_id
      AND source.workspace_id = NEW.workspace_id
      AND source.project_id = NEW.project_id
      AND source.site_id = NEW.site_id
      AND source.provider = NEW.provider
  ) THEN
    RAISE EXCEPTION 'collection run source connection provenance is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.import_preview_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.import_previews preview
    WHERE preview.id = NEW.import_preview_id
      AND preview.workspace_id = NEW.workspace_id
      AND preview.project_id = NEW.project_id
      AND preview.site_id = NEW.site_id
      AND preview.template_id = 'keyword_gap_v1'
  ) THEN
    RAISE EXCEPTION 'collection run import preview provenance is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.crawl_seed_site_page_id IS NULL)
     IS DISTINCT FROM (NEW.crawl_seed_url IS NULL) THEN
    RAISE EXCEPTION 'collection run Crawl seed id and URL must be present together'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.crawl_seed_site_page_id IS NOT NULL THEN
    IF NEW.provider <> 'crawl' THEN
      RAISE EXCEPTION 'only Crawl collection runs may reference a seed SitePage'
        USING ERRCODE = '23514';
    END IF;
    IF length(NEW.crawl_seed_url) NOT BETWEEN 1 AND 2048 THEN
      RAISE EXCEPTION 'collection run Crawl seed URL is outside the supported bound'
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM app.site_pages page
      WHERE page.id = NEW.crawl_seed_site_page_id
        AND page.workspace_id = NEW.workspace_id
        AND page.project_id = NEW.project_id
        AND page.site_id = NEW.site_id
        AND page.normalized_url = NEW.crawl_seed_url
        AND page.normalized_url_hash = encode(
          digest(convert_to(NEW.crawl_seed_url, 'UTF8'), 'sha256'),
          'hex'
        )
    ) THEN
      RAISE EXCEPTION 'collection run Crawl seed does not match its exact SitePage identity'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_data_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.collection_runs run
    WHERE run.id = NEW.collection_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.site_id = NEW.site_id
      AND run.provider = NEW.provider
      AND run.method_version = NEW.method_version
      AND run.source_connection_id
        IS NOT DISTINCT FROM NEW.source_connection_id
  ) THEN
    RAISE EXCEPTION 'data snapshot provenance does not match its collection run'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.dataset_key = 'crawl.site_graph.v1')
    OR (
      NEW.provider = 'gsc'
      AND NEW.dataset_key = 'gsc.page_query_daily.v1'
    )
    OR (
      NEW.provider = 'ga4'
      AND NEW.dataset_key = 'ga4.organic_landing_daily.v1'
    )
    OR (
      NEW.provider = 'csv'
      AND NEW.dataset_key = 'csv.keyword_gap.v1'
    )
    OR (
      NEW.provider = 'dataforseo'
      AND NEW.dataset_key IN (
        'csv.keyword_gap.v1',
        'dataforseo.ranked_keywords.v1'
      )
    )
    OR (
      NEW.provider = 'geo'
      AND NEW.dataset_key = 'geo.answer_citations.v1'
    )
  ) THEN
    RAISE EXCEPTION 'data snapshot dataset does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider = 'geo' THEN
    IF NEW.schema_version <> '1'
       OR NEW.row_count <= 0
       OR NEW.availability NOT IN ('available', 'partial')
       OR NOT (
         NEW.summary ?& ARRAY[
           'authority',
           'marketCode',
           'languageTag',
           'collectorKind',
           'collectorProviderKey',
           'collectorVersion',
           'queryCount',
           'unavailableQueryCount',
           'citationCount'
         ]::text[]
       )
       OR NEW.summary ->> 'authority' <> 'geo_citation_authority'
       OR (NEW.summary ->> 'marketCode') !~ '^[A-Z]{2}$'
       OR length(NEW.summary ->> 'languageTag') NOT BETWEEN 1 AND 255
       OR NEW.summary ->> 'collectorKind'
          NOT IN ('vendor_api', 'browser_probe', 'manual_verified')
       OR (NEW.summary ->> 'collectorProviderKey')
          !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
       OR length(NEW.summary ->> 'collectorProviderKey')
          NOT BETWEEN 2 AND 100
       OR length(btrim(NEW.summary ->> 'collectorVersion'))
          NOT BETWEEN 1 AND 500
       OR (NEW.summary ->> 'queryCount') !~ '^[0-9]+$'
       OR (NEW.summary ->> 'unavailableQueryCount') !~ '^[0-9]+$'
       OR (NEW.summary ->> 'citationCount') !~ '^[0-9]+$'
       OR (NEW.summary ->> 'queryCount')::bigint <> NEW.row_count
       OR (NEW.summary ->> 'unavailableQueryCount')::bigint
          > NEW.row_count
       OR (
         NEW.availability = 'available'
         AND (NEW.summary ->> 'unavailableQueryCount')::bigint <> 0
       )
       OR (
         NEW.availability = 'partial'
         AND (NEW.summary ->> 'unavailableQueryCount')::bigint = 0
       )
       OR (NEW.summary ->> 'citationCount')::bigint
          > NEW.row_count::bigint * 100
       OR NEW.captured_at < (
         app.normalize_measurement_source_window(NEW.source_window)
           ->> 'endAt'
       )::timestamptz THEN
      RAISE EXCEPTION 'GEO data snapshot summary or capture window is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_normalized_observation_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
      AND snapshot.provider = NEW.provider
      AND snapshot.captured_at = NEW.observed_at
  ) THEN
    RAISE EXCEPTION 'observation provenance does not match its immutable snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND (
        (
          snapshot.provider = 'crawl'
          AND snapshot.dataset_key = 'crawl.site_graph.v1'
          AND NEW.metric_key IN (
            'crawl.page.v1',
            'crawl.robots.v1',
            'crawl.sitemap.v1'
          )
        )
        OR (
          snapshot.provider = 'gsc'
          AND snapshot.dataset_key = 'gsc.page_query_daily.v1'
          AND NEW.metric_key = 'gsc.page.v1'
        )
        OR (
          snapshot.provider = 'ga4'
          AND snapshot.dataset_key = 'ga4.organic_landing_daily.v1'
          AND NEW.metric_key = 'ga4.landing.v1'
        )
        OR (
          snapshot.provider = 'csv'
          AND snapshot.dataset_key = 'csv.keyword_gap.v1'
          AND NEW.metric_key = 'csv.keyword_gap.v1'
        )
        OR (
          snapshot.provider = 'dataforseo'
          AND (
            (
              snapshot.dataset_key = 'csv.keyword_gap.v1'
              AND NEW.metric_key = 'csv.keyword_gap.v1'
            )
            OR (
              snapshot.dataset_key = 'dataforseo.ranked_keywords.v1'
              AND NEW.metric_key = 'csv.keyword_gap.v1'
            )
          )
        )
        OR (
          snapshot.provider = 'geo'
          AND snapshot.dataset_key = 'geo.answer_citations.v1'
          AND NEW.metric_key = 'geo.page_citations.v1'
        )
      )
  ) THEN
    RAISE EXCEPTION 'observation metric does not belong to its provider dataset'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      NEW.provider IN ('gsc', 'ga4')
      AND NEW.origin = 'first_party'
      AND NEW.grade = 'A'
    )
    OR (
      NEW.provider = 'crawl'
      AND NEW.origin = 'direct_public'
      AND NEW.grade = 'B'
    )
    OR (
      NEW.provider = 'dataforseo'
      AND NEW.origin = 'vendor_observation'
      AND NEW.grade = 'B'
    )
    OR (
      NEW.provider = 'csv'
      AND NEW.origin = 'user_provided'
      AND NEW.grade = 'C'
    )
    OR (
      NEW.provider = 'geo'
      AND (
        (
          NEW.origin = 'vendor_observation'
          AND NEW.grade = 'B'
          AND (
            SELECT snapshot.summary ->> 'collectorKind'
            FROM app.data_snapshots snapshot
            WHERE snapshot.id = NEW.snapshot_id
          ) IN ('vendor_api', 'browser_probe')
        )
        OR (
          NEW.origin = 'user_provided'
          AND NEW.grade = 'C'
          AND (
            SELECT snapshot.summary ->> 'collectorKind'
            FROM app.data_snapshots snapshot
            WHERE snapshot.id = NEW.snapshot_id
          ) = 'manual_verified'
        )
      )
    )
  ) THEN
    RAISE EXCEPTION 'observation trust label does not match its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- The normalized page aggregate remains the Measurement-facing projection.
-- This guard proves that it resolves to one exact SitePage and that its
-- aggregate fields are typed, non-negative observed facts.
CREATE OR REPLACE FUNCTION app.enforce_geo_normalized_observation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_row app.data_snapshots%ROWTYPE;
  page_row app.site_pages%ROWTYPE;
  tracked_queries bigint;
  cited_queries bigint;
  citations bigint;
  attempted_queries bigint;
  unavailable_queries bigint;
BEGIN
  IF NEW.provider <> 'geo' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO snapshot_row
  FROM app.data_snapshots
  WHERE id = NEW.snapshot_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND provider = 'geo'
    AND dataset_key = 'geo.answer_citations.v1'
  FOR SHARE;

  SELECT * INTO page_row
  FROM app.site_pages
  WHERE id = NEW.site_page_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND site_id = snapshot_row.site_id
    AND normalized_url = NEW.subject_ref
  FOR SHARE;

  IF snapshot_row.id IS NULL
     OR page_row.id IS NULL
     OR NEW.metric_key <> 'geo.page_citations.v1'
     OR NEW.subject_type <> 'url'
     OR NEW.availability NOT IN ('available', 'partial') THEN
    RAISE EXCEPTION 'GEO normalized observation scope or canonical page lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.availability = 'partial' THEN
    IF NEW.value_json IS NOT NULL OR NEW.unit IS NOT NULL THEN
      RAISE EXCEPTION 'partial GEO observation cannot invent aggregate values'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.value_json) <> 'object'
     OR NEW.value_json ->> 'schemaVersion' <> '1'
     OR NEW.value_json ->> 'marketCode'
        IS DISTINCT FROM snapshot_row.summary ->> 'marketCode'
     OR NEW.value_json ->> 'languageTag'
        IS DISTINCT FROM snapshot_row.summary ->> 'languageTag'
     OR (NEW.value_json ->> 'marketCode') !~ '^[A-Z]{2}$'
     OR length(NEW.value_json ->> 'languageTag') NOT BETWEEN 1 AND 255
     OR (NEW.value_json ->> 'querySetHash') !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(NEW.value_json -> 'trackedQueries') <> 'number'
     OR jsonb_typeof(NEW.value_json -> 'citedQueries') <> 'number'
     OR jsonb_typeof(NEW.value_json -> 'citations') <> 'number'
     OR jsonb_typeof(NEW.value_json -> 'attemptedQueries') <> 'number'
     OR jsonb_typeof(NEW.value_json -> 'unavailableQueries') <> 'number'
     OR (NEW.value_json ->> 'trackedQueries') !~ '^[0-9]+$'
     OR (NEW.value_json ->> 'citedQueries') !~ '^[0-9]+$'
     OR (NEW.value_json ->> 'citations') !~ '^[0-9]+$'
     OR (NEW.value_json ->> 'attemptedQueries') !~ '^[0-9]+$'
     OR (NEW.value_json ->> 'unavailableQueries') !~ '^[0-9]+$'
     OR NEW.unit <> 'tracked_queries' THEN
    RAISE EXCEPTION 'GEO normalized observation aggregate is invalid'
      USING ERRCODE = '23514';
  END IF;

  tracked_queries := (NEW.value_json ->> 'trackedQueries')::bigint;
  cited_queries := (NEW.value_json ->> 'citedQueries')::bigint;
  citations := (NEW.value_json ->> 'citations')::bigint;
  attempted_queries := (NEW.value_json ->> 'attemptedQueries')::bigint;
  unavailable_queries :=
    (NEW.value_json ->> 'unavailableQueries')::bigint;

  IF tracked_queries <= 0
     OR cited_queries > tracked_queries
     OR citations < cited_queries
     OR attempted_queries < tracked_queries
     OR unavailable_queries <> attempted_queries - tracked_queries THEN
    RAISE EXCEPTION 'GEO normalized observation counts are invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geo_normalized_observations_lineage_guard
  ON app.normalized_observations;
CREATE TRIGGER geo_normalized_observations_lineage_guard
BEFORE INSERT ON app.normalized_observations
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_normalized_observation_insert();

CREATE TABLE app.geo_query_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  normalized_observation_id uuid NOT NULL
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  canonical_url text NOT NULL
    CHECK (length(canonical_url) BETWEEN 1 AND 2048),
  market_code text NOT NULL CHECK (market_code ~ '^[A-Z]{2}$'),
  language_tag text NOT NULL
    CHECK (length(btrim(language_tag)) BETWEEN 1 AND 255),
  query_text text NOT NULL
    CHECK (length(btrim(query_text)) BETWEEN 1 AND 500),
  query_hash text NOT NULL CHECK (query_hash ~ '^[a-f0-9]{64}$'),
  platform_kind text NOT NULL
    CHECK (platform_kind IN ('known', 'other')),
  platform_key text NOT NULL
    CHECK (length(platform_key) BETWEEN 2 AND 100),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 500),
  collector_kind text NOT NULL CHECK (
    collector_kind IN ('vendor_api', 'browser_probe', 'manual_verified')
  ),
  collector_provider_key text NOT NULL CHECK (
    collector_provider_key
      ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    AND length(collector_provider_key) BETWEEN 2 AND 100
  ),
  collector_version text NOT NULL
    CHECK (length(btrim(collector_version)) BETWEEN 1 AND 500),
  collected_at timestamptz NOT NULL,
  citation_state text NOT NULL CHECK (
    citation_state IN ('cited', 'mentioned', 'unseen', 'unavailable')
  ),
  answer_evidence_excerpt text CHECK (
    answer_evidence_excerpt IS NULL
    OR length(answer_evidence_excerpt) BETWEEN 1 AND 1000
  ),
  answer_content_hash text CHECK (
    answer_content_hash IS NULL
    OR answer_content_hash ~ '^[a-f0-9]{64}$'
  ),
  answer_selector text CHECK (
    answer_selector IS NULL
    OR length(btrim(answer_selector)) BETWEEN 1 AND 500
  ),
  evidence_statements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(evidence_statements) = 'array'
    AND jsonb_array_length(evidence_statements) <= 20
  ),
  limitation text CHECK (
    limitation IS NULL
    OR length(btrim(limitation)) BETWEEN 1 AND 2000
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      platform_kind = 'known'
      AND platform_key IN (
        'chatgpt',
        'perplexity',
        'google_ai_overview',
        'gemini',
        'claude',
        'copilot'
      )
    )
    OR (
      platform_kind = 'other'
      AND platform_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    )
  ),
  CHECK (
    num_nonnulls(
      answer_evidence_excerpt,
      answer_content_hash,
      answer_selector
    ) IN (0, 3)
  ),
  CHECK (
    (
      citation_state = 'unavailable'
      AND answer_evidence_excerpt IS NULL
      AND limitation IS NOT NULL
    )
    OR (
      citation_state <> 'unavailable'
      AND answer_evidence_excerpt IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX geo_query_observations_identity_idx
  ON app.geo_query_observations(
    snapshot_id,
    site_page_id,
    query_hash,
    platform_kind,
    platform_key,
    model,
    collector_provider_key
  );

CREATE INDEX geo_query_observations_normalized_idx
  ON app.geo_query_observations(
    workspace_id,
    project_id,
    normalized_observation_id,
    collected_at,
    id
  );

CREATE TABLE app.geo_citation_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  normalized_observation_id uuid NOT NULL
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  query_observation_id uuid NOT NULL
    REFERENCES app.geo_query_observations(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  canonical_url text NOT NULL
    CHECK (length(canonical_url) BETWEEN 1 AND 2048),
  citation_url text NOT NULL
    CHECK (length(citation_url) BETWEEN 1 AND 2048),
  citation_ordinal integer NOT NULL
    CHECK (citation_ordinal BETWEEN 1 AND 1000),
  answer_evidence_excerpt text NOT NULL
    CHECK (length(answer_evidence_excerpt) BETWEEN 1 AND 1000),
  cited_page_excerpt text NOT NULL
    CHECK (length(cited_page_excerpt) BETWEEN 1 AND 1000),
  cited_page_content_hash text NOT NULL
    CHECK (cited_page_content_hash ~ '^[a-f0-9]{64}$'),
  cited_paragraph_hash text NOT NULL
    CHECK (cited_paragraph_hash ~ '^[a-f0-9]{64}$'),
  cited_paragraph_selector text NOT NULL
    CHECK (length(btrim(cited_paragraph_selector)) BETWEEN 1 AND 500),
  cited_paragraph_index integer CHECK (
    cited_paragraph_index IS NULL
    OR cited_paragraph_index BETWEEN 0 AND 1000000
  ),
  evidence_classification text NOT NULL CHECK (
    evidence_classification = 'direct_observation'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (query_observation_id, citation_ordinal)
);

CREATE INDEX geo_citation_occurrences_query_idx
  ON app.geo_citation_occurrences(
    workspace_id,
    project_id,
    query_observation_id,
    citation_ordinal,
    id
  );

CREATE OR REPLACE FUNCTION app.enforce_geo_query_observation_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_row app.data_snapshots%ROWTYPE;
  normalized app.normalized_observations%ROWTYPE;
  page_row app.site_pages%ROWTYPE;
  site_row app.sites%ROWTYPE;
  covered_window jsonb;
  statement_row jsonb;
  statement_evidence jsonb;
BEGIN
  SELECT * INTO snapshot_row
  FROM app.data_snapshots
  WHERE id = NEW.snapshot_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND site_id = NEW.site_id
    AND provider = 'geo'
    AND dataset_key = 'geo.answer_citations.v1'
  FOR SHARE;

  SELECT * INTO normalized
  FROM app.normalized_observations
  WHERE id = NEW.normalized_observation_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND snapshot_id = NEW.snapshot_id
    AND site_page_id = NEW.site_page_id
    AND provider = 'geo'
    AND metric_key = 'geo.page_citations.v1'
    AND subject_type = 'url'
    AND subject_ref = NEW.canonical_url
  FOR SHARE;

  SELECT * INTO page_row
  FROM app.site_pages
  WHERE id = NEW.site_page_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND site_id = NEW.site_id
    AND normalized_url = NEW.canonical_url
  FOR SHARE;

  SELECT * INTO site_row
  FROM app.sites
  WHERE id = NEW.site_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR SHARE;

  IF snapshot_row.id IS NULL
     OR normalized.id IS NULL
     OR page_row.id IS NULL
     OR site_row.id IS NULL
     OR NOT (
       page_row.workspace_id = NEW.workspace_id
       AND page_row.project_id = NEW.project_id
       AND page_row.site_id = NEW.site_id
       AND page_row.normalized_url = NEW.canonical_url
     )
     OR NOT (
       normalized.snapshot_id = NEW.snapshot_id
       AND normalized.site_page_id = NEW.site_page_id
       AND normalized.metric_key = 'geo.page_citations.v1'
     )
     OR NOT (NEW.market_code = ANY(site_row.market_codes))
     OR NOT (NEW.language_tag = ANY(site_row.language_codes))
     OR snapshot_row.summary ->> 'marketCode' <> NEW.market_code
     OR snapshot_row.summary ->> 'languageTag' <> NEW.language_tag
     OR snapshot_row.summary ->> 'collectorKind' <> NEW.collector_kind
     OR snapshot_row.summary ->> 'collectorProviderKey'
        <> NEW.collector_provider_key
     OR snapshot_row.summary ->> 'collectorVersion'
        <> NEW.collector_version THEN
    RAISE EXCEPTION 'GEO query observation scope or canonical page lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  covered_window :=
    app.normalize_measurement_source_window(snapshot_row.source_window);
  IF NEW.collected_at < (covered_window ->> 'startAt')::timestamptz
     OR NEW.collected_at >= (covered_window ->> 'endAt')::timestamptz THEN
    RAISE EXCEPTION 'GEO query collection time is outside its immutable snapshot window'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW.evidence_statements) <> 'array'
     OR jsonb_array_length(NEW.evidence_statements) > 20 THEN
    RAISE EXCEPTION 'GEO evidence statements must be a bounded array'
      USING ERRCODE = '23514';
  END IF;

  FOR statement_row IN
    SELECT value
    FROM jsonb_array_elements(NEW.evidence_statements)
  LOOP
    IF jsonb_typeof(statement_row) <> 'object'
       OR NOT (
         statement_row ?& ARRAY[
           'classification',
           'statement',
           'evidence',
           'limitation'
         ]::text[]
       )
       OR statement_row
          - ARRAY[
              'classification',
              'statement',
              'evidence',
              'limitation'
            ]::text[] <> '{}'::jsonb
       OR statement_row ->> 'classification'
          NOT IN ('observation', 'inference')
       OR length(btrim(statement_row ->> 'statement'))
          NOT BETWEEN 1 AND 1000
       OR NOT (statement_row ? 'limitation') THEN
      RAISE EXCEPTION 'GEO evidence statement shape is invalid'
        USING ERRCODE = '23514';
    END IF;

    statement_evidence := statement_row -> 'evidence';
    IF jsonb_typeof(statement_evidence) <> 'object'
       OR NOT (
         statement_evidence ?& ARRAY[
           'excerpt',
           'contentHash',
           'selector'
         ]::text[]
       )
       OR statement_evidence
          - ARRAY['excerpt', 'contentHash', 'selector']::text[]
          <> '{}'::jsonb
       OR length(statement_evidence ->> 'excerpt')
          NOT BETWEEN 1 AND 1000
       OR (statement_evidence ->> 'contentHash')
          !~ '^[a-f0-9]{64}$'
       OR length(btrim(statement_evidence ->> 'selector'))
          NOT BETWEEN 1 AND 500
       OR (
         statement_row ->> 'limitation' IS NOT NULL
         AND length(btrim(statement_row ->> 'limitation'))
           NOT BETWEEN 1 AND 2000
       )
       OR (
         statement_row ->> 'classification' = 'inference'
         AND statement_row ->> 'limitation' IS NULL
       ) THEN
      RAISE EXCEPTION 'GEO evidence statement is unbounded or unsupported'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER geo_query_observations_insert_guard
BEFORE INSERT ON app.geo_query_observations
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_query_observation_insert();

CREATE OR REPLACE FUNCTION app.enforce_geo_citation_occurrence_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  query_row app.geo_query_observations%ROWTYPE;
  site_row app.sites%ROWTYPE;
BEGIN
  SELECT * INTO query_row
  FROM app.geo_query_observations
  WHERE id = NEW.query_observation_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
    AND site_id = NEW.site_id
    AND snapshot_id = NEW.snapshot_id
    AND normalized_observation_id = NEW.normalized_observation_id
    AND site_page_id = NEW.site_page_id
    AND canonical_url = NEW.canonical_url
    AND citation_state = 'cited'
  FOR SHARE;

  SELECT * INTO site_row
  FROM app.sites
  WHERE id = NEW.site_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR SHARE;

  IF query_row.id IS NULL
     OR site_row.id IS NULL
     OR NEW.citation_url <> NEW.canonical_url
     OR substring(
       NEW.citation_url
       FROM '^(https?://[^/?#]+)'
     ) IS DISTINCT FROM site_row.origin THEN
    RAISE EXCEPTION 'GEO citation occurrence scope or evidence lineage is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER geo_citation_occurrences_insert_guard
BEFORE INSERT ON app.geo_citation_occurrences
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_citation_occurrence_insert();

-- Validate the final, transaction-complete detail ledger against the immutable
-- normalized aggregate. Deferred checks let the writer append snapshot,
-- aggregate, queries, and citations atomically without weakening any boundary.
CREATE OR REPLACE FUNCTION app.enforce_geo_evidence_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_id uuid;
  normalized app.normalized_observations%ROWTYPE;
  attempted_queries bigint;
  tracked_queries bigint;
  cited_queries bigint;
  citation_count bigint;
  invalid_state_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'normalized_observations' THEN
    normalized_id := NEW.id;
  ELSIF TG_TABLE_NAME IN (
    'geo_query_observations',
    'geo_citation_occurrences'
  ) THEN
    normalized_id := NEW.normalized_observation_id;
  ELSE
    RAISE EXCEPTION 'unsupported GEO completeness trigger table'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO normalized
  FROM app.normalized_observations
  WHERE id = normalized_id
    AND provider = 'geo'
    AND metric_key = 'geo.page_citations.v1';
  IF normalized.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE citation_state <> 'unavailable'),
    count(*) FILTER (WHERE citation_state = 'cited'),
    count(*) FILTER (
      WHERE (
        citation_state = 'cited'
        AND (
          SELECT count(*)
          FROM app.geo_citation_occurrences occurrence
          WHERE occurrence.query_observation_id = query_row.id
        ) = 0
      )
      OR (
        citation_state <> 'cited'
        AND EXISTS (
          SELECT 1
          FROM app.geo_citation_occurrences occurrence
          WHERE occurrence.query_observation_id = query_row.id
        )
      )
    )
  INTO
    attempted_queries,
    tracked_queries,
    cited_queries,
    invalid_state_count
  FROM app.geo_query_observations query_row
  WHERE query_row.normalized_observation_id = normalized.id
    AND query_row.workspace_id = normalized.workspace_id
    AND query_row.project_id = normalized.project_id
    AND query_row.snapshot_id = normalized.snapshot_id
    AND query_row.site_page_id = normalized.site_page_id;

  SELECT count(*)
  INTO citation_count
  FROM app.geo_citation_occurrences occurrence
  WHERE occurrence.normalized_observation_id = normalized.id
    AND occurrence.workspace_id = normalized.workspace_id
    AND occurrence.project_id = normalized.project_id
    AND occurrence.snapshot_id = normalized.snapshot_id
    AND occurrence.site_page_id = normalized.site_page_id;

  IF attempted_queries = 0 OR invalid_state_count <> 0 THEN
    RAISE EXCEPTION 'GEO detail ledger is incomplete or conflicts with citation state'
      USING ERRCODE = '23514';
  END IF;

  IF normalized.availability = 'partial' THEN
    IF tracked_queries <> 0
       OR cited_queries <> 0
       OR citation_count <> 0
       OR normalized.value_json IS NOT NULL THEN
      RAISE EXCEPTION 'partial GEO aggregate conflicts with its unavailable query ledger'
        USING ERRCODE = '23514';
    END IF;
  ELSIF normalized.availability = 'available' THEN
    IF tracked_queries <= 0
       OR (normalized.value_json ->> 'trackedQueries')::bigint
          <> tracked_queries
       OR (normalized.value_json ->> 'citedQueries')::bigint
          <> cited_queries
       OR (normalized.value_json ->> 'citations')::bigint
          <> citation_count
       OR (normalized.value_json ->> 'attemptedQueries')::bigint
          <> attempted_queries
       OR (normalized.value_json ->> 'unavailableQueries')::bigint
          <> attempted_queries - tracked_queries THEN
      RAISE EXCEPTION 'GEO normalized aggregate conflicts with its immutable detail ledger'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'GEO evidence cannot use an unavailable aggregate as a zero'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER geo_normalized_observations_completeness_guard
AFTER INSERT ON app.normalized_observations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.provider = 'geo')
EXECUTE FUNCTION app.enforce_geo_evidence_completeness();

CREATE CONSTRAINT TRIGGER geo_query_observations_completeness_guard
AFTER INSERT ON app.geo_query_observations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_evidence_completeness();

CREATE CONSTRAINT TRIGGER geo_citation_occurrences_completeness_guard
AFTER INSERT ON app.geo_citation_occurrences
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app.enforce_geo_evidence_completeness();

CREATE TRIGGER geo_query_observations_append_only
BEFORE UPDATE OR DELETE ON app.geo_query_observations
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER geo_citation_occurrences_append_only
BEFORE UPDATE OR DELETE ON app.geo_citation_occurrences
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- Upgrade the existing GEO Measurement dimension from an explicit unavailable
-- placeholder to nullable canonical baseline/outcome lineage. Missing evidence
-- remains null and never becomes a numeric zero.
ALTER TABLE app.measurement_geo_dimensions
  ADD COLUMN baseline_observation_id uuid,
  ADD COLUMN outcome_observation_id uuid;

ALTER TABLE app.measurement_geo_dimensions
  ADD CONSTRAINT measurement_geo_dimensions_baseline_snapshot_fk
    FOREIGN KEY (baseline_snapshot_id)
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  ADD CONSTRAINT measurement_geo_dimensions_outcome_snapshot_fk
    FOREIGN KEY (outcome_snapshot_id)
    REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  ADD CONSTRAINT measurement_geo_dimensions_baseline_observation_fk
    FOREIGN KEY (baseline_observation_id)
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  ADD CONSTRAINT measurement_geo_dimensions_outcome_observation_fk
    FOREIGN KEY (outcome_observation_id)
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT;

DO $$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'app.measurement_geo_dimensions'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE app.measurement_geo_dimensions DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

ALTER TABLE app.measurement_geo_dimensions
  ADD CONSTRAINT measurement_geo_dimensions_state_check CHECK (
    state IN ('observed', 'insufficient_data', 'unavailable', 'regressed')
  ),
  ADD CONSTRAINT measurement_geo_dimensions_baseline_freshness_check CHECK (
    baseline_freshness IS NULL
    OR baseline_freshness IN ('current', 'stale', 'unknown')
  ),
  ADD CONSTRAINT measurement_geo_dimensions_outcome_freshness_check CHECK (
    outcome_freshness IS NULL
    OR outcome_freshness IN ('current', 'stale', 'unknown')
  ),
  ADD CONSTRAINT measurement_geo_dimensions_sample_unit_check CHECK (
    sample_unit = 'tracked_queries'
  ),
  ADD CONSTRAINT measurement_geo_dimensions_coverage_check CHECK (
    coverage IN ('complete', 'partial', 'none')
  ),
  ADD CONSTRAINT measurement_geo_dimensions_limitation_check CHECK (
    limitation IS NULL
    OR length(btrim(limitation)) BETWEEN 1 AND 4000
  ),
  ADD CONSTRAINT measurement_geo_dimensions_baseline_lineage_check CHECK (
    num_nonnulls(
      baseline_source_ref,
      baseline_snapshot_id,
      baseline_observation_id,
      baseline_covered_window,
      baseline_observed_at,
      baseline_freshness
    ) IN (0, 6)
  ),
  ADD CONSTRAINT measurement_geo_dimensions_outcome_lineage_check CHECK (
    num_nonnulls(
      outcome_source_ref,
      outcome_snapshot_id,
      outcome_observation_id,
      outcome_covered_window,
      outcome_observed_at,
      outcome_freshness
    ) IN (0, 6)
  ),
  ADD CONSTRAINT measurement_geo_dimensions_baseline_window_check CHECK (
    baseline_covered_window IS NULL
    OR (
      jsonb_typeof(baseline_covered_window) = 'object'
      AND baseline_covered_window
        - ARRAY['startAt', 'endAt']::text[] = '{}'::jsonb
      AND baseline_covered_window ? 'startAt'
      AND baseline_covered_window ? 'endAt'
      AND baseline_covered_window =
        app.normalize_measurement_source_window(baseline_covered_window)
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_outcome_window_check CHECK (
    outcome_covered_window IS NULL
    OR (
      jsonb_typeof(outcome_covered_window) = 'object'
      AND outcome_covered_window
        - ARRAY['startAt', 'endAt']::text[] = '{}'::jsonb
      AND outcome_covered_window ? 'startAt'
      AND outcome_covered_window ? 'endAt'
      AND outcome_covered_window =
        app.normalize_measurement_source_window(outcome_covered_window)
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_same_source_check CHECK (
    baseline_source_ref IS NULL
    OR outcome_source_ref IS NULL
    OR baseline_source_ref = outcome_source_ref
  ),
  ADD CONSTRAINT measurement_geo_dimensions_distinct_snapshots_check CHECK (
    baseline_snapshot_id IS NULL
    OR outcome_snapshot_id IS NULL
    OR baseline_snapshot_id <> outcome_snapshot_id
  ),
  ADD CONSTRAINT measurement_geo_dimensions_distinct_observations_check CHECK (
    baseline_observation_id IS NULL
    OR outcome_observation_id IS NULL
    OR baseline_observation_id <> outcome_observation_id
  ),
  ADD CONSTRAINT measurement_geo_dimensions_numeric_check CHECK (
    (sample_baseline IS NULL OR sample_baseline >= 0)
    AND (sample_outcome IS NULL OR sample_outcome >= 0)
    AND (
      tracked_queries_baseline IS NULL
      OR tracked_queries_baseline > 0
    )
    AND (
      tracked_queries_outcome IS NULL
      OR tracked_queries_outcome > 0
    )
    AND (
      cited_queries_baseline IS NULL
      OR cited_queries_baseline >= 0
    )
    AND (
      cited_queries_outcome IS NULL
      OR cited_queries_outcome >= 0
    )
    AND (citations_baseline IS NULL OR citations_baseline >= 0)
    AND (citations_outcome IS NULL OR citations_outcome >= 0)
    AND (
      citation_rate_baseline IS NULL
      OR citation_rate_baseline BETWEEN 0 AND 1
    )
    AND (
      citation_rate_outcome IS NULL
      OR citation_rate_outcome BETWEEN 0 AND 1
    )
    AND (
      cited_queries_baseline IS NULL
      OR tracked_queries_baseline IS NULL
      OR cited_queries_baseline <= tracked_queries_baseline
    )
    AND (
      cited_queries_outcome IS NULL
      OR tracked_queries_outcome IS NULL
      OR cited_queries_outcome <= tracked_queries_outcome
    )
    AND (
      citations_baseline IS NULL
      OR cited_queries_baseline IS NULL
      OR citations_baseline >= cited_queries_baseline
    )
    AND (
      citations_outcome IS NULL
      OR cited_queries_outcome IS NULL
      OR citations_outcome >= cited_queries_outcome
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_baseline_metrics_check CHECK (
    (
      baseline_source_ref IS NULL
      AND sample_baseline IS NULL
      AND tracked_queries_baseline IS NULL
      AND cited_queries_baseline IS NULL
      AND citations_baseline IS NULL
      AND citation_rate_baseline IS NULL
    )
    OR (
      baseline_source_ref IS NOT NULL
      AND num_nonnulls(
        sample_baseline,
        tracked_queries_baseline,
        cited_queries_baseline,
        citations_baseline,
        citation_rate_baseline
      ) IN (0, 5)
      AND (
        sample_baseline IS NULL
        OR sample_baseline = tracked_queries_baseline
      )
      AND (
        citation_rate_baseline IS NULL
        OR abs(
          citation_rate_baseline
          - cited_queries_baseline::numeric
            / tracked_queries_baseline::numeric
        ) < 0.000000000001
      )
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_outcome_metrics_check CHECK (
    (
      outcome_source_ref IS NULL
      AND sample_outcome IS NULL
      AND tracked_queries_outcome IS NULL
      AND cited_queries_outcome IS NULL
      AND citations_outcome IS NULL
      AND citation_rate_outcome IS NULL
    )
    OR (
      outcome_source_ref IS NOT NULL
      AND num_nonnulls(
        sample_outcome,
        tracked_queries_outcome,
        cited_queries_outcome,
        citations_outcome,
        citation_rate_outcome
      ) IN (0, 5)
      AND (
        sample_outcome IS NULL
        OR sample_outcome = tracked_queries_outcome
      )
      AND (
        citation_rate_outcome IS NULL
        OR abs(
          citation_rate_outcome
          - cited_queries_outcome::numeric
            / tracked_queries_outcome::numeric
        ) < 0.000000000001
      )
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_no_coverage_check CHECK (
    coverage <> 'none'
    OR (
      sample_baseline IS NULL
      AND sample_outcome IS NULL
      AND tracked_queries_baseline IS NULL
      AND tracked_queries_outcome IS NULL
      AND cited_queries_baseline IS NULL
      AND cited_queries_outcome IS NULL
      AND citations_baseline IS NULL
      AND citations_outcome IS NULL
      AND citation_rate_baseline IS NULL
      AND citation_rate_outcome IS NULL
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_state_shape_check CHECK (
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
      AND coverage <> 'none'
      AND sample_baseline > 0
      AND sample_outcome > 0
      AND tracked_queries_baseline IS NOT NULL
      AND tracked_queries_outcome IS NOT NULL
      AND cited_queries_baseline IS NOT NULL
      AND cited_queries_outcome IS NOT NULL
      AND citations_baseline IS NOT NULL
      AND citations_outcome IS NOT NULL
      AND citation_rate_baseline IS NOT NULL
      AND citation_rate_outcome IS NOT NULL
    )
  ),
  ADD CONSTRAINT measurement_geo_dimensions_limit_context_check CHECK (
    (
      (baseline_freshness IS NULL OR baseline_freshness = 'current')
      AND (outcome_freshness IS NULL OR outcome_freshness = 'current')
      AND coverage <> 'partial'
    )
    OR limitation IS NOT NULL
  );

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
    JOIN app.source_connections source
      ON source.id = p_source_ref
     AND source.id = snapshot.source_connection_id
     AND source.workspace_id = p_workspace_id
     AND source.project_id = p_project_id
     AND source.site_id = p_site_id
     AND source.provider = p_provider
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
       WHEN 'geo' THEN 'geo.page_citations.v1'
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
        WHEN 'geo' THEN 'geo.answer_citations.v1'
        ELSE ''
      END
      AND normalized.covered_window = p_covered_window
      AND app.normalize_measurement_source_window(p_covered_window) =
        p_covered_window
      AND (p_covered_window ->> 'startAt')::timestamptz
        < (p_covered_window ->> 'endAt')::timestamptz
      AND p_observed_at >=
        (p_covered_window ->> 'endAt')::timestamptz
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
  baseline_value jsonb;
  outcome_value jsonb;
  dimension_value jsonb;
BEGIN
  SELECT * INTO window_row
  FROM app.measurement_windows
  WHERE id = NEW.measurement_window_id
    AND workspace_id = NEW.workspace_id
    AND project_id = NEW.project_id
  FOR SHARE;
  IF window_row.id IS NULL THEN
    RAISE EXCEPTION 'measurement dimension requires a same-scope measurement window'
      USING ERRCODE = '23514';
  END IF;

  expected_provider := CASE
    WHEN TG_TABLE_NAME = 'measurement_gsc_dimensions' THEN 'gsc'
    WHEN TG_TABLE_NAME = 'measurement_ga4_dimensions' THEN 'ga4'
    WHEN TG_TABLE_NAME = 'measurement_geo_dimensions' THEN 'geo'
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
    RAISE EXCEPTION 'measurement baseline must reuse canonical provider evidence'
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
    RAISE EXCEPTION 'measurement outcome must reuse canonical provider evidence'
      USING ERRCODE = '23514';
  END IF;

  IF expected_provider = 'geo' THEN
    dimension_value := to_jsonb(NEW);
    IF NEW.baseline_source_ref IS NOT NULL THEN
      SELECT value_json INTO baseline_value
      FROM app.normalized_observations
      WHERE id = baseline_observation_id;
      IF baseline_value IS NULL
         OR (
           dimension_value ->> 'tracked_queries_baseline' IS NOT NULL
           AND (
             (dimension_value ->> 'tracked_queries_baseline')::bigint
                <> (baseline_value ->> 'trackedQueries')::bigint
             OR (dimension_value ->> 'cited_queries_baseline')::bigint
                <> (baseline_value ->> 'citedQueries')::bigint
             OR (dimension_value ->> 'citations_baseline')::bigint
                <> (baseline_value ->> 'citations')::bigint
           )
         ) THEN
        RAISE EXCEPTION 'GEO baseline metrics must equal their canonical page aggregate'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.outcome_source_ref IS NOT NULL THEN
      SELECT value_json INTO outcome_value
      FROM app.normalized_observations
      WHERE id = outcome_observation_id;
      IF outcome_value IS NULL
         OR (
           dimension_value ->> 'tracked_queries_outcome' IS NOT NULL
           AND (
             (dimension_value ->> 'tracked_queries_outcome')::bigint
                <> (outcome_value ->> 'trackedQueries')::bigint
             OR (dimension_value ->> 'cited_queries_outcome')::bigint
                <> (outcome_value ->> 'citedQueries')::bigint
             OR (dimension_value ->> 'citations_outcome')::bigint
                <> (outcome_value ->> 'citations')::bigint
           )
         ) THEN
        RAISE EXCEPTION 'GEO outcome metrics must equal their canonical page aggregate'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.baseline_source_ref IS NOT NULL
     AND (
       (NEW.baseline_covered_window ->> 'startAt')::timestamptz
          >= window_row.before_end_at
       OR (NEW.baseline_covered_window ->> 'endAt')::timestamptz
          <= window_row.before_start_at
     ) THEN
    RAISE EXCEPTION 'measurement baseline evidence must overlap its fixed phase'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.outcome_source_ref IS NOT NULL
     AND (
       (NEW.outcome_covered_window ->> 'startAt')::timestamptz
          >= window_row.after_end_at
       OR (NEW.outcome_covered_window ->> 'endAt')::timestamptz
          <= window_row.after_start_at
     ) THEN
    RAISE EXCEPTION 'measurement outcome evidence must overlap its fixed phase'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state IN ('observed', 'regressed')
     AND expected_provider <> 'geo'
     AND (
       NEW.baseline_source_ref IS NULL
       OR NEW.outcome_source_ref IS NULL
       OR (NEW.baseline_covered_window ->> 'startAt')::timestamptz
          > window_row.before_start_at
       OR (NEW.baseline_covered_window ->> 'endAt')::timestamptz
          < window_row.before_end_at
       OR (NEW.outcome_covered_window ->> 'startAt')::timestamptz
          > window_row.after_start_at
       OR (NEW.outcome_covered_window ->> 'endAt')::timestamptz
          < window_row.after_end_at
     ) THEN
    RAISE EXCEPTION 'observed measurement sources must contain their measurement phases'
      USING ERRCODE = '23514';
  END IF;

  IF expected_provider = 'geo'
     AND NEW.state IN ('observed', 'regressed') THEN
    IF baseline_value ->> 'marketCode'
          IS DISTINCT FROM outcome_value ->> 'marketCode'
       OR baseline_value ->> 'languageTag'
          IS DISTINCT FROM outcome_value ->> 'languageTag'
       OR baseline_value ->> 'querySetHash'
          IS DISTINCT FROM outcome_value ->> 'querySetHash' THEN
      RAISE EXCEPTION 'observed GEO phases require the same market, language, and query cohort'
        USING ERRCODE = '23514';
    END IF;
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
      RAISE EXCEPTION 'GA4 direct and assisted conversion event names must be unique'
        USING ERRCODE = '23514';
    END IF;
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
    RAISE EXCEPTION 'final measurement window requires exactly one GSC, GA4, and GEO dimension'
      USING ERRCODE = '23514';
  END IF;

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
    RAISE EXCEPTION 'final measurement requires its exact terminal measurement run'
      USING ERRCODE = '23514';
  END IF;

  SELECT max(observed_at)
  INTO latest_observed_at
  FROM (
    VALUES
      (gsc.baseline_observed_at),
      (gsc.outcome_observed_at),
      (ga4.baseline_observed_at),
      (ga4.outcome_observed_at),
      (geo.baseline_observed_at),
      (geo.outcome_observed_at)
  ) AS provider_observations(observed_at);
  IF latest_observed_at IS NOT NULL
     AND NEW.recorded_at < latest_observed_at THEN
    RAISE EXCEPTION 'final measurement cannot predate its provider observations'
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
    RAISE EXCEPTION 'aggregate measurement state conflicts with provider dimensions'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.geo_query_observations FROM anon';
    EXECUTE 'REVOKE ALL ON app.geo_citation_occurrences FROM anon';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  ) THEN
    EXECUTE 'REVOKE ALL ON app.geo_query_observations FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.geo_citation_occurrences FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0028_geo_citation_authority'::text AS migration_version;

COMMIT;
