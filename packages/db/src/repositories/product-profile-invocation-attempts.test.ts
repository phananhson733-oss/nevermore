import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  ProductProfileInvocationAttemptsRepository,
  type ProductProfileInvocationAttemptRow,
  type ProductProfileInvocationMetadata,
} from "./product-profile-invocation-attempts.ts";

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
  model: "gpt-4.1-mini",
  promptSetVersion: "product-profile.0.3.0",
  inputHash: "a".repeat(64),
};

const reservation: ProductProfileInvocationAttemptRow = {
  id: "00000000-0000-4000-8000-000000000004",
  workspace_id: attempt.workspaceId,
  project_id: attempt.projectId,
  product_profile_run_id: attempt.runId,
  ordinal: 1,
  async_attempt_count: attempt.attemptCount,
  provider: preflight.provider,
  model: preflight.model,
  prompt_set_version: preflight.promptSetVersion,
  input_hash: preflight.inputHash,
  planned_analysis_invocation_id:
    "00000000-0000-4000-8000-000000000005",
  status: "reserved",
  analysis_invocation_id: null,
  terminal_error_code: null,
  reserved_at: "2026-07-22T08:00:00.000Z",
  provider_returned_at: null,
  finalized_at: null,
};

const failedInvocation: ProductProfileInvocationMetadata = {
  provider: preflight.provider,
  model: preflight.model,
  promptSetVersion: preflight.promptSetVersion,
  inputHash: preflight.inputHash,
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
  row: ProductProfileInvocationAttemptRow | null = null,
  invocationId: string | null = null,
): Record<string, unknown> {
  return {
    kind,
    ...(row === null ? {} : { reservation: row }),
    ...(invocationId === null ? {} : { invocationId }),
  };
}

describe("ProductProfileInvocationAttemptsRepository", () => {
  it.each([
    ["reserved", functionResult("reserved", reservation)],
    ["existing", functionResult("existing", reservation)],
    ["unresolved", functionResult("unresolved", reservation)],
    ["stale", functionResult("stale")],
    ["budget_exhausted", functionResult("budget_exhausted")],
    ["configuration_mismatch", functionResult("configuration_mismatch")],
  ] as const)("parses the %s reservation outcome", async (kind, dbResult) => {
    const fake = fakeExecutor(dbResult);
    const repository = new ProductProfileInvocationAttemptsRepository(
      fake.executor,
    );

    const result = await repository.reserve(attempt, preflight);

    expect(result.kind).toBe(kind);
    expect(fake.executions).toHaveLength(1);
  });

  it("passes only scope, RunAttempt, and preflight metadata so ordinal remains database-owned", async () => {
    const fake = fakeExecutor(functionResult("reserved", reservation));
    const repository = new ProductProfileInvocationAttemptsRepository(
      fake.executor,
    );

    await repository.reserve(attempt, preflight);

    const compiled = new PgDialect().sqlToQuery(
      fake.executions[0]!.query as never,
    );
    expect(compiled.sql).toContain(
      "app.reserve_product_profile_invocation_attempt",
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
  });

  it("rejects malformed preflight data before executing SQL", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileInvocationAttemptsRepository(
      fake.executor,
    );

    await expect(
      repository.reserve(attempt, {
        ...preflight,
        inputHash: "not-a-hash",
      }),
    ).resolves.toEqual({ kind: "configuration_mismatch" });
    await expect(
      repository.reserve({ ...attempt, attemptCount: 0 }, preflight),
    ).resolves.toEqual({ kind: "stale" });
    expect(fake.executions).toEqual([]);
  });

  it("idempotently finalizes the exact reservation and returns its canonical invocation id", async () => {
    const finalized = {
      ...reservation,
      status: "failed" as const,
      analysis_invocation_id: reservation.planned_analysis_invocation_id,
      terminal_error_code: "SERVER_ERROR",
      provider_returned_at: "2026-07-22T08:00:01.000Z",
      finalized_at: "2026-07-22T08:00:01.000Z",
    };
    const fake = fakeExecutor(
      functionResult(
        "finalized",
        finalized,
        reservation.planned_analysis_invocation_id,
      ),
    );
    const repository = new ProductProfileInvocationAttemptsRepository(
      fake.executor,
    );

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
      "app.finalize_product_profile_invocation_attempt",
    );
    expect(compiled.params).not.toContain("prompt text");
    expect(compiled.params).not.toContain("output text");
  });

  it("rejects incoherent or unpersistable invocation metadata before SQL", async () => {
    const fake = fakeExecutor();
    const repository = new ProductProfileInvocationAttemptsRepository(
      fake.executor,
    );

    await expect(
      repository.finalizeWithInvocation(attempt, reservation.id, {
        ...failedInvocation,
        costUsd: 1_000_000,
      }),
    ).resolves.toEqual({ kind: "conflict", reservation: null });
    await expect(
      repository.finalizeWithInvocation(attempt, reservation.id, {
        ...failedInvocation,
        status: "succeeded",
        outputHash: null,
        errorCode: null,
      }),
    ).resolves.toEqual({ kind: "conflict", reservation: null });
    expect(fake.executions).toEqual([]);
  });

  it("marks an ambiguous provider outcome once and never overwrites a finalized invocation", async () => {
    const unknown = {
      ...reservation,
      status: "outcome_unknown" as const,
      terminal_error_code: "INVOCATION_PERSISTENCE_UNKNOWN",
      provider_returned_at: "2026-07-22T08:00:01.000Z",
      finalized_at: "2026-07-22T08:00:01.000Z",
    };
    const finalized = {
      ...reservation,
      status: "failed" as const,
      analysis_invocation_id: reservation.planned_analysis_invocation_id,
      terminal_error_code: "SERVER_ERROR",
      provider_returned_at: "2026-07-22T08:00:01.000Z",
      finalized_at: "2026-07-22T08:00:01.000Z",
    };
    const fake = fakeExecutor(
      functionResult("marked", unknown),
      functionResult(
        "finalized",
        finalized,
        reservation.planned_analysis_invocation_id,
      ),
    );
    const repository = new ProductProfileInvocationAttemptsRepository(
      fake.executor,
    );

    await expect(
      repository.markOutcomeUnknown(
        attempt,
        reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toEqual({ kind: "marked", reservation: unknown });
    await expect(
      repository.markOutcomeUnknown(
        attempt,
        reservation.id,
        "INVOCATION_PERSISTENCE_UNKNOWN",
      ),
    ).resolves.toEqual({
      kind: "finalized",
      reservation: finalized,
      invocationId: reservation.planned_analysis_invocation_id,
    });
  });
});
