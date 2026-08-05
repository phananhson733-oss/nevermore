import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  LATEST_APP_MIGRATION,
  readMigrationVersion,
} from "./migration-version.ts";
import { asyncRuns } from "./schema.ts";

describe("readMigrationVersion", () => {
  it("guards contextual indexability diagnostics in one append-only migration", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0042_contextual_indexability_opportunities.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(LATEST_APP_MIGRATION).toBe(
      "0042_contextual_indexability_opportunities",
    );
    expect(migration).toMatch(
      /CHECK\s*\(\s*rule_set_version\s+IN\s*\(\s*'mvp\.rules\.0\.2\.0'\s*,\s*'mvp\.rules\.0\.2\.1'\s*,\s*'mvp\.rules\.0\.2\.2'\s*,\s*'mvp\.rules\.0\.2\.3'\s*,\s*'mvp\.rules\.0\.2\.4'\s*\)\s*\)/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_current_diagnostic_manifest/iu,
    );
    expect(migration).toMatch(
      /NEW\.rule_set_version\s*=\s*'mvp\.rules\.0\.2\.4'[\s\S]*?manifest_keys\s*:=\s*ARRAY\[[\s\S]*?'governance'[\s\S]*?'contextProjection'/iu,
    );
    expect(migration).toMatch(
      /NOT\s*\(\s*NEW\.input_manifest\s*\?&\s*manifest_keys\s*\)[\s\S]*?NEW\.input_manifest\s*-\s*manifest_keys[\s\S]*?IS\s+DISTINCT\s+FROM\s+'\{\}'::jsonb/iu,
    );
    expect(migration).toMatch(
      /context_projection\s*-\s*ARRAY\[[\s\S]*?'schemaVersion'[\s\S]*?'compilerVersion'[\s\S]*?'profileGeneration'[\s\S]*?'productRouting'[\s\S]*?'siteLanguage'[\s\S]*?'primaryConversion'[\s\S]*?'priorityUrlSubjects'[\s\S]*?'declaredExecutionConstraints'[\s\S]*?\][\s\S]*?IS\s+DISTINCT\s+FROM\s+'\{\}'::jsonb/iu,
    );
    expect(migration).toMatch(
      /product_routing\s*-\s*ARRAY\[[\s\S]*?'sourceKind'[\s\S]*?'productName'[\s\S]*?'oneLiner'[\s\S]*?'productType'[\s\S]*?'businessModels'[\s\S]*?'primaryMarket'[\s\S]*?'primaryAudience'/iu,
    );
    expect(migration).toMatch(
      /site_language\s*-\s*ARRAY\[\s*'sourceKind'\s*,\s*'state'\s*,\s*'languageCodes'\s*\][\s\S]*?to_jsonb\(site_language_codes\)/iu,
    );
    expect(migration).toMatch(
      /product_routing\s*->>\s*'sourceKind'\s+IS\s+DISTINCT\s+FROM\s*\(\s*CASE\s+profile_generation[\s\S]*?WHEN\s+'product-profile\.0\.3\.0'\s+THEN\s+'product_profile'[\s\S]*?ELSE\s+'legacy_icp'[\s\S]*?END\s*\)/iu,
    );
    expect(migration).toMatch(
      /site_language\s*->>\s*'state'\s+IS\s+DISTINCT\s+FROM\s*\(\s*CASE[\s\S]*?WHEN\s+cardinality\(site_language_codes\)\s*=\s*0\s+THEN\s+'declared_empty'[\s\S]*?ELSE\s+'declared_non_empty'[\s\S]*?END\s*\)/iu,
    );
    expect(migration).toMatch(
      /primary_conversion\s*->>\s*'sourceKind'\s+IS\s+DISTINCT\s+FROM\s*\(\s*CASE\s+profile_generation[\s\S]*?WHEN\s+'product-profile\.0\.3\.0'[\s\S]*?THEN\s+'not_declared_for_generation'[\s\S]*?ELSE\s+'legacy_icp'[\s\S]*?END\s*\)/iu,
    );
    expect(migration).toMatch(
      /priority_url_subjects\s*->>\s*'sourceKind'\s+IS\s+DISTINCT\s+FROM\s*\(\s*CASE\s+profile_generation[\s\S]*?WHEN\s+'product-profile\.0\.3\.0'[\s\S]*?THEN\s+'not_declared_for_generation'[\s\S]*?ELSE\s+'legacy_icp'[\s\S]*?END\s*\)/iu,
    );
    expect(migration).toMatch(
      /declared_execution_constraints\s*->>\s*'sourceKind'\s+IS\s+DISTINCT\s+FROM\s*\(\s*CASE\s+profile_generation[\s\S]*?WHEN\s+'product-profile\.0\.3\.0'[\s\S]*?THEN\s+'not_declared_for_generation'[\s\S]*?ELSE\s+'legacy_icp'[\s\S]*?END\s*\)/iu,
    );
    expect(migration).toMatch(
      /profile_generation[\s\S]*?icp_profile\s*\?\s*'profileSchemaVersion'[\s\S]*?product-profile\.0\.3\.0[\s\S]*?legacy-icp\.v1/iu,
    );
    expect(migration).toMatch(
      /priority_url_subjects\s*->>\s*'sourceHash'\s+IS\s+DISTINCT\s+FROM\s+icp_content_hash/iu,
    );
    expect(migration).toMatch(
      /primary_conversion[\s\S]*?priority_url_subjects[\s\S]*?declared_execution_constraints[\s\S]*?not_declared_for_generation/iu,
    );
    expect(migration).toMatch(
      /primary_conversion\s*-\s*ARRAY\['state',\s*'sourceKind',\s*'value'\][\s\S]*?priority_url_subjects\s*-\s*ARRAY\[[\s\S]*?'sourceHash'[\s\S]*?'normalizedRefs'[\s\S]*?declared_execution_constraints\s*-\s*ARRAY\[[\s\S]*?'technical'[\s\S]*?'resource'/iu,
    );
    expect(migration).toMatch(
      /\(primary_conversion\s*->\s*'value'\)\s*-\s*ARRAY\['label',\s*'type',\s*'targetUrl'\]::text\[\]/iu,
    );
    expect(migration).not.toMatch(
      /primary_conversion\s*->\s*'value'\s*-\s*ARRAY\['label',\s*'type',\s*'targetUrl'\]/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.expected_diagnostic_rule_version/iu,
    );
    expect(migration).toMatch(
      /selected_rule_id\s*=\s*'TECH-INDEXABILITY-006'[\s\S]*?selected_rule_set\s*=\s*'mvp\.rules\.0\.2\.4'[\s\S]*?THEN\s+1[\s\S]*?ELSE\s+NULL/iu,
    );
    expect(migration).toMatch(
      /selected_rule_set\s+IN\s*\(\s*'mvp\.rules\.0\.2\.3'\s*,\s*'mvp\.rules\.0\.2\.4'\s*\)[\s\S]*?selected_rule_id\s*=\s*'TECH-LINKGRAPH-005'\s+THEN\s+3[\s\S]*?selected_rule_set\s+IN\s*\([\s\S]*?'mvp\.rules\.0\.2\.2'[\s\S]*?'mvp\.rules\.0\.2\.3'[\s\S]*?'mvp\.rules\.0\.2\.4'[\s\S]*?selected_rule_id\s*=\s*'CONTENT-GAP-011'\s+THEN\s+2/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_finding_target_lineage/iu,
    );
    expect(migration).toMatch(
      /WHEN\s+'TECH-INDEXABILITY-006'\s+THEN\s+'direct_url'/iu,
    );
    expect(migration).toMatch(
      /finding_rule_id\s+IN\s*\([\s\S]*?'TECH-INDEXABILITY-006'[\s\S]*?\)[\s\S]*?NEW\.resolution_state\s*=\s*'resolved'[\s\S]*?NEW\.basis_kind\s*=\s*'crawl_exact_fetch'/iu,
    );
    expect(migration).toMatch(
      /NEW\.target_ref\s+IS\s+DISTINCT\s+FROM\s+page_normalized_url[\s\S]*?observation_metric_key\s*<>\s*'crawl\.page\.v1'[\s\S]*?NEW\.member_ref\s+IS\s+DISTINCT\s+FROM\s+observation_fetch_url[\s\S]*?page_snapshot\.id\s*=\s*NEW\.page_snapshot_id[\s\S]*?page_snapshot\.data_snapshot_id\s*=\s*observation_snapshot_id/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_finding_target_lineage\(\)[\s\S]*?RETURN\s+NEW;\s*END;\s*\$\$;\s*CREATE\s+OR\s+REPLACE\s+VIEW\s+app\.schema_migration_version/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0042_contextual_indexability_opportunities'::text[\s\S]*?AS\s+migration_version/iu,
    );
  });

  it("tracks opt-out Product Profile competitor defaults", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0041_product_profile_default_competitors.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /origin\.source_review_status\s*=\s*'candidate'[\s\S]*?origin\.source_relationship\s+IN\s*\(\s*'direct'\s*,\s*'indirect'\s*\)[\s\S]*?cardinality\(origin\.source_analysis_scope\)\s+BETWEEN\s+1\s+AND\s+5/iu,
    );
    expect(migration).toMatch(/entity\.revision\s*=\s*0/iu);
    expect(migration).toMatch(
      /revision\s*=\s*entity\.revision\s*\+\s*1/iu,
    );
    expect(migration).toMatch(
      /source_rank\s*=\s*1/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0041_product_profile_default_competitors'::text[\s\S]*?AS\s+migration_version/iu,
    );
  });

  it("keeps internal-link Opportunity coverage immediately before Product Profile defaults", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0040_internal_link_opportunity_coverage.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.expected_diagnostic_rule_version/iu,
    );
    expect(migration).toMatch(
      /selected_rule_set\s*=\s*'mvp\.rules\.0\.2\.3'[\s\S]*?selected_rule_id\s*=\s*'TECH-LINKGRAPH-005'\s+THEN\s+3/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0040_internal_link_opportunity_coverage'::text[\s\S]*?AS\s+migration_version/iu,
    );
  });

  it("keeps DataForSEO Search Landscape v2 immediately before optional source onboarding", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0037_dataforseo_search_landscape_v2.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(/dataforseo\.search_landscape\.v2/iu);
    expect(migration).toMatch(/dataforseo\.serp_competitor\.v1/iu);
    expect(migration).toMatch(
      /SELECT\s+'0037_dataforseo_search_landscape_v2'::text[\s\S]*?AS\s+migration_version/iu,
    );
  });

  it("keeps the missing analytics SitePage lineage repair immediately before DataForSEO v2", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0036_missing_analytics_site_page_lineage.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_normalized_observation_site_page_lineage/iu,
    );
    expect(migration).toMatch(
      /NEW\.site_page_id\s+IS\s+NULL[\s\S]*?is_analytics_page[\s\S]*?candidate_count\s*=\s*1/iu,
    );
    expect(migration).not.toMatch(/candidate_count\s*<=\s*1/iu);
    expect(migration).toMatch(
      /SELECT\s+'0036_missing_analytics_site_page_lineage'::text[\s\S]*?AS\s+migration_version/iu,
    );
  });

  it("keeps the UUIDv8 Product Profile competitor evidence repair immediately before the analytics lineage repair", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0035_uuidv8_product_profile_competitor_evidence.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.is_typed_product_profile_evidence_refs/iu,
    );
    expect(migration).toMatch(
      /uuid_pattern\s+constant\s+text\s*:=\s*'\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-8\]/iu,
    );
    expect(migration).not.toMatch(
      /uuid_pattern\s+constant\s+text\s*:=\s*'\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0035_uuidv8_product_profile_competitor_evidence'::text[\s\S]*?AS\s+migration_version/iu,
    );
  });

  it("keeps the DataForSEO Search Landscape and SERP overlap migration immediately before the UUIDv8 repair", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0034_dataforseo_search_landscape.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /NEW\.operation\s*=\s*'keyword_gap_import'[\s\S]*?NEW\.method_version\s*=\s*'dataforseo\.ranked_keywords\.v1'[\s\S]*?NEW\.operation\s*=\s*'search_landscape'[\s\S]*?NEW\.method_version\s*=\s*'dataforseo\.search_landscape\.v1'/iu,
    );
    expect(migration).toMatch(
      /snapshot\.dataset_key\s+IN\s*\(\s*'csv\.keyword_gap\.v1'\s*,\s*'dataforseo\.ranked_keywords\.v1'\s*\)[\s\S]*?snapshot\.dataset_key\s*=\s*'dataforseo\.search_landscape\.v1'/iu,
    );
    expect(migration).toMatch(
      /NEW\.metric_key\s+IN\s*\(\s*'csv\.keyword_gap\.v1'\s*,\s*'dataforseo\.competitor_domain\.v1'\s*\)/iu,
    );
    expect(migration).toMatch(
      /competitor_origins_serp_identity_idx[\s\S]*?WHERE\s+origin_kind\s*=\s*'serp_overlap'/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0034_dataforseo_search_landscape'::text\s+AS\s+migration_version/iu,
    );
  });

  it("keeps the durable Analysis Refresh orchestration immediately before Search Landscape", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0033_analysis_refresh_orchestration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.analysis_refresh_runs/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.analysis_refresh_steps/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0033_analysis_refresh_orchestration'::text\s+AS\s+migration_version/iu,
    );
  });

  it("adds a truthful competitor library with only canonical current origins", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0019_competitor_library_foundation.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.competitor_entities/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.competitor_origin_occurrences/iu,
    );
    expect(migration).toMatch(
      /origin_kind\s+IN\s*\(\s*'product_profile'\s*,\s*'csv_keyword_gap'\s*,\s*'manual'\s*\)/iu,
    );
    expect(migration).not.toMatch(
      /origin_kind\s+IN\s*\([^)]*(?:dataforseo|serp_overlap|ai_citation)/iu,
    );
    expect(migration).toMatch(
      /collection_run\.import_preview_id\s*=\s*NEW\.import_preview_id[\s\S]*?NEW\.source_pointer\s*=\s*'\/valueJson\/competitorDomain'/iu,
    );
    expect(migration).toMatch(
      /origin_kind\s*=\s*'manual'[\s\S]*?data_snapshot_id\s+IS\s+NULL[\s\S]*?normalized_observation_id\s+IS\s+NULL/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0019_competitor_library_foundation'::text\s+AS\s+migration_version/iu,
    );
  });

  it("adds a canonical keyword library without copying provider metrics", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0018_keyword_library_foundation.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.keyword_occurrences/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.keyword_entities/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.keyword_entity_sources/iu,
    );
    expect(migration).toMatch(
      /source_kind\s*=\s*'manual'[\s\S]*?data_snapshot_id\s+IS\s+NULL[\s\S]*?normalized_observation_id\s+IS\s+NULL[\s\S]*?source_pointer\s+IS\s+NULL/iu,
    );
    expect(migration).toMatch(
      /dataforseo[\s\S]*?dataforseo\.ranked_keywords\.v1[\s\S]*?NEW\.metric_key\s*=\s*'csv\.keyword_gap\.v1'/iu,
    );
    expect(migration).not.toMatch(
      /keyword_occurrences\s*\([\s\S]*?\b(?:search_)?volume\s+(?:integer|numeric|bigint|real|double)/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0018_keyword_library_foundation'::text\s+AS\s+migration_version/iu,
    );
  });

  it("adds an explicit append-only per-run Finding target ledger", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0017_finding_target_ledger.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.finding_targets/iu,
    );
    expect(migration).toMatch(
      /UNIQUE\s*\(finding_id,\s*diagnostic_run_id,\s*relation_key\)/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.finding_target_relation_key/iu,
    );
    expect(migration).toMatch(
      /jsonb_build_object\([\s\S]*?'relation'[\s\S]*?'targetKind'[\s\S]*?'targetRef'[\s\S]*?'resolutionState'[\s\S]*?'basisKind'[\s\S]*?'sitePageId'[\s\S]*?'pageSnapshotId'[\s\S]*?'sourceObservationId'[\s\S]*?'memberRef'[\s\S]*?'limitation'/iu,
    );
    expect(migration).toMatch(
      /finding_last_seen_run_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.diagnostic_run_id/iu,
    );
    expect(migration).toMatch(
      /jsonb_array_elements\([\s\S]*?diagnostic\.input_manifest\s*->\s*'snapshots'/iu,
    );
    expect(migration).toMatch(
      /observation_site_page_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.site_page_id/iu,
    );
    expect(migration).toMatch(
      /NEW\.member_ref\s+IS\s+DISTINCT\s+FROM\s+observation_fetch_url/iu,
    );
    expect(migration).toMatch(
      /NEW\.member_ref\s+IS\s+DISTINCT\s+FROM\s+observation_subject_ref/iu,
    );
    expect(migration).toMatch(
      /FOR\s+UPDATE[\s\S]*?existing\.relation\s+IS\s+DISTINCT\s+FROM\s+NEW\.relation[\s\S]*?existing\.target_ref\s+IS\s+DISTINCT\s+FROM\s+NEW\.target_ref/iu,
    );
    expect(migration).toMatch(
      /WHEN\s+'TECH-HTTP-001'\s+THEN\s+'affected_by_http_status'[\s\S]*?WHEN\s+'CONTENT-GAP-011'\s+THEN\s+'affected_by_keyword_cluster'[\s\S]*?WHEN\s+'GEO-CRAWLER-002'\s+THEN\s+'affected_by_user_agent'/iu,
    );
    expect(migration).toMatch(
      /finding_targets_one_direct_root_idx[\s\S]*?WHERE\s+relation\s*=\s*'direct_url'/iu,
    );
    expect(migration).toMatch(
      /finding_targets_one_definition_root_idx[\s\S]*?WHERE\s+resolution_state\s*=\s*'definition_only'/iu,
    );
    expect(migration).toMatch(
      /finding_targets_one_observation_member_idx[\s\S]*?source_observation_id\s+IS\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /NEW\.target_ref\s+IS\s+DISTINCT\s+FROM\s+observation_final_status/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TRIGGER\s+finding_targets_append_only[\s\S]*?BEFORE\s+UPDATE\s+OR\s+DELETE/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0017_finding_target_ledger'::text\s+AS\s+migration_version/iu,
    );
  });

  it("adds an append-only Observation to exact SitePage lineage without inventing PageSnapshots", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0016_observation_site_page_lineage.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ALTER\s+TABLE\s+app\.normalized_observations[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+site_page_id\s+uuid/iu,
    );
    expect(migration).toMatch(
      /FOREIGN\s+KEY\s*\(site_page_id\)[\s\S]*?REFERENCES\s+app\.site_pages\s*\(id\)\s+ON\s+DELETE\s+RESTRICT/iu,
    );
    expect(migration).toMatch(
      /CHECK\s*\(site_page_id\s+IS\s+NULL\s+OR\s+subject_type\s*=\s*'url'\)/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+normalized_observations_site_page_metric_idx[\s\S]*?\(\s*project_id,\s*site_page_id,\s*metric_key,\s*observed_at\s+DESC,\s*id\s+DESC\s*\)[\s\S]*?WHERE\s+site_page_id\s+IS\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /page\.workspace_id\s*=\s*NEW\.workspace_id[\s\S]*?page\.project_id\s*=\s*NEW\.project_id[\s\S]*?page\.site_id\s*=\s*snapshot\.site_id/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.lock_site_page_canonical_subjects\([\s\S]*?subject_refs\s+text\[\][\s\S]*?FOR\s+canonical_subject\s+IN[\s\S]*?SELECT\s+DISTINCT[\s\S]*?unnest\(subject_refs\)[\s\S]*?ORDER\s+BY[\s\S]*?pg_advisory_xact_lock\s*\(\s*hashtextextended[\s\S]*?5704921::bigint/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.lock_site_page_canonical_subject\(\)[\s\S]*?app\.lock_site_page_canonical_subjects\([\s\S]*?ARRAY\[canonical_subject\]/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TRIGGER\s+site_pages_canonical_subject_lock[\s\S]*?BEFORE\s+INSERT\s+ON\s+app\.site_pages[\s\S]*?EXECUTE\s+FUNCTION\s+app\.lock_site_page_canonical_subject/iu,
    );
    expect(migration).toMatch(
      /IF\s+NEW\.site_page_id\s+IS\s+NULL\s+THEN[\s\S]*?NEW\.provider\s*=\s*'crawl'[\s\S]*?NEW\.metric_key\s*=\s*'crawl\.page\.v1'/iu,
    );
    expect(migration).toMatch(
      /is_analytics_page\s*:=\s*\([\s\S]*?NEW\.provider\s*=\s*'gsc'[\s\S]*?NEW\.provider\s*=\s*'ga4'[\s\S]*?SELECT\s+count\(\*\)[\s\S]*?TG_OP\s*=\s*'INSERT'\s+AND\s+is_analytics_page[\s\S]*?candidate_count\s*<=\s*1/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_normalized_observation_site_page_lineage\(\)[\s\S]*?app\.lock_site_page_canonical_subjects\([\s\S]*?ARRAY\[canonical_subject\]/iu,
    );
    expect(migration).toMatch(
      /ELSIF\s+is_analytics_page\s+THEN[\s\S]*?candidate_count\s*<>\s*1[\s\S]*?analytics observation SitePage lineage is ambiguous/iu,
    );
    expect(migration).toMatch(
      /NEW\.value_json\s*->>\s*'fetchUrl'\s+IS\s+DISTINCT\s+FROM\s+page_normalized_url/iu,
    );
    expect(migration).toMatch(
      /NEW\.provider\s*=\s*'crawl'[\s\S]*?NEW\.subject_ref\s+IS\s+DISTINCT\s+FROM\s+canonical_subject[\s\S]*?Crawl observation subject does not match its canonical fetch identity/iu,
    );
    expect(migration).not.toMatch(/page_snapshot_id/iu);
    expect(migration).toMatch(
      /SELECT\s+'0016_observation_site_page_lineage'::text\s+AS\s+migration_version/iu,
    );
  });

  it("freezes an exact Product Profile Crawl seed on each collection run", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0015_frozen_crawl_seed.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+crawl_seed_site_page_id\s+uuid/iu,
    );
    expect(migration).toMatch(
      /FOREIGN\s+KEY\s*\(crawl_seed_site_page_id\)[\s\S]*?REFERENCES\s+app\.site_pages\s*\(id\)\s+ON\s+DELETE\s+RESTRICT/iu,
    );
    expect(migration).toMatch(
      /CHECK\s*\(\s*\(crawl_seed_site_page_id\s+IS\s+NULL\)\s*=\s*\(crawl_seed_url\s+IS\s+NULL\)\s*\)/iu,
    );
    expect(migration).toMatch(
      /CHECK\s*\(crawl_seed_site_page_id\s+IS\s+NULL\s+OR\s+provider\s*=\s*'crawl'\)/iu,
    );
    expect(migration).toMatch(
      /length\s*\(crawl_seed_url\)\s+BETWEEN\s+1\s+AND\s+2048/iu,
    );
    expect(migration).toMatch(
      /NEW\.crawl_seed_site_page_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.crawl_seed_site_page_id/iu,
    );
    expect(migration).toMatch(
      /page\.normalized_url_hash\s*=\s*encode\s*\(\s*digest\s*\(\s*convert_to\s*\(NEW\.crawl_seed_url,\s*'UTF8'\)\s*,\s*'sha256'\s*\)/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0015_frozen_crawl_seed'::text\s+AS\s+migration_version/iu,
    );
  });

  it("activates the Product Profile synthesis ledger contract", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0014_product_profile_synthesis.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+app\.product_profile_runs/iu,
    );
    expect(migration).toMatch(
      /kind\s+IN\s*\([\s\S]*?'product_profile_synthesis'/iu,
    );
    expect(migration).toMatch(
      /result_type\s+IS\s+NULL\s+OR\s+result_type\s+IN\s*\([\s\S]*?'icp_profile'/iu,
    );
    expect(migration).toMatch(
      /task\s+IN\s*\([\s\S]*?'product_profile_synthesis'/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TRIGGER\s+product_profile_runs_provenance_guard/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TRIGGER\s+product_profile_runs_frozen_input_guard/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0014_product_profile_synthesis'::text\s+AS\s+migration_version/iu,
    );
  });

  it("accepts historical and exact-variant rule sets while advancing the projection", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0013_exact_url_variant_rules.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /CHECK\s*\(rule_set_version\s+IN\s*\(\s*'mvp\.rules\.0\.2\.0'\s*,\s*'mvp\.rules\.0\.2\.1'\s*\)\s*\)/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0013_exact_url_variant_rules'::text\s+AS\s+migration_version/iu,
    );
  });

  it("hardens new page snapshots while preserving explicit legacy history", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0012_page_snapshot_lineage_hardening.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+canonical_extract\s+text/iu,
    );
    expect(migration).toMatch(
      /ADD\s+CONSTRAINT\s+page_snapshots_canonical_extract_required[\s\S]*?CHECK\s*\(canonical_extract\s+IS\s+NOT\s+NULL\)\s+NOT\s+VALID/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+page_snapshots_verified_source_identity_idx[\s\S]*?\(site_page_id,\s*data_snapshot_id\)[\s\S]*?WHERE\s+canonical_extract\s+IS\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /ADD\s+CONSTRAINT\s+page_snapshots_site_page_data_snapshot_key[\s\S]*?UNIQUE\s*\(site_page_id,\s*data_snapshot_id\)/iu,
    );
    expect(migration).toMatch(
      /NEW\.captured_at\s+IS\s+DISTINCT\s+FROM\s+source_captured_at/iu,
    );
    expect(migration).toMatch(
      /digest\s*\(convert_to\s*\(NEW\.canonical_extract,\s*'UTF8'\),\s*'sha256'\)/iu,
    );
    expect(migration).toMatch(
      /canonical_extract_json\s+IS\s+DISTINCT\s+FROM\s+NEW\.extract/iu,
    );
    expect(migration).not.toMatch(
      /UPDATE\s+app\.page_snapshots[\s\S]*?SET\s+(?:content_hash|extract|canonical_extract)/iu,
    );
    expect(migration).not.toMatch(
      /ALTER\s+TABLE\s+app\.page_snapshots[\s\S]*?ALTER\s+COLUMN\s+canonical_extract\s+SET\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /IF\s+NOT\s+EXISTS\s*\([\s\S]*?GROUP\s+BY\s+site_page_id,\s*data_snapshot_id[\s\S]*?HAVING\s+count\(\*\)\s*>\s*1[\s\S]*?\)\s+AND\s+NOT\s+EXISTS/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0012_page_snapshot_lineage_hardening'::text\s+AS\s+migration_version/iu,
    );
  });

  it("adds a separate confirmed profile pointer and permits unknown site scope", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0011_product_profile_foundation.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+confirmed_icp_profile_id\s+uuid/iu,
    );
    expect(migration).toMatch(
      /FOREIGN\s+KEY\s*\(confirmed_icp_profile_id\)[\s\S]*?REFERENCES\s+app\.icp_profiles\s*\(id\)\s+ON\s+DELETE\s+RESTRICT/iu,
    );
    expect(migration).toMatch(
      /cardinality\s*\(market_codes\)\s+BETWEEN\s+0\s+AND\s+20/iu,
    );
    expect(migration).toMatch(
      /cardinality\s*\(language_codes\)\s+BETWEEN\s+0\s+AND\s+20/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TRIGGER\s+client_projects_icp_profile_provenance_guard[\s\S]*?EXECUTE\s+FUNCTION\s+app\.enforce_client_project_icp_profile_provenance/iu,
    );
    expect(migration).toMatch(
      /UPDATE\s+app\.client_projects\s+project[\s\S]*?SET\s+confirmed_icp_profile_id\s*=\s*profile\.id[\s\S]*?project\.current_icp_profile_id\s*=\s*profile\.id[\s\S]*?profile\.status\s*=\s*'complete'/iu,
    );
    expect(migration).toMatch(
      /SELECT\s+'0011_product_profile_foundation'::text\s+AS\s+migration_version/iu,
    );
  });

  it("freezes each Action to a real observed DiagnosticRun lineage", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0011_product_profile_foundation.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ALTER\s+TABLE\s+app\.actions[\s\S]*?ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+source_diagnostic_run_id\s+uuid/iu,
    );
    expect(migration).toMatch(
      /JOIN\s+app\.finding_observations\s+observation[\s\S]*?observation\.finding_id\s*=\s*action\.source_finding_id[\s\S]*?JOIN\s+app\.diagnostic_runs\s+diagnostic_run[\s\S]*?observation\.created_at\s*<=\s*action\.created_at[\s\S]*?diagnostic_run\.created_at\s*<=\s*action\.created_at/iu,
    );
    expect(migration).toMatch(
      /JOIN\s+app\.evidence\s+source_evidence[\s\S]*?source_evidence\.diagnostic_run_id\s*=\s*observation\.diagnostic_run_id/iu,
    );
    expect(migration).toMatch(
      /WHERE\s+action\.source_diagnostic_run_id\s+IS\s+NULL[\s\S]*?RAISE\s+EXCEPTION\s+'existing action cannot be traced to an observed diagnostic run'/iu,
    );
    expect(migration).toMatch(
      /ALTER\s+TABLE\s+app\.actions[\s\S]*?ALTER\s+COLUMN\s+source_diagnostic_run_id\s+SET\s+NOT\s+NULL/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+TRIGGER\s+actions_source_lineage_guard[\s\S]*?BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+app\.actions[\s\S]*?EXECUTE\s+FUNCTION\s+app\.enforce_action_source_lineage/iu,
    );

    const backfillStart = migration.indexOf("WITH ranked_action_sources AS");
    const backfillEnd = migration.indexOf(
      "ALTER TABLE app.actions\n  ALTER COLUMN source_diagnostic_run_id SET NOT NULL",
    );
    expect(backfillStart).toBeGreaterThanOrEqual(0);
    expect(backfillEnd).toBeGreaterThan(backfillStart);
    expect(migration.slice(backfillStart, backfillEnd)).not.toContain(
      "last_seen_run_id",
    );
  });

  it("activates the current HTTP and immutable export contracts", () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL(
          "../migrations/0010_growth_audit_slice1.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(migration).toMatch(
      /ALTER\s+TABLE\s+app\.async_runs\s+ALTER\s+COLUMN\s+contract_version\s+SET\s+DEFAULT\s+'2026-07-21'/iu,
    );
    expect(migration).toMatch(
      /ALTER\s+TABLE\s+app\.export_bundles[\s\S]*?ALTER\s+COLUMN\s+schema_version\s+SET\s+DEFAULT\s+'signalframe\.service-bundle\.0\.3\.0'/iu,
    );
    expect(migration).toMatch(
      /CHECK\s*\(\s*schema_version\s+IN\s*\(\s*'signalframe\.service-bundle\.0\.2\.0'\s*,\s*'signalframe\.service-bundle\.0\.3\.0'\s*\)\s*\)/iu,
    );
    expect(asyncRuns.contract_version.default).toBe("2026-07-21");
  });

  it("advances the database projection exactly once per migration file", () => {
    const migrationsDirectory = fileURLToPath(
      new URL("../migrations/", import.meta.url),
    );
    const files = readdirSync(migrationsDirectory)
      .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
      .sort();

    expect(files).not.toHaveLength(0);
    for (const file of files) {
      const expected = file.replace(/\.sql$/u, "");
      const sql = readFileSync(`${migrationsDirectory}/${file}`, "utf8");
      const declarations = [
        ...sql.matchAll(
          /SELECT\s+'([^']+)'::text\s+AS\s+migration_version/giu,
        ),
      ].map((match) => match[1]);
      expect(declarations, file).toEqual([expected]);
    }
    expect(files.at(-1)?.replace(/\.sql$/u, "")).toBe(
      LATEST_APP_MIGRATION,
    );
  });

  it("accepts only the exact database-declared current migration", async () => {
    const query = vi.fn(async () => ({
      rows: [{ migration_version: LATEST_APP_MIGRATION }],
    }));

    await expect(
      readMigrationVersion({ query } as never),
    ).resolves.toBe(LATEST_APP_MIGRATION);
    expect(query).toHaveBeenCalledWith(
      "SELECT migration_version FROM app.schema_migration_version",
    );
  });

  it("fails closed on an absent, stale, duplicated, or hostile value", async () => {
    for (const rows of [
      [],
      [{ migration_version: "0005_old" }],
      [
        { migration_version: LATEST_APP_MIGRATION },
        { migration_version: LATEST_APP_MIGRATION },
      ],
      [{ migration_version: { toString: () => "customer-secret" } }],
    ]) {
      const query = vi.fn(async () => ({ rows }));
      await expect(readMigrationVersion({ query } as never)).resolves.toBeNull();
    }
  });
});
