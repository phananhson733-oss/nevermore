import { describe, expect, it } from "vitest";
import { executeGeoKbGeneration, GEO_GENERATION_RESULT_BYTES, type GeoKbGenerationDependencies, type GeoKbGenerationRecord } from "./kb-generation.ts";

const USER = "10aff318-6a15-493f-b654-c5db1f977777";
const KB = "2daf4d6e-8efe-4a9e-8d8a-e59009077777";
const ID = "30000000-0000-4000-8000-000000000001";
const TOKEN = "40000000-0000-4000-8000-000000000001";
const request = () => ({ userId: USER, kbId: KB, kind: "roles" as const, idempotencyKey: "review-roles-1", input: { draftHash: "a".repeat(64), generatorVersion: "roles.v1" } });

function fixture() {
  let record: GeoKbGenerationRecord | null = null;
  const calls: string[] = [];
  const dependencies: GeoKbGenerationDependencies = {
    configured: true,
    claim: async (input) => {
      calls.push("claim");
      if (record !== null) return record.inputHash === input.inputHash ? { kind: "existing", generation: record } : { kind: "conflict" };
      record = { userId: input.userId, kbId: input.kbId, generationId: ID, kind: input.kind, inputHash: input.inputHash,
        state: "claimed", result: null, errorReason: null, attempt: null };
      return { kind: "claimed", generation: record, claimToken: TOKEN };
    },
    consumeQuota: async () => { calls.push("quota"); return "allowed"; },
    markDispatched: async (scope) => {
      calls.push("dispatch");
      expect(scope.claimToken).toBe(TOKEN);
      if (record === null) return { kind: "unavailable" };
      if (record.state !== "claimed") return { kind: "existing", generation: record };
      record = { ...record, state: "dispatched" };
      return { kind: "dispatched", generation: record };
    },
    invoke: async () => { calls.push("provider"); return { ok: true, value: { roles: [] } }; },
    finish: async (_scope, outcome) => {
      calls.push("finish");
      if (record === null) return { kind: "unavailable" };
      record = { ...record, ...outcome };
      return { kind: "ok", generation: record };
    },
  };
  return { dependencies, calls, getRecord: () => record };
}

describe("durable GEO semantic generation", () => {
  it("claims before quota, dispatches once and returns only the persisted result", async () => {
    const { dependencies, calls } = fixture();
    const result = await executeGeoKbGeneration(request(), dependencies);
    expect(result).toMatchObject({ kind: "ok", reused: false, generation: { state: "succeeded", result: { roles: [] } } });
    expect(calls).toEqual(["claim", "quota", "dispatch", "provider", "finish"]);
    expect(await executeGeoKbGeneration(request(), dependencies)).toMatchObject({ kind: "ok", reused: true });
    expect(calls.filter((call) => call === "provider")).toHaveLength(1);
    expect(calls.filter((call) => call === "quota")).toHaveLength(1);
  });
  it("configuration and bounded input failures happen before persistence or quota", async () => {
    const { dependencies, calls } = fixture();
    expect(await executeGeoKbGeneration(request(), { ...dependencies, configured: false })).toEqual({ kind: "model_unavailable" });
    expect(await executeGeoKbGeneration({ ...request(), userId: "foreign" }, dependencies)).toEqual({ kind: "invalid_input" });
    expect(await executeGeoKbGeneration({ ...request(), input: { huge: "中".repeat(100_000) } }, dependencies)).toEqual({ kind: "invalid_input" });
    expect(calls).toEqual([]);
  });
  it("rejects JSONB-incompatible input instead of persisting a lossy identity", async () => {
    const { dependencies, calls } = fixture();
    expect(await executeGeoKbGeneration({ ...request(), input: { text: "nul\u0000text" } }, dependencies)).toEqual({ kind: "invalid_input" });
    expect(calls).toEqual([]);
  });
  it("does not dispatch if the claim fails or conflicts", async () => {
    const { dependencies, calls } = fixture();
    expect(await executeGeoKbGeneration(request(), { ...dependencies, claim: async () => ({ kind: "unavailable" }) })).toEqual({ kind: "store_unavailable" });
    expect(await executeGeoKbGeneration(request(), { ...dependencies, claim: async () => ({ kind: "conflict" }) })).toEqual({ kind: "conflict" });
    expect(calls).toEqual([]);
  });
  it("records quota refusal without any provider dispatch", async () => {
    const { dependencies, calls } = fixture();
    const result = await executeGeoKbGeneration(request(), { ...dependencies, consumeQuota: async () => "limited" });
    expect(result).toMatchObject({ kind: "ok", generation: { state: "failed", errorReason: "rate_limited", result: null } });
    expect(calls).toEqual(["claim", "finish"]);
  });
  it("refuses an ambiguous dispatch acknowledgement without calling the provider", async () => {
    const { dependencies, calls } = fixture();
    expect(await executeGeoKbGeneration(request(), { ...dependencies, markDispatched: async () => { throw new Error("network"); } })).toEqual({ kind: "store_unavailable" });
    expect(calls).toEqual(["claim", "quota"]);
  });
  it("keeps an ambiguous provider failure uncertain and never retries it", async () => {
    const { dependencies, calls } = fixture();
    const withFailure = { ...dependencies, invoke: async () => { calls.push("provider"); throw new Error("possibly delivered"); } };
    expect(await executeGeoKbGeneration(request(), withFailure)).toMatchObject({ kind: "ok", generation: { state: "uncertain", errorReason: "outcome_unknown" } });
    expect(await executeGeoKbGeneration(request(), withFailure)).toMatchObject({ kind: "ok", reused: true, generation: { state: "uncertain" } });
    expect(calls.filter((call) => call === "provider")).toHaveLength(1);
  });
  it("distinguishes response validation failure from an unknown delivery", async () => {
    const { dependencies } = fixture();
    expect(await executeGeoKbGeneration(request(), { ...dependencies,
      invoke: async () => ({ ok: false, reason: "invalid_output", delivery: "response_received" }),
    })).toMatchObject({ kind: "ok", generation: { state: "failed", errorReason: "invalid_output" } });
  });
  it("retains spent usage even when the provider response fails semantic validation", async () => {
    const { dependencies } = fixture();
    const attempt = { attemptedCalls: 1 as const, delivery: "response_received" as const, modelRequested: "configured-model", inputTokens: 200, outputTokens: 50, requestCount: 1 };
    expect(await executeGeoKbGeneration(request(), { ...dependencies,
      invoke: async () => ({ ok: false, reason: "invalid_output", delivery: "response_received", attempt }),
    })).toMatchObject({ kind: "ok", generation: { state: "failed", attempt } });
  });
  it("does not display a transient success when final persistence fails", async () => {
    const { dependencies } = fixture();
    expect(await executeGeoKbGeneration(request(), { ...dependencies, finish: async () => ({ kind: "unavailable" }) })).toEqual({ kind: "store_unavailable" });
  });
  it("refuses a foreign or wrong-input stored generation", async () => {
    const { dependencies, calls, getRecord } = fixture();
    await executeGeoKbGeneration(request(), dependencies);
    const current = getRecord()!;
    for (const changed of [{ userId: "50aff318-6a15-493f-b654-c5db1f977777" }, { inputHash: "b".repeat(64) }, { kind: "questions" as const }]) {
      expect(await executeGeoKbGeneration(request(), { ...dependencies, claim: async () => ({ kind: "existing", generation: { ...current, ...changed } }) })).toEqual({ kind: "store_unavailable" });
    }
    expect(calls.filter((call) => call === "provider")).toHaveLength(1);
  });
  it("records oversized provider output as invalid instead of storing or showing it", async () => {
    const { dependencies } = fixture();
    expect(await executeGeoKbGeneration(request(), { ...dependencies, invoke: async () => ({ ok: true, value: { content: "x".repeat(GEO_GENERATION_RESULT_BYTES + 1) } }) }))
      .toMatchObject({ kind: "ok", generation: { state: "failed", errorReason: "invalid_output", result: null } });
  });
  it("can persist the full candidate envelope rather than only a smaller model reply", async () => {
    const { dependencies } = fixture();
    expect(await executeGeoKbGeneration(request(), { ...dependencies, invoke: async () => ({ ok: true, value: { candidate: "x".repeat(1_200_000) } }) }))
      .toMatchObject({ kind: "ok", generation: { state: "succeeded" } });
  });
  it("blocks duplicate simultaneous requests while the provider is running", async () => {
    const { dependencies, calls } = fixture();
    let release!: () => void;
    let entered!: () => void;
    const invocationStarted = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const held = { ...dependencies, invoke: async () => { calls.push("provider"); entered(); await blocked; return { ok: true as const, value: { roles: [] } }; } };
    const first = executeGeoKbGeneration(request(), held);
    await invocationStarted;
    expect(await executeGeoKbGeneration(request(), held)).toMatchObject({ kind: "ok", reused: true, generation: { state: "dispatched" } });
    release();
    await first;
    expect(calls.filter((call) => call === "provider")).toHaveLength(1);
  });
});
