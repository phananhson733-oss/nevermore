BEGIN;

SET LOCAL lock_timeout = '5s';

-- Keyword governance suggestions are an independent internal operation. Keep
-- every historical literal readable while widening the canonical ledgers.
ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_kind_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_kind_check CHECK (kind IN (
    'collection',
    'diagnostic',
    'artifact_generation',
    'export',
    'product_profile_synthesis',
    'content_shadow',
    'publication',
    'measurement',
    'analysis_refresh',
    'topic_model_generation',
    'keyword_governance_suggestion_generation'
  ));

ALTER TABLE app.async_runs
  DROP CONSTRAINT IF EXISTS async_runs_result_type_check;
ALTER TABLE app.async_runs
  ADD CONSTRAINT async_runs_result_type_check CHECK (
    result_type IS NULL OR result_type IN (
      'collection_run',
      'diagnostic_run',
      'artifact',
      'export',
      'icp_profile',
      'flow_shadow_run',
      'publication_attempt',
      'measurement_window',
      'analysis_refresh_run',
      'topic_model_generation_run',
      'keyword_governance_suggestion_generation_run'
    )
  );

ALTER TABLE app.analysis_invocations
  DROP CONSTRAINT IF EXISTS analysis_invocations_task_check;
ALTER TABLE app.analysis_invocations
  ADD CONSTRAINT analysis_invocations_task_check CHECK (task IN (
    'finding_summary',
    'artifact_generation',
    'product_profile_synthesis',
    'content_shadow_draft',
    'topic_model_generation',
    'keyword_governance_suggestion_generation'
  ));

-- Lifecycle truth remains solely in async_runs. This extension freezes the
-- exact JCS preimage supplied by the repository plus its separately computed
-- SHA-256. The prompt/output hashes are one-shot terminal facts.
CREATE TABLE IF NOT EXISTS app.keyword_governance_suggestion_generation_runs (
  id uuid PRIMARY KEY REFERENCES app.async_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL
    REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  generation_version text NOT NULL CHECK (
    generation_version = 'keyword-governance-suggestion-generation.v1'
  ),
  prompt_set_version text NOT NULL CHECK (
    prompt_set_version = 'keyword-governance-suggestion.prompt.v1'
  ),
  input_manifest jsonb NOT NULL CHECK (
    jsonb_typeof(input_manifest) = 'object'
    AND octet_length(input_manifest::text) <= 524288
    AND input_manifest ->> 'schemaVersion' =
      'keyword-governance-suggestion-input.v1'
  ),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  prompt_input_hash text CHECK (
    prompt_input_hash IS NULL OR prompt_input_hash ~ '^[a-f0-9]{64}$'
  ),
  result_output_hash text CHECK (
    result_output_hash IS NULL OR result_output_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS
  keyword_suggestion_runs_project_created_idx
  ON app.keyword_governance_suggestion_generation_runs(
    workspace_id,
    project_id,
    created_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS
  keyword_governance_suggestion_generation_runs_input_hash_idx
  ON app.keyword_governance_suggestion_generation_runs(
    workspace_id,
    project_id,
    input_hash,
    created_at DESC,
    id DESC
  );

-- One canonical current-evidence window is shared by the freezer, frozen-run
-- insert guard, suggestion batch CAS, and exact-hash reuse lookup. Historical
-- membership remains append-only; only the latest 100 relevant occurrences
-- participate in the current generation authority. The returned JSON array is
-- ordered by stable occurrence id so it matches the manifest canonicalizer.
CREATE OR REPLACE FUNCTION
  app.current_keyword_governance_suggestion_occurrence_ids(
    p_workspace_id uuid,
    p_project_id uuid,
    p_keyword_entity_id uuid,
    p_display_keyword text,
    p_normalized_keyword text,
    p_market text,
    p_language_tag text
  )
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(
    jsonb_agg(current_occurrence.id ORDER BY current_occurrence.id),
    '[]'::jsonb
  )
  FROM (
    SELECT occurrence.id
    FROM app.keyword_entity_sources source
    JOIN app.keyword_occurrences occurrence
      ON occurrence.id = source.keyword_occurrence_id
     AND occurrence.workspace_id = source.workspace_id
     AND occurrence.project_id = source.project_id
    WHERE source.workspace_id = p_workspace_id
      AND source.project_id = p_project_id
      AND source.keyword_entity_id = p_keyword_entity_id
      AND occurrence.display_keyword = p_display_keyword
      AND occurrence.normalized_keyword = p_normalized_keyword
      AND occurrence.market = p_market
      AND occurrence.language_tag = p_language_tag
      AND occurrence.query_kind = 'search_query'
    ORDER BY occurrence.collected_at DESC, occurrence.id DESC
    LIMIT 100
  ) current_occurrence;
$$;

CREATE OR REPLACE FUNCTION
  app.enforce_keyword_governance_suggestion_generation_run_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate jsonb;
  candidate_index integer;
  occurrence_ids jsonb;
  product_profile jsonb;
  confirmed_topic jsonb;
  topic_entry jsonb;
  page_entry jsonb;
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW.prompt_input_hash IS NOT NULL OR NEW.result_output_hash IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Keyword suggestion generation must begin without terminal hashes'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.async_runs run
    WHERE run.id = NEW.id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'keyword_governance_suggestion_generation'
      AND run.result_type =
        'keyword_governance_suggestion_generation_run'
      AND run.result_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Keyword suggestion generation run scope does not match async authority'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.generation_version IS DISTINCT FROM
       'keyword-governance-suggestion-generation.v1'
     OR NEW.prompt_set_version IS DISTINCT FROM
       'keyword-governance-suggestion.prompt.v1'
     OR NOT (NEW.input_manifest ?& ARRAY[
       'schemaVersion',
       'generationVersion',
       'promptSetVersion',
       'workspaceId',
       'projectId',
       'marketCode',
       'languageTag',
       'confirmedProductProfile',
       'confirmedTopicModel',
       'topicAllowlist',
       'pageAllowlist',
       'candidates'
     ]::text[])
     OR NEW.input_manifest - ARRAY[
       'schemaVersion',
       'generationVersion',
       'promptSetVersion',
       'workspaceId',
       'projectId',
       'marketCode',
       'languageTag',
       'confirmedProductProfile',
       'confirmedTopicModel',
       'topicAllowlist',
       'pageAllowlist',
       'candidates'
     ]::text[] <> '{}'::jsonb
     OR NEW.input_manifest ->> 'schemaVersion' IS DISTINCT FROM
       'keyword-governance-suggestion-input.v1'
     OR NEW.input_manifest ->> 'generationVersion' IS DISTINCT FROM
       NEW.generation_version
     OR NEW.input_manifest ->> 'promptSetVersion' IS DISTINCT FROM
       NEW.prompt_set_version
     OR NEW.input_manifest ->> 'workspaceId' IS DISTINCT FROM
       NEW.workspace_id::text
     OR NEW.input_manifest ->> 'projectId' IS DISTINCT FROM
       NEW.project_id::text
     OR jsonb_typeof(NEW.input_manifest -> 'marketCode') <> 'string'
     OR length(NEW.input_manifest ->> 'marketCode') NOT BETWEEN 2 AND 3
     OR NEW.input_manifest ->> 'marketCode' <> upper(
       NEW.input_manifest ->> 'marketCode'
     )
     OR jsonb_typeof(NEW.input_manifest -> 'languageTag') <> 'string'
     OR length(NEW.input_manifest ->> 'languageTag') NOT BETWEEN 2 AND 35
     OR NEW.input_manifest ->> 'languageTag' <> btrim(
       NEW.input_manifest ->> 'languageTag'
     )
     OR jsonb_typeof(NEW.input_manifest -> 'topicAllowlist') <> 'array'
     OR jsonb_array_length(NEW.input_manifest -> 'topicAllowlist') > 100
     OR jsonb_typeof(NEW.input_manifest -> 'pageAllowlist') <> 'array'
     OR jsonb_array_length(NEW.input_manifest -> 'pageAllowlist') > 100
     OR jsonb_typeof(NEW.input_manifest -> 'candidates') <> 'array'
     OR jsonb_array_length(NEW.input_manifest -> 'candidates') NOT BETWEEN 1 AND 100
  THEN
    RAISE EXCEPTION 'Keyword suggestion generation manifest is not the exact v1 shape'
      USING ERRCODE = '23514';
  END IF;

  product_profile := NEW.input_manifest -> 'confirmedProductProfile';
  IF jsonb_typeof(product_profile) <> 'object'
     OR NOT (product_profile ?& ARRAY[
       'productProfileId', 'version', 'contentHash', 'facts'
     ]::text[])
     OR product_profile - ARRAY[
       'productProfileId', 'version', 'contentHash', 'facts'
     ]::text[] <> '{}'::jsonb
     OR jsonb_typeof(product_profile -> 'productProfileId') <> 'string'
     OR jsonb_typeof(product_profile -> 'version') <> 'number'
     OR product_profile ->> 'version' !~ '^[1-9][0-9]{0,8}$'
     OR jsonb_typeof(product_profile -> 'contentHash') <> 'string'
     OR product_profile ->> 'contentHash' !~ '^[a-f0-9]{64}$'
     OR jsonb_typeof(product_profile -> 'facts') <> 'object'
     OR NOT ((product_profile -> 'facts') ?& ARRAY[
       'productName',
       'category',
       'valueProposition',
       'targetAudience',
       'buyerRoles',
       'pains',
       'outcomes'
     ]::text[])
     OR (product_profile -> 'facts') - ARRAY[
       'productName',
       'category',
       'valueProposition',
       'targetAudience',
       'buyerRoles',
       'pains',
       'outcomes'
     ]::text[] <> '{}'::jsonb
     OR jsonb_typeof(product_profile #> '{facts,productName}') <> 'string'
     OR length(product_profile #>> '{facts,productName}') NOT BETWEEN 1 AND 500
     OR product_profile #>> '{facts,productName}' <>
       btrim(product_profile #>> '{facts,productName}')
     OR jsonb_typeof(product_profile #> '{facts,category}') <> 'string'
     OR length(product_profile #>> '{facts,category}') NOT BETWEEN 1 AND 500
     OR product_profile #>> '{facts,category}' <>
       btrim(product_profile #>> '{facts,category}')
     OR jsonb_typeof(product_profile #> '{facts,valueProposition}') <> 'string'
     OR length(product_profile #>> '{facts,valueProposition}') NOT BETWEEN 1 AND 2000
     OR product_profile #>> '{facts,valueProposition}' <>
       btrim(product_profile #>> '{facts,valueProposition}')
     OR jsonb_typeof(product_profile #> '{facts,targetAudience}') <> 'string'
     OR length(product_profile #>> '{facts,targetAudience}') NOT BETWEEN 1 AND 2000
     OR product_profile #>> '{facts,targetAudience}' <>
       btrim(product_profile #>> '{facts,targetAudience}')
     OR jsonb_typeof(product_profile #> '{facts,buyerRoles}') <> 'array'
     OR jsonb_array_length(product_profile #> '{facts,buyerRoles}') > 100
     OR jsonb_typeof(product_profile #> '{facts,pains}') <> 'array'
     OR jsonb_array_length(product_profile #> '{facts,pains}') > 100
     OR jsonb_typeof(product_profile #> '{facts,outcomes}') <> 'array'
     OR jsonb_array_length(product_profile #> '{facts,outcomes}') > 100
     OR EXISTS (
       SELECT 1
       FROM (
         SELECT value
         FROM jsonb_array_elements(CASE
           WHEN jsonb_typeof(product_profile #> '{facts,buyerRoles}') = 'array'
           THEN product_profile #> '{facts,buyerRoles}'
           ELSE '[]'::jsonb
         END)
         UNION ALL
         SELECT value
         FROM jsonb_array_elements(CASE
           WHEN jsonb_typeof(product_profile #> '{facts,pains}') = 'array'
           THEN product_profile #> '{facts,pains}'
           ELSE '[]'::jsonb
         END)
         UNION ALL
         SELECT value
         FROM jsonb_array_elements(CASE
           WHEN jsonb_typeof(product_profile #> '{facts,outcomes}') = 'array'
           THEN product_profile #> '{facts,outcomes}'
           ELSE '[]'::jsonb
         END)
       ) fact(value)
       WHERE jsonb_typeof(fact.value) <> 'string'
         OR length(fact.value #>> '{}') NOT BETWEEN 1 AND 500
         OR fact.value #>> '{}' <> btrim(fact.value #>> '{}')
     )
     OR NOT EXISTS (
       SELECT 1
       FROM app.client_projects project
       JOIN app.icp_profiles profile
         ON profile.id = project.confirmed_icp_profile_id
        AND profile.workspace_id = project.workspace_id
        AND profile.project_id = project.id
       WHERE project.id = NEW.project_id
         AND project.workspace_id = NEW.workspace_id
         AND project.archived_at IS NULL
         AND profile.id = (product_profile ->> 'productProfileId')::uuid
         AND profile.version = (product_profile ->> 'version')::integer
         AND profile.status = 'complete'
         AND profile.content_hash = product_profile ->> 'contentHash'
     )
  THEN
    RAISE EXCEPTION 'Keyword suggestion generation Product Profile authority is stale'
      USING ERRCODE = '23514';
  END IF;

  confirmed_topic := NEW.input_manifest -> 'confirmedTopicModel';
  IF jsonb_typeof(confirmed_topic) <> 'object'
     OR NOT (confirmed_topic ?& ARRAY[
       'topicModelRevisionId', 'revision', 'contentHash'
     ]::text[])
     OR confirmed_topic - ARRAY[
       'topicModelRevisionId', 'revision', 'contentHash'
     ]::text[] <> '{}'::jsonb
     OR jsonb_typeof(confirmed_topic -> 'topicModelRevisionId') <> 'string'
     OR jsonb_typeof(confirmed_topic -> 'revision') <> 'number'
     OR confirmed_topic ->> 'revision' !~ '^[1-9][0-9]{0,8}$'
     OR jsonb_typeof(confirmed_topic -> 'contentHash') <> 'string'
     OR confirmed_topic ->> 'contentHash' !~ '^[a-f0-9]{64}$'
     OR NOT EXISTS (
       SELECT 1
       FROM app.topic_model_revisions revision
       WHERE revision.id =
         (confirmed_topic ->> 'topicModelRevisionId')::uuid
         AND revision.workspace_id = NEW.workspace_id
         AND revision.project_id = NEW.project_id
         AND revision.revision =
           (confirmed_topic ->> 'revision')::integer
         AND revision.status = 'confirmed'
         AND revision.content_hash = confirmed_topic ->> 'contentHash'
         AND NOT EXISTS (
           SELECT 1
           FROM app.topic_model_revisions newer
           WHERE newer.workspace_id = revision.workspace_id
             AND newer.project_id = revision.project_id
             AND newer.status = 'confirmed'
             AND newer.revision > revision.revision
         )
     )
  THEN
    RAISE EXCEPTION 'Keyword suggestion generation Topic authority is stale'
      USING ERRCODE = '23514';
  END IF;

  FOR topic_entry IN
    SELECT value
    FROM jsonb_array_elements(NEW.input_manifest -> 'topicAllowlist')
  LOOP
    IF jsonb_typeof(topic_entry) <> 'object'
       OR NOT (topic_entry ?& ARRAY[
         'topicKey', 'topicNodeId', 'topicModelRevision', 'label'
       ]::text[])
       OR topic_entry - ARRAY[
         'topicKey', 'topicNodeId', 'topicModelRevision', 'label'
       ]::text[] <> '{}'::jsonb
       OR topic_entry ->> 'topicKey' !~ '^topic-[a-z0-9-]+$'
       OR (topic_entry ->> 'topicModelRevision')::integer IS DISTINCT FROM
         (confirmed_topic ->> 'revision')::integer
       OR NOT EXISTS (
         SELECT 1
         FROM app.topic_node_revisions node
         WHERE node.workspace_id = NEW.workspace_id
           AND node.project_id = NEW.project_id
           AND node.topic_node_id = (topic_entry ->> 'topicNodeId')::uuid
           AND node.topic_model_revision =
             (topic_entry ->> 'topicModelRevision')::integer
           AND node.lifecycle_state = 'active'
           AND node.label = topic_entry ->> 'label'
       )
    THEN
      RAISE EXCEPTION 'Keyword suggestion generation Topic allowlist is invalid'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF (
    SELECT count(DISTINCT value ->> 'topicKey')
    FROM jsonb_array_elements(NEW.input_manifest -> 'topicAllowlist')
  ) <> jsonb_array_length(NEW.input_manifest -> 'topicAllowlist') THEN
    RAISE EXCEPTION 'Keyword suggestion generation Topic keys must be unique'
      USING ERRCODE = '23514';
  END IF;

  FOR page_entry IN
    SELECT value
    FROM jsonb_array_elements(NEW.input_manifest -> 'pageAllowlist')
  LOOP
    IF jsonb_typeof(page_entry) <> 'object'
       OR NOT (page_entry ?& ARRAY[
         'pageKey', 'sitePageId', 'normalizedUrl', 'title'
       ]::text[])
       OR page_entry - ARRAY[
         'pageKey', 'sitePageId', 'normalizedUrl', 'title'
       ]::text[] <> '{}'::jsonb
       OR page_entry ->> 'pageKey' !~ '^page-[a-z0-9-]+$'
       OR NOT EXISTS (
         SELECT 1
         FROM app.site_pages page
         JOIN app.sites site
           ON site.id = page.site_id
          AND site.workspace_id = page.workspace_id
          AND site.project_id = page.project_id
          AND site.is_primary
         JOIN app.client_projects project
           ON project.id = page.project_id
          AND project.workspace_id = page.workspace_id
         WHERE page.id = (page_entry ->> 'sitePageId')::uuid
           AND page.workspace_id = NEW.workspace_id
           AND page.project_id = NEW.project_id
           AND page.normalized_url = page_entry ->> 'normalizedUrl'
           AND project.archived_at IS NULL
       )
    THEN
      RAISE EXCEPTION 'Keyword suggestion generation Page allowlist is invalid'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF (
    SELECT count(DISTINCT value ->> 'pageKey')
    FROM jsonb_array_elements(NEW.input_manifest -> 'pageAllowlist')
  ) <> jsonb_array_length(NEW.input_manifest -> 'pageAllowlist') THEN
    RAISE EXCEPTION 'Keyword suggestion generation Page keys must be unique'
      USING ERRCODE = '23514';
  END IF;

  candidate_index := 0;
  FOR candidate IN
    SELECT value
    FROM jsonb_array_elements(NEW.input_manifest -> 'candidates')
  LOOP
    candidate_index := candidate_index + 1;
    occurrence_ids := candidate #> '{deterministicEvidence,sourceOccurrenceIds}';
    IF jsonb_typeof(candidate) <> 'object'
       OR NOT (candidate ?& ARRAY[
         'ordinal',
         'keywordKey',
         'keywordId',
         'queryKind',
         'expectedGovernanceRevision',
         'displayKeyword',
         'normalizedKeyword',
         'deterministicEvidence'
       ]::text[])
       OR candidate - ARRAY[
         'ordinal',
         'keywordKey',
         'keywordId',
         'queryKind',
         'expectedGovernanceRevision',
         'displayKeyword',
         'normalizedKeyword',
         'deterministicEvidence'
       ]::text[] <> '{}'::jsonb
       OR (candidate ->> 'ordinal')::integer IS DISTINCT FROM candidate_index
       OR candidate ->> 'keywordKey' !~ '^keyword-[a-z0-9-]+$'
       OR candidate ->> 'queryKind' IS DISTINCT FROM 'search_query'
       OR candidate ->> 'expectedGovernanceRevision' !~ '^(0|[1-9][0-9]{0,9})$'
       OR jsonb_typeof(candidate -> 'deterministicEvidence') <> 'object'
       OR NOT ((candidate -> 'deterministicEvidence') ?& ARRAY[
         'sourceOccurrenceIds',
         'providerSearchIntent',
         'currentTopicKey',
         'currentPageKey'
       ]::text[])
       OR (candidate -> 'deterministicEvidence') - ARRAY[
         'sourceOccurrenceIds',
         'providerSearchIntent',
         'currentTopicKey',
         'currentPageKey'
       ]::text[] <> '{}'::jsonb
       OR jsonb_typeof(occurrence_ids) <> 'array'
       OR jsonb_array_length(occurrence_ids) NOT BETWEEN 1 AND 100
       OR jsonb_typeof(candidate #>
         '{deterministicEvidence,currentTopicKey}') NOT IN ('string', 'null')
       OR jsonb_typeof(candidate #>
         '{deterministicEvidence,currentPageKey}') NOT IN ('string', 'null')
       OR (
         jsonb_typeof(candidate #>
           '{deterministicEvidence,currentPageKey}') = 'string'
         AND jsonb_typeof(candidate #>
           '{deterministicEvidence,currentTopicKey}') <> 'string'
       )
       OR jsonb_typeof(
         candidate #> '{deterministicEvidence,providerSearchIntent}'
       ) NOT IN ('object', 'null')
       OR (
         jsonb_typeof(
           candidate #> '{deterministicEvidence,providerSearchIntent}'
         ) = 'object'
         AND (
           NOT ((candidate #> '{deterministicEvidence,providerSearchIntent}')
             ?& ARRAY[
               'value', 'snapshotId', 'observationId', 'observedAt'
             ]::text[])
           OR (candidate #> '{deterministicEvidence,providerSearchIntent}')
             - ARRAY[
               'value', 'snapshotId', 'observationId', 'observedAt'
             ]::text[] <> '{}'::jsonb
           OR candidate #>>
             '{deterministicEvidence,providerSearchIntent,value}' NOT IN (
               'informational', 'navigational', 'commercial', 'transactional'
             )
           OR jsonb_typeof(candidate #>
             '{deterministicEvidence,providerSearchIntent,snapshotId}') <>
               'string'
           OR jsonb_typeof(candidate #>
             '{deterministicEvidence,providerSearchIntent,observationId}') <>
               'string'
           OR jsonb_typeof(candidate #>
             '{deterministicEvidence,providerSearchIntent,observedAt}') <>
               'string'
           OR NOT EXISTS (
             SELECT 1
             FROM app.keyword_entity_sources intent_source
             JOIN app.keyword_occurrences occurrence
               ON occurrence.id = intent_source.keyword_occurrence_id
              AND occurrence.workspace_id = intent_source.workspace_id
              AND occurrence.project_id = intent_source.project_id
             JOIN app.normalized_observations observation
               ON observation.id = occurrence.normalized_observation_id
              AND observation.workspace_id = occurrence.workspace_id
              AND observation.project_id = occurrence.project_id
              AND observation.snapshot_id = occurrence.data_snapshot_id
             WHERE intent_source.workspace_id = NEW.workspace_id
               AND intent_source.project_id = NEW.project_id
               AND intent_source.keyword_entity_id =
                 (candidate ->> 'keywordId')::uuid
               AND intent_source.keyword_occurrence_id IN (
                 SELECT source_id.value::uuid
                 FROM jsonb_array_elements_text(occurrence_ids)
                   source_id(value)
               )
               AND occurrence.data_snapshot_id =
                 (candidate #>>
                   '{deterministicEvidence,providerSearchIntent,snapshotId}')::uuid
               AND occurrence.normalized_observation_id =
                 (candidate #>>
                   '{deterministicEvidence,providerSearchIntent,observationId}')::uuid
               AND observation.observed_at =
                 (candidate #>>
                   '{deterministicEvidence,providerSearchIntent,observedAt}')::timestamptz
               AND observation.provider = 'dataforseo'
               AND observation.metric_key = 'csv.keyword_gap.v1'
               AND observation.availability = 'available'
               AND observation.value_json ->> 'providerSearchIntent' =
                 candidate #>>
                   '{deterministicEvidence,providerSearchIntent,value}'
           )
         )
       )
       OR NOT EXISTS (
         SELECT 1
         FROM app.keyword_entities keyword
         JOIN app.client_projects project
           ON project.id = keyword.project_id
          AND project.workspace_id = keyword.workspace_id
         WHERE keyword.id = (candidate ->> 'keywordId')::uuid
           AND keyword.workspace_id = NEW.workspace_id
           AND keyword.project_id = NEW.project_id
           AND project.archived_at IS NULL
           AND keyword.query_kind = 'search_query'
           AND keyword.status = 'candidate'
           AND keyword.mapping_review_state = 'unreviewed'
           AND keyword.mapping_revision =
             (candidate ->> 'expectedGovernanceRevision')::integer
           AND keyword.display_keyword = candidate ->> 'displayKeyword'
           AND keyword.normalized_keyword = candidate ->> 'normalizedKeyword'
           AND keyword.market = NEW.input_manifest ->> 'marketCode'
           AND keyword.language_tag = NEW.input_manifest ->> 'languageTag'
           AND (
             (
               jsonb_typeof(candidate #>
                 '{deterministicEvidence,currentTopicKey}') = 'null'
               AND NOT EXISTS (
                 SELECT 1
                 FROM app.keyword_review_decisions current_decision
                 WHERE current_decision.workspace_id = keyword.workspace_id
                   AND current_decision.project_id = keyword.project_id
                   AND current_decision.keyword_entity_id = keyword.id
                   AND current_decision.governance_revision =
                     keyword.mapping_revision
                   AND current_decision.topic_node_id IS NOT NULL
               )
             )
             OR (
               jsonb_typeof(candidate #>
                 '{deterministicEvidence,currentTopicKey}') = 'string'
               AND EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements(
                   NEW.input_manifest -> 'topicAllowlist'
                 ) current_topic(value)
                 JOIN app.keyword_review_decisions current_decision
                   ON current_decision.workspace_id = keyword.workspace_id
                  AND current_decision.project_id = keyword.project_id
                  AND current_decision.keyword_entity_id = keyword.id
                  AND current_decision.governance_revision =
                    keyword.mapping_revision
                  AND current_decision.topic_node_id =
                    (current_topic.value ->> 'topicNodeId')::uuid
                  AND current_decision.topic_model_revision =
                    (current_topic.value ->> 'topicModelRevision')::integer
                 WHERE current_topic.value ->> 'topicKey' = candidate #>>
                   '{deterministicEvidence,currentTopicKey}'
               )
             )
           )
           AND (
             (
               jsonb_typeof(candidate #>
                 '{deterministicEvidence,currentPageKey}') = 'null'
               AND keyword.mapped_site_page_id IS NULL
             )
             OR (
               jsonb_typeof(candidate #>
                 '{deterministicEvidence,currentPageKey}') = 'string'
               AND EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements(
                   NEW.input_manifest -> 'pageAllowlist'
                 ) current_page(value)
                 WHERE current_page.value ->> 'pageKey' = candidate #>>
                     '{deterministicEvidence,currentPageKey}'
                   AND (current_page.value ->> 'sitePageId')::uuid =
                     keyword.mapped_site_page_id
               )
             )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM app.keyword_review_decisions decision
             WHERE decision.workspace_id = keyword.workspace_id
               AND decision.project_id = keyword.project_id
               AND decision.keyword_entity_id = keyword.id
               AND decision.decision_origin = 'user'
           )
       )
       OR occurrence_ids IS DISTINCT FROM
         app.current_keyword_governance_suggestion_occurrence_ids(
           NEW.workspace_id,
           NEW.project_id,
           (candidate ->> 'keywordId')::uuid,
           candidate ->> 'displayKeyword',
           candidate ->> 'normalizedKeyword',
           NEW.input_manifest ->> 'marketCode',
           NEW.input_manifest ->> 'languageTag'
         )
    THEN
      RAISE EXCEPTION 'Keyword suggestion generation candidate authority is invalid'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF (
    SELECT count(DISTINCT value ->> 'keywordKey')
    FROM jsonb_array_elements(NEW.input_manifest -> 'candidates')
  ) <> jsonb_array_length(NEW.input_manifest -> 'candidates') OR (
    SELECT count(DISTINCT value ->> 'keywordId')
    FROM jsonb_array_elements(NEW.input_manifest -> 'candidates')
  ) <> jsonb_array_length(NEW.input_manifest -> 'candidates') THEN
    RAISE EXCEPTION 'Keyword suggestion generation candidates must be unique'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Keyword suggestion generation manifest has invalid scalar identities'
      USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION
  app.enforce_keyword_suggestion_run_frozen_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Keyword suggestion generation run is durable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.generation_version IS DISTINCT FROM OLD.generation_version
     OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
     OR NEW.input_manifest IS DISTINCT FROM OLD.input_manifest
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Keyword suggestion generation frozen input is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.prompt_input_hash IS NOT NULL
     AND NEW.prompt_input_hash IS DISTINCT FROM OLD.prompt_input_hash THEN
    RAISE EXCEPTION 'Keyword suggestion prompt input hash is immutable once set'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.result_output_hash IS NOT NULL
     AND NEW.result_output_hash IS DISTINCT FROM OLD.result_output_hash THEN
    RAISE EXCEPTION 'Keyword suggestion result output hash is immutable once set'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  keyword_suggestion_generation_runs_provenance_guard
  ON app.keyword_governance_suggestion_generation_runs;
CREATE TRIGGER
  keyword_suggestion_generation_runs_provenance_guard
  BEFORE INSERT OR UPDATE
  ON app.keyword_governance_suggestion_generation_runs
  FOR EACH ROW EXECUTE FUNCTION
    app.enforce_keyword_governance_suggestion_generation_run_provenance();

DROP TRIGGER IF EXISTS
  keyword_suggestion_generation_runs_frozen_input_guard
  ON app.keyword_governance_suggestion_generation_runs;
CREATE TRIGGER
  keyword_suggestion_generation_runs_frozen_input_guard
  BEFORE UPDATE OR DELETE
  ON app.keyword_governance_suggestion_generation_runs
  FOR EACH ROW EXECUTE FUNCTION
    app.enforce_keyword_suggestion_run_frozen_input();

CREATE OR REPLACE FUNCTION
  app.enforce_keyword_governance_suggestion_generation_async_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.kind = 'keyword_governance_suggestion_generation'
     AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'Keyword suggestion generation async kind is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.kind IS DISTINCT FROM
       'keyword_governance_suggestion_generation' THEN
    RETURN NEW;
  END IF;
  IF NEW.result_type IS DISTINCT FROM
       'keyword_governance_suggestion_generation_run'
     OR NEW.result_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Keyword suggestion async result must point at its typed run'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'partial' THEN
    RAISE EXCEPTION 'Keyword suggestion generation does not support partial results'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'completed' AND NOT EXISTS (
    SELECT 1
    FROM app.keyword_governance_suggestion_generation_runs generation_run
    WHERE generation_run.id = NEW.id
      AND generation_run.workspace_id = NEW.workspace_id
      AND generation_run.project_id = NEW.project_id
      AND generation_run.result_output_hash IS NOT NULL
      AND (
        SELECT count(*)
        FROM app.keyword_review_suggestions suggestion
        WHERE suggestion.generation_run_id = generation_run.id
      ) = jsonb_array_length(generation_run.input_manifest -> 'candidates')
  ) THEN
    RAISE EXCEPTION 'Completed Keyword suggestion generation requires one complete result batch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('failed', 'cancelled') AND EXISTS (
    SELECT 1
    FROM app.keyword_governance_suggestion_generation_runs generation_run
    WHERE generation_run.id = NEW.id
      AND (
        generation_run.result_output_hash IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM app.keyword_review_suggestions suggestion
          WHERE suggestion.generation_run_id = generation_run.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Unsuccessful Keyword suggestion generation cannot retain results'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- The trigger function resolves the suggestion table at runtime. PostgreSQL
-- permits creating it before that relation as long as execution follows DDL.
DROP TRIGGER IF EXISTS
  async_runs_keyword_suggestion_generation_result_guard
  ON app.async_runs;
CREATE TRIGGER
  async_runs_keyword_suggestion_generation_result_guard
  BEFORE INSERT OR UPDATE ON app.async_runs
  FOR EACH ROW EXECUTE FUNCTION
    app.enforce_keyword_governance_suggestion_generation_async_result();

-- A durable reservation consumes paid-call budget before the worker leaves
-- its transaction. Prompt/response bodies are never stored here.
CREATE TABLE IF NOT EXISTS
  app.keyword_governance_suggestion_invocation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  generation_run_id uuid NOT NULL
    REFERENCES app.keyword_governance_suggestion_generation_runs(id)
    ON DELETE RESTRICT,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 3),
  async_attempt_count integer NOT NULL CHECK (async_attempt_count >= 1),
  provider text NOT NULL CHECK (provider IN ('openai', 'google')),
  model text NOT NULL CHECK (
    length(model) BETWEEN 1 AND 200 AND model = btrim(model)
  ),
  prompt_set_version text NOT NULL CHECK (
    prompt_set_version = 'keyword-governance-suggestion.prompt.v1'
  ),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  planned_analysis_invocation_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN (
    'reserved', 'succeeded', 'failed', 'rejected', 'outcome_unknown'
  )),
  analysis_invocation_id uuid UNIQUE
    REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  terminal_error_code text CHECK (
    terminal_error_code IS NULL
    OR terminal_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'
  ),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  provider_returned_at timestamptz,
  finalized_at timestamptz,
  UNIQUE (generation_run_id, ordinal),
  UNIQUE (generation_run_id, async_attempt_count),
  CHECK (
    (status = 'reserved'
      AND analysis_invocation_id IS NULL
      AND terminal_error_code IS NULL
      AND provider_returned_at IS NULL
      AND finalized_at IS NULL)
    OR
    (status = 'succeeded'
      AND analysis_invocation_id = planned_analysis_invocation_id
      AND terminal_error_code IS NULL
      AND provider_returned_at IS NOT NULL
      AND finalized_at IS NOT NULL)
    OR
    (status IN ('failed', 'rejected')
      AND analysis_invocation_id = planned_analysis_invocation_id
      AND terminal_error_code IS NOT NULL
      AND provider_returned_at IS NOT NULL
      AND finalized_at IS NOT NULL)
    OR
    (status = 'outcome_unknown'
      AND analysis_invocation_id IS NULL
      AND terminal_error_code IS NOT NULL
      AND provider_returned_at IS NOT NULL
      AND finalized_at IS NOT NULL)
  ),
  CHECK (
    provider_returned_at IS NULL OR reserved_at <= provider_returned_at
  ),
  CHECK (
    provider_returned_at IS NULL OR finalized_at IS NULL
    OR provider_returned_at <= finalized_at
  )
);

CREATE INDEX IF NOT EXISTS
  keyword_governance_suggestion_invocation_attempts_project_idx
  ON app.keyword_governance_suggestion_invocation_attempts(
    project_id, reserved_at DESC, id ASC
  );
CREATE INDEX IF NOT EXISTS
  keyword_suggestion_attempts_unresolved_idx
  ON app.keyword_governance_suggestion_invocation_attempts(
    generation_run_id, ordinal
  ) WHERE status IN ('reserved', 'outcome_unknown');

CREATE OR REPLACE FUNCTION
  app.enforce_keyword_suggestion_attempt_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_ordinal integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'reserved'
       OR NEW.analysis_invocation_id IS NOT NULL
       OR NEW.terminal_error_code IS NOT NULL
       OR NEW.provider_returned_at IS NOT NULL
       OR NEW.finalized_at IS NOT NULL THEN
      RAISE EXCEPTION 'Keyword suggestion invocation must begin reserved'
        USING ERRCODE = '23514';
    END IF;
    PERFORM 1
    FROM app.async_runs run
    JOIN app.keyword_governance_suggestion_generation_runs generation_run
      ON generation_run.id = run.id
    WHERE run.id = NEW.generation_run_id
      AND run.workspace_id = NEW.workspace_id
      AND run.project_id = NEW.project_id
      AND run.kind = 'keyword_governance_suggestion_generation'
      AND run.status = 'running'
      AND run.attempt_count = NEW.async_attempt_count
      AND generation_run.workspace_id = NEW.workspace_id
      AND generation_run.project_id = NEW.project_id
      AND generation_run.prompt_set_version = NEW.prompt_set_version
      AND generation_run.prompt_input_hash = NEW.input_hash
    FOR UPDATE OF run, generation_run;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Keyword suggestion invocation scope or delivery is stale'
        USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(max(attempt.ordinal), 0)::integer + 1
      INTO expected_ordinal
    FROM app.keyword_governance_suggestion_invocation_attempts attempt
    WHERE attempt.generation_run_id = NEW.generation_run_id;
    IF expected_ordinal > 3 OR NEW.ordinal IS DISTINCT FROM expected_ordinal THEN
      RAISE EXCEPTION 'Keyword suggestion invocation ordinal is not sequential'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Keyword suggestion invocation attempts are append-only'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.generation_run_id IS DISTINCT FROM OLD.generation_run_id
     OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
     OR NEW.async_attempt_count IS DISTINCT FROM OLD.async_attempt_count
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
     OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
     OR NEW.planned_analysis_invocation_id IS DISTINCT FROM
       OLD.planned_analysis_invocation_id
     OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at THEN
    RAISE EXCEPTION 'Keyword suggestion invocation reservation is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status IS DISTINCT FROM 'reserved' THEN
    RAISE EXCEPTION 'Terminal Keyword suggestion invocation is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN (
    'succeeded', 'failed', 'rejected', 'outcome_unknown'
  ) THEN
    RAISE EXCEPTION 'Keyword suggestion invocation must transition once'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status IN ('succeeded', 'failed', 'rejected') AND NOT EXISTS (
    SELECT 1
    FROM app.analysis_invocations invocation
    WHERE invocation.id = NEW.planned_analysis_invocation_id
      AND invocation.id = NEW.analysis_invocation_id
      AND invocation.workspace_id = NEW.workspace_id
      AND invocation.project_id = NEW.project_id
      AND invocation.async_run_id = NEW.generation_run_id
      AND invocation.diagnostic_run_id IS NULL
      AND invocation.task =
        'keyword_governance_suggestion_generation'
      AND invocation.provider = NEW.provider
      AND invocation.model = NEW.model
      AND invocation.prompt_set_version = NEW.prompt_set_version
      AND invocation.input_hash = NEW.input_hash
      AND invocation.status = NEW.status
      AND invocation.error_code IS NOT DISTINCT FROM
        NEW.terminal_error_code
  ) THEN
    RAISE EXCEPTION 'Keyword suggestion invocation does not match analysis ledger'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS
  keyword_suggestion_invocation_attempts_transition_guard
  ON app.keyword_governance_suggestion_invocation_attempts;
CREATE TRIGGER
  keyword_suggestion_invocation_attempts_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON app.keyword_governance_suggestion_invocation_attempts
  FOR EACH ROW EXECUTE FUNCTION
    app.enforce_keyword_suggestion_attempt_transition();

CREATE OR REPLACE FUNCTION
  app.reserve_keyword_governance_suggestion_invocation_attempt(
    p_workspace_id uuid,
    p_project_id uuid,
    p_run_id uuid,
    p_async_attempt_count integer,
    p_provider text,
    p_model text,
    p_prompt_set_version text,
    p_input_hash text
  )
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  generation_run
    app.keyword_governance_suggestion_generation_runs%ROWTYPE;
  existing_attempt
    app.keyword_governance_suggestion_invocation_attempts%ROWTYPE;
  unresolved_attempt
    app.keyword_governance_suggestion_invocation_attempts%ROWTYPE;
  reserved_attempt
    app.keyword_governance_suggestion_invocation_attempts%ROWTYPE;
  invocation_count integer;
  next_ordinal integer;
BEGIN
  SELECT generation.* INTO generation_run
  FROM app.async_runs run
  JOIN app.keyword_governance_suggestion_generation_runs generation
    ON generation.id = run.id
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'keyword_governance_suggestion_generation'
    AND run.status = 'running'
    AND run.attempt_count = p_async_attempt_count
    AND generation.workspace_id = p_workspace_id
    AND generation.project_id = p_project_id
  FOR UPDATE OF run, generation;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale');
  END IF;

  IF p_async_attempt_count < 1
     OR p_provider IS NULL OR p_provider NOT IN ('openai', 'google')
     OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 200
     OR p_model IS DISTINCT FROM btrim(p_model)
     OR p_prompt_set_version IS DISTINCT FROM
       generation_run.prompt_set_version
     OR p_input_hash IS NULL OR p_input_hash !~ '^[a-f0-9]{64}$'
     OR (generation_run.prompt_input_hash IS NOT NULL
       AND generation_run.prompt_input_hash IS DISTINCT FROM p_input_hash)
  THEN
    RETURN jsonb_build_object('kind', 'configuration_mismatch');
  END IF;

  SELECT attempt.* INTO existing_attempt
  FROM app.keyword_governance_suggestion_invocation_attempts attempt
  WHERE attempt.generation_run_id = p_run_id
    AND attempt.async_attempt_count = p_async_attempt_count;
  IF FOUND THEN
    IF existing_attempt.workspace_id = p_workspace_id
       AND existing_attempt.project_id = p_project_id
       AND existing_attempt.provider = p_provider
       AND existing_attempt.model = p_model
       AND existing_attempt.prompt_set_version = p_prompt_set_version
       AND existing_attempt.input_hash = p_input_hash THEN
      RETURN jsonb_build_object(
        'kind', 'existing', 'reservation', to_jsonb(existing_attempt)
      );
    END IF;
    RETURN jsonb_build_object('kind', 'configuration_mismatch');
  END IF;

  SELECT attempt.* INTO unresolved_attempt
  FROM app.keyword_governance_suggestion_invocation_attempts attempt
  WHERE attempt.generation_run_id = p_run_id
    AND attempt.async_attempt_count < p_async_attempt_count
    AND attempt.status IN ('reserved', 'outcome_unknown')
  ORDER BY attempt.ordinal ASC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'unresolved', 'reservation', to_jsonb(unresolved_attempt)
    );
  END IF;

  SELECT count(*)::integer, coalesce(max(attempt.ordinal), 0)::integer + 1
    INTO invocation_count, next_ordinal
  FROM app.keyword_governance_suggestion_invocation_attempts attempt
  WHERE attempt.generation_run_id = p_run_id;
  IF invocation_count >= 3 OR next_ordinal > 3 THEN
    RETURN jsonb_build_object('kind', 'budget_exhausted');
  END IF;

  IF generation_run.prompt_input_hash IS NULL THEN
    UPDATE app.keyword_governance_suggestion_generation_runs
    SET prompt_input_hash = p_input_hash
    WHERE id = p_run_id
      AND workspace_id = p_workspace_id
      AND project_id = p_project_id
      AND prompt_input_hash IS NULL;
  END IF;

  INSERT INTO app.keyword_governance_suggestion_invocation_attempts (
    workspace_id,
    project_id,
    generation_run_id,
    ordinal,
    async_attempt_count,
    provider,
    model,
    prompt_set_version,
    input_hash,
    planned_analysis_invocation_id
  ) VALUES (
    p_workspace_id,
    p_project_id,
    p_run_id,
    next_ordinal,
    p_async_attempt_count,
    p_provider,
    p_model,
    p_prompt_set_version,
    p_input_hash,
    gen_random_uuid()
  ) RETURNING * INTO reserved_attempt;

  RETURN jsonb_build_object(
    'kind', 'reserved', 'reservation', to_jsonb(reserved_attempt)
  );
END;
$$;

CREATE OR REPLACE FUNCTION
  app.finalize_keyword_governance_suggestion_invocation_attempt(
    p_workspace_id uuid,
    p_project_id uuid,
    p_run_id uuid,
    p_async_attempt_count integer,
    p_reservation_id uuid,
    p_provider text,
    p_model text,
    p_prompt_set_version text,
    p_input_hash text,
    p_output_hash text,
    p_status text,
    p_input_tokens integer,
    p_output_tokens integer,
    p_cost_usd numeric,
    p_latency_ms integer,
    p_error_code text
  )
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  reservation
    app.keyword_governance_suggestion_invocation_attempts%ROWTYPE;
  normalized_cost numeric(12,6);
BEGIN
  PERFORM 1 FROM app.async_runs run
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'keyword_governance_suggestion_generation'
    AND run.status = 'running'
    AND run.attempt_count = p_async_attempt_count
  FOR UPDATE OF run;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_reservation');
  END IF;

  SELECT attempt.* INTO reservation
  FROM app.keyword_governance_suggestion_invocation_attempts attempt
  WHERE attempt.id = p_reservation_id
    AND attempt.workspace_id = p_workspace_id
    AND attempt.project_id = p_project_id
    AND attempt.generation_run_id = p_run_id
    AND attempt.async_attempt_count = p_async_attempt_count
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_reservation');
  END IF;

  IF p_provider IS DISTINCT FROM reservation.provider
     OR p_model IS DISTINCT FROM reservation.model
     OR p_prompt_set_version IS DISTINCT FROM reservation.prompt_set_version
     OR p_input_hash IS DISTINCT FROM reservation.input_hash
     OR p_status IS NULL OR p_status NOT IN ('succeeded', 'failed', 'rejected')
     OR p_latency_ms IS NULL OR p_latency_ms < 0
     OR (p_input_tokens IS NOT NULL AND p_input_tokens < 0)
     OR (p_output_tokens IS NOT NULL AND p_output_tokens < 0)
     OR (p_cost_usd IS NOT NULL AND (
       p_cost_usd < 0 OR round(p_cost_usd, 6) >= 1000000
     ))
     OR (p_status = 'succeeded' AND (
       p_output_hash IS NULL OR p_output_hash !~ '^[a-f0-9]{64}$'
       OR p_error_code IS NOT NULL
     ))
     OR (p_status IN ('failed', 'rejected') AND (
       p_output_hash IS NOT NULL OR p_error_code IS NULL
       OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
     ))
  THEN
    RETURN jsonb_build_object(
      'kind', 'conflict', 'reservation', to_jsonb(reservation)
    );
  END IF;
  normalized_cost := CASE WHEN p_cost_usd IS NULL THEN NULL
    ELSE round(p_cost_usd, 6) END;

  IF reservation.status IN ('succeeded', 'failed', 'rejected') THEN
    IF EXISTS (
      SELECT 1 FROM app.analysis_invocations invocation
      WHERE invocation.id = reservation.planned_analysis_invocation_id
        AND invocation.id = reservation.analysis_invocation_id
        AND invocation.workspace_id = p_workspace_id
        AND invocation.project_id = p_project_id
        AND invocation.async_run_id = p_run_id
        AND invocation.diagnostic_run_id IS NULL
        AND invocation.task =
          'keyword_governance_suggestion_generation'
        AND invocation.provider = p_provider
        AND invocation.model = p_model
        AND invocation.prompt_set_version = p_prompt_set_version
        AND invocation.input_hash = p_input_hash
        AND invocation.output_hash IS NOT DISTINCT FROM p_output_hash
        AND invocation.status = p_status
        AND invocation.input_tokens IS NOT DISTINCT FROM p_input_tokens
        AND invocation.output_tokens IS NOT DISTINCT FROM p_output_tokens
        AND invocation.cost_usd IS NOT DISTINCT FROM normalized_cost
        AND invocation.latency_ms = p_latency_ms
        AND invocation.error_code IS NOT DISTINCT FROM p_error_code
    ) THEN
      RETURN jsonb_build_object(
        'kind', 'finalized',
        'reservation', to_jsonb(reservation),
        'invocationId', reservation.analysis_invocation_id
      );
    END IF;
    RETURN jsonb_build_object(
      'kind', 'conflict', 'reservation', to_jsonb(reservation)
    );
  END IF;

  IF reservation.status IS DISTINCT FROM 'reserved'
     OR NOT EXISTS (
       SELECT 1
       FROM app.keyword_governance_suggestion_generation_runs generation_run
       WHERE generation_run.id = p_run_id
         AND generation_run.workspace_id = p_workspace_id
         AND generation_run.project_id = p_project_id
         AND generation_run.prompt_input_hash = reservation.input_hash
     )
  THEN
    RETURN jsonb_build_object(
      'kind', 'conflict', 'reservation', to_jsonb(reservation)
    );
  END IF;

  INSERT INTO app.analysis_invocations (
    id,
    workspace_id,
    project_id,
    async_run_id,
    diagnostic_run_id,
    task,
    provider,
    model,
    prompt_set_version,
    input_hash,
    output_hash,
    status,
    input_tokens,
    output_tokens,
    cost_usd,
    latency_ms,
    error_code
  ) VALUES (
    reservation.planned_analysis_invocation_id,
    p_workspace_id,
    p_project_id,
    p_run_id,
    NULL,
    'keyword_governance_suggestion_generation',
    p_provider,
    p_model,
    p_prompt_set_version,
    p_input_hash,
    p_output_hash,
    p_status,
    p_input_tokens,
    p_output_tokens,
    normalized_cost,
    p_latency_ms,
    p_error_code
  );

  UPDATE app.keyword_governance_suggestion_invocation_attempts
  SET status = p_status,
      analysis_invocation_id = planned_analysis_invocation_id,
      terminal_error_code = p_error_code,
      provider_returned_at = clock_timestamp(),
      finalized_at = clock_timestamp()
  WHERE id = p_reservation_id
  RETURNING * INTO reservation;

  RETURN jsonb_build_object(
    'kind', 'finalized',
    'reservation', to_jsonb(reservation),
    'invocationId', reservation.analysis_invocation_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION
  app.mark_keyword_governance_suggestion_invocation_outcome_unknown(
    p_workspace_id uuid,
    p_project_id uuid,
    p_run_id uuid,
    p_async_attempt_count integer,
    p_reservation_id uuid,
    p_error_code text
  )
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  reservation
    app.keyword_governance_suggestion_invocation_attempts%ROWTYPE;
BEGIN
  PERFORM 1 FROM app.async_runs run
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'keyword_governance_suggestion_generation'
    AND run.status = 'running'
    AND run.attempt_count = p_async_attempt_count
  FOR UPDATE OF run;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_reservation');
  END IF;

  SELECT attempt.* INTO reservation
  FROM app.keyword_governance_suggestion_invocation_attempts attempt
  WHERE attempt.id = p_reservation_id
    AND attempt.workspace_id = p_workspace_id
    AND attempt.project_id = p_project_id
    AND attempt.generation_run_id = p_run_id
    AND attempt.async_attempt_count = p_async_attempt_count
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_reservation');
  END IF;
  IF reservation.status IN ('succeeded', 'failed', 'rejected') THEN
    RETURN jsonb_build_object(
      'kind', 'finalized',
      'reservation', to_jsonb(reservation),
      'invocationId', reservation.analysis_invocation_id
    );
  END IF;
  IF p_error_code IS NULL
     OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$' THEN
    RETURN jsonb_build_object(
      'kind', 'conflict', 'reservation', to_jsonb(reservation)
    );
  END IF;
  IF reservation.status = 'outcome_unknown' THEN
    IF reservation.terminal_error_code = p_error_code THEN
      RETURN jsonb_build_object(
        'kind', 'marked', 'reservation', to_jsonb(reservation)
      );
    END IF;
    RETURN jsonb_build_object(
      'kind', 'conflict', 'reservation', to_jsonb(reservation)
    );
  END IF;
  IF reservation.status IS DISTINCT FROM 'reserved' THEN
    RETURN jsonb_build_object(
      'kind', 'conflict', 'reservation', to_jsonb(reservation)
    );
  END IF;
  UPDATE app.keyword_governance_suggestion_invocation_attempts
  SET status = 'outcome_unknown',
      terminal_error_code = p_error_code,
      provider_returned_at = clock_timestamp(),
      finalized_at = clock_timestamp()
  WHERE id = p_reservation_id
  RETURNING * INTO reservation;
  RETURN jsonb_build_object(
    'kind', 'marked', 'reservation', to_jsonb(reservation)
  );
END;
$$;

-- Suggestions are immutable model output until one legal terminal resolution.
-- Public generating/stale/unavailable states are read projections and are not
-- persisted as this lifecycle state.
CREATE TABLE IF NOT EXISTS app.keyword_review_suggestions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES app.workspaces(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES app.client_projects(id) ON DELETE RESTRICT,
  keyword_entity_id uuid NOT NULL
    REFERENCES app.keyword_entities(id) ON DELETE RESTRICT,
  generation_run_id uuid NOT NULL
    REFERENCES app.keyword_governance_suggestion_generation_runs(id)
    ON DELETE RESTRICT,
  output_ordinal smallint NOT NULL CHECK (output_ordinal BETWEEN 1 AND 100),
  expected_governance_revision integer NOT NULL CHECK (
    expected_governance_revision BETWEEN 0 AND 2147483646
  ),
  suggestion_version text NOT NULL CHECK (
    suggestion_version = 'keyword-governance-suggestion.v1'
  ),
  generation_version text NOT NULL CHECK (
    generation_version = 'keyword-governance-suggestion-generation.v1'
  ),
  prompt_set_version text NOT NULL CHECK (
    prompt_set_version = 'keyword-governance-suggestion.prompt.v1'
  ),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  output_hash text NOT NULL CHECK (output_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'superseded')
  ),
  suggested_status text NOT NULL CHECK (
    suggested_status IN ('candidate', 'approved', 'excluded', 'parked')
  ),
  suggested_intent text CHECK (
    suggested_intent IS NULL OR suggested_intent IN (
      'informational', 'navigational', 'commercial', 'transactional'
    )
  ),
  suggested_buyer_stage text CHECK (
    suggested_buyer_stage IS NULL OR suggested_buyer_stage IN (
      'awareness', 'consideration', 'decision', 'retention'
    )
  ),
  suggested_topic_node_id uuid
    REFERENCES app.topic_node_identities(id) ON DELETE RESTRICT,
  suggested_topic_model_revision integer CHECK (
    suggested_topic_model_revision IS NULL
    OR suggested_topic_model_revision BETWEEN 1 AND 2147483647
  ),
  suggested_mapping_decision text NOT NULL CHECK (
    suggested_mapping_decision IN (
      'unassigned', 'existing_page', 'new_asset'
    )
  ),
  suggested_mapped_site_page_id uuid
    REFERENCES app.site_pages(id) ON DELETE RESTRICT,
  suggested_reason text NOT NULL CHECK (
    length(suggested_reason) BETWEEN 3 AND 2000
    AND suggested_reason = btrim(suggested_reason)
  ),
  analysis_invocation_id uuid NOT NULL
    REFERENCES app.analysis_invocations(id) ON DELETE RESTRICT,
  intent_authority text NOT NULL CHECK (
    intent_authority IN ('provider_observed', 'llm_generated', 'unavailable')
  ),
  intent_snapshot_id uuid REFERENCES app.data_snapshots(id) ON DELETE RESTRICT,
  intent_observation_id uuid
    REFERENCES app.normalized_observations(id) ON DELETE RESTRICT,
  intent_observed_at timestamptz,
  resolution_mode text CHECK (
    resolution_mode IS NULL OR resolution_mode IN ('accepted', 'edited')
  ),
  keyword_review_decision_id uuid UNIQUE
    REFERENCES app.keyword_review_decisions(id) ON DELETE RESTRICT,
  superseded_by_suggestion_id uuid
    REFERENCES app.keyword_review_suggestions(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (generation_run_id, output_ordinal),
  UNIQUE (generation_run_id, keyword_entity_id),
  CHECK (
    (suggested_topic_node_id IS NULL) =
      (suggested_topic_model_revision IS NULL)
  ),
  CHECK (
    (suggested_mapping_decision = 'existing_page') =
      (suggested_mapped_site_page_id IS NOT NULL)
  ),
  CHECK (
    suggested_mapping_decision = 'unassigned'
    OR suggested_topic_node_id IS NOT NULL
  ),
  CHECK (
    suggested_status <> 'excluded' OR (
      suggested_topic_node_id IS NULL
      AND suggested_mapping_decision = 'unassigned'
      AND suggested_mapped_site_page_id IS NULL
    )
  ),
  CHECK (
    (intent_authority = 'provider_observed'
      AND suggested_intent IS NOT NULL
      AND intent_snapshot_id IS NOT NULL
      AND intent_observation_id IS NOT NULL
      AND intent_observed_at IS NOT NULL)
    OR
    (intent_authority = 'llm_generated'
      AND suggested_intent IS NOT NULL
      AND intent_snapshot_id IS NULL
      AND intent_observation_id IS NULL
      AND intent_observed_at IS NULL)
    OR
    (intent_authority = 'unavailable'
      AND suggested_intent IS NULL
      AND intent_snapshot_id IS NULL
      AND intent_observation_id IS NULL
      AND intent_observed_at IS NULL)
  ),
  CHECK (
    (status = 'pending'
      AND resolution_mode IS NULL
      AND keyword_review_decision_id IS NULL
      AND superseded_by_suggestion_id IS NULL
      AND resolved_at IS NULL)
    OR
    (status = 'approved'
      AND resolution_mode IS NOT NULL
      AND keyword_review_decision_id IS NOT NULL
      AND superseded_by_suggestion_id IS NULL
      AND resolved_at IS NOT NULL)
    OR
    (status = 'superseded'
      AND resolution_mode IS NULL
      AND keyword_review_decision_id IS NULL
      AND (
        superseded_by_suggestion_id IS NULL
        OR superseded_by_suggestion_id <> id
      )
      AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS keyword_review_suggestions_project_created_idx
  ON app.keyword_review_suggestions(
    workspace_id, project_id, created_at DESC, id DESC
  );
CREATE INDEX IF NOT EXISTS keyword_review_suggestions_generation_idx
  ON app.keyword_review_suggestions(generation_run_id, output_ordinal);
CREATE UNIQUE INDEX IF NOT EXISTS keyword_review_suggestions_one_pending_idx
  ON app.keyword_review_suggestions(
    workspace_id, project_id, keyword_entity_id
  ) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION app.enforce_keyword_review_suggestion_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  generation_run
    app.keyword_governance_suggestion_generation_runs%ROWTYPE;
  candidate jsonb;
  provider_intent jsonb;
  confirmed_profile jsonb;
  confirmed_topic jsonb;
  decision app.keyword_review_decisions%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Keyword review suggestions are durable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.keyword_entity_id IS DISTINCT FROM OLD.keyword_entity_id
       OR NEW.generation_run_id IS DISTINCT FROM OLD.generation_run_id
       OR NEW.output_ordinal IS DISTINCT FROM OLD.output_ordinal
       OR NEW.expected_governance_revision IS DISTINCT FROM
         OLD.expected_governance_revision
       OR NEW.suggestion_version IS DISTINCT FROM OLD.suggestion_version
       OR NEW.generation_version IS DISTINCT FROM OLD.generation_version
       OR NEW.prompt_set_version IS DISTINCT FROM OLD.prompt_set_version
       OR NEW.input_hash IS DISTINCT FROM OLD.input_hash
       OR NEW.output_hash IS DISTINCT FROM OLD.output_hash
       OR NEW.suggested_status IS DISTINCT FROM OLD.suggested_status
       OR NEW.suggested_intent IS DISTINCT FROM OLD.suggested_intent
       OR NEW.suggested_buyer_stage IS DISTINCT FROM
         OLD.suggested_buyer_stage
       OR NEW.suggested_topic_node_id IS DISTINCT FROM
         OLD.suggested_topic_node_id
       OR NEW.suggested_topic_model_revision IS DISTINCT FROM
         OLD.suggested_topic_model_revision
       OR NEW.suggested_mapping_decision IS DISTINCT FROM
         OLD.suggested_mapping_decision
       OR NEW.suggested_mapped_site_page_id IS DISTINCT FROM
         OLD.suggested_mapped_site_page_id
       OR NEW.suggested_reason IS DISTINCT FROM OLD.suggested_reason
       OR NEW.analysis_invocation_id IS DISTINCT FROM
         OLD.analysis_invocation_id
       OR NEW.intent_authority IS DISTINCT FROM OLD.intent_authority
       OR NEW.intent_snapshot_id IS DISTINCT FROM OLD.intent_snapshot_id
       OR NEW.intent_observation_id IS DISTINCT FROM
         OLD.intent_observation_id
       OR NEW.intent_observed_at IS DISTINCT FROM OLD.intent_observed_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Keyword review suggestion content is immutable'
        USING ERRCODE = '23514';
    END IF;
    IF OLD.status IS DISTINCT FROM 'pending'
       OR NEW.status NOT IN ('approved', 'superseded') THEN
      RAISE EXCEPTION 'Keyword review suggestion may transition once from pending'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'approved' THEN
      IF NEW.resolution_mode = 'accepted' THEN
        IF NEW.intent_authority = 'unavailable' THEN
          RAISE EXCEPTION 'Accepted Keyword suggestion lacks intent authority'
            USING ERRCODE = '23514',
              CONSTRAINT =
                'keyword_review_suggestion_accepted_authority_current';
        END IF;

        SELECT generation.* INTO generation_run
        FROM app.keyword_governance_suggestion_generation_runs generation
        JOIN app.async_runs run ON run.id = generation.id
        WHERE generation.id = NEW.generation_run_id
          AND generation.workspace_id = NEW.workspace_id
          AND generation.project_id = NEW.project_id
          AND generation.input_hash = NEW.input_hash
          AND generation.result_output_hash = NEW.output_hash
          AND run.workspace_id = NEW.workspace_id
          AND run.project_id = NEW.project_id
          AND run.kind = 'keyword_governance_suggestion_generation'
          AND run.status = 'completed';
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Accepted Keyword suggestion generation is not complete'
            USING ERRCODE = '23514',
              CONSTRAINT =
                'keyword_review_suggestion_accepted_authority_current';
        END IF;

        SELECT value INTO candidate
        FROM jsonb_array_elements(
          generation_run.input_manifest -> 'candidates'
        ) frozen(value)
        WHERE (value ->> 'ordinal')::integer = NEW.output_ordinal
          AND (value ->> 'keywordId')::uuid = NEW.keyword_entity_id
          AND (value ->> 'expectedGovernanceRevision')::integer =
            NEW.expected_governance_revision;
        IF NOT FOUND OR candidate #>
             '{deterministicEvidence,sourceOccurrenceIds}' IS DISTINCT FROM
             app.current_keyword_governance_suggestion_occurrence_ids(
               NEW.workspace_id,
               NEW.project_id,
               NEW.keyword_entity_id,
               candidate ->> 'displayKeyword',
               candidate ->> 'normalizedKeyword',
               generation_run.input_manifest ->> 'marketCode',
               generation_run.input_manifest ->> 'languageTag'
             ) THEN
          RAISE EXCEPTION 'Accepted Keyword suggestion occurrence authority is stale'
            USING ERRCODE = '23514',
              CONSTRAINT =
                'keyword_review_suggestion_accepted_authority_current';
        END IF;

        confirmed_profile := generation_run.input_manifest ->
          'confirmedProductProfile';
        confirmed_topic := generation_run.input_manifest ->
          'confirmedTopicModel';
        IF NOT EXISTS (
          SELECT 1
          FROM app.client_projects project
          JOIN app.icp_profiles profile
            ON profile.id = project.confirmed_icp_profile_id
           AND profile.workspace_id = project.workspace_id
           AND profile.project_id = project.id
          JOIN app.sites primary_site
            ON primary_site.workspace_id = project.workspace_id
           AND primary_site.project_id = project.id
           AND primary_site.is_primary
          WHERE project.id = NEW.project_id
            AND project.workspace_id = NEW.workspace_id
            AND project.archived_at IS NULL
            AND project.default_delivery_locale =
              generation_run.input_manifest ->> 'languageTag'
            AND generation_run.input_manifest ->> 'marketCode' =
              ANY(primary_site.market_codes)
            AND generation_run.input_manifest ->> 'languageTag' =
              ANY(primary_site.language_codes)
            AND profile.id =
              (confirmed_profile ->> 'productProfileId')::uuid
            AND profile.version =
              (confirmed_profile ->> 'version')::integer
            AND profile.status = 'complete'
            AND profile.content_hash = confirmed_profile ->> 'contentHash'
        ) OR NOT EXISTS (
          SELECT 1
          FROM app.topic_model_revisions revision
          WHERE revision.id =
              (confirmed_topic ->> 'topicModelRevisionId')::uuid
            AND revision.workspace_id = NEW.workspace_id
            AND revision.project_id = NEW.project_id
            AND revision.revision =
              (confirmed_topic ->> 'revision')::integer
            AND revision.status = 'confirmed'
            AND revision.content_hash = confirmed_topic ->> 'contentHash'
            AND NOT EXISTS (
              SELECT 1
              FROM app.topic_model_revisions newer
              WHERE newer.workspace_id = revision.workspace_id
                AND newer.project_id = revision.project_id
                AND newer.status = 'confirmed'
                AND newer.revision > revision.revision
            )
        ) THEN
          RAISE EXCEPTION 'Accepted Keyword suggestion frozen authority is stale'
            USING ERRCODE = '23514',
              CONSTRAINT =
                'keyword_review_suggestion_accepted_authority_current';
        END IF;

        IF NEW.suggested_topic_node_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM app.topic_node_revisions node
          WHERE node.workspace_id = NEW.workspace_id
            AND node.project_id = NEW.project_id
            AND node.topic_node_id = NEW.suggested_topic_node_id
            AND node.topic_model_revision =
              NEW.suggested_topic_model_revision
            AND node.lifecycle_state = 'active'
        ) THEN
          RAISE EXCEPTION 'Accepted Keyword suggestion Topic is stale'
            USING ERRCODE = '23514',
              CONSTRAINT =
                'keyword_review_suggestion_accepted_authority_current';
        END IF;
        IF NEW.suggested_mapped_site_page_id IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM app.site_pages page
          JOIN app.sites site
            ON site.id = page.site_id
           AND site.workspace_id = page.workspace_id
           AND site.project_id = page.project_id
           AND site.is_primary
          WHERE page.id = NEW.suggested_mapped_site_page_id
            AND page.workspace_id = NEW.workspace_id
            AND page.project_id = NEW.project_id
        ) THEN
          RAISE EXCEPTION 'Accepted Keyword suggestion Page is stale'
            USING ERRCODE = '23514',
              CONSTRAINT =
                'keyword_review_suggestion_accepted_authority_current';
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM app.analysis_invocations invocation
          JOIN app.keyword_governance_suggestion_invocation_attempts attempt
            ON attempt.analysis_invocation_id = invocation.id
           AND attempt.status = 'succeeded'
          WHERE invocation.id = NEW.analysis_invocation_id
            AND invocation.workspace_id = NEW.workspace_id
            AND invocation.project_id = NEW.project_id
            AND invocation.async_run_id = NEW.generation_run_id
            AND invocation.task =
              'keyword_governance_suggestion_generation'
            AND invocation.status = 'succeeded'
            AND invocation.input_hash = generation_run.prompt_input_hash
            AND invocation.output_hash = NEW.output_hash
        ) THEN
          RAISE EXCEPTION 'Accepted Keyword suggestion invocation is stale'
            USING ERRCODE = '23514',
              CONSTRAINT =
                'keyword_review_suggestion_accepted_authority_current';
        END IF;
      END IF;

      SELECT stored.* INTO decision
      FROM app.keyword_review_decisions stored
      WHERE stored.id = NEW.keyword_review_decision_id
        AND stored.workspace_id = NEW.workspace_id
        AND stored.project_id = NEW.project_id
        AND stored.keyword_entity_id = NEW.keyword_entity_id
        AND stored.governance_revision =
          NEW.expected_governance_revision + 1
        AND stored.decision_origin = 'user'
        AND stored.decided_by IS NOT NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Approved Keyword suggestion lacks an exact user decision'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.resolution_mode = 'accepted' AND (
        decision.status IS DISTINCT FROM NEW.suggested_status
        OR decision.intent IS DISTINCT FROM NEW.suggested_intent
        OR decision.buyer_stage IS DISTINCT FROM
          NEW.suggested_buyer_stage
        OR decision.topic_node_id IS DISTINCT FROM
          NEW.suggested_topic_node_id
        OR decision.topic_model_revision IS DISTINCT FROM
          NEW.suggested_topic_model_revision
        OR decision.mapping_decision IS DISTINCT FROM
          NEW.suggested_mapping_decision
        OR decision.mapped_site_page_id IS DISTINCT FROM
          NEW.suggested_mapped_site_page_id
        OR decision.reason IS DISTINCT FROM NEW.suggested_reason
        OR decision.analysis_invocation_id IS NOT NULL
      ) THEN
        RAISE EXCEPTION 'Accepted Keyword suggestion decision does not copy immutable content'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'Keyword review suggestion must begin pending'
      USING ERRCODE = '23514';
  END IF;

  SELECT generation.* INTO generation_run
  FROM app.keyword_governance_suggestion_generation_runs generation
  JOIN app.async_runs run ON run.id = generation.id
  WHERE generation.id = NEW.generation_run_id
    AND generation.workspace_id = NEW.workspace_id
    AND generation.project_id = NEW.project_id
    AND generation.generation_version = NEW.generation_version
    AND generation.prompt_set_version = NEW.prompt_set_version
    AND generation.input_hash = NEW.input_hash
    AND generation.prompt_input_hash IS NOT NULL
    AND generation.result_output_hash IS NULL
    AND run.kind = 'keyword_governance_suggestion_generation'
    AND run.status = 'running'
  FOR UPDATE OF generation, run;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Keyword review suggestion generation run is stale'
      USING ERRCODE = '23514';
  END IF;

  SELECT value INTO candidate
  FROM jsonb_array_elements(generation_run.input_manifest -> 'candidates')
  WHERE (value ->> 'ordinal')::integer = NEW.output_ordinal
    AND (value ->> 'keywordId')::uuid = NEW.keyword_entity_id
    AND (value ->> 'expectedGovernanceRevision')::integer =
      NEW.expected_governance_revision;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Keyword review suggestion does not match a frozen candidate'
      USING ERRCODE = '23514';
  END IF;

  confirmed_profile := generation_run.input_manifest ->
    'confirmedProductProfile';
  confirmed_topic := generation_run.input_manifest -> 'confirmedTopicModel';
  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    JOIN app.icp_profiles profile
      ON profile.id = project.confirmed_icp_profile_id
     AND profile.workspace_id = project.workspace_id
     AND profile.project_id = project.id
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
      AND profile.id = (confirmed_profile ->> 'productProfileId')::uuid
      AND profile.version = (confirmed_profile ->> 'version')::integer
      AND profile.status = 'complete'
      AND profile.content_hash = confirmed_profile ->> 'contentHash'
  ) OR NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions revision
    WHERE revision.id =
      (confirmed_topic ->> 'topicModelRevisionId')::uuid
      AND revision.workspace_id = NEW.workspace_id
      AND revision.project_id = NEW.project_id
      AND revision.revision = (confirmed_topic ->> 'revision')::integer
      AND revision.status = 'confirmed'
      AND revision.content_hash = confirmed_topic ->> 'contentHash'
      AND NOT EXISTS (
        SELECT 1
        FROM app.topic_model_revisions newer
        WHERE newer.workspace_id = revision.workspace_id
          AND newer.project_id = revision.project_id
          AND newer.status = 'confirmed'
          AND newer.revision > revision.revision
      )
  ) THEN
    RAISE EXCEPTION 'Keyword review suggestion frozen authorities are stale'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.keyword_entities keyword
    WHERE keyword.id = NEW.keyword_entity_id
      AND keyword.workspace_id = NEW.workspace_id
      AND keyword.project_id = NEW.project_id
      AND keyword.query_kind = 'search_query'
      AND keyword.status = 'candidate'
      AND keyword.mapping_review_state = 'unreviewed'
      AND keyword.mapping_revision = NEW.expected_governance_revision
      AND NOT EXISTS (
        SELECT 1 FROM app.keyword_review_decisions prior
        WHERE prior.workspace_id = keyword.workspace_id
          AND prior.project_id = keyword.project_id
          AND prior.keyword_entity_id = keyword.id
          AND prior.decision_origin = 'user'
      )
  ) THEN
    RAISE EXCEPTION 'Keyword review suggestion candidate is no longer eligible'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.suggested_topic_node_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      generation_run.input_manifest -> 'topicAllowlist'
    ) entry(value)
    JOIN app.topic_node_revisions node
      ON node.topic_node_id = NEW.suggested_topic_node_id
     AND node.topic_model_revision = NEW.suggested_topic_model_revision
     AND node.workspace_id = NEW.workspace_id
     AND node.project_id = NEW.project_id
     AND node.lifecycle_state = 'active'
    WHERE (entry.value ->> 'topicNodeId')::uuid =
        NEW.suggested_topic_node_id
      AND (entry.value ->> 'topicModelRevision')::integer =
        NEW.suggested_topic_model_revision
  ) THEN
    RAISE EXCEPTION 'Suggested Topic is outside the active frozen allowlist'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.suggested_mapped_site_page_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      generation_run.input_manifest -> 'pageAllowlist'
    ) entry(value)
    JOIN app.site_pages page
      ON page.id = NEW.suggested_mapped_site_page_id
     AND page.workspace_id = NEW.workspace_id
     AND page.project_id = NEW.project_id
    JOIN app.sites site
      ON site.id = page.site_id
     AND site.workspace_id = page.workspace_id
     AND site.project_id = page.project_id
     AND site.is_primary
    JOIN app.client_projects project
      ON project.id = page.project_id
     AND project.workspace_id = page.workspace_id
     AND project.archived_at IS NULL
    WHERE (entry.value ->> 'sitePageId')::uuid =
      NEW.suggested_mapped_site_page_id
  ) THEN
    RAISE EXCEPTION 'Suggested Page is outside the active frozen allowlist'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.analysis_invocations invocation
    JOIN app.keyword_governance_suggestion_invocation_attempts attempt
      ON attempt.analysis_invocation_id = invocation.id
     AND attempt.status = 'succeeded'
    WHERE invocation.id = NEW.analysis_invocation_id
      AND invocation.workspace_id = NEW.workspace_id
      AND invocation.project_id = NEW.project_id
      AND invocation.async_run_id = NEW.generation_run_id
      AND invocation.diagnostic_run_id IS NULL
      AND invocation.task =
        'keyword_governance_suggestion_generation'
      AND invocation.status = 'succeeded'
      AND invocation.prompt_set_version = NEW.prompt_set_version
      AND invocation.input_hash = generation_run.prompt_input_hash
      AND invocation.output_hash = NEW.output_hash
      AND invocation.error_code IS NULL
      AND attempt.generation_run_id = NEW.generation_run_id
      AND attempt.input_hash = generation_run.prompt_input_hash
  ) THEN
    RAISE EXCEPTION 'Keyword review suggestion lacks successful invocation lineage'
      USING ERRCODE = '23514';
  END IF;

  provider_intent := candidate #>
    '{deterministicEvidence,providerSearchIntent}';
  IF NEW.intent_authority = 'provider_observed' THEN
    IF jsonb_typeof(provider_intent) <> 'object'
       OR NEW.suggested_intent IS DISTINCT FROM provider_intent ->> 'value'
       OR NEW.intent_snapshot_id IS DISTINCT FROM
         (provider_intent ->> 'snapshotId')::uuid
       OR NEW.intent_observation_id IS DISTINCT FROM
         (provider_intent ->> 'observationId')::uuid
       OR NEW.intent_observed_at IS DISTINCT FROM
         (provider_intent ->> 'observedAt')::timestamptz
       OR NOT EXISTS (
         SELECT 1
         FROM app.normalized_observations observation
         WHERE observation.id = NEW.intent_observation_id
           AND observation.workspace_id = NEW.workspace_id
           AND observation.project_id = NEW.project_id
           AND observation.snapshot_id = NEW.intent_snapshot_id
       )
    THEN
      RAISE EXCEPTION 'Provider intent lineage does not match frozen evidence'
        USING ERRCODE = '23514';
    END IF;
  ELSIF jsonb_typeof(provider_intent) = 'object' THEN
    RAISE EXCEPTION 'Frozen provider intent cannot be downgraded'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Keyword review suggestion contains invalid lineage identities'
      USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS keyword_review_suggestions_mutation_guard
  ON app.keyword_review_suggestions;
CREATE TRIGGER keyword_review_suggestions_mutation_guard
  BEFORE INSERT OR UPDATE OR DELETE ON app.keyword_review_suggestions
  FOR EACH ROW EXECUTE FUNCTION app.enforce_keyword_review_suggestion_mutation();

-- Source membership can change while a paid generation run is in flight. The
-- occurrence trigger takes the project writer lock before the normal upsert
-- reaches mutable Keyword rows; the membership trigger also protects direct
-- append-only links. Batch insertion takes the same lock and then compares the
-- exact current occurrence-id set with the frozen manifest.
CREATE OR REPLACE FUNCTION
  app.lock_keyword_governance_suggestion_source_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || NEW.workspace_id::text || ':'
      || NEW.project_id::text,
    0
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS keyword_occurrences_suggestion_writer_lock
  ON app.keyword_occurrences;
CREATE TRIGGER keyword_occurrences_suggestion_writer_lock
  BEFORE INSERT ON app.keyword_occurrences
  FOR EACH ROW EXECUTE FUNCTION
    app.lock_keyword_governance_suggestion_source_write();

DROP TRIGGER IF EXISTS keyword_entity_sources_suggestion_writer_lock
  ON app.keyword_entity_sources;
CREATE TRIGGER keyword_entity_sources_suggestion_writer_lock
  BEFORE INSERT ON app.keyword_entity_sources
  FOR EACH ROW EXECUTE FUNCTION
    app.lock_keyword_governance_suggestion_source_write();

CREATE OR REPLACE FUNCTION
  app.supersede_keyword_review_suggestions_for_keywords(
    p_workspace_id uuid,
    p_project_id uuid,
    p_keyword_ids uuid[]
  )
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  changed integer;
BEGIN
  IF p_workspace_id IS NULL
     OR p_project_id IS NULL
     OR p_keyword_ids IS NULL
     OR cardinality(p_keyword_ids) NOT BETWEEN 1 AND 500
     OR array_position(p_keyword_ids, NULL) IS NOT NULL
     OR cardinality(p_keyword_ids) IS DISTINCT FROM (
       SELECT count(DISTINCT keyword_id)
       FROM unnest(p_keyword_ids) keyword_id
     ) THEN
    RAISE EXCEPTION 'Keyword suggestion invalidation scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || p_workspace_id::text || ':'
      || p_project_id::text,
    0
  ));
  PERFORM 1
  FROM app.client_projects project
  WHERE project.id = p_project_id
    AND project.workspace_id = p_workspace_id
    AND project.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE app.keyword_review_suggestions suggestion
  SET status = 'superseded',
      superseded_by_suggestion_id = NULL,
      resolved_at = clock_timestamp()
  WHERE suggestion.workspace_id = p_workspace_id
    AND suggestion.project_id = p_project_id
    AND suggestion.keyword_entity_id = ANY(p_keyword_ids)
    AND suggestion.status = 'pending';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

CREATE OR REPLACE FUNCTION
  app.supersede_keyword_review_suggestions_for_project(
    p_workspace_id uuid,
    p_project_id uuid
  )
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  changed integer;
BEGIN
  IF p_workspace_id IS NULL OR p_project_id IS NULL THEN
    RAISE EXCEPTION 'Keyword suggestion invalidation scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || p_workspace_id::text || ':'
      || p_project_id::text,
    0
  ));
  PERFORM 1
  FROM app.client_projects project
  WHERE project.id = p_project_id
    AND project.workspace_id = p_workspace_id
    AND project.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE app.keyword_review_suggestions suggestion
  SET status = 'superseded',
      superseded_by_suggestion_id = NULL,
      resolved_at = clock_timestamp()
  WHERE suggestion.workspace_id = p_workspace_id
    AND suggestion.project_id = p_project_id
    AND suggestion.status = 'pending';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

CREATE OR REPLACE FUNCTION app.insert_keyword_review_suggestions_batch(
  p_workspace_id uuid,
  p_project_id uuid,
  p_run_id uuid,
  p_input_hash text,
  p_output_hash text,
  p_analysis_invocation_id uuid,
  p_suggestions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  generation_run
    app.keyword_governance_suggestion_generation_runs%ROWTYPE;
  selected jsonb;
  selected_count integer;
  existing_count integer;
  selected_id uuid;
  selected_ordinal integer;
  selected_keyword_id uuid;
  selected_revision integer;
  existing app.keyword_review_suggestions%ROWTYPE;
  frozen_candidate jsonb;
  current_occurrence_ids jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'topic-governance:' || p_workspace_id::text || ':' || p_project_id::text,
    0
  ));

  PERFORM 1
  FROM app.client_projects project
  WHERE project.id = p_project_id
    AND project.workspace_id = p_workspace_id
    AND project.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale_authority');
  END IF;

  SELECT generation.* INTO generation_run
  FROM app.keyword_governance_suggestion_generation_runs generation
  JOIN app.async_runs run ON run.id = generation.id
  WHERE generation.id = p_run_id
    AND generation.workspace_id = p_workspace_id
    AND generation.project_id = p_project_id
    AND generation.input_hash = p_input_hash
    AND generation.prompt_input_hash IS NOT NULL
    AND generation.result_output_hash IS NULL
    AND run.kind = 'keyword_governance_suggestion_generation'
    AND run.status = 'running'
  FOR UPDATE OF generation, run;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.client_projects project
    JOIN app.icp_profiles profile
      ON profile.id = project.confirmed_icp_profile_id
     AND profile.workspace_id = project.workspace_id
     AND profile.project_id = project.id
    WHERE project.id = p_project_id
      AND project.workspace_id = p_workspace_id
      AND profile.id = (generation_run.input_manifest #>>
        '{confirmedProductProfile,productProfileId}')::uuid
      AND profile.version = (generation_run.input_manifest #>>
        '{confirmedProductProfile,version}')::integer
      AND profile.status = 'complete'
      AND profile.content_hash = generation_run.input_manifest #>>
        '{confirmedProductProfile,contentHash}'
  ) OR NOT EXISTS (
    SELECT 1
    FROM app.topic_model_revisions revision
    WHERE revision.id = (generation_run.input_manifest #>>
        '{confirmedTopicModel,topicModelRevisionId}')::uuid
      AND revision.workspace_id = p_workspace_id
      AND revision.project_id = p_project_id
      AND revision.revision = (generation_run.input_manifest #>>
        '{confirmedTopicModel,revision}')::integer
      AND revision.status = 'confirmed'
      AND revision.content_hash = generation_run.input_manifest #>>
        '{confirmedTopicModel,contentHash}'
      AND NOT EXISTS (
        SELECT 1
        FROM app.topic_model_revisions newer
        WHERE newer.workspace_id = revision.workspace_id
          AND newer.project_id = revision.project_id
          AND newer.status = 'confirmed'
          AND newer.revision > revision.revision
      )
  ) THEN
    RETURN jsonb_build_object('kind', 'stale_authority');
  END IF;

  IF p_output_hash IS NULL OR p_output_hash !~ '^[a-f0-9]{64}$'
     OR p_analysis_invocation_id IS NULL
     OR jsonb_typeof(p_suggestions) <> 'array'
     OR jsonb_array_length(p_suggestions) NOT BETWEEN 1 AND 100
     OR jsonb_array_length(p_suggestions) IS DISTINCT FROM
       jsonb_array_length(generation_run.input_manifest -> 'candidates')
  THEN
    RETURN jsonb_build_object('kind', 'conflict');
  END IF;
  selected_count := jsonb_array_length(p_suggestions);

  IF NOT EXISTS (
    SELECT 1
    FROM app.analysis_invocations invocation
    JOIN app.keyword_governance_suggestion_invocation_attempts attempt
      ON attempt.analysis_invocation_id = invocation.id
     AND attempt.status = 'succeeded'
    WHERE invocation.id = p_analysis_invocation_id
      AND invocation.workspace_id = p_workspace_id
      AND invocation.project_id = p_project_id
      AND invocation.async_run_id = p_run_id
      AND invocation.task =
        'keyword_governance_suggestion_generation'
      AND invocation.status = 'succeeded'
      AND invocation.input_hash = generation_run.prompt_input_hash
      AND invocation.output_hash = p_output_hash
  ) THEN
    RETURN jsonb_build_object('kind', 'conflict');
  END IF;

  FOR selected IN SELECT value FROM jsonb_array_elements(p_suggestions)
  LOOP
    IF jsonb_typeof(selected) <> 'object'
       OR NOT (selected ?& ARRAY[
         'suggestionId',
         'ordinal',
         'keywordId',
         'expectedGovernanceRevision',
         'suggestionVersion',
         'status',
         'intent',
         'buyerStage',
         'topicNodeId',
         'topicModelRevision',
         'mappingDecision',
         'mappedSitePageId',
         'reason',
         'intentAuthority',
         'intentSnapshotId',
         'intentObservationId',
         'intentObservedAt'
       ]::text[])
       OR selected - ARRAY[
         'suggestionId',
         'ordinal',
         'keywordId',
         'expectedGovernanceRevision',
         'suggestionVersion',
         'status',
         'intent',
         'buyerStage',
         'topicNodeId',
         'topicModelRevision',
         'mappingDecision',
         'mappedSitePageId',
         'reason',
         'intentAuthority',
         'intentSnapshotId',
         'intentObservationId',
         'intentObservedAt'
       ]::text[] <> '{}'::jsonb
       OR jsonb_typeof(selected -> 'suggestionId') <> 'string'
       OR jsonb_typeof(selected -> 'ordinal') <> 'number'
       OR jsonb_typeof(selected -> 'keywordId') <> 'string'
       OR jsonb_typeof(selected -> 'expectedGovernanceRevision') <> 'number'
       OR jsonb_typeof(selected -> 'suggestionVersion') <> 'string'
       OR jsonb_typeof(selected -> 'status') <> 'string'
       OR jsonb_typeof(selected -> 'intent') NOT IN ('string', 'null')
       OR jsonb_typeof(selected -> 'buyerStage') NOT IN ('string', 'null')
       OR jsonb_typeof(selected -> 'topicNodeId') NOT IN ('string', 'null')
       OR jsonb_typeof(selected -> 'topicModelRevision') NOT IN ('number', 'null')
       OR jsonb_typeof(selected -> 'mappingDecision') <> 'string'
       OR jsonb_typeof(selected -> 'mappedSitePageId') NOT IN ('string', 'null')
       OR jsonb_typeof(selected -> 'reason') <> 'string'
       OR jsonb_typeof(selected -> 'intentAuthority') <> 'string'
       OR jsonb_typeof(selected -> 'intentSnapshotId') NOT IN ('string', 'null')
       OR jsonb_typeof(selected -> 'intentObservationId') NOT IN ('string', 'null')
       OR jsonb_typeof(selected -> 'intentObservedAt') NOT IN ('string', 'null')
    THEN
      RETURN jsonb_build_object('kind', 'conflict');
    END IF;
    selected_id := (selected ->> 'suggestionId')::uuid;
    selected_ordinal := (selected ->> 'ordinal')::integer;
    selected_keyword_id := (selected ->> 'keywordId')::uuid;
    selected_revision :=
      (selected ->> 'expectedGovernanceRevision')::integer;
    IF selected_ordinal NOT BETWEEN 1 AND 100
       OR selected_revision NOT BETWEEN 0 AND 2147483646
       OR selected ->> 'suggestionVersion' IS DISTINCT FROM
         'keyword-governance-suggestion.v1'
       OR (
         selected -> 'buyerStage' <> 'null'::jsonb
         AND selected ->> 'buyerStage' NOT IN (
           'awareness', 'consideration', 'decision', 'retention'
         )
       )
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(
           generation_run.input_manifest -> 'candidates'
         ) candidate(value)
         WHERE (candidate.value ->> 'ordinal')::integer = selected_ordinal
           AND (candidate.value ->> 'keywordId')::uuid = selected_keyword_id
           AND (candidate.value ->> 'expectedGovernanceRevision')::integer =
             selected_revision
       )
    THEN
      RETURN jsonb_build_object('kind', 'conflict');
    END IF;

    SELECT candidate.value INTO frozen_candidate
    FROM jsonb_array_elements(
      generation_run.input_manifest -> 'candidates'
    ) candidate(value)
    WHERE (candidate.value ->> 'ordinal')::integer = selected_ordinal;

    IF jsonb_typeof(frozen_candidate #>
         '{deterministicEvidence,providerSearchIntent}') = 'object' THEN
      IF selected ->> 'intentAuthority' IS DISTINCT FROM 'provider_observed'
         OR selected ->> 'intent' IS DISTINCT FROM frozen_candidate #>>
           '{deterministicEvidence,providerSearchIntent,value}'
         OR selected ->> 'intentSnapshotId' IS DISTINCT FROM frozen_candidate #>>
           '{deterministicEvidence,providerSearchIntent,snapshotId}'
         OR selected ->> 'intentObservationId' IS DISTINCT FROM
           frozen_candidate #>>
             '{deterministicEvidence,providerSearchIntent,observationId}'
         OR (selected ->> 'intentObservedAt')::timestamptz IS DISTINCT FROM
           (frozen_candidate #>>
             '{deterministicEvidence,providerSearchIntent,observedAt}')::timestamptz
      THEN
        RETURN jsonb_build_object('kind', 'conflict');
      END IF;
    ELSIF selected ->> 'intentAuthority' = 'provider_observed' THEN
      RETURN jsonb_build_object('kind', 'conflict');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM app.keyword_review_decisions decision
      WHERE decision.workspace_id = p_workspace_id
        AND decision.project_id = p_project_id
        AND decision.keyword_entity_id = selected_keyword_id
        AND decision.decision_origin = 'user'
    ) THEN
      RETURN jsonb_build_object('kind', 'concurrent_human');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app.keyword_entities keyword
      WHERE keyword.id = selected_keyword_id
        AND keyword.workspace_id = p_workspace_id
        AND keyword.project_id = p_project_id
        AND keyword.query_kind = 'search_query'
        AND keyword.status = 'candidate'
        AND keyword.mapping_review_state = 'unreviewed'
        AND keyword.mapping_revision = selected_revision
        AND keyword.display_keyword = frozen_candidate ->> 'displayKeyword'
        AND keyword.normalized_keyword = frozen_candidate ->> 'normalizedKeyword'
        AND keyword.market = generation_run.input_manifest ->> 'marketCode'
        AND keyword.language_tag =
          generation_run.input_manifest ->> 'languageTag'
    ) THEN
      RETURN jsonb_build_object('kind', 'stale_authority');
    END IF;

    IF (selected ->> 'topicNodeId') IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        generation_run.input_manifest -> 'topicAllowlist'
      ) allowed(value)
      JOIN app.topic_node_revisions node
        ON node.workspace_id = p_workspace_id
       AND node.project_id = p_project_id
       AND node.topic_node_id = (selected ->> 'topicNodeId')::uuid
       AND node.topic_model_revision =
         (selected ->> 'topicModelRevision')::integer
       AND node.lifecycle_state = 'active'
      WHERE (allowed.value ->> 'topicNodeId')::uuid = node.topic_node_id
        AND (allowed.value ->> 'topicModelRevision')::integer =
          node.topic_model_revision
    ) THEN
      RETURN jsonb_build_object('kind', 'stale_authority');
    END IF;

    IF (selected ->> 'mappedSitePageId') IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        generation_run.input_manifest -> 'pageAllowlist'
      ) allowed(value)
      JOIN app.site_pages page
        ON page.id = (selected ->> 'mappedSitePageId')::uuid
       AND page.workspace_id = p_workspace_id
       AND page.project_id = p_project_id
      JOIN app.sites site
        ON site.id = page.site_id
       AND site.workspace_id = page.workspace_id
       AND site.project_id = page.project_id
       AND site.is_primary
      WHERE (allowed.value ->> 'sitePageId')::uuid = page.id
    ) THEN
      RETURN jsonb_build_object('kind', 'stale_authority');
    END IF;

    current_occurrence_ids :=
      app.current_keyword_governance_suggestion_occurrence_ids(
        p_workspace_id,
        p_project_id,
        selected_keyword_id,
        frozen_candidate ->> 'displayKeyword',
        frozen_candidate ->> 'normalizedKeyword',
        generation_run.input_manifest ->> 'marketCode',
        generation_run.input_manifest ->> 'languageTag'
      );
    IF current_occurrence_ids IS DISTINCT FROM (
      SELECT coalesce(jsonb_agg(value::uuid ORDER BY value::uuid), '[]'::jsonb)
      FROM jsonb_array_elements_text(
        frozen_candidate #> '{deterministicEvidence,sourceOccurrenceIds}'
      ) occurrence_id(value)
    ) THEN
      RETURN jsonb_build_object('kind', 'stale_authority');
    END IF;
  END LOOP;

  IF (
    SELECT count(DISTINCT value ->> 'suggestionId')
    FROM jsonb_array_elements(p_suggestions)
  ) <> selected_count OR (
    SELECT count(DISTINCT value ->> 'keywordId')
    FROM jsonb_array_elements(p_suggestions)
  ) <> selected_count OR (
    SELECT count(DISTINCT value ->> 'ordinal')
    FROM jsonb_array_elements(p_suggestions)
  ) <> selected_count THEN
    RETURN jsonb_build_object('kind', 'conflict');
  END IF;

  SELECT count(*)::integer INTO existing_count
  FROM app.keyword_review_suggestions suggestion
  WHERE suggestion.generation_run_id = p_run_id;

  IF existing_count > 0 THEN
    IF existing_count IS DISTINCT FROM selected_count THEN
      RETURN jsonb_build_object('kind', 'conflict');
    END IF;
    FOR selected IN SELECT value FROM jsonb_array_elements(p_suggestions)
    LOOP
      SELECT suggestion.* INTO existing
      FROM app.keyword_review_suggestions suggestion
      WHERE suggestion.id = (selected ->> 'suggestionId')::uuid
        AND suggestion.workspace_id = p_workspace_id
        AND suggestion.project_id = p_project_id
        AND suggestion.generation_run_id = p_run_id
        AND suggestion.output_ordinal = (selected ->> 'ordinal')::integer
        AND suggestion.keyword_entity_id = (selected ->> 'keywordId')::uuid
        AND suggestion.expected_governance_revision =
          (selected ->> 'expectedGovernanceRevision')::integer
        AND suggestion.suggestion_version = selected ->> 'suggestionVersion'
        AND suggestion.input_hash = p_input_hash
        AND suggestion.output_hash = p_output_hash
        AND suggestion.analysis_invocation_id = p_analysis_invocation_id
        AND suggestion.suggested_status = selected ->> 'status'
        AND suggestion.suggested_intent IS NOT DISTINCT FROM
          selected ->> 'intent'
        AND suggestion.suggested_buyer_stage IS NOT DISTINCT FROM
          selected ->> 'buyerStage'
        AND suggestion.suggested_topic_node_id IS NOT DISTINCT FROM
          (selected ->> 'topicNodeId')::uuid
        AND suggestion.suggested_topic_model_revision IS NOT DISTINCT FROM
          (selected ->> 'topicModelRevision')::integer
        AND suggestion.suggested_mapping_decision =
          selected ->> 'mappingDecision'
        AND suggestion.suggested_mapped_site_page_id IS NOT DISTINCT FROM
          (selected ->> 'mappedSitePageId')::uuid
        AND suggestion.suggested_reason = selected ->> 'reason'
        AND suggestion.intent_authority = selected ->> 'intentAuthority'
        AND suggestion.intent_snapshot_id IS NOT DISTINCT FROM
          (selected ->> 'intentSnapshotId')::uuid
        AND suggestion.intent_observation_id IS NOT DISTINCT FROM
          (selected ->> 'intentObservationId')::uuid
        AND suggestion.intent_observed_at IS NOT DISTINCT FROM
          (selected ->> 'intentObservedAt')::timestamptz;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('kind', 'conflict');
      END IF;
    END LOOP;
    RETURN jsonb_build_object(
      'kind', 'replayed',
      'suggestions', (
        SELECT jsonb_agg(to_jsonb(suggestion) ORDER BY suggestion.output_ordinal)
        FROM app.keyword_review_suggestions suggestion
        WHERE suggestion.generation_run_id = p_run_id
      )
    );
  END IF;

  FOR selected IN SELECT value FROM jsonb_array_elements(p_suggestions)
  LOOP
    UPDATE app.keyword_review_suggestions previous
    SET status = 'superseded',
        superseded_by_suggestion_id =
          (selected ->> 'suggestionId')::uuid,
        resolved_at = clock_timestamp()
    WHERE previous.workspace_id = p_workspace_id
      AND previous.project_id = p_project_id
      AND previous.keyword_entity_id = (selected ->> 'keywordId')::uuid
      AND previous.status = 'pending';
  END LOOP;

  FOR selected IN SELECT value FROM jsonb_array_elements(p_suggestions)
  LOOP
    INSERT INTO app.keyword_review_suggestions (
      id,
      workspace_id,
      project_id,
      keyword_entity_id,
      generation_run_id,
      output_ordinal,
      expected_governance_revision,
      suggestion_version,
      generation_version,
      prompt_set_version,
      input_hash,
      output_hash,
      suggested_status,
      suggested_intent,
      suggested_buyer_stage,
      suggested_topic_node_id,
      suggested_topic_model_revision,
      suggested_mapping_decision,
      suggested_mapped_site_page_id,
      suggested_reason,
      analysis_invocation_id,
      intent_authority,
      intent_snapshot_id,
      intent_observation_id,
      intent_observed_at
    ) VALUES (
      (selected ->> 'suggestionId')::uuid,
      p_workspace_id,
      p_project_id,
      (selected ->> 'keywordId')::uuid,
      p_run_id,
      (selected ->> 'ordinal')::integer,
      (selected ->> 'expectedGovernanceRevision')::integer,
      selected ->> 'suggestionVersion',
      generation_run.generation_version,
      generation_run.prompt_set_version,
      p_input_hash,
      p_output_hash,
      selected ->> 'status',
      selected ->> 'intent',
      selected ->> 'buyerStage',
      (selected ->> 'topicNodeId')::uuid,
      (selected ->> 'topicModelRevision')::integer,
      selected ->> 'mappingDecision',
      (selected ->> 'mappedSitePageId')::uuid,
      selected ->> 'reason',
      p_analysis_invocation_id,
      selected ->> 'intentAuthority',
      (selected ->> 'intentSnapshotId')::uuid,
      (selected ->> 'intentObservationId')::uuid,
      (selected ->> 'intentObservedAt')::timestamptz
    );
  END LOOP;

  RETURN jsonb_build_object(
    'kind', 'inserted',
    'suggestions', (
      SELECT jsonb_agg(to_jsonb(suggestion) ORDER BY suggestion.output_ordinal)
      FROM app.keyword_review_suggestions suggestion
      WHERE suggestion.generation_run_id = p_run_id
    )
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('kind', 'conflict');
END;
$$;

CREATE OR REPLACE FUNCTION
  app.terminalize_keyword_governance_suggestion_generation_run(
    p_workspace_id uuid,
    p_project_id uuid,
    p_run_id uuid,
    p_async_attempt_count integer,
    p_status text,
    p_result_output_hash text,
    p_last_error_code text,
    p_last_error_summary text
  )
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  generation_run
    app.keyword_governance_suggestion_generation_runs%ROWTYPE;
  current_run app.async_runs%ROWTYPE;
  candidate_count integer;
  suggestion_count integer;
BEGIN
  SELECT run.* INTO current_run
  FROM app.async_runs run
  WHERE run.id = p_run_id
    AND run.workspace_id = p_workspace_id
    AND run.project_id = p_project_id
    AND run.kind = 'keyword_governance_suggestion_generation'
  FOR UPDATE;
  IF NOT FOUND OR current_run.status <> 'running'
     OR current_run.attempt_count <> p_async_attempt_count THEN
    IF FOUND AND current_run.status = p_status THEN
      SELECT generation.* INTO generation_run
      FROM app.keyword_governance_suggestion_generation_runs generation
      WHERE generation.id = p_run_id
        AND generation.workspace_id = p_workspace_id
        AND generation.project_id = p_project_id;
      IF FOUND AND generation_run.result_output_hash IS NOT DISTINCT FROM
           p_result_output_hash
         AND current_run.last_error_code IS NOT DISTINCT FROM p_last_error_code
         AND current_run.last_error_summary IS NOT DISTINCT FROM
           p_last_error_summary THEN
        RETURN jsonb_build_object(
          'kind', 'terminalized', 'run', to_jsonb(generation_run)
        );
      END IF;
    END IF;
    RETURN jsonb_build_object('kind', 'stale');
  END IF;

  SELECT generation.* INTO generation_run
  FROM app.keyword_governance_suggestion_generation_runs generation
  WHERE generation.id = p_run_id
    AND generation.workspace_id = p_workspace_id
    AND generation.project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'conflict', 'run', NULL);
  END IF;

  candidate_count := jsonb_array_length(
    generation_run.input_manifest -> 'candidates'
  );
  SELECT count(*)::integer INTO suggestion_count
  FROM app.keyword_review_suggestions suggestion
  WHERE suggestion.generation_run_id = p_run_id;

  IF p_status = 'completed' THEN
    IF p_result_output_hash IS NULL
       OR p_result_output_hash !~ '^[a-f0-9]{64}$'
       OR p_last_error_code IS NOT NULL
       OR p_last_error_summary IS NOT NULL
       OR generation_run.prompt_input_hash IS NULL
       OR suggestion_count IS DISTINCT FROM candidate_count
       OR EXISTS (
         SELECT 1
         FROM app.keyword_review_suggestions suggestion
         WHERE suggestion.generation_run_id = p_run_id
       AND (
         suggestion.input_hash <> generation_run.input_hash
         OR suggestion.output_hash <> p_result_output_hash
       )
       )
       OR NOT EXISTS (
         SELECT 1
         FROM app.analysis_invocations invocation
         JOIN app.keyword_governance_suggestion_invocation_attempts attempt
           ON attempt.analysis_invocation_id = invocation.id
          AND attempt.status = 'succeeded'
         WHERE invocation.workspace_id = p_workspace_id
           AND invocation.project_id = p_project_id
           AND invocation.async_run_id = p_run_id
           AND invocation.task =
             'keyword_governance_suggestion_generation'
           AND invocation.status = 'succeeded'
           AND invocation.input_hash = generation_run.prompt_input_hash
           AND invocation.output_hash = p_result_output_hash
       )
    THEN
      RETURN jsonb_build_object(
        'kind', 'conflict', 'run', to_jsonb(generation_run)
      );
    END IF;
  ELSIF p_status IN ('failed', 'cancelled') THEN
    IF p_result_output_hash IS NOT NULL
       OR p_last_error_code IS NULL
       OR p_last_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
       OR p_last_error_summary IS NULL
       OR length(p_last_error_summary) NOT BETWEEN 1 AND 2000
       OR p_last_error_summary <> btrim(p_last_error_summary)
       OR suggestion_count <> 0 THEN
      RETURN jsonb_build_object(
        'kind', 'conflict', 'run', to_jsonb(generation_run)
      );
    END IF;
  ELSE
    RETURN jsonb_build_object(
      'kind', 'conflict', 'run', to_jsonb(generation_run)
    );
  END IF;

  IF p_status = 'completed' THEN
    UPDATE app.keyword_governance_suggestion_generation_runs
    SET result_output_hash = p_result_output_hash
    WHERE id = p_run_id
      AND result_output_hash IS NULL
    RETURNING * INTO generation_run;
  END IF;

  UPDATE app.async_runs
  SET status = p_status,
      completed_at = clock_timestamp(),
      last_error_code = p_last_error_code,
      last_error_summary = p_last_error_summary
  WHERE id = p_run_id
    AND workspace_id = p_workspace_id
    AND project_id = p_project_id
    AND status = 'running'
    AND attempt_count = p_async_attempt_count;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'stale');
  END IF;
  RETURN jsonb_build_object(
    'kind', 'terminalized', 'run', to_jsonb(generation_run)
  );
END;
$$;

REVOKE ALL ON app.keyword_review_suggestions FROM PUBLIC;
REVOKE ALL ON app.keyword_governance_suggestion_generation_runs FROM PUBLIC;
REVOKE ALL ON app.keyword_governance_suggestion_invocation_attempts FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.insert_keyword_review_suggestions_batch(
    uuid, uuid, uuid, text, text, uuid, jsonb
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.reserve_keyword_governance_suggestion_invocation_attempt(
    uuid, uuid, uuid, integer, text, text, text, text
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.finalize_keyword_governance_suggestion_invocation_attempt(
    uuid, uuid, uuid, integer, uuid, text, text, text, text, text,
    text, integer, integer, numeric, integer, text
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.mark_keyword_governance_suggestion_invocation_outcome_unknown(
    uuid, uuid, uuid, integer, uuid, text
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.terminalize_keyword_governance_suggestion_generation_run(
    uuid, uuid, uuid, integer, text, text, text, text
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.current_keyword_governance_suggestion_occurrence_ids(
    uuid, uuid, uuid, text, text, text, text
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.lock_keyword_governance_suggestion_source_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.supersede_keyword_review_suggestions_for_keywords(
    uuid, uuid, uuid[]
  ) FROM PUBLIC;
REVOKE ALL ON FUNCTION
  app.supersede_keyword_review_suggestions_for_project(uuid, uuid)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON app.keyword_review_suggestions FROM anon';
    EXECUTE 'REVOKE ALL ON app.keyword_governance_suggestion_generation_runs FROM anon';
    EXECUTE 'REVOKE ALL ON app.keyword_governance_suggestion_invocation_attempts FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.insert_keyword_review_suggestions_batch(uuid, uuid, uuid, text, text, uuid, jsonb) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.reserve_keyword_governance_suggestion_invocation_attempt(uuid, uuid, uuid, integer, text, text, text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.finalize_keyword_governance_suggestion_invocation_attempt(uuid, uuid, uuid, integer, uuid, text, text, text, text, text, text, integer, integer, numeric, integer, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.mark_keyword_governance_suggestion_invocation_outcome_unknown(uuid, uuid, uuid, integer, uuid, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.terminalize_keyword_governance_suggestion_generation_run(uuid, uuid, uuid, integer, text, text, text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.current_keyword_governance_suggestion_occurrence_ids(uuid, uuid, uuid, text, text, text, text) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.lock_keyword_governance_suggestion_source_write() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.supersede_keyword_review_suggestions_for_keywords(uuid, uuid, uuid[]) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION app.supersede_keyword_review_suggestions_for_project(uuid, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON app.keyword_review_suggestions FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.keyword_governance_suggestion_generation_runs FROM authenticated';
    EXECUTE 'REVOKE ALL ON app.keyword_governance_suggestion_invocation_attempts FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.insert_keyword_review_suggestions_batch(uuid, uuid, uuid, text, text, uuid, jsonb) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.reserve_keyword_governance_suggestion_invocation_attempt(uuid, uuid, uuid, integer, text, text, text, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.finalize_keyword_governance_suggestion_invocation_attempt(uuid, uuid, uuid, integer, uuid, text, text, text, text, text, text, integer, integer, numeric, integer, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.mark_keyword_governance_suggestion_invocation_outcome_unknown(uuid, uuid, uuid, integer, uuid, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.terminalize_keyword_governance_suggestion_generation_run(uuid, uuid, uuid, integer, text, text, text, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.current_keyword_governance_suggestion_occurrence_ids(uuid, uuid, uuid, text, text, text, text) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.lock_keyword_governance_suggestion_source_write() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.supersede_keyword_review_suggestions_for_keywords(uuid, uuid, uuid[]) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION app.supersede_keyword_review_suggestions_for_project(uuid, uuid) FROM authenticated';
  END IF;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0051_keyword_review_suggestions'::text AS migration_version;

COMMIT;
