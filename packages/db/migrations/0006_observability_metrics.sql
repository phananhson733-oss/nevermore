BEGIN;

-- Existing databases receive the same queryable migration identity as fresh
-- installs. This is a view rather than a bookkeeping table so the frozen
-- 28-table product contract remains exact.
CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0006_observability_metrics'::text AS migration_version;

COMMIT;
