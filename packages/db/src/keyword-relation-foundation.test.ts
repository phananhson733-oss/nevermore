import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../migrations/0025_keyword_relation_governance.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("0025 Keyword Relation governance foundation", () => {
  it("stores an immutable unordered pair, candidate evidence, and decisions", () => {
    expect(sql).toMatch(
      /CREATE TABLE app\.keyword_relation_identities/iu,
    );
    expect(sql).toMatch(/CHECK \(keyword_a_id < keyword_b_id\)/iu);
    expect(sql).toMatch(
      /CREATE TABLE app\.keyword_relation_candidates/iu,
    );
    expect(sql).toMatch(
      /CREATE TABLE app\.keyword_relation_decisions/iu,
    );
    expect(sql.match(/EXECUTE FUNCTION app\.reject_append_only_mutation\(\)/gu))
      .toHaveLength(3);
  });

  it("freezes the exact reviewed page, Intent, market, language, and rule evidence", () => {
    for (const required of [
      "keyword_a_governance_revision",
      "keyword_b_governance_revision",
      "mapped_site_page_id",
      "normalized_intent",
      "market",
      "language_tag",
      "same_confirmed_topic",
      "lexical_token_overlap",
      "serp_overlap_availability",
      "evidence_hash",
      "keyword-relation.1.0.0",
    ]) {
      expect(sql).toContain(required);
    }
    expect(sql).toMatch(
      /app\.keyword_relation_token_overlap\(\s*keyword_a\.normalized_keyword,\s*keyword_b\.normalized_keyword\s*\)/iu,
    );
  });

  it("makes candidate drift explicit and rejects stale folds, chains, and cycles", () => {
    expect(sql).toContain(
      "app.keyword_relation_candidate_stale_reasons",
    );
    for (const reason of [
      "candidate_superseded",
      "keyword_unavailable",
      "governance_revision_changed",
      "mapping_changed",
      "intent_changed",
      "market_changed",
      "language_changed",
    ]) {
      expect(sql).toContain(reason);
    }
    expect(sql).toContain(
      "Keyword Relation decision requires the current candidate",
    );
    expect(sql).toContain(
      "Keyword folds cannot create chains or cycles",
    );
  });

  it("advances only the database authority, not a fifth customer module", () => {
    expect(sql).toMatch(
      /SELECT '0025_keyword_relation_governance'::text AS migration_version/iu,
    );
    expect(sql).not.toMatch(/navigation|sidebar|module/iu);
  });
});
