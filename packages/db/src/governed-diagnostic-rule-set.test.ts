import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../migrations/0024_keyword_governance_foundation.sql",
  import.meta.url,
);

describe("governed diagnostic rule-set migration", () => {
  it("keeps both historical rule sets and adds current 0.2.2", () => {
    const migration = readFileSync(fileURLToPath(migrationUrl), "utf8");

    expect(migration).toMatch(
      /CHECK\s*\(\s*rule_set_version\s+IN\s*\(\s*'mvp\.rules\.0\.2\.0'\s*,\s*'mvp\.rules\.0\.2\.1'\s*,\s*'mvp\.rules\.0\.2\.2'\s*\)\s*\)/iu,
    );
    expect(migration).not.toMatch(
      /UPDATE\s+app\.(?:diagnostic_runs|diagnostic_run_rules|findings)/iu,
    );
  });

  it("requires the canonical governance envelope only for current runs", () => {
    const migration = readFileSync(fileURLToPath(migrationUrl), "utf8");

    expect(migration).toMatch(
      /NEW\.rule_set_version\s+NOT\s+IN\s*\(\s*'mvp\.rules\.0\.2\.1'\s*,\s*'mvp\.rules\.0\.2\.2'\s*\)/iu,
    );
    expect(migration).toMatch(
      /NEW\.rule_set_version\s*=\s*'mvp\.rules\.0\.2\.2'[\s\S]*?jsonb_typeof\s*\(\s*NEW\.input_manifest\s*->\s*'governance'\s*\)\s+IS\s+DISTINCT\s+FROM\s+'object'[\s\S]*?growth-governance\.1\.0\.0[\s\S]*?'keywordClusters'[\s\S]*?'competitors'/iu,
    );
  });

  it("bumps only CONTENT-GAP-011 beyond the 0.2.1 rule versions", () => {
    const migration = readFileSync(fileURLToPath(migrationUrl), "utf8");

    expect(migration).toMatch(
      /selected_rule_set\s*=\s*'mvp\.rules\.0\.2\.2'[\s\S]*?selected_rule_id\s*=\s*'CONTENT-GAP-011'[\s\S]*?THEN\s+2/iu,
    );
    expect(migration).toMatch(
      /selected_rule_set\s+IN\s*\(\s*'mvp\.rules\.0\.2\.1'\s*,\s*'mvp\.rules\.0\.2\.2'\s*\)[\s\S]*?'TECH-HTTP-001'[\s\S]*?'TECH-CANONICAL-002'[\s\S]*?'TECH-LINKGRAPH-005'[\s\S]*?THEN\s+2/iu,
    );
    expect(migration).toMatch(
      /selected_rule_set\s+IN\s*\(\s*'mvp\.rules\.0\.2\.0'\s*,\s*'mvp\.rules\.0\.2\.1'\s*,\s*'mvp\.rules\.0\.2\.2'\s*\)\s+THEN\s+1/iu,
    );
  });

  it("advances the database projection to keyword governance migration 0024", () => {
    const migration = readFileSync(fileURLToPath(migrationUrl), "utf8");

    expect(migration).toMatch(
      /SELECT\s+'0024_keyword_governance_foundation'::text\s+AS\s+migration_version/iu,
    );
  });
});
