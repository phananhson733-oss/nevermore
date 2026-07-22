BEGIN;

-- mvp.rules.0.2.1 keeps the same eleven deterministic rule identities but
-- upgrades the three technical rules that consume exact slash/non-slash page
-- variants. Historical 0.2.0 DiagnosticRuns remain immutable and readable.
ALTER TABLE app.diagnostic_runs
  DROP CONSTRAINT IF EXISTS diagnostic_runs_rule_set_version_check;

ALTER TABLE app.diagnostic_runs
  ADD CONSTRAINT diagnostic_runs_rule_set_version_check
  CHECK (rule_set_version IN ('mvp.rules.0.2.0', 'mvp.rules.0.2.1'));

-- Current diagnostics freeze a complete, self-consistent manifest. Historical
-- 0.2.0 rows stay readable, but no new 0.2.1 row may reference a foreign Site,
-- stale crawl method, or self-reported snapshot metadata.
CREATE OR REPLACE FUNCTION app.enforce_current_diagnostic_manifest()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_count integer;
  matched_snapshot_count integer;
  distinct_snapshot_count integer;
  distinct_provider_count integer;
BEGIN
  IF NEW.rule_set_version <> 'mvp.rules.0.2.1' THEN
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

DROP TRIGGER IF EXISTS diagnostic_runs_current_manifest_guard ON app.diagnostic_runs;
CREATE TRIGGER diagnostic_runs_current_manifest_guard
  BEFORE INSERT ON app.diagnostic_runs
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_current_diagnostic_manifest();

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
    WHEN selected_rule_set = 'mvp.rules.0.2.1'
      AND selected_rule_id IN (
        'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005'
      ) THEN 2
    WHEN selected_rule_set IN ('mvp.rules.0.2.0','mvp.rules.0.2.1') THEN 1
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION app.enforce_diagnostic_rule_version_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_version integer;
BEGIN
  SELECT app.expected_diagnostic_rule_version(run.rule_set_version, NEW.rule_id)
  INTO expected_version
  FROM app.diagnostic_runs run
  WHERE run.id = NEW.diagnostic_run_id;

  IF expected_version IS NULL OR NEW.rule_version <> expected_version THEN
    RAISE EXCEPTION 'diagnostic rule version does not match its frozen rule set'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS diagnostic_run_rules_version_guard ON app.diagnostic_run_rules;
CREATE TRIGGER diagnostic_run_rules_version_guard
  BEFORE INSERT ON app.diagnostic_run_rules
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_diagnostic_rule_version_lineage();

CREATE OR REPLACE FUNCTION app.enforce_finding_rule_version_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_version integer;
BEGIN
  SELECT app.expected_diagnostic_rule_version(run.rule_set_version, NEW.rule_id)
  INTO expected_version
  FROM app.diagnostic_runs run
  WHERE run.id = NEW.last_seen_run_id
    AND run.workspace_id = NEW.workspace_id
    AND run.project_id = NEW.project_id;

  IF expected_version IS NULL OR NEW.rule_version <> expected_version THEN
    RAISE EXCEPTION 'finding rule version does not match its last-seen diagnostic run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS findings_rule_version_guard ON app.findings;
CREATE TRIGGER findings_rule_version_guard
  BEFORE INSERT OR UPDATE OF rule_id, rule_version, last_seen_run_id
  ON app.findings
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_finding_rule_version_lineage();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0013_exact_url_variant_rules'::text AS migration_version;

COMMIT;
