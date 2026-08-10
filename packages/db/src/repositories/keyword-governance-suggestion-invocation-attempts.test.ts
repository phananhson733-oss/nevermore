import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  KeywordGovernanceSuggestionInvocationAttemptsRepository,
  type KeywordGovernanceSuggestionInvocationAttemptRow,
} from "./keyword-governance-suggestion-invocation-attempts.ts";

function fakeExecutor(...results: readonly unknown[]) {
  const queue = [...results];
  const queries: unknown[] = [];
  return {
    executor: {
      execute(query: unknown) {
        queries.push(query);
        return Promise.resolve({ rows: [{ result: queue.shift() }] });
      },
    } as never,
    queries,
  };
}

const attempt = {
  workspaceId: "52000000-0000-4000-8000-000000000001",
  projectId: "52000000-0000-4000-8000-000000000002",
  runId: "52000000-0000-4000-8000-000000000003",
  attemptCount: 1,
};
const preflight = {
  provider: "openai",
  model: "gpt-5-mini",
  promptSetVersion: "keyword-governance-suggestion.prompt.v1",
  inputHash: "a".repeat(64),
};
const row: KeywordGovernanceSuggestionInvocationAttemptRow = {
  id: "52000000-0000-4000-8000-000000000004",
  workspace_id: attempt.workspaceId,
  project_id: attempt.projectId,
  generation_run_id: attempt.runId,
  ordinal: 1,
  async_attempt_count: 1,
  provider: "openai",
  model: "gpt-5-mini",
  prompt_set_version: "keyword-governance-suggestion.prompt.v1",
  input_hash: "a".repeat(64),
  planned_analysis_invocation_id:
    "52000000-0000-4000-8000-000000000005",
  status: "reserved",
  analysis_invocation_id: null,
  terminal_error_code: null,
  reserved_at: "2026-08-10T01:00:00.000Z",
  provider_returned_at: null,
  finalized_at: null,
};

describe("KeywordGovernanceSuggestionInvocationAttemptsRepository", () => {
  it.each([
    ["reserved", { kind: "reserved", reservation: row }],
    ["existing", { kind: "existing", reservation: row }],
    ["unresolved", { kind: "unresolved", reservation: row }],
    ["stale", { kind: "stale" }],
    ["budget_exhausted", { kind: "budget_exhausted" }],
    ["configuration_mismatch", { kind: "configuration_mismatch" }],
  ] as const)("parses the %s reservation result", async (kind, result) => {
    const fake = fakeExecutor(result);
    await expect(
      new KeywordGovernanceSuggestionInvocationAttemptsRepository(
        fake.executor,
      ).reserve(attempt, preflight),
    ).resolves.toMatchObject({ kind });
  });

  it("keeps identity allocation database-owned and never sends model content", async () => {
    const fake = fakeExecutor({ kind: "reserved", reservation: row });
    await new KeywordGovernanceSuggestionInvocationAttemptsRepository(
      fake.executor,
    ).reserve(attempt, preflight);
    const compiled = new PgDialect().sqlToQuery(fake.queries[0] as never);
    expect(compiled.sql).toContain(
      "app.reserve_keyword_governance_suggestion_invocation_attempt",
    );
    expect(compiled.params).toEqual([
      attempt.workspaceId,
      attempt.projectId,
      attempt.runId,
      1,
      "openai",
      "gpt-5-mini",
      "keyword-governance-suggestion.prompt.v1",
      "a".repeat(64),
    ]);
    expect(compiled.params).not.toContain("prompt text");
    expect(compiled.params).not.toContain("response text");
  });

  it("finalizes the planned append-only invocation exactly once", async () => {
    const finalized = {
      ...row,
      status: "succeeded" as const,
      analysis_invocation_id: row.planned_analysis_invocation_id,
      provider_returned_at: "2026-08-10T01:00:01.000Z",
      finalized_at: "2026-08-10T01:00:01.000Z",
    };
    const fake = fakeExecutor({
      kind: "finalized",
      reservation: finalized,
      invocationId: row.planned_analysis_invocation_id,
    });
    await expect(
      new KeywordGovernanceSuggestionInvocationAttemptsRepository(
        fake.executor,
      ).finalizeWithInvocation(attempt, row.id, {
        ...preflight,
        outputHash: "b".repeat(64),
        status: "succeeded",
        inputTokens: 10,
        outputTokens: 20,
        costUsd: 0.01,
        latencyMs: 100,
        errorCode: null,
      }),
    ).resolves.toEqual({
      kind: "finalized",
      reservation: finalized,
      invocationId: row.planned_analysis_invocation_id,
    });
    const compiled = new PgDialect().sqlToQuery(fake.queries[0] as never);
    expect(compiled.sql).toContain(
      "app.finalize_keyword_governance_suggestion_invocation_attempt",
    );
  });

  it("rejects malformed metadata before SQL and fences unknown outcomes", async () => {
    const unknown = {
      ...row,
      status: "outcome_unknown" as const,
      terminal_error_code: "INVOCATION_PERSISTENCE_UNKNOWN",
      provider_returned_at: "2026-08-10T01:00:01.000Z",
      finalized_at: "2026-08-10T01:00:01.000Z",
    };
    const fake = fakeExecutor({ kind: "marked", reservation: unknown });
    const repo = new KeywordGovernanceSuggestionInvocationAttemptsRepository(
      fake.executor,
    );
    await expect(repo.finalizeWithInvocation(attempt, row.id, {
      ...preflight,
      outputHash: "b".repeat(64),
      status: "succeeded",
      inputTokens: -1,
      outputTokens: 20,
      costUsd: 0.01,
      latencyMs: 100,
      errorCode: null,
    })).resolves.toEqual({ kind: "conflict", reservation: null });
    expect(fake.queries).toEqual([]);
    await expect(repo.markOutcomeUnknown(
      attempt,
      row.id,
      "INVOCATION_PERSISTENCE_UNKNOWN",
    )).resolves.toEqual({ kind: "marked", reservation: unknown });
    expect(fake.queries).toHaveLength(1);
  });
});
