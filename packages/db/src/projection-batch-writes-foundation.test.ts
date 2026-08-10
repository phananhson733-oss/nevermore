import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_APP_MIGRATION } from "./migration-version.ts";

const migration = readFileSync(
  fileURLToPath(
    new URL("../migrations/0049_projection_batch_writes.sql", import.meta.url),
  ),
  "utf8",
);

describe("bounded collection projection writes", () => {
  it("keeps 0049 below the forward-only application migration head", () => {
    expect(LATEST_APP_MIGRATION).toBe(
      "0052_keyword_governance_schedule_requests",
    );
  });

  it("bounds keyword and competitor input batches and delegates exact lineage checks", () => {
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.upsert_keyword_library_occurrences_batch/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.upsert_competitor_origins_batch/iu,
    );
    expect(migration).toMatch(/jsonb_array_length\([^)]*\)\s*>\s*500/iu);
    expect(migration).toMatch(/app\.upsert_keyword_library_occurrence\s*\(/iu);
    expect(migration).toMatch(/app\.upsert_serp_overlap_competitor_origin\s*\(/iu);
    expect(migration).toMatch(/app\.upsert_ai_citation_competitor_origin\s*\(/iu);
    expect(migration).toMatch(
      /provider competitor origin contains irrelevant lineage fields/iu,
    );
    expect(migration).toMatch(
      /competitor origin sourceAnalysisScope must be an array or null/iu,
    );
  });

  it("detects and converges provider discrepancies in one set statement", () => {
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.detect_provider_discrepancies_for_snapshot/iu,
    );
    expect(migration).toMatch(/INSERT\s+INTO\s+app\.provider_discrepancies/iu);
    expect(migration).toMatch(/ON\s+CONFLICT\s+DO\s+NOTHING/iu);
    expect(migration).toMatch(/IS\s+DISTINCT\s+FROM/iu);
    expect(migration).toMatch(/SELECT\s+DISTINCT/iu);
    expect(migration).toMatch(/least\(current_observation\.id/iu);
    expect(migration).toMatch(/greatest\(current_observation\.id/iu);
  });
});
