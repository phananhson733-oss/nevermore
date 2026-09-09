import { describe, expect, it, vi } from "vitest";

import {
  createGeoKbRunRuntime,
  createGeoRunKnowledgeExecutor,
  createGeoRunKnowledgeSources,
  createGeoRunUpdateExecutor,
  GEO_RUN_UNSUPPORTED_EXECUTOR,
  geoRunAssembleOutcome,
  geoRunDispatchOutcome,
  geoRunKnowledgeIdempotencyKey,
  type GeoRunAssembleOutcome,
  type GeoRunKnowledgeDispatch,
  type GeoRunKnowledgeDraft,
  type GeoRunKnowledgeRead,
  type GeoRunKnowledgeSources,
} from "./kb-run-runtime.ts";
import type { GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import { GEO_RUN_KNOWLEDGE_MODEL_SEED, geoRunUpdateSeeds, planGeoRunCollection } from "./kb-run-collect.ts";
import type { GeoRunContext, GeoRunExecutor } from "./kb-run-advance.ts";
import type { GeoRunOperationRecord, GeoRunRecord } from "./kb-run-ledger.ts";

const USER = "6f3d1a04-77c5-4d31-9e60-0a1b2c3d4e5f";
const KB = "1f08f279-2b40-4c11-9a33-5d6e7f809a1b";
const RUN = "9c2b7e51-3a44-4d92-8f10-6b5c4d3e2a19";
const GENERATION = "3a5e91c7-6d28-4b03-9f47-2c1d8e0b5a64";

const executor: GeoRunExecutor = GEO_RUN_UNSUPPORTED_EXECUTOR;

describe("wiring the single-run route to the slice that owns the work", () => {
  it("hands the route the seed the producer derived", async () => {
    const runtime = createGeoKbRunRuntime({
      seedOperations: async () => ({ kind: "ready", seed: [{ key: "fetch:own:https://example.com/", kind: "fetch" }] }),
      executor,
    });
    await expect(runtime.plan({ userId: USER, kbId: KB })).resolves.toEqual({
      kind: "ready",
      seed: [{ key: "fetch:own:https://example.com/", kind: "fetch" }],
      executor,
    });
  });

  it("passes on 'there is nothing to update' instead of opening an empty run", async () => {
    // A run that opens, finds no operations and reports `complete` tells the
    // caller the knowledge base was updated. It was not.
    const runtime = createGeoKbRunRuntime({ seedOperations: async () => ({ kind: "missing" }), executor });
    await expect(runtime.plan({ userId: USER, kbId: KB })).resolves.toEqual({ kind: "missing" });
  });

  it("passes on a draft that cannot be run as it stands", async () => {
    const runtime = createGeoKbRunRuntime({ seedOperations: async () => ({ kind: "invalid_input" }), executor });
    await expect(runtime.plan({ userId: USER, kbId: KB })).resolves.toEqual({ kind: "invalid_input" });
  });

  it("reports an outage as an outage", async () => {
    const runtime = createGeoKbRunRuntime({ seedOperations: async () => ({ kind: "unavailable" }), executor });
    await expect(runtime.plan({ userId: USER, kbId: KB })).resolves.toEqual({ kind: "unavailable" });
  });

  it("does not let a thrown producer look like a run with nothing to do", async () => {
    const runtime = createGeoKbRunRuntime({
      seedOperations: async () => { throw new Error("store down"); },
      executor,
    });
    await expect(runtime.plan({ userId: USER, kbId: KB })).resolves.toEqual({ kind: "unavailable" });
  });

  it("never seeds an operation kind its executor cannot perform", async () => {
    // Written against a real plan, not an empty one. The previous version of
    // this test seeded `[]`, so `every(...)` was true for an empty array and it
    // would have stayed green through any seeding change at all.
    const seed = geoRunUpdateSeeds(
      planGeoRunCollection({ targetUrl: "https://example.com/", competitors: [{ domain: "rival.com", confirmed: true }] }),
    );
    expect(seed.length).toBeGreaterThan(1);
    const seedOperations = vi.fn(async () => ({ kind: "ready" as const, seed }));
    const plan = await createGeoKbRunRuntime({ seedOperations, executor }).plan({ userId: USER, kbId: KB });
    expect(plan.kind).toBe("ready");
    // Exactly the two kinds this deployment registers an executor for. `serp`
    // and `gsc` are deliberately excluded and must never be seeded.
    if (plan.kind === "ready") {
      expect([...new Set(plan.seed.map((entry) => entry.kind))].sort()).toEqual(["fetch", "model"]);
    }
  });
});

const RUN_RECORD: GeoRunRecord = {
  schemaVersion: "marketing-geo-kb-run.v1",
  runId: RUN,
  userId: USER,
  kbId: KB,
  idempotencyKey: "run-key-000001",
  state: "running",
  generationInputHash: null,
  leaseExpiresAt: "2026-09-08T12:06:00.000Z",
  createdAt: "2026-09-08T11:59:00.000Z",
};

function operation(overrides: Partial<GeoRunOperationRecord> = {}): GeoRunOperationRecord {
  return {
    key: GEO_RUN_KNOWLEDGE_MODEL_SEED.key,
    kind: "model",
    state: "not_started",
    resultRef: null,
    startedAt: null,
    leaseExpiresAt: null,
    reason: null,
    probeCount: 0,
    finishedAt: null,
    ...overrides,
  };
}

const READY_DRAFT: GeoRunKnowledgeDraft = {
  kind: "ok",
  draftVersion: 4,
  draftHash: "a".repeat(64),
  generationInputHash: "b".repeat(64),
};

interface Harness {
  readonly sources: GeoRunKnowledgeSources;
  readonly executor: GeoRunExecutor;
  readonly context: GeoRunContext;
  readonly dispatch: ReturnType<typeof vi.fn>;
  readonly assemble: ReturnType<typeof vi.fn>;
  readonly bind: ReturnType<typeof vi.fn>;
  readonly calls: string[];
}

interface HarnessOptions {
  readonly draft?: GeoRunKnowledgeDraft;
  /** Successive answers from `readDraft`, for a write that moves the draft. */
  readonly drafts?: readonly GeoRunKnowledgeDraft[];
  readonly reads?: readonly GeoRunKnowledgeRead[];
  readonly dispatch?: () => Promise<GeoRunKnowledgeDispatch>;
  readonly assembles?: readonly GeoRunAssembleOutcome[];
  readonly bind?: () => Promise<"bound" | "conflict" | "unavailable">;
}

function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const reads = [...(options.reads ?? [{ kind: "none" as const }])];
  const assembles = [...(options.assembles ?? [{ kind: "assembled" as const, knowledgeGenerationId: GENERATION }])];
  const drafts = [...(options.drafts ?? [])];
  const dispatch = vi.fn(async () => {
    calls.push("dispatch");
    return await (options.dispatch ?? (async () => ({
      kind: "record" as const, generationId: GENERATION, state: "succeeded" as const, errorReason: null,
    })))();
  });
  const assemble = vi.fn(async () => {
    calls.push("assemble");
    return assembles.length > 1 ? assembles.shift()! : assembles[0]!;
  });
  const bind = vi.fn(async () => {
    calls.push("bind");
    return await (options.bind ?? (async () => "bound" as const))();
  });
  const sources: GeoRunKnowledgeSources = {
    readDraft: async () => {
      calls.push("readDraft");
      if (drafts.length === 0) return options.draft ?? READY_DRAFT;
      return drafts.length > 1 ? drafts.shift()! : drafts[0]!;
    },
    readGeneration: async () => { calls.push("readGeneration"); return reads.length > 1 ? reads.shift()! : reads[0]!; },
    dispatchGeneration: dispatch as unknown as GeoRunKnowledgeSources["dispatchGeneration"],
    assemble: assemble as unknown as GeoRunKnowledgeSources["assemble"],
  };
  return {
    sources,
    executor: createGeoRunKnowledgeExecutor(sources),
    context: {
      userId: USER, kbId: KB, runId: RUN, run: RUN_RECORD,
      appendOperations: async () => true,
      bindGenerationInput: bind as unknown as GeoRunContext["bindGenerationInput"],
    },
    dispatch, assemble, bind, calls,
  };
}

/**
 * The knowledge step, which is where a run's money is.
 *
 * Every case below either counts the dispatch or names the state that made it
 * unnecessary. A test here that asserts an outcome without counting the calls
 * would pass just as happily against an executor that paid twice.
 */
describe("buying and filing one run's knowledge", () => {
  it("buys once and files it into the draft", async () => {
    const h = harness({ assembles: [{ kind: "observed" }, { kind: "assembled", knowledgeGenerationId: GENERATION }] });
    await expect(h.executor.start(operation(), h.context)).resolves.toEqual({
      kind: "succeeded",
      resultRef: GENERATION,
    });
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    // The run says what its paid generation is pinned to BEFORE it buys one.
    expect(h.calls.indexOf("bind")).toBeLessThan(h.calls.indexOf("dispatch"));
    expect(h.calls.indexOf("readGeneration")).toBeLessThan(h.calls.indexOf("dispatch"));
    expect(h.bind).toHaveBeenCalledWith(READY_DRAFT.generationInputHash);
    expect(h.dispatch).toHaveBeenCalledWith({
      userId: USER, kbId: KB,
      idempotencyKey: geoRunKnowledgeIdempotencyKey(RUN),
      baseVersion: READY_DRAFT.draftVersion,
      draftHash: READY_DRAFT.draftHash,
    });
  });

  it("writes the deterministic half before it dispatches, and the narrative after", async () => {
    /**
     * Section 4.2: the modules that need no model are on the draft the moment
     * collection finishes. Reaching the knowledge step IS that moment -- every
     * fetch is seeded ahead of `model:knowledge` and `planGeoRun` hands out the
     * first actionable operation -- so the observed body is written before a
     * request goes out, not after one comes back. Counting and ordering the
     * calls is the whole test: an executor that assembled only after the model
     * answered would satisfy every outcome assertion in this file.
     */
    const h = harness({ assembles: [{ kind: "observed" }, { kind: "assembled", knowledgeGenerationId: GENERATION }] });
    await h.executor.start(operation(), h.context);
    expect(h.assemble).toHaveBeenCalledTimes(2);
    expect(h.calls.indexOf("assemble")).toBeLessThan(h.calls.indexOf("dispatch"));
    expect(h.calls.lastIndexOf("assemble")).toBeGreaterThan(h.calls.indexOf("dispatch"));
    // And it costs nothing: the run still bought exactly one generation.
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not let the deterministic write decide the model step", async () => {
    // A knowledge base with no observation fresh enough to rebuild from still
    // has a narrative worth buying. Failing the operation over a free step
    // would take that away for nothing.
    for (const first of [
      { kind: "refused" as const, reason: "not_found" as const },
      { kind: "retry" as const, reason: "store_unavailable" as const },
    ]) {
      const h = harness({ assembles: [first, { kind: "assembled", knowledgeGenerationId: GENERATION }] });
      await expect(h.executor.start(operation(), h.context))
        .resolves.toEqual({ kind: "succeeded", resultRef: GENERATION });
      expect(h.dispatch).toHaveBeenCalledTimes(1);
    }
  });

  it("re-reads the draft the deterministic write may have moved before binding a charge to it", async () => {
    // Assembling writes a new draft version, and a dispatch pins the paid
    // record to the version it names. Buying against the version read before
    // that write would bind the record to a draft that no longer exists.
    const h = harness({
      drafts: [
        READY_DRAFT,
        { kind: "ok", draftVersion: 5, draftHash: "c".repeat(64), generationInputHash: READY_DRAFT.generationInputHash },
      ],
      assembles: [{ kind: "observed" }, { kind: "assembled", knowledgeGenerationId: GENERATION }],
    });
    await expect(h.executor.start(operation(), h.context))
      .resolves.toEqual({ kind: "succeeded", resultRef: GENERATION });
    expect(h.dispatch).toHaveBeenCalledWith({
      userId: USER, kbId: KB,
      idempotencyKey: geoRunKnowledgeIdempotencyKey(RUN),
      baseVersion: 5,
      draftHash: "c".repeat(64),
    });
  });

  it("buys nothing when the locked input moved under the deterministic write", async () => {
    const h = harness({
      drafts: [
        READY_DRAFT,
        { kind: "ok", draftVersion: 5, draftHash: "c".repeat(64), generationInputHash: "d".repeat(64) },
      ],
      assembles: [{ kind: "observed" }, { kind: "assembled", knowledgeGenerationId: GENERATION }],
    });
    await expect(h.executor.start(operation(), h.context))
      .resolves.toEqual({ kind: "failed_retryable", reason: "store_unavailable" });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("re-reads instead of re-buying when this run already bought one", async () => {
    // The resume story. `handleGeoKbGeneration` would also short-circuit on the
    // key, but a caller that relies on that has already sent the request.
    const h = harness({
      reads: [{ kind: "record", generationId: GENERATION, state: "succeeded", errorReason: null }],
    });
    await expect(h.executor.start(operation({ state: "failed_retryable", reason: "store_unavailable" }), h.context))
      .resolves.toEqual({ kind: "succeeded", resultRef: GENERATION });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.assemble).toHaveBeenCalledTimes(1);
  });

  it("refuses to file a paid model step against a body no model produced", async () => {
    /**
     * The model record says succeeded, and the assembly answers with the
     * deterministic body instead -- the newest generation the route can see is
     * not this one. There is no generation id to point at, so the operation
     * cannot be recorded as succeeded: `resultRef` would name nothing, and the
     * run's own ledger would carry a finished model step whose result does not
     * exist. Retry instead, and let the next attempt find the record again.
     */
    const h = harness({
      reads: [{ kind: "record", generationId: GENERATION, state: "succeeded", errorReason: null }],
      assembles: [{ kind: "observed" }],
    });

    await expect(h.executor.start(operation(), h.context))
      .resolves.toEqual({ kind: "failed_retryable", reason: "store_unavailable" });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("is not succeeded until the assembly lands, and retrying it buys nothing", async () => {
    // A paid narrative that never reached `payload.knowledge` leaves publish
    // refusing exactly as it did before, and nothing else in the run goes back
    // for it -- so "the model answered" is not the operation's success test.
    const h = harness({
      reads: [
        { kind: "none" },
        { kind: "record", generationId: GENERATION, state: "succeeded", errorReason: null },
      ],
      // The deterministic write, then the narrative filing that fails, then the
      // retry's filing. Only the last two are this operation's verdict.
      assembles: [
        { kind: "observed" },
        { kind: "retry", reason: "store_unavailable" },
        { kind: "assembled", knowledgeGenerationId: GENERATION },
      ],
    });
    await expect(h.executor.start(operation(), h.context))
      .resolves.toEqual({ kind: "failed_retryable", reason: "store_unavailable" });
    expect(h.dispatch).toHaveBeenCalledTimes(1);

    await expect(h.executor.start(operation({ state: "failed_retryable", reason: "store_unavailable" }), h.context))
      .resolves.toEqual({ kind: "succeeded", resultRef: GENERATION });
    // The whole reason the first outcome may be retryable: the retry re-read a
    // record it had already paid for instead of buying a second one.
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.assemble).toHaveBeenCalledTimes(3);
  });

  it("points the ledger at the record the assembly actually filed", async () => {
    // The assemble route resolves the NEWEST knowledge pack rather than taking
    // an id, so the operation's `resultRef` is its answer -- not the id of the
    // record this executor happened to settle.
    const filed = "7d1c4b90-2e63-4a15-8c07-9f3b5a2d6e48";
    const h = harness({ assembles: [{ kind: "assembled", knowledgeGenerationId: filed }] });
    await expect(h.executor.start(operation(), h.context))
      .resolves.toEqual({ kind: "succeeded", resultRef: filed });
    expect(filed).not.toBe(GENERATION);
  });

  it("reports an assembly that will never succeed as permanent", async () => {
    const h = harness({ assembles: [{ kind: "refused", reason: "not_found" }] });
    await expect(h.executor.start(operation(), h.context))
      .resolves.toEqual({ kind: "failed_permanent", reason: "not_found" });
  });

  it("calls a dispatch it cannot see the end of unknown, never retryable", async () => {
    const h = harness({
      dispatch: async () => { throw new Error("socket closed"); },
      assembles: [{ kind: "observed" }],
    });
    await expect(h.executor.start(operation(), h.context)).resolves.toEqual({ kind: "outcome_unknown" });
    // The only assembly here is the free deterministic one, written before the
    // request went out. Nothing filed a result for a charge we cannot see.
    expect(h.assemble).toHaveBeenCalledTimes(1);
    expect(h.calls.lastIndexOf("assemble")).toBeLessThan(h.calls.indexOf("dispatch"));
  });

  it("passes an unresolved provider answer through as unknown", async () => {
    const h = harness({ dispatch: async () => ({ kind: "outcome_unknown" }) });
    await expect(h.executor.start(operation(), h.context)).resolves.toEqual({ kind: "outcome_unknown" });
  });

  it("never re-dispatches a generation the store recorded as uncertain", async () => {
    // `uncertain` is a charge we cannot see. It is settled -- the answer is
    // "we will never know" -- so it terminates, and it never buys again.
    const h = harness({
      reads: [{ kind: "record", generationId: GENERATION, state: "uncertain", errorReason: "outcome_unknown" }],
    });
    await expect(h.executor.start(operation(), h.context))
      .resolves.toEqual({ kind: "failed_permanent", reason: "outcome_unknown" });
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.assemble).not.toHaveBeenCalled();
  });

  it("carries a stored failure's own reason instead of flattening it", async () => {
    for (const [stored, expected] of [
      ["rate_limited", "rate_limited"],
      ["quota_unavailable", "quota_unavailable"],
      ["provider_rejected", "provider_rejected"],
      ["model_unavailable", "model_unavailable"],
      ["invalid_output", "invalid_output"],
      // No member of the ledger's reason vocabulary names a stale input; the
      // draft the record was bought against is not the draft that exists.
      ["input_stale", "not_found"],
    ] as const) {
      const h = harness({ reads: [{ kind: "record", generationId: GENERATION, state: "failed", errorReason: stored }] });
      await expect(h.executor.start(operation(), h.context))
        .resolves.toEqual({ kind: "failed_permanent", reason: expected });
      expect(h.dispatch).not.toHaveBeenCalled();
    }
  });

  it("waits on a record another invocation is still holding", async () => {
    for (const state of ["claimed", "dispatched"] as const) {
      const h = harness({ reads: [{ kind: "record", generationId: GENERATION, state, errorReason: null }] });
      await expect(h.executor.start(operation(), h.context)).resolves.toEqual({ kind: "outcome_unknown" });
      expect(h.dispatch).not.toHaveBeenCalled();
    }
  });

  it("does not buy anything it could not first pin to the run's locked input", async () => {
    const conflicted = harness({ bind: async () => "conflict" });
    await expect(conflicted.executor.start(operation(), conflicted.context))
      .resolves.toEqual({ kind: "failed_permanent", reason: "not_found" });
    expect(conflicted.dispatch).not.toHaveBeenCalled();

    const down = harness({ bind: async () => "unavailable" });
    await expect(down.executor.start(operation(), down.context))
      .resolves.toEqual({ kind: "failed_retryable", reason: "store_unavailable" });
    expect(down.dispatch).not.toHaveBeenCalled();
  });

  it("refuses a draft version that cannot carry a v3 knowledge body", async () => {
    const h = harness({ draft: { kind: "unsupported" } });
    await expect(h.executor.start(operation(), h.context))
      .resolves.toEqual({ kind: "failed_permanent", reason: "unsupported" });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("refuses a model step nothing in this deployment produces", async () => {
    // `roles` and `questions` have no v3 input builder and no v3 result
    // contract. Answering one would be inventing a result for a step that was
    // never run.
    for (const key of ["model:roles", "model:questions"]) {
      const h = harness();
      await expect(h.executor.start(operation({ key }), h.context))
        .resolves.toEqual({ kind: "failed_permanent", reason: "unsupported" });
      expect(h.calls).toEqual([]);
      await expect(h.executor.probe(operation({ key, state: "dispatched" }), h.context))
        .resolves.toEqual({ kind: "unresolved" });
      expect(h.dispatch).not.toHaveBeenCalled();
    }
  });
});

describe("finding out what happened to a knowledge step", () => {
  it("settles a failure the store already wrote down, even with the draft gone", async () => {
    // The draft is read only when there turns out to be something to file.
    // Reading it first would answer "we could not find out" about an outcome
    // that was written down -- and three of those become a permanent
    // `outcome_unknown`, which claims a charge nobody can see.
    const h = harness({
      draft: { kind: "unavailable" },
      reads: [{ kind: "record", generationId: GENERATION, state: "failed", errorReason: "rate_limited" }],
    });
    await expect(h.executor.probe(operation({ state: "dispatched", startedAt: "2026-09-08T12:00:00.000Z" }), h.context))
      .resolves.toEqual({ kind: "failed_permanent", reason: "rate_limited" });
    expect(h.calls).toEqual(["readGeneration"]);
  });

  it("sends nothing, whatever the record says", async () => {
    for (const read of [
      { kind: "none" as const },
      { kind: "unavailable" as const },
      { kind: "record" as const, generationId: GENERATION, state: "dispatched" as const, errorReason: null },
      { kind: "record" as const, generationId: GENERATION, state: "succeeded" as const, errorReason: null },
      { kind: "record" as const, generationId: GENERATION, state: "failed" as const, errorReason: "rate_limited" as const },
    ]) {
      const h = harness({ reads: [read] });
      await h.executor.probe(operation({ state: "dispatched", startedAt: "2026-09-08T12:00:00.000Z" }), h.context);
      expect(h.dispatch).not.toHaveBeenCalled();
    }
  });

  it("resolves a succeeded record by filing it, and names the record it filed", async () => {
    const h = harness({
      reads: [{ kind: "record", generationId: GENERATION, state: "succeeded", errorReason: null }],
    });
    await expect(h.executor.probe(operation({ state: "dispatched", startedAt: "2026-09-08T12:00:00.000Z" }), h.context))
      .resolves.toEqual({ kind: "succeeded", resultRef: GENERATION });
    expect(h.assemble).toHaveBeenCalledTimes(1);
  });

  it("leaves a transient assembly failure unresolved rather than settling it", async () => {
    const h = harness({
      reads: [{ kind: "record", generationId: GENERATION, state: "succeeded", errorReason: null }],
      assembles: [{ kind: "retry", reason: "store_unavailable" }],
    });
    await expect(h.executor.probe(operation({ state: "dispatched", startedAt: "2026-09-08T12:00:00.000Z" }), h.context))
      .resolves.toEqual({ kind: "unresolved" });
  });

  it("says nothing was dispatched only from a row that provably sent nothing", async () => {
    // The dispatch mark is written before the request leaves, so `claimed` is
    // the one state in which "nothing was sent" is a fact rather than a hope --
    // and it is answered without reading anything else at all.
    const h = harness();
    await expect(h.executor.probe(
      operation({ state: "claimed", leaseExpiresAt: "2026-09-08T11:00:00.000Z" }),
      h.context,
    )).resolves.toEqual({ kind: "not_dispatched" });
    expect(h.calls).toEqual([]);

    const sent = harness({ reads: [{ kind: "none" }] });
    await expect(sent.executor.probe(
      operation({ state: "outcome_unknown", startedAt: "2026-09-08T12:00:00.000Z", reason: "outcome_unknown", finishedAt: "2026-09-08T12:01:00.000Z" }),
      sent.context,
    )).resolves.toEqual({ kind: "unresolved" });
  });
});

describe("routing one operation to the half that performs it", () => {
  const half = (name: string): GeoRunExecutor => ({
    start: async () => ({ kind: "failed_permanent", reason: name === "fetch" ? "fetch_failed" : "invalid_output" }),
    probe: async () => ({ kind: "failed_permanent", reason: name === "fetch" ? "fetch_failed" : "invalid_output" }),
  });

  it("sends each registered kind to its own executor and refuses the rest", async () => {
    const composite = createGeoRunUpdateExecutor({ fetch: half("fetch"), model: half("model") });
    const context = harness().context;
    const started = async (kind: GeoRunOperationRecord["kind"]) =>
      await composite.start(operation({ kind, key: `${kind}:x` }), context);
    expect(await started("fetch")).toEqual({ kind: "failed_permanent", reason: "fetch_failed" });
    expect(await started("model")).toEqual({ kind: "failed_permanent", reason: "invalid_output" });
    // SERP and Search Console are deliberately excluded. Reaching either half
    // would be this deployment pretending it can perform them.
    for (const kind of ["serp", "gsc"] as const) {
      expect(await started(kind)).toEqual({ kind: "failed_permanent", reason: "unsupported" });
      expect(await composite.probe(operation({ kind, key: `${kind}:x`, state: "dispatched" }), context))
        .toEqual({ kind: "unresolved" });
    }
  });
});

describe("the key one run buys its knowledge under", () => {
  it("is the run's own, and is a legal idempotency key", async () => {
    const key = geoRunKnowledgeIdempotencyKey(RUN);
    // The generation route's schema, verbatim.
    expect(key).toMatch(/^[a-zA-Z0-9_-]{8,128}$/u);
    expect(key).toBe(geoRunKnowledgeIdempotencyKey(RUN));
    // A different run is a different key, which is what makes a second update
    // a second, deliberate charge instead of a silent reuse of the first.
    expect(key).not.toBe(geoRunKnowledgeIdempotencyKey(GENERATION));
    // Derived from the run and nothing else: the draft version moves when the
    // assembly writes, and a key that moved with it would authorise a second
    // charge for work already paid for.
    const first = harness();
    await first.executor.start(operation(), first.context);
    const later = harness({ draft: { ...READY_DRAFT, draftVersion: 9, draftHash: "c".repeat(64) } });
    await later.executor.start(operation(), later.context);
    expect(later.dispatch.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: key });
    expect(first.dispatch.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey: key });
  });
});

/**
 * The two tables where a run livelocks or lies.
 *
 * Every status below is one the handler being called actually returns -- read
 * off `handleGeoKbGeneration` and `handleGeoKbV3Assemble` -- and every expected
 * value is written down rather than derived from the function under test.
 *
 * The distinction each row is defending: `permanent` decides whether the
 * caller's poll loop ever ends, and `outcome_unknown` is a claim that money may
 * have moved. Filing a refusal as either of the other two is a lie in one
 * direction or an infinite loop in the other.
 */
describe("reading the generation route's answer", () => {
  const answer = (state: string, errorReason: string | null = null) =>
    ({ data: { generation: { generationId: GENERATION, kbId: KB, kind: "knowledge_pack", inputHash: "f".repeat(64), state, result: null, errorReason, attempt: null } } });

  it("maps every status the route can return", () => {
    expect(geoRunDispatchOutcome(200, answer("succeeded")))
      .toEqual({ kind: "record", generationId: GENERATION, state: "succeeded", errorReason: null });
    expect(geoRunDispatchOutcome(200, answer("failed", "rate_limited")))
      .toEqual({ kind: "record", generationId: GENERATION, state: "failed", errorReason: "rate_limited" });
    // Nothing reached a provider on any of these.
    expect(geoRunDispatchOutcome(409, { error: { code: "conflict" } }))
      .toEqual({ kind: "refused", permanent: false, reason: "store_unavailable" });
    expect(geoRunDispatchOutcome(409, { error: { code: "input_stale" } }))
      .toEqual({ kind: "refused", permanent: false, reason: "store_unavailable" });
    expect(geoRunDispatchOutcome(404, { error: { code: "not_found" } }))
      .toEqual({ kind: "refused", permanent: true, reason: "not_found" });
    expect(geoRunDispatchOutcome(422, { error: { code: "unsupported_draft" } }))
      .toEqual({ kind: "refused", permanent: true, reason: "unsupported" });
    expect(geoRunDispatchOutcome(400, { error: { code: "invalid_request" } }))
      .toEqual({ kind: "refused", permanent: true, reason: "invalid_output" });
    expect(geoRunDispatchOutcome(503, { error: { code: "store_unavailable" } }))
      .toEqual({ kind: "refused", permanent: false, reason: "store_unavailable" });
    expect(geoRunDispatchOutcome(503, { error: { code: "model_unavailable" } }))
      .toEqual({ kind: "refused", permanent: false, reason: "model_unavailable" });
  });

  /**
   * The one 422 that means "not attempted", against the ones that do not.
   *
   * The card renders an `unsupported` operation as "not attempted, and nothing
   * was spent on them". For a knowledge pack the first half of that is false of
   * every 422 but `unsupported_draft`: `prepareGeoKbV3Generation` runs the
   * evidence collection -- the owner's home page, its machine files and each
   * confirmed competitor's page -- and only then can answer `input_too_large`,
   * `invalid_input` or a second `unsupported_language`.
   *
   * Every expectation is written out rather than derived from the function, and
   * every row but the first fails against the code this replaced, which
   * answered `unsupported` to all four.
   */
  it("stops calling a refusal that follows the site crawl 'not attempted'", () => {
    // Answered at the kind check, before anything is fetched. Kept, and true --
    // though nothing reaches it through this caller today: the run dispatches
    // `knowledge_pack`, which is the one kind that check admits.
    expect(geoRunDispatchOutcome(422, { error: { code: "unsupported_draft" } }))
      .toEqual({ kind: "refused", permanent: true, reason: "unsupported" });
    // The v3 knowledge path reaches this nowhere but after the collection: the
    // prompt that evidence would have bought is over the byte ceiling.
    expect(geoRunDispatchOutcome(422, { error: { code: "input_too_large" } }))
      .toEqual({ kind: "refused", permanent: true, reason: "invalid_output" });
    // Reachable on both sides of the collection, and nothing here separates
    // them. "Nothing was spent" is a claim, so the unprovable one is not made.
    expect(geoRunDispatchOutcome(422, { error: { code: "invalid_input" } }))
      .toEqual({ kind: "refused", permanent: true, reason: "invalid_output" });
    expect(geoRunDispatchOutcome(422, { error: { code: "unsupported_language" } }))
      .toEqual({ kind: "refused", permanent: true, reason: "invalid_output" });
  });

  it("does not read an unnameable 422 as proof that nothing was attempted", () => {
    // A body this file cannot read is the case where it knows least, and the
    // safe direction is the one that claims nothing about the owner's crawl
    // allowance. `errorCode` answers "" for all of these.
    for (const body of [null, {}, { error: null }, { error: {} }, { error: { code: 7 } },
      { error: { code: "unsupported_drafts" } }, { error: { code: "" } }]) {
      expect(geoRunDispatchOutcome(422, body as Record<string, unknown> | null))
        .toEqual({ kind: "refused", permanent: true, reason: "invalid_output" });
    }
  });

  it("never claims nothing was sent about an answer it does not recognise", () => {
    // The safe direction is the expensive one: a status this file has no case
    // for may follow a request that was already billed.
    for (const status of [500, 502, 418]) {
      expect(geoRunDispatchOutcome(status, null)).toEqual({ kind: "outcome_unknown" });
    }
    // A 200 whose body is not a generation is the same problem wearing a
    // success code, and it must not be read as "nothing happened".
    for (const body of [null, {}, { data: {} }, { data: { generation: { generationId: GENERATION } } },
      { data: { generation: { generationId: GENERATION, state: "reconciling", errorReason: null } } }]) {
      expect(geoRunDispatchOutcome(200, body)).toEqual({ kind: "outcome_unknown" });
    }
  });

  it("refuses permanently only where waiting cannot help", () => {
    // Written as the complement of the loop-forever risk: every status filed as
    // retryable must be one a later invocation could genuinely answer.
    const permanent = [404, 422, 400];
    const retryable = [409, 503];
    for (const status of permanent) {
      const outcome = geoRunDispatchOutcome(status, { error: { code: "x" } });
      expect(outcome.kind === "refused" && outcome.permanent).toBe(true);
    }
    for (const status of retryable) {
      const outcome = geoRunDispatchOutcome(status, { error: { code: "x" } });
      expect(outcome.kind === "refused" && outcome.permanent).toBe(false);
    }
  });
});

describe("reading the assemble route's answer", () => {
  it("takes the record the route says it filed, and refuses to invent one", () => {
    expect(geoRunAssembleOutcome(200, { data: { knowledgeGenerationId: GENERATION, changed: true } }))
      .toEqual({ kind: "assembled", knowledgeGenerationId: GENERATION });
    // `resultRef` is not optional for a succeeded operation, and a placeholder
    // there would point the ledger at a record that does not exist.
    for (const body of [null, {}, { data: {} }, { data: { knowledgeGenerationId: "" } }, { data: { knowledgeGenerationId: 7 } }]) {
      expect(geoRunAssembleOutcome(200, body)).toEqual({ kind: "retry", reason: "store_unavailable" });
    }
  });

  it("reads a body assembled from the collection alone as an answer, not a malformed one", () => {
    expect(geoRunAssembleOutcome(200, { data: { basis: "observed", knowledgeGenerationId: null, changed: true } }))
      .toEqual({ kind: "observed" });
    // Both halves of that shape are required. A 200 that omits the id without
    // saying which half it came from, or claims the observed half while naming
    // a record, is a route this reader does not recognise -- and inventing an
    // outcome for it is how a ledger ends up pointing at nothing.
    for (const data of [
      { basis: "observed" },
      { knowledgeGenerationId: null },
      { basis: "generation", knowledgeGenerationId: null },
      { basis: "observed", knowledgeGenerationId: undefined },
    ]) {
      expect(geoRunAssembleOutcome(200, { data })).toEqual({ kind: "retry", reason: "store_unavailable" });
    }
  });

  it("separates the 409s that settle by waiting from the ones that never do", () => {
    expect(geoRunAssembleOutcome(409, { error: { code: "conflict" }, draftVersion: 3 }))
      .toEqual({ kind: "retry", reason: "store_unavailable" });
    expect(geoRunAssembleOutcome(409, { error: { code: "generation_running" } }))
      .toEqual({ kind: "retry", reason: "store_unavailable" });
    // The locked input moved, or the newest record vanished. Re-reading answers
    // the same way forever, so this ends the operation instead of looping.
    expect(geoRunAssembleOutcome(409, { error: { code: "input_changed" } }))
      .toEqual({ kind: "refused", reason: "not_found" });
    expect(geoRunAssembleOutcome(409, { error: { code: "generation_missing" } }))
      .toEqual({ kind: "refused", reason: "not_found" });
  });

  it("maps the rest of what the route returns", () => {
    expect(geoRunAssembleOutcome(503, { error: { code: "store_unavailable" } }))
      .toEqual({ kind: "retry", reason: "store_unavailable" });
    expect(geoRunAssembleOutcome(429, { error: { code: "rate_limited" } }))
      .toEqual({ kind: "retry", reason: "rate_limited" });
    expect(geoRunAssembleOutcome(404, { error: { code: "not_found" } }))
      .toEqual({ kind: "refused", reason: "not_found" });
    // Every 422 the route has -- generation_failed, outcome_unknown,
    // generation_unusable, assembly_invalid -- describes a paid record this
    // draft can never assemble. None of them improves by being asked again.
    for (const code of ["generation_failed", "outcome_unknown", "generation_unusable", "assembly_invalid"]) {
      expect(geoRunAssembleOutcome(422, { error: { code } })).toEqual({ kind: "refused", reason: "invalid_output" });
    }
    expect(geoRunAssembleOutcome(400, { error: { code: "invalid_request" } }))
      .toEqual({ kind: "refused", reason: "invalid_output" });
  });
});

/**
 * The seam the pure table above is only half of.
 *
 * `geoRunDispatchOutcome` reads a status and an error code; that those are the
 * status and the code the generation route actually produces for a given
 * preparation refusal is a separate claim, and one no test made. So these drive
 * the REAL `handleGeoKbGeneration` -- its request schema, its knowledge-pack
 * key read, its own status mapping -- and stub only the preparer, at the
 * dependency boundary the handler declares.
 *
 * The store methods that spend money throw. A refusal that reached `claim`
 * would be a refusal that got past the preflight, and the test would say so
 * rather than quietly assert an outcome over a charge.
 */
describe("what the generation route's own refusal becomes in the ledger", () => {
  type Prepared = Awaited<ReturnType<GeoKbGenerationHandlerDependencies["prepare"]>>;

  function generationRefusing(prepared: Prepared): GeoKbGenerationHandlerDependencies {
    const forbidden = (name: string) => (): never => {
      throw new Error(`${name} must not be reached by a refused preparation`);
    };
    return {
      authenticate: async () => ({ status: "authenticated", userId: USER, email: null, avatarUrl: null }),
      prepare: async () => prepared,
      store: {
        claim: forbidden("claim"),
        markDispatched: forbidden("markDispatched"),
        finish: forbidden("finish"),
        read: forbidden("read"),
        // Nothing has been bought under this key, which is what sends the
        // request on to the preparer at all.
        readByKey: async () => ({ kind: "ok", generation: null }),
      },
      consumeQuota: forbidden("consumeQuota"),
    };
  }

  const dispatchWith = async (prepared: Prepared) =>
    await createGeoRunKnowledgeSources({
      readDetails: async () => { throw new Error("readDetails must not be reached"); },
      generation: () => generationRefusing(prepared),
      assemble: () => { throw new Error("assemble must not be reached"); },
    }).dispatchGeneration({
      userId: USER,
      kbId: KB,
      idempotencyKey: geoRunKnowledgeIdempotencyKey(RUN),
      baseVersion: 4,
      draftHash: "a".repeat(64),
    });

  it("carries a post-crawl refusal through as work that was attempted", async () => {
    // `input_too_large` is only reachable after the v3 knowledge preparer has
    // collected the site. Before this change it arrived in the ledger as
    // `unsupported`, and the card told the owner nothing had been spent.
    await expect(dispatchWith({ kind: "input_too_large" }))
      .resolves.toEqual({ kind: "refused", permanent: true, reason: "invalid_output" });
    await expect(dispatchWith({ kind: "invalid_input" }))
      .resolves.toEqual({ kind: "refused", permanent: true, reason: "invalid_output" });
  });

  it("still carries the one refusal that precedes any fetch through as unsupported", async () => {
    // A contract check on the mapping, not a claim about production: the real
    // preparer answers `unsupported_draft` only for a kind this caller never
    // sends. It is here so a change that made the split read the wrong field
    // fails instead of collapsing everything into one bucket again.
    await expect(dispatchWith({ kind: "unsupported_draft" }))
      .resolves.toEqual({ kind: "refused", permanent: true, reason: "unsupported" });
  });

  it("keeps the refusals that are not 422 where they were", async () => {
    // Guards the split against being applied by status class rather than by
    // code: these two carry error codes too, and neither is a 422.
    await expect(dispatchWith({ kind: "missing" }))
      .resolves.toEqual({ kind: "refused", permanent: true, reason: "not_found" });
    await expect(dispatchWith({ kind: "input_stale" }))
      .resolves.toEqual({ kind: "refused", permanent: false, reason: "store_unavailable" });
    await expect(dispatchWith({ kind: "model_unavailable" }))
      .resolves.toEqual({ kind: "refused", permanent: false, reason: "model_unavailable" });
  });
});
