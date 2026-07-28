import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../migrations/0028_geo_citation_authority.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("0028 GEO citation authority", () => {
  it("extends the canonical collection chain without creating a product module", () => {
    expect(sql).toMatch(
      /source_connections_provider_check[\s\S]*?'geo'/iu,
    );
    expect(sql).toMatch(
      /collection_runs_provider_check[\s\S]*?'geo'/iu,
    );
    expect(sql).toMatch(
      /collection_runs_operation_check[\s\S]*?'ai_citation_monitor'/iu,
    );
    expect(sql).toContain("geo.answer_citations.v1");
    expect(sql).toContain("geo.page_citations.v1");
    expect(sql).not.toMatch(
      /navigation|sidebar|fifth module|new module/iu,
    );
  });

  it("stores immutable query, platform, collector, bounded answer, citation, and paragraph evidence", () => {
    expect(sql).toMatch(
      /CREATE TABLE app\.geo_query_observations/iu,
    );
    expect(sql).toMatch(
      /CREATE TABLE app\.geo_citation_occurrences/iu,
    );
    for (const field of [
      "query_text",
      "query_hash",
      "platform_kind",
      "platform_key",
      "model",
      "collector_kind",
      "collector_provider_key",
      "collector_version",
      "collected_at",
      "market_code",
      "language_tag",
      "answer_evidence_excerpt",
      "answer_content_hash",
      "answer_selector",
      "citation_url",
      "answer_evidence_excerpt",
      "cited_page_excerpt",
      "cited_page_content_hash",
      "cited_paragraph_hash",
      "cited_paragraph_selector",
      "cited_paragraph_index",
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toMatch(
      /length\(answer_evidence_excerpt\) BETWEEN 1 AND 1000/iu,
    );
    expect(sql).toMatch(
      /length\(cited_page_excerpt\) BETWEEN 1 AND 1000/iu,
    );
    expect(sql).toMatch(
      /evidence_classification text NOT NULL[\s\S]*?direct_observation/iu,
    );
    expect(sql).toMatch(
      /EXECUTE FUNCTION app\.reject_append_only_mutation\(\)/iu,
    );
  });

  it("enforces exact project, site, market, language, page, canonical URL, snapshot, and normalized-observation lineage", () => {
    expect(sql).toMatch(
      /geo query observation scope or canonical page lineage is invalid/iu,
    );
    expect(sql).toMatch(
      /page_row\.workspace_id = NEW\.workspace_id[\s\S]*?page_row\.project_id = NEW\.project_id[\s\S]*?page_row\.site_id = NEW\.site_id[\s\S]*?page_row\.normalized_url = NEW\.canonical_url/iu,
    );
    expect(sql).toMatch(
      /NEW\.market_code = ANY\(site_row\.market_codes\)/iu,
    );
    expect(sql).toMatch(
      /NEW\.language_tag = ANY\(site_row\.language_codes\)/iu,
    );
    expect(sql).toMatch(
      /normalized\.snapshot_id = NEW\.snapshot_id[\s\S]*?normalized\.site_page_id = NEW\.site_page_id[\s\S]*?normalized\.metric_key = 'geo\.page_citations\.v1'/iu,
    );
    expect(sql).toMatch(
      /geo citation occurrence scope or evidence lineage is invalid/iu,
    );
  });

  it("upgrades GEO Measurement to real nullable phase lineage without inventing zero", () => {
    expect(sql).toMatch(
      /ALTER TABLE app\.measurement_geo_dimensions[\s\S]*?ADD COLUMN baseline_observation_id uuid[\s\S]*?ADD COLUMN outcome_observation_id uuid/iu,
    );
    expect(sql).toMatch(
      /measurement_provider_phase_is_canonical[\s\S]*?WHEN 'geo' THEN 'geo\.page_citations\.v1'/iu,
    );
    expect(sql).toMatch(
      /WHEN 'geo' THEN 'geo\.answer_citations\.v1'/iu,
    );
    expect(sql).not.toMatch(
      /COALESCE\s*\(\s*(?:tracked_queries|cited_queries|citations|citation_rate)[^,]*,\s*0\s*\)/iu,
    );
  });

  it("supports reverse lookup and advances only after 0027", () => {
    expect(sql).toMatch(
      /geo_query_observations_normalized_idx/iu,
    );
    expect(sql).toMatch(
      /geo_citation_occurrences_query_idx/iu,
    );
    expect(sql).toMatch(
      /SELECT '0028_geo_citation_authority'::text AS migration_version/iu,
    );
  });
});
