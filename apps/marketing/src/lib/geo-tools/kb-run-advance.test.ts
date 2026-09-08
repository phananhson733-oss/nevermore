import { describe, expect, it, vi } from "vitest";
import {
  advanceGeoKbRun,
  GEO_RUN_PROBE_LIMIT,
  type GeoRunAdvanceDependencies,
  type GeoRunExecutor,
  type GeoRunProbeOutcome,
  type GeoRunStartOutcome,
} from "./kb-run-advance.ts";
import type {
  GeoRunLedgerStore,
  GeoRunOperationOutcome,
  GeoRunOperationRecord,
  GeoRunOperationSeed,
  GeoRunRecord,
  GeoRunScope,
} from "./kb-run-ledger.ts";

const USER = "6f3d1a04-77c5-8d31-9e60-0a1b2c3d4e5f";
const KB = "1f08f279-2b40-8c11-9a33-5d6e7f809a1b";
const RUN = "9c7b5e21-3a44-8f77-8d21-0b1c2d3e4f50";
const NOW = new Date("2026-09-07T12:00:00.000Z");

/**
 * An in-memory ledger with the same refusals the SQL one has.
 *
 * It exists so the money-safety rules can be exercised without a database, but
 * the refusals are copied on purpose: a fake that accepts a transition the real
 * table rejects would let a test prove the opposite of the truth.
 */
function fakeStore(initial: readonly GeoRunOperationSeed[]) {
  const run: GeoRunRecord = {
    schemaVersion: "marketing-geo-kb-run.v1",
    runId: RUN,
    userId: USER,
    kbId: KB,
    idempotencyKey: "run-key-000001",
    state: "running",
    generationInputHash: null,
    leaseExpiresAt: "2026-09-07T12:06:00.000Z",
    createdAt: "2026-09-07T11:59:00.000Z",
  };
  const rows = new Map<string, GeoRunOperationRecord>(
    initial.map((seed) => [
      seed.key,
      {
        key: seed.key,
        kind: seed.kind,
        state: "not_started",
        resultRef: null,
        startedAt: null,
        leaseExpiresAt: null,
        reason: null,
        probeCount: 0,
        finishedAt: null,
      },
    ]),
  );
  const calls: string[] = [];
  const list = () => [...rows.values()];
  const write = (key: string, patch: Partial<GeoRunOperationRecord>): GeoRunOperationRecord => {
    const next = { ...(rows.get(key) as GeoRunOperationRecord), ...patch };
    rows.set(key, next);
    return next;
  };
  const apply = (key: string, outcome: GeoRunOperationOutcome): GeoRunOperationRecord =>
    write(key, {
      state: outcome.state,
      resultRef: outcome.state === "succeeded" ? outcome.resultRef : null,
      reason:
        outcome.state === "succeeded" ? null : outcome.state === "outcome_unknown" ? "outcome_unknown" : outcome.reason,
      leaseExpiresAt: null,
      finishedAt: "2026-09-07T12:00:01.000Z",
    });
  let released = 0;
  let finished = false;
  const store: GeoRunLedgerStore = {
    claimRun: async () => ({ kind: "claimed", run, operations: list(), leaseToken: "lease-token" }),
    readRun: async () => ({ kind: "found", run, operations: list() }),
    appendOperations: async (_scope: GeoRunScope, extra) => {
      for (const seed of extra) {
        if (rows.has(seed.key)) continue;
        rows.set(seed.key, {
          key: seed.key,
          kind: seed.kind,
          state: "not_started",
          resultRef: null,
          startedAt: null,
          leaseExpiresAt: null,
          reason: null,
          probeCount: 0,
          finishedAt: null,
        });
      }
      return { kind: "found", run, operations: list() };
    },
    claimOperation: async (_scope, key) => {
      calls.push(`claim:${key}`);
      const row = rows.get(key);
      if (row === undefined) return { kind: "not_found" };
      if (row.state !== "not_started" && row.state !== "failed_retryable") {
        return { kind: "conflict", operation: row };
      }
      return { kind: "ok", operation: write(key, { state: "claimed", leaseExpiresAt: "2026-09-07T12:02:00.000Z", startedAt: null, finishedAt: null, reason: null, resultRef: null }) };
    },
    dispatchOperation: async (_scope, key) => {
      calls.push(`dispatch:${key}`);
      const row = rows.get(key) as GeoRunOperationRecord;
      if (row.state !== "claimed") return { kind: "conflict", operation: row };
      return { kind: "ok", operation: write(key, { state: "dispatched", leaseExpiresAt: null, startedAt: "2026-09-07T12:00:00.500Z" }) };
    },
    finishOperation: async (_scope, key, outcome) => {
      calls.push(`finish:${key}:${outcome.state}`);
      const row = rows.get(key) as GeoRunOperationRecord;
      // The table only accepts a finish from `dispatched`.
      if (row.state !== "dispatched") return { kind: "conflict", operation: row };
      return { kind: "ok", operation: apply(key, outcome) };
    },
    probeOperation: async (_scope, key, outcome) => {
      calls.push(`probe:${key}:${outcome.state}`);
      const row = rows.get(key) as GeoRunOperationRecord;
      const neverSent = row.state === "claimed";
      if (row.state !== "dispatched" && row.state !== "outcome_unknown" && !neverSent) {
        return { kind: "conflict", operation: row };
      }
      // The refusal that matters: a probe may not make a possibly-billed
      // operation retryable.
      if (outcome.state === "failed_retryable" && !neverSent) return { kind: "invalid" };
      const next = apply(key, outcome);
      rows.set(key, { ...next, probeCount: Math.min(row.probeCount + 1, 8) });
      return { kind: "ok", operation: rows.get(key) as GeoRunOperationRecord };
    },
    bindGenerationInput: async () => ({ kind: "ok", run }),
    releaseRun: async () => {
      released += 1;
      return { kind: "ok", run };
    },
    finishRun: async () => {
      const outstanding = list().filter((row) => row.state !== "succeeded" && row.state !== "failed_permanent");
      if (outstanding.length > 0) return { kind: "conflict", run };
      finished = true;
      return { kind: "ok", run: { ...run, state: "complete" } };
    },
  };
  return {
    store,
    rows,
    calls,
    state: (key: string) => rows.get(key)?.state,
    row: (key: string) => rows.get(key) as GeoRunOperationRecord,
    released: () => released,
    finished: () => finished,
    force: write,
  };
}

function executor(
  start: () => Promise<GeoRunStartOutcome>,
  probe: () => Promise<GeoRunProbeOutcome> = async () => ({ kind: "unresolved" }),
): GeoRunExecutor {
  return { start, probe };
}

const deps = (store: GeoRunLedgerStore, exec: GeoRunExecutor): GeoRunAdvanceDependencies => ({
  store,
  executor: exec,
  now: () => NOW,
});

const input = { userId: USER, kbId: KB, runId: RUN, idempotencyKey: null, seed: [] };

describe("advancing a run", () => {
  it("dispatches before it sends, and only once per invocation", async () => {
    const ledger = fakeStore([
      { key: "fetch:own:https://acme.test/", kind: "fetch" },
      { key: "model:knowledge", kind: "model" },
    ]);
    const result = await advanceGeoKbRun(
      input,
      deps(ledger.store, executor(async () => ({ kind: "succeeded", resultRef: "observation:1" }))),
    );
    // The dispatch mark is durable before the request goes out; that ordering
    // is the only reason a `claimed` row can be read as "nothing was sent".
    expect(ledger.calls.slice(0, 3)).toEqual([
      "claim:fetch:own:https://acme.test/",
      "dispatch:fetch:own:https://acme.test/",
      "finish:fetch:own:https://acme.test/:succeeded",
    ]);
    expect(ledger.state("model:knowledge")).toBe("not_started");
    expect(result.status).toBe("in_progress");
    expect(result.remaining).toBe(1);
  });

  it("records an unknown outcome, never a retry, when the executor throws after dispatch", async () => {
    // The request went out. Anything that says "safe to send again" here is a
    // second charge.
    const ledger = fakeStore([{ key: "model:knowledge", kind: "model" }]);
    await advanceGeoKbRun(
      input,
      deps(
        ledger.store,
        executor(async () => {
          throw new Error("socket closed");
        }),
      ),
    );
    expect(ledger.state("model:knowledge")).toBe("outcome_unknown");
    expect(ledger.calls).toContain("finish:model:knowledge:outcome_unknown");
    expect(ledger.calls.filter((call) => call.startsWith("dispatch:"))).toHaveLength(1);
  });

  it("probes an operation whose outcome was never seen instead of sending it again", async () => {
    const ledger = fakeStore([{ key: "model:knowledge", kind: "model" }]);
    ledger.force("model:knowledge", {
      state: "outcome_unknown",
      reason: "outcome_unknown",
      startedAt: "2026-09-07T11:58:00.000Z",
      finishedAt: "2026-09-07T11:58:30.000Z",
    });
    const start = vi.fn(async (): Promise<GeoRunStartOutcome> => ({ kind: "succeeded", resultRef: "x" }));
    await advanceGeoKbRun(
      input,
      deps(ledger.store, {
        start,
        probe: async () => ({ kind: "succeeded", resultRef: "generation:9" }),
      }),
    );
    expect(start).not.toHaveBeenCalled();
    expect(ledger.calls).not.toContain("dispatch:model:knowledge");
    expect(ledger.row("model:knowledge").resultRef).toBe("generation:9");
  });

  it("gives up on an unresolvable outcome rather than probing forever", async () => {
    const ledger = fakeStore([{ key: "serp:\"Acme\"", kind: "serp" }]);
    ledger.force('serp:"Acme"', {
      state: "outcome_unknown",
      reason: "outcome_unknown",
      startedAt: "2026-09-07T11:58:00.000Z",
      finishedAt: "2026-09-07T11:58:30.000Z",
      probeCount: GEO_RUN_PROBE_LIMIT - 1,
    });
    const result = await advanceGeoKbRun(
      input,
      deps(ledger.store, executor(async () => ({ kind: "succeeded", resultRef: "x" }))),
    );
    // Giving up spends nothing and leaves the charge on the record as
    // unresolved; the alternative is a run that never completes.
    expect(ledger.state('serp:"Acme"')).toBe("failed_permanent");
    expect(ledger.row('serp:"Acme"').reason).toBe("outcome_unknown");
    expect(result.status).toBe("complete");
    expect(result.skipped).toEqual(['serp:"Acme"']);
  });

  it("restarts an expired claim, because a claim proves nothing was sent", async () => {
    const ledger = fakeStore([{ key: "fetch:own:https://acme.test/", kind: "fetch" }]);
    ledger.force("fetch:own:https://acme.test/", {
      state: "claimed",
      leaseExpiresAt: "2026-09-07T11:50:00.000Z",
    });
    await advanceGeoKbRun(
      input,
      deps(ledger.store, {
        start: async () => ({ kind: "succeeded", resultRef: "observation:2" }),
        probe: async () => ({ kind: "not_dispatched" }),
      }),
    );
    expect(ledger.state("fetch:own:https://acme.test/")).toBe("failed_retryable");
    expect(ledger.row("fetch:own:https://acme.test/").reason).toBe("lease_expired");
  });

  it("refuses a not_dispatched verdict about an operation that was dispatched", async () => {
    // An executor that claims nothing was sent about a row the ledger says was
    // sent is not believed: the ledger's write ordering outranks its opinion.
    const ledger = fakeStore([{ key: "model:questions", kind: "model" }]);
    ledger.force("model:questions", {
      state: "dispatched",
      startedAt: "2026-09-07T11:58:00.000Z",
    });
    await advanceGeoKbRun(
      input,
      deps(ledger.store, {
        start: async () => ({ kind: "succeeded", resultRef: "x" }),
        probe: async () => ({ kind: "not_dispatched" }),
      }),
    );
    expect(ledger.state("model:questions")).toBe("outcome_unknown");
    expect(ledger.calls).not.toContain("probe:model:questions:failed_retryable");
  });

  it("hands the lease back even when the executor rejects", async () => {
    const ledger = fakeStore([{ key: "gsc:sc-domain:acme.test:90", kind: "gsc" }]);
    await advanceGeoKbRun(
      input,
      deps(
        ledger.store,
        executor(async () => {
          throw new Error("boom");
        }),
      ),
    );
    // Keeping it would make this run's own next invocation report `busy`.
    expect(ledger.released()).toBe(1);
  });

  it("closes the run when nothing is outstanding", async () => {
    const ledger = fakeStore([{ key: "fetch:own:https://acme.test/", kind: "fetch" }]);
    const result = await advanceGeoKbRun(
      input,
      deps(ledger.store, executor(async () => ({ kind: "succeeded", resultRef: "observation:3" }))),
    );
    expect(result.status).toBe("complete");
    expect(ledger.finished()).toBe(true);
  });

  it("reports busy without touching an operation when another executor holds the run", async () => {
    const ledger = fakeStore([{ key: "fetch:own:https://acme.test/", kind: "fetch" }]);
    const busy: GeoRunLedgerStore = {
      ...ledger.store,
      claimRun: async () => ({
        kind: "busy",
        run: {
          schemaVersion: "marketing-geo-kb-run.v1",
          runId: RUN,
          userId: USER,
          kbId: KB,
          idempotencyKey: "run-key-000001",
          state: "running",
          generationInputHash: null,
          leaseExpiresAt: "2026-09-07T12:05:00.000Z",
          createdAt: "2026-09-07T11:59:00.000Z",
        },
        operations: [],
      }),
    };
    const start = vi.fn(async (): Promise<GeoRunStartOutcome> => ({ kind: "succeeded", resultRef: "x" }));
    const result = await advanceGeoKbRun(input, deps(busy, { start, probe: async () => ({ kind: "unresolved" }) }));
    expect(result.status).toBe("busy");
    expect(start).not.toHaveBeenCalled();
    expect(ledger.calls).toHaveLength(0);
  });

  it("lets the running operation extend the plan", async () => {
    const ledger = fakeStore([{ key: "fetch:own:https://acme.test/", kind: "fetch" }]);
    const result = await advanceGeoKbRun(
      input,
      deps(ledger.store, {
        start: async (_operation, context) => {
          await context.appendOperations([{ key: "fetch:own:https://acme.test/pricing", kind: "fetch" }]);
          return { kind: "succeeded", resultRef: "observation:4" };
        },
        probe: async () => ({ kind: "unresolved" }),
      }),
    );
    expect(result.status).toBe("in_progress");
    expect(ledger.state("fetch:own:https://acme.test/pricing")).toBe("not_started");
  });

  it("does not start work the remaining budget cannot cover", async () => {
    const ledger = fakeStore([{ key: "model:knowledge", kind: "model" }]);
    const start = vi.fn(async (): Promise<GeoRunStartOutcome> => ({ kind: "succeeded", resultRef: "x" }));
    let call = 0;
    const result = await advanceGeoKbRun(
      { ...input, budgetMs: 100_000 },
      {
        store: ledger.store,
        executor: { start, probe: async () => ({ kind: "unresolved" }) },
        // First read is the invocation start; the plan is made 95 s later.
        now: () => new Date(NOW.getTime() + (call++ === 0 ? 0 : 95_000)),
      },
    );
    expect(start).not.toHaveBeenCalled();
    expect(result.status).toBe("in_progress");
    expect(result.remaining).toBe(1);
  });
});
