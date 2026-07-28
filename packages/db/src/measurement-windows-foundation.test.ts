import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../migrations/0023_measurement_windows.sql",
  import.meta.url,
);

function migration(): string {
  return readFileSync(fileURLToPath(migrationUrl), "utf8");
}

describe("measurement window foundation migration", () => {
  it("adds one immutable result anchor with separate GSC, GA4, and GEO projections", () => {
    const sql = migration();

    for (const table of [
      "measurement_windows",
      "measurement_gsc_dimensions",
      "measurement_ga4_dimensions",
      "measurement_geo_dimensions",
      "measurement_utm_identities",
      "measurement_ga4_campaigns",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?app\\.${table}`,
          "iu",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          `CREATE\\s+TRIGGER\\s+${table}_append_only[\\s\\S]*?BEFORE\\s+UPDATE\\s+OR\\s+DELETE`,
          "iu",
        ),
      );
    }
  });

  it("anchors outcome to a verified Change Receipt and preserves both hashes", () => {
    const sql = migration();

    expect(sql).toMatch(
      /verified_change_receipt_id\s+uuid\s+NOT\s+NULL[\s\S]*?publication_receipts/iu,
    );
    expect(sql).toMatch(
      /timeline_delivery_receipt_id\s+uuid[\s\S]*?publication_receipts/iu,
    );
    expect(sql).toMatch(
      /artifact_content_hash\s+text\s+NOT\s+NULL[\s\S]*?content_checksum\s+text\s+NOT\s+NULL/iu,
    );
    expect(sql).toMatch(
      /receipt_kind\s*=\s*'change_receipt'[\s\S]*?verification_state\s*=\s*'verified_live'/iu,
    );
    expect(sql).toMatch(
      /timeline_delivery_receipt_id[\s\S]*?predecessor_delivery_receipt_id/iu,
    );
    expect(sql).not.toMatch(/causal_(?:lift|effect)|uplift_percent/iu);
    expect(sql).toContain("'observational_non_causal'");
  });

  it("requires absolute non-overlapping windows and same-scope canonical lineage", () => {
    const sql = migration();

    expect(sql).toMatch(
      /before_start_at\s*<\s*before_end_at[\s\S]*?after_start_at\s*<\s*after_end_at/iu,
    );
    expect(sql).toMatch(
      /before_end_at\s*<=\s*after_start_at/iu,
    );
    expect(sql).toMatch(
      /before_end_at[\s\S]*?change_receipt[\s\S]*?observed_at/iu,
    );
    expect(sql).toMatch(
      /workspace_id\s*=\s*NEW\.workspace_id[\s\S]*?project_id\s*=\s*NEW\.project_id[\s\S]*?site_id\s*=\s*NEW\.site_id/iu,
    );
    expect(sql).toMatch(
      /live_canonical_url[\s\S]*?NEW\.canonical_url/iu,
    );
  });

  it("uses state-aware all-or-none GSC/GA4 phase lineage without fabricated UUIDs", () => {
    const sql = migration();

    const gscStart = sql.indexOf(
      "CREATE TABLE IF NOT EXISTS app.measurement_gsc_dimensions",
    );
    const ga4Start = sql.indexOf(
      "CREATE TABLE IF NOT EXISTS app.measurement_ga4_dimensions",
    );
    const geoStart = sql.indexOf(
      "CREATE TABLE IF NOT EXISTS app.measurement_geo_dimensions",
    );
    expect(gscStart).toBeGreaterThan(-1);
    expect(ga4Start).toBeGreaterThan(gscStart);
    expect(geoStart).toBeGreaterThan(ga4Start);
    const sections = [
      sql.slice(gscStart, ga4Start),
      sql.slice(ga4Start, geoStart),
    ];

    for (const section of sections) {
      expect(section).toMatch(
        /baseline_snapshot_id\s+uuid\s+REFERENCES\s+app\.data_snapshots/iu,
      );
      expect(section).toMatch(
        /outcome_snapshot_id\s+uuid\s+REFERENCES\s+app\.data_snapshots/iu,
      );
      expect(section).toMatch(
        /baseline_observation_id\s+uuid\s+REFERENCES\s+app\.normalized_observations/iu,
      );
      expect(section).toMatch(
        /outcome_observation_id\s+uuid\s+REFERENCES\s+app\.normalized_observations/iu,
      );
      expect(section).toMatch(
        /num_nonnulls\s*\(\s*baseline_source_ref\s*,\s*baseline_snapshot_id\s*,\s*baseline_observation_id\s*,\s*baseline_covered_window\s*,\s*baseline_observed_at\s*,\s*baseline_freshness\s*\)\s+IN\s*\(\s*0\s*,\s*6\s*\)/iu,
      );
      expect(section).toMatch(
        /state\s*=\s*'unavailable'[\s\S]*?baseline_source_ref\s+IS\s+NULL[\s\S]*?outcome_source_ref\s+IS\s+NULL[\s\S]*?coverage\s*=\s*'none'[\s\S]*?limitation\s+IS\s+NOT\s+NULL/iu,
      );
    }

    const ga4 = sections[1]!;
    expect(ga4).toMatch(
      /baseline_snapshot_id\s+IS\s+NULL[\s\S]*?outcome_snapshot_id\s+IS\s+NULL[\s\S]*?baseline_snapshot_id\s*<>\s*outcome_snapshot_id/iu,
    );
    expect(ga4).toMatch(
      /baseline_observation_id\s+IS\s+NULL[\s\S]*?outcome_observation_id\s+IS\s+NULL[\s\S]*?baseline_observation_id\s*<>\s*outcome_observation_id/iu,
    );
    expect(sections[0]).not.toMatch(
      /baseline_snapshot_id\s*<>\s*outcome_snapshot_id/iu,
    );
  });

  it("keeps unavailable samples, sources, definitions, and metrics null while preserving observed zero", () => {
    const sql = migration();

    expect(sql).toMatch(
      /coverage\s*=\s*'none'[\s\S]*?sample_baseline\s+IS\s+NULL[\s\S]*?sample_outcome\s+IS\s+NULL/iu,
    );
    expect(sql).toMatch(
      /state\s*=\s*'unavailable'[\s\S]*?baseline_source_ref\s+IS\s+NULL[\s\S]*?outcome_source_ref\s+IS\s+NULL[\s\S]*?coverage\s*=\s*'none'[\s\S]*?limitation\s+IS\s+NOT\s+NULL/iu,
    );
    expect(sql).toMatch(
      /state\s*=\s*'unavailable'[\s\S]*?direct_conversion_definition_id\s+IS\s+NULL[\s\S]*?assisted_conversion_definition_id\s+IS\s+NULL/iu,
    );
    expect(sql).toMatch(
      /measurement_geo_dimensions[\s\S]*?state\s+text\s+NOT\s+NULL\s+CHECK\s*\(\s*state\s*=\s*'unavailable'\s*\)[\s\S]*?baseline_source_ref\s+IS\s+NULL[\s\S]*?outcome_source_ref\s+IS\s+NULL[\s\S]*?limitation\s+IS\s+NOT\s+NULL/iu,
    );
    expect(sql).not.toMatch(
      /COALESCE\s*\(\s*(?:sample_|clicks_|sessions_|citations_)[^,]*,\s*0\s*\)/iu,
    );
  });

  it("normalizes provider source windows and keeps permanent measurement idempotency", () => {
    const sql = migration();

    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.normalize_measurement_source_window/iu,
    );
    expect(sql).toMatch(
      /start_text\s*::\s*date[\s\S]*?end_text\s*::\s*date\s*\+\s*1/iu,
    );
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+async_runs_measurement_idempotency_idx[\s\S]*?request_payload\s*->>\s*'idempotencyKey'[\s\S]*?WHERE\s+kind\s*=\s*'measurement'/iu,
    );
    expect(sql).toMatch(
      /CREATE\s+CONSTRAINT\s+TRIGGER\s+measurement_windows_completeness_guard[\s\S]*?DEFERRABLE\s+INITIALLY\s+DEFERRED/iu,
    );
  });

  it("stores exact UTM identity and allows no campaign when none applies", () => {
    const sql = migration();

    expect(sql).toMatch(
      /measurement_utm_identities[\s\S]*?source\s+text\s+NOT\s+NULL[\s\S]*?medium\s+text\s+NOT\s+NULL[\s\S]*?campaign\s+text\s+NOT\s+NULL[\s\S]*?content\s+text\s+NOT\s+NULL/iu,
    );
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*workspace_id\s*,\s*project_id\s*,\s*source\s*,\s*medium\s*,\s*campaign\s*,\s*content\s*\)/iu,
    );
    expect(sql).not.toMatch(
      /measurement_ga4_campaigns[\s\S]*?(?:count|cardinality)\s*\([^)]*\)\s*>\s*0/iu,
    );
  });

  it("advances this migration to 0023 before keyword governance 0024", () => {
    expect(migration()).toMatch(
      /SELECT\s+'0023_measurement_windows'::text\s+AS\s+migration_version/iu,
    );
  });
});
