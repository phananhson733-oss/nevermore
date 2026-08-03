BEGIN;

-- Product creation can optionally hand off to a dedicated GSC / GA4 setup
-- screen before the Product Profile is confirmed. Keep the OAuth return target
-- constrained to the two exact first-party project pages; arbitrary paths,
-- nested suffixes and query strings remain invalid at the database boundary.
ALTER TABLE app.oauth_intents
  DROP CONSTRAINT oauth_intents_redirect_path_check;

ALTER TABLE app.oauth_intents
  ADD CONSTRAINT oauth_intents_redirect_path_check CHECK (
    redirect_path ~ '^/p/[0-9a-f-]+/(sources|setup-sources)$'
  );

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0038_optional_source_onboarding'::text AS migration_version;

COMMIT;
