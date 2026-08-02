BEGIN;

-- Search Console and GA4 can report real URLs that the bounded public Crawl
-- has not materialized as SitePages (including alternate hosts covered by a
-- domain property). The application preserves those URL observations with an
-- explicitly null SitePage lineage. Migration 0016 accidentally rejected both
-- a missing candidate (count 0) and an omitted unique candidate (count 1), even
-- though only the latter is an integrity violation. Keep exact Crawl lineage
-- mandatory, keep unique analytics lineage mandatory, and keep ambiguous or
-- unavailable analytics lineage explicitly null instead of inventing a page.
CREATE OR REPLACE FUNCTION app.enforce_normalized_observation_site_page_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  page_normalized_url text;
  snapshot_site_id uuid;
  base_url text;
  query_suffix text;
  canonical_subject text;
  slash_variant text;
  candidate_count integer;
  is_analytics_page boolean;
BEGIN
  is_analytics_page := (
    (NEW.provider = 'gsc' AND NEW.metric_key = 'gsc.page.v1')
    OR (NEW.provider = 'ga4' AND NEW.metric_key = 'ga4.landing.v1')
  );

  IF is_analytics_page THEN
    IF NEW.subject_type <> 'url' THEN
      RAISE EXCEPTION 'analytics page observation requires a URL subject'
        USING ERRCODE = '23514';
    END IF;

    SELECT snapshot.site_id
    INTO snapshot_site_id
    FROM app.data_snapshots snapshot
    WHERE snapshot.id = NEW.snapshot_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id;
    IF snapshot_site_id IS NULL THEN
      RAISE EXCEPTION 'analytics observation snapshot does not match its project scope'
        USING ERRCODE = '23514';
    END IF;

    -- Match the SitePage INSERT trigger's canonical-subject derivation and
    -- serialize cardinality proofs with every SitePage writer.
    base_url := split_part(NEW.subject_ref, '?', 1);
    query_suffix := CASE
      WHEN strpos(NEW.subject_ref, '?') = 0 THEN ''
      ELSE substring(NEW.subject_ref FROM strpos(NEW.subject_ref, '?'))
    END;
    canonical_subject := CASE
      WHEN base_url ~ '^https?://[^/]+/$' THEN NEW.subject_ref
      WHEN right(base_url, 1) = '/'
        THEN left(base_url, length(base_url) - 1) || query_suffix
      ELSE NEW.subject_ref
    END;

    PERFORM app.lock_site_page_canonical_subjects(
      NEW.workspace_id,
      NEW.project_id,
      snapshot_site_id,
      ARRAY[canonical_subject]
    );

    slash_variant := CASE
      WHEN base_url ~ '^https?://[^/]+/$' THEN NULL
      WHEN strpos(canonical_subject, '?') = 0 THEN canonical_subject || '/'
      ELSE left(canonical_subject, strpos(canonical_subject, '?') - 1)
        || '/'
        || substring(canonical_subject FROM strpos(canonical_subject, '?'))
    END;

    SELECT count(*)
    INTO candidate_count
    FROM app.site_pages page
    WHERE page.workspace_id = NEW.workspace_id
      AND page.project_id = NEW.project_id
      AND page.site_id = snapshot_site_id
      AND (
        page.normalized_url = canonical_subject
        OR page.normalized_url = slash_variant
      );
  END IF;

  IF NEW.site_page_id IS NULL THEN
    IF TG_OP = 'INSERT'
       AND NEW.provider = 'crawl'
       AND NEW.metric_key = 'crawl.page.v1' THEN
      RAISE EXCEPTION 'Crawl page observation requires an exact SitePage lineage'
        USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT'
       AND is_analytics_page
       AND candidate_count = 1 THEN
      RAISE EXCEPTION 'analytics URL observation requires its unambiguous SitePage lineage'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.subject_type <> 'url' THEN
    RAISE EXCEPTION 'only URL observations may reference a SitePage'
      USING ERRCODE = '23514';
  END IF;

  SELECT page.normalized_url
  INTO page_normalized_url
  FROM app.site_pages page
  JOIN app.data_snapshots snapshot
    ON snapshot.id = NEW.snapshot_id
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
  WHERE page.id = NEW.site_page_id
    AND page.workspace_id = NEW.workspace_id
    AND page.project_id = NEW.project_id
    AND page.site_id = snapshot.site_id;

  IF page_normalized_url IS NULL THEN
    RAISE EXCEPTION 'observation SitePage does not match its snapshot Site scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.provider = 'crawl' AND NEW.metric_key = 'crawl.page.v1' THEN
    IF NEW.value_json ->> 'fetchUrl' IS DISTINCT FROM page_normalized_url THEN
      RAISE EXCEPTION 'Crawl observation does not match its exact fetch SitePage'
        USING ERRCODE = '23514';
    END IF;
    base_url := split_part(page_normalized_url, '?', 1);
    query_suffix := CASE
      WHEN strpos(page_normalized_url, '?') = 0 THEN ''
      ELSE substring(page_normalized_url FROM strpos(page_normalized_url, '?'))
    END;
    canonical_subject := CASE
      WHEN base_url ~ '^https?://[^/]+/$' THEN page_normalized_url
      WHEN right(base_url, 1) = '/'
        THEN left(base_url, length(base_url) - 1) || query_suffix
      ELSE page_normalized_url
    END;
    IF NEW.subject_ref IS DISTINCT FROM canonical_subject THEN
      RAISE EXCEPTION 'Crawl observation subject does not match its canonical fetch identity'
        USING ERRCODE = '23514';
    END IF;
  ELSIF is_analytics_page THEN
    IF page_normalized_url IS DISTINCT FROM canonical_subject
       AND page_normalized_url IS DISTINCT FROM slash_variant THEN
      RAISE EXCEPTION 'analytics observation SitePage is not a canonical exact variant'
        USING ERRCODE = '23514';
    END IF;
    IF candidate_count <> 1 THEN
      RAISE EXCEPTION 'analytics observation SitePage lineage is ambiguous'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0036_missing_analytics_site_page_lineage'::text
    AS migration_version;

COMMIT;
