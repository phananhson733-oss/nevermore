BEGIN;

-- URL observations keep their aggregation subject_ref, while this nullable
-- foreign key records the exact SitePage selected by the collection commit.
-- A null remains meaningful: historical evidence may be unavailable, and a
-- canonical GSC/GA4 subject may correspond to multiple exact fetch variants.
ALTER TABLE app.normalized_observations
  ADD COLUMN IF NOT EXISTS site_page_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'normalized_observations_site_page_fk'
      AND conrelid = 'app.normalized_observations'::regclass
  ) THEN
    ALTER TABLE app.normalized_observations
      ADD CONSTRAINT normalized_observations_site_page_fk
      FOREIGN KEY (site_page_id)
      REFERENCES app.site_pages(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'normalized_observations_site_page_subject_check'
      AND conrelid = 'app.normalized_observations'::regclass
  ) THEN
    ALTER TABLE app.normalized_observations
      ADD CONSTRAINT normalized_observations_site_page_subject_check
      CHECK (site_page_id IS NULL OR subject_type = 'url');
  END IF;
END;
$$;

-- SitePage can also be created by Product Profile and future URL-first flows.
-- Put every writer on the same canonical-subject transaction lock as analytics
-- resolution, so `/path` cannot race `/path/` between the candidate read and
-- the append-only Observation insert.
CREATE OR REPLACE FUNCTION app.lock_site_page_canonical_subjects(
  workspace_id uuid,
  project_id uuid,
  site_id uuid,
  subject_refs text[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  canonical_subject text;
BEGIN
  IF workspace_id IS NULL OR project_id IS NULL OR site_id IS NULL THEN
    RAISE EXCEPTION 'canonical subject lock requires complete project Site scope'
      USING ERRCODE = '22023';
  END IF;
  IF subject_refs IS NULL OR cardinality(subject_refs) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'canonical subject lock requires 1 to 500 subjects'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(subject_refs) AS candidate(subject_ref)
    WHERE candidate.subject_ref IS NULL
      OR length(candidate.subject_ref) NOT BETWEEN 1 AND 2048
  ) THEN
    RAISE EXCEPTION 'canonical subjects must contain 1 to 2048 characters'
      USING ERRCODE = '22023';
  END IF;

  -- A PL/pgSQL loop makes acquisition order an execution guarantee. A target-
  -- list function under SQL ORDER BY may be evaluated before the sort.
  FOR canonical_subject IN
    SELECT DISTINCT candidate.subject_ref
    FROM unnest(subject_refs) AS candidate(subject_ref)
    ORDER BY candidate.subject_ref
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      workspace_id::text || ':' ||
      project_id::text || ':' ||
      site_id::text || ':' ||
      canonical_subject,
      5704921::bigint
    ));
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION app.lock_site_page_canonical_subject()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base_url text;
  query_suffix text;
  canonical_subject text;
BEGIN
  base_url := split_part(NEW.normalized_url, '?', 1);
  query_suffix := CASE
    WHEN strpos(NEW.normalized_url, '?') = 0 THEN ''
    ELSE substring(NEW.normalized_url FROM strpos(NEW.normalized_url, '?'))
  END;
  canonical_subject := CASE
    WHEN base_url ~ '^https?://[^/]+/$' THEN NEW.normalized_url
    WHEN right(base_url, 1) = '/'
      THEN left(base_url, length(base_url) - 1) || query_suffix
    ELSE NEW.normalized_url
  END;

  PERFORM app.lock_site_page_canonical_subjects(
    NEW.workspace_id,
    NEW.project_id,
    NEW.site_id,
    ARRAY[canonical_subject]
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_pages_canonical_subject_lock ON app.site_pages;
CREATE TRIGGER site_pages_canonical_subject_lock
  BEFORE INSERT ON app.site_pages
  FOR EACH ROW
  EXECUTE FUNCTION app.lock_site_page_canonical_subject();

-- Re-derive duplicated scope from canonical rows. Crawl observations additionally
-- prove the exact HTTP fact through value_json.fetchUrl. GSC/GA4 observations
-- may bind only to the exact or trailing-slash fetch variant of subject_ref.
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

    -- This is intentionally byte-for-byte equivalent to the SitePage INSERT
    -- trigger's canonical-subject derivation and lock key. Direct SQL writers
    -- therefore cannot race this cardinality proof with a slash-variant page.
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
    IF TG_OP = 'INSERT' AND is_analytics_page THEN
      IF candidate_count <= 1 THEN
        RAISE EXCEPTION 'analytics URL observation requires its unambiguous SitePage lineage'
          USING ERRCODE = '23514';
      END IF;
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

DROP TRIGGER IF EXISTS normalized_observations_site_page_guard
  ON app.normalized_observations;
CREATE TRIGGER normalized_observations_site_page_guard
  BEFORE INSERT OR UPDATE OF site_page_id ON app.normalized_observations
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_normalized_observation_site_page_lineage();

-- Migration-only provenance enrichment. The immutable provider facts and their
-- aggregation subject_ref are untouched. The append-only trigger is restored
-- before this transaction commits, so application writes remain insert-only.
DROP TRIGGER IF EXISTS normalized_observations_append_only
  ON app.normalized_observations;

-- Crawl carries the exact fetch URL in its immutable projection. Match exact
-- bytes and the snapshot's Site; anything absent or inconsistent stays null.
WITH crawl_candidates AS (
  SELECT
    observation.id AS observation_id,
    page.id AS site_page_id,
    observation.subject_ref,
    page.normalized_url,
    split_part(page.normalized_url, '?', 1) AS base_url,
    CASE
      WHEN strpos(page.normalized_url, '?') = 0 THEN ''
      ELSE substring(page.normalized_url FROM strpos(page.normalized_url, '?'))
    END AS query_suffix
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = observation.workspace_id
   AND snapshot.project_id = observation.project_id
   AND snapshot.provider = observation.provider
  JOIN app.site_pages page
    ON page.workspace_id = observation.workspace_id
   AND page.project_id = observation.project_id
   AND page.site_id = snapshot.site_id
   AND page.normalized_url = observation.value_json ->> 'fetchUrl'
  WHERE observation.site_page_id IS NULL
    AND observation.provider = 'crawl'
    AND observation.metric_key = 'crawl.page.v1'
    AND observation.subject_type = 'url'
    AND jsonb_typeof(observation.value_json) = 'object'
), exact_crawl_lineage AS (
  SELECT candidate.observation_id, candidate.site_page_id
  FROM crawl_candidates candidate
  WHERE candidate.subject_ref = CASE
    WHEN candidate.base_url ~ '^https?://[^/]+/$'
      THEN candidate.normalized_url
    WHEN right(candidate.base_url, 1) = '/'
      THEN left(candidate.base_url, length(candidate.base_url) - 1)
        || candidate.query_suffix
    ELSE candidate.normalized_url
  END
)
UPDATE app.normalized_observations observation
SET site_page_id = lineage.site_page_id
FROM exact_crawl_lineage lineage
WHERE observation.id = lineage.observation_id;

-- Analytics subject_ref is an aggregation key. Build its only two possible
-- exact fetch identities (one for a root subject), then link only a cardinality
-- of exactly one. A count of zero or more than one is deliberately left null.
WITH analytics_inputs AS (
  SELECT
    observation.id AS observation_id,
    observation.workspace_id,
    observation.project_id,
    snapshot.site_id,
    observation.subject_ref,
    split_part(observation.subject_ref, '?', 1) AS base_url,
    CASE
      WHEN strpos(observation.subject_ref, '?') = 0 THEN ''
      ELSE substring(
        observation.subject_ref FROM strpos(observation.subject_ref, '?')
      )
    END AS query_suffix
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = observation.workspace_id
   AND snapshot.project_id = observation.project_id
   AND snapshot.provider = observation.provider
  WHERE observation.site_page_id IS NULL
    AND observation.subject_type = 'url'
    AND (
      (observation.provider = 'gsc' AND observation.metric_key = 'gsc.page.v1')
      OR (
        observation.provider = 'ga4'
        AND observation.metric_key = 'ga4.landing.v1'
      )
    )
), analytics_subjects AS (
  SELECT
    input.*,
    CASE
      WHEN input.base_url ~ '^https?://[^/]+/$' THEN input.subject_ref
      WHEN right(input.base_url, 1) = '/'
        THEN left(input.base_url, length(input.base_url) - 1)
          || input.query_suffix
      ELSE input.subject_ref
    END AS canonical_subject
  FROM analytics_inputs input
), analytics_variants AS (
  SELECT
    subject.*,
    CASE
      WHEN subject.base_url ~ '^https?://[^/]+/$' THEN NULL
      WHEN strpos(subject.canonical_subject, '?') = 0
        THEN subject.canonical_subject || '/'
      ELSE left(
        subject.canonical_subject,
        strpos(subject.canonical_subject, '?') - 1
      ) || '/' || substring(
        subject.canonical_subject
        FROM strpos(subject.canonical_subject, '?')
      )
    END AS slash_variant
  FROM analytics_subjects subject
), analytics_candidates AS (
  SELECT subject.observation_id, page.id AS site_page_id
  FROM analytics_variants subject
  JOIN app.site_pages page
    ON page.workspace_id = subject.workspace_id
   AND page.project_id = subject.project_id
   AND page.site_id = subject.site_id
   AND (
     page.normalized_url = subject.canonical_subject
     OR page.normalized_url = subject.slash_variant
   )
), unique_analytics_lineage AS (
  SELECT
    observation_id,
    max(site_page_id::text)::uuid AS site_page_id
  FROM analytics_candidates
  GROUP BY observation_id
  HAVING count(*) = 1
)
UPDATE app.normalized_observations observation
SET site_page_id = lineage.site_page_id
FROM unique_analytics_lineage lineage
WHERE observation.id = lineage.observation_id;

CREATE TRIGGER normalized_observations_append_only
  BEFORE UPDATE OR DELETE ON app.normalized_observations
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE INDEX IF NOT EXISTS normalized_observations_site_page_metric_idx
  ON app.normalized_observations(
    project_id,
    site_page_id,
    metric_key,
    observed_at DESC,
    id DESC
  )
  WHERE site_page_id IS NOT NULL;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0016_observation_site_page_lineage'::text AS migration_version;

COMMIT;
