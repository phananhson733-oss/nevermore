import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../migrations/0044_dataforseo_backlinks.sql",
  import.meta.url,
);
const sql = existsSync(migrationUrl)
  ? readFileSync(migrationUrl, "utf8")
  : "";

describe("0044 DataForSEO Backlinks authority", () => {
  it("adds one ordered migration instead of rewriting historical authority", () => {
    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toContain(
      "SELECT '0044_dataforseo_backlinks'::text AS migration_version",
    );
  });

  it("admits only the exact DataForSEO backlinks collection identity", () => {
    expect(sql).toMatch(/operation IN \([\s\S]*?'backlinks'/u);
    expect(sql).toMatch(/'dataforseo\.backlinks\.v1'/u);
    expect(sql).toMatch(
      /NEW\.operation = 'backlinks'[\s\S]*?NEW\.method_version = 'dataforseo\.backlinks\.v1'/u,
    );
    expect(sql).toMatch(
      /NEW\.metric_key IN \([\s\S]*?'dataforseo\.backlink_summary\.v1'[\s\S]*?'dataforseo\.backlink\.v1'[\s\S]*?'dataforseo\.referring_domain\.v1'[\s\S]*?'dataforseo\.backlink_page\.v1'/u,
    );
  });

  it("keeps DataForSEO Rank provider-aligned instead of relabeling it DR or DA", () => {
    expect(sql).toMatch(
      /provider IN \('ahrefs','moz','dataforseo','manual_csv','search_derived'\)/u,
    );
    expect(sql).toMatch(/'dataforseo_rank'/u);
    expect(sql).toMatch(
      /WHEN 'dataforseo' THEN 'dataforseo_rank'/u,
    );
  });

  it("projects only successful available Provider evidence", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION app\.enforce_backlink_authority_snapshot_insert\(\)[\s\S]*?IF NEW\.provider = 'dataforseo' THEN[\s\S]*?NEW\.availability <> 'available'/u,
    );
  });

  it("persists bounded crawler verification without treating inconclusive evidence as absence", () => {
    expect(sql).toMatch(
      /verification_status[\s\S]*?'not_checked'[\s\S]*?'verified'[\s\S]*?'absent'[\s\S]*?'blocked'[\s\S]*?'inconclusive'/u,
    );
    expect(sql).toContain("verified_at");
    expect(sql).toContain("verification_final_url");
    expect(sql).toContain("verification_http_status");
    expect(sql).toContain("verification_limitation");
  });

  it("accepts legacy plan v1 while freezing new runs to exact plan v2", () => {
    expect(sql).toContain("analysis-refresh.plan.v1");
    expect(sql).toContain("analysis-refresh.plan.v2");
    expect(sql).toContain(
      "d725c90b76edf0bd7747a8d3dcf18754dfa9c5356f66ca765acbaa4145e405af",
    );
    expect(sql).toContain(
      "3049a718f77263f766e47d0d7318a9414520d07c8ab92960f50c85b864977c65",
    );
    expect(sql).toMatch(
      /ordinal = 5 AND step_key = 'dataforseo_backlinks' AND NOT required/u,
    );
    expect(sql).toMatch(
      /ordinal = 6 AND step_key = 'growth_audit' AND required/u,
    );
  });

  it("resumes exact Search Landscape v1 or v2 identities without admitting mixed versions", () => {
    expect(sql).toMatch(
      /NEW\.step_key = 'dataforseo'[\s\S]*?collection\.operation = 'search_landscape'[\s\S]*?collection\.method_version IN \(\s*'dataforseo\.search_landscape\.v1',\s*'dataforseo\.search_landscape\.v2'\s*\)/u,
    );
    expect(sql).toMatch(
      /NEW\.step_key = 'dataforseo'[\s\S]*?snapshot\.dataset_key IN \(\s*'dataforseo\.search_landscape\.v1',\s*'dataforseo\.search_landscape\.v2'\s*\)[\s\S]*?snapshot\.schema_version = snapshot\.dataset_key[\s\S]*?snapshot\.method_version = snapshot\.dataset_key[\s\S]*?collection\.operation = 'search_landscape'[\s\S]*?collection\.method_version = snapshot\.method_version/u,
    );
    expect(sql).toMatch(
      /NEW\.step_key = 'dataforseo_backlinks'[\s\S]*?collection\.operation = 'backlinks'[\s\S]*?collection\.method_version = 'dataforseo\.backlinks\.v1'/u,
    );
    expect(sql).toMatch(
      /NEW\.step_key = 'dataforseo_backlinks'[\s\S]*?snapshot\.dataset_key = 'dataforseo\.backlinks\.v1'[\s\S]*?snapshot\.schema_version = 'dataforseo\.backlinks\.v1'[\s\S]*?snapshot\.method_version = 'dataforseo\.backlinks\.v1'/u,
    );
  });
});
