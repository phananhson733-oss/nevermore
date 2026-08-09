BEGIN;

-- Product Profile-derived GenerativeQueries are first-class project context,
-- not provider observations. Persist the immutable confirmed profile identity
-- explicitly so source_ref text cannot impersonate canonical profile lineage.
ALTER TABLE app.keyword_occurrences
  ADD COLUMN IF NOT EXISTS product_profile_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'keyword_occurrences_product_profile_fk'
      AND conrelid = 'app.keyword_occurrences'::regclass
  ) THEN
    ALTER TABLE app.keyword_occurrences
      ADD CONSTRAINT keyword_occurrences_product_profile_fk
      FOREIGN KEY (product_profile_id)
      REFERENCES app.icp_profiles(id) ON DELETE RESTRICT
      NOT VALID;
  END IF;
END;
$$;

ALTER TABLE app.keyword_occurrences
  VALIDATE CONSTRAINT keyword_occurrences_product_profile_fk;

ALTER TABLE app.keyword_occurrences
  DROP CONSTRAINT IF EXISTS keyword_occurrences_source_kind_check;
ALTER TABLE app.keyword_occurrences
  ADD CONSTRAINT keyword_occurrences_source_kind_check CHECK (
    source_kind IN (
      'csv_import',
      'dataforseo_ranked',
      'gsc_top_query',
      'product_profile',
      'interview_summary',
      'user_review',
      'manual'
    )
  );

-- Replace the anonymous 0018 row-shape check. No historical backfill is
-- needed: every pre-0049 row takes one of the existing branches with a null
-- product_profile_id, while new Product Profile rows carry no invented
-- Snapshot, Observation, pointer, provider timestamp, or manual identity.
ALTER TABLE app.keyword_occurrences
  DROP CONSTRAINT IF EXISTS keyword_occurrences_check;
ALTER TABLE app.keyword_occurrences
  DROP CONSTRAINT IF EXISTS keyword_occurrences_lineage_shape_check;
ALTER TABLE app.keyword_occurrences
  ADD CONSTRAINT keyword_occurrences_lineage_shape_check CHECK (
    (
      source_kind = 'manual'
      AND scope_basis = 'manual'
      AND product_profile_id IS NULL
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND source_pointer IS NULL
      AND provider_data_as_of IS NULL
    )
    OR (
      source_kind = 'product_profile'
      AND scope_basis = 'project_context'
      AND query_kind = 'generative_query'
      AND product_profile_id IS NOT NULL
      AND data_snapshot_id IS NULL
      AND normalized_observation_id IS NULL
      AND source_pointer IS NULL
      AND provider_data_as_of IS NULL
    )
    OR (
      source_kind <> 'manual'
      AND source_kind <> 'product_profile'
      AND scope_basis <> 'manual'
      AND product_profile_id IS NULL
      AND data_snapshot_id IS NOT NULL
      AND normalized_observation_id IS NOT NULL
      AND source_pointer IS NOT NULL
    )
  );

-- Site language spelling is source authority and remains untouched. Cohort
-- occurrences use canonical casing, so admit only the case-insensitive BCP-47
-- identity that JavaScript can derive without an alias change. Keeping the
-- canonical-shape guard on the second argument means a direct `en-us`
-- occurrence still fails closed.
CREATE OR REPLACE FUNCTION app.is_bcp47_canonical_identity(
  raw_candidate text,
  canonical_candidate text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(
    app.is_bcp47_language_tag(raw_candidate)
    AND app.is_bcp47_language_tag(canonical_candidate)
    AND canonical_candidate
      ~ '^([a-z]{2,3}(-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?(-([a-z0-9]{5,8}|[0-9][a-z0-9]{3}))*(-[0-9a-wy-z](-[a-z0-9]{2,8})+)*(-x(-[a-z0-9]{1,8})+)?$'
    AND lower(raw_candidate) = lower(canonical_candidate),
    false
  );
$$;

CREATE OR REPLACE FUNCTION app.enforce_product_profile_keyword_occurrence_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  profile_created_at timestamptz;
  confirmed_profile_json jsonb;
  primary_market_count integer;
  profile_primary_market text;
  primary_site_row app.sites%ROWTYPE;
  selected_template_id text;
  canonical_display_keyword text;
  allowed_template_ids text[] := ARRAY[
    'what-is-product',
    'product-pricing',
    'product-reviews',
    'product-alternatives',
    'best-category',
    'best-category-audience',
    'best-type-audience',
    'buyer-use-case',
    'user-use-case',
    'how-to-jtbd',
    'how-to-use-case',
    'pain-solution',
    'trigger-process',
    'feature-software-1',
    'feature-workflow-2',
    'value-proposition',
    'category-comparison',
    'product-implementation',
    'compare-approved-competitor-1',
    'compare-approved-competitor-2'
  ]::text[];
BEGIN
  IF NEW.source_kind <> 'product_profile'
     OR NEW.product_profile_id IS NULL
     OR NEW.scope_basis <> 'project_context'
     OR NEW.query_kind <> 'generative_query'
     OR NEW.data_snapshot_id IS NOT NULL
     OR NEW.normalized_observation_id IS NOT NULL
     OR NEW.source_pointer IS NOT NULL
     OR NEW.provider_data_as_of IS NOT NULL THEN
    RAISE EXCEPTION 'Product Profile keyword occurrence has invented or incomplete lineage'
      USING ERRCODE = '23514';
  END IF;

  -- Lock both mutable project authority and its immutable confirmed profile.
  -- current_icp_profile_id may already point at the next working draft; only
  -- confirmed_icp_profile_id governs downstream cohort provenance.
  SELECT profile.created_at, profile.profile
  INTO profile_created_at, confirmed_profile_json
  FROM app.client_projects project
  JOIN app.icp_profiles profile
    ON profile.id = project.confirmed_icp_profile_id
   AND profile.id = NEW.product_profile_id
   AND profile.workspace_id = project.workspace_id
   AND profile.project_id = project.id
   AND profile.status = 'complete'
  WHERE project.id = NEW.project_id
    AND project.workspace_id = NEW.workspace_id
    AND project.confirmed_icp_profile_id = NEW.product_profile_id
    AND project.archived_at IS NULL
  FOR SHARE OF project, profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product Profile keyword source is not the confirmed active scoped profile'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*)::integer,
    min(target_market ->> 'marketCode')
  INTO primary_market_count, profile_primary_market
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(confirmed_profile_json -> 'targetMarkets') = 'array'
        THEN confirmed_profile_json -> 'targetMarkets'
      ELSE '[]'::jsonb
    END
  ) AS target_market
  WHERE target_market ->> 'priority' = 'primary';

  IF primary_market_count IS DISTINCT FROM 1
     OR profile_primary_market !~ '^[A-Z]{2}$'
     OR profile_primary_market IS DISTINCT FROM NEW.market THEN
    RAISE EXCEPTION 'Product Profile keyword market is not the unique confirmed profile primary market'
      USING ERRCODE = '23514';
  END IF;

  -- The Site can list every confirmed profile market. It must contain the
  -- profile's unique primary market. Its one raw language spelling remains
  -- source authority while the occurrence carries canonical casing.
  SELECT primary_site.*
  INTO primary_site_row
  FROM app.sites primary_site
  WHERE primary_site.workspace_id = NEW.workspace_id
    AND primary_site.project_id = NEW.project_id
    AND primary_site.is_primary
  FOR SHARE OF primary_site;

  IF NOT FOUND
     OR cardinality(primary_site_row.language_codes) IS DISTINCT FROM 1
     OR NOT coalesce(
       profile_primary_market = ANY (primary_site_row.market_codes),
       false
     )
     OR NOT app.is_bcp47_canonical_identity(
       primary_site_row.language_codes[1],
       NEW.language_tag
     ) THEN
    RAISE EXCEPTION 'Product Profile keyword requires its profile market and one canonical occurrence language matching the Site BCP-47 identity'
      USING ERRCODE = '23514';
  END IF;

  selected_template_id := split_part(
    NEW.source_ref,
    '#profile-generative-query.v1/',
    2
  );
  IF selected_template_id = ''
     OR NOT selected_template_id = ANY (allowed_template_ids)
     OR NEW.source_ref IS DISTINCT FROM (
       'product_profile:' || NEW.product_profile_id::text
       || '#profile-generative-query.v1/' || selected_template_id
     ) THEN
    RAISE EXCEPTION 'Product Profile keyword source ref is not a fixed cohort template'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.collected_at IS DISTINCT FROM profile_created_at THEN
    RAISE EXCEPTION 'Product Profile keyword collection time is not profile creation time'
      USING ERRCODE = '23514';
  END IF;

  canonical_display_keyword := regexp_replace(
    btrim(normalize(NEW.display_keyword, NFKC)),
    '[[:space:]]+',
    ' ',
    'g'
  );
  IF NEW.display_keyword IS DISTINCT FROM canonical_display_keyword
     OR NEW.normalized_keyword IS DISTINCT FROM lower(
       canonical_display_keyword
     ) THEN
    RAISE EXCEPTION 'Product Profile keyword display and normalized identity are not canonical'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Preserve the 0029 split: legacy provider/manual and VOC authorities remain
-- byte-for-byte active, while Product Profile uses its dedicated guard.
DROP TRIGGER IF EXISTS keyword_occurrences_lineage_guard
  ON app.keyword_occurrences;
DROP TRIGGER IF EXISTS keyword_occurrences_voc_lineage_guard
  ON app.keyword_occurrences;
DROP TRIGGER IF EXISTS keyword_occurrences_product_profile_lineage_guard
  ON app.keyword_occurrences;
CREATE TRIGGER keyword_occurrences_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  WHEN (
    NEW.source_kind NOT IN ('interview_summary', 'user_review', 'product_profile')
  )
  EXECUTE FUNCTION app.enforce_keyword_occurrence_lineage();
CREATE TRIGGER keyword_occurrences_voc_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  WHEN (
    NEW.source_kind IN ('interview_summary', 'user_review')
  )
  EXECUTE FUNCTION app.enforce_voc_keyword_occurrence_lineage();
CREATE TRIGGER keyword_occurrences_product_profile_lineage_guard
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW
  WHEN (NEW.source_kind = 'product_profile')
  EXECUTE FUNCTION app.enforce_product_profile_keyword_occurrence_lineage();

-- PostgreSQL cannot replace a function while changing its input arity. Remove
-- the dependent 0048 Keyword batch wrapper first, then replace the old scalar
-- authority so no permissive 16-argument overload survives migration 0049.
DROP FUNCTION app.upsert_keyword_library_occurrences_batch(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS app.upsert_keyword_library_occurrence(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz
);

CREATE OR REPLACE FUNCTION app.upsert_keyword_library_occurrence(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_occurrence_id uuid,
  selected_data_snapshot_id uuid,
  selected_normalized_observation_id uuid,
  selected_product_profile_id uuid,
  selected_display_keyword text,
  selected_normalized_keyword text,
  selected_market text,
  selected_language_tag text,
  selected_query_kind text,
  selected_source_kind text,
  selected_scope_basis text,
  selected_source_pointer text,
  selected_source_ref text,
  selected_collected_at timestamptz,
  selected_provider_data_as_of timestamptz
)
RETURNS TABLE (occurrence_id uuid, entity_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
  occurrence_row app.keyword_occurrences%ROWTYPE;
  entity_row app.keyword_entities%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    WHERE project.id = selected_project_id
      AND project.workspace_id = selected_workspace_id
      AND project.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'keyword library project is absent or archived'
      USING ERRCODE = '23514';
  END IF;
  IF (selected_source_kind = 'manual') IS DISTINCT FROM
     (selected_occurrence_id IS NOT NULL) THEN
    RAISE EXCEPTION 'manual entry id is required only for manual occurrences'
      USING ERRCODE = '23514';
  END IF;
  IF (selected_source_kind = 'product_profile') IS DISTINCT FROM
     (selected_product_profile_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Product Profile id is required only for Product Profile occurrences'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_occurrences (
    id,
    workspace_id,
    project_id,
    data_snapshot_id,
    normalized_observation_id,
    product_profile_id,
    display_keyword,
    normalized_keyword,
    market,
    language_tag,
    query_kind,
    source_kind,
    scope_basis,
    source_pointer,
    source_ref,
    collected_at,
    provider_data_as_of
  ) VALUES (
    coalesce(selected_occurrence_id, gen_random_uuid()),
    selected_workspace_id,
    selected_project_id,
    selected_data_snapshot_id,
    selected_normalized_observation_id,
    selected_product_profile_id,
    selected_display_keyword,
    selected_normalized_keyword,
    selected_market,
    selected_language_tag,
    selected_query_kind,
    selected_source_kind,
    selected_scope_basis,
    selected_source_pointer,
    selected_source_ref,
    selected_collected_at,
    selected_provider_data_as_of
  )
  ON CONFLICT (project_id, source_kind, source_ref) DO NOTHING
  RETURNING * INTO occurrence_row;

  IF occurrence_row.id IS NULL THEN
    SELECT *
    INTO occurrence_row
    FROM app.keyword_occurrences occurrence
    WHERE occurrence.project_id = selected_project_id
      AND occurrence.source_kind = selected_source_kind
      AND occurrence.source_ref = selected_source_ref;
  END IF;

  IF occurrence_row.id IS NULL
     OR (
       selected_source_kind = 'manual'
       AND occurrence_row.id IS DISTINCT FROM selected_occurrence_id
     )
     OR occurrence_row.workspace_id IS DISTINCT FROM selected_workspace_id
     OR occurrence_row.project_id IS DISTINCT FROM selected_project_id
     OR occurrence_row.data_snapshot_id IS DISTINCT FROM selected_data_snapshot_id
     OR occurrence_row.normalized_observation_id IS DISTINCT FROM selected_normalized_observation_id
     OR occurrence_row.product_profile_id IS DISTINCT FROM selected_product_profile_id
     OR occurrence_row.display_keyword IS DISTINCT FROM selected_display_keyword
     OR occurrence_row.normalized_keyword IS DISTINCT FROM selected_normalized_keyword
     OR occurrence_row.market IS DISTINCT FROM selected_market
     OR occurrence_row.language_tag IS DISTINCT FROM selected_language_tag
     OR occurrence_row.query_kind IS DISTINCT FROM selected_query_kind
     OR occurrence_row.source_kind IS DISTINCT FROM selected_source_kind
     OR occurrence_row.scope_basis IS DISTINCT FROM selected_scope_basis
     OR occurrence_row.source_pointer IS DISTINCT FROM selected_source_pointer
     OR occurrence_row.source_ref IS DISTINCT FROM selected_source_ref
     OR occurrence_row.collected_at IS DISTINCT FROM selected_collected_at
     OR occurrence_row.provider_data_as_of IS DISTINCT FROM selected_provider_data_as_of THEN
    RAISE EXCEPTION 'keyword source occurrence conflicts with immutable provenance'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_entities (
    workspace_id,
    project_id,
    display_keyword,
    normalized_keyword,
    market,
    language_tag,
    query_kind,
    first_seen_at,
    last_seen_at
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    selected_display_keyword,
    selected_normalized_keyword,
    selected_market,
    selected_language_tag,
    selected_query_kind,
    selected_collected_at,
    selected_collected_at
  )
  ON CONFLICT (
    project_id,
    normalized_keyword,
    market,
    language_tag,
    query_kind
  ) DO UPDATE SET
    first_seen_at = least(
      app.keyword_entities.first_seen_at,
      EXCLUDED.first_seen_at
    ),
    last_seen_at = greatest(
      app.keyword_entities.last_seen_at,
      EXCLUDED.last_seen_at
    )
  RETURNING * INTO entity_row;

  IF entity_row.workspace_id IS DISTINCT FROM selected_workspace_id THEN
    RAISE EXCEPTION 'keyword stable identity conflicts with workspace scope'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO app.keyword_entity_sources (
    workspace_id,
    project_id,
    keyword_entity_id,
    keyword_occurrence_id
  ) VALUES (
    selected_workspace_id,
    selected_project_id,
    entity_row.id,
    occurrence_row.id
  )
  ON CONFLICT (keyword_entity_id, keyword_occurrence_id) DO NOTHING;

  RETURN QUERY SELECT occurrence_row.id, entity_row.id;
END;
$$;

-- Replace 0048's exact 14-key wrapper with one exact 15-key contract. Every
-- member carries productProfileId (null for all legacy sources), and direct SQL
-- callers cannot smuggle missing, extra, or non-scalar lineage fields through
-- JSON normalization before the scalar authority sees them.
CREATE OR REPLACE FUNCTION app.upsert_keyword_library_occurrences_batch(
  selected_workspace_id uuid,
  selected_project_id uuid,
  selected_inputs jsonb
)
RETURNS TABLE (
  input_ordinal integer,
  occurrence_id uuid,
  entity_id uuid
)
LANGUAGE plpgsql
AS $$
DECLARE
  selected_input jsonb;
  selected_ordinal bigint;
BEGIN
  IF selected_inputs IS NULL
     OR jsonb_typeof(selected_inputs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'keyword occurrence batch must be a JSON array'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(selected_inputs) > 500 THEN
    RAISE EXCEPTION 'keyword occurrence batch exceeds 500 inputs'
      USING ERRCODE = '23514';
  END IF;

  FOR selected_input, selected_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(selected_inputs) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(selected_input) IS DISTINCT FROM 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(selected_input)) <> 15
       OR NOT selected_input ?& ARRAY[
         'occurrenceId',
         'dataSnapshotId',
         'observationId',
         'productProfileId',
         'displayKeyword',
         'normalizedKeyword',
         'market',
         'languageTag',
         'queryKind',
         'sourceKind',
         'scopeBasis',
         'sourcePointer',
         'sourceRef',
         'collectedAt',
         'providerDataAsOf'
       ]::text[] THEN
      RAISE EXCEPTION 'keyword occurrence batch member has an invalid shape'
        USING ERRCODE = '23514';
    END IF;

    IF jsonb_typeof(selected_input -> 'occurrenceId') NOT IN ('string', 'null')
       OR jsonb_typeof(selected_input -> 'dataSnapshotId') NOT IN ('string', 'null')
       OR jsonb_typeof(selected_input -> 'observationId') NOT IN ('string', 'null')
       OR jsonb_typeof(selected_input -> 'productProfileId') NOT IN ('string', 'null')
       OR jsonb_typeof(selected_input -> 'displayKeyword') <> 'string'
       OR jsonb_typeof(selected_input -> 'normalizedKeyword') <> 'string'
       OR jsonb_typeof(selected_input -> 'market') <> 'string'
       OR jsonb_typeof(selected_input -> 'languageTag') <> 'string'
       OR jsonb_typeof(selected_input -> 'queryKind') <> 'string'
       OR jsonb_typeof(selected_input -> 'sourceKind') <> 'string'
       OR jsonb_typeof(selected_input -> 'scopeBasis') <> 'string'
       OR jsonb_typeof(selected_input -> 'sourcePointer') NOT IN ('string', 'null')
       OR jsonb_typeof(selected_input -> 'sourceRef') <> 'string'
       OR jsonb_typeof(selected_input -> 'collectedAt') <> 'string'
       OR jsonb_typeof(selected_input -> 'providerDataAsOf') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'keyword occurrence batch member has invalid scalar types'
        USING ERRCODE = '23514';
    END IF;

    RETURN QUERY
    SELECT
      selected_ordinal::integer,
      result.occurrence_id,
      result.entity_id
    FROM app.upsert_keyword_library_occurrence(
      selected_workspace_id,
      selected_project_id,
      (selected_input ->> 'occurrenceId')::uuid,
      (selected_input ->> 'dataSnapshotId')::uuid,
      (selected_input ->> 'observationId')::uuid,
      (selected_input ->> 'productProfileId')::uuid,
      selected_input ->> 'displayKeyword',
      selected_input ->> 'normalizedKeyword',
      selected_input ->> 'market',
      selected_input ->> 'languageTag',
      selected_input ->> 'queryKind',
      selected_input ->> 'sourceKind',
      selected_input ->> 'scopeBasis',
      selected_input ->> 'sourcePointer',
      selected_input ->> 'sourceRef',
      (selected_input ->> 'collectedAt')::timestamptz,
      (selected_input ->> 'providerDataAsOf')::timestamptz
    ) AS result;
  END LOOP;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0049_product_profile_keyword_lineage'::text AS migration_version;

COMMIT;
