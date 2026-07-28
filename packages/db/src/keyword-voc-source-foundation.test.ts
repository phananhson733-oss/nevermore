import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("../migrations/0029_keyword_voc_sources.sql", import.meta.url),
  "utf8",
);
const smokeSql = readFileSync(
  new URL("../migrations/schema-smoke.sql", import.meta.url),
  "utf8",
);
const migrateCheck = readFileSync(
  new URL("./migrate-check.ts", import.meta.url),
  "utf8",
);
const migrationVersion = readFileSync(
  new URL("./migration-version.ts", import.meta.url),
  "utf8",
);

function latestMigrationOrdinal(source: string): number {
  const match = source.match(
    /(?:LATEST_APP_MIGRATION\s*=\s*|IS DISTINCT FROM\s*)["'](\d{4})_/u,
  );
  return match === null ? -1 : Number(match[1]);
}

describe("0029 Keyword VOC source authority", () => {
  it("keeps interview and review evidence inside the existing Keyword Library", () => {
    expect(migrationSql).toContain("voc.interview_summary.v1");
    expect(migrationSql).toContain("voc.user_review.v1");
    expect(migrationSql).toContain("interview_summary");
    expect(migrationSql).toContain("user_review");
    expect(migrationSql).not.toMatch(
      /CREATE TABLE app\.(?:interview|review|voc)/iu,
    );
    expect(migrationSql).not.toMatch(
      /ALTER TABLE app\.source_connections/iu,
    );
    expect(migrationSql).not.toMatch(
      /navigation|sidebar|fifth module|new product module/iu,
    );
  });

  it("freezes separate research and public-review collection scopes", () => {
    expect(migrationSql).toMatch(
      /keyword_evidence_collection/iu,
    );
    expect(migrationSql).toMatch(
      /WHEN 'voc\.interview_summary\.v1' THEN 'interview_summary'/iu,
    );
    expect(migrationSql).toMatch(
      /WHEN 'voc\.user_review\.v1' THEN 'user_review'/iu,
    );
    expect(migrationSql).toMatch(
      /WHEN 'interview_summary' THEN 'customer_research'/iu,
    );
    expect(migrationSql).toMatch(
      /WHEN 'user_review' THEN 'public_review_platform'/iu,
    );
    expect(migrationSql).toMatch(
      /source_connection_id IS NOT NULL[\s\S]*?internal evidence source/iu,
    );
  });

  it("stores only bounded de-identified Keyword evidence", () => {
    expect(migrationSql).toContain("voc.keyword_evidence.v1");
    expect(migrationSql).toMatch(
      /WHEN 'interview_summary' THEN ARRAY\[[\s\S]*?'keyword'[\s\S]*?'marketCode'[\s\S]*?'languageCode'[\s\S]*?'providerDataAsOf'[\s\S]*?'evidenceLabel'[\s\S]*?'sourceRecordHash'[\s\S]*?\]/iu,
    );
    expect(migrationSql).toMatch(
      /WHEN 'user_review' THEN ARRAY\[[\s\S]*?'reviewPlatform'[\s\S]*?'sourceUrl'[\s\S]*?\]/iu,
    );
    expect(migrationSql).toMatch(
      /NEW\.value_json - allowed_keys <> '\{\}'::jsonb/iu,
    );
    expect(migrationSql).toMatch(
      /source_record_hash !~ '\^\[0-9a-f\]\{64\}\$'/iu,
    );
    expect(migrationSql).toMatch(
      /length\(evidence_label\) NOT BETWEEN 1 AND 200/iu,
    );
    expect(migrationSql).toMatch(
      /source_url !~ '\^https:\/\/'/iu,
    );
    expect(migrationSql).toContain(
      "Raw interview transcripts, review",
    );
    expect(migrationSql).toContain(
      "cannot enter this customer-facing projection",
    );
  });

  it("requires exact Observation, Snapshot, CollectionRun, pointer, and trust lineage", () => {
    expect(migrationSql).toMatch(
      /NEW\.origin <> 'user_provided'[\s\S]*?NEW\.grade <> 'C'/iu,
    );
    expect(migrationSql).toMatch(
      /NEW\.origin <> 'direct_public'[\s\S]*?NEW\.grade <> 'B'/iu,
    );
    expect(migrationSql).toMatch(
      /WHEN 'interview_summary' THEN 'user_provided'/iu,
    );
    expect(migrationSql).toMatch(
      /WHEN 'user_review' THEN 'provider_collection_scope'/iu,
    );
    expect(migrationSql).toMatch(
      /NEW\.source_pointer <> '\/valueJson\/keyword'/iu,
    );
    expect(migrationSql).toMatch(
      /'observation:' \|\| NEW\.normalized_observation_id::text[\s\S]*?'#\/valueJson\/keyword'/iu,
    );
    expect(migrationSql).toMatch(
      /snapshot\.id = observation_row\.snapshot_id[\s\S]*?collection\.id = snapshot_row\.collection_run_id/iu,
    );
  });

  it("routes existing providers through their unchanged guards and advances every schema gate", () => {
    for (const trigger of [
      "collection_runs_voc_provenance_guard",
      "data_snapshots_voc_provenance_guard",
      "normalized_observations_voc_provenance_guard",
      "keyword_occurrences_voc_lineage_guard",
    ]) {
      expect(migrationSql).toContain(trigger);
      expect(smokeSql).toContain(trigger);
      expect(migrateCheck).toContain(trigger);
    }
    for (const routine of [
      "enforce_voc_collection_run_provenance",
      "enforce_voc_data_snapshot_provenance",
      "enforce_voc_keyword_evidence_observation",
      "enforce_voc_keyword_occurrence_lineage",
    ]) {
      expect(migrationSql).toContain(routine);
      expect(smokeSql).toContain(routine);
      expect(migrateCheck).toContain(routine);
    }
    expect(migrationSql).toMatch(
      /WHEN \(NEW\.provider <> 'voc'\)[\s\S]*?EXECUTE FUNCTION app\.enforce_collection_run_provenance\(\)/iu,
    );
    expect(migrationSql).toMatch(
      /WHEN \([\s\S]*?NEW\.source_kind NOT IN \('interview_summary', 'user_review'\)[\s\S]*?EXECUTE FUNCTION app\.enforce_keyword_occurrence_lineage\(\)/iu,
    );
    expect(migrationSql).toContain(
      "SELECT '0029_keyword_voc_sources'::text AS migration_version",
    );
    expect(latestMigrationOrdinal(migrationVersion)).toBeGreaterThanOrEqual(29);
    expect(latestMigrationOrdinal(smokeSql)).toBeGreaterThanOrEqual(29);
  });
});
