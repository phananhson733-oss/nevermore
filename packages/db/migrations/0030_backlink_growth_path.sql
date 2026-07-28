BEGIN;

-- Backlink evidence is an internal path of the existing Growth Map. It does
-- not extend app.source_connections: customer-managed connections remain GSC,
-- GA4, and the reserved GitHub delivery slot in the customer UI.
ALTER TABLE app.import_previews
  DROP CONSTRAINT IF EXISTS import_previews_template_id_check;
ALTER TABLE app.import_previews
  ADD CONSTRAINT import_previews_template_id_check CHECK (
    template_id IN ('keyword_gap_v1','backlink_v1')
  );

-- One row is one immutable authority assertion for the primary site or one
-- already-approved competitor. Provider imports may expose index totals and
-- DR/DA. CSV and built-in search discovery are explicitly observed subsets.
CREATE TABLE app.backlink_authority_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  competitor_id uuid
    REFERENCES app.competitor_entities(id) ON DELETE RESTRICT,
  subject_kind text NOT NULL CHECK (
    subject_kind IN ('primary_site','approved_competitor')
  ),
  source_kind text NOT NULL CHECK (
    source_kind IN ('provider_import','manual_csv','search_derived')
  ),
  provider text NOT NULL CHECK (
    provider IN ('ahrefs','moz','manual_csv','search_derived')
  ),
  captured_at timestamptz NOT NULL,
  availability text NOT NULL CHECK (
    availability IN ('available','partial','unavailable')
  ),
  index_scope text NOT NULL CHECK (
    index_scope IN ('provider_index','observed_subset','unavailable')
  ),
  total_backlinks bigint CHECK (
    total_backlinks BETWEEN 0 AND 9007199254740991
  ),
  total_referring_domains bigint CHECK (
    total_referring_domains BETWEEN 0 AND 9007199254740991
  ),
  observed_backlinks bigint CHECK (
    observed_backlinks BETWEEN 0 AND 9007199254740991
  ),
  observed_referring_domains bigint CHECK (
    observed_referring_domains BETWEEN 0 AND 9007199254740991
  ),
  authority_metric_kind text CHECK (
    authority_metric_kind IS NULL
    OR authority_metric_kind IN ('domain_rating','domain_authority')
  ),
  authority_metric_value numeric(6,2) CHECK (
    authority_metric_value BETWEEN 0 AND 100
  ),
  source_ref text NOT NULL CHECK (
    length(source_ref) BETWEEN 1 AND 240
    AND source_ref = btrim(source_ref)
    AND source_ref !~ '[[:cntrl:]]'
    AND position('/' IN source_ref) = 0
    AND position(E'\\' IN source_ref) = 0
    AND position('?' IN source_ref) = 0
    AND position('&' IN source_ref) = 0
    AND position('#' IN source_ref) = 0
    AND position('=' IN source_ref) = 0
  ),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  row_count bigint NOT NULL CHECK (
    row_count BETWEEN 0 AND 9007199254740991
  ),
  import_preview_id uuid
    REFERENCES app.import_previews(id) ON DELETE RESTRICT,
  limitation text CHECK (
    limitation IS NULL
    OR (
      length(limitation) BETWEEN 1 AND 2000
      AND limitation = btrim(limitation)
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (
      subject_kind = 'primary_site'
      AND competitor_id IS NULL
    )
    OR (
      subject_kind = 'approved_competitor'
      AND competitor_id IS NOT NULL
    )
  ),
  CHECK (
    (
      source_kind = 'provider_import'
      AND provider IN ('ahrefs','moz')
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
  ),
  CHECK (
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
      provider IN ('manual_csv','search_derived')
      AND authority_metric_kind IS NULL
    )
  ),
  CHECK (
    (authority_metric_kind IS NULL)
    = (authority_metric_value IS NULL)
  )
);

CREATE UNIQUE INDEX backlink_authority_identity_idx
  ON app.backlink_authority_snapshots (
    project_id,
    subject_kind,
    (coalesce(competitor_id, site_id)),
    source_kind,
    provider,
    source_ref
  );
CREATE INDEX backlink_authority_subject_source_idx
  ON app.backlink_authority_snapshots (
    project_id,
    subject_kind,
    competitor_id,
    source_kind,
    provider,
    captured_at DESC,
    id
  );

-- Provider facts may carry the same provider's authority metric for the
-- referring domain. CSV/search-derived facts never carry DR or DA.
CREATE TABLE app.backlink_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL
    REFERENCES app.backlink_authority_snapshots(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  referring_domain text NOT NULL CHECK (
    app.is_normalized_competitor_domain(referring_domain)
  ),
  source_url text NOT NULL CHECK (
    length(source_url) BETWEEN 1 AND 2048
    AND source_url = btrim(source_url)
    AND source_url ~ '^https?://'
  ),
  target_url text NOT NULL CHECK (
    length(target_url) BETWEEN 1 AND 2048
    AND target_url = btrim(target_url)
    AND target_url ~ '^https?://'
  ),
  target_site_page_id uuid
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  source_authority_metric_kind text CHECK (
    source_authority_metric_kind IS NULL
    OR source_authority_metric_kind IN (
      'domain_rating',
      'domain_authority'
    )
  ),
  source_authority_metric_value numeric(6,2) CHECK (
    source_authority_metric_value BETWEEN 0 AND 100
  ),
  link_kind text NOT NULL DEFAULT 'unknown' CHECK (
    link_kind IN ('dofollow','nofollow','ugc','sponsored','unknown')
  ),
  source_ref text NOT NULL CHECK (
    length(source_ref) BETWEEN 1 AND 500
    AND source_ref = btrim(source_ref)
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, source_ref),
  CHECK (
    (source_authority_metric_kind IS NULL)
    = (source_authority_metric_value IS NULL)
  )
);

CREATE INDEX backlink_facts_target_page_idx
  ON app.backlink_facts (
    project_id,
    target_site_page_id,
    snapshot_id,
    id
  );
CREATE INDEX backlink_facts_referring_domain_idx
  ON app.backlink_facts (
    project_id,
    referring_domain,
    snapshot_id,
    id
  );

-- Page totals are persisted only when a source explicitly supplied them.
-- A real Provider may persist an exact zero. Missing pages have no row and are
-- never materialized as zero by SQL or the read service.
CREATE TABLE app.backlink_page_metrics (
  snapshot_id uuid NOT NULL
    REFERENCES app.backlink_authority_snapshots(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  title text CHECK (
    title IS NULL
    OR (
      length(title) BETWEEN 1 AND 500
      AND title = btrim(title)
    )
  ),
  backlink_count bigint NOT NULL CHECK (
    backlink_count BETWEEN 0 AND 9007199254740991
  ),
  referring_domain_count bigint NOT NULL CHECK (
    referring_domain_count BETWEEN 0 AND 9007199254740991
  ),
  metric_semantics text NOT NULL CHECK (
    metric_semantics IN ('provider_index_total','observed_fact_count')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, site_page_id)
);

CREATE INDEX backlink_page_metrics_page_idx
  ON app.backlink_page_metrics (
    project_id,
    site_page_id,
    snapshot_id
  );

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

CREATE OR REPLACE FUNCTION app.enforce_backlink_page_metric_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot app.backlink_authority_snapshots%ROWTYPE;
  page app.site_pages%ROWTYPE;
  expected_semantics text;
BEGIN
  SELECT *
  INTO snapshot
  FROM app.backlink_authority_snapshots candidate
  WHERE candidate.workspace_id = NEW.workspace_id
    AND candidate.project_id = NEW.project_id
    AND candidate.site_id = NEW.site_id
    AND candidate.id = NEW.snapshot_id
    AND candidate.subject_kind = 'primary_site'
    AND candidate.availability <> 'unavailable';

  SELECT *
  INTO page
  FROM app.site_pages candidate
  WHERE candidate.workspace_id = NEW.workspace_id
    AND candidate.project_id = NEW.project_id
    AND candidate.site_id = NEW.site_id
    AND candidate.id = NEW.site_page_id;

  IF snapshot.id IS NULL OR page.id IS NULL THEN
    RAISE EXCEPTION 'backlink page metric does not match its primary-site snapshot and exact SitePage'
      USING ERRCODE = '23514';
  END IF;

  expected_semantics := CASE snapshot.source_kind
    WHEN 'provider_import' THEN 'provider_index_total'
    ELSE 'observed_fact_count'
  END;
  IF NEW.metric_semantics IS DISTINCT FROM expected_semantics THEN
    RAISE EXCEPTION 'backlink page metric semantics do not match its source scope'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER backlink_authority_snapshots_insert_guard
BEFORE INSERT ON app.backlink_authority_snapshots
FOR EACH ROW
EXECUTE FUNCTION app.enforce_backlink_authority_snapshot_insert();

CREATE TRIGGER backlink_facts_insert_guard
BEFORE INSERT ON app.backlink_facts
FOR EACH ROW
EXECUTE FUNCTION app.enforce_backlink_fact_insert();

CREATE TRIGGER backlink_page_metrics_insert_guard
BEFORE INSERT ON app.backlink_page_metrics
FOR EACH ROW
EXECUTE FUNCTION app.enforce_backlink_page_metric_insert();

CREATE TRIGGER backlink_authority_snapshots_append_only
BEFORE UPDATE OR DELETE ON app.backlink_authority_snapshots
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER backlink_facts_append_only
BEFORE UPDATE OR DELETE ON app.backlink_facts
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE TRIGGER backlink_page_metrics_append_only
BEFORE UPDATE OR DELETE ON app.backlink_page_metrics
FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0030_backlink_growth_path'::text AS migration_version;

COMMIT;
