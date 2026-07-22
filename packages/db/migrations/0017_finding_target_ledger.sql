BEGIN;

-- Per-run target membership is an immutable fact, separate from the mutable
-- cross-run Finding projection. Historical Findings are intentionally not
-- backfilled: deriving page membership from current subject_refs would invent
-- lineage. A historical run without rows remains explicitly unavailable.
CREATE TABLE IF NOT EXISTS app.finding_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL
    REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL
    REFERENCES app.sites(id) ON DELETE RESTRICT,
  finding_id uuid NOT NULL
    REFERENCES app.findings(id) ON DELETE RESTRICT,
  diagnostic_run_id uuid NOT NULL
    REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  relation text NOT NULL CHECK (relation IN (
    'direct_url',
    'affected_by_template',
    'affected_by_site',
    'affected_by_page_set',
    'affected_by_http_status',
    'affected_by_canonical_issue',
    'affected_by_keyword_cluster',
    'affected_by_user_agent'
  )),
  target_kind text NOT NULL CHECK (target_kind IN (
    'url',
    'template',
    'site',
    'page_set',
    'http_status',
    'canonical_issue',
    'keyword_cluster',
    'user_agent'
  )),
  target_ref text NOT NULL,
  resolution_state text NOT NULL CHECK (resolution_state IN (
    'resolved','unresolved','definition_only'
  )),
  basis_kind text NOT NULL CHECK (basis_kind IN (
    'crawl_exact_fetch',
    'observation_site_page',
    'unresolved_observation',
    'target_definition'
  )),
  site_page_id uuid
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  page_snapshot_id uuid
    REFERENCES app.page_snapshots(id) ON DELETE RESTRICT,
  source_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  member_ref text,
  limitation text,
  -- The BEFORE INSERT guard always replaces this placeholder with a hash of
  -- the complete semantic tuple. The default lets writers omit a derived key.
  relation_key text NOT NULL DEFAULT repeat('0', 64)
    CHECK (relation_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (relation = 'direct_url' AND target_kind = 'url')
    OR (relation = 'affected_by_template' AND target_kind = 'template')
    OR (relation = 'affected_by_site' AND target_kind = 'site')
    OR (relation = 'affected_by_page_set' AND target_kind = 'page_set')
    OR (
      relation = 'affected_by_http_status'
      AND target_kind = 'http_status'
    )
    OR (
      relation = 'affected_by_canonical_issue'
      AND target_kind = 'canonical_issue'
    )
    OR (
      relation = 'affected_by_keyword_cluster'
      AND target_kind = 'keyword_cluster'
    )
    OR (
      relation = 'affected_by_user_agent'
      AND target_kind = 'user_agent'
    )
  ),
  CHECK (
    length(target_ref) BETWEEN 1 AND
      CASE WHEN target_kind = 'url' THEN 2048 ELSE 500 END
    AND target_ref = btrim(target_ref)
  ),
  CHECK (
    member_ref IS NULL
    OR (
      length(member_ref) BETWEEN 1 AND 2048
      AND member_ref = btrim(member_ref)
    )
  ),
  CHECK (
    limitation IS NULL
    OR (
      length(limitation) BETWEEN 1 AND 2000
      AND limitation = btrim(limitation)
    )
  ),
  CHECK (resolution_state <> 'resolved' OR limitation IS NULL),
  CHECK (
    target_kind <> 'http_status'
    OR target_ref ~ '^[1-5][0-9]{2}$'
  ),
  CHECK (
    target_kind <> 'canonical_issue'
    OR target_ref IN (
      'reciprocal','broken_target','sitemap_contradiction'
    )
  ),
  UNIQUE (finding_id, diagnostic_run_id, relation_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS finding_targets_one_direct_root_idx
  ON app.finding_targets(finding_id, diagnostic_run_id)
  WHERE relation = 'direct_url';

CREATE UNIQUE INDEX IF NOT EXISTS finding_targets_one_definition_root_idx
  ON app.finding_targets(finding_id, diagnostic_run_id)
  WHERE resolution_state = 'definition_only';

CREATE UNIQUE INDEX IF NOT EXISTS finding_targets_one_observation_member_idx
  ON app.finding_targets(
    finding_id,
    diagnostic_run_id,
    source_observation_id
  )
  WHERE source_observation_id IS NOT NULL;

-- jsonb has a deterministic canonical text representation for this bounded
-- all-string/null tuple. Hashing it in the database keeps every writer on one
-- identity implementation and includes nullable provenance anchors explicitly.
CREATE OR REPLACE FUNCTION app.finding_target_relation_key(
  selected_relation text,
  selected_target_kind text,
  selected_target_ref text,
  selected_resolution_state text,
  selected_basis_kind text,
  selected_site_page_id uuid,
  selected_page_snapshot_id uuid,
  selected_source_observation_id uuid,
  selected_member_ref text,
  selected_limitation text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    digest(
      convert_to(
        jsonb_build_object(
          'relation', selected_relation,
          'targetKind', selected_target_kind,
          'targetRef', selected_target_ref,
          'resolutionState', selected_resolution_state,
          'basisKind', selected_basis_kind,
          'sitePageId', selected_site_page_id,
          'pageSnapshotId', selected_page_snapshot_id,
          'sourceObservationId', selected_source_observation_id,
          'memberRef', selected_member_ref,
          'limitation', selected_limitation
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

CREATE OR REPLACE FUNCTION app.enforce_finding_target_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  finding_last_seen_run_id uuid;
  finding_rule_id text;
  expected_relation text;
  diagnostic_site_id uuid;
  observation_provider text;
  observation_metric_key text;
  observation_subject_ref text;
  observation_site_page_id uuid;
  observation_snapshot_id uuid;
  observation_fetch_url text;
  observation_final_status text;
  page_normalized_url text;
  page_template_key text;
BEGIN
  NEW.relation_key := app.finding_target_relation_key(
    NEW.relation,
    NEW.target_kind,
    NEW.target_ref,
    NEW.resolution_state,
    NEW.basis_kind,
    NEW.site_page_id,
    NEW.page_snapshot_id,
    NEW.source_observation_id,
    NEW.member_ref,
    NEW.limitation
  );

  -- A worker retry may replay an immutable row after a later DiagnosticRun
  -- has advanced the mutable Finding projection. BEFORE triggers run before
  -- ON CONFLICT, so let only a scope- and tuple-exact historical row reach the
  -- repository's declared conflict arbiter. A novel stale-run row continues
  -- into the current-sighting guard below and is rejected.
  IF EXISTS (
    SELECT 1
    FROM app.finding_targets existing
    WHERE existing.workspace_id = NEW.workspace_id
      AND existing.project_id = NEW.project_id
      AND existing.site_id = NEW.site_id
      AND existing.finding_id = NEW.finding_id
      AND existing.diagnostic_run_id = NEW.diagnostic_run_id
      AND existing.relation_key = NEW.relation_key
      AND existing.relation = NEW.relation
      AND existing.target_kind = NEW.target_kind
      AND existing.target_ref = NEW.target_ref
      AND existing.resolution_state = NEW.resolution_state
      AND existing.basis_kind = NEW.basis_kind
      AND existing.site_page_id IS NOT DISTINCT FROM NEW.site_page_id
      AND existing.page_snapshot_id IS NOT DISTINCT FROM NEW.page_snapshot_id
      AND existing.source_observation_id IS NOT DISTINCT FROM
        NEW.source_observation_id
      AND existing.member_ref IS NOT DISTINCT FROM NEW.member_ref
      AND existing.limitation IS NOT DISTINCT FROM NEW.limitation
  ) THEN
    RETURN NEW;
  END IF;

  -- A target row is written only in the transaction that first creates or
  -- re-hits the Finding for this exact DiagnosticRun. Lock the projection so a
  -- concurrent later run cannot advance last_seen while this insert commits.
  SELECT finding.last_seen_run_id, finding.rule_id
  INTO finding_last_seen_run_id, finding_rule_id
  FROM app.findings finding
  WHERE finding.id = NEW.finding_id
    AND finding.workspace_id = NEW.workspace_id
    AND finding.project_id = NEW.project_id
  FOR UPDATE;

  IF NOT FOUND
     OR finding_last_seen_run_id IS DISTINCT FROM NEW.diagnostic_run_id THEN
    RAISE EXCEPTION 'Finding target does not match its current Finding sighting'
      USING ERRCODE = '23514';
  END IF;

  SELECT diagnostic.site_id
  INTO diagnostic_site_id
  FROM app.diagnostic_runs diagnostic
  WHERE diagnostic.id = NEW.diagnostic_run_id
    AND diagnostic.workspace_id = NEW.workspace_id
    AND diagnostic.project_id = NEW.project_id
  FOR SHARE;

  IF NOT FOUND OR diagnostic_site_id IS DISTINCT FROM NEW.site_id THEN
    RAISE EXCEPTION 'Finding target does not match its DiagnosticRun Site scope'
      USING ERRCODE = '23514';
  END IF;

  expected_relation := CASE finding_rule_id
    WHEN 'TECH-HTTP-001' THEN 'affected_by_http_status'
    WHEN 'TECH-CANONICAL-002' THEN 'affected_by_canonical_issue'
    WHEN 'TECH-LINKGRAPH-005' THEN 'affected_by_page_set'
    WHEN 'SEARCH-CTR-004' THEN 'direct_url'
    WHEN 'SEARCH-DECAY-002' THEN 'direct_url'
    WHEN 'CONTENT-COVERAGE-001' THEN 'affected_by_page_set'
    WHEN 'CONTENT-GAP-011' THEN 'affected_by_keyword_cluster'
    WHEN 'CRO-PATH-001' THEN 'affected_by_page_set'
    WHEN 'CRO-LANDING-003' THEN 'direct_url'
    WHEN 'GEO-ENTITY-001' THEN 'affected_by_page_set'
    WHEN 'GEO-CRAWLER-002' THEN 'affected_by_user_agent'
    ELSE NULL
  END;

  IF expected_relation IS NULL OR NEW.relation IS DISTINCT FROM expected_relation THEN
    RAISE EXCEPTION 'Finding target root does not match its diagnostic rule'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN (
       'TECH-HTTP-001',
       'TECH-CANONICAL-002',
       'TECH-LINKGRAPH-005',
       'CRO-PATH-001',
       'GEO-ENTITY-001'
     )
     AND NOT (
       NEW.resolution_state = 'resolved'
       AND NEW.basis_kind = 'crawl_exact_fetch'
     ) THEN
    RAISE EXCEPTION 'Finding target rule requires resolved exact Crawl members'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN (
       'CONTENT-COVERAGE-001',
       'CONTENT-GAP-011',
       'GEO-CRAWLER-002'
     )
     AND NOT (
       NEW.resolution_state = 'definition_only'
       AND NEW.basis_kind = 'target_definition'
     ) THEN
    RAISE EXCEPTION 'Finding target rule requires one definition-only root'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN ('SEARCH-CTR-004','SEARCH-DECAY-002')
     AND NOT (
       (
         NEW.resolution_state = 'resolved'
         AND NEW.basis_kind = 'observation_site_page'
       )
       OR (
         NEW.resolution_state = 'unresolved'
         AND NEW.basis_kind = 'unresolved_observation'
       )
     ) THEN
    RAISE EXCEPTION 'Search Finding target requires resolved or unresolved GSC lineage'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id = 'CRO-LANDING-003'
     AND NOT (
       (
         NEW.resolution_state = 'resolved'
         AND NEW.basis_kind = 'observation_site_page'
       )
       OR (
         NEW.resolution_state = 'unresolved'
         AND NEW.basis_kind = 'unresolved_observation'
       )
     ) THEN
    RAISE EXCEPTION 'CRO landing target requires resolved or unresolved GA4 lineage'
      USING ERRCODE = '23514';
  END IF;

  -- Locking the durable Finding row above serializes every direct-SQL writer,
  -- including concurrent first inserts. Re-check the committed ledger only
  -- after that lock, so one Finding/run can never split into multiple roots.
  IF EXISTS (
    SELECT 1
    FROM app.finding_targets existing
    WHERE existing.finding_id = NEW.finding_id
      AND existing.diagnostic_run_id = NEW.diagnostic_run_id
      AND (
        existing.relation IS DISTINCT FROM NEW.relation
        OR existing.target_kind IS DISTINCT FROM NEW.target_kind
        OR existing.target_ref IS DISTINCT FROM NEW.target_ref
        OR (
          existing.resolution_state = 'definition_only'
        ) IS DISTINCT FROM (
          NEW.resolution_state = 'definition_only'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Finding target rows cannot diverge from their per-run root'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolution_state = 'definition_only' THEN
    IF NEW.basis_kind <> 'target_definition'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.page_snapshot_id IS NOT NULL
       OR NEW.source_observation_id IS NOT NULL
       OR NEW.member_ref IS NOT NULL
       OR NEW.relation NOT IN (
         'affected_by_template',
         'affected_by_site',
         'affected_by_page_set',
         'affected_by_keyword_cluster',
         'affected_by_user_agent'
       ) THEN
      RAISE EXCEPTION 'Finding target definition has invalid provenance shape'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_observation_id IS NULL OR NEW.member_ref IS NULL THEN
    RAISE EXCEPTION 'Observation-backed Finding target requires immutable source identity'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    observation.provider,
    observation.metric_key,
    observation.subject_ref,
    observation.site_page_id,
    observation.snapshot_id,
    observation.value_json ->> 'fetchUrl',
    observation.value_json ->> 'finalStatus'
  INTO
    observation_provider,
    observation_metric_key,
    observation_subject_ref,
    observation_site_page_id,
    observation_snapshot_id,
    observation_fetch_url,
    observation_final_status
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = observation.workspace_id
   AND snapshot.project_id = observation.project_id
   AND snapshot.provider = observation.provider
   AND snapshot.site_id = NEW.site_id
  WHERE observation.id = NEW.source_observation_id
    AND observation.workspace_id = NEW.workspace_id
    AND observation.project_id = NEW.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finding target Observation does not match its Site scope'
      USING ERRCODE = '23514';
  END IF;

  -- The Observation's complete immutable DataSnapshot identity must be frozen
  -- in this exact run. An ID-only or stale manifest entry is insufficient.
  IF NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic
    JOIN app.data_snapshots snapshot
      ON snapshot.id = observation_snapshot_id
     AND snapshot.workspace_id = NEW.workspace_id
     AND snapshot.project_id = NEW.project_id
     AND snapshot.site_id = NEW.site_id
     AND snapshot.provider = observation_provider
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
      AND diagnostic.site_id = NEW.site_id
      AND frozen_snapshot.entry ->> 'snapshotId' = snapshot.id::text
      AND frozen_snapshot.entry ->> 'provider' = snapshot.provider
      AND frozen_snapshot.entry ->> 'datasetKey' = snapshot.dataset_key
      AND frozen_snapshot.entry ->> 'schemaVersion' = snapshot.schema_version
      AND frozen_snapshot.entry ->> 'methodVersion' = snapshot.method_version
      AND frozen_snapshot.entry ->> 'checksum' = snapshot.checksum
      AND frozen_snapshot.entry ->> 'availability' = snapshot.availability
      AND frozen_snapshot.entry -> 'sourceWindow' = snapshot.source_window
      AND (frozen_snapshot.entry ->> 'capturedAt')::timestamptz =
        snapshot.captured_at
  ) THEN
    RAISE EXCEPTION 'Finding target Observation is not frozen in its DiagnosticRun manifest'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN ('SEARCH-CTR-004','SEARCH-DECAY-002')
     AND (
       observation_provider <> 'gsc'
       OR observation_metric_key <> 'gsc.page.v1'
     ) THEN
    RAISE EXCEPTION 'Search Finding target requires a frozen GSC page Observation'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id = 'CRO-LANDING-003'
     AND (
       observation_provider <> 'ga4'
       OR observation_metric_key <> 'ga4.landing.v1'
     ) THEN
    RAISE EXCEPTION 'CRO landing Finding target requires a frozen GA4 landing Observation'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolution_state = 'unresolved' THEN
    IF NEW.basis_kind <> 'unresolved_observation'
       OR NEW.relation <> 'direct_url'
       OR NEW.target_kind <> 'url'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.page_snapshot_id IS NOT NULL
       OR observation_site_page_id IS NOT NULL
       OR NOT (
         (observation_provider = 'gsc' AND observation_metric_key = 'gsc.page.v1')
         OR (
           observation_provider = 'ga4'
           AND observation_metric_key = 'ga4.landing.v1'
         )
       )
       OR NEW.member_ref IS DISTINCT FROM observation_subject_ref
       OR NEW.target_ref IS DISTINCT FROM observation_subject_ref
       OR NEW.limitation IS NULL THEN
      RAISE EXCEPTION 'Unresolved Finding target does not prove an ambiguous analytics Observation'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.resolution_state <> 'resolved'
     OR NEW.basis_kind NOT IN ('crawl_exact_fetch','observation_site_page')
     OR NEW.site_page_id IS NULL
     OR NEW.limitation IS NOT NULL
     OR observation_site_page_id IS DISTINCT FROM NEW.site_page_id THEN
    RAISE EXCEPTION 'Resolved Finding target requires exact Observation SitePage lineage'
      USING ERRCODE = '23514';
  END IF;

  SELECT page.normalized_url, page.template_key
  INTO page_normalized_url, page_template_key
  FROM app.site_pages page
  WHERE page.id = NEW.site_page_id
    AND page.workspace_id = NEW.workspace_id
    AND page.project_id = NEW.project_id
    AND page.site_id = NEW.site_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolved Finding target SitePage does not match its Site scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'direct_url'
     AND NEW.target_ref IS DISTINCT FROM page_normalized_url THEN
    RAISE EXCEPTION 'Direct Finding target does not match the exact SitePage URL'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'affected_by_template'
     AND (
       page_template_key IS NULL
       OR NEW.target_ref IS DISTINCT FROM page_template_key
     ) THEN
    RAISE EXCEPTION 'Template Finding target does not match the SitePage template'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.basis_kind = 'crawl_exact_fetch' THEN
    IF observation_provider <> 'crawl'
       OR observation_metric_key <> 'crawl.page.v1'
       OR NEW.page_snapshot_id IS NULL
       OR NEW.member_ref IS DISTINCT FROM observation_fetch_url
       OR page_normalized_url IS DISTINCT FROM observation_fetch_url
       OR NOT EXISTS (
         SELECT 1
         FROM app.page_snapshots page_snapshot
         WHERE page_snapshot.id = NEW.page_snapshot_id
           AND page_snapshot.workspace_id = NEW.workspace_id
           AND page_snapshot.project_id = NEW.project_id
           AND page_snapshot.site_page_id = NEW.site_page_id
           AND page_snapshot.data_snapshot_id = observation_snapshot_id
       ) THEN
      RAISE EXCEPTION 'Crawl Finding target does not match its exact fetch snapshot'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT (
         (observation_provider = 'gsc' AND observation_metric_key = 'gsc.page.v1')
         OR (
           observation_provider = 'ga4'
           AND observation_metric_key = 'ga4.landing.v1'
         )
       )
       OR NEW.member_ref IS DISTINCT FROM observation_subject_ref THEN
      RAISE EXCEPTION 'Analytics Finding target does not match its immutable Observation subject'
        USING ERRCODE = '23514';
    END IF;

    -- Analytics membership comes from Observation.site_page_id. An optional
    -- PageSnapshot is contextual content only and must be the crawl snapshot
    -- for the same page frozen in this DiagnosticRun.
    IF NEW.page_snapshot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM app.page_snapshots page_snapshot
      JOIN app.data_snapshots snapshot
        ON snapshot.id = page_snapshot.data_snapshot_id
       AND snapshot.workspace_id = NEW.workspace_id
       AND snapshot.project_id = NEW.project_id
       AND snapshot.site_id = NEW.site_id
       AND snapshot.provider = 'crawl'
       AND snapshot.dataset_key = 'crawl.site_graph.v1'
      JOIN app.diagnostic_runs diagnostic
        ON diagnostic.id = NEW.diagnostic_run_id
       AND diagnostic.workspace_id = NEW.workspace_id
       AND diagnostic.project_id = NEW.project_id
       AND diagnostic.site_id = NEW.site_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(diagnostic.input_manifest -> 'snapshots') = 'array'
          THEN diagnostic.input_manifest -> 'snapshots'
          ELSE '[]'::jsonb
        END
      ) AS frozen_snapshot(entry)
      WHERE page_snapshot.id = NEW.page_snapshot_id
        AND page_snapshot.workspace_id = NEW.workspace_id
        AND page_snapshot.project_id = NEW.project_id
        AND page_snapshot.site_page_id = NEW.site_page_id
        AND frozen_snapshot.entry ->> 'snapshotId' = snapshot.id::text
        AND frozen_snapshot.entry ->> 'provider' = snapshot.provider
        AND frozen_snapshot.entry ->> 'datasetKey' = snapshot.dataset_key
        AND frozen_snapshot.entry ->> 'schemaVersion' = snapshot.schema_version
        AND frozen_snapshot.entry ->> 'methodVersion' = snapshot.method_version
        AND frozen_snapshot.entry ->> 'checksum' = snapshot.checksum
        AND frozen_snapshot.entry ->> 'availability' = snapshot.availability
        AND frozen_snapshot.entry -> 'sourceWindow' = snapshot.source_window
        AND (frozen_snapshot.entry ->> 'capturedAt')::timestamptz =
          snapshot.captured_at
    ) THEN
      RAISE EXCEPTION 'Analytics Finding target PageSnapshot is not a frozen crawl page'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.relation IN (
       'affected_by_http_status',
       'affected_by_canonical_issue'
     )
     AND NEW.basis_kind <> 'crawl_exact_fetch' THEN
    RAISE EXCEPTION 'HTTP and canonical Finding targets require exact Crawl membership'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'affected_by_http_status'
     AND NEW.target_ref IS DISTINCT FROM observation_final_status THEN
    RAISE EXCEPTION 'HTTP Finding target does not match the Crawl final status'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finding_targets_lineage_guard
  ON app.finding_targets;
CREATE TRIGGER finding_targets_lineage_guard
  BEFORE INSERT ON app.finding_targets
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_finding_target_lineage();

DROP TRIGGER IF EXISTS finding_targets_append_only
  ON app.finding_targets;
CREATE TRIGGER finding_targets_append_only
  BEFORE UPDATE OR DELETE ON app.finding_targets
  FOR EACH ROW
  EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE INDEX IF NOT EXISTS finding_targets_site_page_read_idx
  ON app.finding_targets(
    project_id,
    diagnostic_run_id,
    site_page_id,
    finding_id
  )
  WHERE resolution_state = 'resolved' AND site_page_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS finding_targets_finding_run_read_idx
  ON app.finding_targets(
    project_id,
    diagnostic_run_id,
    finding_id,
    relation_key,
    id
  );

CREATE INDEX IF NOT EXISTS finding_targets_operational_idx
  ON app.finding_targets(
    project_id,
    diagnostic_run_id,
    resolution_state,
    relation,
    created_at,
    id
  )
  WHERE resolution_state IN ('unresolved','definition_only');

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0017_finding_target_ledger'::text AS migration_version;

COMMIT;
