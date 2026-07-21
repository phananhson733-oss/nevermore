BEGIN;

-- The current pointer remains the operator's working draft. Downstream audit
-- inputs need a separate pointer that advances only after profile review.
ALTER TABLE app.client_projects
  ADD COLUMN IF NOT EXISTS confirmed_icp_profile_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_projects_confirmed_icp_profile_fk'
      AND conrelid = 'app.client_projects'::regclass
  ) THEN
    ALTER TABLE app.client_projects
      ADD CONSTRAINT client_projects_confirmed_icp_profile_fk
      FOREIGN KEY (confirmed_icp_profile_id)
      REFERENCES app.icp_profiles(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

-- A URL-first project honestly starts without reviewed market or language
-- knowledge. Empty arrays mean unknown; the upper bound still protects rows
-- from unbounded projection payloads.
ALTER TABLE app.sites
  DROP CONSTRAINT IF EXISTS sites_market_codes_check;
ALTER TABLE app.sites
  ADD CONSTRAINT sites_market_codes_check
  CHECK (cardinality(market_codes) BETWEEN 0 AND 20) NOT VALID;

ALTER TABLE app.sites
  DROP CONSTRAINT IF EXISTS sites_language_codes_check;
ALTER TABLE app.sites
  ADD CONSTRAINT sites_language_codes_check
  CHECK (cardinality(language_codes) BETWEEN 0 AND 20) NOT VALID;

ALTER TABLE app.sites
  VALIDATE CONSTRAINT sites_market_codes_check;
ALTER TABLE app.sites
  VALIDATE CONSTRAINT sites_language_codes_check;

-- Pointer provenance is a database invariant, not an application convention.
-- This prevents a faulty scoped write from splicing another project's immutable
-- profile into either the working or confirmed project state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.client_projects project
    LEFT JOIN app.icp_profiles profile
      ON profile.id = project.current_icp_profile_id
     AND profile.workspace_id = project.workspace_id
     AND profile.project_id = project.id
    WHERE project.current_icp_profile_id IS NOT NULL
      AND profile.id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing current ICP profile provenance does not match client project'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM app.client_projects project
    LEFT JOIN app.icp_profiles profile
      ON profile.id = project.confirmed_icp_profile_id
     AND profile.workspace_id = project.workspace_id
     AND profile.project_id = project.id
     AND profile.status = 'complete'
    WHERE project.confirmed_icp_profile_id IS NOT NULL
      AND profile.id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing confirmed ICP profile is not complete project provenance'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Preserve legacy readiness: before the confirmed pointer existed, a complete
-- current profile was the reviewed downstream input. Backfill only verified
-- same-project complete rows; drafts remain unconfirmed.
UPDATE app.client_projects project
SET confirmed_icp_profile_id = profile.id
FROM app.icp_profiles profile
WHERE project.confirmed_icp_profile_id IS NULL
  AND project.current_icp_profile_id = profile.id
  AND profile.workspace_id = project.workspace_id
  AND profile.project_id = project.id
  AND profile.status = 'complete';

CREATE OR REPLACE FUNCTION app.enforce_client_project_icp_profile_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.current_icp_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.icp_profiles profile
    WHERE profile.id = NEW.current_icp_profile_id
      AND profile.workspace_id = NEW.workspace_id
      AND profile.project_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'current ICP profile provenance does not match client project'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.confirmed_icp_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM app.icp_profiles profile
    WHERE profile.id = NEW.confirmed_icp_profile_id
      AND profile.workspace_id = NEW.workspace_id
      AND profile.project_id = NEW.id
      AND profile.status = 'complete'
  ) THEN
    RAISE EXCEPTION 'confirmed ICP profile must be complete and match client project provenance'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_projects_icp_profile_provenance_guard
  ON app.client_projects;
CREATE TRIGGER client_projects_icp_profile_provenance_guard
  BEFORE INSERT OR UPDATE ON app.client_projects
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_client_project_icp_profile_provenance();

-- An Action is attributable to the exact immutable DiagnosticRun that
-- observed its source Finding when the Action was first created. Existing
-- deployments are backfilled only from append-only finding observations that
-- already existed at Action creation time. Mutable Finding projections are
-- deliberately excluded from this derivation.
ALTER TABLE app.actions
  ADD COLUMN IF NOT EXISTS source_diagnostic_run_id uuid;

WITH ranked_action_sources AS (
  SELECT
    action.id AS action_id,
    observation.diagnostic_run_id,
    row_number() OVER (
      PARTITION BY action.id
      ORDER BY
        greatest(observation.created_at, diagnostic_run.created_at) DESC,
        observation.created_at DESC,
        diagnostic_run.created_at DESC,
        observation.id DESC
    ) AS source_rank
  FROM app.actions action
  JOIN app.finding_observations observation
    ON observation.finding_id = action.source_finding_id
   AND observation.workspace_id = action.workspace_id
   AND observation.project_id = action.project_id
  JOIN app.diagnostic_runs diagnostic_run
    ON diagnostic_run.id = observation.diagnostic_run_id
   AND diagnostic_run.workspace_id = action.workspace_id
   AND diagnostic_run.project_id = action.project_id
  JOIN app.evidence source_evidence
    ON source_evidence.id = observation.evidence_id
   AND source_evidence.diagnostic_run_id = observation.diagnostic_run_id
   AND source_evidence.workspace_id = action.workspace_id
   AND source_evidence.project_id = action.project_id
  WHERE action.source_diagnostic_run_id IS NULL
    AND observation.created_at <= action.created_at
    AND diagnostic_run.created_at <= action.created_at
)
UPDATE app.actions action
SET source_diagnostic_run_id = ranked.diagnostic_run_id
FROM ranked_action_sources ranked
WHERE action.id = ranked.action_id
  AND ranked.source_rank = 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.actions action
    WHERE action.source_diagnostic_run_id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing action cannot be traced to an observed diagnostic run'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE app.actions
  ALTER COLUMN source_diagnostic_run_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'actions_source_diagnostic_run_fk'
      AND conrelid = 'app.actions'::regclass
  ) THEN
    ALTER TABLE app.actions
      ADD CONSTRAINT actions_source_diagnostic_run_fk
      FOREIGN KEY (source_diagnostic_run_id)
      REFERENCES app.diagnostic_runs(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.enforce_action_source_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.source_finding_id IS DISTINCT FROM OLD.source_finding_id
    OR NEW.source_diagnostic_run_id IS DISTINCT FROM OLD.source_diagnostic_run_id
  ) THEN
    RAISE EXCEPTION 'action source lineage is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.findings finding
    WHERE finding.id = NEW.source_finding_id
      AND finding.workspace_id = NEW.workspace_id
      AND finding.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'action source finding scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic_run
    WHERE diagnostic_run.id = NEW.source_diagnostic_run_id
      AND diagnostic_run.workspace_id = NEW.workspace_id
      AND diagnostic_run.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'action source diagnostic run scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.finding_observations observation
    JOIN app.evidence source_evidence
      ON source_evidence.id = observation.evidence_id
     AND source_evidence.diagnostic_run_id = observation.diagnostic_run_id
     AND source_evidence.workspace_id = observation.workspace_id
     AND source_evidence.project_id = observation.project_id
    WHERE observation.finding_id = NEW.source_finding_id
      AND observation.diagnostic_run_id = NEW.source_diagnostic_run_id
      AND observation.workspace_id = NEW.workspace_id
      AND observation.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'action source diagnostic run did not observe the finding'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1
    FROM app.findings finding
    WHERE finding.id = NEW.source_finding_id
      AND finding.workspace_id = NEW.workspace_id
      AND finding.project_id = NEW.project_id
      AND finding.last_seen_run_id = NEW.source_diagnostic_run_id
  ) THEN
    RAISE EXCEPTION 'action source diagnostic run is not the finding current run'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS actions_source_lineage_guard ON app.actions;
CREATE TRIGGER actions_source_lineage_guard
  BEFORE INSERT OR UPDATE ON app.actions
  FOR EACH ROW
  EXECUTE FUNCTION app.enforce_action_source_lineage();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0011_product_profile_foundation'::text AS migration_version;

COMMIT;
