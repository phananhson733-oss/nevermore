BEGIN;

-- Self-serve signup (spec §1.6) admits accounts nobody vetted, so a workspace
-- now carries the tier that bounds what it may consume. Adding a NOT NULL
-- column WITH a constant default is a metadata-only change in PostgreSQL 11+:
-- no table rewrite, so the ACCESS EXCLUSIVE lock is held for an instant. The
-- timeout fails closed rather than queueing behind another schema operation
-- and blocking reads for the duration.
SET LOCAL lock_timeout = '5s';

-- Existing workspaces predate self-serve signup: they were provisioned by hand
-- for operators we know, so they are 'internal' and unbounded. Only accounts
-- created from here on default to 'free' — an unlabelled INSERT from any future
-- code path must land in the BOUNDED tier, not the unbounded one.
--
-- Both facts are established without touching a single row: the ADD COLUMN's
-- default backfills existing rows to 'internal' as metadata only (PG 11+), then
-- the default is swapped to 'free' for everything inserted afterwards.
--
-- The obvious spelling — ADD COLUMN DEFAULT 'free' followed by
-- `UPDATE app.workspaces SET plan_tier = 'internal'` — is wrong three times
-- over, and every one of them only bites in production:
--   1. Replay. A bare UPDATE has no WHERE, so running this file a second time
--      (psql -f, or executing the concatenated authority/schema.sql) promotes
--      every self-serve customer to the unbounded tier — deleting the exact
--      limit this migration exists to install. Only the forward-only runner
--      stands between that and a live database.
--   2. Lock hold. `lock_timeout` bounds lock ACQUISITION, never hold time. A
--      full-table UPDATE holds ACCESS EXCLUSIVE until COMMIT, and 70 tables
--      carry `REFERENCES app.workspaces`, so FK checks across the whole product
--      would stall behind it — not just writes to this table.
--   3. Provenance. The UPDATE fires workspaces_set_updated_at and overwrites
--      every workspace's updated_at with the migration's clock, irreversibly.
ALTER TABLE app.workspaces
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'internal';

ALTER TABLE app.workspaces
  ALTER COLUMN plan_tier SET DEFAULT 'free';

ALTER TABLE app.workspaces
  DROP CONSTRAINT IF EXISTS workspaces_plan_tier_check;

ALTER TABLE app.workspaces
  ADD CONSTRAINT workspaces_plan_tier_check
  CHECK (plan_tier IN ('free', 'internal'));

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0044_workspace_plan_tier'::text AS migration_version;

COMMIT;
