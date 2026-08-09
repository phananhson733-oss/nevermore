import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  TopicModelGenerationInvocationAttemptsRepository,
  type TopicModelGenerationInvocationAttemptRow,
  type TopicModelGenerationInvocationMetadata,
} from "./topic-model-generation-invocation-attempts.ts";

interface RecordedExecution {
  readonly query: unknown;
}

function fakeExecutor(...results: readonly unknown[]): {
  readonly executor: never;
  readonly executions: RecordedExecution[];
} {
  const queue = [...results];
  const executions: RecordedExecution[] = [];
  return {
    executor: {
      execute(query: unknown) {
        executions.push({ query });
        return Promise.resolve({ rows: [{ result: queue.shift() }] });
      },
    } as never,
    executions,
  };
}

const attempt = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  runId: "00000000-0000-4000-8000-000000000003",
  attemptCount: 2,
};
const preflight = {
  provider: "openai",
  model: "gpt-5-mini",
  promptSetVersion: "topic-model.prompt.v1",
  inputHash: "a".repeat(64),
};
const reservation: TopicModelGenerationInvocationAttemptRow = {
  id: "00000000-0000-4000-8000-000000000004",
  workspace_id: attempt.workspaceId,
  project_id: attempt.projectId,
  topic_model_generation_run_id: attempt.runId,
  ordinal: 1,
  async_attempt_count: attempt.attemptCount,
  provider: preflight.provider,
  model: preflight.model,
  prompt_set_version: preflight.promptSetVersion,
  input_hash: preflight.inputHash,
  planned_analysis_invocation_id: "00000000-0000-8000-8000-000000000005",
  status: "reserved",
  analysis_invocation_id: null,
  terminal_error_code: null,
  reserved_at: "2026-08-09T08:00:00.000Z",
  provider_returned_at: null,
  finalized_at: null,
};
const failedInvocation: TopicModelGenerationInvocationMetadata = {
  ...preflight,
  outputHash: null,
  status: "failed",
  inputTokens: null,
  outputTokens: null,
  costUsd: null,
  latencyMs: 123,
  errorCode: "SERVER_ERROR",
};

function functionResult(
  kind: string,
  row: TopicModelGenerationInvocationAttemptRow | null = null,
  invocationId: string | null = null,
): Record<string, unknown> {
  return {
    kind,
    ...(row === null ? {} : { reservation: row }),
    ...(invocationId === null ? {} : { invocationId }),
  };
}

describe("TopicModelGenerationInvocationAttemptsRepository", () => {
  it.each([
    ["reserved", functionResult("reserved", reservation)],
    ["existing", functionResult("existing", reservation)],
    ["unresolved", functionResult("unresolved", reservation)],
    ["stale", functionResult("stale")],
    ["budget_exhausted", functionResult("budget_exhausted")],
    ["configuration_mismatch", functionResult("configuration_mismatch")],
  ] as const)("parses the %s reservation outcome", async (kind, dbResult) => {
    const fake = fakeExecutor(dbResult);
    const repository =
      new TopicModelGenerationInvocationAttemptsRepository(fake.executor);

    await expect(repository.reserve(attempt, preflight)).resolves.toMatchObject({
      kind,
    });
    expect(fake.executions).toHaveLength(1);
  });

  it("keeps ordinal database-owned and sends no prompt or response text", async () => {
    const fake = fakeExecutor(functionResult("reserved", reservation));
    const repository =
      new TopicModelGenerationInvocationAttemptsRepository(fake.executor);

    await repository.reserve(attempt, preflight);
    const compiled = new PgDialect().sqlToQuery(
      fake.executions[0]!.query as never,
    );
    expect(compiled.sql).toContain(
      "app.reserve_topic_model_generation_invocation_attempt",
    );
    expect(compiled.params).toEqual([
      attempt.workspaceId,
      attempt.projectId,
      attempt.runId,
      attempt.attemptCount,
      preflight.provider,
      preflight.model,
      preflight.promptSetVersion,
      preflight.inputHash,
    ]);
    expect(compiled.params).not.toContain("prompt text");
    expect(compiled.params).not.toContain("response text");
  });

  it("finalizes once and returns the planned immutable invocation", async () => {
    const finalized = {
      ...reservation,
      status: "failed" as const,
      analysis_invocation_id: reservation.planned_analysis_invocation_id,
      terminal_error_code: "SERVER_ERROR",
      provider_returned_at: "2026-08-09T08:00:01.000Z",
      finalized_at: "2026-08-09T08:00:01.000Z",
    };
    const fake = fakeExecutor(
      functionResult(
        "finalized",
        finalized,
        reservation.planned_analysis_invocation_id,
      ),
    );
    const repository =
      new TopicModelGenerationInvocationAttemptsRepository(fake.executor);

    await expect(
      repository.finalizeWithInvocation(
        attempt,
        reservation.id,
        failedInvocation,
      ),
    ).resolves.toEqual({
      kind: "finalized",
      reservation: finalized,
      invocationId: reservation.planned_analysis_invocation_id,
    });
    const compiled = new PgDialect().sqlToQuery(
      fake.executions[0]!.query as never,
    );
    expect(compiled.sql).toContain(
      "app.finalize_topic_model_generation_invocation_attempt",
    );
  });

  it("rejects malformed metadata before SQL and marks ambiguous outcomes", async () => {
    const unknown = {
      ...reservation,
      status: "outcome_unknown" as const,
      terminal_error_code: "INVOCATION_PERSISTENCE_UNKNOWN",
      provider_returned_at: "2026-08-09T08:00:01.000Z",
      finalized_at: "2026-08-09T08:00:01.000Z",
    };
    const fake = fakeExecutor(functionResult("marked", unknown));
    const repository =
      new TopicModelGenerationInvocationAttemptsRepository(fake.executor);

    await expect(
      repository.finalizeWithInvocation(attempt, reservation.id, {
        ...failedInvocation,
        costUsd: 1_000_000,
      }),
    ).resolves.toEqual({ kind: "conflict", reservation: null });
    expect(fake.executions).toEqual([]);

    await expect(
      repository.markOutcomeUnknown(
        attempt,
        reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toEqual({ kind: "marked", reservation: unknown });
    expect(fake.executions).toHaveLength(1);
  });
});
