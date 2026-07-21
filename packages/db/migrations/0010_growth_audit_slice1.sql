BEGIN;

-- A capability run is a typed extension of the canonical async run ledger. Its
-- primary key is deliberately the async run id: there is no second lifecycle or
-- mutable status for a capability execution.
CREATE TABLE IF NOT EXISTS app.capability_runs (
  async_run_id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  capability_id text NOT NULL CHECK (length(btrim(capability_id)) >= 1),
  capability_version text NOT NULL CHECK (length(btrim(capability_version)) >= 1),
  input_manifest_hash text NOT NULL CHECK (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  mode text NOT NULL CHECK (mode IN ('production','shadow','simulation')),
  side_effect_class text NOT NULL
    CHECK (side_effect_class IN ('read_only','internal_write','external_write')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Customer-facing audit state is a projection over the existing canonical
-- diagnostic and capability runs. It intentionally has no status column.
CREATE TABLE IF NOT EXISTS app.audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  diagnostic_run_id uuid NOT NULL UNIQUE
    REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT,
  capability_run_id uuid NOT NULL UNIQUE
    REFERENCES app.capability_runs(async_run_id) ON DELETE RESTRICT,
  scope_kind text NOT NULL CHECK (scope_kind IN ('site','template','url')),
  scope_key text NOT NULL CHECK (length(btrim(scope_key)) >= 1),
  projection_version text NOT NULL CHECK (length(btrim(projection_version)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (diagnostic_run_id = capability_run_id)
);

CREATE INDEX IF NOT EXISTS audit_runs_project_created_idx
  ON app.audit_runs(project_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS app.audit_module_results (
  audit_run_id uuid NOT NULL REFERENCES app.audit_runs(id) ON DELETE RESTRICT,
  module_id text NOT NULL CHECK (module_id IN (
    'performance',
    'accessibility',
    'best_practices_security',
    'technical_search',
    'content_intent',
    'ai_geo',
    'links_architecture',
    'compliance_measurement'
  )),
  coverage_state text NOT NULL
    CHECK (coverage_state IN ('available','partial','stale','no_data')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (audit_run_id, module_id)
);

-- One durable URL identity per project. Metrics and extracted content do not
-- live here; they remain attributable to immutable page/data snapshots.
CREATE TABLE IF NOT EXISTS app.site_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_id uuid NOT NULL REFERENCES app.sites(id) ON DELETE RESTRICT,
  normalized_url text NOT NULL CHECK (length(btrim(normalized_url)) >= 1),
  normalized_url_hash text NOT NULL CHECK (normalized_url_hash ~ '^[a-f0-9]{64}$'),
  template_key text CHECK (template_key IS NULL OR length(btrim(template_key)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, normalized_url_hash)
);

CREATE INDEX IF NOT EXISTS site_pages_project_updated_idx
  ON app.site_pages(project_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS site_pages_site_idx
  ON app.site_pages(site_id, id);

-- A page snapshot is only a traceable projection of one canonical source
-- snapshot. The extract is immutable; recrawls append a new row.
CREATE TABLE IF NOT EXISTS app.page_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  site_page_id uuid NOT NULL REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  data_snapshot_id uuid NOT NULL REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  extract jsonb NOT NULL CHECK (jsonb_typeof(extract) = 'object'),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_page_id, data_snapshot_id, content_hash)
);

CREATE INDEX IF NOT EXISTS page_snapshots_page_captured_idx
  ON app.page_snapshots(site_page_id, captured_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS page_snapshots_project_captured_idx
  ON app.page_snapshots(project_id, captured_at DESC, id DESC);

-- Duplicated tenant keys are read-model accelerators, never free-form labels.
-- Validate every new projection against its canonical parent lineage so a
-- faulty worker cannot splice records from different projects.
CREATE OR REPLACE FUNCTION app.enforce_audit_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.diagnostic_run_id IS DISTINCT FROM NEW.capability_run_id OR NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic
    JOIN app.async_runs run ON run.id = diagnostic.id
    JOIN app.capability_runs capability
      ON capability.async_run_id = diagnostic.id
    WHERE diagnostic.id = NEW.diagnostic_run_id
      AND diagnostic.workspace_id = NEW.workspace_id
      AND diagnostic.project_id = NEW.project_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'audit run provenance does not match its canonical run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_site_page_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION app.enforce_page_snapshot_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.site_pages page
    JOIN app.data_snapshots snapshot
      ON snapshot.id = NEW.data_snapshot_id
     AND snapshot.site_id = page.site_id
    WHERE page.id = NEW.site_page_id
      AND page.workspace_id = NEW.workspace_id
      AND page.project_id = NEW.project_id
      AND snapshot.workspace_id = NEW.workspace_id
      AND snapshot.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'page snapshot provenance does not match its canonical sources'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_runs_provenance_guard ON app.audit_runs;
CREATE TRIGGER audit_runs_provenance_guard BEFORE INSERT ON app.audit_runs
  FOR EACH ROW EXECUTE FUNCTION app.enforce_audit_run_provenance();

DROP TRIGGER IF EXISTS site_pages_provenance_guard ON app.site_pages;
CREATE TRIGGER site_pages_provenance_guard BEFORE INSERT OR UPDATE ON app.site_pages
  FOR EACH ROW EXECUTE FUNCTION app.enforce_site_page_provenance();

DROP TRIGGER IF EXISTS page_snapshots_provenance_guard ON app.page_snapshots;
CREATE TRIGGER page_snapshots_provenance_guard BEFORE INSERT ON app.page_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.enforce_page_snapshot_provenance();

DROP TRIGGER IF EXISTS site_pages_set_updated_at ON app.site_pages;
CREATE TRIGGER site_pages_set_updated_at BEFORE UPDATE ON app.site_pages
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

DROP TRIGGER IF EXISTS capability_runs_append_only ON app.capability_runs;
CREATE TRIGGER capability_runs_append_only BEFORE UPDATE OR DELETE ON app.capability_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS audit_runs_append_only ON app.audit_runs;
CREATE TRIGGER audit_runs_append_only BEFORE UPDATE OR DELETE ON app.audit_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS audit_module_results_append_only ON app.audit_module_results;
CREATE TRIGGER audit_module_results_append_only BEFORE UPDATE OR DELETE ON app.audit_module_results
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

DROP TRIGGER IF EXISTS page_snapshots_append_only ON app.page_snapshots;
CREATE TRIGGER page_snapshots_append_only BEFORE UPDATE OR DELETE ON app.page_snapshots
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

-- Keep the existing server-only table access model. The application enforces
-- tenant scope in repositories; browser roles never receive direct table access.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.capability_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.audit_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.audit_module_results FROM anon';
    EXECUTE 'REVOKE ALL ON app.site_pages FROM anon';
    EXECUTE 'REVOKE ALL ON app.page_snapshots FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.capability_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.audit_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.audit_module_results FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.site_pages FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.page_snapshots FROM authenticated';
  END IF;
END;
$$;

-- Activate the current HTTP/export defaults without invalidating immutable
-- historical v0.2 export rows during an in-place upgrade.
ALTER TABLE app.async_runs
  ALTER COLUMN contract_version SET DEFAULT '2026-07-21';

ALTER TABLE app.export_bundles
  DROP CONSTRAINT IF EXISTS export_bundles_schema_version_check,
  ALTER COLUMN schema_version SET DEFAULT 'signalframe.service-bundle.0.3.0';

ALTER TABLE app.export_bundles
  ADD CONSTRAINT export_bundles_schema_version_check
  CHECK (schema_version IN (
    'signalframe.service-bundle.0.2.0',
    'signalframe.service-bundle.0.3.0'
  ));

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0010_growth_audit_slice1'::text AS migration_version;

COMMIT;
