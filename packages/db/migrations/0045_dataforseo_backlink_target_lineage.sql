BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A domain-level DataForSEO query includes the target domain and its
-- subdomains. Keep exact SitePage lineage strict, but allow page-less Provider
-- facts anywhere inside the exact summary target domain family.
CREATE OR REPLACE FUNCTION app.enforce_backlink_fact_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot app.backlink_authority_snapshots%ROWTYPE;
  page app.site_pages%ROWTYPE;
  primary_site app.sites%ROWTYPE;
  expected_authority_kind text;
  dataforseo_target_domain text;
  target_authority text;
  target_hostname text;
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
  END IF;

  IF snapshot.subject_kind = 'primary_site'
     AND snapshot.provider = 'dataforseo' THEN
    target_authority := substring(NEW.target_url from '^https?://([^/?#]+)');
    target_hostname := lower(target_authority);
    SELECT CASE
      WHEN count(*) = 1 THEN min(observation.value_json ->> 'targetDomain')
      ELSE NULL
    END
    INTO dataforseo_target_domain
    FROM app.data_snapshots data_snapshot
    JOIN app.normalized_observations observation
      ON observation.snapshot_id = data_snapshot.id
     AND observation.workspace_id = data_snapshot.workspace_id
     AND observation.project_id = data_snapshot.project_id
     AND observation.provider = 'dataforseo'
     AND observation.metric_key = 'dataforseo.backlink_summary.v1'
     AND observation.subject_type = 'site'
     AND observation.origin = 'vendor_observation'
     AND observation.grade = 'B'
     AND observation.availability = 'available'
     AND observation.observed_at = data_snapshot.captured_at
     AND observation.value_json ->> 'targetDomain' = observation.subject_ref
    WHERE 'dfs-' || data_snapshot.id::text = snapshot.source_ref
      AND data_snapshot.workspace_id = snapshot.workspace_id
      AND data_snapshot.project_id = snapshot.project_id
      AND data_snapshot.site_id = snapshot.site_id
      AND data_snapshot.provider = 'dataforseo'
      AND data_snapshot.dataset_key = 'dataforseo.backlinks.v1'
      AND data_snapshot.schema_version = 'dataforseo.backlinks.v1'
      AND data_snapshot.method_version = 'dataforseo.backlinks.v1'
      AND data_snapshot.captured_at = snapshot.captured_at
      AND data_snapshot.availability = snapshot.availability
      AND data_snapshot.checksum = snapshot.checksum
      AND data_snapshot.row_count = snapshot.row_count;

    IF target_authority IS NULL
       OR target_authority IS DISTINCT FROM target_hostname
       OR position('@' IN target_authority) > 0
       OR position(':' IN target_authority) > 0
       OR dataforseo_target_domain IS NULL
       OR NOT (
         primary_site.host = dataforseo_target_domain
         OR right(
           primary_site.host,
           length(dataforseo_target_domain) + 1
         ) = '.' || dataforseo_target_domain
       )
       OR NOT (
         target_hostname = dataforseo_target_domain
         OR right(
           target_hostname,
           length(dataforseo_target_domain) + 1
         ) = '.' || dataforseo_target_domain
       ) THEN
      RAISE EXCEPTION 'primary-site backlink fact target URL is outside its DataForSEO summary domain'
        USING ERRCODE = '23514';
    END IF;
  ELSIF snapshot.subject_kind = 'primary_site'
        AND NEW.target_site_page_id IS NULL
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

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0045_dataforseo_backlink_target_lineage'::text
    AS migration_version;

COMMIT;
