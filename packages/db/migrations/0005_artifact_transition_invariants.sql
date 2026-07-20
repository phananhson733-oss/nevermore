BEGIN;

-- Upgrade databases that already installed the original status-only guard.
-- Content-producing edges advance exactly one revision, status-only edges keep
-- the pointer fixed, and regeneration is always owned by a fresh AsyncRun.
CREATE OR REPLACE FUNCTION app.enforce_artifact_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'draft'
     AND NEW.current_revision = OLD.current_revision + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready' AND NEW.status = 'draft'
     AND NEW.current_revision = OLD.current_revision + 1 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'failed'
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status IN ('ready', 'archived')
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'ready' AND NEW.status = 'archived'
     AND NEW.current_revision = OLD.current_revision THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('draft', 'ready', 'failed') AND NEW.status = 'generating'
     AND NEW.current_revision = OLD.current_revision
     AND NEW.latest_generation_run_id IS NOT NULL
     AND NEW.latest_generation_run_id IS DISTINCT FROM OLD.latest_generation_run_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'artifact status transition is not allowed'
    USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS execution_artifacts_status_transition_guard
  ON app.execution_artifacts;
CREATE TRIGGER execution_artifacts_status_transition_guard
  BEFORE UPDATE OF status ON app.execution_artifacts
  FOR EACH ROW EXECUTE FUNCTION app.enforce_artifact_status_transition();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0005_artifact_transition_invariants'::text AS migration_version;

COMMIT;
