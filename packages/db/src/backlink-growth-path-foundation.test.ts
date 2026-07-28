import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../migrations/0030_backlink_growth_path.sql", import.meta.url),
  "utf8",
);

describe("0030 Backlink Growth Map authority", () => {
  it("stores immutable source snapshots, facts, and exact page metrics", () => {
    expect(sql).toMatch(
      /CREATE TABLE app\.backlink_authority_snapshots/iu,
    );
    expect(sql).toMatch(/CREATE TABLE app\.backlink_facts/iu);
    expect(sql).toMatch(/CREATE TABLE app\.backlink_page_metrics/iu);
    expect(sql).toMatch(
      /EXECUTE FUNCTION app\.reject_append_only_mutation\(\)/iu,
    );
    expect(sql).toMatch(
      /SELECT '0030_backlink_growth_path'::text AS migration_version/iu,
    );
  });

  it("keeps Provider totals and DR or DA exclusive to real provider imports", () => {
    expect(sql).toMatch(
      /source_kind IN \('provider_import','manual_csv','search_derived'\)/iu,
    );
    expect(sql).toMatch(
      /provider IN \('ahrefs','moz','manual_csv','search_derived'\)/iu,
    );
    expect(sql).toMatch(
      /source_kind = 'provider_import'[\s\S]*?provider IN \('ahrefs','moz'\)[\s\S]*?total_backlinks IS NOT NULL[\s\S]*?total_referring_domains IS NOT NULL/iu,
    );
    expect(sql).toMatch(
      /provider = 'ahrefs'[\s\S]*?authority_metric_kind = 'domain_rating'/iu,
    );
    expect(sql).toMatch(
      /provider = 'moz'[\s\S]*?authority_metric_kind = 'domain_authority'/iu,
    );
  });

  it("models CSV and search-derived evidence as observed subsets and never fills missing values with zero", () => {
    expect(sql).toMatch(
      /source_kind = 'manual_csv'[\s\S]*?index_scope = 'observed_subset'[\s\S]*?total_backlinks IS NULL[\s\S]*?authority_metric_kind IS NULL/iu,
    );
    expect(sql).toMatch(
      /source_kind = 'search_derived'[\s\S]*?index_scope = 'observed_subset'[\s\S]*?total_backlinks IS NULL[\s\S]*?authority_metric_kind IS NULL/iu,
    );
    expect(sql).toMatch(
      /availability = 'unavailable'[\s\S]*?total_backlinks IS NULL[\s\S]*?observed_backlinks IS NULL/iu,
    );
    expect(sql).not.toMatch(
      /COALESCE\s*\(\s*(?:total_backlinks|total_referring_domains|observed_backlinks|observed_referring_domains)[^,]*,\s*0\s*\)/iu,
    );
  });

  it("requires an exact consumed backlink CSV preview and approved competitor scope", () => {
    expect(sql).toContain("preview.template_id = 'backlink_v1'");
    expect(sql).toContain("preview.status = 'consumed'");
    expect(sql).toMatch(
      /competitor\.review_status IS DISTINCT FROM 'approved'/iu,
    );
    expect(sql).toMatch(
      /backlink snapshot competitor is not approved in the exact project scope/iu,
    );
  });

  it("binds page metrics and facts to the same project, site, snapshot, and canonical URL", () => {
    expect(sql).toMatch(
      /backlink page metric does not match its primary-site snapshot and exact SitePage/iu,
    );
    expect(sql).toMatch(
      /page\.normalized_url IS DISTINCT FROM NEW\.target_url/iu,
    );
    expect(sql).toMatch(
      /backlink fact does not match its snapshot or exact target SitePage/iu,
    );
    expect(sql).toMatch(
      /primary-site backlink fact target URL is outside its canonical Site origin/iu,
    );
    expect(sql).toMatch(
      /primary_site\.origin NOT IN \([\s\S]*?'http:\/\/' \|\| primary_site\.host,[\s\S]*?'https:\/\/' \|\| primary_site\.host/iu,
    );
  });
});
