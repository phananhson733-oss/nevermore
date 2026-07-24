BEGIN;

-- The Content Shadow draft is minted through the pinned markdown LLM envelope,
-- so it records an AnalysisInvocation like every other model call. `task` is a
-- closed vocabulary enforced in the database, so admitting the shadow pipeline's
-- own task value is DDL, not only a TypeScript union. Every historical task is
-- preserved; this widens the CHECK and never narrows it.
ALTER TABLE app.analysis_invocations
  DROP CONSTRAINT IF EXISTS analysis_invocations_task_check;
ALTER TABLE app.analysis_invocations
  ADD CONSTRAINT analysis_invocations_task_check
  CHECK (task IN (
    'finding_summary',
    'artifact_generation',
    'product_profile_synthesis',
    'content_shadow_draft'
  ));

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0021_content_shadow_invocation_task'::text AS migration_version;

COMMIT;
