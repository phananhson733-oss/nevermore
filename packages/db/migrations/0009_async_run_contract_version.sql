BEGIN;

-- The product release version and the asynchronous-run HTTP contract version
-- are independent. Keep database-generated rows aligned with the current
-- contract even when a caller omits the column explicitly.
ALTER TABLE app.async_runs
  ALTER COLUMN contract_version SET DEFAULT '2026-07-18';

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0009_async_run_contract_version'::text AS migration_version;

COMMIT;
