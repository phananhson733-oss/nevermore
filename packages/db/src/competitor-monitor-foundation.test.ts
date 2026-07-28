import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../migrations/0027_competitor_dynamic_monitor.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("0027 Competitor Dynamic Monitor authority", () => {
  it("stores a CAS monthly setting, typed collection lineage, and immutable signals", () => {
    expect(sql).toMatch(
      /CREATE TABLE app\.competitor_monitor_settings/iu,
    );
    expect(sql).toMatch(
      /frequency text NOT NULL CHECK \(frequency = 'monthly'\)/iu,
    );
    expect(sql).toMatch(
      /CREATE TABLE app\.competitor_monitor_runs/iu,
    );
    expect(sql).toMatch(
      /id uuid PRIMARY KEY[\s\S]*?REFERENCES app\.collection_runs\(id\)/iu,
    );
    expect(sql).toMatch(
      /CREATE TABLE app\.competitor_monitor_signals/iu,
    );
    expect(sql).toMatch(
      /EXECUTE FUNCTION app\.reject_append_only_mutation\(\)/iu,
    );
  });

  it("requires approved competitors and exact content or SERP scope", () => {
    expect(sql).toContain("competitor monitor requires an approved competitor");
    expect(sql).toMatch(
      /review_status IS DISTINCT FROM 'approved'/iu,
    );
    expect(sql).toMatch(/'content' = ANY\(competitor\.analysis_scope\)/iu);
    expect(sql).toMatch(
      /'serp_visibility' = ANY\(competitor\.analysis_scope\)/iu,
    );
    expect(sql).toMatch(
      /NEW\.analysis_scopes IS DISTINCT FROM competitor\.analysis_scope/iu,
    );
  });

  it("freezes one market, language, latest confirmed Topic revision, and competitor target", () => {
    for (const required of [
      "target_domain",
      "market",
      "language_tag",
      "topic_model_revision",
      "previous_monitor_run_id",
      "previous_snapshot_id",
      "result_snapshot_id",
      "scheduled_for",
      "evaluation_state",
    ]) {
      expect(sql).toContain(required);
    }
    expect(sql).toMatch(
      /topic_model_revisions[\s\S]*?status IS DISTINCT FROM 'confirmed'/iu,
    );
    expect(sql).toMatch(/source\.site_id IS DISTINCT FROM primary_site\.id/iu);
  });

  it("requires two real snapshots for alerts and a strict greater-than-five rank gain", () => {
    expect(sql).toMatch(
      /previous_snapshot_id uuid NOT NULL[\s\S]*?current_snapshot_id uuid NOT NULL/iu,
    );
    expect(sql).toMatch(/improvement > 5/iu);
    expect(sql).toMatch(
      /signal_kind = 'new_content_overlap'[\s\S]*?publication_evidence = 'first_observed_in_ranked_keywords'/iu,
    );
    expect(sql).toMatch(
      /cardinality\(matched_keyword_ids\) >= 2/iu,
    );
    expect(sql).toMatch(/overlap_ratio >= 0\.5/iu);
    expect(sql).toMatch(/decision\.review_state = 'confirmed'/iu);
    expect(sql).toMatch(
      /decision\.governance_revision[\s\S]*keyword_row\.mapping_revision/iu,
    );
    expect(sql).toMatch(/interval '21 days'/iu);
    expect(sql).toMatch(/interval '45 days'/iu);
  });

  it("keeps GET read models side-effect free and advances only database authority", () => {
    expect(sql).toMatch(
      /SELECT '0027_competitor_dynamic_monitor'::text AS migration_version/iu,
    );
    expect(sql).not.toMatch(/navigation|sidebar|fifth module|new module/iu);
  });
});
