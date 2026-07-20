BEGIN;

-- Bind each ExportBundle to the exact export AsyncRun/project named by its
-- object key. Only one placeholder -> finalized transition is legal; after the
-- key is committed, all bundle identity and object metadata are immutable.
CREATE OR REPLACE FUNCTION app.enforce_export_bundle_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_matches boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.async_run_id IS DISTINCT FROM OLD.async_run_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
       OR NEW.output_locale IS DISTINCT FROM OLD.output_locale
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'export bundle identity is immutable'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.object_key IS NOT NULL OR NEW.object_key IS NULL THEN
      RAISE EXCEPTION 'export bundle may be finalized exactly once'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM app.async_runs AS run
    WHERE run.id = NEW.async_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'export'
  ) INTO run_matches;

  IF NOT run_matches THEN
    RAISE EXCEPTION 'export bundle run scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.export_bundles'::regclass
      AND conname = 'export_bundles_object_key_invariant'
  ) THEN
    ALTER TABLE app.export_bundles
      ADD CONSTRAINT export_bundles_object_key_invariant CHECK (
        (
          object_key IS NULL
          AND checksum IS NULL
          AND byte_size IS NULL
          AND manifest IS NULL
        )
        OR
        (
          object_key IS NOT NULL
          AND checksum IS NOT NULL
          AND byte_size IS NOT NULL
          AND manifest IS NOT NULL
          AND octet_length(object_key) <= 1024
          AND cardinality(string_to_array(object_key, '/')) = 4
          AND object_key =
            'export/' || project_id::text || '/' || async_run_id::text || '/' ||
            split_part(object_key, '/', 4)
          AND split_part(object_key, '/', 4) ~ '^[A-Za-z0-9._-]+$'
          AND split_part(object_key, '/', 4) NOT IN ('.', '..')
        )
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE app.export_bundles
  VALIDATE CONSTRAINT export_bundles_object_key_invariant;

-- Validate the cross-table identity for pre-existing rows before installing
-- the prospective trigger. A mismatch aborts the migration rather than making
-- corrupted bundles downloadable under a new release.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM app.export_bundles AS bundle
    LEFT JOIN app.async_runs AS run
      ON run.id = bundle.async_run_id
     AND run.workspace_id = bundle.workspace_id
     AND run.project_id = bundle.project_id
     AND run.kind = 'export'
    WHERE run.id IS NULL
  ) THEN
    RAISE EXCEPTION 'existing export bundle run scope is invalid'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS export_bundles_invariant_guard
  ON app.export_bundles;
CREATE TRIGGER export_bundles_invariant_guard
  BEFORE INSERT OR UPDATE ON app.export_bundles
  FOR EACH ROW EXECUTE FUNCTION app.enforce_export_bundle_invariants();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0007_export_bundle_invariants'::text AS migration_version;

COMMIT;
