BEGIN;

-- 0042 installs the widened rule-set check with NOT VALID so its
-- ACCESS EXCLUSIVE lock is held only for a short metadata transaction. This
-- separate migration scans historical rows under SHARE UPDATE EXCLUSIVE,
-- which permits ordinary SELECT/INSERT/UPDATE/DELETE traffic to continue.
-- The timeout fails closed if another schema operation already owns a
-- conflicting lock; the forward-only runner can safely retry this file.
SET LOCAL lock_timeout = '5s';

ALTER TABLE app.diagnostic_runs
  VALIDATE CONSTRAINT diagnostic_runs_rule_set_version_check;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0043_validate_contextual_diagnostic_rule_set'::text AS migration_version;

COMMIT;
