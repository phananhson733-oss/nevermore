import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LATEST_APP_MIGRATION } from "./migration-version.ts";

const migrationUrl = new URL(
  "../migrations/0052_keyword_governance_schedule_requests.sql",
  import.meta.url,
);
const migrationPath = fileURLToPath(migrationUrl);

describe("Keyword governance durable schedule request authority", () => {
  it("advances the ordered migration head and installs the durable request authority", () => {
    expect(LATEST_APP_MIGRATION).toBe(
      "0053_keyword_governance_suggestion_locale_authority",
    );
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS app.keyword_governance_schedule_requests",
    );
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("generation_continuation");
    expect(migration).toContain(
      "KEYWORD_GOVERNANCE_SCHEDULE_DISPATCH_FAILED",
    );
    for (const sourceKind of [
      "analysis_refresh",
      "csv_keyword_gap_import",
      "topic_model_confirmation_system",
      "topic_model_confirmation_manual",
      "generation_continuation",
    ]) {
      expect(migration).toContain(`'${sourceKind}'`);
    }
    for (const routine of [
      "insert_keyword_governance_schedule_request",
      "claim_keyword_governance_schedule_request",
      "claim_keyword_governance_schedule_request_by_source",
      "claim_due_keyword_governance_schedule_requests",
      "complete_keyword_governance_schedule_request",
      "release_keyword_governance_schedule_request",
      "supersede_stale_pending_keyword_review_suggestions",
    ]) {
      expect(migration).toMatch(
        new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:\\n\\s*)?app\\.${routine}`, "iu"),
      );
    }
    expect(migration).toMatch(
      /append_keyword_governance_generation_continuation_request[\s\S]*?OLD\.status\s*<>\s*'running'[\s\S]*?keyword_governance_suggestion_generation_runs[\s\S]*?NEW\.workspace_id[\s\S]*?NEW\.project_id[\s\S]*?requestNextBatch[\s\S]*?NEW\.id::text[\s\S]*?NEW\.initiated_by/iu,
    );
    for (const invariant of [
      /topic-governance:[\s\S]*?FOR\s+UPDATE/iu,
      /run\.status\s*=\s*'completed'/iu,
      /suggestion\.status\s*=\s*'pending'/iu,
      /confirmed_icp_profile_id[\s\S]*?topic_model_revisions/iu,
      /current_decision[\s\S]*?decision\.decision_origin\s*=\s*'user'/iu,
      /current_keyword_governance_suggestion_occurrence_ids[\s\S]*?analysis_invocations/iu,
      /authority_current\s+IS\s+NOT\s+TRUE[\s\S]*?LIMIT\s+100/iu,
      /UPDATE\s+app\.keyword_review_suggestions\s+suggestion[\s\S]*?WHERE\s+suggestion\.id\s*=\s*stale_pending\.id[\s\S]*?AND\s+suggestion\.status\s*=\s*'pending'/iu,
    ]) {
      expect(migration).toMatch(invariant);
    }
    const normalized = migration.replace(/\s+/gu, " ");
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(normalized).toContain(
        "REVOKE ALL ON FUNCTION " +
          "app.supersede_stale_pending_keyword_review_suggestions(uuid, uuid) " +
          `FROM ${role}`,
      );
    }
  });
});
