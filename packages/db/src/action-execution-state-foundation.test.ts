import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../migrations/0026_action_execution_state.sql",
    import.meta.url,
  ),
  "utf8",
);
const migrateCheck = readFileSync(
  new URL("./migrate-check.ts", import.meta.url),
  "utf8",
);

describe("0026 Action Execution State authority", () => {
  it("adds immutable versioned Step Definitions and execution events", () => {
    expect(sql).toMatch(
      /CREATE TABLE app\.action_execution_step_definitions/iu,
    );
    expect(sql).toMatch(
      /CREATE TABLE app\.action_execution_state_events/iu,
    );
    expect(
      sql.match(/EXECUTE FUNCTION app\.reject_append_only_mutation\(\)/gu),
    ).toHaveLength(2);
    expect(sql).toMatch(
      /UNIQUE NULLS NOT DISTINCT\s*\(\s*workspace_id,\s*project_id,\s*action_id,\s*artifact_id,\s*definition_key,\s*definition_version\s*\)/iu,
    );
    expect(sql).toMatch(
      /UNIQUE NULLS NOT DISTINCT\s*\(\s*workspace_id,\s*project_id,\s*action_id,\s*artifact_id,\s*revision\s*\)/iu,
    );
  });

  it("binds every optional Artifact to the exact project-scoped Action", () => {
    expect(sql).toMatch(
      /FOREIGN KEY\s*\(\s*workspace_id,\s*project_id,\s*action_id\s*\)[\s\S]*?REFERENCES app\.actions\s*\(\s*workspace_id,\s*project_id,\s*id\s*\)/iu,
    );
    expect(sql).toMatch(
      /FOREIGN KEY\s*\(\s*workspace_id,\s*project_id,\s*action_id,\s*artifact_id\s*\)[\s\S]*?REFERENCES app\.execution_artifacts\s*\(\s*workspace_id,\s*project_id,\s*action_id,\s*id\s*\)/iu,
    );
  });

  it("requires readable blocker and unlock facts only for blocked state", () => {
    expect(sql).toMatch(
      /state = 'blocked'[\s\S]*?blocker_code IS NOT NULL[\s\S]*?blocker_summary IS NOT NULL[\s\S]*?unlock_condition IS NOT NULL/iu,
    );
    expect(sql).toMatch(
      /state <> 'blocked'[\s\S]*?blocker_code IS NULL[\s\S]*?blocker_summary IS NULL[\s\S]*?unlock_condition IS NULL/iu,
    );
    expect(sql).toMatch(
      /length\(blocker_summary\) BETWEEN 1 AND 2000/iu,
    );
    expect(sql).toMatch(
      /length\(unlock_condition\) BETWEEN 1 AND 2000/iu,
    );
  });

  it("permits numeric progress only for an exact versioned definition", () => {
    expect(sql).toMatch(
      /state = 'in_progress'[\s\S]*?step_definition_id IS NOT NULL[\s\S]*?step_definition_version IS NOT NULL[\s\S]*?completed_steps IS NOT NULL[\s\S]*?total_steps IS NOT NULL/iu,
    );
    expect(sql).toMatch(
      /completed_steps BETWEEN 0 AND total_steps/iu,
    );
    expect(sql).toMatch(
      /step_definition\.definition_version IS DISTINCT FROM NEW\.step_definition_version/iu,
    );
    expect(sql).toMatch(
      /step_definition\.step_count IS DISTINCT FROM NEW\.total_steps/iu,
    );
  });

  it("serializes project writers and enforces CAS, exact replay, and terminal completion", () => {
    expect(sql).toMatch(
      /pg_advisory_xact_lock\s*\(\s*hashtextextended\([\s\S]*?'action-execution:'[\s\S]*?NEW\.workspace_id[\s\S]*?NEW\.project_id/iu,
    );
    expect(sql).toMatch(
      /NEW\.revision IS DISTINCT FROM expected_revision/iu,
    );
    expect(sql).toMatch(
      /latest\.state = 'completed'/iu,
    );
    expect(sql).toMatch(
      /UNIQUE\s*\(\s*workspace_id,\s*project_id,\s*idempotency_key\s*\)/iu,
    );
    expect(sql).toMatch(
      /request_hash text NOT NULL[\s\S]*?CHECK\s*\(\s*request_hash ~ '\^\[a-f0-9\]\{64\}\$'/iu,
    );
  });

  it("advances only the execution authority behind the existing four modules", () => {
    expect(sql).toMatch(
      /SELECT '0026_action_execution_state'::text AS migration_version/iu,
    );
    expect(sql).not.toMatch(/navigation|sidebar|fifth module|new module/iu);
  });

  it("keeps authority hashes in the migration catalog health check", () => {
    expect(migrateCheck).toMatch(
      /\[\s*"action_execution_step_definitions",\s*"definition_hash"\s*\]/u,
    );
    expect(migrateCheck).toMatch(
      /\[\s*"action_execution_step_definitions",\s*"request_hash"\s*\]/u,
    );
    expect(migrateCheck).toMatch(
      /\[\s*"action_execution_state_events",\s*"request_hash"\s*\]/u,
    );
  });
});
