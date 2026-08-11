\set ON_ERROR_STOP on

BEGIN;

-- Application connections do not opt into the app schema. Prove both digest
-- overloads resolve through the ordinary runtime path before the fixture
-- narrows its own path to app/public.
SET LOCAL search_path = "$user", public;
DO $pgcrypto_runtime$
BEGIN
  IF encode(
    digest(
      convert_to('signalframe-pgcrypto-compat', 'UTF8'),
      'sha256'
    ),
    'hex'
  ) IS DISTINCT FROM
    '6bc55c2be22e768cdca86865ec8f910f2d81e10ffdea5fb3a4610240b52473ae'
  THEN
    RAISE EXCEPTION 'digest(bytea,text) is unavailable on the runtime search path';
  END IF;
  IF encode(
    digest('signalframe-pgcrypto-compat'::text, 'sha256'),
    'hex'
  ) IS DISTINCT FROM
    '6bc55c2be22e768cdca86865ec8f910f2d81e10ffdea5fb3a4610240b52473ae'
  THEN
    RAISE EXCEPTION 'digest(text,text) is unavailable on the runtime search path';
  END IF;
END;
$pgcrypto_runtime$;

SET LOCAL search_path = app, public;

DO $pgcrypto_contract$
DECLARE
  pgcrypto_extension_oid oid;
  pgcrypto_namespace_oid oid;
  pgcrypto_schema name;
  extension_digest_count integer;
BEGIN
  SELECT
    extension_row.oid,
    extension_namespace.oid,
    extension_namespace.nspname
  INTO
    pgcrypto_extension_oid,
    pgcrypto_namespace_oid,
    pgcrypto_schema
  FROM pg_catalog.pg_extension extension_row
  JOIN pg_catalog.pg_namespace extension_namespace
    ON extension_namespace.oid = extension_row.extnamespace
  WHERE extension_row.extname = 'pgcrypto';

  SELECT count(*)
  INTO extension_digest_count
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_depend dependency
    ON dependency.classid =
         'pg_catalog.pg_proc'::pg_catalog.regclass
   AND dependency.objid = procedure.oid
   AND dependency.refclassid =
         'pg_catalog.pg_extension'::pg_catalog.regclass
   AND dependency.refobjid = pgcrypto_extension_oid
   AND dependency.deptype = 'e'
  WHERE procedure.pronamespace = pgcrypto_namespace_oid
    AND procedure.oid IN (
      pg_catalog.to_regprocedure(
        pg_catalog.format('%I.digest(bytea,text)', pgcrypto_schema)
      ),
      pg_catalog.to_regprocedure(
        pg_catalog.format('%I.digest(text,text)', pgcrypto_schema)
      )
    );

  IF extension_digest_count <> 2 THEN
    RAISE EXCEPTION 'pgcrypto extension digest overloads are incomplete';
  END IF;

  IF pgcrypto_schema = 'extensions' THEN
    IF (
      SELECT count(*)
      FROM pg_catalog.pg_proc procedure
      JOIN pg_catalog.pg_namespace procedure_namespace
        ON procedure_namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_language procedure_language
        ON procedure_language.oid = procedure.prolang
      WHERE procedure_namespace.nspname = 'public'
        AND procedure.proname = 'digest'
        AND procedure.oid IN (
          pg_catalog.to_regprocedure('public.digest(bytea,text)'),
          pg_catalog.to_regprocedure('public.digest(text,text)')
        )
        AND procedure_language.lanname = 'sql'
        AND NOT procedure.prosecdef
        AND procedure.provolatile = 'i'
        AND procedure.proisstrict
        AND procedure.proparallel = 's'
        AND procedure.proconfig @>
          ARRAY['search_path=pg_catalog']::text[]
        AND procedure.prosrc = 'SELECT extensions.digest($1, $2)'
        AND pg_catalog.has_function_privilege(
          current_user,
          procedure.oid,
          'EXECUTE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_roles restricted_role
          WHERE restricted_role.rolname IN (
            'anon',
            'authenticated',
            'service_role'
          )
            AND pg_catalog.has_function_privilege(
              restricted_role.oid,
              procedure.oid,
              'EXECUTE'
            )
        )
    ) <> 2 THEN
      RAISE EXCEPTION 'public digest compatibility wrappers are unsafe or incomplete';
    END IF;
  ELSIF pgcrypto_schema = 'public' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'unsupported pgcrypto extension schema';
  END IF;
END;
$pgcrypto_contract$;

DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_type = 'BASE TABLE') <> 84 THEN
    RAISE EXCEPTION 'expected exactly 84 app tables';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN (
        'analysis_refresh_runs',
        'analysis_refresh_steps'
      )
      AND table_type = 'BASE TABLE'
  ) <> 2 THEN
    RAISE EXCEPTION 'Analysis Refresh orchestration tables are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN (
        'topic_model_generation_runs',
        'topic_model_generation_invocation_attempts'
      )
      AND table_type = 'BASE TABLE'
  ) <> 2 THEN
    RAISE EXCEPTION 'Topic Model generation ledgers are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN (
        'keyword_governance_suggestion_generation_runs',
        'keyword_governance_suggestion_invocation_attempts',
        'keyword_review_suggestions',
        'keyword_governance_schedule_requests'
      )
      AND table_type = 'BASE TABLE'
  ) <> 4 THEN
    RAISE EXCEPTION 'Keyword governance suggestion and schedule ledgers are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_def
    WHERE constraint_def.conrelid = 'app.keyword_review_decisions'::regclass
      AND constraint_def.conname = 'keyword_review_decisions_check4'
      AND position(
        '(decision_origin = ''system_suggestion''::text)'
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
  ) THEN
    RAISE EXCEPTION 'actorless system suggestion decision authority drifted';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = 'keyword_review_decisions'
      AND column_name = 'analysis_invocation_id'
      AND data_type = 'uuid'
      AND is_nullable = 'YES'
  ) <> 1 THEN
    RAISE EXCEPTION 'generated Keyword intent invocation lineage is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_def
    WHERE constraint_def.conrelid = 'app.topic_model_revisions'::regclass
      AND constraint_def.conname = 'topic_model_revisions_state_check'
      AND position(
        'confirmed_by IS NULL'
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
      AND position(
        'llm_auto_confirmed'
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
      AND position(
        'analysisInvocationId'
        IN pg_get_constraintdef(constraint_def.oid)
      ) > 0
  ) THEN
    RAISE EXCEPTION 'Topic Model system-confirm state contract is incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname IN (
        'analysis_refresh_runs_project_created_idx',
        'analysis_refresh_runs_site_created_idx',
        'analysis_refresh_steps_project_state_idx',
        'analysis_refresh_steps_child_run_idx',
        'analysis_refresh_steps_child_run_unique_idx'
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'Analysis Refresh orchestration indexes are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger trigger_row
    JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'app'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgname IN (
        'analysis_refresh_runs_provenance_guard',
        'analysis_refresh_runs_append_only',
        'analysis_refresh_steps_mutation_guard'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Analysis Refresh orchestration triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT procedure.proname)
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname IN (
        'enforce_analysis_refresh_run_provenance',
        'enforce_analysis_refresh_step_mutation'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'Analysis Refresh orchestration routines are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND (
        (table_name = 'publication_attempts'
          AND column_name IN (
            'approved_artifact_content_hash',
            'preview_checksum',
            'content_checksum'
          ))
        OR
        (table_name = 'publication_receipts'
          AND column_name IN (
            'artifact_content_hash',
            'content_checksum'
          ))
        OR
        (table_name = 'measurement_windows'
          AND column_name IN (
            'artifact_content_hash',
            'content_checksum',
            'result_hash'
          ))
        OR
        (table_name = 'keyword_relation_candidates'
          AND column_name = 'evidence_hash')
      )
      AND is_nullable = 'NO'
      AND data_type = 'text'
  ) <> 9 THEN
    RAISE EXCEPTION 'publication, measurement, and Keyword Relation hash lineage columns are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = 'topic_model_revisions'
      AND column_name IN ('edit_revision', 'updated_at')
      AND is_nullable = 'NO'
  ) <> 2 THEN
    RAISE EXCEPTION 'Topic Model draft CAS columns are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname = ANY (ARRAY[
        'client_projects_workspace_updated_idx',
        'sites_one_primary_per_project_idx',
        'source_connections_one_active_provider_idx',
        'source_connections_project_idx',
        'oauth_intents_expiry_idx',
        'import_previews_expiry_idx',
        'async_runs_one_active_key_idx',
        'async_runs_project_status_idx',
        'data_snapshots_project_provider_idx',
        'normalized_observations_lookup_idx',
        'normalized_observations_snapshot_idx',
        'normalized_observations_site_page_metric_idx',
        'provider_discrepancies_pair_idx',
        'analysis_invocations_project_idx',
        'evidence_run_idx',
        'findings_project_filter_idx',
        'finding_observations_finding_run_idx',
        'finding_targets_one_direct_root_idx',
        'finding_targets_one_definition_root_idx',
        'finding_targets_one_observation_member_idx',
        'finding_targets_site_page_read_idx',
        'finding_targets_finding_run_read_idx',
        'finding_targets_operational_idx',
        'actions_plan_idx',
        'execution_artifacts_one_active_type_idx',
        'execution_artifacts_project_idx',
        'export_bundles_project_idx',
        'idempotency_keys_expiry_idx',
        'telemetry_events_name_created_idx',
        'audit_runs_project_created_idx',
        'site_pages_project_updated_idx',
        'site_pages_site_idx',
        'page_snapshots_page_captured_idx',
        'page_snapshots_project_captured_idx',
        'page_snapshots_verified_source_identity_idx',
        'product_profile_runs_project_created_idx',
        'product_profile_runs_base_profile_idx',
        'product_profile_runs_source_snapshot_idx',
        'product_profile_runs_result_profile_idx',
        'product_profile_invocation_attempts_project_idx',
        'product_profile_invocation_attempts_unresolved_idx',
        'topic_model_generation_runs_project_created_idx',
        'topic_model_generation_runs_result_revision_idx',
        'topic_model_generation_invocation_attempts_project_idx',
        'topic_model_generation_invocation_attempts_unresolved_idx',
        'keyword_suggestion_runs_project_created_idx',
        'keyword_governance_suggestion_generation_runs_input_hash_idx',
        'keyword_governance_suggestion_invocation_attempts_project_idx',
        'keyword_suggestion_attempts_unresolved_idx',
        'keyword_review_suggestions_project_created_idx',
        'keyword_review_suggestions_generation_idx',
        'keyword_review_suggestions_one_pending_idx',
        'keyword_governance_schedule_requests_due_idx',
        'keyword_governance_schedule_requests_source_idx',
        'keyword_occurrences_project_collected_idx',
        'keyword_entities_project_created_idx',
        'keyword_entities_project_review_idx',
        'keyword_entity_sources_project_occurrence_idx',
        'competitor_entities_project_created_idx',
        'competitor_entities_project_status_idx',
        'competitor_origins_profile_identity_idx',
        'competitor_origins_csv_identity_idx',
        'competitor_origins_manual_identity_idx',
        'competitor_origins_entity_observed_idx',
        'flow_shadow_runs_project_created_idx',
        'flow_shadow_runs_action_idx',
        'flow_shadow_runs_content_hash_idx',
        'flow_shadow_research_packs_run_idx',
        'flow_shadow_qa_gates_run_idx',
        'delivery_authorization_grants_project_state_idx',
        'artifact_approval_events_one_approval_per_revision_idx',
        'artifact_approval_events_one_terminal_per_event_idx',
        'artifact_approval_events_artifact_timeline_idx',
        'publication_destinations_project_ref_revision_idx',
        'publication_destinations_one_consuming_grant_idx',
        'publication_preview_events_issued_ref_idx',
        'publication_preview_events_one_terminal_per_event_idx',
        'publication_preview_events_project_ref_timeline_idx',
        'publication_preview_events_artifact_destination_idx',
        'publication_attempts_target_timeline_idx',
        'publication_attempts_source_idx',
        'publication_receipts_attempt_timeline_idx',
        'measurement_windows_target_history_idx',
        'measurement_windows_change_window_idx',
        'measurement_ga4_campaigns_window_idx',
        'topic_model_revisions_project_created_idx',
        'topic_model_revisions_one_draft_idx',
        'topic_node_revisions_project_model_idx',
        'topic_cluster_aliases_current_label_idx',
        'topic_cluster_aliases_node_history_idx',
        'topic_node_successors_predecessor_idx',
        'topic_node_successors_successor_idx',
        'keyword_review_decisions_project_decided_idx',
        'keyword_review_decisions_topic_idx'
      ]::text[])
  ) <> 94 THEN
    RAISE EXCEPTION 'expected all 94 named app indexes';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger trigger_row
    JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'app'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgname = ANY (ARRAY[
        'workspaces_set_updated_at',
        'operator_profiles_set_updated_at',
        'client_projects_set_updated_at',
        'client_projects_icp_profile_provenance_guard',
        'sites_set_updated_at',
        'source_connections_set_updated_at',
        'source_credentials_set_updated_at',
        'oauth_intents_set_updated_at',
        'import_previews_set_updated_at',
        'async_runs_set_updated_at',
        'async_runs_terminal_status_immutable',
        'collection_runs_provenance_guard',
        'data_snapshots_provenance_guard',
        'normalized_observations_provenance_guard',
        'normalized_observations_site_page_guard',
        'diagnostic_runs_frozen_input_guard',
        'diagnostic_runs_current_manifest_guard',
        'diagnostic_run_rules_version_guard',
        'provider_discrepancies_set_updated_at',
        'findings_set_updated_at',
        'findings_rule_version_guard',
        'actions_set_updated_at',
        'actions_source_lineage_guard',
        'execution_artifacts_set_updated_at',
        'execution_artifacts_status_transition_guard',
        'export_bundles_invariant_guard',
        'idempotency_keys_set_updated_at',
        'icp_profiles_append_only',
        'data_snapshots_append_only',
        'normalized_observations_append_only',
        'diagnostic_run_rules_append_only',
        'analysis_invocations_append_only',
        'evidence_provenance_guard',
        'evidence_append_only',
        'finding_observations_append_only',
        'finding_targets_lineage_guard',
        'finding_targets_append_only',
        'finding_review_events_append_only',
        'action_override_audit_append_only',
        'artifact_revisions_append_only',
        'telemetry_events_append_only',
        'site_pages_set_updated_at',
        'site_pages_canonical_subject_lock',
        'audit_runs_provenance_guard',
        'site_pages_provenance_guard',
        'page_snapshots_provenance_guard',
        'capability_runs_append_only',
        'audit_runs_append_only',
        'audit_module_results_append_only',
        'page_snapshots_append_only',
        'product_profile_runs_provenance_guard',
        'product_profile_runs_frozen_input_guard',
        'async_runs_product_profile_result_guard',
        'product_profile_invocation_attempts_transition_guard',
        'icp_profiles_product_profile_provenance_guard',
        'topic_model_generation_runs_provenance_guard',
        'topic_model_generation_runs_frozen_input_guard',
        'async_runs_topic_model_generation_result_guard',
        'topic_model_generation_invocation_attempts_transition_guard',
        'keyword_suggestion_generation_runs_provenance_guard',
        'keyword_suggestion_generation_runs_frozen_input_guard',
        'async_runs_keyword_suggestion_generation_result_guard',
        'keyword_suggestion_invocation_attempts_transition_guard',
        'keyword_review_suggestions_mutation_guard',
        'keyword_governance_schedule_requests_mutation_guard',
        'keyword_governance_generation_continuation_schedule',
        'keyword_occurrences_suggestion_writer_lock',
        'keyword_entity_sources_suggestion_writer_lock',
        'keyword_occurrences_lineage_guard',
        'keyword_occurrences_product_profile_lineage_guard',
        'keyword_occurrences_append_only',
        'keyword_entities_mutation_guard',
        'keyword_entities_initial_review_decision',
        'keyword_entities_no_delete',
        'keyword_entity_sources_lineage_guard',
        'keyword_entity_sources_append_only',
        'competitor_entities_governance_guard',
        'competitor_origins_lineage_guard',
        'flow_shadow_runs_provenance_guard',
        'flow_shadow_runs_append_only',
        'flow_shadow_research_packs_provenance_guard',
        'flow_shadow_research_packs_append_only',
        'flow_shadow_qa_gates_provenance_guard',
        'flow_shadow_qa_gates_append_only',
        'delivery_authorization_grants_transition_guard',
        'delivery_authorization_grants_no_delete',
        'artifact_approval_events_lineage_guard',
        'artifact_approval_events_append_only',
        'publication_destinations_lineage_guard',
        'publication_destinations_append_only',
        'publication_preview_events_lineage_guard',
        'publication_preview_events_append_only',
        'publication_attempts_lineage_guard',
        'publication_attempts_append_only',
        'publication_receipts_lineage_guard',
        'publication_receipts_append_only',
        'measurement_windows_lineage_guard',
        'measurement_windows_completeness_guard',
        'measurement_windows_append_only',
        'measurement_gsc_dimensions_lineage_guard',
        'measurement_gsc_dimensions_append_only',
        'measurement_ga4_dimensions_lineage_guard',
        'measurement_ga4_dimensions_append_only',
        'measurement_geo_dimensions_lineage_guard',
        'measurement_geo_dimensions_append_only',
        'measurement_utm_identities_scope_guard',
        'measurement_utm_identities_append_only',
        'measurement_ga4_campaigns_lineage_guard',
        'measurement_ga4_campaigns_append_only',
        'keyword_review_decisions_projection_guard',
        'keyword_review_decisions_analysis_invocation_guard',
        'topic_model_revisions_mutation_guard',
        'topic_model_revisions_topology_guard',
        'topic_node_identities_creation_guard',
        'topic_node_identities_append_only',
        'topic_node_revisions_mutation_guard',
        'topic_node_revisions_parent_cycle_guard',
        'topic_cluster_aliases_window_guard',
        'topic_cluster_aliases_retention_guard',
        'topic_node_successors_cycle_guard',
        'topic_node_successors_append_only',
        'keyword_review_decisions_append_only'
      ]::text[])
  ) <> 122 THEN
    RAISE EXCEPTION 'expected all 122 app triggers';
  END IF;
  IF (
    SELECT count(DISTINCT procedure.proname)
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname = ANY (ARRAY[
        'lock_site_page_canonical_subjects',
        'finding_target_relation_key',
        'reserve_product_profile_invocation_attempt',
        'finalize_product_profile_invocation_attempt',
        'mark_product_profile_invocation_outcome_unknown',
        'validate_product_profile_provenance',
        'enforce_topic_model_generation_run_provenance',
        'enforce_topic_model_generation_run_frozen_input',
        'enforce_topic_model_generation_async_result',
        'enforce_topic_model_generation_invocation_attempt_transition',
        'reserve_topic_model_generation_invocation_attempt',
        'finalize_topic_model_generation_invocation_attempt',
        'mark_topic_model_generation_invocation_outcome_unknown',
        'terminalize_topic_model_generation_run',
        'current_keyword_governance_suggestion_occurrence_ids',
        'enforce_keyword_governance_suggestion_generation_run_provenance',
        'enforce_keyword_suggestion_run_frozen_input',
        'enforce_keyword_governance_suggestion_generation_async_result',
        'enforce_keyword_suggestion_attempt_transition',
        'reserve_keyword_governance_suggestion_invocation_attempt',
        'finalize_keyword_governance_suggestion_invocation_attempt',
        'mark_keyword_governance_suggestion_invocation_outcome_unknown',
        'enforce_keyword_review_suggestion_mutation',
        'lock_keyword_governance_suggestion_source_write',
        'supersede_keyword_review_suggestions_for_keywords',
        'supersede_keyword_review_suggestions_for_project',
        'insert_keyword_review_suggestions_batch',
        'terminalize_keyword_governance_suggestion_generation_run',
        'enforce_keyword_governance_schedule_request_mutation',
        'insert_keyword_governance_schedule_request',
        'claim_keyword_governance_schedule_request',
        'claim_keyword_governance_schedule_request_by_source',
        'claim_due_keyword_governance_schedule_requests',
        'complete_keyword_governance_schedule_request',
        'release_keyword_governance_schedule_request',
        'append_keyword_governance_generation_continuation_request',
        'supersede_stale_pending_keyword_review_suggestions',
        'enforce_keyword_review_analysis_invocation',
        'enforce_keyword_occurrence_lineage',
        'is_bcp47_canonical_identity',
        'enforce_product_profile_keyword_occurrence_lineage',
        'enforce_keyword_entity_mutation',
        'initialize_keyword_review_decision',
        'enforce_keyword_entity_source_lineage',
        'upsert_keyword_library_occurrence',
        'is_normalized_competitor_domain',
        'is_competitor_analysis_scope',
        'is_typed_product_profile_evidence_refs',
        'enforce_competitor_entity_governance',
        'enforce_competitor_origin_lineage',
        'upsert_competitor_origin',
        'enforce_flow_shadow_run_provenance',
        'enforce_flow_shadow_child_provenance',
        'enforce_delivery_authorization_grant_transition',
        'enforce_artifact_approval_event_lineage',
        'enforce_publication_destination_lineage',
        'enforce_publication_preview_event_lineage',
        'enforce_publication_attempt_lineage',
        'enforce_publication_receipt_lineage',
        'enforce_measurement_window_lineage',
        'enforce_measurement_dimension_lineage',
        'enforce_measurement_window_completeness',
        'enforce_measurement_utm_identity_scope',
        'enforce_measurement_ga4_campaign_lineage',
        'enforce_keyword_review_projection',
        'enforce_topic_model_revision_mutation',
        'validate_confirmed_topic_model_topology',
        'enforce_topic_node_identity_creation',
        'enforce_topic_node_revision_mutation',
        'prevent_topic_parent_cycle',
        'prevent_topic_alias_window_overlap',
        'enforce_topic_cluster_alias_retention',
        'prevent_topic_successor_cycle'
      ]::text[])
  ) <> 73 THEN
    RAISE EXCEPTION 'expected all 73 runtime routines';
  END IF;
END;
$$;

INSERT INTO app.workspaces (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Spec smoke workspace');

INSERT INTO app.operator_profiles (user_id, workspace_id, display_name)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'Spec operator'
);

INSERT INTO app.client_projects (
  id, workspace_id, client_name, project_name, default_delivery_locale, created_by
)
VALUES
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000001',
    'Spec client',
    'Spec project',
    'en',
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000001',
    'Other client',
    'Other project',
    'en',
    '00000000-0000-4000-8000-000000000101'
  );

INSERT INTO app.sites (
  id, workspace_id, project_id, origin, host, market_codes, language_codes
)
VALUES (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'https://example.com',
  'example.com',
  ARRAY[]::text[],
  ARRAY[]::text[]
);

INSERT INTO app.icp_profiles (
  id, workspace_id, project_id, version, status, profile, content_hash, created_by
)
VALUES
  (
    '00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    1,
    'complete',
    '{"productName":"Spec product v1"}'::jsonb,
    repeat('1', 64),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000202',
    1,
    'complete',
    '{"productName":"Other product"}'::jsonb,
    repeat('2', 64),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000403',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    2,
    'draft',
    '{"productName":"Spec product working v2"}'::jsonb,
    repeat('3', 64),
    '00000000-0000-4000-8000-000000000101'
  );

UPDATE app.client_projects
SET current_icp_profile_id = '00000000-0000-4000-8000-000000000403',
    confirmed_icp_profile_id = '00000000-0000-4000-8000-000000000401'
WHERE id = '00000000-0000-4000-8000-000000000201';

-- The database separates the latest working draft from the reviewed profile
-- used by downstream work, without advancing the project lifecycle.
DO $$
DECLARE
  current_splice_rejected boolean := false;
  confirmed_splice_rejected boolean := false;
  draft_confirmation_rejected boolean := false;
  profile_mutation_rejected boolean := false;
BEGIN
  IF (
    SELECT market_codes = ARRAY[]::text[]
       AND language_codes = ARRAY[]::text[]
    FROM app.sites
    WHERE id = '00000000-0000-4000-8000-000000000301'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'URL-first site did not preserve unknown market/language scope';
  END IF;

  IF (
    SELECT current_icp_profile_id = '00000000-0000-4000-8000-000000000403'
       AND confirmed_icp_profile_id = '00000000-0000-4000-8000-000000000401'
       AND stage = 'setup'
    FROM app.client_projects
    WHERE id = '00000000-0000-4000-8000-000000000201'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'working and confirmed profile pointers were not kept distinct';
  END IF;

  BEGIN
    UPDATE app.client_projects
    SET current_icp_profile_id = '00000000-0000-4000-8000-000000000402'
    WHERE id = '00000000-0000-4000-8000-000000000201';
  EXCEPTION WHEN check_violation THEN
    current_splice_rejected := true;
  END;
  IF NOT current_splice_rejected THEN
    RAISE EXCEPTION 'cross-project current profile splice was accepted';
  END IF;

  BEGIN
    UPDATE app.client_projects
    SET confirmed_icp_profile_id = '00000000-0000-4000-8000-000000000402'
    WHERE id = '00000000-0000-4000-8000-000000000201';
  EXCEPTION WHEN check_violation THEN
    confirmed_splice_rejected := true;
  END;
  IF NOT confirmed_splice_rejected THEN
    RAISE EXCEPTION 'cross-project confirmed profile splice was accepted';
  END IF;

  BEGIN
    UPDATE app.client_projects
    SET confirmed_icp_profile_id = '00000000-0000-4000-8000-000000000403'
    WHERE id = '00000000-0000-4000-8000-000000000201';
  EXCEPTION WHEN check_violation THEN
    draft_confirmation_rejected := true;
  END;
  IF NOT draft_confirmation_rejected THEN
    RAISE EXCEPTION 'draft profile was accepted as confirmed';
  END IF;

  BEGIN
    UPDATE app.icp_profiles
    SET profile = '{"mutated":true}'::jsonb
    WHERE id = '00000000-0000-4000-8000-000000000403';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    profile_mutation_rejected := true;
  END;
  IF NOT profile_mutation_rejected THEN
    RAISE EXCEPTION 'append-only ICP profile mutation was accepted';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'app.client_projects'::regclass
      AND conname IN (
        'client_projects_current_icp_profile_fk',
        'client_projects_confirmed_icp_profile_fk'
      )
      AND confdeltype = 'r'
  ) <> 2 THEN
    RAISE EXCEPTION 'ICP profile pointers are not protected by ON DELETE RESTRICT';
  END IF;
END;
$$;

INSERT INTO app.source_connections (
  id, workspace_id, project_id, site_id, provider, connection_type, state,
  limitation, connected_at, created_by
)
VALUES
  (
    '00000000-0000-4000-8000-000000000501',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'crawl',
    'public',
    'connected',
    'Static HTML public crawl only.',
    now(),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'csv',
    'file_import',
    'connected',
    'User-provided keyword-gap import.',
    now(),
    '00000000-0000-4000-8000-000000000101'
  ),
  (
    '00000000-0000-4000-8000-000000000503',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'dataforseo',
    'api_key_stub',
    'connected',
    'Vendor keyword-gap observation source.',
    now(),
    '00000000-0000-4000-8000-000000000101'
  );

INSERT INTO app.import_previews (
  id, workspace_id, project_id, site_id, created_by, token_hash,
  template_id, raw_object_key, file_checksum, row_count, detected_columns,
  suggested_mapping, preview_rows, expires_at
)
VALUES (
  '00000000-0000-4000-8000-000000001401',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000101',
  decode(repeat('a', 64), 'hex'),
  'keyword_gap_v1',
  'raw-import/00000000-0000-4000-8000-000000000201/00000000-0000-4000-8000-000000001401/preview.csv',
  repeat('a', 64),
  1,
  '["keyword"]'::jsonb,
  '{"keyword":"keyword"}'::jsonb,
  '[{"keyword":"growth audit"}]'::jsonb,
  now() + interval '30 minutes'
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at, completed_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'completed',
    'collect:crawl:site_graph',
    '00000000-0000-4000-8000-000000000101',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000606',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'completed',
    'collect:csv:keyword_gap',
    '00000000-0000-4000-8000-000000000101',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000607',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'completed',
    'collect:dataforseo:keyword_gap',
    '00000000-0000-4000-8000-000000000101',
    now(),
    now()
  );

INSERT INTO app.collection_runs (
  id, workspace_id, project_id, site_id, source_connection_id,
  import_preview_id, provider, operation, method_version, parameters_hash
)
VALUES
  (
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000501',
    NULL,
    'crawl',
    'site_graph',
    'crawl.site_graph.v2',
    repeat('2', 64)
  ),
  (
    '00000000-0000-4000-8000-000000000606',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000001401',
    'csv',
    'keyword_gap_import',
    'csv.keyword_gap.v1',
    repeat('5', 64)
  ),
  (
    '00000000-0000-4000-8000-000000000607',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000503',
    NULL,
    'dataforseo',
    'keyword_gap_import',
    'dataforseo.ranked_keywords.v1',
    repeat('6', 64)
  );

INSERT INTO app.data_snapshots (
  id, workspace_id, project_id, site_id, collection_run_id, source_connection_id,
  provider, dataset_key, schema_version, method_version, captured_at, source_window,
  availability, limitation, row_count, checksum
)
VALUES
  (
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000601',
    '00000000-0000-4000-8000-000000000501',
    'crawl',
    'crawl.site_graph.v1',
    'crawl.site_graph.v2',
    'crawl.site_graph.v2',
    now(),
    '{"start":null,"end":null}'::jsonb,
    'available',
    'Static HTML public crawl only.',
    1,
    repeat('3', 64)
  ),
  (
    '00000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000606',
    '00000000-0000-4000-8000-000000000502',
    'csv',
    'csv.keyword_gap.v1',
    '0.2.0',
    'csv.keyword_gap.v1',
    now(),
    '{"start":null,"end":null}'::jsonb,
    'available',
    'User-provided keyword-gap import.',
    1,
    repeat('6', 64)
  ),
  (
    '00000000-0000-4000-8000-000000000703',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000607',
    '00000000-0000-4000-8000-000000000503',
    'dataforseo',
    'csv.keyword_gap.v1',
    'dataforseo.ranked_keywords.v1',
    'dataforseo.ranked_keywords.v1',
    now(),
    '{"start":null,"end":null}'::jsonb,
    'available',
    'Vendor keyword-gap observation source.',
    1,
    repeat('7', 64)
  );

UPDATE app.collection_runs
SET row_count = 1,
    source_window = '{"start":null,"end":null}'::jsonb
WHERE id IN (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000606',
  '00000000-0000-4000-8000-000000000607'
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at
)
VALUES (
  '00000000-0000-4000-8000-000000000605',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'collection',
  'running',
  'collect:crawl:placeholder-bypass',
  '00000000-0000-4000-8000-000000000101',
  now()
);

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.collection_runs (
      id, workspace_id, project_id, site_id, source_connection_id, provider,
      operation, method_version, parameters_hash, row_count
    ) VALUES (
      '00000000-0000-4000-8000-000000000605',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000501',
      'crawl',
      'site_graph',
      'crawl.site_graph.v2',
      repeat('9', 64),
      1
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'collection run terminal INSERT bypass was accepted';
  END IF;
END;
$$;

-- An observed zero is valid when availability is explicitly available.
INSERT INTO app.normalized_observations (
  id, workspace_id, project_id, snapshot_id, provider, metric_key, subject_type,
  subject_ref, observed_at, availability, value_numeric, unit, origin, grade,
  support, limitation
)
VALUES
  (
    '00000000-0000-4000-8000-000000000801',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000701',
    'crawl',
    'crawl.robots.v1',
    'site',
    'https://example.com',
    now(),
    'available',
    0,
    'directives',
    'direct_public',
    'B',
    'context',
    'Only links present in the static HTML crawl are counted.'
  ),
  (
    '00000000-0000-4000-8000-000000000802',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000702',
    'csv',
    'csv.keyword_gap.v1',
    'keyword_cluster',
    'growth-audit',
    now(),
    'available',
    12,
    'keywords',
    'user_provided',
    'C',
    'context',
    'User-provided rows retain their source identity.'
  ),
  (
    '00000000-0000-4000-8000-000000000803',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000703',
    'dataforseo',
    'csv.keyword_gap.v1',
    'keyword_cluster',
    'growth-audit',
    now(),
    'available',
    10,
    'keywords',
    'vendor_observation',
    'B',
    'context',
    'Vendor observations retain their source identity.'
  );

-- Unavailable is never allowed to carry a synthetic zero.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.normalized_observations (
      workspace_id, project_id, snapshot_id, provider, metric_key, subject_type,
      subject_ref, observed_at, availability, value_numeric, origin, grade, support,
      limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000701',
      'crawl',
      'crawl.robots.v1',
      'site',
      'https://example.com',
      now(),
      'unavailable',
      0,
      'direct_public',
      'B',
      'context',
      'The metric was unavailable.'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'unavailable observation with zero was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.normalized_observations (
      workspace_id, project_id, snapshot_id, provider, metric_key, subject_type,
      subject_ref, observed_at, availability, value_numeric, origin, grade,
      support, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000701',
      'crawl',
      'gsc.page.v1',
      'url',
      'https://example.com/provider-splice',
      now(),
      'available',
      1,
      'direct_public',
      'B',
      'context',
      'This row intentionally splices a GSC metric into a crawl snapshot.'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'observation metric/provider/dataset splice was accepted';
  END IF;
END;
$$;

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at, completed_at
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'diagnostic',
  'completed',
  'diagnostic',
  '00000000-0000-4000-8000-000000000101',
  now(),
  now()
);

INSERT INTO app.diagnostic_runs (
  id, workspace_id, project_id, site_id, icp_profile_id, icp_profile_version,
  rule_set_version, prompt_set_version, output_locale, input_manifest, input_hash,
  coverage
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000401',
  1,
  'mvp.rules.0.2.3',
  'mvp.prompts.0.2.0',
  'en',
  jsonb_build_object(
    'projectId', '00000000-0000-4000-8000-000000000201',
    'siteId', '00000000-0000-4000-8000-000000000301',
    'ruleSetVersion', 'mvp.rules.0.2.3',
    'promptSetVersion', 'mvp.prompts.0.2.0',
    'deliveryLocale', 'en',
    'icp', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000401',
      'version', 1,
      'contentHash', repeat('1', 64)
    ),
    'governance', jsonb_build_object(
      'projectionVersion', 'growth-governance.1.0.0',
      'keywordClusters', '[]'::jsonb,
      'competitors', '[]'::jsonb
    ),
    'snapshots',
    jsonb_build_array(
      jsonb_build_object(
        'snapshotId', '00000000-0000-4000-8000-000000000701',
        'provider', 'crawl',
        'datasetKey', 'crawl.site_graph.v1',
        'schemaVersion', 'crawl.site_graph.v2',
        'methodVersion', 'crawl.site_graph.v2',
        'checksum', repeat('3', 64),
        'availability', 'available',
        'sourceWindow', '{"start":null,"end":null}'::jsonb,
        'capturedAt', now()
      ),
      jsonb_build_object(
        'snapshotId', '00000000-0000-4000-8000-000000000702',
        'provider', 'csv',
        'datasetKey', 'csv.keyword_gap.v1',
        'schemaVersion', '0.2.0',
        'methodVersion', 'csv.keyword_gap.v1',
        'checksum', repeat('6', 64),
        'availability', 'available',
        'sourceWindow', '{"start":null,"end":null}'::jsonb,
        'capturedAt', now()
      ),
      jsonb_build_object(
        'snapshotId', '00000000-0000-4000-8000-000000000703',
        'provider', 'dataforseo',
        'datasetKey', 'csv.keyword_gap.v1',
        'schemaVersion', 'dataforseo.ranked_keywords.v1',
        'methodVersion', 'dataforseo.ranked_keywords.v1',
        'checksum', repeat('7', 64),
        'availability', 'available',
        'sourceWindow', '{"start":null,"end":null}'::jsonb,
        'capturedAt', now()
      )
    )
  ),
  repeat('4', 64),
  '{"overall":"complete"}'::jsonb
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at, completed_at
)
VALUES (
  '00000000-0000-4000-8000-000000000608',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'diagnostic',
  'completed',
  'diagnostic:duplicate-provider',
  '00000000-0000-4000-8000-000000000101',
  now(),
  now()
);

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.diagnostic_runs (
      id, workspace_id, project_id, site_id, icp_profile_id,
      icp_profile_version, rule_set_version, prompt_set_version,
      output_locale, input_manifest, input_hash, coverage
    )
    SELECT
      '00000000-0000-4000-8000-000000000608',
      workspace_id,
      project_id,
      site_id,
      icp_profile_id,
      icp_profile_version,
      rule_set_version,
      prompt_set_version,
      output_locale,
      jsonb_set(
        input_manifest,
        '{snapshots}',
        (input_manifest -> 'snapshots')
          || jsonb_build_array(input_manifest -> 'snapshots' -> 1)
      ),
      repeat('8', 64),
      '{}'::jsonb
    FROM app.diagnostic_runs
    WHERE id = '00000000-0000-4000-8000-000000000602';
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'current diagnostic accepted duplicate provider snapshots';
  END IF;
END;
$$;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.diagnostic_run_rules (
      diagnostic_run_id, rule_id, rule_version, domain,
      status, reason, metrics, duration_ms
    ) VALUES (
      '00000000-0000-4000-8000-000000000602',
      'TECH-LINKGRAPH-005',
      1,
      'technical_seo',
      'candidate',
      NULL,
      '{}'::jsonb,
      1
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'current diagnostic accepted a legacy technical rule version';
  END IF;
END;
$$;

INSERT INTO app.diagnostic_run_rules (
  diagnostic_run_id, rule_id, rule_version, domain,
  status, reason, metrics, duration_ms
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  'TECH-LINKGRAPH-005',
  3,
  'technical_seo',
  'candidate',
  NULL,
  '{}'::jsonb,
  1
);

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.diagnostic_run_rules (
      diagnostic_run_id, rule_id, rule_version, domain,
      status, reason, metrics, duration_ms
    ) VALUES (
      '00000000-0000-4000-8000-000000000602',
      'CONTENT-GAP-011',
      1,
      'content_intent',
      'candidate',
      NULL,
      '{}'::jsonb,
      1
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'current diagnostic accepted the legacy Content Gap rule version';
  END IF;
END;
$$;

INSERT INTO app.diagnostic_run_rules (
  diagnostic_run_id, rule_id, rule_version, domain,
  status, reason, metrics, duration_ms
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  'CONTENT-GAP-011',
  2,
  'content_intent',
  'candidate',
  NULL,
  '{}'::jsonb,
  1
);

-- The contextual generation freezes exactly nine manifest keys. Creation-time
-- Site language and immutable ICP generation/hash checks make replay independent
-- from later mutable Site or profile-pointer state.
DO $contextual_diagnostic_manifest$
DECLARE
  base_manifest jsonb := jsonb_build_object(
    'projectId', '00000000-0000-4000-8000-000000000201',
    'siteId', '00000000-0000-4000-8000-000000000301',
    'ruleSetVersion', 'mvp.rules.0.2.4',
    'promptSetVersion', 'mvp.prompts.0.2.0',
    'deliveryLocale', 'en',
    'icp', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000401',
      'version', 1,
      'contentHash', repeat('1', 64)
    ),
    'snapshots', jsonb_build_array(
      jsonb_build_object(
        'snapshotId', '00000000-0000-4000-8000-000000000701',
        'provider', 'crawl',
        'datasetKey', 'crawl.site_graph.v1',
        'schemaVersion', 'crawl.site_graph.v2',
        'methodVersion', 'crawl.site_graph.v2',
        'checksum', repeat('3', 64),
        'availability', 'available',
        'sourceWindow', '{"start":null,"end":null}'::jsonb,
        'capturedAt', now()
      )
    ),
    'governance', jsonb_build_object(
      'projectionVersion', 'growth-governance.1.0.0',
      'keywordClusters', '[]'::jsonb,
      'competitors', '[]'::jsonb
    ),
    'contextProjection', jsonb_build_object(
      'schemaVersion', 'context-projection.v1',
      'compilerVersion', 'context-projection.compiler.1.0.0',
      'profileGeneration', 'legacy-icp.v1',
      'productRouting', jsonb_build_object(
        'sourceKind', 'legacy_icp',
        'productName', 'Spec product v1',
        'oneLiner', 'A frozen legacy ICP smoke fixture.',
        'productType', '',
        'businessModels', '[]'::jsonb,
        'primaryMarket', NULL,
        'primaryAudience', NULL
      ),
      'siteLanguage', jsonb_build_object(
        'sourceKind', 'site',
        'state', 'declared_empty',
        'languageCodes', '[]'::jsonb
      ),
      'primaryConversion', jsonb_build_object(
        'state', 'missing',
        'sourceKind', 'legacy_icp'
      ),
      'priorityUrlSubjects', jsonb_build_object(
        'state', 'missing',
        'sourceKind', 'legacy_icp'
      ),
      'declaredExecutionConstraints', jsonb_build_object(
        'state', 'missing',
        'sourceKind', 'legacy_icp'
      )
    )
  );
  old_shape_rejected boolean := false;
  historical_context_rejected boolean := false;
  extra_context_key_rejected boolean := false;
  profile_generation_rejected boolean := false;
  site_language_rejected boolean := false;
  source_hash_rejected boolean := false;
  version_two_rejected boolean := false;
  historical_rule_rejected boolean := false;
BEGIN
  INSERT INTO app.async_runs (
    id, workspace_id, project_id, kind, status, active_key, initiated_by,
    started_at, completed_at
  )
  VALUES
    (
      '00000000-0000-4000-8000-000000000620',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      'diagnostic', 'completed', 'diagnostic:contextual-valid',
      '00000000-0000-4000-8000-000000000101', now(), now()
    ),
    (
      '00000000-0000-4000-8000-000000000621',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      'diagnostic', 'completed', 'diagnostic:contextual-old-shape',
      '00000000-0000-4000-8000-000000000101', now(), now()
    ),
    (
      '00000000-0000-4000-8000-000000000622',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      'diagnostic', 'completed', 'diagnostic:historical-context',
      '00000000-0000-4000-8000-000000000101', now(), now()
    ),
    (
      '00000000-0000-4000-8000-000000000623',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      'diagnostic', 'completed', 'diagnostic:contextual-extra-key',
      '00000000-0000-4000-8000-000000000101', now(), now()
    ),
    (
      '00000000-0000-4000-8000-000000000624',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      'diagnostic', 'completed', 'diagnostic:contextual-profile-mismatch',
      '00000000-0000-4000-8000-000000000101', now(), now()
    ),
    (
      '00000000-0000-4000-8000-000000000625',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      'diagnostic', 'completed', 'diagnostic:contextual-language-mismatch',
      '00000000-0000-4000-8000-000000000101', now(), now()
    ),
    (
      '00000000-0000-4000-8000-000000000626',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      'diagnostic', 'completed', 'diagnostic:contextual-hash-mismatch',
      '00000000-0000-4000-8000-000000000101', now(), now()
    );

  INSERT INTO app.diagnostic_runs (
    id, workspace_id, project_id, site_id, icp_profile_id,
    icp_profile_version, rule_set_version, prompt_set_version,
    output_locale, input_manifest, input_hash, coverage
  ) VALUES (
    '00000000-0000-4000-8000-000000000620',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000401',
    1, 'mvp.rules.0.2.4', 'mvp.prompts.0.2.0', 'en',
    base_manifest, repeat('a', 64), '{}'::jsonb
  );

  BEGIN
    INSERT INTO app.diagnostic_runs (
      id, workspace_id, project_id, site_id, icp_profile_id,
      icp_profile_version, rule_set_version, prompt_set_version,
      output_locale, input_manifest, input_hash, coverage
    ) VALUES (
      '00000000-0000-4000-8000-000000000621',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000401',
      1, 'mvp.rules.0.2.4', 'mvp.prompts.0.2.0', 'en',
      base_manifest - 'contextProjection', repeat('b', 64), '{}'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    old_shape_rejected := true;
  END;

  BEGIN
    INSERT INTO app.diagnostic_runs (
      id, workspace_id, project_id, site_id, icp_profile_id,
      icp_profile_version, rule_set_version, prompt_set_version,
      output_locale, input_manifest, input_hash, coverage
    ) VALUES (
      '00000000-0000-4000-8000-000000000622',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000401',
      1, 'mvp.rules.0.2.3', 'mvp.prompts.0.2.0', 'en',
      jsonb_set(
        base_manifest,
        '{ruleSetVersion}',
        '"mvp.rules.0.2.3"'::jsonb
      ),
      repeat('c', 64),
      '{}'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    historical_context_rejected := true;
  END;

  BEGIN
    INSERT INTO app.diagnostic_runs (
      id, workspace_id, project_id, site_id, icp_profile_id,
      icp_profile_version, rule_set_version, prompt_set_version,
      output_locale, input_manifest, input_hash, coverage
    ) VALUES (
      '00000000-0000-4000-8000-000000000623',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000401',
      1, 'mvp.rules.0.2.4', 'mvp.prompts.0.2.0', 'en',
      jsonb_set(
        base_manifest,
        '{contextProjection,workflowState}',
        '"queued"'::jsonb
      ),
      repeat('d', 64),
      '{}'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    extra_context_key_rejected := true;
  END;

  BEGIN
    INSERT INTO app.diagnostic_runs (
      id, workspace_id, project_id, site_id, icp_profile_id,
      icp_profile_version, rule_set_version, prompt_set_version,
      output_locale, input_manifest, input_hash, coverage
    ) VALUES (
      '00000000-0000-4000-8000-000000000624',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000401',
      1, 'mvp.rules.0.2.4', 'mvp.prompts.0.2.0', 'en',
      jsonb_set(
        base_manifest,
        '{contextProjection,profileGeneration}',
        '"product-profile.0.3.0"'::jsonb
      ),
      repeat('e', 64),
      '{}'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    profile_generation_rejected := true;
  END;

  BEGIN
    INSERT INTO app.diagnostic_runs (
      id, workspace_id, project_id, site_id, icp_profile_id,
      icp_profile_version, rule_set_version, prompt_set_version,
      output_locale, input_manifest, input_hash, coverage
    ) VALUES (
      '00000000-0000-4000-8000-000000000625',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000401',
      1, 'mvp.rules.0.2.4', 'mvp.prompts.0.2.0', 'en',
      jsonb_set(
        base_manifest,
        '{contextProjection,siteLanguage}',
        '{"sourceKind":"site","state":"declared_non_empty","languageCodes":["en"]}'::jsonb
      ),
      repeat('f', 64),
      '{}'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    site_language_rejected := true;
  END;

  BEGIN
    INSERT INTO app.diagnostic_runs (
      id, workspace_id, project_id, site_id, icp_profile_id,
      icp_profile_version, rule_set_version, prompt_set_version,
      output_locale, input_manifest, input_hash, coverage
    ) VALUES (
      '00000000-0000-4000-8000-000000000626',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000401',
      1, 'mvp.rules.0.2.4', 'mvp.prompts.0.2.0', 'en',
      jsonb_set(
        base_manifest,
        '{contextProjection,priorityUrlSubjects}',
        jsonb_build_object(
          'state', 'available',
          'sourceKind', 'legacy_icp',
          'sourceHash', repeat('f', 64),
          'normalizedRefs', jsonb_build_array(
            'https://example.com/customer-onboarding'
          )
        )
      ),
      repeat('1', 64),
      '{}'::jsonb
    );
  EXCEPTION WHEN check_violation THEN
    source_hash_rejected := true;
  END;

  BEGIN
    INSERT INTO app.diagnostic_run_rules (
      diagnostic_run_id, rule_id, rule_version, domain,
      status, reason, metrics, duration_ms
    ) VALUES (
      '00000000-0000-4000-8000-000000000620',
      'TECH-INDEXABILITY-006', 2, 'technical_seo',
      'candidate', NULL, '{}'::jsonb, 1
    );
  EXCEPTION WHEN check_violation THEN
    version_two_rejected := true;
  END;

  BEGIN
    INSERT INTO app.diagnostic_run_rules (
      diagnostic_run_id, rule_id, rule_version, domain,
      status, reason, metrics, duration_ms
    ) VALUES (
      '00000000-0000-4000-8000-000000000602',
      'TECH-INDEXABILITY-006', 1, 'technical_seo',
      'candidate', NULL, '{}'::jsonb, 1
    );
  EXCEPTION WHEN check_violation THEN
    historical_rule_rejected := true;
  END;

  INSERT INTO app.diagnostic_run_rules (
    diagnostic_run_id, rule_id, rule_version, domain,
    status, reason, metrics, duration_ms
  ) VALUES (
    '00000000-0000-4000-8000-000000000620',
    'TECH-INDEXABILITY-006', 1, 'technical_seo',
    'candidate', NULL, '{}'::jsonb, 1
  );

  IF NOT old_shape_rejected
     OR NOT historical_context_rejected
     OR NOT extra_context_key_rejected
     OR NOT profile_generation_rejected
     OR NOT site_language_rejected
     OR NOT source_hash_rejected
     OR NOT version_two_rejected
     OR NOT historical_rule_rejected THEN
    RAISE EXCEPTION 'contextual diagnostic manifest or rule guards are incomplete';
  END IF;
END;
$contextual_diagnostic_manifest$;

-- Model-generated evidence must reference an immutable AnalysisInvocation.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, source_provider, origin, method,
      grade, availability, support, subject_refs, claim, observed_at, limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      'llm',
      'generated',
      'generated',
      'C',
      'available',
      'context',
      '[{"type":"site","value":"https://example.com"}]'::jsonb,
      'Generated text without lineage must fail.',
      now(),
      'This smoke row intentionally has no model invocation.'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'generated evidence without invocation was accepted';
  END IF;
END;
$$;

INSERT INTO app.evidence (
  id, workspace_id, project_id, diagnostic_run_id, snapshot_id, collection_run_id,
  source_provider, origin, method, grade, availability, support, subject_refs,
  claim, observed_at, limitation
)
VALUES (
  '00000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000601',
  'crawl',
  'direct_public',
  'observed',
  'B',
  'available',
  'supports',
  '[{"type":"url","value":"https://example.com/pricing"}]'::jsonb,
  'The pricing page had zero observed internal inlinks.',
  now(),
  'Only links present in the static HTML crawl are counted.'
);

-- Bespoke observed-provider mappings retain the provider grade while sharing
-- the same exact frozen-lineage enforcement.
INSERT INTO app.evidence (
  workspace_id, project_id, diagnostic_run_id, snapshot_id, collection_run_id,
  source_provider, origin, method, grade, availability, support, subject_refs,
  claim, observed_at, limitation
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000702',
    '00000000-0000-4000-8000-000000000606',
    'csv', 'user_provided', 'observed', 'C', 'available', 'supports',
    '[{"type":"keyword_cluster","value":"growth-audit"}]'::jsonb,
    'The frozen CSV import contains the growth-audit keyword cluster.',
    now(),
    'The source and export settings remain user-provided.'
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000703',
    '00000000-0000-4000-8000-000000000607',
    'dataforseo', 'vendor_observation', 'observed', 'B', 'available', 'supports',
    '[{"type":"keyword_cluster","value":"growth-audit"}]'::jsonb,
    'The frozen vendor snapshot observes the growth-audit keyword cluster.',
    now(),
    'Vendor estimates retain their market, language, filter, and row-cap limits.'
  );

-- Deterministic rules may compute or infer conclusions from the exact frozen
-- source snapshot without relabelling the underlying row as an observation.
INSERT INTO app.evidence (
  workspace_id, project_id, diagnostic_run_id, snapshot_id, collection_run_id,
  source_provider, origin, method, grade, availability, support, subject_refs,
  claim, observed_at, limitation
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000601',
    'crawl', 'derived', 'computed', 'B', 'available', 'supports',
    '[{"type":"page_set","value":"low_internal_inlinks"}]'::jsonb,
    'The frozen crawl graph deterministically computes a low-inlink page set.',
    now(),
    'The computation is replayable from the frozen crawl snapshot.'
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000602',
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000000601',
    'crawl', 'derived', 'inferred', 'C', 'available', 'supports',
    '[{"type":"page_set","value":"missing_entity_proof"}]'::jsonb,
    'The frozen crawl content heuristically lacks entity proof.',
    now(),
    'The inference is limited to the documented language heuristic.'
  );

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'crawl',
      'direct_public',
      'observed',
      'A',
      'available',
      'supports',
      '[{"type":"url","value":"https://example.com/pricing"}]'::jsonb,
      'This row intentionally overstates the trust grade.',
      now(),
      'Only links present in the static HTML crawl are counted.'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'source evidence with a forged trust grade was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  pseudo_provider_rejected boolean := false;
  computed_grade_rejected boolean := false;
  inferred_grade_rejected boolean := false;
  derived_method_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'system', 'derived', 'computed', 'B', 'available', 'supports',
      '[{"type":"page_set","value":"forged_provider"}]'::jsonb,
      'This row tries to hide crawl lineage behind the system provider.',
      now(),
      'Intentional invalid smoke fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    pseudo_provider_rejected := true;
  END;

  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'crawl', 'derived', 'computed', 'A', 'available', 'supports',
      '[{"type":"page_set","value":"forged_computed_grade"}]'::jsonb,
      'This deterministic computation overstates its grade.',
      now(),
      'Intentional invalid smoke fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    computed_grade_rejected := true;
  END;

  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'crawl', 'derived', 'inferred', 'B', 'available', 'supports',
      '[{"type":"page_set","value":"forged_inferred_grade"}]'::jsonb,
      'This heuristic inference overstates its grade.',
      now(),
      'Intentional invalid smoke fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    inferred_grade_rejected := true;
  END;

  BEGIN
    INSERT INTO app.evidence (
      workspace_id, project_id, diagnostic_run_id, snapshot_id,
      collection_run_id, source_provider, origin, method, grade,
      availability, support, subject_refs, claim, observed_at, limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000602',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000000601',
      'crawl', 'derived', 'observed', 'B', 'available', 'supports',
      '[{"type":"page_set","value":"forged_derived_method"}]'::jsonb,
      'This derived claim tries to masquerade as observed.',
      now(),
      'Intentional invalid smoke fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    derived_method_rejected := true;
  END;

  IF NOT pseudo_provider_rejected THEN
    RAISE EXCEPTION 'source lineage hidden behind a pseudo-provider was accepted';
  END IF;
  IF NOT computed_grade_rejected THEN
    RAISE EXCEPTION 'derived computed evidence with a forged grade was accepted';
  END IF;
  IF NOT inferred_grade_rejected THEN
    RAISE EXCEPTION 'derived inferred evidence with a forged grade was accepted';
  END IF;
  IF NOT derived_method_rejected THEN
    RAISE EXCEPTION 'derived evidence with an observed method was accepted';
  END IF;
END;
$$;

-- Historical evidence is append-only.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.evidence
    SET claim = 'mutated'
    WHERE id = '00000000-0000-4000-8000-000000000901';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'append-only evidence update was accepted';
  END IF;
END;
$$;

INSERT INTO app.findings (
  id, workspace_id, project_id, finding_key, rule_id, rule_version, rule_family,
  intent, domain, title_key, summary, summary_locale, subject_refs, severity,
  confidence, first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
)
VALUES (
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  repeat('5', 64),
  'TECH-LINKGRAPH-005',
  3,
  'internal-link-equity',
  'strengthen_internal_links',
  'technical_seo',
  'finding.tech.linkgraph.title',
  'A priority page has fewer than two observed internal inlinks.',
  'en',
  '[{"type":"page_set","value":"low_internal_inlinks"}]'::jsonb,
  'high',
  'high',
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000602',
  now(),
  now()
);

INSERT INTO app.finding_observations (
  workspace_id, project_id, finding_id, diagnostic_run_id, evidence_id, role
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000901',
  'primary'
);

UPDATE app.findings
SET review_state = 'confirmed', review_revision = 1
WHERE id = '00000000-0000-4000-8000-000000001001';

INSERT INTO app.finding_review_events (
  workspace_id, project_id, finding_id, from_state, to_state, revision, actor_id
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001001',
  'unreviewed',
  'confirmed',
  1,
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.actions (
  id, workspace_id, project_id, source_finding_id, source_diagnostic_run_id,
  action_key, template_id,
  title, description, content_locale, priority_band, roadmap_lane, status,
  effort, risk, expected_outcome, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001101',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000000602',
  repeat('6', 64),
  'strengthen_internal_links.v1',
  'Strengthen internal links to priority pages',
  'Add contextual links from relevant pages to the affected priority page.',
  'en',
  'high',
  'now',
  'candidate',
  'small',
  'low',
  'Increase discoverability and connect high-intent journeys.',
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, attempt_count,
  initiated_by, started_at, completed_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'artifact_generation',
    'failed',
    NULL,
    1,
    '00000000-0000-4000-8000-000000000101',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000604',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'artifact_generation',
    'queued',
    'artifact:smoke-regeneration',
    0,
    '00000000-0000-4000-8000-000000000101',
    NULL,
    NULL
  );

-- A failed generation is allowed to have no revision; ready is not.
INSERT INTO app.execution_artifacts (
  id, workspace_id, project_id, action_id, artifact_type, status,
  generation_mode, output_locale, current_revision, validation_state,
  latest_generation_run_id, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001101',
  'technical_ticket',
  'failed',
  'template',
  'en',
  0,
  'invalid',
  '00000000-0000-4000-8000-000000000603',
  '00000000-0000-4000-8000-000000000101'
);

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.execution_artifacts (
      workspace_id, project_id, action_id, artifact_type, status,
      generation_mode, output_locale, current_revision, validation_state, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001101',
      'content_brief',
      'ready',
      'template',
      'en',
      0,
      'valid',
      '00000000-0000-4000-8000-000000000101'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ready artifact without a revision was accepted';
  END IF;
END;
$$;

-- The database itself rejects bypasses of the frozen Artifact state machine.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'ready', current_revision = 1, validation_state = 'valid'
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'failed artifact transitioned directly to ready';
  END IF;
END;
$$;

-- Merely reusing the failed owner is not a regeneration claim.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'generating'
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'failed artifact reused its old generation Run';
  END IF;
END;
$$;

-- A fresh generation Run is the one legal exit from failed.
UPDATE app.execution_artifacts
SET status = 'generating',
    latest_generation_run_id = '00000000-0000-4000-8000-000000000604'
WHERE id = '00000000-0000-4000-8000-000000001201';

-- Generation completion must advance exactly one revision, not jump pointers.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'draft', current_revision = 2,
        validation_state = 'valid', content_hash = repeat('7', 64)
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'generation completion jumped more than one revision';
  END IF;
END;
$$;

INSERT INTO app.artifact_revisions (
  workspace_id, project_id, artifact_id, revision, output_locale,
  content_format, content_text, content_hash, generated_by, validation_errors
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001201',
  1,
  'en',
  'markdown',
  '# Smoke ticket revision one',
  repeat('7', 64),
  'template',
  '[]'::jsonb
);

UPDATE app.execution_artifacts
SET status = 'draft', current_revision = 1,
    validation_state = 'valid', content_hash = repeat('7', 64)
WHERE id = '00000000-0000-4000-8000-000000001201';

-- A status-only transition cannot smuggle a revision-pointer change.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'ready', current_revision = 2
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'draft to ready changed the revision pointer';
  END IF;
END;
$$;

UPDATE app.execution_artifacts
SET status = 'ready'
WHERE id = '00000000-0000-4000-8000-000000001201';

-- Editing READY content must append exactly one new revision.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'draft'
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ready artifact returned to draft without a revision';
  END IF;
END;
$$;

INSERT INTO app.artifact_revisions (
  workspace_id, project_id, artifact_id, revision, output_locale,
  content_format, content_text, content_hash, generated_by, validation_errors
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001201',
  2,
  'zh-CN',
  'markdown',
  '# Smoke ticket revision two',
  repeat('8', 64),
  'operator',
  '[]'::jsonb
);

UPDATE app.execution_artifacts
SET status = 'draft', current_revision = 2,
    validation_state = 'valid', content_hash = repeat('8', 64)
WHERE id = '00000000-0000-4000-8000-000000001201';

DO $$
BEGIN
  IF (
    SELECT array_agg(output_locale ORDER BY revision)
    FROM app.artifact_revisions
    WHERE artifact_id = '00000000-0000-4000-8000-000000001201'
  ) IS DISTINCT FROM ARRAY['en', 'zh-CN']::text[] THEN
    RAISE EXCEPTION 'artifact revision output locale was not preserved';
  END IF;
END;
$$;

UPDATE app.execution_artifacts
SET status = 'ready'
WHERE id = '00000000-0000-4000-8000-000000001201';

-- Publication freezes the JCS Artifact identity separately from the exact
-- UTF-8 bytes submitted to and observed at the provider.
DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.delivery_authorization_grants (
      id, workspace_id, project_id, site_id, provider_kind, purpose, state,
      requested_scope, requested_scope_hash, authorization_snapshot,
      authorization_snapshot_hash, secret_metadata, expires_at, consumed_at,
      created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000001311',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      'github',
      'connector_configuration',
      'consumed',
      '{"providerKind":"github","repositoryId":101}'::jsonb,
      repeat('7', 64),
      '{"purpose":"connector_configuration"}'::jsonb,
      repeat('6', 64),
      '{}'::jsonb,
      now() - interval '1 hour',
      now(),
      '00000000-0000-4000-8000-000000000101'
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN
    RAISE EXCEPTION 'authorization grant accepted consumption after expiry';
  END IF;
END;
$$;

INSERT INTO app.delivery_authorization_grants (
  id, workspace_id, project_id, site_id, provider_kind, purpose, state,
  destination_ref, destination_revision, target_ref, requested_scope,
  requested_scope_hash, authorization_snapshot, authorization_snapshot_hash,
  secret_metadata, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001301',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'github',
  'connector_configuration',
  'ready',
  '00000000-0000-4000-8000-000000001302',
  1,
  '/smoke-ticket/',
  '{"providerKind":"github","repositoryId":101}'::jsonb,
  repeat('9', 64),
  '{"purpose":"connector_configuration","destinationRevision":1}'::jsonb,
  repeat('a', 64),
  '{}'::jsonb,
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.publication_destinations (
  id, destination_ref, revision, workspace_id, project_id, site_id,
  provider_kind, target_ref, state, authorization_grant_id, provider_scope,
  provider_scope_hash, authorization_snapshot, authorization_snapshot_hash,
  readiness_observation, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001303',
  '00000000-0000-4000-8000-000000001302',
  1,
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'github',
  '/smoke-ticket/',
  'ready',
  '00000000-0000-4000-8000-000000001301',
  '{"providerKind":"github","repositoryId":101,"contentPath":"content/smoke-ticket.md"}'::jsonb,
  repeat('b', 64),
  '{"purpose":"connector_configuration","destinationRevision":1}'::jsonb,
  repeat('a', 64),
  '{"permissionProbe":"passed"}'::jsonb,
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.artifact_approval_events (
  id, workspace_id, project_id, artifact_id, artifact_revision_id,
  artifact_revision, artifact_content_hash, event_kind, event_actor_id,
  reviewer_actor_id, qa_gate_version, qa_gate_snapshot,
  qa_gate_snapshot_hash, customer_acknowledgement,
  customer_acknowledgement_hash
)
SELECT
  '00000000-0000-4000-8000-000000001304',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001201',
  revision.id,
  2,
  repeat('8', 64),
  'approved',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000101',
  'smoke.qa.v1',
  '{"passed":true}'::jsonb,
  repeat('c', 64),
  jsonb_build_object(
    'customerAcknowledgementId',
    '00000000-0000-4000-8000-000000001305',
    'actorId',
    '00000000-0000-4000-8000-000000000101',
    'acknowledgedAt',
    '2026-07-27T12:00:00.000Z',
    'acknowledgementScope',
    'publication'
  ),
  repeat('d', 64)
FROM app.artifact_revisions revision
WHERE revision.artifact_id =
  '00000000-0000-4000-8000-000000001201'
  AND revision.revision = 2;

INSERT INTO app.publication_preview_events (
  id, preview_ref, event_kind, preview_kind, facts_schema_version,
  workspace_id, project_id, site_id, destination_id, destination_ref,
  destination_revision, provider_kind, target_ref, action_id, artifact_id,
  artifact_revision_id, artifact_revision, artifact_content_hash,
  artifact_approval_event_id, artifact_approval_event_kind, provider_plan,
  remote_precondition, rollback_plan, preview_checksum, content_checksum,
  facts_hash, expires_at, event_actor_id, idempotency_key, request_hash
)
SELECT
  '00000000-0000-4000-8000-000000001312',
  'prv_smoke_ticket_revision_2_0000000000000000',
  'issued',
  'publish',
  'publication-preview-facts.v1',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000001303',
  '00000000-0000-4000-8000-000000001302',
  1,
  'github',
  '/smoke-ticket/',
  '00000000-0000-4000-8000-000000001101',
  '00000000-0000-4000-8000-000000001201',
  revision.id,
  2,
  repeat('8', 64),
  '00000000-0000-4000-8000-000000001304',
  'approved',
  '{"providerKind":"github"}'::jsonb,
  '{"kind":"must_match","revision":"main"}'::jsonb,
  '{"providerKind":"github","strategy":"github_revert_pr"}'::jsonb,
  repeat('8', 64),
  encode(
    digest(
      convert_to('# Smoke ticket revision two', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  repeat('2', 64),
  now() + interval '30 minutes',
  '00000000-0000-4000-8000-000000000101',
  'publication-preview-smoke-ticket',
  repeat('3', 64)
FROM app.artifact_revisions revision
WHERE revision.artifact_id =
  '00000000-0000-4000-8000-000000001201'
  AND revision.revision = 2;

INSERT INTO app.delivery_authorization_grants (
  id, workspace_id, project_id, site_id, provider_kind, purpose, state,
  destination_ref, destination_revision, target_ref, requested_scope,
  requested_scope_hash, authorization_snapshot, authorization_snapshot_hash,
  secret_metadata, expires_at, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001306',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'github',
  'publish',
  'ready',
  '00000000-0000-4000-8000-000000001302',
  1,
  '/smoke-ticket/',
  '{"providerKind":"github","repositoryId":101}'::jsonb,
  repeat('e', 64),
  '{"purpose":"publish","destinationRevision":1}'::jsonb,
  repeat('f', 64),
  '{}'::jsonb,
  now() + interval '1 hour',
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, result_type,
  result_id, initiated_by
)
VALUES (
  '00000000-0000-4000-8000-000000001307',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'publication',
  'queued',
  'publication:00000000-0000-4000-8000-000000001302:/smoke-ticket/',
  'publication_attempt',
  '00000000-0000-4000-8000-000000001308',
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.publication_attempts (
  id, attempt_kind, preview_event_id, preview_event_kind, preview_facts_hash,
  workspace_id, project_id, site_id, async_run_id,
  destination_id, destination_ref, destination_revision, provider_kind,
  target_ref, action_id, artifact_id, artifact_revision_id,
  approved_artifact_revision, approved_artifact_content_hash,
  publication_approval_event_id, publication_approval_event_kind,
  side_effect_class, authorization_grant_id, authorization_purpose,
  authorization_snapshot, authorization_snapshot_hash, preview_ref,
  preview_checksum, content_checksum, remote_precondition, rollback_plan,
  idempotency_key, request_hash, requested_by
)
SELECT
  '00000000-0000-4000-8000-000000001308',
  'publish',
  '00000000-0000-4000-8000-000000001312',
  'issued',
  repeat('2', 64),
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000001307',
  '00000000-0000-4000-8000-000000001303',
  '00000000-0000-4000-8000-000000001302',
  1,
  'github',
  '/smoke-ticket/',
  '00000000-0000-4000-8000-000000001101',
  '00000000-0000-4000-8000-000000001201',
  revision.id,
  2,
  repeat('8', 64),
  '00000000-0000-4000-8000-000000001304',
  'approved',
  'external_write',
  '00000000-0000-4000-8000-000000001306',
  'publish',
  '{"purpose":"publish","destinationRevision":1}'::jsonb,
  repeat('f', 64),
  'prv_smoke_ticket_revision_2_0000000000000000',
  repeat('8', 64),
  encode(
    digest(
      convert_to('# Smoke ticket revision two', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  '{"kind":"must_match","revision":"main"}'::jsonb,
  '{"providerKind":"github","strategy":"github_revert_pr"}'::jsonb,
  'publication-smoke-ticket',
  repeat('1', 64),
  '00000000-0000-4000-8000-000000000101'
FROM app.artifact_revisions revision
WHERE revision.artifact_id =
  '00000000-0000-4000-8000-000000001201'
  AND revision.revision = 2;

UPDATE app.delivery_authorization_grants
SET state = 'consumed', consumed_at = now()
WHERE id = '00000000-0000-4000-8000-000000001306';

INSERT INTO app.publication_receipts (
  id, workspace_id, project_id, site_id, publication_attempt_id,
  receipt_kind, provider_kind, provider_request_id, remote_scope_ref,
  remote_object_kind, remote_object_id, remote_revision, delivery_url,
  artifact_content_hash, content_checksum, verification_state, remote_facts,
  evidence_refs, observed_at
)
VALUES (
  '00000000-0000-4000-8000-000000001309',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000001308',
  'delivery_receipt',
  'github',
  'smoke-request-delivery',
  'github:repository:101:pull-request:42',
  'github_pull_request',
  '42',
  'head-sha',
  'https://github.example.test/pull/42',
  repeat('8', 64),
  encode(
    digest(
      convert_to('# Smoke ticket revision two', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  'provider_accepted',
  '{"headSha":"head-sha"}'::jsonb,
  '[]'::jsonb,
  now()
);

DO $$
DECLARE
  rejected_artifact_hash boolean := false;
  rejected_bytes_hash boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.publication_receipts (
      workspace_id, project_id, site_id, publication_attempt_id,
      receipt_kind, predecessor_delivery_receipt_id, provider_kind,
      provider_request_id, remote_scope_ref, remote_object_kind,
      remote_object_id, remote_revision, delivery_url, live_canonical_url,
      artifact_content_hash, content_checksum, verification_state,
      remote_facts, evidence_refs, observed_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000001308',
      'change_receipt',
      '00000000-0000-4000-8000-000000001309',
      'github',
      'smoke-request-change-artifact-mismatch',
      'github:repository:101:pull-request:42',
      'github_merge',
      '42',
      'merge-sha',
      'https://github.example.test/pull/42',
      'https://example.com/smoke-ticket/',
      repeat('7', 64),
      encode(
        digest(
          convert_to('# Smoke ticket revision two', 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      'verified_live',
      '{"mergedSha":"merge-sha"}'::jsonb,
      '["evidence://smoke/live"]'::jsonb,
      now() + interval '1 second'
    );
  EXCEPTION WHEN check_violation THEN
    rejected_artifact_hash := true;
  END;

  BEGIN
    INSERT INTO app.publication_receipts (
      workspace_id, project_id, site_id, publication_attempt_id,
      receipt_kind, predecessor_delivery_receipt_id, provider_kind,
      provider_request_id, remote_scope_ref, remote_object_kind,
      remote_object_id, remote_revision, delivery_url, live_canonical_url,
      artifact_content_hash, content_checksum, verification_state,
      remote_facts, evidence_refs, observed_at
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000001308',
      'change_receipt',
      '00000000-0000-4000-8000-000000001309',
      'github',
      'smoke-request-change-bytes-mismatch',
      'github:repository:101:pull-request:42',
      'github_merge',
      '42',
      'merge-sha',
      'https://github.example.test/pull/42',
      'https://example.com/smoke-ticket/',
      repeat('8', 64),
      repeat('6', 64),
      'verified_live',
      '{"mergedSha":"merge-sha"}'::jsonb,
      '["evidence://smoke/live"]'::jsonb,
      now() + interval '1 second'
    );
  EXCEPTION WHEN check_violation THEN
    rejected_bytes_hash := true;
  END;

  IF NOT rejected_artifact_hash OR NOT rejected_bytes_hash THEN
    RAISE EXCEPTION 'publication receipt accepted a mismatched Artifact or provider bytes hash';
  END IF;
END;
$$;

INSERT INTO app.publication_receipts (
  id, workspace_id, project_id, site_id, publication_attempt_id,
  receipt_kind, predecessor_delivery_receipt_id, provider_kind,
  provider_request_id, remote_scope_ref, remote_object_kind,
  remote_object_id, remote_revision, delivery_url, live_canonical_url,
  artifact_content_hash, content_checksum, verification_state, remote_facts,
  evidence_refs, observed_at
)
VALUES (
  '00000000-0000-4000-8000-000000001310',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000001308',
  'change_receipt',
  '00000000-0000-4000-8000-000000001309',
  'github',
  'smoke-request-change',
  'github:repository:101:pull-request:42',
  'github_merge',
  '42',
  'merge-sha',
  'https://github.example.test/pull/42',
  'https://example.com/smoke-ticket/',
  repeat('8', 64),
  encode(
    digest(
      convert_to('# Smoke ticket revision two', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  'verified_live',
  '{"mergedSha":"merge-sha"}'::jsonb,
  '["evidence://smoke/live"]'::jsonb,
  now() + interval '2 seconds'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM app.publication_attempts attempt
    JOIN app.publication_receipts delivery
      ON delivery.publication_attempt_id = attempt.id
     AND delivery.receipt_kind = 'delivery_receipt'
    JOIN app.publication_receipts change
      ON change.publication_attempt_id = attempt.id
     AND change.receipt_kind = 'change_receipt'
    WHERE attempt.id = '00000000-0000-4000-8000-000000001308'
      AND attempt.approved_artifact_content_hash = repeat('8', 64)
      AND attempt.preview_checksum = attempt.approved_artifact_content_hash
      AND attempt.content_checksum <> attempt.approved_artifact_content_hash
      AND delivery.artifact_content_hash =
        attempt.approved_artifact_content_hash
      AND delivery.content_checksum = attempt.content_checksum
      AND change.artifact_content_hash =
        attempt.approved_artifact_content_hash
      AND change.content_checksum = attempt.content_checksum
  ) THEN
    RAISE EXCEPTION 'publication Artifact identity and provider bytes lineage was not preserved';
  END IF;
END;
$$;

DO $$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE app.execution_artifacts
    SET status = 'archived', current_revision = 3
    WHERE id = '00000000-0000-4000-8000-000000001201';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM = 'artifact status transition is not allowed' THEN
      rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ready to archived changed the revision pointer';
  END IF;
END;
$$;

UPDATE app.execution_artifacts
SET status = 'archived'
WHERE id = '00000000-0000-4000-8000-000000001201';

-- Slice 1 growth-audit persistence only stores traceable canonical references.
INSERT INTO app.capability_runs (
  async_run_id, capability_id, capability_version, input_manifest_hash,
  mode, side_effect_class
)
VALUES (
  '00000000-0000-4000-8000-000000000602',
  'growth-audit',
  '0.3.0',
  repeat('a', 64),
  'production',
  'internal_write'
);

INSERT INTO app.audit_runs (
  id, workspace_id, project_id, diagnostic_run_id, capability_run_id,
  scope_kind, scope_key, projection_version
)
VALUES (
  '00000000-0000-4000-8000-000000001501',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000602',
  '00000000-0000-4000-8000-000000000602',
  'site',
  '00000000-0000-4000-8000-000000000301',
  'growth-audit.0.3.0'
);

INSERT INTO app.audit_module_results (
  audit_run_id, module_id, coverage_state, summary
)
VALUES (
  '00000000-0000-4000-8000-000000001501',
  'technical_search',
  'available',
  '{}'::jsonb
);

INSERT INTO app.site_pages (
  id, workspace_id, project_id, site_id, normalized_url,
  normalized_url_hash
)
VALUES (
  '00000000-0000-4000-8000-000000001601',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'https://example.com/customer-onboarding',
  encode(
    digest(
      convert_to('https://example.com/customer-onboarding', 'UTF8'),
      'sha256'
    ),
    'hex'
  )
);

INSERT INTO app.page_snapshots (
  id, workspace_id, project_id, site_page_id, data_snapshot_id,
  content_hash, canonical_extract, extract, captured_at
)
VALUES (
  '00000000-0000-4000-8000-000000001701',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000001601',
  '00000000-0000-4000-8000-000000000701',
  encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
  '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
  '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
  now()
);

-- A URL-first Crawl run freezes one exact SitePage identity. The accepted row
-- and both negative cases exercise migration 0015, not a client projection.
INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  attempt_count, started_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000681',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'running',
    'collect:crawl:frozen-product-page',
    '00000000-0000-4000-8000-000000000101',
    1,
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000682',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    'collection',
    'running',
    'collect:crawl:mismatched-product-page',
    '00000000-0000-4000-8000-000000000101',
    1,
    now()
  );

INSERT INTO app.collection_runs (
  id, workspace_id, project_id, site_id, source_connection_id,
  provider, operation, method_version, parameters_hash,
  crawl_seed_site_page_id, crawl_seed_url
)
VALUES (
  '00000000-0000-4000-8000-000000000681',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000501',
  'crawl',
  'site_graph',
  'crawl.site_graph.v2',
  repeat('8', 64),
  '00000000-0000-4000-8000-000000001601',
  'https://example.com/customer-onboarding'
);

DO $$
DECLARE
  mismatched_seed_rejected boolean := false;
  seed_mutation_rejected boolean := false;
BEGIN
  IF (
    SELECT crawl_seed_site_page_id =
             '00000000-0000-4000-8000-000000001601'::uuid
       AND crawl_seed_url = 'https://example.com/customer-onboarding'
    FROM app.collection_runs
    WHERE id = '00000000-0000-4000-8000-000000000681'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'exact frozen Crawl seed was not persisted';
  END IF;

  BEGIN
    INSERT INTO app.collection_runs (
      id, workspace_id, project_id, site_id, source_connection_id,
      provider, operation, method_version, parameters_hash,
      crawl_seed_site_page_id, crawl_seed_url
    )
    VALUES (
      '00000000-0000-4000-8000-000000000682',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000501',
      'crawl',
      'site_graph',
      'crawl.site_graph.v2',
      repeat('9', 64),
      '00000000-0000-4000-8000-000000001601',
      'https://example.com/customer-onboarding/'
    );
  EXCEPTION WHEN check_violation THEN
    mismatched_seed_rejected := true;
  END;
  IF NOT mismatched_seed_rejected THEN
    RAISE EXCEPTION 'Crawl seed accepted a different exact URL';
  END IF;

  BEGIN
    UPDATE app.collection_runs
    SET crawl_seed_url = 'https://example.com/customer-onboarding/'
    WHERE id = '00000000-0000-4000-8000-000000000681';
  EXCEPTION WHEN check_violation THEN
    seed_mutation_rejected := true;
  END;
  IF NOT seed_mutation_rejected THEN
    RAISE EXCEPTION 'frozen Crawl seed identity was mutated';
  END IF;
END;
$$;

-- Product Profile synthesis freezes one canonical input manifest and reserves
-- provider budget durably before any network boundary.
INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  attempt_count, started_at
)
VALUES (
  '00000000-0000-4000-8000-000000000691',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'product_profile_synthesis',
  'running',
  'product-profile:smoke',
  '00000000-0000-4000-8000-000000000101',
  1,
  now()
);

INSERT INTO app.product_profile_runs (
  id, workspace_id, project_id, site_id,
  base_icp_profile_id, base_icp_profile_version,
  base_icp_profile_content_hash, source_snapshot_id,
  synthesis_version, prompt_set_version, input_manifest, input_hash
)
VALUES (
  '00000000-0000-4000-8000-000000000691',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000403',
  2,
  repeat('3', 64),
  '00000000-0000-4000-8000-000000000701',
  'product-profile-synthesis.0.3.0',
  'mvp.prompts.product-profile.0.3.0',
  jsonb_build_object(
    'schemaVersion', 'product-profile-synthesis-input.0.3.0',
    'selectionPolicyVersion', 'product-profile-page-selection.0.3.0',
    'projectId', '00000000-0000-4000-8000-000000000201',
    'siteId', '00000000-0000-4000-8000-000000000301',
    'sourcePageUrl', 'https://example.com/customer-onboarding',
    'baseProfile', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000403',
      'version', 2,
      'contentHash', repeat('3', 64),
      'status', 'draft'
    ),
    'crawlSnapshot', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000701'
    ),
    'pages', jsonb_build_array(jsonb_build_object(
      'pageSnapshotId', '00000000-0000-4000-8000-000000001701',
      'sitePageId', '00000000-0000-4000-8000-000000001601',
      'dataSnapshotId', '00000000-0000-4000-8000-000000000701',
      'normalizedUrl', 'https://example.com/customer-onboarding'
    ))
  ),
  repeat('a', 64)
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by
)
VALUES (
  '00000000-0000-4000-8000-000000000692',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'product_profile_synthesis',
  'queued',
  'product-profile:unfrozen-smoke',
  '00000000-0000-4000-8000-000000000101'
);

DO $$
DECLARE
  unfrozen_manifest_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.product_profile_runs (
      id, workspace_id, project_id, site_id,
      base_icp_profile_id, base_icp_profile_version,
      base_icp_profile_content_hash, source_snapshot_id,
      synthesis_version, prompt_set_version, input_manifest, input_hash
    )
    VALUES (
      '00000000-0000-4000-8000-000000000692',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000403',
      2,
      repeat('3', 64),
      '00000000-0000-4000-8000-000000000701',
      'product-profile-synthesis.0.3.0',
      'mvp.prompts.product-profile.0.3.0',
      jsonb_build_object(
        'projectId', '00000000-0000-4000-8000-000000000201',
        'siteId', '00000000-0000-4000-8000-000000000301',
        'sourcePageUrl', 'https://example.com/customer-onboarding',
        'baseProfile', jsonb_build_object(
          'id', '00000000-0000-4000-8000-000000000403',
          'version', 2,
          'contentHash', repeat('3', 64),
          'status', 'draft'
        ),
        'crawlSnapshot', jsonb_build_object(
          'id', '00000000-0000-4000-8000-000000000702'
        )
      ),
      repeat('c', 64)
    );
  EXCEPTION WHEN check_violation THEN
    unfrozen_manifest_rejected := true;
  END;
  IF NOT unfrozen_manifest_rejected THEN
    RAISE EXCEPTION 'product profile run accepted an unfrozen manifest';
  END IF;
END;
$$;

DO $$
DECLARE
  reservation jsonb;
  result jsonb;
  reservation_id uuid;
BEGIN
  reservation := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    1,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  IF reservation ->> 'kind' IS DISTINCT FROM 'reserved'
     OR (
       SELECT count(*)
       FROM app.product_profile_invocation_attempts
       WHERE product_profile_run_id =
         '00000000-0000-4000-8000-000000000691'
     ) <> 1 THEN
    RAISE EXCEPTION 'product profile invocation reservation was not persisted';
  END IF;
  reservation_id := (reservation #>> '{reservation,id}')::uuid;

  UPDATE app.async_runs
  SET attempt_count = 2
  WHERE id = '00000000-0000-4000-8000-000000000691';

  result := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    2,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  IF result ->> 'kind' IS DISTINCT FROM 'unresolved'
     OR (
       SELECT count(*)
       FROM app.product_profile_invocation_attempts
       WHERE product_profile_run_id =
         '00000000-0000-4000-8000-000000000691'
     ) <> 1 THEN
    RAISE EXCEPTION 'unresolved product profile invocation allowed another provider call';
  END IF;

  result := app.finalize_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    1,
    reservation_id,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64),
    NULL,
    'failed',
    NULL,
    NULL,
    NULL,
    1,
    'PROVIDER_FAILED'
  );
  IF result ->> 'kind' IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'first product profile reservation did not finalize';
  END IF;

  reservation := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    2,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  reservation_id := (reservation #>> '{reservation,id}')::uuid;
  result := app.finalize_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    2,
    reservation_id,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64),
    NULL,
    'failed',
    NULL,
    NULL,
    NULL,
    1,
    'PROVIDER_FAILED'
  );
  IF result ->> 'kind' IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'second product profile reservation did not finalize';
  END IF;

  UPDATE app.async_runs
  SET attempt_count = 3
  WHERE id = '00000000-0000-4000-8000-000000000691';

  reservation := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    3,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  reservation_id := (reservation #>> '{reservation,id}')::uuid;
  result := app.finalize_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    3,
    reservation_id,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64),
    repeat('e', 64),
    'succeeded',
    10,
    20,
    0.001,
    2,
    NULL
  );
  IF result ->> 'kind' IS DISTINCT FROM 'finalized' THEN
    RAISE EXCEPTION 'third product profile reservation did not finalize';
  END IF;

  UPDATE app.async_runs
  SET attempt_count = 4
  WHERE id = '00000000-0000-4000-8000-000000000691';

  result := app.reserve_product_profile_invocation_attempt(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000691',
    4,
    'openai',
    'gpt-smoke',
    'mvp.prompts.product-profile.0.3.0',
    repeat('b', 64)
  );
  IF result ->> 'kind' IS DISTINCT FROM 'budget_exhausted'
     OR (
       SELECT count(*)
       FROM app.product_profile_invocation_attempts
       WHERE product_profile_run_id =
         '00000000-0000-4000-8000-000000000691'
     ) <> 3 THEN
    RAISE EXCEPTION 'a fourth product profile invocation reservation was accepted';
  END IF;
END;
$$;

DO $$
DECLARE
  successful_invocation_id uuid;
  invalid_profile jsonb;
  validation jsonb;
  invalid_profile_rejected boolean := false;
BEGIN
  SELECT analysis_invocation_id
  INTO successful_invocation_id
  FROM app.product_profile_invocation_attempts
  WHERE product_profile_run_id =
      '00000000-0000-4000-8000-000000000691'
    AND status = 'succeeded';

  invalid_profile := jsonb_build_object(
    'profileSchemaVersion', 'product-profile.0.3.0',
    'sourceSiteId', '00000000-0000-4000-8000-000000000301',
    'sourceSnapshotId', '00000000-0000-4000-8000-000000000701',
    'analysisInvocationId', successful_invocation_id::text,
    'generatedAt', '2026-07-22T00:00:00.000Z',
    'fieldProvenance', jsonb_build_array(jsonb_build_object(
      'fieldPath', '/product/name',
      'evidenceRefs', jsonb_build_array(jsonb_build_object(
        'kind', 'pageSnapshot',
        'pageSnapshotId', '00000000-0000-4000-8000-000000009999'
      ))
    ))
  );
  validation := app.validate_product_profile_provenance(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    invalid_profile
  );
  IF validation ->> 'ok' IS DISTINCT FROM 'false'
     OR validation::text NOT LIKE '%page_snapshot_missing%' THEN
    RAISE EXCEPTION 'product profile provenance accepted a foreign canonical reference';
  END IF;

  BEGIN
    INSERT INTO app.icp_profiles (
      workspace_id, project_id, version, status, profile, content_hash, created_by
    )
    VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      3,
      'draft',
      invalid_profile,
      repeat('d', 64),
      '00000000-0000-4000-8000-000000000101'
    );
  EXCEPTION WHEN check_violation THEN
    invalid_profile_rejected := true;
  END;
  IF NOT invalid_profile_rejected THEN
    RAISE EXCEPTION 'invalid Product Profile provenance reached canonical ICP storage';
  END IF;
END;
$$;

DO $$
DECLARE
  duplicate_module_rejected boolean := false;
  capability_mutation_rejected boolean := false;
  audit_mutation_rejected boolean := false;
  module_mutation_rejected boolean := false;
  page_snapshot_mutation_rejected boolean := false;
  duplicate_page_source_rejected boolean := false;
  page_snapshot_capture_mismatch_rejected boolean := false;
  page_snapshot_hash_mismatch_rejected boolean := false;
  page_snapshot_payload_mismatch_rejected boolean := false;
  page_snapshot_missing_canonical_rejected boolean := false;
  page_snapshot_schema_mismatch_rejected boolean := false;
  page_snapshot_fetch_identity_rejected boolean := false;
  site_page_hash_mismatch_rejected boolean := false;
  site_page_identity_mutation_rejected boolean := false;
  forbidden_status_count integer;
BEGIN
  BEGIN
    INSERT INTO app.audit_module_results (
      audit_run_id, module_id, coverage_state, summary
    ) VALUES (
      '00000000-0000-4000-8000-000000001501',
      'technical_search',
      'partial',
      '{}'::jsonb
    );
  EXCEPTION WHEN unique_violation THEN
    duplicate_module_rejected := true;
  END;
  IF NOT duplicate_module_rejected THEN
    RAISE EXCEPTION 'duplicate audit module result was accepted';
  END IF;

  BEGIN
    UPDATE app.capability_runs
    SET mode = 'shadow'
    WHERE async_run_id = '00000000-0000-4000-8000-000000000602';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    capability_mutation_rejected := true;
  END;
  IF NOT capability_mutation_rejected THEN
    RAISE EXCEPTION 'capability run mutation was accepted';
  END IF;

  BEGIN
    UPDATE app.audit_runs
    SET scope_key = 'unexpected'
    WHERE id = '00000000-0000-4000-8000-000000001501';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    audit_mutation_rejected := true;
  END;
  IF NOT audit_mutation_rejected THEN
    RAISE EXCEPTION 'audit run mutation was accepted';
  END IF;

  BEGIN
    UPDATE app.audit_module_results
    SET coverage_state = 'partial'
    WHERE audit_run_id = '00000000-0000-4000-8000-000000001501'
      AND module_id = 'technical_search';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    module_mutation_rejected := true;
  END;
  IF NOT module_mutation_rejected THEN
    RAISE EXCEPTION 'audit module result mutation was accepted';
  END IF;

  BEGIN
    UPDATE app.page_snapshots
    SET extract = '{}'::jsonb
    WHERE id = '00000000-0000-4000-8000-000000001701';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    page_snapshot_mutation_rejected := true;
  END;
  IF NOT page_snapshot_mutation_rejected THEN
    RAISE EXCEPTION 'page snapshot mutation was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN unique_violation THEN
    duplicate_page_source_rejected := true;
  END;
  IF NOT duplicate_page_source_rejected THEN
    RAISE EXCEPTION 'a second extract for one page/source snapshot was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now() + interval '1 second'
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_capture_mismatch_rejected := true;
  END;
  IF NOT page_snapshot_capture_mismatch_rejected THEN
    RAISE EXCEPTION 'a page snapshot with a different source capture time was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      repeat('f', 64),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_hash_mismatch_rejected := true;
  END;
  IF NOT page_snapshot_hash_mismatch_rejected THEN
    RAISE EXCEPTION 'a page snapshot hash unrelated to its retained bytes was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":1,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_payload_mismatch_rejected := true;
  END;
  IF NOT page_snapshot_payload_mismatch_rejected THEN
    RAISE EXCEPTION 'retained page bytes unrelated to the page extract were accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_missing_canonical_rejected := true;
  END;
  IF NOT page_snapshot_missing_canonical_rejected THEN
    RAISE EXCEPTION 'a new page snapshot without retained extract bytes was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v0","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v0","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/customer-onboarding"},"schemaVersion":"crawl.page-extract.v0","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_schema_mismatch_rejected := true;
  END;
  IF NOT page_snapshot_schema_mismatch_rejected THEN
    RAISE EXCEPTION 'a page snapshot with an unknown extract schema was accepted';
  END IF;

  BEGIN
    INSERT INTO app.page_snapshots (
      workspace_id, project_id, site_page_id, data_snapshot_id,
      content_hash, canonical_extract, extract, captured_at
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001601',
      '00000000-0000-4000-8000-000000000701',
      encode(digest(convert_to('{"depth":0,"projection":{"fetchUrl":"https://example.com/other"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}', 'UTF8'), 'sha256'), 'hex'),
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/other"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}',
      '{"depth":0,"projection":{"fetchUrl":"https://example.com/other"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/customer-onboarding"}'::jsonb,
      now()
    );
  EXCEPTION WHEN check_violation THEN
    page_snapshot_fetch_identity_rejected := true;
  END;
  IF NOT page_snapshot_fetch_identity_rejected THEN
    RAISE EXCEPTION 'a page snapshot for another fetch URL was accepted';
  END IF;

  BEGIN
    INSERT INTO app.site_pages (
      workspace_id, project_id, site_id, normalized_url, normalized_url_hash
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      'https://example.com/forged-hash',
      repeat('f', 64)
    );
  EXCEPTION WHEN check_violation THEN
    site_page_hash_mismatch_rejected := true;
  END;
  IF NOT site_page_hash_mismatch_rejected THEN
    RAISE EXCEPTION 'a site page with a caller-forged URL hash was accepted';
  END IF;

  BEGIN
    UPDATE app.site_pages
    SET normalized_url = 'https://example.com/mutated'
    WHERE id = '00000000-0000-4000-8000-000000001601';
  EXCEPTION WHEN check_violation THEN
    site_page_identity_mutation_rejected := true;
  END;
  IF NOT site_page_identity_mutation_rejected THEN
    RAISE EXCEPTION 'a durable site page identity was mutated';
  END IF;

  SELECT count(*) INTO forbidden_status_count
  FROM information_schema.columns
  WHERE table_schema = 'app'
    AND table_name IN ('capability_runs', 'audit_runs')
    AND column_name = 'status';
  IF forbidden_status_count <> 0 THEN
    RAISE EXCEPTION 'growth audit projection introduced a second status';
  END IF;
END;
$$;

-- Observation-to-SitePage lineage smoke uses only canonical rows and proves
-- that analytics ambiguity remains explicit rather than being guessed.
INSERT INTO app.source_connections (
  id, workspace_id, project_id, site_id, provider, connection_type, state,
  external_ref, scopes, limitation, connected_at, created_by
)
VALUES (
  '00000000-0000-4000-8000-000000001851',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  'gsc',
  'oauth',
  'connected',
  'sc-domain:example.com',
  ARRAY['https://www.googleapis.com/auth/webmasters.readonly']::text[],
  'Schema smoke GSC lineage fixture.',
  now(),
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.async_runs (
  id, workspace_id, project_id, kind, status, active_key, initiated_by,
  started_at
)
VALUES (
  '00000000-0000-4000-8000-000000001861',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'collection',
  'running',
  'collect:gsc:site-page-lineage-smoke',
  '00000000-0000-4000-8000-000000000101',
  now()
);

INSERT INTO app.collection_runs (
  id, workspace_id, project_id, site_id, source_connection_id,
  provider, operation, method_version, parameters_hash
)
VALUES (
  '00000000-0000-4000-8000-000000001861',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000001851',
  'gsc',
  'search_analytics',
  'gsc.search_analytics.v1',
  repeat('c', 64)
);

INSERT INTO app.data_snapshots (
  id, workspace_id, project_id, site_id, collection_run_id,
  source_connection_id, provider, dataset_key, schema_version,
  method_version, captured_at, source_window, availability,
  limitation, row_count, checksum
)
VALUES (
  '00000000-0000-4000-8000-000000001871',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000001861',
  '00000000-0000-4000-8000-000000001851',
  'gsc',
  'gsc.page_query_daily.v1',
  'gsc.page.v1',
  'gsc.search_analytics.v1',
  now(),
  '{"start":"2026-05-01","end":"2026-06-25"}'::jsonb,
  'available',
  'Schema smoke GSC lineage fixture.',
  2,
  repeat('d', 64)
);

INSERT INTO app.site_pages (
  id, workspace_id, project_id, site_id, normalized_url, normalized_url_hash
)
VALUES
  (
    '00000000-0000-4000-8000-000000001801',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'https://example.com/lineage-crawl',
    encode(digest(convert_to('https://example.com/lineage-crawl', 'UTF8'), 'sha256'), 'hex')
  ),
  (
    '00000000-0000-4000-8000-000000001802',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'https://example.com/lineage-unique/',
    encode(digest(convert_to('https://example.com/lineage-unique/', 'UTF8'), 'sha256'), 'hex')
  ),
  (
    '00000000-0000-4000-8000-000000001803',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'https://example.com/lineage-ambiguous',
    encode(digest(convert_to('https://example.com/lineage-ambiguous', 'UTF8'), 'sha256'), 'hex')
  ),
  (
    '00000000-0000-4000-8000-000000001804',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'https://example.com/lineage-ambiguous/',
    encode(digest(convert_to('https://example.com/lineage-ambiguous/', 'UTF8'), 'sha256'), 'hex')
  ),
  (
    '00000000-0000-4000-8000-000000001805',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    'https://example.com/lineage-other',
    encode(digest(convert_to('https://example.com/lineage-other', 'UTF8'), 'sha256'), 'hex')
  );

DO $$
DECLARE
  crawl_without_lineage_rejected boolean := false;
  crawl_fetch_mismatch_rejected boolean := false;
  crawl_subject_splice_rejected boolean := false;
  non_url_lineage_rejected boolean := false;
  analytics_ambiguous_lineage_rejected boolean := false;
  analytics_wrong_variant_rejected boolean := false;
  page_snapshot_count_before integer;
  page_snapshot_count_after integer;
BEGIN
  SELECT count(*)
  INTO page_snapshot_count_before
  FROM app.page_snapshots
  WHERE site_page_id IN (
    '00000000-0000-4000-8000-000000001801',
    '00000000-0000-4000-8000-000000001802',
    '00000000-0000-4000-8000-000000001803',
    '00000000-0000-4000-8000-000000001804',
    '00000000-0000-4000-8000-000000001805'
  );

  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, site_page_id,
    provider, metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  )
  VALUES (
    '00000000-0000-4000-8000-000000001901',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000701',
    '00000000-0000-4000-8000-000000001801',
    'crawl',
    'crawl.page.v1',
    'url',
    'https://example.com/lineage-crawl',
    (SELECT captured_at FROM app.data_snapshots
      WHERE id = '00000000-0000-4000-8000-000000000701'),
    'available',
    '{"fetchUrl":"https://example.com/lineage-crawl","status":200}'::jsonb,
    'direct_public',
    'B',
    'supports',
    'Exact Crawl SitePage lineage.'
  );

  BEGIN
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, site_page_id,
      provider, metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000001902',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000701',
      NULL,
      'crawl',
      'crawl.page.v1',
      'url',
      'https://example.com/lineage-crawl',
      (SELECT captured_at FROM app.data_snapshots
        WHERE id = '00000000-0000-4000-8000-000000000701'),
      'available',
      '{"fetchUrl":"https://example.com/lineage-crawl","status":200}'::jsonb,
      'direct_public',
      'B',
      'supports',
      'Missing Crawl SitePage lineage must fail.'
    );
  EXCEPTION WHEN check_violation THEN
    crawl_without_lineage_rejected := true;
  END;
  IF NOT crawl_without_lineage_rejected THEN
    RAISE EXCEPTION 'a new Crawl page Observation without SitePage lineage was accepted';
  END IF;

  BEGIN
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, site_page_id,
      provider, metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000001903',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000001801',
      'crawl',
      'crawl.page.v1',
      'url',
      'https://example.com/lineage-crawl',
      (SELECT captured_at FROM app.data_snapshots
        WHERE id = '00000000-0000-4000-8000-000000000701'),
      'available',
      '{"fetchUrl":"https://example.com/lineage-other","status":200}'::jsonb,
      'direct_public',
      'B',
      'supports',
      'Mismatched Crawl fetch identity must fail.'
    );
  EXCEPTION WHEN check_violation THEN
    crawl_fetch_mismatch_rejected := true;
  END;
  IF NOT crawl_fetch_mismatch_rejected THEN
    RAISE EXCEPTION 'Crawl Observation accepted a mismatched exact fetch SitePage';
  END IF;

  BEGIN
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, site_page_id,
      provider, metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000001909',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000001801',
      'crawl',
      'crawl.page.v1',
      'url',
      'https://example.com/forged-canonical-subject',
      (SELECT captured_at FROM app.data_snapshots
        WHERE id = '00000000-0000-4000-8000-000000000701'),
      'available',
      '{"fetchUrl":"https://example.com/lineage-crawl","status":200}'::jsonb,
      'direct_public',
      'B',
      'supports',
      'Forged Crawl canonical subject must fail.'
    );
  EXCEPTION WHEN check_violation THEN
    crawl_subject_splice_rejected := true;
  END;
  IF NOT crawl_subject_splice_rejected THEN
    RAISE EXCEPTION 'Crawl Observation accepted a forged canonical subject_ref';
  END IF;

  BEGIN
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, site_page_id,
      provider, metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000001904',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000701',
      '00000000-0000-4000-8000-000000001801',
      'crawl',
      'crawl.robots.v1',
      'site',
      'https://example.com',
      (SELECT captured_at FROM app.data_snapshots
        WHERE id = '00000000-0000-4000-8000-000000000701'),
      'available',
      '{}'::jsonb,
      'direct_public',
      'B',
      'context',
      'Non-URL Observation must not reference SitePage.'
    );
  EXCEPTION WHEN check_violation THEN
    non_url_lineage_rejected := true;
  END;
  IF NOT non_url_lineage_rejected THEN
    RAISE EXCEPTION 'a non-URL Observation accepted SitePage lineage';
  END IF;

  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, site_page_id,
    provider, metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  )
  VALUES (
    '00000000-0000-4000-8000-000000001905',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000001871',
    '00000000-0000-4000-8000-000000001802',
    'gsc',
    'gsc.page.v1',
    'url',
    'https://example.com/lineage-unique',
    (SELECT captured_at FROM app.data_snapshots
      WHERE id = '00000000-0000-4000-8000-000000001871'),
    'available',
    '{}'::jsonb,
    'first_party',
    'A',
    'supports',
    'Unique GSC slash variant lineage.'
  );

  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, site_page_id,
    provider, metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  )
  VALUES (
    '00000000-0000-4000-8000-000000001910',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000001871',
    '00000000-0000-4000-8000-000000001802',
    'gsc',
    'gsc.page.v1',
    'url',
    'https://example.com/lineage-unique/',
    (SELECT captured_at FROM app.data_snapshots
      WHERE id = '00000000-0000-4000-8000-000000001871'),
    'available',
    '{}'::jsonb,
    'first_party',
    'A',
    'supports',
    'Slash-form GSC subject resolves through the same canonical candidate set.'
  );

  BEGIN
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, site_page_id,
      provider, metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000001906',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001871',
      '00000000-0000-4000-8000-000000001803',
      'gsc',
      'gsc.page.v1',
      'url',
      'https://example.com/lineage-ambiguous',
      (SELECT captured_at FROM app.data_snapshots
        WHERE id = '00000000-0000-4000-8000-000000001871'),
      'available',
      '{}'::jsonb,
      'first_party',
      'A',
      'supports',
      'Ambiguous GSC lineage must not guess.'
    );
  EXCEPTION WHEN check_violation THEN
    analytics_ambiguous_lineage_rejected := true;
  END;
  IF NOT analytics_ambiguous_lineage_rejected THEN
    RAISE EXCEPTION 'ambiguous analytics Observation accepted a non-null SitePage';
  END IF;

  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, site_page_id,
    provider, metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  )
  VALUES (
    '00000000-0000-4000-8000-000000001907',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000001871',
    NULL,
    'gsc',
    'gsc.page.v1',
    'url',
    'https://example.com/lineage-ambiguous',
    (SELECT captured_at FROM app.data_snapshots
      WHERE id = '00000000-0000-4000-8000-000000001871'),
    'available',
    '{}'::jsonb,
    'first_party',
    'A',
    'context',
    'Ambiguous GSC lineage remains explicitly unavailable.'
  );

  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, site_page_id,
    provider, metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  )
  VALUES (
    '00000000-0000-4000-8000-000000001911',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000001871',
    NULL,
    'gsc',
    'gsc.page.v1',
    'url',
    'https://example.com/lineage-not-crawled',
    (SELECT captured_at FROM app.data_snapshots
      WHERE id = '00000000-0000-4000-8000-000000001871'),
    'available',
    '{}'::jsonb,
    'first_party',
    'A',
    'context',
    'A real analytics page absent from Crawl remains explicitly unlinked.'
  );

  BEGIN
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, site_page_id,
      provider, metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    )
    VALUES (
      '00000000-0000-4000-8000-000000001908',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000001871',
      '00000000-0000-4000-8000-000000001805',
      'gsc',
      'gsc.page.v1',
      'url',
      'https://example.com/lineage-unique',
      (SELECT captured_at FROM app.data_snapshots
        WHERE id = '00000000-0000-4000-8000-000000001871'),
      'available',
      '{}'::jsonb,
      'first_party',
      'A',
      'supports',
      'Wrong GSC exact variant must fail.'
    );
  EXCEPTION WHEN check_violation THEN
    analytics_wrong_variant_rejected := true;
  END;
  IF NOT analytics_wrong_variant_rejected THEN
    RAISE EXCEPTION 'analytics Observation accepted a non-candidate SitePage';
  END IF;

  IF (
    SELECT site_page_id
    FROM app.normalized_observations
    WHERE id = '00000000-0000-4000-8000-000000001901'
  ) IS DISTINCT FROM '00000000-0000-4000-8000-000000001801'::uuid THEN
    RAISE EXCEPTION 'exact Crawl SitePage lineage was not persisted';
  END IF;

  IF (
    SELECT site_page_id
    FROM app.normalized_observations
    WHERE id = '00000000-0000-4000-8000-000000001905'
  ) IS DISTINCT FROM '00000000-0000-4000-8000-000000001802'::uuid THEN
    RAISE EXCEPTION 'unique analytics SitePage lineage was not persisted';
  END IF;

  IF (
    SELECT site_page_id IS NULL
    FROM app.normalized_observations
    WHERE id = '00000000-0000-4000-8000-000000001907'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ambiguous analytics lineage did not remain explicitly null';
  END IF;

  IF (
    SELECT site_page_id IS NULL
    FROM app.normalized_observations
    WHERE id = '00000000-0000-4000-8000-000000001911'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'analytics lineage absent from Crawl did not remain explicitly null';
  END IF;

  SELECT count(*)
  INTO page_snapshot_count_after
  FROM app.page_snapshots
  WHERE site_page_id IN (
    '00000000-0000-4000-8000-000000001801',
    '00000000-0000-4000-8000-000000001802',
    '00000000-0000-4000-8000-000000001803',
    '00000000-0000-4000-8000-000000001804',
    '00000000-0000-4000-8000-000000001805'
  );
  IF page_snapshot_count_after IS DISTINCT FROM page_snapshot_count_before THEN
    RAISE EXCEPTION 'Observation lineage fabricated a PageSnapshot';
  END IF;
END;
$$;

-- TECH-INDEXABILITY-006 carries one direct URL root backed only by exact Crawl
-- fetch lineage. The two PageSnapshots below are contextual bytes for already
-- proven SitePages; neither is fabricated by the Observation lineage guard.
INSERT INTO app.page_snapshots (
  id, workspace_id, project_id, site_page_id, data_snapshot_id,
  content_hash, canonical_extract, extract, captured_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000003101',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000001801',
    '00000000-0000-4000-8000-000000000701',
    encode(
      digest(
        convert_to(
          '{"depth":0,"projection":{"fetchUrl":"https://example.com/lineage-crawl"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/lineage-crawl"}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    '{"depth":0,"projection":{"fetchUrl":"https://example.com/lineage-crawl"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/lineage-crawl"}',
    '{"depth":0,"projection":{"fetchUrl":"https://example.com/lineage-crawl"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/lineage-crawl"}'::jsonb,
    (SELECT captured_at FROM app.data_snapshots
      WHERE id = '00000000-0000-4000-8000-000000000701')
  ),
  (
    '00000000-0000-4000-8000-000000003102',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000001802',
    '00000000-0000-4000-8000-000000000701',
    encode(
      digest(
        convert_to(
          '{"depth":0,"projection":{"fetchUrl":"https://example.com/lineage-unique/"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/lineage-unique"}',
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    '{"depth":0,"projection":{"fetchUrl":"https://example.com/lineage-unique/"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/lineage-unique"}',
    '{"depth":0,"projection":{"fetchUrl":"https://example.com/lineage-unique/"},"schemaVersion":"crawl.page-extract.v1","subjectUrl":"https://example.com/lineage-unique"}'::jsonb,
    (SELECT captured_at FROM app.data_snapshots
      WHERE id = '00000000-0000-4000-8000-000000000701')
  );

INSERT INTO app.findings (
  id, workspace_id, project_id, finding_key, rule_id, rule_version,
  rule_family, intent, domain, title_key, summary, summary_locale,
  subject_refs, severity, confidence, first_seen_run_id, last_seen_run_id,
  first_seen_at, last_seen_at
)
VALUES (
  '00000000-0000-4000-8000-000000003103',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  encode(
    digest(
      convert_to('contextual-indexability-smoke', 'UTF8'),
      'sha256'
    ),
    'hex'
  ),
  'TECH-INDEXABILITY-006',
  1,
  'indexability',
  'investigate',
  'technical_seo',
  'finding.tech.indexability.title',
  'A sitemap URL has an exact observed non-indexable signal.',
  'en',
  '[{"type":"url","value":"https://example.com/lineage-crawl"}]'::jsonb,
  'high',
  'high',
  '00000000-0000-4000-8000-000000000620',
  '00000000-0000-4000-8000-000000000620',
  now(),
  now()
);

DO $contextual_finding_target$
DECLARE
  wrong_relation_rejected boolean := false;
  unresolved_rejected boolean := false;
  non_crawl_rejected boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.finding_targets (
      workspace_id, project_id, site_id, finding_id, diagnostic_run_id,
      relation, target_kind, target_ref, resolution_state, basis_kind,
      site_page_id, page_snapshot_id, source_observation_id, member_ref
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000003103',
      '00000000-0000-4000-8000-000000000620',
      'affected_by_page_set',
      'page_set',
      'indexability-pages',
      'resolved',
      'crawl_exact_fetch',
      '00000000-0000-4000-8000-000000001801',
      '00000000-0000-4000-8000-000000003101',
      '00000000-0000-4000-8000-000000001901',
      'https://example.com/lineage-crawl'
    );
  EXCEPTION WHEN check_violation THEN
    wrong_relation_rejected := true;
  END;

  BEGIN
    INSERT INTO app.finding_targets (
      workspace_id, project_id, site_id, finding_id, diagnostic_run_id,
      relation, target_kind, target_ref, resolution_state, basis_kind,
      site_page_id, page_snapshot_id, source_observation_id, member_ref,
      limitation
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000003103',
      '00000000-0000-4000-8000-000000000620',
      'direct_url',
      'url',
      'https://example.com/lineage-crawl',
      'unresolved',
      'unresolved_observation',
      NULL,
      NULL,
      '00000000-0000-4000-8000-000000001901',
      'https://example.com/lineage-crawl',
      'Exact Crawl rules cannot emit unresolved target members.'
    );
  EXCEPTION WHEN check_violation THEN
    unresolved_rejected := true;
  END;

  BEGIN
    INSERT INTO app.finding_targets (
      workspace_id, project_id, site_id, finding_id, diagnostic_run_id,
      relation, target_kind, target_ref, resolution_state, basis_kind,
      site_page_id, page_snapshot_id, source_observation_id, member_ref
    ) VALUES (
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000003103',
      '00000000-0000-4000-8000-000000000620',
      'direct_url',
      'url',
      'https://example.com/lineage-unique/',
      'resolved',
      'crawl_exact_fetch',
      '00000000-0000-4000-8000-000000001802',
      '00000000-0000-4000-8000-000000003102',
      '00000000-0000-4000-8000-000000001905',
      'https://example.com/lineage-unique'
    );
  EXCEPTION WHEN check_violation THEN
    non_crawl_rejected := true;
  END;

  INSERT INTO app.finding_targets (
    workspace_id, project_id, site_id, finding_id, diagnostic_run_id,
    relation, target_kind, target_ref, resolution_state, basis_kind,
    site_page_id, page_snapshot_id, source_observation_id, member_ref
  ) VALUES (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000003103',
    '00000000-0000-4000-8000-000000000620',
    'direct_url',
    'url',
    'https://example.com/lineage-crawl',
    'resolved',
    'crawl_exact_fetch',
    '00000000-0000-4000-8000-000000001801',
    '00000000-0000-4000-8000-000000003101',
    '00000000-0000-4000-8000-000000001901',
    'https://example.com/lineage-crawl'
  );

  IF NOT wrong_relation_rejected
     OR NOT unresolved_rejected
     OR NOT non_crawl_rejected THEN
    RAISE EXCEPTION 'contextual indexability Finding target guards are incomplete';
  END IF;
END;
$contextual_finding_target$;

INSERT INTO app.async_runs (
  id,
  workspace_id,
  project_id,
  kind,
  status,
  active_key,
  contract_version,
  result_type,
  result_id,
  initiated_by
) VALUES (
  '00000000-0000-4000-8000-000000002901',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'analysis_refresh',
  'queued',
  'analysis_refresh',
  '2026-07-21',
  'analysis_refresh_run',
  '00000000-0000-4000-8000-000000002901',
  '00000000-0000-4000-8000-000000000101'
);

INSERT INTO app.analysis_refresh_runs (
  id,
  workspace_id,
  project_id,
  site_id,
  icp_profile_id,
  plan_manifest,
  plan_hash
) VALUES (
  '00000000-0000-4000-8000-000000002901',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000401',
  '{
    "version": "analysis-refresh.plan.v1",
    "steps": [
      {"ordinal": 1, "stepKey": "crawl", "required": true},
      {"ordinal": 2, "stepKey": "gsc", "required": false},
      {"ordinal": 3, "stepKey": "ga4", "required": false},
      {"ordinal": 4, "stepKey": "dataforseo", "required": false},
      {"ordinal": 5, "stepKey": "growth_audit", "required": true}
    ]
  }'::jsonb,
  'd725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af'
);

INSERT INTO app.analysis_refresh_steps (
  analysis_refresh_run_id,
  workspace_id,
  project_id,
  ordinal,
  step_key,
  required
) VALUES
  (
    '00000000-0000-4000-8000-000000002901',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    1,
    'crawl',
    true
  ),
  (
    '00000000-0000-4000-8000-000000002901',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    2,
    'gsc',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002901',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    3,
    'ga4',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002901',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    4,
    'dataforseo',
    false
  ),
  (
    '00000000-0000-4000-8000-000000002901',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000201',
    5,
    'growth_audit',
    true
  );

-- A second Crawl lineage fixture proves that a completed step cannot borrow a
-- same-provider Snapshot from any collection other than its frozen child.
INSERT INTO app.async_runs (
  id,
  workspace_id,
  project_id,
  kind,
  status,
  active_key,
  contract_version,
  initiated_by,
  started_at,
  completed_at
) VALUES (
  '00000000-0000-4000-8000-000000002911',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  'collection',
  'completed',
  'collect:crawl:analysis-refresh-wrong-lineage',
  '2026-07-21',
  '00000000-0000-4000-8000-000000000101',
  now(),
  now()
);

INSERT INTO app.collection_runs (
  id,
  workspace_id,
  project_id,
  site_id,
  source_connection_id,
  provider,
  operation,
  method_version,
  parameters_hash
) VALUES (
  '00000000-0000-4000-8000-000000002911',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000501',
  'crawl',
  'site_graph',
  'crawl.site_graph.v2',
  repeat('e', 64)
);

INSERT INTO app.data_snapshots (
  id,
  workspace_id,
  project_id,
  site_id,
  collection_run_id,
  source_connection_id,
  provider,
  dataset_key,
  schema_version,
  method_version,
  captured_at,
  source_window,
  availability,
  limitation,
  row_count,
  checksum
) VALUES (
  '00000000-0000-4000-8000-000000002912',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000002911',
  '00000000-0000-4000-8000-000000000501',
  'crawl',
  'crawl.site_graph.v1',
  'crawl.site_graph.v2',
  'crawl.site_graph.v2',
  now(),
  '{"start":null,"end":null}'::jsonb,
  'available',
  'Analysis Refresh wrong-lineage fixture.',
  1,
  repeat('f', 64)
);

UPDATE app.collection_runs
SET
  source_window = '{"start":null,"end":null}'::jsonb,
  row_count = 1
WHERE id = '00000000-0000-4000-8000-000000002911';

UPDATE app.analysis_refresh_steps
SET
  state = 'skipped',
  skip_reason = 'source_not_connected',
  completed_at = now()
WHERE analysis_refresh_run_id =
    '00000000-0000-4000-8000-000000002901'
  AND step_key = 'gsc';

DO $analysis_refresh_contract$
BEGIN
  IF (
    SELECT count(*)
    FROM app.analysis_refresh_steps
    WHERE analysis_refresh_run_id =
      '00000000-0000-4000-8000-000000002901'
  ) <> 5 OR (
    SELECT state
    FROM app.analysis_refresh_steps
    WHERE analysis_refresh_run_id =
      '00000000-0000-4000-8000-000000002901'
      AND step_key = 'gsc'
  ) IS DISTINCT FROM 'skipped' THEN
    RAISE EXCEPTION 'Analysis Refresh fixed plan or optional skip did not persist';
  END IF;

  BEGIN
    UPDATE app.analysis_refresh_steps
    SET
      state = 'running',
      child_async_run_id =
        '00000000-0000-4000-8000-000000000607',
      started_at = now()
    WHERE analysis_refresh_run_id =
        '00000000-0000-4000-8000-000000002901'
      AND step_key = 'crawl';
    RAISE EXCEPTION 'Analysis Refresh accepted a wrong-provider child run';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE app.analysis_refresh_steps
  SET
    state = 'running',
    child_async_run_id =
      '00000000-0000-4000-8000-000000000601',
    started_at = now()
  WHERE analysis_refresh_run_id =
      '00000000-0000-4000-8000-000000002901'
    AND step_key = 'crawl';

  BEGIN
    UPDATE app.analysis_refresh_steps
    SET
      state = 'completed',
      result_snapshot_id =
        '00000000-0000-4000-8000-000000002912',
      completed_at = now()
    WHERE analysis_refresh_run_id =
        '00000000-0000-4000-8000-000000002901'
      AND step_key = 'crawl';
    RAISE EXCEPTION 'Analysis Refresh accepted a Snapshot from another child';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE app.analysis_refresh_steps
  SET
    state = 'completed',
    result_snapshot_id =
      '00000000-0000-4000-8000-000000000701',
    completed_at = now()
  WHERE analysis_refresh_run_id =
      '00000000-0000-4000-8000-000000002901'
    AND step_key = 'crawl';

  IF (
    SELECT result_snapshot_id
    FROM app.analysis_refresh_steps
    WHERE analysis_refresh_run_id =
      '00000000-0000-4000-8000-000000002901'
      AND step_key = 'crawl'
  ) IS DISTINCT FROM
      '00000000-0000-4000-8000-000000000701'::uuid THEN
    RAISE EXCEPTION 'Analysis Refresh exact child Snapshot did not persist';
  END IF;

  BEGIN
    UPDATE app.analysis_refresh_runs
    SET plan_hash = plan_hash
    WHERE id = '00000000-0000-4000-8000-000000002901';
    RAISE EXCEPTION 'Analysis Refresh parent accepted a mutation';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE app.analysis_refresh_steps
    SET
      state = 'skipped',
      skip_reason = 'invalid_required_skip',
      completed_at = now()
    WHERE analysis_refresh_run_id =
      '00000000-0000-4000-8000-000000002901'
      AND step_key = 'growth_audit';
    RAISE EXCEPTION 'required Analysis Refresh step accepted skipped';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE app.analysis_refresh_steps
    SET skip_reason = 'rewritten_terminal_fact'
    WHERE analysis_refresh_run_id =
      '00000000-0000-4000-8000-000000002901'
      AND step_key = 'gsc';
    RAISE EXCEPTION 'terminal Analysis Refresh step accepted a rewrite';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$analysis_refresh_contract$;


DO $$
DECLARE
  locale_constraint_count integer;
BEGIN
  IF NOT app.is_bcp47_language_tag('en-US-u-hc-h12')
     OR NOT app.is_bcp47_language_tag('x-private')
     OR NOT app.is_bcp47_language_tag('i-klingon')
     OR app.is_bcp47_language_tag('de-1901-1901')
     OR app.is_bcp47_language_tag('en-a-first-a-second')
     OR app.is_bcp47_language_tag('en-u') THEN
    RAISE EXCEPTION 'RFC 5646 locale validation is inconsistent';
  END IF;
  IF NOT app.are_bcp47_language_tags(
    ARRAY['en-US-u-hc-h12', 'x-private']::text[]
  ) OR NOT app.are_bcp47_language_tags(
    ARRAY[]::text[]
  ) OR app.are_bcp47_language_tags(
    ARRAY['en', 'de-1901-1901']::text[]
  ) THEN
    RAISE EXCEPTION 'RFC 5646 locale array validation is inconsistent';
  END IF;
  SELECT count(*)
  INTO locale_constraint_count
  FROM pg_constraint
  WHERE connamespace = 'app'::regnamespace
    AND conname = ANY (ARRAY[
      'client_projects_default_delivery_locale_check',
      'sites_language_codes_bcp47_check',
      'diagnostic_runs_output_locale_check',
      'findings_summary_locale_check',
      'actions_content_locale_check',
      'execution_artifacts_output_locale_check',
      'artifact_revisions_output_locale_check',
      'export_bundles_output_locale_check'
    ]::text[])
    AND pg_get_constraintdef(oid) LIKE '%bcp47_language_tag%';
  IF locale_constraint_count <> 8 THEN
    RAISE EXCEPTION 'expected eight canonical RFC 5646 constraints, found %',
      locale_constraint_count;
  END IF;
  IF (
    SELECT contract_version
    FROM app.async_runs
    WHERE id = '00000000-0000-4000-8000-000000000601'
  ) IS DISTINCT FROM '2026-07-21' THEN
    RAISE EXCEPTION 'async run contract-version default is stale';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.export_bundles'::regclass
      AND conname = 'export_bundles_schema_version_check'
      AND pg_get_constraintdef(oid) LIKE '%signalframe.service-bundle.0.2.0%'
      AND pg_get_constraintdef(oid) LIKE '%signalframe.service-bundle.0.3.0%'
  ) THEN
    RAISE EXCEPTION 'export bundle schema-version compatibility is stale';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.page_snapshots'::regclass
      AND conname = 'page_snapshots_canonical_extract_required'
      AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%canonical_extract IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'page snapshot canonical extract requirement is missing or unvalidated';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.page_snapshots'::regclass
      AND conname = 'page_snapshots_site_page_data_snapshot_key'
      AND pg_get_constraintdef(oid) LIKE '%UNIQUE (site_page_id, data_snapshot_id)%'
  ) THEN
    RAISE EXCEPTION 'page snapshot page/source identity is not globally unique';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND tablename = 'page_snapshots'
      AND indexname = 'page_snapshots_verified_source_identity_idx'
      AND indexdef LIKE '%UNIQUE INDEX%'
      AND indexdef LIKE '%(site_page_id, data_snapshot_id)%'
      AND indexdef LIKE '%WHERE (canonical_extract IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'verified page snapshot identity index is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.evidence'::regclass
      AND conname = 'evidence_source_lineage_required'
      AND convalidated
      AND obj_description(oid, 'pg_constraint') = 'signalframe.evidence-provenance.v2'
      AND pg_get_constraintdef(oid) LIKE '%snapshot_id IS NOT NULL%'
      AND pg_get_constraintdef(oid) LIKE '%collection_run_id IS NOT NULL%'
      AND pg_get_constraintdef(oid) LIKE '%source_provider = ''system''%'
      AND pg_get_constraintdef(oid) LIKE '%source_provider = ''llm''%'
      AND pg_get_constraintdef(oid) LIKE '%source_provider = ''dataforseo''%'
      AND pg_get_constraintdef(oid) LIKE '%origin = ''derived''%'
      AND pg_get_constraintdef(oid) LIKE '%origin = ''generated''%'
      AND pg_get_constraintdef(oid) LIKE '%method = ''computed''%'
      AND pg_get_constraintdef(oid) LIKE '%method = ''inferred''%'
      AND pg_get_constraintdef(oid) LIKE '%grade = ''C''%'
  ) THEN
    RAISE EXCEPTION 'evidence provenance-shape requirement is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'app.evidence'::regclass
      AND tgname = 'evidence_provenance_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'evidence provenance guard is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.diagnostic_runs'::regclass
      AND conname = 'diagnostic_runs_rule_set_version_check'
      AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%mvp.rules.0.2.0%'
      AND pg_get_constraintdef(oid) LIKE '%mvp.rules.0.2.1%'
      AND pg_get_constraintdef(oid) LIKE '%mvp.rules.0.2.2%'
      AND pg_get_constraintdef(oid) LIKE '%mvp.rules.0.2.3%'
      AND pg_get_constraintdef(oid) LIKE '%mvp.rules.0.2.4%'
  ) THEN
    RAISE EXCEPTION 'diagnostic rule-set compatibility is stale';
  END IF;
  IF (
    SELECT is_nullable = 'YES' AND data_type = 'uuid'
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = 'normalized_observations'
      AND column_name = 'site_page_id'
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'normalized Observation SitePage lineage column is missing or non-nullable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.normalized_observations'::regclass
      AND conname = 'normalized_observations_site_page_fk'
      AND contype = 'f'
      AND confrelid = 'app.site_pages'::regclass
      AND confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'normalized Observation SitePage FK is missing or not restrictive';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE connamespace = 'app'::regnamespace
      AND conrelid = 'app.normalized_observations'::regclass
      AND conname = 'normalized_observations_site_page_subject_check'
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%site_page_id IS NULL%'
      AND pg_get_constraintdef(oid) LIKE '%subject_type = ''url''%'
  ) THEN
    RAISE EXCEPTION 'normalized Observation URL-subject lineage check is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND tablename = 'normalized_observations'
      AND indexname = 'normalized_observations_site_page_metric_idx'
      AND indexdef LIKE '%(project_id, site_page_id, metric_key, observed_at DESC, id DESC)%'
      AND indexdef LIKE '%WHERE (site_page_id IS NOT NULL)%'
  ) THEN
    RAISE EXCEPTION 'normalized Observation SitePage metric index is missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND (
        (tgrelid = 'app.normalized_observations'::regclass
          AND tgname = 'normalized_observations_site_page_guard')
        OR
        (tgrelid = 'app.site_pages'::regclass
          AND tgname = 'site_pages_canonical_subject_lock')
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'Observation SitePage lineage triggers are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_proc
    WHERE pronamespace = 'app'::regnamespace
      AND proname IN (
        'lock_site_page_canonical_subjects',
        'lock_site_page_canonical_subject',
        'enforce_normalized_observation_site_page_lineage'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Observation SitePage lineage lock/guard functions are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'app.finding_targets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%resolution_state%'
      AND pg_get_constraintdef(oid) LIKE '%resolved%'
      AND pg_get_constraintdef(oid) LIKE '%unresolved%'
      AND pg_get_constraintdef(oid) LIKE '%definition_only%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'app.finding_targets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%direct_url%'
      AND pg_get_constraintdef(oid) LIKE '%affected_by_user_agent%'
      AND pg_get_constraintdef(oid) LIKE '%target_kind%'
  ) THEN
    RAISE EXCEPTION 'Finding target ledger relation and resolution constraints are missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND tablename = 'finding_targets'
      AND indexname = ANY (ARRAY[
        'finding_targets_one_direct_root_idx',
        'finding_targets_one_definition_root_idx',
        'finding_targets_one_observation_member_idx',
        'finding_targets_site_page_read_idx',
        'finding_targets_finding_run_read_idx',
        'finding_targets_operational_idx'
      ]::text[])
  ) <> 6 THEN
    RAISE EXCEPTION 'Finding target ledger indexes are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE tgrelid = 'app.finding_targets'::regclass
      AND NOT tgisinternal
      AND tgname IN (
        'finding_targets_lineage_guard',
        'finding_targets_append_only'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'Finding target lineage and append-only guards are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT proname)
    FROM pg_proc
    WHERE pronamespace = 'app'::regnamespace
      AND proname IN (
        'finding_target_relation_key',
        'enforce_finding_target_lineage'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'Finding target runtime routines are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN (
        'keyword_relation_identities',
        'keyword_relation_candidates',
        'keyword_relation_decisions'
      )
      AND table_type = 'BASE TABLE'
  ) <> 3 THEN
    RAISE EXCEPTION 'Keyword Relation governance tables are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname IN (
        'keyword_relation_identities_keyword_a_idx',
        'keyword_relation_identities_keyword_b_idx',
        'keyword_relation_candidates_latest_idx',
        'keyword_relation_decisions_latest_idx'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Keyword Relation governance indexes are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'keyword_relation_candidates_insert_guard',
        'keyword_relation_identities_append_only',
        'keyword_relation_candidates_append_only',
        'keyword_relation_decisions_insert_guard',
        'keyword_relation_decisions_append_only'
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'Keyword Relation governance triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT proname)
    FROM pg_proc
    WHERE pronamespace = 'app'::regnamespace
      AND proname IN (
        'normalize_keyword_relation_semantic',
        'keyword_relation_token_overlap',
        'keyword_relation_candidate_stale_reasons',
        'enforce_keyword_relation_candidate_insert',
        'enforce_keyword_relation_decision_insert'
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'Keyword Relation governance routines are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN (
        'action_execution_step_definitions',
        'action_execution_state_events'
      )
      AND table_type = 'BASE TABLE'
  ) <> 2 THEN
    RAISE EXCEPTION 'Action Execution authority tables are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname IN (
        'action_execution_step_definitions_scope_idx',
        'action_execution_state_events_current_idx'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'Action Execution authority indexes are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'action_execution_step_definitions_insert_guard',
        'action_execution_step_definitions_append_only',
        'action_execution_state_events_insert_guard',
        'action_execution_state_events_append_only'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Action Execution authority triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT proname)
    FROM pg_proc
    WHERE pronamespace = 'app'::regnamespace
      AND proname IN (
        'enforce_action_execution_step_definition_insert',
        'enforce_action_execution_state_insert'
      )
  ) <> 2 THEN
    RAISE EXCEPTION 'Action Execution authority routines are incomplete';
  END IF;
  -- The server-owned freezer is the only actual BCP-47 canonicalizer. These
  -- database routines compare singleton Site spelling with its app-canonical
  -- manifest/Keyword tag by case-only identity; they do not canonicalize it.
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'app.enforce_keyword_review_suggestion_mutation()'::regprocedure,
      'app.insert_keyword_review_suggestions_batch(uuid,uuid,uuid,text,text,uuid,jsonb)'::regprocedure,
      'app.supersede_stale_pending_keyword_review_suggestions(uuid,uuid)'::regprocedure
    ]) locale_authority(routine_oid)
    WHERE position(
      'default_delivery_locale'
      IN pg_get_functiondef(locale_authority.routine_oid::oid)
    ) > 0
      OR position(
        'cardinality(primary_site.language_codes) = 1'
        IN pg_get_functiondef(locale_authority.routine_oid::oid)
      ) = 0
      OR position(
        'app.is_bcp47_canonical_identity('
        IN pg_get_functiondef(locale_authority.routine_oid::oid)
      ) = 0
      OR position(
        'primary_site.language_codes[1]'
        IN pg_get_functiondef(locale_authority.routine_oid::oid)
      ) = 0
  ) THEN
    RAISE EXCEPTION 'Keyword suggestion locale authority routines drifted';
  END IF;
  IF position(
    'RETURN jsonb_build_object(''kind'', ''stale_authority'')'
    IN pg_get_functiondef(
      'app.insert_keyword_review_suggestions_batch(uuid,uuid,uuid,text,text,uuid,jsonb)'::regprocedure::oid
    )
  ) = 0 THEN
    RAISE EXCEPTION 'Keyword suggestion final authority CAS is incomplete';
  END IF;
  IF (
    SELECT migration_version FROM app.schema_migration_version
  ) IS DISTINCT FROM '0053_keyword_governance_suggestion_locale_authority' THEN
    RAISE EXCEPTION 'database migration version projection is stale';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'app.oauth_intents'::regclass
      AND conname = 'oauth_intents_redirect_path_check'
      AND pg_get_constraintdef(oid) LIKE '%(sources|setup-sources)%'
  ) THEN
    RAISE EXCEPTION 'OAuth return paths do not include exact optional source onboarding';
  END IF;
  IF NOT app.is_typed_product_profile_evidence_refs(
    '[{"evidenceRefId":"d3b07384-d9a0-8f1e-9c2b-4a5e6f708192","kind":"userEdit"}]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Product Profile UUIDv8 evidence identity was rejected';
  END IF;
  IF app.is_typed_product_profile_evidence_refs(
    '[{"evidenceRefId":"d3b07384-d9a0-9f1e-9c2b-4a5e6f708192","kind":"userEdit"}]'::jsonb
  ) THEN
    RAISE EXCEPTION 'unsupported Product Profile evidence UUID version was accepted';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN (
        'competitor_monitor_settings',
        'competitor_monitor_runs',
        'competitor_monitor_evaluations',
        'competitor_monitor_signals'
      )
      AND table_type = 'BASE TABLE'
  ) <> 4 THEN
    RAISE EXCEPTION 'Competitor Monitor authority tables are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname IN (
        'competitor_monitor_runs_competitor_created_idx',
        'competitor_monitor_evaluations_competitor_time_idx',
        'competitor_monitor_signals_competitor_time_idx',
        'competitor_monitor_signals_rank_unique_idx',
        'competitor_monitor_signals_content_unique_idx'
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'Competitor Monitor authority indexes are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'competitor_monitor_runs_insert_guard',
        'competitor_monitor_evaluations_insert_guard',
        'competitor_monitor_signals_insert_guard',
        'competitor_monitor_runs_append_only',
        'competitor_monitor_evaluations_append_only',
        'competitor_monitor_signals_append_only'
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'Competitor Monitor authority triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT proname)
    FROM pg_proc
    WHERE pronamespace = 'app'::regnamespace
      AND proname IN (
        'enforce_competitor_monitor_run_insert',
        'enforce_competitor_monitor_evaluation_insert',
        'enforce_competitor_monitor_signal_insert'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Competitor Monitor authority routines are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN (
        'geo_query_observations',
        'geo_citation_occurrences'
      )
      AND table_type = 'BASE TABLE'
  ) <> 2 THEN
    RAISE EXCEPTION 'GEO citation authority tables are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname IN (
        'geo_query_observations_identity_idx',
        'geo_query_observations_normalized_idx',
        'geo_citation_occurrences_query_idx'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'GEO citation authority indexes are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (
        'geo_normalized_observations_lineage_guard',
        'geo_normalized_observations_completeness_guard',
        'geo_query_observations_insert_guard',
        'geo_query_observations_completeness_guard',
        'geo_query_observations_append_only',
        'geo_citation_occurrences_insert_guard',
        'geo_citation_occurrences_completeness_guard',
        'geo_citation_occurrences_append_only'
      )
  ) <> 8 THEN
    RAISE EXCEPTION 'GEO citation authority triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT proname)
    FROM pg_proc
    WHERE pronamespace = 'app'::regnamespace
      AND proname IN (
        'enforce_geo_normalized_observation_insert',
        'enforce_geo_query_observation_insert',
        'enforce_geo_citation_occurrence_insert',
        'enforce_geo_evidence_completeness'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'GEO citation authority routines are incomplete';
  END IF;
  IF position(
    '''voc''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.source_connections'::regclass
        AND constraint_row.conname = 'source_connections_provider_check'
    )
  ) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'VOC must remain an internal source rather than a customer-managed connection';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_constraint constraint_row
    WHERE (
      constraint_row.conrelid = 'app.collection_runs'::regclass
      AND (
        (
          constraint_row.conname = 'collection_runs_provider_check'
          AND pg_get_constraintdef(constraint_row.oid) LIKE '%voc%'
        )
        OR (
          constraint_row.conname = 'collection_runs_operation_check'
          AND pg_get_constraintdef(constraint_row.oid)
            LIKE '%keyword_evidence_collection%'
        )
      )
    )
    OR (
      constraint_row.conrelid = 'app.data_snapshots'::regclass
      AND constraint_row.conname IN (
        'data_snapshots_provider_check',
        'data_snapshots_dataset_key_check'
      )
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%voc%'
    )
    OR (
      constraint_row.conrelid = 'app.normalized_observations'::regclass
      AND constraint_row.conname = 'normalized_observations_provider_check'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%voc%'
    )
    OR (
      constraint_row.conrelid = 'app.keyword_occurrences'::regclass
      AND constraint_row.conname = 'keyword_occurrences_source_kind_check'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%interview_summary%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%user_review%'
    )
  ) <> 6 THEN
    RAISE EXCEPTION 'VOC Keyword evidence constraints are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger trigger_row
    JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'app'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgname IN (
        'collection_runs_voc_provenance_guard',
        'data_snapshots_voc_provenance_guard',
        'normalized_observations_voc_provenance_guard',
        'keyword_occurrences_voc_lineage_guard'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'VOC Keyword evidence triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT procedure.proname)
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname IN (
        'enforce_voc_collection_run_provenance',
        'enforce_voc_data_snapshot_provenance',
        'enforce_voc_keyword_evidence_observation',
        'enforce_voc_keyword_occurrence_lineage'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'VOC Keyword evidence routines are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'app'
      AND table_name IN (
        'backlink_authority_snapshots',
        'backlink_facts',
        'backlink_page_metrics'
      )
      AND table_type = 'BASE TABLE'
  ) <> 3 THEN
    RAISE EXCEPTION 'Backlink Growth Map authority tables are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname IN (
        'backlink_authority_identity_idx',
        'backlink_authority_subject_source_idx',
        'backlink_facts_target_page_idx',
        'backlink_facts_referring_domain_idx',
        'backlink_page_metrics_page_idx'
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'Backlink Growth Map authority indexes are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger trigger_row
    JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'app'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgname IN (
        'backlink_authority_snapshots_insert_guard',
        'backlink_facts_insert_guard',
        'backlink_page_metrics_insert_guard',
        'backlink_authority_snapshots_append_only',
        'backlink_facts_append_only',
        'backlink_page_metrics_append_only'
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'Backlink Growth Map authority triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT procedure.proname)
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname IN (
        'enforce_backlink_authority_snapshot_insert',
        'enforce_backlink_fact_insert',
        'enforce_backlink_page_metric_insert'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Backlink Growth Map authority routines are incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = 'backlink_facts'
      AND column_name IN (
        'anchor_text',
        'first_seen_at',
        'last_seen_at',
        'is_new',
        'is_lost',
        'verification_status',
        'verified_at',
        'verification_final_url',
        'verification_http_status',
        'verification_limitation'
      )
  ) <> 10 THEN
    RAISE EXCEPTION 'DataForSEO backlink fact evidence columns are incomplete';
  END IF;
  IF position(
    '''backlinks''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.collection_runs'::regclass
        AND constraint_row.conname = 'collection_runs_operation_check'
    )
  ) = 0 THEN
    RAISE EXCEPTION 'DataForSEO Backlinks collection operation is absent';
  END IF;
  IF position(
    '''dataforseo.backlinks.v1''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.data_snapshots'::regclass
        AND constraint_row.conname = 'data_snapshots_dataset_key_check'
    )
  ) = 0 THEN
    RAISE EXCEPTION 'DataForSEO Backlinks dataset is absent';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger trigger_row
    JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'app'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgname IN (
        'collection_runs_dataforseo_backlinks_provenance_guard',
        'data_snapshots_dataforseo_backlinks_provenance_guard',
        'normalized_observations_dataforseo_backlinks_provenance_guard'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'DataForSEO Backlinks provenance triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT procedure.proname)
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname IN (
        'enforce_dataforseo_backlinks_collection_run_provenance',
        'enforce_dataforseo_backlinks_data_snapshot_provenance',
        'enforce_dataforseo_backlinks_observation_provenance'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'DataForSEO Backlinks provenance routines are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid =
      'app.backlink_authority_snapshots'::regclass
      AND constraint_row.conname =
        'backlink_authority_snapshots_provider_metric_check'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%dataforseo%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%dataforseo_rank%'
  ) THEN
    RAISE EXCEPTION 'DataForSEO authority metric scale is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'app.backlink_facts'::regclass
      AND constraint_row.conname = 'backlink_facts_verification_status_check'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%not_checked%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%verified%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%absent%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%blocked%'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%inconclusive%'
  ) THEN
    RAISE EXCEPTION 'Backlink source verification states are incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'app.analysis_refresh_runs'::regclass
      AND constraint_row.conname =
        'analysis_refresh_runs_plan_contract_check'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%analysis-refresh.plan.v2%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%dataforseo_backlinks%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%3049a718f77263f766e47d0d7318a9414520d07c8ab92960f50c85b864977c65%'
  ) THEN
    RAISE EXCEPTION 'Analysis Refresh v2 backlinks plan contract is incomplete';
  END IF;
  IF position(
    '''backlink_v1''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.import_previews'::regclass
        AND constraint_row.conname = 'import_previews_template_id_check'
    )
  ) = 0 THEN
    RAISE EXCEPTION 'Backlink CSV template is missing from governed import previews';
  END IF;
  IF position(
    'ahrefs' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.source_connections'::regclass
        AND constraint_row.conname = 'source_connections_provider_check'
    )
  ) <> 0 OR position(
    'moz' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.source_connections'::regclass
        AND constraint_row.conname = 'source_connections_provider_check'
    )
  ) <> 0 OR position(
    'backlink' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.source_connections'::regclass
        AND constraint_row.conname = 'source_connections_provider_check'
    )
  ) <> 0 THEN
    RAISE EXCEPTION 'Backlink providers must remain built-in Growth Map evidence rather than customer-managed connections';
  END IF;
END;
$$;

DO $product_profile_keyword_lineage_contract$
DECLARE
  batch_source text;
BEGIN
  -- This SQL helper is deliberately a case-identity predicate against an
  -- app-canonical second argument, not an Intl alias detector. The same-alias
  -- result stays true here; the server-owned freezer rejects it before freeze.
  IF NOT app.is_bcp47_canonical_identity('en-us', 'en-US')
     OR NOT app.is_bcp47_canonical_identity(
       'zh-hans-cn-u-nu-hanidec',
       'zh-Hans-CN-u-nu-hanidec'
     )
     OR NOT app.is_bcp47_canonical_identity('iw-IL', 'iw-IL')
     OR app.is_bcp47_canonical_identity('en-US', 'en-us')
     OR app.is_bcp47_canonical_identity('iw-IL', 'he-IL')
     OR app.is_bcp47_canonical_identity('not_a_locale', 'not-a-locale') THEN
    RAISE EXCEPTION 'Product Profile BCP-47 canonical identity is unsafe';
  END IF;
  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'app'
      AND table_name = 'keyword_occurrences'
      AND column_name = 'product_profile_id'
      AND data_type = 'uuid'
      AND is_nullable = 'YES'
  ) <> 1 THEN
    RAISE EXCEPTION 'Product Profile Keyword identity column is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'app.keyword_occurrences'::regclass
      AND constraint_row.conname = 'keyword_occurrences_product_profile_fk'
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'app.icp_profiles'::regclass
      AND constraint_row.confdeltype = 'r'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid) LIKE
        'FOREIGN KEY (product_profile_id) REFERENCES %icp_profiles(id) ON DELETE RESTRICT'
  ) THEN
    RAISE EXCEPTION 'Product Profile Keyword FK authority is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'app.keyword_occurrences'::regclass
      AND constraint_row.conname = 'keyword_occurrences_source_kind_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%product_profile%'
  ) THEN
    RAISE EXCEPTION 'Product Profile Keyword source discriminator is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'app.keyword_occurrences'::regclass
      AND constraint_row.conname = 'keyword_occurrences_lineage_shape_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%source_kind = ''product_profile''::text%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%scope_basis = ''project_context''::text%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%query_kind = ''generative_query''::text%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%product_profile_id IS NOT NULL%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%data_snapshot_id IS NULL%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%normalized_observation_id IS NULL%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%source_pointer IS NULL%'
      AND pg_get_constraintdef(constraint_row.oid)
        LIKE '%provider_data_as_of IS NULL%'
  ) THEN
    RAISE EXCEPTION 'Product Profile Keyword row-shape authority is incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger trigger_row
    JOIN pg_proc procedure ON procedure.oid = trigger_row.tgfoid
    WHERE trigger_row.tgrelid = 'app.keyword_occurrences'::regclass
      AND NOT trigger_row.tgisinternal
      AND (
        (
          trigger_row.tgname = 'keyword_occurrences_lineage_guard'
          AND procedure.proname = 'enforce_keyword_occurrence_lineage'
          AND pg_get_triggerdef(trigger_row.oid) LIKE '%product_profile%'
        )
        OR (
          trigger_row.tgname = 'keyword_occurrences_voc_lineage_guard'
          AND procedure.proname = 'enforce_voc_keyword_occurrence_lineage'
        )
        OR (
          trigger_row.tgname =
            'keyword_occurrences_product_profile_lineage_guard'
          AND procedure.proname =
            'enforce_product_profile_keyword_occurrence_lineage'
          AND pg_get_triggerdef(trigger_row.oid) LIKE '%product_profile%'
        )
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'Product Profile Keyword trigger routing is incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname = 'upsert_keyword_library_occurrence'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname = 'upsert_keyword_library_occurrence'
      AND procedure.pronargs = 17
      AND procedure.proargnames[6] = 'selected_product_profile_id'
  ) THEN
    RAISE EXCEPTION 'Keyword scalar authority is not the exact 17-argument shape';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname = 'upsert_keyword_library_occurrences_batch'
  ) <> 1 THEN
    RAISE EXCEPTION 'Keyword batch authority has an unexpected overload';
  END IF;
  SELECT procedure.prosrc
  INTO batch_source
  FROM pg_proc procedure
  WHERE procedure.pronamespace = 'app'::regnamespace
    AND procedure.proname = 'upsert_keyword_library_occurrences_batch'
    AND procedure.pronargs = 3;
  IF batch_source IS NULL
     OR batch_source NOT LIKE '%jsonb_object_keys(selected_input)) <> 15%'
     OR (
       SELECT count(*)
       FROM unnest(ARRAY[
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
       ]::text[]) AS expected_key
       WHERE position(expected_key IN batch_source) > 0
     ) <> 15
     OR batch_source NOT LIKE
       '%(selected_input ->> ''productProfileId'')::uuid%' THEN
    RAISE EXCEPTION 'Keyword batch authority is not the exact 15-key shape';
  END IF;
END;
$product_profile_keyword_lineage_contract$;

DO $dataforseo_backlinks_behavior$
#variable_conflict use_variable
DECLARE
  workspace_id uuid := gen_random_uuid();
  project_id uuid := gen_random_uuid();
  site_id uuid := gen_random_uuid();
  source_id uuid := gen_random_uuid();
  run_id uuid := gen_random_uuid();
  snapshot_id uuid := gen_random_uuid();
  summary_observation_id uuid := gen_random_uuid();
  detail_observation_id uuid := gen_random_uuid();
  domain_detail_observation_id uuid := gen_random_uuid();
  authority_id uuid := gen_random_uuid();
  actor_id uuid := gen_random_uuid();
  host text := project_id::text || '.backlinks-smoke.example';
  unavailable_authority_rejected boolean := false;
  foreign_dataforseo_target_rejected boolean := false;
  credential_dataforseo_target_rejected boolean := false;
  port_dataforseo_target_rejected boolean := false;
  uppercase_dataforseo_target_rejected boolean := false;
  prefixed_dataforseo_target_rejected boolean := false;
BEGIN
  INSERT INTO app.workspaces (id, name)
  VALUES (workspace_id, 'DataForSEO Backlinks smoke');
  INSERT INTO app.client_projects (
    id, workspace_id, client_name, project_name,
    default_delivery_locale, created_by
  ) VALUES (
    project_id, workspace_id, 'Backlinks client',
    'Backlinks project', 'zh-CN', actor_id
  );
  INSERT INTO app.sites (
    id, workspace_id, project_id, origin, host,
    market_codes, language_codes, is_primary
  ) VALUES (
    site_id, workspace_id, project_id, 'https://' || host, host,
    ARRAY['US'], ARRAY['en-US'], true
  );
  INSERT INTO app.source_connections (
    id, workspace_id, project_id, site_id, provider,
    connection_type, state, external_ref, limitation,
    connected_at, created_by
  ) VALUES (
    source_id, workspace_id, project_id, site_id, 'dataforseo',
    'api_key_stub', 'available', host,
    'Schema smoke uses deterministic local rows, not a provider call.',
    '2026-08-06T08:00:00.000Z', actor_id
  );
  INSERT INTO app.async_runs (
    id, workspace_id, project_id, kind, status,
    initiated_by, started_at
  ) VALUES (
    run_id, workspace_id, project_id, 'collection', 'running',
    actor_id, '2026-08-06T08:00:00.000Z'
  );
  INSERT INTO app.collection_runs (
    id, workspace_id, project_id, site_id, source_connection_id,
    provider, operation, method_version, parameters_hash
  ) VALUES (
    run_id, workspace_id, project_id, site_id, source_id,
    'dataforseo', 'backlinks',
    'dataforseo.backlinks.v1', repeat('c', 64)
  );
  INSERT INTO app.data_snapshots (
    id, workspace_id, project_id, site_id, collection_run_id,
    source_connection_id, provider, dataset_key, schema_version,
    method_version, captured_at, source_window, availability,
    limitation, row_count, checksum, summary
  ) VALUES (
    snapshot_id, workspace_id, project_id, site_id, run_id, source_id,
    'dataforseo', 'dataforseo.backlinks.v1',
    'dataforseo.backlinks.v1', 'dataforseo.backlinks.v1',
    '2026-08-06T08:00:00.000Z',
    '{"start":null,"end":null}'::jsonb, 'available',
    'Provider details are a bounded sample while summary totals are complete.',
    3, repeat('d', 64), '{}'::jsonb
  );
  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, provider,
    metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  ) VALUES (
    summary_observation_id, workspace_id, project_id, snapshot_id,
    'dataforseo', 'dataforseo.backlink_summary.v1', 'site', host,
    '2026-08-06T08:00:00.000Z', 'available',
    jsonb_build_object(
      'targetDomain', host,
      'rank', 54,
      'backlinks', 1240,
      'referringDomains', 87
    ),
    'vendor_observation', 'B', 'supports',
    'Provider details are a bounded sample while summary totals are complete.'
  );
  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, provider,
    metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  ) VALUES (
    domain_detail_observation_id, workspace_id, project_id, snapshot_id,
    'dataforseo', 'dataforseo.backlink.v1', 'url',
    'https://www.' || host || '/guide',
    '2026-08-06T08:00:00.000Z', 'available',
    jsonb_build_object(
      'sourceRef', 'provider-row-2',
      'referringDomain', 'second-publisher.example',
      'sourceUrl', 'https://second-publisher.example/article',
      'targetUrl', 'https://www.' || host || '/guide',
      'sourceRank', 57,
      'linkKind', 'nofollow',
      'anchorText', 'Alternate host guide',
      'firstSeenAt', '2026-07-02T00:00:00.000Z',
      'lastSeenAt', '2026-08-06T08:00:00.000Z',
      'isNew', false,
      'isLost', false,
      'verification', null
    ),
    'vendor_observation', 'B', 'supports',
    'Provider details are a bounded sample while summary totals are complete.'
  );
  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, provider,
    metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  ) VALUES (
    detail_observation_id, workspace_id, project_id, snapshot_id,
    'dataforseo', 'dataforseo.backlink.v1', 'url',
    'https://' || host || '/guide',
    '2026-08-06T08:00:00.000Z', 'available',
    jsonb_build_object(
      'sourceRef', 'provider-row-1',
      'referringDomain', 'publisher.example',
      'sourceUrl', 'https://publisher.example/article',
      'targetUrl', 'https://' || host || '/guide',
      'sourceRank', 63,
      'linkKind', 'dofollow',
      'anchorText', 'Astrology guide',
      'firstSeenAt', '2026-07-01T00:00:00.000Z',
      'lastSeenAt', '2026-08-06T08:00:00.000Z',
      'isNew', true,
      'isLost', false,
      'verification', jsonb_build_object(
        'status', 'verified',
        'checkedAt', '2026-08-06T08:00:00.000Z',
        'finalUrl', 'https://publisher.example/article',
        'httpStatus', 200,
        'limitation', null
      )
    ),
    'vendor_observation', 'B', 'supports',
    'Provider details are a bounded sample while summary totals are complete.'
  );
  INSERT INTO app.backlink_authority_snapshots (
    id, workspace_id, project_id, site_id, competitor_id,
    subject_kind, source_kind, provider, captured_at, availability,
    index_scope, total_backlinks, total_referring_domains,
    observed_backlinks, observed_referring_domains,
    authority_metric_kind, authority_metric_value,
    source_ref, checksum, row_count, import_preview_id, limitation
  ) VALUES (
    authority_id, workspace_id, project_id, site_id, null,
    'primary_site', 'provider_import', 'dataforseo',
    '2026-08-06T08:00:00.000Z', 'available',
    'provider_index', 1240, 87, null, null,
    'dataforseo_rank', 54,
    'dfs-' || snapshot_id::text, repeat('d', 64), 3, null, null
  );
  INSERT INTO app.backlink_facts (
    snapshot_id, workspace_id, project_id, site_id,
    referring_domain, source_url, target_url, target_site_page_id,
    source_authority_metric_kind, source_authority_metric_value,
    link_kind, source_ref, anchor_text, first_seen_at, last_seen_at,
    is_new, is_lost, verification_status, verified_at,
    verification_final_url, verification_http_status,
    verification_limitation
  ) VALUES (
    authority_id, workspace_id, project_id, site_id,
    'publisher.example', 'https://publisher.example/article',
    'https://' || host || '/guide', null,
    'dataforseo_rank', 63, 'dofollow', 'provider-row-1',
    'Astrology guide', '2026-07-01T00:00:00.000Z',
    '2026-08-06T08:00:00.000Z', true, false, 'verified',
    '2026-08-06T08:00:00.000Z',
    'https://publisher.example/article', 200, null
  );
  INSERT INTO app.backlink_facts (
    snapshot_id, workspace_id, project_id, site_id,
    referring_domain, source_url, target_url, target_site_page_id,
    source_authority_metric_kind, source_authority_metric_value,
    link_kind, source_ref, anchor_text, first_seen_at, last_seen_at,
    is_new, is_lost
  ) VALUES (
    authority_id, workspace_id, project_id, site_id,
    'second-publisher.example', 'https://second-publisher.example/article',
    'https://www.' || host || '/guide', null,
    'dataforseo_rank', 57, 'nofollow', 'provider-row-2',
    'Alternate host guide', '2026-07-02T00:00:00.000Z',
    '2026-08-06T08:00:00.000Z', false, false
  );

  BEGIN
    INSERT INTO app.backlink_facts (
      snapshot_id, workspace_id, project_id, site_id,
      referring_domain, source_url, target_url, target_site_page_id,
      source_authority_metric_kind, source_authority_metric_value,
      link_kind, source_ref
    ) VALUES (
      authority_id, workspace_id, project_id, site_id,
      'foreign-publisher.example', 'https://foreign-publisher.example/article',
      'https://foreign-target.example/guide', null,
      'dataforseo_rank', 40, 'dofollow', 'foreign-provider-row'
    );
  EXCEPTION
    WHEN check_violation THEN
      foreign_dataforseo_target_rejected := true;
  END;
  IF NOT foreign_dataforseo_target_rejected THEN
    RAISE EXCEPTION 'DataForSEO foreign target escaped summary-domain authority';
  END IF;

  BEGIN
    INSERT INTO app.backlink_facts (
      snapshot_id, workspace_id, project_id, site_id,
      referring_domain, source_url, target_url, target_site_page_id,
      source_authority_metric_kind, source_authority_metric_value,
      link_kind, source_ref
    ) VALUES (
      authority_id, workspace_id, project_id, site_id,
      'credential-publisher.example',
      'https://credential-publisher.example/article',
      'https://' || host || '@foreign-target.example/guide', null,
      'dataforseo_rank', 40, 'dofollow', 'credential-provider-row'
    );
  EXCEPTION
    WHEN check_violation THEN
      credential_dataforseo_target_rejected := true;
  END;
  IF NOT credential_dataforseo_target_rejected THEN
    RAISE EXCEPTION 'DataForSEO credential target escaped summary-domain authority';
  END IF;

  BEGIN
    INSERT INTO app.backlink_facts (
      snapshot_id, workspace_id, project_id, site_id,
      referring_domain, source_url, target_url, target_site_page_id,
      source_authority_metric_kind, source_authority_metric_value,
      link_kind, source_ref
    ) VALUES (
      authority_id, workspace_id, project_id, site_id,
      'port-publisher.example', 'https://port-publisher.example/article',
      'https://' || host || ':443/guide', null,
      'dataforseo_rank', 40, 'dofollow', 'port-provider-row'
    );
  EXCEPTION
    WHEN check_violation THEN
      port_dataforseo_target_rejected := true;
  END;
  IF NOT port_dataforseo_target_rejected THEN
    RAISE EXCEPTION 'DataForSEO explicit-port target escaped summary-domain authority';
  END IF;

  BEGIN
    INSERT INTO app.backlink_facts (
      snapshot_id, workspace_id, project_id, site_id,
      referring_domain, source_url, target_url, target_site_page_id,
      source_authority_metric_kind, source_authority_metric_value,
      link_kind, source_ref
    ) VALUES (
      authority_id, workspace_id, project_id, site_id,
      'uppercase-publisher.example',
      'https://uppercase-publisher.example/article',
      'https://' || upper(host) || '/guide', null,
      'dataforseo_rank', 40, 'dofollow', 'uppercase-provider-row'
    );
  EXCEPTION
    WHEN check_violation THEN
      uppercase_dataforseo_target_rejected := true;
  END;
  IF NOT uppercase_dataforseo_target_rejected THEN
    RAISE EXCEPTION 'DataForSEO uppercase target escaped summary-domain authority';
  END IF;

  BEGIN
    INSERT INTO app.backlink_facts (
      snapshot_id, workspace_id, project_id, site_id,
      referring_domain, source_url, target_url, target_site_page_id,
      source_authority_metric_kind, source_authority_metric_value,
      link_kind, source_ref
    ) VALUES (
      authority_id, workspace_id, project_id, site_id,
      'prefixed-publisher.example',
      'https://prefixed-publisher.example/article',
      'https://' || host || '.evil.example/guide', null,
      'dataforseo_rank', 40, 'dofollow', 'prefixed-provider-row'
    );
  EXCEPTION
    WHEN check_violation THEN
      prefixed_dataforseo_target_rejected := true;
  END;
  IF NOT prefixed_dataforseo_target_rejected THEN
    RAISE EXCEPTION 'DataForSEO host-prefix target escaped summary-domain authority';
  END IF;

  BEGIN
    INSERT INTO app.backlink_authority_snapshots (
      workspace_id, project_id, site_id, competitor_id,
      subject_kind, source_kind, provider, captured_at, availability,
      index_scope, total_backlinks, total_referring_domains,
      observed_backlinks, observed_referring_domains,
      authority_metric_kind, authority_metric_value,
      source_ref, checksum, row_count, import_preview_id, limitation
    ) VALUES (
      workspace_id, project_id, site_id, null,
      'primary_site', 'provider_import', 'dataforseo',
      '2026-08-06T08:00:00.000Z', 'unavailable',
      'unavailable', null, null, null, null, null, null,
      'dfs-' || snapshot_id::text, repeat('d', 64), 3, null,
      'Provider unavailable smoke row.'
    );
  EXCEPTION
    WHEN check_violation THEN
      unavailable_authority_rejected := true;
  END;
  IF NOT unavailable_authority_rejected THEN
    RAISE EXCEPTION 'DataForSEO unavailable authority escaped fail-closed projection';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM app.backlink_facts fact
    WHERE fact.snapshot_id = authority_id
      AND fact.source_authority_metric_kind = 'dataforseo_rank'
      AND fact.verification_status = 'verified'
      AND fact.verification_http_status = 200
  ) THEN
    RAISE EXCEPTION 'DataForSEO backlink fact projection evidence is incomplete';
  END IF;
END;
$dataforseo_backlinks_behavior$;

DO $dataforseo_search_landscape_contract$
BEGIN
  IF position(
    '''search_landscape''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.collection_runs'::regclass
        AND constraint_row.conname = 'collection_runs_operation_check'
    )
  ) = 0 THEN
    RAISE EXCEPTION 'DataForSEO Search Landscape operation is absent';
  END IF;
  IF position(
    '''dataforseo.search_landscape.v1''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.data_snapshots'::regclass
        AND constraint_row.conname = 'data_snapshots_dataset_key_check'
    )
  ) = 0 THEN
    RAISE EXCEPTION 'DataForSEO Search Landscape dataset is absent';
  END IF;
  IF position(
    '''dataforseo.search_landscape.v3''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = 'app.data_snapshots'::regclass
        AND constraint_row.conname = 'data_snapshots_dataset_key_check'
    )
  ) = 0 THEN
    RAISE EXCEPTION 'DataForSEO Search Landscape v3 dataset is absent';
  END IF;
  IF position(
    '''serp_overlap''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid =
        'app.competitor_origin_occurrences'::regclass
        AND constraint_row.conname =
          'competitor_origin_occurrences_origin_kind_check'
    )
  ) = 0 THEN
    RAISE EXCEPTION 'SERP overlap origin discriminator is absent';
  END IF;
  IF position(
    '''ai_citation''' IN (
      SELECT pg_get_constraintdef(constraint_row.oid)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid =
        'app.competitor_origin_occurrences'::regclass
        AND constraint_row.conname =
          'competitor_origin_occurrences_origin_kind_check'
    )
  ) = 0 THEN
    RAISE EXCEPTION 'AI citation origin discriminator is absent';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname = 'competitor_origins_serp_identity_idx'
      AND indexdef LIKE '%normalized_observation_id, source_pointer%'
      AND indexdef LIKE '%origin_kind = ''serp_overlap''%'
  ) <> 1 THEN
    RAISE EXCEPTION 'SERP overlap stable partial identity index is incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'app'
      AND indexname = 'competitor_origins_ai_citation_identity_idx'
      AND indexdef LIKE '%normalized_observation_id, source_pointer%'
      AND indexdef LIKE '%origin_kind = ''ai_citation''%'
  ) <> 1 THEN
    RAISE EXCEPTION 'AI citation stable partial identity index is incomplete';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger trigger_row
    JOIN pg_class relation ON relation.oid = trigger_row.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'app'
      AND NOT trigger_row.tgisinternal
      AND trigger_row.tgname IN (
        'collection_runs_dataforseo_provenance_guard',
        'data_snapshots_dataforseo_provenance_guard',
        'normalized_observations_dataforseo_provenance_guard',
        'competitor_origins_serp_lineage_guard',
        'competitor_origins_ai_citation_lineage_guard',
        'competitor_origins_delete_guard'
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'DataForSEO Search Landscape triggers are incomplete';
  END IF;
  IF (
    SELECT count(DISTINCT procedure.proname)
    FROM pg_proc procedure
    WHERE procedure.pronamespace = 'app'::regnamespace
      AND procedure.proname IN (
        'enforce_dataforseo_collection_run_provenance',
        'enforce_dataforseo_data_snapshot_provenance',
        'enforce_dataforseo_observation_provenance',
        'enforce_serp_overlap_competitor_origin_lineage',
        'upsert_serp_overlap_competitor_origin',
        'is_dataforseo_competitor_domain_v2',
        'is_dataforseo_competitor_ai_citation_v1',
        'enforce_ai_citation_competitor_origin_lineage',
        'upsert_ai_citation_competitor_origin',
        'upsert_keyword_library_occurrences_batch',
        'upsert_competitor_origins_batch',
        'detect_provider_discrepancies_for_snapshot'
      )
  ) <> 12 THEN
    RAISE EXCEPTION 'DataForSEO Search Landscape routines are incomplete';
  END IF;
END;
$dataforseo_search_landscape_contract$;

DO $dataforseo_search_landscape_behavior$
#variable_conflict use_variable
DECLARE
  workspace_id uuid := gen_random_uuid();
  project_id uuid := gen_random_uuid();
  site_id uuid := gen_random_uuid();
  source_id uuid := gen_random_uuid();
  run_id uuid := gen_random_uuid();
  snapshot_id uuid := gen_random_uuid();
  observation_id uuid := gen_random_uuid();
  v2_run_id uuid := gen_random_uuid();
  v2_snapshot_id uuid := gen_random_uuid();
  v2_observation_id uuid := gen_random_uuid();
  actor_id uuid := gen_random_uuid();
  first_occurrence_id uuid;
  replay_occurrence_id uuid;
  competitor_id uuid;
  replay_competitor_id uuid;
  host text := project_id::text || '.search-landscape-smoke.example';
  mixed_identity_rejected boolean := false;
  invalid_numeric_rejected boolean := false;
BEGIN
  INSERT INTO app.workspaces (id, name)
  VALUES (workspace_id, 'DataForSEO Search Landscape smoke');
  INSERT INTO app.client_projects (
    id, workspace_id, client_name, project_name,
    default_delivery_locale, created_by
  ) VALUES (
    project_id, workspace_id, 'Search Landscape client',
    'Search Landscape project', 'zh-CN', actor_id
  );
  INSERT INTO app.sites (
    id, workspace_id, project_id, origin, host,
    market_codes, language_codes, is_primary
  ) VALUES (
    site_id, workspace_id, project_id, 'https://' || host, host,
    ARRAY['US'], ARRAY['en-US'], true
  );
  INSERT INTO app.source_connections (
    id, workspace_id, project_id, site_id, provider,
    connection_type, state, external_ref, limitation,
    connected_at, created_by
  ) VALUES (
    source_id, workspace_id, project_id, site_id, 'dataforseo',
    'api_key_stub', 'available', host,
    'Schema smoke uses deterministic local rows, not a provider call.',
    '2026-07-30T08:00:00.000Z', actor_id
  );
  INSERT INTO app.async_runs (
    id, workspace_id, project_id, kind, status,
    initiated_by, started_at
  ) VALUES (
    run_id, workspace_id, project_id, 'collection', 'running',
    actor_id, '2026-07-30T08:00:00.000Z'
  );
  INSERT INTO app.collection_runs (
    id, workspace_id, project_id, site_id, source_connection_id,
    provider, operation, method_version, parameters_hash
  ) VALUES (
    run_id, workspace_id, project_id, site_id, source_id,
    'dataforseo', 'search_landscape',
    'dataforseo.search_landscape.v1', repeat('a', 64)
  );
  INSERT INTO app.data_snapshots (
    id, workspace_id, project_id, site_id, collection_run_id,
    source_connection_id, provider, dataset_key, schema_version,
    method_version, captured_at, source_window, availability,
    limitation, row_count, checksum, summary
  ) VALUES (
    snapshot_id, workspace_id, project_id, site_id, run_id, source_id,
    'dataforseo', 'dataforseo.search_landscape.v1',
    'dataforseo.search_landscape.v1',
    'dataforseo.search_landscape.v1',
    '2026-07-30T08:00:00.000Z',
    '{"start":null,"end":null}'::jsonb, 'available',
    'Provider competitor-domain data is updated weekly.',
    1, repeat('b', 64), '{}'::jsonb
  );
  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, provider,
    metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  ) VALUES (
    observation_id, workspace_id, project_id, snapshot_id, 'dataforseo',
    'dataforseo.competitor_domain.v1', 'site', 'smoke-rival.example',
    '2026-07-30T08:00:00.000Z', 'available',
    jsonb_build_object(
      'targetDomain', host,
      'competitorDomain', 'smoke-rival.example',
      'intersections', 7,
      'averagePosition', 4.5,
      'summedPosition', 31,
      'organicEstimatedTrafficVolume', 520.25,
      'marketCode', 'US',
      'languageCode', 'en'
    ),
    'vendor_observation', 'B', 'supports',
    'Provider competitor-domain data is updated weekly.'
  );

  SELECT occurrence_id, upserted.competitor_id
  INTO first_occurrence_id, competitor_id
  FROM app.upsert_serp_overlap_competitor_origin(
    workspace_id,
    project_id,
    'smoke-rival.example',
    snapshot_id,
    observation_id,
    '/valueJson/competitorDomain'
  ) upserted;
  SELECT occurrence_id, upserted.competitor_id
  INTO replay_occurrence_id, replay_competitor_id
  FROM app.upsert_serp_overlap_competitor_origin(
    workspace_id,
    project_id,
    'smoke-rival.example',
    snapshot_id,
    observation_id,
    '/valueJson/competitorDomain'
  ) upserted;
  IF first_occurrence_id IS DISTINCT FROM replay_occurrence_id
     OR competitor_id IS DISTINCT FROM replay_competitor_id THEN
    RAISE EXCEPTION 'SERP overlap source replay was not idempotent';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM app.competitor_entities entity
    WHERE entity.id = competitor_id
      AND entity.workspace_id = workspace_id
      AND entity.project_id = project_id
      AND entity.domain = 'smoke-rival.example'
      AND entity.name IS NULL
      AND entity.review_status = 'candidate'
      AND entity.relationship IS NULL
      AND entity.analysis_scope = ARRAY[]::text[]
      AND entity.revision = 0
  ) THEN
    RAISE EXCEPTION 'SERP overlap did not create a neutral candidate entity';
  END IF;

  UPDATE app.competitor_entities
  SET name = 'Human-reviewed smoke rival',
      review_status = 'approved',
      relationship = 'benchmark',
      analysis_scope = ARRAY['content'],
      revision = revision + 1
  WHERE id = competitor_id;
  PERFORM *
  FROM app.upsert_serp_overlap_competitor_origin(
    workspace_id,
    project_id,
    'smoke-rival.example',
    snapshot_id,
    observation_id,
    '/valueJson/competitorDomain'
  );
  IF NOT EXISTS (
    SELECT 1
    FROM app.competitor_entities entity
    WHERE entity.id = competitor_id
      AND entity.name = 'Human-reviewed smoke rival'
      AND entity.review_status = 'approved'
      AND entity.relationship = 'benchmark'
      AND entity.analysis_scope = ARRAY['content']
      AND entity.revision = 1
  ) THEN
    RAISE EXCEPTION 'provider replay overwrote competitor governance';
  END IF;

  BEGIN
    PERFORM *
    FROM app.upsert_serp_overlap_competitor_origin(
      workspace_id,
      project_id,
      'smoke-rival.example',
      gen_random_uuid(),
      observation_id,
      '/valueJson/competitorDomain'
    );
  EXCEPTION WHEN check_violation THEN
    mixed_identity_rejected := true;
  END;
  IF NOT mixed_identity_rejected THEN
    RAISE EXCEPTION 'mixed SERP Snapshot/Observation identity was accepted';
  END IF;

  BEGIN
    INSERT INTO app.normalized_observations (
      id, workspace_id, project_id, snapshot_id, provider,
      metric_key, subject_type, subject_ref, observed_at,
      availability, value_json, origin, grade, support, limitation
    ) VALUES (
      gen_random_uuid(), workspace_id, project_id, snapshot_id, 'dataforseo',
      'dataforseo.competitor_domain.v1', 'site', 'invalid-rival.example',
      '2026-07-30T08:00:00.000Z', 'available',
      jsonb_build_object(
        'targetDomain', host,
        'competitorDomain', 'invalid-rival.example',
        'intersections', 0,
        'averagePosition', 1,
        'summedPosition', 1,
        'organicEstimatedTrafficVolume', 1,
        'marketCode', 'US',
        'languageCode', 'en'
      ),
      'vendor_observation', 'B', 'supports', 'Invalid fixture.'
    );
  EXCEPTION WHEN check_violation THEN
    invalid_numeric_rejected := true;
  END;
  IF NOT invalid_numeric_rejected THEN
    RAISE EXCEPTION 'non-positive SERP intersections were accepted';
  END IF;

  INSERT INTO app.async_runs (
    id, workspace_id, project_id, kind, status,
    initiated_by, started_at
  ) VALUES (
    v2_run_id, workspace_id, project_id, 'collection', 'running',
    actor_id, '2026-08-03T08:00:00.000Z'
  );
  INSERT INTO app.collection_runs (
    id, workspace_id, project_id, site_id, source_connection_id,
    provider, operation, method_version, parameters_hash
  ) VALUES (
    v2_run_id, workspace_id, project_id, site_id, source_id,
    'dataforseo', 'search_landscape',
    'dataforseo.search_landscape.v2', repeat('c', 64)
  );
  INSERT INTO app.data_snapshots (
    id, workspace_id, project_id, site_id, collection_run_id,
    source_connection_id, provider, dataset_key, schema_version,
    method_version, captured_at, source_window, availability,
    limitation, row_count, checksum, summary
  ) VALUES (
    v2_snapshot_id, workspace_id, project_id, site_id, v2_run_id, source_id,
    'dataforseo', 'dataforseo.search_landscape.v2',
    'dataforseo.search_landscape.v2',
    'dataforseo.search_landscape.v2',
    '2026-08-03T08:00:00.000Z',
    '{"start":null,"end":null}'::jsonb, 'available',
    'Positions 1-100 with a frozen seed-based fallback.',
    1, repeat('d', 64), '{}'::jsonb
  );
  INSERT INTO app.normalized_observations (
    id, workspace_id, project_id, snapshot_id, provider,
    metric_key, subject_type, subject_ref, observed_at,
    availability, value_json, origin, grade, support, limitation
  ) VALUES (
    v2_observation_id, workspace_id, project_id, v2_snapshot_id,
    'dataforseo', 'dataforseo.serp_competitor.v1', 'site',
    'v2-smoke-rival.example', '2026-08-03T08:00:00.000Z', 'available',
    jsonb_build_object(
      'targetDomain', host,
      'competitorDomain', 'v2-smoke-rival.example',
      'averagePosition', 3.5,
      'medianPosition', 3,
      'rating', 880,
      'organicEstimatedTrafficVolume', 1200,
      'keywordsCount', 2,
      'visibility', 0.42,
      'relevantSerpItems', 2,
      'seedCount', 3,
      'marketCode', 'US',
      'languageCode', 'en'
    ),
    'vendor_observation', 'B', 'supports',
    'Frozen seed-based DataForSEO SERP competitor.'
  );
  PERFORM *
  FROM app.upsert_serp_overlap_competitor_origin(
    workspace_id,
    project_id,
    'v2-smoke-rival.example',
    v2_snapshot_id,
    v2_observation_id,
    '/valueJson/competitorDomain'
  );
  IF NOT EXISTS (
    SELECT 1
    FROM app.competitor_origin_occurrences occurrence
    WHERE occurrence.workspace_id = workspace_id
      AND occurrence.project_id = project_id
      AND occurrence.data_snapshot_id = v2_snapshot_id
      AND occurrence.normalized_observation_id = v2_observation_id
      AND occurrence.origin_kind = 'serp_overlap'
  ) THEN
    RAISE EXCEPTION 'DataForSEO v2 SERP fallback was not projected';
  END IF;
END;
$dataforseo_search_landscape_behavior$;

ROLLBACK;
