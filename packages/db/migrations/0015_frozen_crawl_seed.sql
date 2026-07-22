BEGIN;

-- A URL-first Product Profile may name a deep product page. Freeze that exact
-- SitePage identity when the Crawl command is accepted so a later profile edit
-- cannot silently change what the already-queued run will fetch.
ALTER TABLE app.collection_runs
  ADD COLUMN IF NOT EXISTS crawl_seed_site_page_id uuid,
  ADD COLUMN IF NOT EXISTS crawl_seed_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_runs_crawl_seed_site_page_fk'
      AND conrelid = 'app.collection_runs'::regclass
  ) THEN
    ALTER TABLE app.collection_runs
      ADD CONSTRAINT collection_runs_crawl_seed_site_page_fk
      FOREIGN KEY (crawl_seed_site_page_id)
      REFERENCES app.site_pages(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_runs_crawl_seed_pair_check'
      AND conrelid = 'app.collection_runs'::regclass
  ) THEN
    ALTER TABLE app.collection_runs
      ADD CONSTRAINT collection_runs_crawl_seed_pair_check
      CHECK (
        (crawl_seed_site_page_id IS NULL) = (crawl_seed_url IS NULL)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_runs_crawl_seed_provider_check'
      AND conrelid = 'app.collection_runs'::regclass
  ) THEN
    ALTER TABLE app.collection_runs
      ADD CONSTRAINT collection_runs_crawl_seed_provider_check
      CHECK (crawl_seed_site_page_id IS NULL OR provider = 'crawl');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collection_runs_crawl_seed_url_check'
      AND conrelid = 'app.collection_runs'::regclass
  ) THEN
    ALTER TABLE app.collection_runs
      ADD CONSTRAINT collection_runs_crawl_seed_url_check
      CHECK (
        crawl_seed_url IS NULL
        OR length(crawl_seed_url) BETWEEN 1 AND 2048
      );
  END IF;
END;
$$;

-- Retain the full CollectionRun provenance contract while adding the frozen
-- seed pair. The seed must resolve to one exact, canonical SitePage row in the
-- same workspace/project/Site, including the exact UTF-8 URL hash.
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

DROP TRIGGER IF EXISTS collection_runs_provenance_guard ON app.collection_runs;
CREATE TRIGGER collection_runs_provenance_guard
  BEFORE INSERT OR UPDATE ON app.collection_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_collection_run_provenance();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0015_frozen_crawl_seed'::text AS migration_version;

COMMIT;
