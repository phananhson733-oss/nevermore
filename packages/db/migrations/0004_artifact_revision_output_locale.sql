BEGIN;

-- Revision locale is immutable provenance. Existing deployments previously
-- stored it only on the mutable artifact head, so backfill the best available
-- value before making the revision-level field mandatory.
ALTER TABLE app.artifact_revisions
  ADD COLUMN IF NOT EXISTS output_locale text;

-- The append-only guard must be removed only for this transactional backfill;
-- the DDL lock and transaction keep application writers from observing a gap.
DROP TRIGGER IF EXISTS artifact_revisions_append_only
  ON app.artifact_revisions;

UPDATE app.artifact_revisions AS revision
SET output_locale = artifact.output_locale
FROM app.execution_artifacts AS artifact
WHERE revision.artifact_id = artifact.id
  AND revision.output_locale IS NULL;

ALTER TABLE app.artifact_revisions
  ALTER COLUMN output_locale SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'app.artifact_revisions'::regclass
      AND conname = 'artifact_revisions_output_locale_check'
  ) THEN
    ALTER TABLE app.artifact_revisions
      ADD CONSTRAINT artifact_revisions_output_locale_check
      CHECK (output_locale ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
  END IF;
END;
$$;

CREATE TRIGGER artifact_revisions_append_only
  BEFORE UPDATE OR DELETE ON app.artifact_revisions
  FOR EACH ROW EXECUTE FUNCTION app.reject_append_only_mutation();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0004_artifact_revision_output_locale'::text AS migration_version;

COMMIT;
