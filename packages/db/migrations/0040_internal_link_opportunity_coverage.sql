BEGIN;

-- TECH-LINKGRAPH-005@3 expands the deterministic frozen-crawl projection to
-- low-inbound pages, deep traversal, and unresolved internal targets. Keep both
-- governed 0.2.2 and pre-governance 0.2.1 histories exactly replayable.
ALTER TABLE app.diagnostic_runs
  DROP CONSTRAINT IF EXISTS diagnostic_runs_rule_set_version_check;

ALTER TABLE app.diagnostic_runs
  ADD CONSTRAINT diagnostic_runs_rule_set_version_check
  CHECK (
    rule_set_version IN (
      'mvp.rules.0.2.0',
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2',
      'mvp.rules.0.2.3'
    )
  );

CREATE OR REPLACE FUNCTION app.enforce_current_diagnostic_manifest()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_count integer;
  matched_snapshot_count integer;
  distinct_snapshot_count integer;
  distinct_provider_count integer;
  governance jsonb;
BEGIN
  IF NEW.rule_set_version NOT IN (
    'mvp.rules.0.2.1',
    'mvp.rules.0.2.2',
    'mvp.rules.0.2.3'
  ) THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.input_manifest -> 'snapshots') <> 'array'
     OR jsonb_typeof(NEW.input_manifest -> 'icp') <> 'object'
     OR NEW.input_manifest ->> 'projectId' <> NEW.project_id::text
     OR NEW.input_manifest ->> 'siteId' <> NEW.site_id::text
     OR NEW.input_manifest ->> 'ruleSetVersion' <> NEW.rule_set_version
     OR NEW.input_manifest ->> 'promptSetVersion' <> NEW.prompt_set_version
     OR NEW.input_manifest ->> 'deliveryLocale' <> NEW.output_locale
     OR NEW.input_manifest #>> '{icp,id}' <> NEW.icp_profile_id::text
     OR (NEW.input_manifest #>> '{icp,version}')::integer <> NEW.icp_profile_version
     OR NOT EXISTS (
       SELECT 1
       FROM app.icp_profiles icp
       WHERE icp.id = NEW.icp_profile_id
         AND icp.workspace_id = NEW.workspace_id
         AND icp.project_id = NEW.project_id
         AND icp.version = NEW.icp_profile_version
         AND icp.status = 'complete'
         AND icp.content_hash = NEW.input_manifest #>> '{icp,contentHash}'
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest does not match its frozen run and ICP'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.rule_set_version IN ('mvp.rules.0.2.2', 'mvp.rules.0.2.3') THEN
    governance := NEW.input_manifest -> 'governance';
    IF jsonb_typeof(governance) IS DISTINCT FROM 'object'
       OR governance ->> 'projectionVersion'
         IS DISTINCT FROM 'growth-governance.1.0.0'
       OR jsonb_typeof(governance -> 'keywordClusters')
         IS DISTINCT FROM 'array'
       OR jsonb_typeof(governance -> 'competitors')
         IS DISTINCT FROM 'array'
       OR (
         governance
           - ARRAY['projectionVersion', 'keywordClusters', 'competitors']
       ) IS DISTINCT FROM '{}'::jsonb THEN
      RAISE EXCEPTION 'current diagnostic manifest governance projection is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  snapshot_count := jsonb_array_length(NEW.input_manifest -> 'snapshots');
  SELECT
    count(*),
    count(DISTINCT entry ->> 'snapshotId'),
    count(DISTINCT entry ->> 'provider')
  INTO matched_snapshot_count, distinct_snapshot_count, distinct_provider_count
  FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
  JOIN app.data_snapshots snapshot
    ON snapshot.id = (entry ->> 'snapshotId')::uuid
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
   AND snapshot.site_id = NEW.site_id
   AND snapshot.provider = entry ->> 'provider'
   AND snapshot.dataset_key = entry ->> 'datasetKey'
   AND snapshot.schema_version = entry ->> 'schemaVersion'
   AND snapshot.method_version = entry ->> 'methodVersion'
   AND snapshot.checksum = entry ->> 'checksum'
   AND snapshot.availability = entry ->> 'availability'
   AND snapshot.source_window = entry -> 'sourceWindow'
   AND snapshot.captured_at = (entry ->> 'capturedAt')::timestamptz;

  IF snapshot_count = 0
     OR matched_snapshot_count <> snapshot_count
     OR distinct_snapshot_count <> snapshot_count
     OR distinct_provider_count <> snapshot_count
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
       WHERE entry ->> 'provider' = 'crawl'
         AND entry ->> 'methodVersion' = 'crawl.site_graph.v2'
         AND entry ->> 'availability' IN ('available','partial')
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest snapshot selection is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.expected_diagnostic_rule_version(
  selected_rule_set text,
  selected_rule_id text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN selected_rule_id NOT IN (
      'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005',
      'SEARCH-CTR-004','SEARCH-DECAY-002','CONTENT-COVERAGE-001',
      'CONTENT-GAP-011','CRO-PATH-001','CRO-LANDING-003',
      'GEO-ENTITY-001','GEO-CRAWLER-002'
    ) THEN NULL
    WHEN selected_rule_set = 'mvp.rules.0.2.3'
      AND selected_rule_id = 'TECH-LINKGRAPH-005' THEN 3
    WHEN selected_rule_set IN ('mvp.rules.0.2.2', 'mvp.rules.0.2.3')
      AND selected_rule_id = 'CONTENT-GAP-011' THEN 2
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2',
      'mvp.rules.0.2.3'
    )
      AND selected_rule_id IN ('TECH-HTTP-001','TECH-CANONICAL-002') THEN 2
    WHEN selected_rule_set IN ('mvp.rules.0.2.1', 'mvp.rules.0.2.2')
      AND selected_rule_id = 'TECH-LINKGRAPH-005' THEN 2
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.0',
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2',
      'mvp.rules.0.2.3'
    ) THEN 1
    ELSE NULL
  END
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0040_internal_link_opportunity_coverage'::text AS migration_version;

COMMIT;
