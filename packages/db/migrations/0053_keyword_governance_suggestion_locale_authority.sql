BEGIN;

-- Keyword governance suggestions use the sole primary Site language as frozen
-- Keyword authority. Project delivery locale controls customer-facing delivery
-- and report copy only; changing it cannot invalidate a paid suggestion.
--
-- 0051/0052 are already deployed history. Replace their database routines
-- forward-only so direct writes, the final TxB batch CAS, approval, and the
-- bounded stale sweep all require one primary Site language whose stored
-- spelling has case-only BCP-47 identity with the app-canonical manifest and
-- Keyword tag. The SQL identity helper is not a BCP-47 canonicalizer: actual
-- canonicalization belongs to the server-owned freezer, which rejects a Site
-- tag when Intl canonicalization changes its lowercase identity. Database
-- gates then compare current authority with that trusted frozen identity.

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
            AND cardinality(primary_site.language_codes) = 1
            AND generation_run.input_manifest ->> 'marketCode' =
              ANY(primary_site.market_codes)
            AND app.is_bcp47_canonical_identity(
              primary_site.language_codes[1],
              generation_run.input_manifest ->> 'languageTag'
            )
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
    JOIN app.sites primary_site
      ON primary_site.workspace_id = project.workspace_id
     AND primary_site.project_id = project.id
     AND primary_site.is_primary
    WHERE project.id = NEW.project_id
      AND project.workspace_id = NEW.workspace_id
      AND project.archived_at IS NULL
      AND cardinality(primary_site.language_codes) = 1
      AND generation_run.input_manifest ->> 'marketCode' =
        ANY(primary_site.market_codes)
      AND app.is_bcp47_canonical_identity(
        primary_site.language_codes[1],
        generation_run.input_manifest ->> 'languageTag'
      )
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
    JOIN app.sites primary_site
      ON primary_site.workspace_id = project.workspace_id
     AND primary_site.project_id = project.id
     AND primary_site.is_primary
    WHERE project.id = p_project_id
      AND project.workspace_id = p_workspace_id
      AND project.archived_at IS NULL
      AND cardinality(primary_site.language_codes) = 1
      AND generation_run.input_manifest ->> 'marketCode' =
        ANY(primary_site.market_codes)
      AND app.is_bcp47_canonical_identity(
        primary_site.language_codes[1],
        generation_run.input_manifest ->> 'languageTag'
      )
      AND profile.id = (generation_run.input_manifest #>>
        '{confirmedProductProfile,productProfileId}')::uuid
      AND profile.version = (generation_run.input_manifest #>>
        '{confirmedProductProfile,version}')::integer
      AND profile.status = 'complete'
      AND profile.content_hash = generation_run.input_manifest #>>
        '{confirmedProductProfile,contentHash}'
      AND (
        SELECT count(*)
        FROM jsonb_array_elements(profile.profile -> 'targetMarkets')
          market(value)
        WHERE market.value ->> 'priority' = 'primary'
      ) = 1
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(profile.profile -> 'targetMarkets')
          market(value)
        WHERE market.value ->> 'priority' = 'primary'
          AND market.value ->> 'marketCode' =
            generation_run.input_manifest ->> 'marketCode'
      )
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
  app.supersede_stale_pending_keyword_review_suggestions(
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
      USING ERRCODE = '23514',
        CONSTRAINT =
          'supersede_stale_pending_keyword_review_suggestions_scope_ck';
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

  WITH locked_project AS MATERIALIZED (
    SELECT project.id,
      project.workspace_id,
      project.confirmed_icp_profile_id
    FROM app.client_projects project
    WHERE project.id = p_project_id
      AND project.workspace_id = p_workspace_id
      AND project.archived_at IS NULL
  ), pending_authority AS MATERIALIZED (
    SELECT suggestion.id,
      (
        generation.input_hash = suggestion.input_hash
        AND generation.prompt_input_hash IS NOT NULL
        AND generation.result_output_hash = suggestion.output_hash
        AND generation.generation_version = suggestion.generation_version
        AND generation.prompt_set_version = suggestion.prompt_set_version
        AND run.kind = 'keyword_governance_suggestion_generation'
        AND run.result_type =
          'keyword_governance_suggestion_generation_run'
        AND run.result_id = generation.id
        AND run.status = 'completed'
        AND EXISTS (
          SELECT 1
          FROM app.icp_profiles profile
          INNER JOIN app.sites primary_site
            ON primary_site.workspace_id = locked_project.workspace_id
           AND primary_site.project_id = locked_project.id
           AND primary_site.is_primary
           AND cardinality(primary_site.language_codes) = 1
           AND generation.input_manifest ->> 'marketCode' =
             ANY(primary_site.market_codes)
           AND app.is_bcp47_canonical_identity(
             primary_site.language_codes[1],
             generation.input_manifest ->> 'languageTag'
           )
          WHERE profile.id = locked_project.confirmed_icp_profile_id
            AND profile.workspace_id = locked_project.workspace_id
            AND profile.project_id = locked_project.id
            AND profile.status = 'complete'
            AND profile.id = (generation.input_manifest #>>
              '{confirmedProductProfile,productProfileId}')::uuid
            AND profile.version = (generation.input_manifest #>>
              '{confirmedProductProfile,version}')::integer
            AND profile.content_hash = generation.input_manifest #>>
              '{confirmedProductProfile,contentHash}'
            AND (
              SELECT count(*)
              FROM jsonb_array_elements(profile.profile -> 'targetMarkets')
                market(value)
              WHERE market.value ->> 'priority' = 'primary'
            ) = 1
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(profile.profile -> 'targetMarkets')
                market(value)
              WHERE market.value ->> 'priority' = 'primary'
                AND market.value ->> 'marketCode' =
                  generation.input_manifest ->> 'marketCode'
            )
        )
        AND EXISTS (
          SELECT 1
          FROM app.topic_model_revisions topic_model
          WHERE topic_model.id = (generation.input_manifest #>>
              '{confirmedTopicModel,topicModelRevisionId}')::uuid
            AND topic_model.workspace_id = suggestion.workspace_id
            AND topic_model.project_id = suggestion.project_id
            AND topic_model.revision = (generation.input_manifest #>>
              '{confirmedTopicModel,revision}')::integer
            AND topic_model.status = 'confirmed'
            AND topic_model.content_hash = generation.input_manifest #>>
              '{confirmedTopicModel,contentHash}'
            AND NOT EXISTS (
              SELECT 1
              FROM app.topic_model_revisions newer_topic
              WHERE newer_topic.workspace_id = topic_model.workspace_id
                AND newer_topic.project_id = topic_model.project_id
                AND newer_topic.status = 'confirmed'
                AND newer_topic.revision > topic_model.revision
            )
        )
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            generation.input_manifest -> 'candidates'
          ) frozen(value)
          INNER JOIN app.keyword_entities keyword
            ON keyword.id = suggestion.keyword_entity_id
           AND keyword.workspace_id = suggestion.workspace_id
           AND keyword.project_id = suggestion.project_id
          INNER JOIN app.keyword_review_decisions current_decision
            ON current_decision.workspace_id = keyword.workspace_id
           AND current_decision.project_id = keyword.project_id
           AND current_decision.keyword_entity_id = keyword.id
           AND current_decision.governance_revision = keyword.mapping_revision
           AND current_decision.status = keyword.status
           AND current_decision.intent IS NOT DISTINCT FROM keyword.intent
           AND current_decision.buyer_stage IS NOT DISTINCT FROM
             keyword.buyer_stage
           AND current_decision.mapping_decision = keyword.mapping_decision
           AND current_decision.mapped_site_page_id IS NOT DISTINCT FROM
             keyword.mapped_site_page_id
           AND current_decision.review_state = keyword.mapping_review_state
          WHERE (frozen.value ->> 'ordinal')::integer =
              suggestion.output_ordinal
            AND (frozen.value ->> 'keywordId')::uuid =
              suggestion.keyword_entity_id
            AND (frozen.value ->> 'expectedGovernanceRevision')::integer =
              suggestion.expected_governance_revision
            AND keyword.mapping_revision =
              suggestion.expected_governance_revision
            AND keyword.query_kind = 'search_query'
            AND keyword.status = 'candidate'
            AND keyword.mapping_review_state = 'unreviewed'
            AND keyword.display_keyword =
              frozen.value ->> 'displayKeyword'
            AND keyword.normalized_keyword =
              frozen.value ->> 'normalizedKeyword'
            AND keyword.market = generation.input_manifest ->> 'marketCode'
            AND keyword.language_tag =
              generation.input_manifest ->> 'languageTag'
            AND NOT EXISTS (
              SELECT 1
              FROM app.keyword_review_decisions decision
              WHERE decision.workspace_id = suggestion.workspace_id
                AND decision.project_id = suggestion.project_id
                AND decision.keyword_entity_id = suggestion.keyword_entity_id
                AND decision.decision_origin = 'user'
            )
            AND (
              (
                frozen.value #>>
                  '{deterministicEvidence,currentTopicKey}' IS NULL
                AND current_decision.topic_node_id IS NULL
              )
              OR (
                frozen.value #>>
                  '{deterministicEvidence,currentTopicKey}' IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(
                    generation.input_manifest -> 'topicAllowlist'
                  ) allowed_topic(value)
                  INNER JOIN app.topic_node_revisions current_topic
                    ON current_topic.workspace_id = keyword.workspace_id
                   AND current_topic.project_id = keyword.project_id
                   AND current_topic.topic_node_id =
                     (allowed_topic.value ->> 'topicNodeId')::uuid
                   AND current_topic.topic_model_revision =
                     (generation.input_manifest #>>
                       '{confirmedTopicModel,revision}')::integer
                   AND current_topic.lifecycle_state = 'active'
                  WHERE allowed_topic.value ->> 'topicKey' =
                    frozen.value #>>
                      '{deterministicEvidence,currentTopicKey}'
                    AND current_decision.topic_node_id =
                      current_topic.topic_node_id
                    AND current_decision.topic_model_revision =
                      current_topic.topic_model_revision
                )
              )
            )
            AND (
              (
                frozen.value #>>
                  '{deterministicEvidence,currentPageKey}' IS NULL
                AND keyword.mapped_site_page_id IS NULL
              )
              OR (
                frozen.value #>>
                  '{deterministicEvidence,currentPageKey}' IS NOT NULL
                AND EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(
                    generation.input_manifest -> 'pageAllowlist'
                  ) allowed_page(value)
                  INNER JOIN app.site_pages current_page
                    ON current_page.id =
                      (allowed_page.value ->> 'sitePageId')::uuid
                   AND current_page.workspace_id = keyword.workspace_id
                   AND current_page.project_id = keyword.project_id
                  INNER JOIN app.sites current_site
                    ON current_site.id = current_page.site_id
                   AND current_site.workspace_id = current_page.workspace_id
                   AND current_site.project_id = current_page.project_id
                   AND current_site.is_primary
                  WHERE allowed_page.value ->> 'pageKey' =
                    frozen.value #>>
                      '{deterministicEvidence,currentPageKey}'
                    AND keyword.mapped_site_page_id = current_page.id
                )
              )
            )
            AND app.current_keyword_governance_suggestion_occurrence_ids(
              suggestion.workspace_id,
              suggestion.project_id,
              suggestion.keyword_entity_id,
              frozen.value ->> 'displayKeyword',
              frozen.value ->> 'normalizedKeyword',
              generation.input_manifest ->> 'marketCode',
              generation.input_manifest ->> 'languageTag'
            ) IS NOT DISTINCT FROM (
              SELECT coalesce(
                jsonb_agg(value::uuid ORDER BY value::uuid),
                '[]'::jsonb
              )
              FROM jsonb_array_elements_text(
                frozen.value #>
                  '{deterministicEvidence,sourceOccurrenceIds}'
              ) occurrence_id(value)
            )
        )
        AND (
          suggestion.suggested_topic_node_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM app.topic_node_revisions suggested_topic
            WHERE suggested_topic.workspace_id = suggestion.workspace_id
              AND suggested_topic.project_id = suggestion.project_id
              AND suggested_topic.topic_node_id =
                suggestion.suggested_topic_node_id
              AND suggested_topic.topic_model_revision =
                suggestion.suggested_topic_model_revision
              AND suggested_topic.lifecycle_state = 'active'
          )
        )
        AND (
          suggestion.suggested_mapped_site_page_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM app.site_pages suggested_page
            INNER JOIN app.sites suggested_site
              ON suggested_site.id = suggested_page.site_id
             AND suggested_site.workspace_id = suggested_page.workspace_id
             AND suggested_site.project_id = suggested_page.project_id
             AND suggested_site.is_primary
            WHERE suggested_page.id =
                suggestion.suggested_mapped_site_page_id
              AND suggested_page.workspace_id = suggestion.workspace_id
              AND suggested_page.project_id = suggestion.project_id
          )
        )
        AND EXISTS (
          SELECT 1
          FROM app.analysis_invocations invocation
          INNER JOIN
            app.keyword_governance_suggestion_invocation_attempts attempt
            ON attempt.analysis_invocation_id = invocation.id
           AND attempt.status = 'succeeded'
          WHERE invocation.id = suggestion.analysis_invocation_id
            AND invocation.workspace_id = suggestion.workspace_id
            AND invocation.project_id = suggestion.project_id
            AND invocation.async_run_id = suggestion.generation_run_id
            AND invocation.task =
              'keyword_governance_suggestion_generation'
            AND invocation.status = 'succeeded'
            AND invocation.input_hash = generation.prompt_input_hash
            AND invocation.output_hash = suggestion.output_hash
        )
      ) AS authority_current
    FROM app.keyword_review_suggestions suggestion
    INNER JOIN app.keyword_governance_suggestion_generation_runs generation
      ON generation.id = suggestion.generation_run_id
     AND generation.workspace_id = suggestion.workspace_id
     AND generation.project_id = suggestion.project_id
    INNER JOIN app.async_runs run ON run.id = generation.id
    CROSS JOIN locked_project
    WHERE suggestion.workspace_id = p_workspace_id
      AND suggestion.project_id = p_project_id
      AND suggestion.status = 'pending'
  ), stale_pending AS MATERIALIZED (
    SELECT pending_authority.id
    FROM pending_authority
    WHERE pending_authority.authority_current IS NOT TRUE
    ORDER BY pending_authority.id
    LIMIT 100
  )
  UPDATE app.keyword_review_suggestions suggestion
  SET status = 'superseded',
      superseded_by_suggestion_id = NULL,
      resolved_at = clock_timestamp()
  FROM stale_pending
  WHERE suggestion.id = stale_pending.id
    AND suggestion.status = 'pending';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0053_keyword_governance_suggestion_locale_authority'::text
    AS migration_version;

COMMIT;
