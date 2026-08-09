import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_APP_MIGRATION } from "./migration-version.ts";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../migrations/0047_dataforseo_competitor_metrics.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

describe("DataForSEO competitor metric authority", () => {
  it("admits Search Landscape v3 without rewriting readable v1/v2 lineage", () => {
    expect(LATEST_APP_MIGRATION).toBe(
      "0050_product_profile_keyword_lineage",
    );
    expect(migration).toMatch(/dataforseo\.search_landscape\.v1/iu);
    expect(migration).toMatch(/dataforseo\.search_landscape\.v2/iu);
    expect(migration).toMatch(/dataforseo\.search_landscape\.v3/iu);
    expect(migration).toMatch(/dataforseo\.competitor_domain\.v2/iu);
    expect(migration).toMatch(/dataforseo\.competitor_ai_citation\.v1/iu);
    expect(migration).toMatch(
      /enforce_analysis_refresh_step_mutation[\s\S]*?dataforseo\.search_landscape\.v1[\s\S]*?dataforseo\.search_landscape\.v2[\s\S]*?dataforseo\.search_landscape\.v3/iu,
    );
  });

  it("fails closed on organic overlap without exact same-observation operands", () => {
    expect(migration).toMatch(/targetOrganicKeywordCount/iu);
    expect(migration).toMatch(/serpOverlap/iu);
    expect(migration).toMatch(/intersections\s*>\s*target_organic_keyword_count/iu);
    expect(migration).toMatch(
      /serp_overlap\s+IS\s+DISTINCT\s+FROM\s+round\(intersections\s*\/\s*target_organic_keyword_count\s*,\s*12\)/iu,
    );
  });

  it("requires an exact observed fixed-20 AI aggregate and bounded outcomes", () => {
    for (const key of [
      "targetDomain",
      "competitorDomain",
      "attemptedQueries",
      "observedQueries",
      "citedQueries",
      "unavailableQueries",
      "cohortCoverage",
      "querySetHash",
      "platform",
      "model",
      "marketCode",
      "languageTag",
      "queryOutcomes",
    ]) {
      expect(migration).toContain(`'${key}'`);
    }
    expect(migration).toMatch(/attempted_queries\s*<>\s*20/iu);
    expect(migration).toMatch(/observed_queries\s*<=\s*0/iu);
    expect(migration).toMatch(
      /observed_queries\s*\+\s*unavailable_queries\s*<>\s*attempted_queries/iu,
    );
    expect(migration).toMatch(/cited_queries\s*>\s*observed_queries/iu);
    expect(migration).toMatch(/jsonb_array_length\([^)]*queryOutcomes[^)]*\)\s*<>\s*20/iu);
    expect(migration).toMatch(/outcome_key_count\s*<>\s*5/iu);
  });

  it("adds append-only exact-lineage AI origins and widens SERP origins to v3", () => {
    expect(migration).toMatch(
      /origin_kind\s+IN\s*\([\s\S]*?'serp_overlap'[\s\S]*?'ai_citation'/iu,
    );
    expect(migration).toMatch(
      /competitor_origins_ai_citation_identity_idx[\s\S]*?WHERE\s+origin_kind\s*=\s*'ai_citation'/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_ai_citation_competitor_origin_lineage/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.upsert_ai_citation_competitor_origin/iu,
    );
    expect(migration).toMatch(
      /enforce_serp_overlap_competitor_origin_lineage[\s\S]*?dataforseo\.search_landscape\.v3[\s\S]*?dataforseo\.competitor_domain\.v2/iu,
    );
  });
});
