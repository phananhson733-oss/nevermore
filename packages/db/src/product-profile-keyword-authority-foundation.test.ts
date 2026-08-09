import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_APP_MIGRATION } from "./migration-version.ts";

const migrationPath = fileURLToPath(
  new URL(
    "../migrations/0049_product_profile_keyword_lineage.sql",
    import.meta.url,
  ),
);
const migration = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";
const cohortSource = readFileSync(
  fileURLToPath(
    new URL("./repositories/product-profile-ai-cohort.ts", import.meta.url),
  ),
  "utf8",
);
const migrateCheckSource = readFileSync(
  fileURLToPath(new URL("./migrate-check.ts", import.meta.url)),
  "utf8",
);

function sourceTemplateIds(language: "english" | "chinese"): string[] {
  const end = language === "english" ? "chineseCandidates" : "deriveConfirmed";
  const start = language === "english" ? "englishCandidates" : "chineseCandidates";
  const englishBody = cohortSource.match(
    new RegExp(
      `function ${start}[\\s\\S]*?return \\[([\\s\\S]*?)\\n  \\];\\n\\}\\n\\n(?:export )?function ${end}`,
      "u",
    ),
  )?.[1];
  return [...(englishBody ?? "").matchAll(/\["([a-z0-9-]+)",/gu)].map(
    (match) => match[1]!,
  );
}

function migrationTemplateIds(): string[] {
  const arrayBody = migration.match(
    /allowed_template_ids text\[\] := ARRAY\[([\s\S]*?)\]::text\[\]/u,
  )?.[1];
  return [...(arrayBody ?? "").matchAll(/'([a-z0-9-]+)'/gu)].map(
    (match) => match[1]!,
  );
}

describe("Product Profile Keyword Library database authority", () => {
  it("publishes the forward-only 0049 migration head", () => {
    expect(LATEST_APP_MIGRATION).toBe(
      "0049_product_profile_keyword_lineage",
    );
    expect(migration).toContain(
      "SELECT '0049_product_profile_keyword_lineage'::text AS migration_version",
    );
  });

  it("adds a restrictive nullable Product Profile FK and fail-closed row shape", () => {
    expect(migration).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+product_profile_id\s+uuid/iu,
    );
    expect(migration).toMatch(
      /keyword_occurrences_product_profile_fk[\s\S]*?FOREIGN\s+KEY\s*\(product_profile_id\)[\s\S]*?REFERENCES\s+app\.icp_profiles\s*\(id\)[\s\S]*?ON\s+DELETE\s+RESTRICT/iu,
    );
    expect(migration).toMatch(
      /source_kind\s+IN\s*\([\s\S]*?'product_profile'[\s\S]*?'manual'[\s\S]*?\)/iu,
    );
    expect(migration).toMatch(
      /source_kind\s*=\s*'product_profile'[\s\S]*?product_profile_id\s+IS\s+NOT\s+NULL[\s\S]*?data_snapshot_id\s+IS\s+NULL[\s\S]*?normalized_observation_id\s+IS\s+NULL[\s\S]*?source_pointer\s+IS\s+NULL[\s\S]*?provider_data_as_of\s+IS\s+NULL/iu,
    );
    expect(migration).toMatch(
      /source_kind\s*<>\s*'product_profile'[\s\S]*?product_profile_id\s+IS\s+NULL/iu,
    );
  });

  it("locks the active project, confirmed complete profile and authoritative market/language scope", () => {
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.enforce_product_profile_keyword_occurrence_lineage/iu,
    );
    expect(migration).toMatch(
      /project\.confirmed_icp_profile_id\s*=\s*NEW\.product_profile_id/iu,
    );
    expect(migration).not.toMatch(
      /project\.current_icp_profile_id\s*=\s*NEW\.product_profile_id/iu,
    );
    expect(migration).toMatch(/profile\.status\s*=\s*'complete'/iu);
    expect(migration).toMatch(/project\.archived_at\s+IS\s+NULL/iu);
    expect(migration).toMatch(/FOR\s+SHARE\s+OF\s+project,\s*profile/iu);
    expect(migration).toMatch(/FOR\s+SHARE\s+OF\s+primary_site/iu);
    expect(migration).not.toMatch(
      /cardinality\(primary_site_row\.market_codes\)\s+IS\s+DISTINCT\s+FROM\s+1/iu,
    );
    expect(migration).toMatch(/profile\.profile/iu);
    expect(migration).toMatch(
      /jsonb_array_elements[\s\S]*?targetMarkets[\s\S]*?priority[\s\S]*?primary/iu,
    );
    expect(migration).toMatch(
      /primary_market_count\s+IS\s+DISTINCT\s+FROM\s+1/iu,
    );
    expect(migration).toMatch(
      /profile_primary_market\s*=\s*ANY\s*\(primary_site_row\.market_codes\)/iu,
    );
    expect(migration).toMatch(
      /cardinality\(primary_site_row\.language_codes\)\s+IS\s+DISTINCT\s+FROM\s+1/iu,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app\.is_bcp47_canonical_identity\s*\(\s*raw_candidate\s+text,\s*canonical_candidate\s+text\s*\)/iu,
    );
    expect(migration).toMatch(
      /NOT\s+app\.is_bcp47_canonical_identity\s*\(\s*primary_site_row\.language_codes\[1\],\s*NEW\.language_tag\s*\)/iu,
    );
    expect(migration).toMatch(
      /profile_primary_market\s+IS\s+DISTINCT\s+FROM\s+NEW\.market/iu,
    );
    expect(migration).not.toMatch(
      /primary_site_row\.language_codes\[1\]\s+IS\s+DISTINCT\s+FROM\s+NEW\.language_tag/iu,
    );
    expect(migration).toMatch(
      /NEW\.collected_at\s+IS\s+DISTINCT\s+FROM\s+profile_created_at/iu,
    );
    expect(migration).toMatch(/normalize\(NEW\.display_keyword,\s*NFKC\)/iu);
  });

  it("keeps the SQL template allowlist byte-for-byte aligned with the fixed cohort", () => {
    const sourceIds = sourceTemplateIds("english");
    const chineseIds = sourceTemplateIds("chinese");
    const sqlIds = migrationTemplateIds();
    expect(sourceIds).toHaveLength(20);
    expect(new Set(sourceIds).size).toBe(20);
    expect(chineseIds).toEqual(sourceIds);
    expect(sqlIds).toEqual(sourceIds);
  });

  it("replaces scalar and batch authorities without leaving the old arity", () => {
    expect(migration).toMatch(
      /DROP\s+FUNCTION\s+app\.upsert_keyword_library_occurrences_batch\s*\(uuid,\s*uuid,\s*jsonb\)/iu,
    );
    expect(migration).toMatch(
      /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?app\.upsert_keyword_library_occurrence\s*\([\s\S]*?timestamptz\s*\)/iu,
    );
    expect(migration).toMatch(/selected_product_profile_id\s+uuid/iu);
    expect(migration).toMatch(
      /occurrence_row\.product_profile_id\s+IS\s+DISTINCT\s+FROM\s+selected_product_profile_id/iu,
    );
    expect(migration).toMatch(
      /\(SELECT count\(\*\) FROM jsonb_object_keys\(selected_input\)\)\s*<>\s*15/iu,
    );
    expect(migration).toMatch(/'productProfileId'/u);
    expect(migration).toMatch(
      /\(selected_input\s*->>\s*'productProfileId'\)::uuid/iu,
    );
  });

  it("preserves the provider, VOC and append-only guard routes", () => {
    expect(migration).toMatch(
      /NEW\.source_kind\s+NOT\s+IN\s*\('interview_summary',\s*'user_review',\s*'product_profile'\)[\s\S]*?app\.enforce_keyword_occurrence_lineage\(\)/iu,
    );
    expect(migration).toMatch(
      /NEW\.source_kind\s+IN\s*\('interview_summary',\s*'user_review'\)[\s\S]*?app\.enforce_voc_keyword_occurrence_lineage\(\)/iu,
    );
    expect(migration).toMatch(
      /NEW\.source_kind\s*=\s*'product_profile'[\s\S]*?app\.enforce_product_profile_keyword_occurrence_lineage\(\)/iu,
    );
    expect(migration).not.toMatch(/DROP\s+TRIGGER[\s\S]*?keyword_occurrences_append_only/iu);
  });

  it("keeps the migration checker aware of the new trigger and callable authorities", () => {
    expect(migrateCheckSource).toContain(
      '"keyword_occurrences_product_profile_lineage_guard"',
    );
    expect(migrateCheckSource).toContain(
      '"enforce_product_profile_keyword_occurrence_lineage"',
    );
    expect(migrateCheckSource).toContain(
      '"is_bcp47_canonical_identity"',
    );
    expect(migrateCheckSource).toContain(
      '"upsert_keyword_library_occurrences_batch"',
    );
  });
});
