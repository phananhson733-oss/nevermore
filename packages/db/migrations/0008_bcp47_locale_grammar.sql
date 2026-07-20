BEGIN;

-- RFC 5646 language-tag validation shared by every canonical locale column.
-- This deliberately validates the structural grammar without a live IANA
-- registry dependency: registry availability must never become a write-path
-- dependency, while grandfathered tags remain valid permanently.
CREATE OR REPLACE FUNCTION app.is_bcp47_language_tag(candidate text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  parts text[];
  part_count integer;
  part_index integer := 1;
  extlang_count integer := 0;
  first_child_index integer;
  normalized text;
  seen_variants text[] := ARRAY[]::text[];
  seen_singletons text[] := ARRAY[]::text[];
BEGIN
  IF candidate IS NULL
     OR char_length(candidate) NOT BETWEEN 2 AND 255
     OR candidate !~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$' THEN
    RETURN false;
  END IF;

  normalized := lower(candidate);
  IF normalized = ANY (ARRAY[
    'art-lojban', 'cel-gaulish', 'en-gb-oed', 'i-ami', 'i-bnn',
    'i-default', 'i-enochian', 'i-hak', 'i-klingon', 'i-lux',
    'i-mingo', 'i-navajo', 'i-pwn', 'i-tao', 'i-tay', 'i-tsu',
    'no-bok', 'no-nyn', 'sgn-be-fr', 'sgn-be-nl', 'sgn-ch-de',
    'zh-guoyu', 'zh-hakka', 'zh-min', 'zh-min-nan', 'zh-xiang'
  ]::text[]) THEN
    RETURN true;
  END IF;

  parts := string_to_array(candidate, '-');
  part_count := cardinality(parts);

  -- A private-use-only tag starts with x and requires at least one 1-8
  -- character alphanumeric subtag.
  IF lower(parts[1]) = 'x' THEN
    IF part_count < 2 THEN
      RETURN false;
    END IF;
    FOR part_index IN 2..part_count LOOP
      IF char_length(parts[part_index]) NOT BETWEEN 1 AND 8
         OR parts[part_index] !~ '^[A-Za-z0-9]+$' THEN
        RETURN false;
      END IF;
    END LOOP;
    RETURN true;
  END IF;

  -- language = 2*3ALPHA [extlang] / 4ALPHA / 5*8ALPHA
  IF char_length(parts[1]) NOT BETWEEN 2 AND 8
     OR parts[1] !~ '^[A-Za-z]+$' THEN
    RETURN false;
  END IF;
  part_index := 2;

  IF char_length(parts[1]) <= 3 THEN
    WHILE part_index <= part_count
      AND extlang_count < 3
      AND char_length(parts[part_index]) = 3
      AND parts[part_index] ~ '^[A-Za-z]+$'
    LOOP
      part_index := part_index + 1;
      extlang_count := extlang_count + 1;
    END LOOP;
  END IF;

  -- Optional script and region, in that order.
  IF part_index <= part_count
     AND char_length(parts[part_index]) = 4
     AND parts[part_index] ~ '^[A-Za-z]+$' THEN
    part_index := part_index + 1;
  END IF;
  IF part_index <= part_count
     AND (
       parts[part_index] ~ '^[A-Za-z]{2}$'
       OR parts[part_index] ~ '^[0-9]{3}$'
     ) THEN
    part_index := part_index + 1;
  END IF;

  -- Variants precede extensions and cannot repeat case-insensitively.
  WHILE part_index <= part_count
    AND parts[part_index] ~ '^([A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3})$'
  LOOP
    normalized := lower(parts[part_index]);
    IF normalized = ANY (seen_variants) THEN
      RETURN false;
    END IF;
    seen_variants := array_append(seen_variants, normalized);
    part_index := part_index + 1;
  END LOOP;

  -- Each non-x singleton introduces one or more 2-8 character extension
  -- subtags, and the singleton cannot repeat case-insensitively.
  WHILE part_index <= part_count
    AND parts[part_index] ~ '^[0-9A-WY-Za-wy-z]$'
  LOOP
    normalized := lower(parts[part_index]);
    IF normalized = ANY (seen_singletons) THEN
      RETURN false;
    END IF;
    seen_singletons := array_append(seen_singletons, normalized);
    part_index := part_index + 1;
    first_child_index := part_index;

    WHILE part_index <= part_count
      AND char_length(parts[part_index]) BETWEEN 2 AND 8
      AND parts[part_index] ~ '^[A-Za-z0-9]+$'
    LOOP
      part_index := part_index + 1;
    END LOOP;
    IF part_index = first_child_index THEN
      RETURN false;
    END IF;
  END LOOP;

  -- Optional trailing private-use sequence.
  IF part_index <= part_count AND lower(parts[part_index]) = 'x' THEN
    part_index := part_index + 1;
    first_child_index := part_index;
    WHILE part_index <= part_count
      AND char_length(parts[part_index]) BETWEEN 1 AND 8
      AND parts[part_index] ~ '^[A-Za-z0-9]+$'
    LOOP
      part_index := part_index + 1;
    END LOOP;
    IF part_index = first_child_index THEN
      RETURN false;
    END IF;
  END IF;

  RETURN part_index > part_count;
END;
$$;

CREATE OR REPLACE FUNCTION app.are_bcp47_language_tags(candidates text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  candidate text;
BEGIN
  IF candidates IS NULL THEN
    RETURN false;
  END IF;
  FOREACH candidate IN ARRAY candidates LOOP
    IF NOT app.is_bcp47_language_tag(candidate) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

ALTER TABLE app.client_projects
  DROP CONSTRAINT IF EXISTS client_projects_default_delivery_locale_check;
ALTER TABLE app.client_projects
  ADD CONSTRAINT client_projects_default_delivery_locale_check
  CHECK (app.is_bcp47_language_tag(default_delivery_locale)) NOT VALID;

ALTER TABLE app.sites
  DROP CONSTRAINT IF EXISTS sites_language_codes_bcp47_check;
ALTER TABLE app.sites
  ADD CONSTRAINT sites_language_codes_bcp47_check
  CHECK (app.are_bcp47_language_tags(language_codes)) NOT VALID;

ALTER TABLE app.diagnostic_runs
  DROP CONSTRAINT IF EXISTS diagnostic_runs_output_locale_check;
ALTER TABLE app.diagnostic_runs
  ADD CONSTRAINT diagnostic_runs_output_locale_check
  CHECK (app.is_bcp47_language_tag(output_locale)) NOT VALID;

ALTER TABLE app.findings
  DROP CONSTRAINT IF EXISTS findings_summary_locale_check;
ALTER TABLE app.findings
  ADD CONSTRAINT findings_summary_locale_check
  CHECK (app.is_bcp47_language_tag(summary_locale)) NOT VALID;

ALTER TABLE app.actions
  DROP CONSTRAINT IF EXISTS actions_content_locale_check;
ALTER TABLE app.actions
  ADD CONSTRAINT actions_content_locale_check
  CHECK (app.is_bcp47_language_tag(content_locale)) NOT VALID;

ALTER TABLE app.execution_artifacts
  DROP CONSTRAINT IF EXISTS execution_artifacts_output_locale_check;
ALTER TABLE app.execution_artifacts
  ADD CONSTRAINT execution_artifacts_output_locale_check
  CHECK (app.is_bcp47_language_tag(output_locale)) NOT VALID;

ALTER TABLE app.artifact_revisions
  DROP CONSTRAINT IF EXISTS artifact_revisions_output_locale_check;
ALTER TABLE app.artifact_revisions
  ADD CONSTRAINT artifact_revisions_output_locale_check
  CHECK (app.is_bcp47_language_tag(output_locale)) NOT VALID;

ALTER TABLE app.export_bundles
  DROP CONSTRAINT IF EXISTS export_bundles_output_locale_check;
ALTER TABLE app.export_bundles
  ADD CONSTRAINT export_bundles_output_locale_check
  CHECK (app.is_bcp47_language_tag(output_locale)) NOT VALID;

ALTER TABLE app.client_projects
  VALIDATE CONSTRAINT client_projects_default_delivery_locale_check;
ALTER TABLE app.sites
  VALIDATE CONSTRAINT sites_language_codes_bcp47_check;
ALTER TABLE app.diagnostic_runs
  VALIDATE CONSTRAINT diagnostic_runs_output_locale_check;
ALTER TABLE app.findings
  VALIDATE CONSTRAINT findings_summary_locale_check;
ALTER TABLE app.actions
  VALIDATE CONSTRAINT actions_content_locale_check;
ALTER TABLE app.execution_artifacts
  VALIDATE CONSTRAINT execution_artifacts_output_locale_check;
ALTER TABLE app.artifact_revisions
  VALIDATE CONSTRAINT artifact_revisions_output_locale_check;
ALTER TABLE app.export_bundles
  VALIDATE CONSTRAINT export_bundles_output_locale_check;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0008_bcp47_locale_grammar'::text AS migration_version;

COMMIT;
