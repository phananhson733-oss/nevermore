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
-- created from here on default to 'free'. The column default is deliberately
-- 'free' — an unlabelled INSERT from any future code path should land in the
-- bounded tier, not the unbounded one.
ALTER TABLE app.workspaces
  ADD COLUMN plan_tier text NOT NULL DEFAULT 'free';

UPDATE app.workspaces SET plan_tier = 'internal';

ALTER TABLE app.workspaces
  ADD CONSTRAINT workspaces_plan_tier_check
  CHECK (plan_tier IN ('free', 'internal'));

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0044_workspace_plan_tier'::text AS migration_version;

COMMIT;
