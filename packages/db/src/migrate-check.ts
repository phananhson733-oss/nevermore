import pg from "pg";
import { serializeDbProcessFailure } from "./runtime-failure.ts";
import { LATEST_APP_MIGRATION } from "./migration-version.ts";

/**
 * Verify the applied database matches the SQL contract shape (spec AC-003):
 * exactly 78 app tables plus every named index, trigger, and callable routine
 * in the frozen SQL contract. Exits non-zero on drift. This is a structural
 * object-presence gate; the byte-for-byte migration/spec gate separately
 * prevents definition drift.
 */

const EXPECTED_TABLES = [
  "workspaces",
  "operator_profiles",
  "client_projects",
  "sites",
  "icp_profiles",
  "source_connections",
  "source_credentials",
  "oauth_intents",
  "import_previews",
  "async_runs",
  "analysis_refresh_runs",
  "analysis_refresh_steps",
  "collection_runs",
  "data_snapshots",
  "normalized_observations",
  "provider_discrepancies",
  "diagnostic_runs",
  "diagnostic_run_rules",
  "analysis_invocations",
  "evidence",
  "findings",
  "finding_observations",
  "finding_targets",
  "finding_review_events",
  "actions",
  "action_override_audit",
  "execution_artifacts",
  "artifact_revisions",
  "export_bundles",
  "idempotency_keys",
  "telemetry_events",
  "capability_runs",
  "audit_runs",
  "audit_module_results",
  "site_pages",
  "page_snapshots",
  "product_profile_runs",
  "product_profile_invocation_attempts",
  "keyword_occurrences",
  "keyword_entities",
  "keyword_entity_sources",
  "competitor_entities",
  "competitor_origin_occurrences",
  "flow_shadow_runs",
  "flow_shadow_research_packs",
  "flow_shadow_qa_gates",
  "delivery_authorization_grants",
  "artifact_approval_events",
  "publication_destinations",
  "publication_preview_events",
  "publication_attempts",
  "publication_receipts",
  "measurement_windows",
  "measurement_gsc_dimensions",
  "measurement_ga4_dimensions",
  "measurement_geo_dimensions",
  "measurement_utm_identities",
  "measurement_ga4_campaigns",
  "topic_model_revisions",
  "topic_node_identities",
  "topic_node_revisions",
  "topic_cluster_aliases",
  "topic_node_successors",
  "keyword_review_decisions",
  "keyword_relation_identities",
  "keyword_relation_candidates",
  "keyword_relation_decisions",
  "action_execution_step_definitions",
  "action_execution_state_events",
  "competitor_monitor_settings",
  "competitor_monitor_runs",
  "competitor_monitor_evaluations",
  "competitor_monitor_signals",
  "geo_query_observations",
  "geo_citation_occurrences",
  "backlink_authority_snapshots",
  "backlink_facts",
  "backlink_page_metrics",
] as const;

const REQUIRED_INDEXES = [
  "client_projects_workspace_updated_idx",
  "sites_one_primary_per_project_idx",
  "source_connections_one_active_provider_idx",
  "source_connections_project_idx",
  "oauth_intents_expiry_idx",
  "import_previews_expiry_idx",
  "async_runs_one_active_key_idx",
  "async_runs_project_status_idx",
  "analysis_refresh_runs_project_created_idx",
  "analysis_refresh_runs_site_created_idx",
  "analysis_refresh_steps_project_state_idx",
  "analysis_refresh_steps_child_run_idx",
  "analysis_refresh_steps_child_run_unique_idx",
  "data_snapshots_project_provider_idx",
  "normalized_observations_lookup_idx",
  "normalized_observations_snapshot_idx",
  "normalized_observations_site_page_metric_idx",
  "provider_discrepancies_pair_idx",
  "analysis_invocations_project_idx",
  "evidence_run_idx",
  "findings_project_filter_idx",
  "finding_observations_finding_run_idx",
  "finding_targets_one_direct_root_idx",
  "finding_targets_one_definition_root_idx",
  "finding_targets_one_observation_member_idx",
  "finding_targets_site_page_read_idx",
  "finding_targets_finding_run_read_idx",
  "finding_targets_operational_idx",
  "actions_plan_idx",
  "execution_artifacts_one_active_type_idx",
  "execution_artifacts_project_idx",
  "export_bundles_project_idx",
  "idempotency_keys_expiry_idx",
  "telemetry_events_name_created_idx",
  "audit_runs_project_created_idx",
  "site_pages_project_updated_idx",
  "site_pages_site_idx",
  "page_snapshots_page_captured_idx",
  "page_snapshots_project_captured_idx",
  "page_snapshots_verified_source_identity_idx",
  "product_profile_runs_project_created_idx",
  "product_profile_runs_base_profile_idx",
  "product_profile_runs_source_snapshot_idx",
  "product_profile_runs_result_profile_idx",
  "product_profile_invocation_attempts_project_idx",
  "product_profile_invocation_attempts_unresolved_idx",
  "keyword_occurrences_project_collected_idx",
  "keyword_entities_project_created_idx",
  "keyword_entities_project_review_idx",
  "keyword_entity_sources_project_occurrence_idx",
  "competitor_entities_project_created_idx",
  "competitor_entities_project_status_idx",
  "competitor_origins_profile_identity_idx",
  "competitor_origins_csv_identity_idx",
  "competitor_origins_manual_identity_idx",
  "competitor_origins_serp_identity_idx",
  "competitor_origins_entity_observed_idx",
  "flow_shadow_runs_project_created_idx",
  "flow_shadow_runs_action_idx",
  "flow_shadow_runs_content_hash_idx",
  "flow_shadow_research_packs_run_idx",
  "flow_shadow_qa_gates_run_idx",
  "delivery_authorization_grants_project_state_idx",
  "artifact_approval_events_one_approval_per_revision_idx",
  "artifact_approval_events_one_terminal_per_event_idx",
  "artifact_approval_events_artifact_timeline_idx",
  "publication_destinations_project_ref_revision_idx",
  "publication_destinations_one_consuming_grant_idx",
  "publication_preview_events_issued_ref_idx",
  "publication_preview_events_one_terminal_per_event_idx",
  "publication_preview_events_project_ref_timeline_idx",
  "publication_preview_events_artifact_destination_idx",
  "publication_attempts_target_timeline_idx",
  "publication_attempts_source_idx",
  "publication_receipts_attempt_timeline_idx",
  "measurement_windows_target_history_idx",
  "measurement_windows_change_window_idx",
  "measurement_ga4_campaigns_window_idx",
  "topic_model_revisions_project_created_idx",
  "topic_node_revisions_project_model_idx",
  "topic_cluster_aliases_current_label_idx",
  "topic_cluster_aliases_node_history_idx",
  "topic_node_successors_predecessor_idx",
  "topic_node_successors_successor_idx",
  "keyword_review_decisions_project_decided_idx",
  "keyword_review_decisions_topic_idx",
  "keyword_relation_identities_keyword_a_idx",
  "keyword_relation_identities_keyword_b_idx",
  "keyword_relation_candidates_latest_idx",
  "keyword_relation_decisions_latest_idx",
  "action_execution_step_definitions_scope_idx",
  "action_execution_state_events_current_idx",
  "competitor_monitor_runs_competitor_created_idx",
  "competitor_monitor_evaluations_competitor_time_idx",
  "competitor_monitor_signals_competitor_time_idx",
  "competitor_monitor_signals_rank_unique_idx",
  "competitor_monitor_signals_content_unique_idx",
  "geo_query_observations_identity_idx",
  "geo_query_observations_normalized_idx",
  "geo_citation_occurrences_query_idx",
  "backlink_authority_identity_idx",
  "backlink_authority_subject_source_idx",
  "backlink_facts_target_page_idx",
  "backlink_facts_referring_domain_idx",
  "backlink_page_metrics_page_idx",
] as const;

const REQUIRED_TRIGGERS = [
  "workspaces_set_updated_at",
  "operator_profiles_set_updated_at",
  "client_projects_set_updated_at",
  "client_projects_icp_profile_provenance_guard",
  "sites_set_updated_at",
  "source_connections_set_updated_at",
  "source_credentials_set_updated_at",
  "oauth_intents_set_updated_at",
  "import_previews_set_updated_at",
  "async_runs_set_updated_at",
  "async_runs_terminal_status_immutable",
  "analysis_refresh_runs_provenance_guard",
  "analysis_refresh_runs_append_only",
  "analysis_refresh_steps_mutation_guard",
  "collection_runs_provenance_guard",
  "collection_runs_dataforseo_provenance_guard",
  "collection_runs_voc_provenance_guard",
  "data_snapshots_provenance_guard",
  "data_snapshots_dataforseo_provenance_guard",
  "data_snapshots_voc_provenance_guard",
  "normalized_observations_provenance_guard",
  "normalized_observations_dataforseo_provenance_guard",
  "normalized_observations_voc_provenance_guard",
  "normalized_observations_site_page_guard",
  "diagnostic_runs_frozen_input_guard",
  "diagnostic_runs_current_manifest_guard",
  "diagnostic_run_rules_version_guard",
  "provider_discrepancies_set_updated_at",
  "findings_set_updated_at",
  "findings_rule_version_guard",
  "actions_set_updated_at",
  "actions_source_lineage_guard",
  "execution_artifacts_set_updated_at",
  "execution_artifacts_status_transition_guard",
  "export_bundles_invariant_guard",
  "idempotency_keys_set_updated_at",
  "icp_profiles_append_only",
  "data_snapshots_append_only",
  "normalized_observations_append_only",
  "diagnostic_run_rules_append_only",
  "analysis_invocations_append_only",
  "evidence_provenance_guard",
  "evidence_append_only",
  "finding_observations_append_only",
  "finding_targets_lineage_guard",
  "finding_targets_append_only",
  "finding_review_events_append_only",
  "action_override_audit_append_only",
  "artifact_revisions_append_only",
  "telemetry_events_append_only",
  "site_pages_set_updated_at",
  "site_pages_canonical_subject_lock",
  "audit_runs_provenance_guard",
  "site_pages_provenance_guard",
  "page_snapshots_provenance_guard",
  "capability_runs_append_only",
  "audit_runs_append_only",
  "audit_module_results_append_only",
  "page_snapshots_append_only",
  "product_profile_runs_provenance_guard",
  "product_profile_runs_frozen_input_guard",
  "async_runs_product_profile_result_guard",
  "product_profile_invocation_attempts_transition_guard",
  "icp_profiles_product_profile_provenance_guard",
  "keyword_occurrences_lineage_guard",
  "keyword_occurrences_voc_lineage_guard",
  "keyword_occurrences_append_only",
  "keyword_entities_mutation_guard",
  "keyword_entities_initial_review_decision",
  "keyword_entities_no_delete",
  "keyword_entity_sources_lineage_guard",
  "keyword_entity_sources_append_only",
  "competitor_entities_governance_guard",
  "competitor_origins_lineage_guard",
  "competitor_origins_serp_lineage_guard",
  "competitor_origins_delete_guard",
  "flow_shadow_runs_provenance_guard",
  "flow_shadow_runs_append_only",
  "flow_shadow_research_packs_provenance_guard",
  "flow_shadow_research_packs_append_only",
  "flow_shadow_qa_gates_provenance_guard",
  "flow_shadow_qa_gates_append_only",
  "delivery_authorization_grants_transition_guard",
  "delivery_authorization_grants_no_delete",
  "artifact_approval_events_lineage_guard",
  "artifact_approval_events_append_only",
  "publication_destinations_lineage_guard",
  "publication_destinations_append_only",
  "publication_preview_events_lineage_guard",
  "publication_preview_events_append_only",
  "publication_attempts_lineage_guard",
  "publication_attempts_append_only",
  "publication_receipts_lineage_guard",
  "publication_receipts_append_only",
  "measurement_windows_lineage_guard",
  "measurement_windows_completeness_guard",
  "measurement_windows_append_only",
  "measurement_gsc_dimensions_lineage_guard",
  "measurement_gsc_dimensions_append_only",
  "measurement_ga4_dimensions_lineage_guard",
  "measurement_ga4_dimensions_append_only",
  "measurement_geo_dimensions_lineage_guard",
  "measurement_geo_dimensions_append_only",
  "measurement_utm_identities_scope_guard",
  "measurement_utm_identities_append_only",
  "measurement_ga4_campaigns_lineage_guard",
  "measurement_ga4_campaigns_append_only",
  "keyword_review_decisions_projection_guard",
  "topic_model_revisions_mutation_guard",
  "topic_model_revisions_topology_guard",
  "topic_node_identities_creation_guard",
  "topic_node_identities_append_only",
  "topic_node_revisions_mutation_guard",
  "topic_node_revisions_parent_cycle_guard",
  "topic_cluster_aliases_window_guard",
  "topic_cluster_aliases_retention_guard",
  "topic_node_successors_cycle_guard",
  "topic_node_successors_append_only",
  "keyword_review_decisions_append_only",
  "keyword_relation_candidates_insert_guard",
  "keyword_relation_identities_append_only",
  "keyword_relation_candidates_append_only",
  "keyword_relation_decisions_insert_guard",
  "keyword_relation_decisions_append_only",
  "action_execution_step_definitions_insert_guard",
  "action_execution_step_definitions_append_only",
  "action_execution_state_events_insert_guard",
  "action_execution_state_events_append_only",
  "competitor_monitor_runs_insert_guard",
  "competitor_monitor_evaluations_insert_guard",
  "competitor_monitor_signals_insert_guard",
  "competitor_monitor_runs_append_only",
  "competitor_monitor_evaluations_append_only",
  "competitor_monitor_signals_append_only",
  "geo_normalized_observations_lineage_guard",
  "geo_normalized_observations_completeness_guard",
  "geo_query_observations_insert_guard",
  "geo_query_observations_completeness_guard",
  "geo_query_observations_append_only",
  "geo_citation_occurrences_insert_guard",
  "geo_citation_occurrences_completeness_guard",
  "geo_citation_occurrences_append_only",
  "backlink_authority_snapshots_insert_guard",
  "backlink_facts_insert_guard",
  "backlink_page_metrics_insert_guard",
  "backlink_authority_snapshots_append_only",
  "backlink_facts_append_only",
  "backlink_page_metrics_append_only",
] as const;

const REQUIRED_ROUTINES = [
  "enforce_analysis_refresh_run_provenance",
  "enforce_analysis_refresh_step_mutation",
  "lock_site_page_canonical_subjects",
  "finding_target_relation_key",
  "reserve_product_profile_invocation_attempt",
  "finalize_product_profile_invocation_attempt",
  "mark_product_profile_invocation_outcome_unknown",
  "validate_product_profile_provenance",
  "enforce_keyword_occurrence_lineage",
  "enforce_keyword_entity_mutation",
  "initialize_keyword_review_decision",
  "enforce_keyword_entity_source_lineage",
  "upsert_keyword_library_occurrence",
  "is_normalized_competitor_domain",
  "is_competitor_analysis_scope",
  "is_typed_product_profile_evidence_refs",
  "enforce_competitor_entity_governance",
  "enforce_competitor_origin_lineage",
  "upsert_competitor_origin",
  "enforce_dataforseo_collection_run_provenance",
  "enforce_dataforseo_data_snapshot_provenance",
  "enforce_dataforseo_observation_provenance",
  "enforce_serp_overlap_competitor_origin_lineage",
  "upsert_serp_overlap_competitor_origin",
  "enforce_flow_shadow_run_provenance",
  "enforce_flow_shadow_child_provenance",
  "enforce_delivery_authorization_grant_transition",
  "enforce_artifact_approval_event_lineage",
  "enforce_publication_destination_lineage",
  "enforce_publication_preview_event_lineage",
  "enforce_publication_attempt_lineage",
  "enforce_publication_receipt_lineage",
  "enforce_measurement_window_lineage",
  "enforce_measurement_dimension_lineage",
  "enforce_measurement_window_completeness",
  "enforce_measurement_utm_identity_scope",
  "enforce_measurement_ga4_campaign_lineage",
  "enforce_keyword_review_projection",
  "enforce_topic_model_revision_mutation",
  "validate_confirmed_topic_model_topology",
  "enforce_topic_node_identity_creation",
  "enforce_topic_node_revision_mutation",
  "prevent_topic_parent_cycle",
  "prevent_topic_alias_window_overlap",
  "enforce_topic_cluster_alias_retention",
  "prevent_topic_successor_cycle",
  "normalize_keyword_relation_semantic",
  "keyword_relation_token_overlap",
  "keyword_relation_candidate_stale_reasons",
  "enforce_keyword_relation_candidate_insert",
  "enforce_keyword_relation_decision_insert",
  "enforce_action_execution_step_definition_insert",
  "enforce_action_execution_state_insert",
  "enforce_competitor_monitor_run_insert",
  "enforce_competitor_monitor_evaluation_insert",
  "enforce_competitor_monitor_signal_insert",
  "enforce_geo_normalized_observation_insert",
  "enforce_geo_query_observation_insert",
  "enforce_geo_citation_occurrence_insert",
  "enforce_geo_evidence_completeness",
  "enforce_voc_collection_run_provenance",
  "enforce_voc_data_snapshot_provenance",
  "enforce_voc_keyword_evidence_observation",
  "enforce_voc_keyword_occurrence_lineage",
  "enforce_backlink_authority_snapshot_insert",
  "enforce_backlink_fact_insert",
  "enforce_backlink_page_metric_insert",
] as const;

const REQUIRED_COLUMNS = [
  ["publication_attempts", "approved_artifact_content_hash"],
  ["publication_attempts", "preview_checksum"],
  ["publication_attempts", "content_checksum"],
  ["publication_receipts", "artifact_content_hash"],
  ["publication_receipts", "content_checksum"],
  ["measurement_windows", "artifact_content_hash"],
  ["measurement_windows", "content_checksum"],
  ["measurement_windows", "result_hash"],
  ["keyword_relation_candidates", "evidence_hash"],
  ["action_execution_step_definitions", "definition_hash"],
  ["action_execution_step_definitions", "request_hash"],
  ["action_execution_state_events", "request_hash"],
  ["geo_query_observations", "collector_version"],
  ["geo_citation_occurrences", "cited_paragraph_selector"],
  ["backlink_authority_snapshots", "source_ref"],
  ["backlink_authority_snapshots", "checksum"],
  ["backlink_facts", "source_ref"],
] as const;

const REQUIRED_DIGEST_SIGNATURES = [
  "bytea, text",
  "text, text",
] as const;
const DIGEST_COMPATIBILITY_SHA256 =
  "6bc55c2be22e768cdca86865ec8f910f2d81e10ffdea5fb3a4610240b52473ae";

export interface MigrateCheckResult {
  ok: boolean;
  problems: string[];
}

export async function checkMigrations(
  connectionString: string,
): Promise<MigrateCheckResult> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const problems: string[] = [];
  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'app' AND table_type = 'BASE TABLE'`,
    );
    const found = new Set(tables.rows.map((r) => r.table_name));
    if (found.size !== EXPECTED_TABLES.length) {
      problems.push(
        `expected ${EXPECTED_TABLES.length} app tables, found ${found.size}`,
      );
    }
    for (const t of EXPECTED_TABLES) {
      if (!found.has(t)) problems.push(`missing table app.${t}`);
    }

    const columns = await client.query<{
      table_name: string;
      column_name: string;
      is_nullable: string;
      data_type: string;
    }>(
      `SELECT table_name, column_name, is_nullable, data_type
         FROM information_schema.columns
        WHERE table_schema = 'app'`,
    );
    const columnSet = new Set(
      columns.rows
        .filter(
          (row) =>
            row.is_nullable === "NO" && row.data_type === "text",
        )
        .map((row) => `${row.table_name}.${row.column_name}`),
    );
    for (const [table, column] of REQUIRED_COLUMNS) {
      const qualified = `${table}.${column}`;
      if (!columnSet.has(qualified)) {
        problems.push(`missing required non-null text column app.${qualified}`);
      }
    }

    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'app'`,
    );
    const idxSet = new Set(indexes.rows.map((r) => r.indexname));
    for (const idx of REQUIRED_INDEXES) {
      if (!idxSet.has(idx)) problems.push(`missing index ${idx}`);
    }

    const triggers = await client.query<{ tgname: string }>(
      `SELECT t.tgname FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'app' AND NOT t.tgisinternal`,
    );
    const trgSet = new Set(triggers.rows.map((r) => r.tgname));
    for (const trg of REQUIRED_TRIGGERS) {
      if (!trgSet.has(trg)) problems.push(`missing trigger ${trg}`);
    }

    const routines = await client.query<{ routine_name: string }>(
      `SELECT routine_name FROM information_schema.routines
       WHERE routine_schema = 'app'`,
    );
    const routineSet = new Set(routines.rows.map((r) => r.routine_name));
    for (const routine of REQUIRED_ROUTINES) {
      if (!routineSet.has(routine)) {
        problems.push(`missing routine app.${routine}`);
      }
    }

    const pgcrypto = await client.query<{
      extension_oid: string;
      namespace_oid: string;
      extension_schema: string;
    }>(
      `SELECT
         extension_row.oid::text AS extension_oid,
         extension_namespace.oid::text AS namespace_oid,
         extension_namespace.nspname AS extension_schema
       FROM pg_catalog.pg_extension extension_row
       JOIN pg_catalog.pg_namespace extension_namespace
         ON extension_namespace.oid = extension_row.extnamespace
       WHERE extension_row.extname = 'pgcrypto'`,
    );

    if (pgcrypto.rows.length !== 1) {
      problems.push("missing pgcrypto extension");
    } else {
      const extension = pgcrypto.rows[0]!;
      const extensionDigests = await client.query<{ signature: string }>(
        `SELECT pg_catalog.oidvectortypes(procedure.proargtypes) AS signature
         FROM pg_catalog.pg_proc procedure
         JOIN pg_catalog.pg_depend dependency
           ON dependency.classid =
                'pg_catalog.pg_proc'::pg_catalog.regclass
          AND dependency.objid = procedure.oid
          AND dependency.refclassid =
                'pg_catalog.pg_extension'::pg_catalog.regclass
          AND dependency.refobjid = $1::oid
          AND dependency.deptype = 'e'
         WHERE procedure.pronamespace = $2::oid
           AND procedure.proname = 'digest'
           AND pg_catalog.oidvectortypes(procedure.proargtypes) =
               ANY ($3::text[])`,
        [
          extension.extension_oid,
          extension.namespace_oid,
          [...REQUIRED_DIGEST_SIGNATURES],
        ],
      );
      const extensionDigestSet = new Set(
        extensionDigests.rows.map((row) => row.signature),
      );
      for (const signature of REQUIRED_DIGEST_SIGNATURES) {
        if (!extensionDigestSet.has(signature)) {
          problems.push(
            `missing pgcrypto extension function ${extension.extension_schema}.digest(${signature})`,
          );
        }
      }

      if (extension.extension_schema === "extensions") {
        const wrappers = await client.query<{
          signature: string;
          language_name: string;
          prosecdef: boolean;
          provolatile: string;
          proisstrict: boolean;
          proparallel: string;
          proconfig: string[] | null;
          prosrc: string;
          current_user_execute: boolean;
          restricted_role_execute: boolean;
        }>(
          `SELECT
             pg_catalog.oidvectortypes(procedure.proargtypes) AS signature,
             procedure_language.lanname AS language_name,
             procedure.prosecdef,
             procedure.provolatile,
             procedure.proisstrict,
             procedure.proparallel,
             procedure.proconfig,
             procedure.prosrc,
             pg_catalog.has_function_privilege(
               current_user,
               procedure.oid,
               'EXECUTE'
             ) AS current_user_execute,
             EXISTS (
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
             ) AS restricted_role_execute
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
             )`,
        );
        const wrappersBySignature = new Map(
          wrappers.rows.map((row) => [row.signature, row]),
        );

        for (const signature of REQUIRED_DIGEST_SIGNATURES) {
          const wrapper = wrappersBySignature.get(signature);
          if (!wrapper) {
            problems.push(
              `missing digest compatibility function public.digest(${signature})`,
            );
            continue;
          }
          if (
            wrapper.language_name !== "sql" ||
            wrapper.prosecdef ||
            wrapper.provolatile !== "i" ||
            !wrapper.proisstrict ||
            wrapper.proparallel !== "s" ||
            !wrapper.proconfig?.includes("search_path=pg_catalog") ||
            wrapper.prosrc.trim() !==
              "SELECT extensions.digest($1, $2)"
          ) {
            problems.push(
              `unsafe digest compatibility function public.digest(${signature})`,
            );
          }
          if (!wrapper.current_user_execute) {
            problems.push(
              `database runtime cannot execute public.digest(${signature})`,
            );
          }
          if (wrapper.restricted_role_execute) {
            problems.push(
              `restricted API role can execute public.digest(${signature})`,
            );
          }
        }
      } else if (extension.extension_schema !== "public") {
        problems.push(
          `unsupported pgcrypto extension schema ${extension.extension_schema}`,
        );
      }

      if (
        extension.extension_schema === "extensions" ||
        extension.extension_schema === "public"
      ) {
        try {
          const digestRuntime = await client.query<{
            bytea_digest: string;
            text_digest: string;
          }>(
            `SELECT
               pg_catalog.encode(
                 public.digest(
                   pg_catalog.convert_to(
                     'signalframe-pgcrypto-compat',
                     'UTF8'
                   ),
                   'sha256'::text
                 ),
                 'hex'
               ) AS bytea_digest,
               pg_catalog.encode(
                 public.digest(
                   'signalframe-pgcrypto-compat'::text,
                   'sha256'::text
                 ),
                 'hex'
               ) AS text_digest`,
          );
          const row = digestRuntime.rows[0];
          if (
            digestRuntime.rows.length !== 1 ||
            row?.bytea_digest !== DIGEST_COMPATIBILITY_SHA256 ||
            row?.text_digest !== DIGEST_COMPATIBILITY_SHA256
          ) {
            problems.push("digest compatibility runtime result is invalid");
          }
        } catch {
          problems.push("digest compatibility runtime is unavailable");
        }
      }
    }

    try {
      const version = await client.query<{ migration_version: unknown }>(
        "SELECT migration_version FROM app.schema_migration_version",
      );
      if (
        version.rows.length !== 1 ||
        version.rows[0]?.migration_version !== LATEST_APP_MIGRATION
      ) {
        problems.push("database migration version is missing or stale");
      }
    } catch {
      problems.push("missing view app.schema_migration_version");
    }
  } finally {
    await client.end();
  }
  return { ok: problems.length === 0, problems };
}

async function main(): Promise<void> {
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const result = await checkMigrations(connectionString);
  if (!result.ok) {
    console.error("Migration check FAILED:");
    for (const p of result.problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log(
    `Migration check passed: ${EXPECTED_TABLES.length} app tables, ` +
      `${REQUIRED_COLUMNS.length} authority hash columns, ` +
      `${REQUIRED_INDEXES.length} indexes, ${REQUIRED_TRIGGERS.length} triggers, and ` +
      `${REQUIRED_ROUTINES.length} routines present.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(serializeDbProcessFailure("migrate-check", error));
    process.exit(1);
  });
}
