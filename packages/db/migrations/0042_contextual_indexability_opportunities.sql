BEGIN;

CREATE OR REPLACE FUNCTION app.enforce_current_diagnostic_manifest()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_count integer;
  matched_snapshot_count integer;
  distinct_snapshot_count integer;
  distinct_provider_count integer;
  manifest_keys text[];
  governance jsonb;
  context_projection jsonb;
  product_routing jsonb;
  site_language jsonb;
  primary_conversion jsonb;
  priority_url_subjects jsonb;
  declared_execution_constraints jsonb;
  profile_generation text;
  icp_profile jsonb;
  icp_content_hash text;
  site_language_codes text[];
BEGIN
  IF NEW.rule_set_version NOT IN (
    'mvp.rules.0.2.1',
    'mvp.rules.0.2.2',
    'mvp.rules.0.2.3',
    'mvp.rules.0.2.4'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.rule_set_version = 'mvp.rules.0.2.1' THEN
    manifest_keys := ARRAY[
      'projectId',
      'siteId',
      'ruleSetVersion',
      'promptSetVersion',
      'deliveryLocale',
      'icp',
      'snapshots'
    ];
  ELSIF NEW.rule_set_version IN (
    'mvp.rules.0.2.2',
    'mvp.rules.0.2.3'
  ) THEN
    manifest_keys := ARRAY[
      'projectId',
      'siteId',
      'ruleSetVersion',
      'promptSetVersion',
      'deliveryLocale',
      'icp',
      'snapshots',
      'governance'
    ];
  ELSIF NEW.rule_set_version = 'mvp.rules.0.2.4' THEN
    manifest_keys := ARRAY[
      'projectId',
      'siteId',
      'ruleSetVersion',
      'promptSetVersion',
      'deliveryLocale',
      'icp',
      'snapshots',
      'governance',
      'contextProjection'
    ];
  END IF;

  IF jsonb_typeof(NEW.input_manifest) IS DISTINCT FROM 'object'
     OR NOT (NEW.input_manifest ?& manifest_keys)
     OR (NEW.input_manifest - manifest_keys) IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'current diagnostic manifest root keys are invalid'
      USING ERRCODE = '23514';
  END IF;

  -- This is the complete 0040 frozen run/ICP validation. The contextual
  -- generation adds no live fallback to mutable project or provider state.
  IF jsonb_typeof(NEW.input_manifest -> 'snapshots') <> 'array'
     OR jsonb_typeof(NEW.input_manifest -> 'icp') <> 'object'
     OR NEW.input_manifest ->> 'projectId' <> NEW.project_id::text
     OR NEW.input_manifest ->> 'siteId' <> NEW.site_id::text
     OR NEW.input_manifest ->> 'ruleSetVersion' <> NEW.rule_set_version
     OR NEW.input_manifest ->> 'promptSetVersion' <> NEW.prompt_set_version
     OR NEW.input_manifest ->> 'deliveryLocale' <> NEW.output_locale
     OR NEW.input_manifest #>> '{icp,id}' <> NEW.icp_profile_id::text
     OR (NEW.input_manifest #>> '{icp,version}')::integer <> NEW.icp_profile_version
     OR NOT EXISTS (
       SELECT 1
       FROM app.icp_profiles icp
       WHERE icp.id = NEW.icp_profile_id
         AND icp.workspace_id = NEW.workspace_id
         AND icp.project_id = NEW.project_id
         AND icp.version = NEW.icp_profile_version
         AND icp.status = 'complete'
         AND icp.content_hash = NEW.input_manifest #>> '{icp,contentHash}'
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest does not match its frozen run and ICP'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.rule_set_version IN (
    'mvp.rules.0.2.2',
    'mvp.rules.0.2.3',
    'mvp.rules.0.2.4'
  ) THEN
    governance := NEW.input_manifest -> 'governance';
    IF jsonb_typeof(governance) IS DISTINCT FROM 'object'
       OR governance ->> 'projectionVersion'
         IS DISTINCT FROM 'growth-governance.1.0.0'
       OR jsonb_typeof(governance -> 'keywordClusters')
         IS DISTINCT FROM 'array'
       OR jsonb_typeof(governance -> 'competitors')
         IS DISTINCT FROM 'array'
       OR NOT (
         governance ?& ARRAY[
           'projectionVersion',
           'keywordClusters',
           'competitors'
         ]
       )
       OR (
         governance
           - ARRAY['projectionVersion', 'keywordClusters', 'competitors']
       ) IS DISTINCT FROM '{}'::jsonb THEN
      RAISE EXCEPTION 'current diagnostic manifest governance projection is invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.rule_set_version = 'mvp.rules.0.2.4' THEN
    context_projection := NEW.input_manifest -> 'contextProjection';
    IF jsonb_typeof(context_projection) IS DISTINCT FROM 'object'
       OR NOT (
         context_projection ?& ARRAY[
           'schemaVersion',
           'compilerVersion',
           'profileGeneration',
           'productRouting',
           'siteLanguage',
           'primaryConversion',
           'priorityUrlSubjects',
           'declaredExecutionConstraints'
         ]
       )
       OR (
         context_projection - ARRAY[
           'schemaVersion',
           'compilerVersion',
           'profileGeneration',
           'productRouting',
           'siteLanguage',
           'primaryConversion',
           'priorityUrlSubjects',
           'declaredExecutionConstraints'
         ]
       ) IS DISTINCT FROM '{}'::jsonb
       OR context_projection ->> 'schemaVersion'
         IS DISTINCT FROM 'context-projection.v1'
       OR context_projection ->> 'compilerVersion'
         IS DISTINCT FROM 'context-projection.compiler.1.0.0'
       OR context_projection ->> 'profileGeneration' NOT IN (
         'product-profile.0.3.0',
         'legacy-icp.v1'
       )
       OR jsonb_typeof(context_projection -> 'productRouting')
         IS DISTINCT FROM 'object'
       OR jsonb_typeof(context_projection -> 'siteLanguage')
         IS DISTINCT FROM 'object'
       OR jsonb_typeof(context_projection -> 'primaryConversion')
         IS DISTINCT FROM 'object'
       OR jsonb_typeof(context_projection -> 'priorityUrlSubjects')
         IS DISTINCT FROM 'object'
       OR jsonb_typeof(
         context_projection -> 'declaredExecutionConstraints'
       ) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'current diagnostic context projection root is invalid'
        USING ERRCODE = '23514';
    END IF;

    profile_generation := context_projection ->> 'profileGeneration';
    SELECT icp.profile, icp.content_hash
    INTO icp_profile, icp_content_hash
    FROM app.icp_profiles icp
    WHERE icp.id = NEW.icp_profile_id
      AND icp.workspace_id = NEW.workspace_id
      AND icp.project_id = NEW.project_id
      AND icp.version = NEW.icp_profile_version
      AND icp.status = 'complete';

    IF NOT FOUND
       OR (
         icp_profile ? 'profileSchemaVersion'
         AND (
           icp_profile ->> 'profileSchemaVersion'
             IS DISTINCT FROM 'product-profile.0.3.0'
           OR profile_generation
             IS DISTINCT FROM 'product-profile.0.3.0'
         )
       )
       OR (
         NOT (icp_profile ? 'profileSchemaVersion')
         AND profile_generation IS DISTINCT FROM 'legacy-icp.v1'
       ) THEN
      RAISE EXCEPTION 'current diagnostic context profile generation is invalid'
        USING ERRCODE = '23514';
    END IF;

    product_routing := context_projection -> 'productRouting';
    IF NOT (
         product_routing ?& ARRAY[
           'sourceKind',
           'productName',
           'oneLiner',
           'productType',
           'businessModels',
           'primaryMarket',
           'primaryAudience'
         ]
       )
       OR (
         product_routing - ARRAY[
           'sourceKind',
           'productName',
           'oneLiner',
           'productType',
           'businessModels',
           'primaryMarket',
           'primaryAudience'
         ]
       ) IS DISTINCT FROM '{}'::jsonb
       OR product_routing ->> 'sourceKind' IS DISTINCT FROM (
         CASE profile_generation
           WHEN 'product-profile.0.3.0' THEN 'product_profile'
           ELSE 'legacy_icp'
         END
       )
       OR jsonb_typeof(product_routing -> 'productName')
         IS DISTINCT FROM 'string'
       OR length(product_routing ->> 'productName') NOT BETWEEN 1 AND 160
       OR product_routing ->> 'productName'
         IS DISTINCT FROM btrim(product_routing ->> 'productName')
       OR jsonb_typeof(product_routing -> 'oneLiner')
         IS DISTINCT FROM 'string'
       OR length(product_routing ->> 'oneLiner') NOT BETWEEN 1 AND 1000
       OR product_routing ->> 'oneLiner'
         IS DISTINCT FROM btrim(product_routing ->> 'oneLiner')
       OR jsonb_typeof(product_routing -> 'productType')
         IS DISTINCT FROM 'string'
       OR length(product_routing ->> 'productType') > 160
       OR (
         profile_generation = 'product-profile.0.3.0'
         AND length(product_routing ->> 'productType') = 0
       )
       OR product_routing ->> 'productType'
         IS DISTINCT FROM btrim(product_routing ->> 'productType')
       OR jsonb_typeof(product_routing -> 'businessModels')
         IS DISTINCT FROM 'array'
       OR jsonb_typeof(product_routing -> 'primaryMarket') NOT IN (
         'string',
         'null'
       )
       OR (
         jsonb_typeof(product_routing -> 'primaryMarket') = 'string'
         AND product_routing ->> 'primaryMarket' !~ '^[A-Z]{2}$'
       )
       OR jsonb_typeof(product_routing -> 'primaryAudience') NOT IN (
         'string',
         'null'
       )
       OR (
         jsonb_typeof(product_routing -> 'primaryAudience') = 'string'
         AND (
           length(product_routing ->> 'primaryAudience') NOT BETWEEN 1 AND 2000
           OR product_routing ->> 'primaryAudience'
             IS DISTINCT FROM btrim(product_routing ->> 'primaryAudience')
         )
       ) THEN
      RAISE EXCEPTION 'current diagnostic context product routing is invalid'
        USING ERRCODE = '23514';
    END IF;

    IF jsonb_array_length(product_routing -> 'businessModels') > 20
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        product_routing -> 'businessModels'
      ) WITH ORDINALITY AS business_model(value, position)
      WHERE jsonb_typeof(business_model.value) IS DISTINCT FROM 'string'
         OR length(business_model.value #>> '{}') NOT BETWEEN 1 AND 160
         OR business_model.value #>> '{}'
           IS DISTINCT FROM btrim(business_model.value #>> '{}')
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        product_routing -> 'businessModels'
      ) WITH ORDINALITY AS current_model(value, position)
      JOIN jsonb_array_elements(
        product_routing -> 'businessModels'
      ) WITH ORDINALITY AS previous_model(value, position)
        ON previous_model.position = current_model.position - 1
      WHERE (previous_model.value #>> '{}') COLLATE "C"
        >= (current_model.value #>> '{}') COLLATE "C"
    ) THEN
      RAISE EXCEPTION 'current diagnostic context business models are invalid'
        USING ERRCODE = '23514';
    END IF;

    site_language := context_projection -> 'siteLanguage';
    SELECT site.language_codes
    INTO site_language_codes
    FROM app.sites site
    WHERE site.id = NEW.site_id
      AND site.workspace_id = NEW.workspace_id
      AND site.project_id = NEW.project_id;

    IF NOT FOUND
       OR NOT (
         site_language ?& ARRAY['sourceKind', 'state', 'languageCodes']
       )
       OR (
         site_language - ARRAY['sourceKind', 'state', 'languageCodes']
       ) IS DISTINCT FROM '{}'::jsonb
       OR site_language ->> 'sourceKind' IS DISTINCT FROM 'site'
       OR site_language ->> 'state' IS DISTINCT FROM (
         CASE
           WHEN cardinality(site_language_codes) = 0 THEN 'declared_empty'
           ELSE 'declared_non_empty'
         END
       )
       OR jsonb_typeof(site_language -> 'languageCodes')
         IS DISTINCT FROM 'array'
       OR site_language -> 'languageCodes'
         IS DISTINCT FROM to_jsonb(site_language_codes) THEN
      RAISE EXCEPTION 'current diagnostic context Site language is invalid'
        USING ERRCODE = '23514';
    END IF;

    primary_conversion := context_projection -> 'primaryConversion';
    IF primary_conversion ->> 'state' = 'available' THEN
      IF NOT (
           primary_conversion ?& ARRAY['state', 'sourceKind', 'value']
         )
         OR (
           primary_conversion - ARRAY['state', 'sourceKind', 'value']
         ) IS DISTINCT FROM '{}'::jsonb
         OR profile_generation IS DISTINCT FROM 'legacy-icp.v1'
         OR primary_conversion ->> 'sourceKind'
           IS DISTINCT FROM 'legacy_icp'
         OR jsonb_typeof(primary_conversion -> 'value')
           IS DISTINCT FROM 'object'
         OR NOT (
           primary_conversion -> 'value'
             ?& ARRAY['label', 'type', 'targetUrl']
         )
         OR (
           (primary_conversion -> 'value')
             - ARRAY['label', 'type', 'targetUrl']::text[]
         ) IS DISTINCT FROM '{}'::jsonb
         OR jsonb_typeof(primary_conversion #> '{value,label}')
           IS DISTINCT FROM 'string'
         OR length(primary_conversion #>> '{value,label}')
           NOT BETWEEN 1 AND 160
         OR primary_conversion #>> '{value,label}'
           IS DISTINCT FROM btrim(primary_conversion #>> '{value,label}')
         OR jsonb_typeof(primary_conversion #> '{value,type}')
           IS DISTINCT FROM 'string'
         OR length(primary_conversion #>> '{value,type}')
           NOT BETWEEN 1 AND 64
         OR primary_conversion #>> '{value,type}'
           IS DISTINCT FROM btrim(primary_conversion #>> '{value,type}')
         OR jsonb_typeof(primary_conversion #> '{value,targetUrl}') NOT IN (
           'string',
           'null'
         )
         OR (
           jsonb_typeof(primary_conversion #> '{value,targetUrl}') = 'string'
           AND (
             length(primary_conversion #>> '{value,targetUrl}')
               NOT BETWEEN 1 AND 2048
             OR primary_conversion #>> '{value,targetUrl}' IS DISTINCT FROM
               btrim(primary_conversion #>> '{value,targetUrl}')
           )
         ) THEN
        RAISE EXCEPTION 'current diagnostic context conversion is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF primary_conversion ->> 'state' = 'missing' THEN
      IF NOT (
           primary_conversion ?& ARRAY['state', 'sourceKind']
         )
         OR (
           primary_conversion - ARRAY['state', 'sourceKind']
         ) IS DISTINCT FROM '{}'::jsonb
         OR primary_conversion ->> 'sourceKind' IS DISTINCT FROM (
           CASE profile_generation
             WHEN 'product-profile.0.3.0'
               THEN 'not_declared_for_generation'
             ELSE 'legacy_icp'
           END
         ) THEN
        RAISE EXCEPTION 'current diagnostic context conversion is invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'current diagnostic context conversion is invalid'
        USING ERRCODE = '23514';
    END IF;

    priority_url_subjects := context_projection -> 'priorityUrlSubjects';
    IF priority_url_subjects ->> 'state' = 'available' THEN
      -- The trigger owns source binding, exact shape, and deterministic order.
      -- Full WHATWG/IDNA/tracking-parameter normalization remains subjectUrlOf()
      -- authority: the current worker recompiles from the immutable pinned ICP
      -- and rejects a byte-canonical mismatch before executing any rule.
      IF NOT (
           priority_url_subjects ?& ARRAY[
             'state',
             'sourceKind',
             'sourceHash',
             'normalizedRefs'
           ]
         )
         OR (
           priority_url_subjects - ARRAY[
             'state',
             'sourceKind',
             'sourceHash',
             'normalizedRefs'
           ]
         ) IS DISTINCT FROM '{}'::jsonb
         OR profile_generation IS DISTINCT FROM 'legacy-icp.v1'
         OR priority_url_subjects ->> 'sourceKind'
           IS DISTINCT FROM 'legacy_icp'
         OR priority_url_subjects ->> 'sourceHash'
           IS DISTINCT FROM icp_content_hash
         OR priority_url_subjects ->> 'sourceHash' !~ '^[a-f0-9]{64}$'
         OR jsonb_typeof(priority_url_subjects -> 'normalizedRefs')
           IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'current diagnostic context priority URLs are invalid'
          USING ERRCODE = '23514';
      END IF;

      IF jsonb_array_length(
           priority_url_subjects -> 'normalizedRefs'
         ) NOT BETWEEN 1 AND 100
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          priority_url_subjects -> 'normalizedRefs'
        ) WITH ORDINALITY AS normalized_ref(value, position)
        WHERE jsonb_typeof(normalized_ref.value) IS DISTINCT FROM 'string'
           OR length(normalized_ref.value #>> '{}') NOT BETWEEN 1 AND 2048
           OR normalized_ref.value #>> '{}'
             IS DISTINCT FROM btrim(normalized_ref.value #>> '{}')
           OR normalized_ref.value #>> '{}' !~ '^https?://'
      )
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          priority_url_subjects -> 'normalizedRefs'
        ) WITH ORDINALITY AS current_ref(value, position)
        JOIN jsonb_array_elements(
          priority_url_subjects -> 'normalizedRefs'
        ) WITH ORDINALITY AS previous_ref(value, position)
          ON previous_ref.position = current_ref.position - 1
        WHERE (previous_ref.value #>> '{}') COLLATE "C"
          >= (current_ref.value #>> '{}') COLLATE "C"
      ) THEN
        RAISE EXCEPTION 'current diagnostic context priority URLs are invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF priority_url_subjects ->> 'state' = 'missing' THEN
      IF NOT (
           priority_url_subjects ?& ARRAY['state', 'sourceKind']
         )
         OR (
           priority_url_subjects - ARRAY['state', 'sourceKind']
         ) IS DISTINCT FROM '{}'::jsonb
         OR priority_url_subjects ->> 'sourceKind' IS DISTINCT FROM (
           CASE profile_generation
             WHEN 'product-profile.0.3.0'
               THEN 'not_declared_for_generation'
             ELSE 'legacy_icp'
           END
         ) THEN
        RAISE EXCEPTION 'current diagnostic context priority URLs are invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'current diagnostic context priority URLs are invalid'
        USING ERRCODE = '23514';
    END IF;

    declared_execution_constraints :=
      context_projection -> 'declaredExecutionConstraints';
    IF declared_execution_constraints ->> 'state' = 'available' THEN
      IF NOT (
           declared_execution_constraints ?& ARRAY[
             'state',
             'sourceKind',
             'technical',
             'resource'
           ]
         )
         OR (
           declared_execution_constraints - ARRAY[
             'state',
             'sourceKind',
             'technical',
             'resource'
           ]
         ) IS DISTINCT FROM '{}'::jsonb
         OR profile_generation IS DISTINCT FROM 'legacy-icp.v1'
         OR declared_execution_constraints ->> 'sourceKind'
           IS DISTINCT FROM 'legacy_icp'
         OR jsonb_typeof(declared_execution_constraints -> 'technical')
           IS DISTINCT FROM 'array'
         OR jsonb_typeof(declared_execution_constraints -> 'resource')
           IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'current diagnostic context constraints are invalid'
          USING ERRCODE = '23514';
      END IF;

      IF jsonb_array_length(
           declared_execution_constraints -> 'technical'
         ) > 100
         OR jsonb_array_length(
           declared_execution_constraints -> 'resource'
         ) > 100
         OR (
           jsonb_array_length(
             declared_execution_constraints -> 'technical'
           ) = 0
           AND jsonb_array_length(
             declared_execution_constraints -> 'resource'
           ) = 0
         )
      OR EXISTS (
        SELECT 1
        FROM (
          SELECT
            constraint_entry.value,
            constraint_entry.position,
            'technical'::text AS constraint_kind
          FROM jsonb_array_elements(
            declared_execution_constraints -> 'technical'
          ) WITH ORDINALITY AS constraint_entry(value, position)
          UNION ALL
          SELECT
            constraint_entry.value,
            constraint_entry.position,
            'resource'::text AS constraint_kind
          FROM jsonb_array_elements(
            declared_execution_constraints -> 'resource'
          ) WITH ORDINALITY AS constraint_entry(value, position)
        ) constraint_entry
        WHERE jsonb_typeof(constraint_entry.value) IS DISTINCT FROM 'string'
           OR length(constraint_entry.value #>> '{}') NOT BETWEEN 1 AND 1000
           OR constraint_entry.value #>> '{}'
             IS DISTINCT FROM btrim(constraint_entry.value #>> '{}')
      )
      OR EXISTS (
        SELECT 1
        FROM (
          SELECT
            current_entry.value AS current_value,
            previous_entry.value AS previous_value
          FROM jsonb_array_elements(
            declared_execution_constraints -> 'technical'
          ) WITH ORDINALITY AS current_entry(value, position)
          JOIN jsonb_array_elements(
            declared_execution_constraints -> 'technical'
          ) WITH ORDINALITY AS previous_entry(value, position)
            ON previous_entry.position = current_entry.position - 1
          UNION ALL
          SELECT
            current_entry.value AS current_value,
            previous_entry.value AS previous_value
          FROM jsonb_array_elements(
            declared_execution_constraints -> 'resource'
          ) WITH ORDINALITY AS current_entry(value, position)
          JOIN jsonb_array_elements(
            declared_execution_constraints -> 'resource'
          ) WITH ORDINALITY AS previous_entry(value, position)
            ON previous_entry.position = current_entry.position - 1
        ) adjacent_constraint
        WHERE (adjacent_constraint.previous_value #>> '{}') COLLATE "C"
          >= (adjacent_constraint.current_value #>> '{}') COLLATE "C"
      ) THEN
        RAISE EXCEPTION 'current diagnostic context constraints are invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSIF declared_execution_constraints ->> 'state' = 'missing' THEN
      IF NOT (
           declared_execution_constraints ?& ARRAY['state', 'sourceKind']
         )
         OR (
           declared_execution_constraints - ARRAY['state', 'sourceKind']
         ) IS DISTINCT FROM '{}'::jsonb
         OR declared_execution_constraints ->> 'sourceKind'
           IS DISTINCT FROM (
           CASE profile_generation
             WHEN 'product-profile.0.3.0'
               THEN 'not_declared_for_generation'
             ELSE 'legacy_icp'
           END
         ) THEN
        RAISE EXCEPTION 'current diagnostic context constraints are invalid'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'current diagnostic context constraints are invalid'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  snapshot_count := jsonb_array_length(NEW.input_manifest -> 'snapshots');
  SELECT
    count(*),
    count(DISTINCT entry ->> 'snapshotId'),
    count(DISTINCT entry ->> 'provider')
  INTO matched_snapshot_count, distinct_snapshot_count, distinct_provider_count
  FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
  JOIN app.data_snapshots snapshot
    ON snapshot.id = (entry ->> 'snapshotId')::uuid
   AND snapshot.workspace_id = NEW.workspace_id
   AND snapshot.project_id = NEW.project_id
   AND snapshot.site_id = NEW.site_id
   AND snapshot.provider = entry ->> 'provider'
   AND snapshot.dataset_key = entry ->> 'datasetKey'
   AND snapshot.schema_version = entry ->> 'schemaVersion'
   AND snapshot.method_version = entry ->> 'methodVersion'
   AND snapshot.checksum = entry ->> 'checksum'
   AND snapshot.availability = entry ->> 'availability'
   AND snapshot.source_window = entry -> 'sourceWindow'
   AND snapshot.captured_at = (entry ->> 'capturedAt')::timestamptz;

  IF snapshot_count = 0
     OR matched_snapshot_count <> snapshot_count
     OR distinct_snapshot_count <> snapshot_count
     OR distinct_provider_count <> snapshot_count
     OR NOT EXISTS (
       SELECT 1
       FROM jsonb_array_elements(NEW.input_manifest -> 'snapshots') entry
       WHERE entry ->> 'provider' = 'crawl'
         AND entry ->> 'methodVersion' = 'crawl.site_graph.v2'
         AND entry ->> 'availability' IN ('available','partial')
     ) THEN
    RAISE EXCEPTION 'current diagnostic manifest snapshot selection is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app.expected_diagnostic_rule_version(
  selected_rule_set text,
  selected_rule_id text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN selected_rule_id NOT IN (
      'TECH-HTTP-001','TECH-CANONICAL-002','TECH-LINKGRAPH-005',
      'TECH-INDEXABILITY-006',
      'SEARCH-CTR-004','SEARCH-DECAY-002','CONTENT-COVERAGE-001',
      'CONTENT-GAP-011','CRO-PATH-001','CRO-LANDING-003',
      'GEO-ENTITY-001','GEO-CRAWLER-002'
    ) THEN NULL
    WHEN selected_rule_id = 'TECH-INDEXABILITY-006' THEN
      CASE
        WHEN selected_rule_set = 'mvp.rules.0.2.4' THEN 1
        ELSE NULL
      END
    WHEN selected_rule_set IN ('mvp.rules.0.2.3', 'mvp.rules.0.2.4')
      AND selected_rule_id = 'TECH-LINKGRAPH-005' THEN 3
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.2',
      'mvp.rules.0.2.3',
      'mvp.rules.0.2.4'
    )
      AND selected_rule_id = 'CONTENT-GAP-011' THEN 2
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2',
      'mvp.rules.0.2.3',
      'mvp.rules.0.2.4'
    )
      AND selected_rule_id IN ('TECH-HTTP-001','TECH-CANONICAL-002') THEN 2
    WHEN selected_rule_set IN ('mvp.rules.0.2.1', 'mvp.rules.0.2.2')
      AND selected_rule_id = 'TECH-LINKGRAPH-005' THEN 2
    WHEN selected_rule_set IN (
      'mvp.rules.0.2.0',
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2',
      'mvp.rules.0.2.3',
      'mvp.rules.0.2.4'
    ) THEN 1
    ELSE NULL
  END
$$;

-- Copy the complete 0017 lineage guard so the new direct-URL rule inherits
-- every existing scope, immutable Observation, exact-fetch, and PageSnapshot
-- proof. Only the rule-to-root mapping and exact-crawl whitelist change.
CREATE OR REPLACE FUNCTION app.enforce_finding_target_lineage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  finding_last_seen_run_id uuid;
  finding_rule_id text;
  expected_relation text;
  diagnostic_site_id uuid;
  observation_provider text;
  observation_metric_key text;
  observation_subject_ref text;
  observation_site_page_id uuid;
  observation_snapshot_id uuid;
  observation_fetch_url text;
  observation_final_status text;
  page_normalized_url text;
  page_template_key text;
BEGIN
  NEW.relation_key := app.finding_target_relation_key(
    NEW.relation,
    NEW.target_kind,
    NEW.target_ref,
    NEW.resolution_state,
    NEW.basis_kind,
    NEW.site_page_id,
    NEW.page_snapshot_id,
    NEW.source_observation_id,
    NEW.member_ref,
    NEW.limitation
  );

  -- A worker retry may replay an immutable row after a later DiagnosticRun
  -- has advanced the mutable Finding projection. BEFORE triggers run before
  -- ON CONFLICT, so let only a scope- and tuple-exact historical row reach the
  -- repository's declared conflict arbiter. A novel stale-run row continues
  -- into the current-sighting guard below and is rejected.
  IF EXISTS (
    SELECT 1
    FROM app.finding_targets existing
    WHERE existing.workspace_id = NEW.workspace_id
      AND existing.project_id = NEW.project_id
      AND existing.site_id = NEW.site_id
      AND existing.finding_id = NEW.finding_id
      AND existing.diagnostic_run_id = NEW.diagnostic_run_id
      AND existing.relation_key = NEW.relation_key
      AND existing.relation = NEW.relation
      AND existing.target_kind = NEW.target_kind
      AND existing.target_ref = NEW.target_ref
      AND existing.resolution_state = NEW.resolution_state
      AND existing.basis_kind = NEW.basis_kind
      AND existing.site_page_id IS NOT DISTINCT FROM NEW.site_page_id
      AND existing.page_snapshot_id IS NOT DISTINCT FROM NEW.page_snapshot_id
      AND existing.source_observation_id IS NOT DISTINCT FROM
        NEW.source_observation_id
      AND existing.member_ref IS NOT DISTINCT FROM NEW.member_ref
      AND existing.limitation IS NOT DISTINCT FROM NEW.limitation
  ) THEN
    RETURN NEW;
  END IF;

  -- A target row is written only in the transaction that first creates or
  -- re-hits the Finding for this exact DiagnosticRun. Lock the projection so a
  -- concurrent later run cannot advance last_seen while this insert commits.
  SELECT finding.last_seen_run_id, finding.rule_id
  INTO finding_last_seen_run_id, finding_rule_id
  FROM app.findings finding
  WHERE finding.id = NEW.finding_id
    AND finding.workspace_id = NEW.workspace_id
    AND finding.project_id = NEW.project_id
  FOR UPDATE;

  IF NOT FOUND
     OR finding_last_seen_run_id IS DISTINCT FROM NEW.diagnostic_run_id THEN
    RAISE EXCEPTION 'Finding target does not match its current Finding sighting'
      USING ERRCODE = '23514';
  END IF;

  SELECT diagnostic.site_id
  INTO diagnostic_site_id
  FROM app.diagnostic_runs diagnostic
  WHERE diagnostic.id = NEW.diagnostic_run_id
    AND diagnostic.workspace_id = NEW.workspace_id
    AND diagnostic.project_id = NEW.project_id
  FOR SHARE;

  IF NOT FOUND OR diagnostic_site_id IS DISTINCT FROM NEW.site_id THEN
    RAISE EXCEPTION 'Finding target does not match its DiagnosticRun Site scope'
      USING ERRCODE = '23514';
  END IF;

  expected_relation := CASE finding_rule_id
    WHEN 'TECH-HTTP-001' THEN 'affected_by_http_status'
    WHEN 'TECH-CANONICAL-002' THEN 'affected_by_canonical_issue'
    WHEN 'TECH-LINKGRAPH-005' THEN 'affected_by_page_set'
    WHEN 'TECH-INDEXABILITY-006' THEN 'direct_url'
    WHEN 'SEARCH-CTR-004' THEN 'direct_url'
    WHEN 'SEARCH-DECAY-002' THEN 'direct_url'
    WHEN 'CONTENT-COVERAGE-001' THEN 'affected_by_page_set'
    WHEN 'CONTENT-GAP-011' THEN 'affected_by_keyword_cluster'
    WHEN 'CRO-PATH-001' THEN 'affected_by_page_set'
    WHEN 'CRO-LANDING-003' THEN 'direct_url'
    WHEN 'GEO-ENTITY-001' THEN 'affected_by_page_set'
    WHEN 'GEO-CRAWLER-002' THEN 'affected_by_user_agent'
    ELSE NULL
  END;

  IF expected_relation IS NULL OR NEW.relation IS DISTINCT FROM expected_relation THEN
    RAISE EXCEPTION 'Finding target root does not match its diagnostic rule'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN (
       'TECH-HTTP-001',
       'TECH-CANONICAL-002',
       'TECH-LINKGRAPH-005',
       'TECH-INDEXABILITY-006',
       'CRO-PATH-001',
       'GEO-ENTITY-001'
     )
     AND NOT (
       NEW.resolution_state = 'resolved'
       AND NEW.basis_kind = 'crawl_exact_fetch'
     ) THEN
    RAISE EXCEPTION 'Finding target rule requires resolved exact Crawl members'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN (
       'CONTENT-COVERAGE-001',
       'CONTENT-GAP-011',
       'GEO-CRAWLER-002'
     )
     AND NOT (
       NEW.resolution_state = 'definition_only'
       AND NEW.basis_kind = 'target_definition'
     ) THEN
    RAISE EXCEPTION 'Finding target rule requires one definition-only root'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN ('SEARCH-CTR-004','SEARCH-DECAY-002')
     AND NOT (
       (
         NEW.resolution_state = 'resolved'
         AND NEW.basis_kind = 'observation_site_page'
       )
       OR (
         NEW.resolution_state = 'unresolved'
         AND NEW.basis_kind = 'unresolved_observation'
       )
     ) THEN
    RAISE EXCEPTION 'Search Finding target requires resolved or unresolved GSC lineage'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id = 'CRO-LANDING-003'
     AND NOT (
       (
         NEW.resolution_state = 'resolved'
         AND NEW.basis_kind = 'observation_site_page'
       )
       OR (
         NEW.resolution_state = 'unresolved'
         AND NEW.basis_kind = 'unresolved_observation'
       )
     ) THEN
    RAISE EXCEPTION 'CRO landing target requires resolved or unresolved GA4 lineage'
      USING ERRCODE = '23514';
  END IF;

  -- Locking the durable Finding row above serializes every direct-SQL writer,
  -- including concurrent first inserts. Re-check the committed ledger only
  -- after that lock, so one Finding/run can never split into multiple roots.
  IF EXISTS (
    SELECT 1
    FROM app.finding_targets existing
    WHERE existing.finding_id = NEW.finding_id
      AND existing.diagnostic_run_id = NEW.diagnostic_run_id
      AND (
        existing.relation IS DISTINCT FROM NEW.relation
        OR existing.target_kind IS DISTINCT FROM NEW.target_kind
        OR existing.target_ref IS DISTINCT FROM NEW.target_ref
        OR (
          existing.resolution_state = 'definition_only'
        ) IS DISTINCT FROM (
          NEW.resolution_state = 'definition_only'
        )
      )
  ) THEN
    RAISE EXCEPTION 'Finding target rows cannot diverge from their per-run root'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolution_state = 'definition_only' THEN
    IF NEW.basis_kind <> 'target_definition'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.page_snapshot_id IS NOT NULL
       OR NEW.source_observation_id IS NOT NULL
       OR NEW.member_ref IS NOT NULL
       OR NEW.relation NOT IN (
         'affected_by_template',
         'affected_by_site',
         'affected_by_page_set',
         'affected_by_keyword_cluster',
         'affected_by_user_agent'
       ) THEN
      RAISE EXCEPTION 'Finding target definition has invalid provenance shape'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.source_observation_id IS NULL OR NEW.member_ref IS NULL THEN
    RAISE EXCEPTION 'Observation-backed Finding target requires immutable source identity'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    observation.provider,
    observation.metric_key,
    observation.subject_ref,
    observation.site_page_id,
    observation.snapshot_id,
    observation.value_json ->> 'fetchUrl',
    observation.value_json ->> 'finalStatus'
  INTO
    observation_provider,
    observation_metric_key,
    observation_subject_ref,
    observation_site_page_id,
    observation_snapshot_id,
    observation_fetch_url,
    observation_final_status
  FROM app.normalized_observations observation
  JOIN app.data_snapshots snapshot
    ON snapshot.id = observation.snapshot_id
   AND snapshot.workspace_id = observation.workspace_id
   AND snapshot.project_id = observation.project_id
   AND snapshot.provider = observation.provider
   AND snapshot.site_id = NEW.site_id
  WHERE observation.id = NEW.source_observation_id
    AND observation.workspace_id = NEW.workspace_id
    AND observation.project_id = NEW.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finding target Observation does not match its Site scope'
      USING ERRCODE = '23514';
  END IF;

  -- The Observation's complete immutable DataSnapshot identity must be frozen
  -- in this exact run. An ID-only or stale manifest entry is insufficient.
  IF NOT EXISTS (
    SELECT 1
    FROM app.diagnostic_runs diagnostic
    JOIN app.data_snapshots snapshot
      ON snapshot.id = observation_snapshot_id
     AND snapshot.workspace_id = NEW.workspace_id
     AND snapshot.project_id = NEW.project_id
     AND snapshot.site_id = NEW.site_id
     AND snapshot.provider = observation_provider
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(diagnostic.input_manifest -> 'snapshots') = 'array'
        THEN diagnostic.input_manifest -> 'snapshots'
        ELSE '[]'::jsonb
      END
    ) AS frozen_snapshot(entry)
    WHERE diagnostic.id = NEW.diagnostic_run_id
      AND diagnostic.workspace_id = NEW.workspace_id
      AND diagnostic.project_id = NEW.project_id
      AND diagnostic.site_id = NEW.site_id
      AND frozen_snapshot.entry ->> 'snapshotId' = snapshot.id::text
      AND frozen_snapshot.entry ->> 'provider' = snapshot.provider
      AND frozen_snapshot.entry ->> 'datasetKey' = snapshot.dataset_key
      AND frozen_snapshot.entry ->> 'schemaVersion' = snapshot.schema_version
      AND frozen_snapshot.entry ->> 'methodVersion' = snapshot.method_version
      AND frozen_snapshot.entry ->> 'checksum' = snapshot.checksum
      AND frozen_snapshot.entry ->> 'availability' = snapshot.availability
      AND frozen_snapshot.entry -> 'sourceWindow' = snapshot.source_window
      AND (frozen_snapshot.entry ->> 'capturedAt')::timestamptz =
        snapshot.captured_at
  ) THEN
    RAISE EXCEPTION 'Finding target Observation is not frozen in its DiagnosticRun manifest'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id IN ('SEARCH-CTR-004','SEARCH-DECAY-002')
     AND (
       observation_provider <> 'gsc'
       OR observation_metric_key <> 'gsc.page.v1'
     ) THEN
    RAISE EXCEPTION 'Search Finding target requires a frozen GSC page Observation'
      USING ERRCODE = '23514';
  END IF;

  IF finding_rule_id = 'CRO-LANDING-003'
     AND (
       observation_provider <> 'ga4'
       OR observation_metric_key <> 'ga4.landing.v1'
     ) THEN
    RAISE EXCEPTION 'CRO landing Finding target requires a frozen GA4 landing Observation'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.resolution_state = 'unresolved' THEN
    IF NEW.basis_kind <> 'unresolved_observation'
       OR NEW.relation <> 'direct_url'
       OR NEW.target_kind <> 'url'
       OR NEW.site_page_id IS NOT NULL
       OR NEW.page_snapshot_id IS NOT NULL
       OR observation_site_page_id IS NOT NULL
       OR NOT (
         (observation_provider = 'gsc' AND observation_metric_key = 'gsc.page.v1')
         OR (
           observation_provider = 'ga4'
           AND observation_metric_key = 'ga4.landing.v1'
         )
       )
       OR NEW.member_ref IS DISTINCT FROM observation_subject_ref
       OR NEW.target_ref IS DISTINCT FROM observation_subject_ref
       OR NEW.limitation IS NULL THEN
      RAISE EXCEPTION 'Unresolved Finding target does not prove an ambiguous analytics Observation'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.resolution_state <> 'resolved'
     OR NEW.basis_kind NOT IN ('crawl_exact_fetch','observation_site_page')
     OR NEW.site_page_id IS NULL
     OR NEW.limitation IS NOT NULL
     OR observation_site_page_id IS DISTINCT FROM NEW.site_page_id THEN
    RAISE EXCEPTION 'Resolved Finding target requires exact Observation SitePage lineage'
      USING ERRCODE = '23514';
  END IF;

  SELECT page.normalized_url, page.template_key
  INTO page_normalized_url, page_template_key
  FROM app.site_pages page
  WHERE page.id = NEW.site_page_id
    AND page.workspace_id = NEW.workspace_id
    AND page.project_id = NEW.project_id
    AND page.site_id = NEW.site_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolved Finding target SitePage does not match its Site scope'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'direct_url'
     AND NEW.target_ref IS DISTINCT FROM page_normalized_url THEN
    RAISE EXCEPTION 'Direct Finding target does not match the exact SitePage URL'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'affected_by_template'
     AND (
       page_template_key IS NULL
       OR NEW.target_ref IS DISTINCT FROM page_template_key
     ) THEN
    RAISE EXCEPTION 'Template Finding target does not match the SitePage template'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.basis_kind = 'crawl_exact_fetch' THEN
    IF observation_provider <> 'crawl'
       OR observation_metric_key <> 'crawl.page.v1'
       OR NEW.page_snapshot_id IS NULL
       OR NEW.member_ref IS DISTINCT FROM observation_fetch_url
       OR page_normalized_url IS DISTINCT FROM observation_fetch_url
       OR NOT EXISTS (
         SELECT 1
         FROM app.page_snapshots page_snapshot
         WHERE page_snapshot.id = NEW.page_snapshot_id
           AND page_snapshot.workspace_id = NEW.workspace_id
           AND page_snapshot.project_id = NEW.project_id
           AND page_snapshot.site_page_id = NEW.site_page_id
           AND page_snapshot.data_snapshot_id = observation_snapshot_id
       ) THEN
      RAISE EXCEPTION 'Crawl Finding target does not match its exact fetch snapshot'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT (
         (observation_provider = 'gsc' AND observation_metric_key = 'gsc.page.v1')
         OR (
           observation_provider = 'ga4'
           AND observation_metric_key = 'ga4.landing.v1'
         )
       )
       OR NEW.member_ref IS DISTINCT FROM observation_subject_ref THEN
      RAISE EXCEPTION 'Analytics Finding target does not match its immutable Observation subject'
        USING ERRCODE = '23514';
    END IF;

    -- Analytics membership comes from Observation.site_page_id. An optional
    -- PageSnapshot is contextual content only and must be the crawl snapshot
    -- for the same page frozen in this DiagnosticRun.
    IF NEW.page_snapshot_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM app.page_snapshots page_snapshot
      JOIN app.data_snapshots snapshot
        ON snapshot.id = page_snapshot.data_snapshot_id
       AND snapshot.workspace_id = NEW.workspace_id
       AND snapshot.project_id = NEW.project_id
       AND snapshot.site_id = NEW.site_id
       AND snapshot.provider = 'crawl'
       AND snapshot.dataset_key = 'crawl.site_graph.v1'
      JOIN app.diagnostic_runs diagnostic
        ON diagnostic.id = NEW.diagnostic_run_id
       AND diagnostic.workspace_id = NEW.workspace_id
       AND diagnostic.project_id = NEW.project_id
       AND diagnostic.site_id = NEW.site_id
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(diagnostic.input_manifest -> 'snapshots') = 'array'
          THEN diagnostic.input_manifest -> 'snapshots'
          ELSE '[]'::jsonb
        END
      ) AS frozen_snapshot(entry)
      WHERE page_snapshot.id = NEW.page_snapshot_id
        AND page_snapshot.workspace_id = NEW.workspace_id
        AND page_snapshot.project_id = NEW.project_id
        AND page_snapshot.site_page_id = NEW.site_page_id
        AND frozen_snapshot.entry ->> 'snapshotId' = snapshot.id::text
        AND frozen_snapshot.entry ->> 'provider' = snapshot.provider
        AND frozen_snapshot.entry ->> 'datasetKey' = snapshot.dataset_key
        AND frozen_snapshot.entry ->> 'schemaVersion' = snapshot.schema_version
        AND frozen_snapshot.entry ->> 'methodVersion' = snapshot.method_version
        AND frozen_snapshot.entry ->> 'checksum' = snapshot.checksum
        AND frozen_snapshot.entry ->> 'availability' = snapshot.availability
        AND frozen_snapshot.entry -> 'sourceWindow' = snapshot.source_window
        AND (frozen_snapshot.entry ->> 'capturedAt')::timestamptz =
          snapshot.captured_at
    ) THEN
      RAISE EXCEPTION 'Analytics Finding target PageSnapshot is not a frozen crawl page'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.relation IN (
       'affected_by_http_status',
       'affected_by_canonical_issue'
     )
     AND NEW.basis_kind <> 'crawl_exact_fetch' THEN
    RAISE EXCEPTION 'HTTP and canonical Finding targets require exact Crawl membership'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.relation = 'affected_by_http_status'
     AND NEW.target_ref IS DISTINCT FROM observation_final_status THEN
    RAISE EXCEPTION 'HTTP Finding target does not match the Crawl final status'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- Keep the ACCESS EXCLUSIVE lock window to metadata only. Adding the widened
-- check as NOT VALID still enforces it for every new or updated row, while the
-- follow-up 0043 migration validates historical rows under PostgreSQL's lower
-- SHARE UPDATE EXCLUSIVE lock. A short lock timeout fails the complete 0042
-- transaction instead of queuing behind live traffic indefinitely.
SET LOCAL lock_timeout = '5s';

ALTER TABLE app.diagnostic_runs
  DROP CONSTRAINT IF EXISTS diagnostic_runs_rule_set_version_check,
  ADD CONSTRAINT diagnostic_runs_rule_set_version_check
  CHECK (
    rule_set_version IN (
      'mvp.rules.0.2.0',
      'mvp.rules.0.2.1',
      'mvp.rules.0.2.2',
      'mvp.rules.0.2.3',
      'mvp.rules.0.2.4'
    )
  ) NOT VALID;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0042_contextual_indexability_opportunities'::text AS migration_version;

COMMIT;
