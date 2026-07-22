BEGIN;

-- The supported repository writer derives RFC 8785/JCS bytes and `content_hash`
-- from `extract`, then retains those exact bytes here. PostgreSQL proves only
-- that the retained bytes parse to the same jsonb value and hash to
-- `content_hash`; it does not independently prove RFC 8785 canonicality. This
-- avoids silently introducing a second JSON canonicalizer. Historical rows stay
-- byte-for-byte immutable: a null canonical_extract explicitly means the
-- application serialization bytes were not retained before this migration.
ALTER TABLE app.page_snapshots
  ADD COLUMN IF NOT EXISTS canonical_extract text;

-- SitePage identity is the exact persisted normalized URL, addressed by the
-- SHA-256 of its UTF-8 bytes. Earlier writers used JCS hashes. Refuse to merge
-- two durable page identities during the derived-field backfill, then replace
-- only the hash; PageSnapshot foreign keys continue to reference the same ids.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.site_pages
    GROUP BY project_id,
      encode(
        digest(convert_to(normalized_url, 'UTF8'), 'sha256'),
        'hex'
      )
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'site page URL duplicates or SHA-256 collision prevent identity backfill'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE app.site_pages
  DROP CONSTRAINT IF EXISTS site_pages_project_id_normalized_url_hash_key;

UPDATE app.site_pages
SET normalized_url_hash = encode(
  digest(convert_to(normalized_url, 'UTF8'), 'sha256'),
  'hex'
)
WHERE normalized_url_hash IS DISTINCT FROM encode(
  digest(convert_to(normalized_url, 'UTF8'), 'sha256'),
  'hex'
);

ALTER TABLE app.site_pages
  ADD CONSTRAINT site_pages_project_id_normalized_url_hash_key
  UNIQUE (project_id, normalized_url_hash);

CREATE OR REPLACE FUNCTION app.enforce_site_page_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.site_id IS DISTINCT FROM OLD.site_id
    OR NEW.normalized_url IS DISTINCT FROM OLD.normalized_url
    OR NEW.normalized_url_hash IS DISTINCT FROM OLD.normalized_url_hash
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'site page durable identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.normalized_url_hash IS DISTINCT FROM encode(
    digest(convert_to(NEW.normalized_url, 'UTF8'), 'sha256'),
    'hex'
  ) THEN
    RAISE EXCEPTION 'site page URL hash does not match its normalized URL'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.sites site
    WHERE site.id = NEW.site_id
      AND site.workspace_id = NEW.workspace_id
      AND site.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'site page provenance does not match its canonical site'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Canonical collection lineage begins at the accepted AsyncRun and Site. A
-- foreign Site/source connection/import preview must never be able to mint a
-- same-project snapshot that later looks trustworthy.
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
        AND snapshot.source_connection_id IS NOT DISTINCT FROM NEW.source_connection_id
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
    OR (NEW.provider IN ('csv','dataforseo') AND NEW.operation = 'keyword_gap_import')
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS collection_runs_provenance_guard ON app.collection_runs;
CREATE TRIGGER collection_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_collection_run_provenance();

-- A DataSnapshot is an immutable output of exactly one collection run. Provider,
-- site, source connection, and method version are copied facts, not caller-owned
-- labels. Dataset/provider pairings are likewise fixed for the current schemas.
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
      AND run.source_connection_id IS NOT DISTINCT FROM NEW.source_connection_id
  ) THEN
    RAISE EXCEPTION 'data snapshot provenance does not match its collection run'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider = 'crawl' AND NEW.dataset_key = 'crawl.site_graph.v1')
    OR (NEW.provider = 'gsc' AND NEW.dataset_key = 'gsc.page_query_daily.v1')
    OR (NEW.provider = 'ga4' AND NEW.dataset_key = 'ga4.organic_landing_daily.v1')
    OR (NEW.provider IN ('csv','dataforseo') AND NEW.dataset_key = 'csv.keyword_gap.v1')
  ) THEN
    RAISE EXCEPTION 'data snapshot dataset does not belong to its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS data_snapshots_provenance_guard ON app.data_snapshots;
CREATE TRIGGER data_snapshots_provenance_guard
  BEFORE INSERT ON app.data_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_data_snapshot_provenance();

-- Observations inherit source identity and capture time from their immutable
-- snapshot. The grade/origin mapping is fixed by spec §7.7 so a lower-trust
-- vendor or CSV row cannot relabel itself as first-party evidence.
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
            'crawl.page.v1','crawl.robots.v1','crawl.sitemap.v1'
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
          snapshot.provider IN ('csv','dataforseo')
          AND snapshot.dataset_key = 'csv.keyword_gap.v1'
          AND NEW.metric_key = 'csv.keyword_gap.v1'
        )
      )
  ) THEN
    RAISE EXCEPTION 'observation metric does not belong to its provider dataset'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (NEW.provider IN ('gsc','ga4') AND NEW.origin = 'first_party' AND NEW.grade = 'A')
    OR (NEW.provider = 'crawl' AND NEW.origin = 'direct_public' AND NEW.grade = 'B')
    OR (NEW.provider = 'dataforseo' AND NEW.origin = 'vendor_observation' AND NEW.grade = 'B')
    OR (NEW.provider = 'csv' AND NEW.origin = 'user_provided' AND NEW.grade = 'C')
  ) THEN
    RAISE EXCEPTION 'observation trust label does not match its provider'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalized_observations_provenance_guard ON app.normalized_observations;
CREATE TRIGGER normalized_observations_provenance_guard
  BEFORE INSERT ON app.normalized_observations
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_normalized_observation_provenance();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'page_snapshots_canonical_extract_required'
      AND conrelid = 'app.page_snapshots'::regclass
  ) THEN
    ALTER TABLE app.page_snapshots
      ADD CONSTRAINT page_snapshots_canonical_extract_required
      CHECK (canonical_extract IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

-- Fresh databases validate the requirement immediately. Upgraded databases
-- retain a visible NOT VALID marker until an external, provenance-preserving
-- backfill can supply the original bytes; PostgreSQL still enforces the check
-- for every new insert.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.page_snapshots WHERE canonical_extract IS NULL
  ) THEN
    ALTER TABLE app.page_snapshots
      VALIDATE CONSTRAINT page_snapshots_canonical_extract_required;
  END IF;
END;
$$;

-- Every verified (post-0012) projection has exactly one row per page/source
-- pair. This index is deployable even when immutable legacy history already
-- contains a conflicting pair; such rows stay explicitly unverified.
CREATE UNIQUE INDEX IF NOT EXISTS page_snapshots_verified_source_identity_idx
  ON app.page_snapshots(site_page_id, data_snapshot_id)
  WHERE canonical_extract IS NOT NULL;

-- Where existing history already satisfies the stronger global invariant,
-- promote it to a full constraint. If legacy duplicates exist, preserve them
-- unchanged; the trigger below prevents any new row from extending the conflict.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.page_snapshots
    GROUP BY site_page_id, data_snapshot_id
    HAVING count(*) > 1
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'page_snapshots_site_page_data_snapshot_key'
      AND conrelid = 'app.page_snapshots'::regclass
  ) THEN
    ALTER TABLE app.page_snapshots
      ADD CONSTRAINT page_snapshots_site_page_data_snapshot_key
      UNIQUE (site_page_id, data_snapshot_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_page_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_captured_at timestamptz;
  source_page_url text;
  canonical_extract_json jsonb;
BEGIN
  IF NEW.canonical_extract IS NULL THEN
    RAISE EXCEPTION 'new page snapshots require retained extract bytes'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.page_snapshots existing
    WHERE existing.site_page_id = NEW.site_page_id
      AND existing.data_snapshot_id = NEW.data_snapshot_id
      AND existing.canonical_extract IS NULL
  ) THEN
    RAISE EXCEPTION 'page snapshot source identity already exists in legacy history'
      USING ERRCODE = '23505';
  END IF;

  SELECT snapshot.captured_at, page.normalized_url
  INTO source_captured_at, source_page_url
  FROM app.site_pages page
  JOIN app.data_snapshots snapshot
    ON snapshot.id = NEW.data_snapshot_id
   AND snapshot.site_id = page.site_id
  WHERE page.id = NEW.site_page_id
    AND page.workspace_id = NEW.workspace_id
    AND page.project_id = NEW.project_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.project_id = NEW.project_id
    AND snapshot.provider = 'crawl'
    AND snapshot.dataset_key = 'crawl.site_graph.v1';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'page snapshot provenance does not match its canonical sources'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.captured_at IS DISTINCT FROM source_captured_at THEN
    RAISE EXCEPTION 'page snapshot capture time does not match its canonical source snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.extract ->> 'schemaVersion' IS DISTINCT FROM 'crawl.page-extract.v1'
     OR NEW.extract #>> '{projection,fetchUrl}' IS DISTINCT FROM source_page_url THEN
    RAISE EXCEPTION 'page snapshot extract identity does not match its durable site page'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    canonical_extract_json := NEW.canonical_extract::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'page snapshot retained extract bytes are not valid JSON'
      USING ERRCODE = '23514';
  END;

  IF canonical_extract_json IS DISTINCT FROM NEW.extract THEN
    RAISE EXCEPTION 'page snapshot retained extract bytes do not match its jsonb extract'
      USING ERRCODE = '23514';
  END IF;

  IF encode(
       digest(convert_to(NEW.canonical_extract, 'UTF8'), 'sha256'),
       'hex'
     ) IS DISTINCT FROM NEW.content_hash THEN
    RAISE EXCEPTION 'page snapshot content hash does not match its retained extract bytes'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS page_snapshots_provenance_guard ON app.page_snapshots;
CREATE TRIGGER page_snapshots_provenance_guard
  BEFORE INSERT ON app.page_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_page_snapshot_provenance();

-- A DiagnosticRun may update only its derived coverage projection. Every input
-- column and the JCS content address remain immutable after enqueue so a result
-- can always be replayed against the exact frozen context it names.
CREATE OR REPLACE FUNCTION app.enforce_diagnostic_run_frozen_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'diagnostic run frozen input is append-only'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.site_id IS DISTINCT FROM OLD.site_id
     OR NEW.icp_profile_id IS DISTINCT FROM OLD.icp_profile_id
     OR NEW.icp_profile_version IS DISTINCT FROM OLD.icp_profile_version
     OR NEW.rule_set_version IS DISTINCT FROM OLD.rule_set_version
     OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
     OR NEW.output_locale IS DISTINCT FROM OLD.output_locale
     OR NEW.input_manifest IS DISTINCT FROM OLD.input_manifest
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'diagnostic run frozen input is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diagnostic_runs_frozen_input_guard ON app.diagnostic_runs;
CREATE TRIGGER diagnostic_runs_frozen_input_guard
  BEFORE UPDATE OR DELETE ON app.diagnostic_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_diagnostic_run_frozen_input();

-- Evidence has three mutually exclusive provenance shapes:
--   * source-backed rows name one frozen snapshot/run and use either the
--     provider's observed axes or the replayable derived axes from spec §7.7;
--   * deterministic system rows are lineage-free derived/computed/B facts;
--   * generated LLM rows name one successful immutable invocation and grade C.
-- Historical rows remain readable: NOT VALID preserves legacy history while
-- enforcing the invariant for every row inserted after this migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'evidence_source_lineage_required'
      AND conrelid = 'app.evidence'::regclass
      AND obj_description(oid, 'pg_constraint') = 'signalframe.evidence-provenance.v2'
      AND pg_get_constraintdef(oid) LIKE '%source_provider = ''system''%'
      AND pg_get_constraintdef(oid) LIKE '%origin = ''derived''%'
      AND pg_get_constraintdef(oid) LIKE '%method = ''computed''%'
      AND pg_get_constraintdef(oid) LIKE '%method = ''inferred''%'
      AND pg_get_constraintdef(oid) LIKE '%grade = ''C''%'
  ) THEN
    ALTER TABLE app.evidence
      DROP CONSTRAINT IF EXISTS evidence_source_lineage_required;

    ALTER TABLE app.evidence
      ADD CONSTRAINT evidence_source_lineage_required
      CHECK (
        (
          analysis_invocation_id IS NOT NULL
          AND snapshot_id IS NULL
          AND collection_run_id IS NULL
          AND source_provider = 'llm'
          AND origin = 'generated'
          AND method = 'generated'
          AND grade = 'C'
        )
        OR (
          analysis_invocation_id IS NULL
          AND snapshot_id IS NOT NULL
          AND collection_run_id IS NOT NULL
          AND source_provider IN ('crawl','gsc','ga4','csv','dataforseo')
          AND (
            (
              method = 'observed'
              AND (
                (
                  source_provider IN ('gsc','ga4')
                  AND origin = 'first_party'
                  AND grade = 'A'
                )
                OR (
                  source_provider = 'crawl'
                  AND origin = 'direct_public'
                  AND grade = 'B'
                )
                OR (
                  source_provider = 'dataforseo'
                  AND origin = 'vendor_observation'
                  AND grade = 'B'
                )
                OR (
                  source_provider = 'csv'
                  AND origin = 'user_provided'
                  AND grade = 'C'
                )
              )
            )
            OR (
              origin = 'derived'
              AND method = 'computed'
              AND grade = 'B'
            )
            OR (
              origin = 'derived'
              AND method = 'inferred'
              AND grade = 'C'
            )
          )
        )
        OR (
          analysis_invocation_id IS NULL
          AND snapshot_id IS NULL
          AND collection_run_id IS NULL
          AND source_provider = 'system'
          AND origin = 'derived'
          AND method = 'computed'
          AND grade = 'B'
        )
      ) NOT VALID;
  END IF;
END;
$$;

COMMENT ON CONSTRAINT evidence_source_lineage_required ON app.evidence IS
  'signalframe.evidence-provenance.v2';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.evidence
    WHERE NOT (
      (
        analysis_invocation_id IS NOT NULL
        AND snapshot_id IS NULL
        AND collection_run_id IS NULL
        AND source_provider = 'llm'
        AND origin = 'generated'
        AND method = 'generated'
        AND grade = 'C'
      )
      OR (
        analysis_invocation_id IS NULL
        AND snapshot_id IS NOT NULL
        AND collection_run_id IS NOT NULL
        AND source_provider IN ('crawl','gsc','ga4','csv','dataforseo')
        AND (
          (
            method = 'observed'
            AND (
              (
                source_provider IN ('gsc','ga4')
                AND origin = 'first_party'
                AND grade = 'A'
              )
              OR (
                source_provider = 'crawl'
                AND origin = 'direct_public'
                AND grade = 'B'
              )
              OR (
                source_provider = 'dataforseo'
                AND origin = 'vendor_observation'
                AND grade = 'B'
              )
              OR (
                source_provider = 'csv'
                AND origin = 'user_provided'
                AND grade = 'C'
              )
            )
          )
          OR (
            origin = 'derived'
            AND method = 'computed'
            AND grade = 'B'
          )
          OR (
            origin = 'derived'
            AND method = 'inferred'
            AND grade = 'C'
          )
        )
      )
      OR (
        analysis_invocation_id IS NULL
        AND snapshot_id IS NULL
        AND collection_run_id IS NULL
        AND source_provider = 'system'
        AND origin = 'derived'
        AND method = 'computed'
        AND grade = 'B'
      )
    )
  ) THEN
    ALTER TABLE app.evidence
      VALIDATE CONSTRAINT evidence_source_lineage_required;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_evidence_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_captured_at timestamptz;
BEGIN
  IF NEW.analysis_invocation_id IS NOT NULL THEN
    IF NEW.snapshot_id IS NOT NULL OR NEW.collection_run_id IS NOT NULL THEN
      RAISE EXCEPTION 'invocation-backed evidence cannot also claim source snapshot lineage'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.source_provider <> 'llm'
       OR NEW.origin <> 'generated'
       OR NEW.method <> 'generated'
       OR NEW.grade <> 'C' THEN
      RAISE EXCEPTION 'invocation-backed evidence must be generated LLM grade-C evidence'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app.analysis_invocations invocation
      JOIN app.diagnostic_runs diagnostic
        ON diagnostic.id = NEW.diagnostic_run_id
       AND diagnostic.workspace_id = NEW.workspace_id
       AND diagnostic.project_id = NEW.project_id
      WHERE invocation.id = NEW.analysis_invocation_id
        AND invocation.workspace_id = NEW.workspace_id
        AND invocation.project_id = NEW.project_id
        AND invocation.diagnostic_run_id = NEW.diagnostic_run_id
        AND invocation.async_run_id = NEW.diagnostic_run_id
        AND invocation.task = 'finding_summary'
        AND invocation.status = 'succeeded'
        AND invocation.output_hash IS NOT NULL
        AND invocation.prompt_set_version = diagnostic.prompt_set_version
    ) THEN
      RAISE EXCEPTION 'evidence invocation provenance does not match its diagnostic run'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.source_provider = 'llm' THEN
    RAISE EXCEPTION 'LLM evidence requires immutable invocation lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.source_provider = 'system' THEN
    IF NEW.snapshot_id IS NOT NULL OR NEW.collection_run_id IS NOT NULL THEN
      RAISE EXCEPTION 'system evidence cannot claim source snapshot lineage'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.origin <> 'derived'
       OR NEW.method <> 'computed'
       OR NEW.grade <> 'B' THEN
      RAISE EXCEPTION 'system evidence must be deterministic derived/computed/B evidence'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app.diagnostic_runs diagnostic
      WHERE diagnostic.id = NEW.diagnostic_run_id
        AND diagnostic.workspace_id = NEW.workspace_id
        AND diagnostic.project_id = NEW.project_id
    ) THEN
      RAISE EXCEPTION 'system evidence provenance does not match its diagnostic run'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.source_provider NOT IN ('crawl','gsc','ga4','csv','dataforseo') THEN
    RAISE EXCEPTION 'evidence source provider is not supported'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.snapshot_id IS NULL OR NEW.collection_run_id IS NULL THEN
    RAISE EXCEPTION 'source-backed evidence requires snapshot and collection lineage'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (
      NEW.method = 'observed'
      AND (
        (
          NEW.source_provider IN ('gsc','ga4')
          AND NEW.origin = 'first_party'
          AND NEW.grade = 'A'
        )
        OR (
          NEW.source_provider = 'crawl'
          AND NEW.origin = 'direct_public'
          AND NEW.grade = 'B'
        )
        OR (
          NEW.source_provider = 'dataforseo'
          AND NEW.origin = 'vendor_observation'
          AND NEW.grade = 'B'
        )
        OR (
          NEW.source_provider = 'csv'
          AND NEW.origin = 'user_provided'
          AND NEW.grade = 'C'
        )
      )
    )
    OR (
      NEW.origin = 'derived'
      AND NEW.method = 'computed'
      AND NEW.grade = 'B'
    )
    OR (
      NEW.origin = 'derived'
      AND NEW.method = 'inferred'
      AND NEW.grade = 'C'
    )
  ) THEN
    RAISE EXCEPTION 'evidence trust axes do not match observed or derived semantics'
      USING ERRCODE = '23514';
  END IF;

  SELECT snapshot.captured_at
  INTO source_captured_at
  FROM app.data_snapshots snapshot
  WHERE snapshot.id = NEW.snapshot_id
    AND snapshot.workspace_id = NEW.workspace_id
    AND snapshot.project_id = NEW.project_id
    AND snapshot.collection_run_id = NEW.collection_run_id
    AND snapshot.provider = NEW.source_provider;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence source lineage does not match its immutable snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.observed_at IS DISTINCT FROM source_captured_at THEN
    RAISE EXCEPTION 'evidence observation time does not match its source snapshot'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic
    JOIN app.data_snapshots snapshot
      ON snapshot.id = NEW.snapshot_id
     AND snapshot.workspace_id = NEW.workspace_id
     AND snapshot.project_id = NEW.project_id
     AND snapshot.site_id = diagnostic.site_id
     AND snapshot.collection_run_id = NEW.collection_run_id
     AND snapshot.provider = NEW.source_provider
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(diagnostic.input_manifest -> 'snapshots') = 'array'
        THEN diagnostic.input_manifest -> 'snapshots'
        ELSE '[]'::jsonb
      END
    ) AS frozen_snapshot(entry)
    WHERE diagnostic.id = NEW.diagnostic_run_id
      AND diagnostic.workspace_id = NEW.workspace_id
      AND diagnostic.project_id = NEW.project_id
      AND frozen_snapshot.entry ->> 'snapshotId' = NEW.snapshot_id::text
      AND frozen_snapshot.entry ->> 'provider' = NEW.source_provider
      AND frozen_snapshot.entry ->> 'datasetKey' = snapshot.dataset_key
      AND frozen_snapshot.entry ->> 'schemaVersion' = snapshot.schema_version
      AND frozen_snapshot.entry ->> 'methodVersion' = snapshot.method_version
      AND frozen_snapshot.entry ->> 'checksum' = snapshot.checksum
      AND frozen_snapshot.entry ->> 'availability' = snapshot.availability
      AND frozen_snapshot.entry -> 'sourceWindow' = snapshot.source_window
      AND (frozen_snapshot.entry ->> 'capturedAt')::timestamptz = snapshot.captured_at
      AND diagnostic.input_manifest ->> 'projectId' = diagnostic.project_id::text
      AND diagnostic.input_manifest ->> 'siteId' = diagnostic.site_id::text
      AND diagnostic.input_manifest ->> 'ruleSetVersion' = diagnostic.rule_set_version
      AND diagnostic.input_manifest ->> 'promptSetVersion' = diagnostic.prompt_set_version
      AND diagnostic.input_manifest ->> 'deliveryLocale' = diagnostic.output_locale
      AND diagnostic.input_manifest #>> '{icp,id}' = diagnostic.icp_profile_id::text
      AND (diagnostic.input_manifest #>> '{icp,version}')::integer = diagnostic.icp_profile_version
  ) THEN
    RAISE EXCEPTION 'evidence snapshot is not frozen in its diagnostic input manifest'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_provenance_guard ON app.evidence;
CREATE TRIGGER evidence_provenance_guard
  BEFORE INSERT ON app.evidence
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_evidence_provenance();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0012_page_snapshot_lineage_hardening'::text AS migration_version;

COMMIT;
