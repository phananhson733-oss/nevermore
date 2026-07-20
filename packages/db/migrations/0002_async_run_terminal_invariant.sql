BEGIN;

-- AsyncRun terminal states are irreversible (spec §5.2). Repository attempt
-- fencing is the primary guard; this trigger is the final invariant for direct
-- SQL and any future writer that bypasses the repository CAS.
CREATE OR REPLACE FUNCTION app.reject_async_run_terminal_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'partial', 'failed', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'async run terminal status is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS async_runs_terminal_status_immutable ON app.async_runs;
CREATE TRIGGER async_runs_terminal_status_immutable
  BEFORE UPDATE OF status ON app.async_runs
  FOR EACH ROW EXECUTE FUNCTION app.reject_async_run_terminal_transition();

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0002_async_run_terminal_invariant'::text AS migration_version;

COMMIT;
