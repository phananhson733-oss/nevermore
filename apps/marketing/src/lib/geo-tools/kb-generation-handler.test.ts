import { describe, expect, it } from "vitest";
import { handleGeoKbGeneration, handleGeoKbGenerationRead, type GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import type { GeoKbGenerationRecord } from "./kb-generation.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const KB = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);
const body = () => ({ kbId: KB, baseVersion: 2, draftHash: HASH, idempotencyKey: "prepare-roles-01", sourceReceiptRefs: [], displayLocale: "zh" });
const request = (value: unknown = body(), origin = "https://gengrowth.ai") => new Request("https://gengrowth.ai/api/account/geo-kb/roles", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });

function fixture() {
  const calls: string[] = [];
  let record: GeoKbGenerationRecord | null = null;
  const deps: GeoKbGenerationHandlerDependencies = {
    authenticate: async () => ({ status: "authenticated", userId: USER, googleSubject: null, email: null, avatarUrl: null }),
    prepare: async (input) => {
      calls.push("prepare");
      return { kind: "ready", input: { kbId: input.kbId, baseDraftVersion: String(input.baseVersion), baseDraftHash: input.draftHash, profileCopyHash: HASH }, invoke: async () => { calls.push("provider"); return { ok: true, value: { roles: [] } }; } };
    },
    store: {
      claim: async (input) => {
        calls.push("claim");
        record = { userId: input.userId, kbId: input.kbId, generationId: ID, kind: input.kind, inputHash: input.inputHash, state: "claimed", result: null, errorReason: null, attempt: null };
        return { kind: "claimed", generation: record, claimToken: TOKEN };
      },
      markDispatched: async () => { calls.push("dispatch"); record = { ...record!, state: "dispatched" }; return { kind: "dispatched", generation: record }; },
      finish: async (_scope, finish) => { calls.push("finish"); record = { ...record!, ...finish }; return { kind: "ok", generation: record }; },
      read: async () => record === null ? { kind: "missing" } : { kind: "ok", generation: { ...record, claimToken: TOKEN } },
      readByKey: async () => record === null ? { kind: "missing" } : { kind: "ok", generation: record },
    },
    consumeQuota: async () => { calls.push("quota"); return "allowed"; },
  };
  return { deps, calls };
}

describe("private GEO generation HTTP boundary", () => {
  it("refuses unauthenticated and cross-origin requests before any source or paid work", async () => {
    const { deps, calls } = fixture();
    expect((await handleGeoKbGeneration(request(), "roles", { ...deps, authenticate: async () => ({ status: "unauthenticated" }) })).status).toBe(401);
    expect((await handleGeoKbGeneration(request(body(), "https://evil.example"), "roles", deps)).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("accepts only saved identities and source references, never client text or model settings", async () => {
    const { deps, calls } = fixture();
    for (const extra of [{ payload: {} }, { questions: [] }, { model: "other-model" }, { baseVersion: 0 }]) {
      expect((await handleGeoKbGeneration(request({ ...body(), ...extra }), "roles", deps)).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
  it("returns explicit missing/stale/config errors without a durable or billable claim", async () => {
    const { deps, calls } = fixture();
    for (const [kind, status] of [["missing", 404], ["input_stale", 409], ["model_unavailable", 503]] as const) {
      expect((await handleGeoKbGeneration(request(), "roles", { ...deps, prepare: async () => ({ kind }) })).status).toBe(status);
    }
    expect(calls).toEqual([]);
  });
  it("rejects an incorrectly bound prepared input before quota or claim", async () => {
    const { deps, calls } = fixture();
    const prepare = deps.prepare;
    const changed = { ...deps, prepare: async (...args: Parameters<typeof prepare>) => {
      const ready = await prepare(...args);
      if (ready.kind !== "ready") return ready;
      return { ...ready, input: { ...ready.input, kbId: ID } };
    } };
    expect((await handleGeoKbGeneration(request(), "roles", changed)).status).toBe(503);
    expect(calls).toEqual(["prepare"]);
  });
  it("returns persisted generation data privately without internal ownership or lease capability", async () => {
    const { deps, calls } = fixture();
    const response = await handleGeoKbGeneration(request(), "roles", deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const value = await response.json();
    expect(value.data.generation.state).toBe("succeeded");
    expect(value.data.generation).not.toHaveProperty("userId");
    expect(value.data.generation).not.toHaveProperty("claimToken");
    expect(calls).toEqual(["prepare", "claim", "quota", "dispatch", "provider", "finish"]);
    const loaded = await handleGeoKbGenerationRead(request({ kbId: KB, generationId: ID }), deps);
    expect(loaded.status).toBe(200);
    expect(JSON.stringify(await loaded.json())).not.toContain(TOKEN);
    expect(calls.filter(call => call === "provider")).toHaveLength(1);
  });
  it("does not turn unavailable/foreign generation reads into a missing-state success", async () => {
    const { deps } = fixture();
    const query = request({ kbId: KB, generationId: ID });
    expect((await handleGeoKbGenerationRead(query, { ...deps, store: { ...deps.store, read: async () => ({ kind: "unavailable" }) } })).status).toBe(503);
    expect((await handleGeoKbGenerationRead(request({ kbId: KB, generationId: ID }), deps)).status).toBe(404);
  });
  it("recovers an unacknowledged generation by its original key without generating again", async () => {
    const { deps, calls } = fixture();
    await handleGeoKbGeneration(request(), "roles", deps);
    const read = await handleGeoKbGenerationRead(request({ kbId: KB, kind: "roles", idempotencyKey: body().idempotencyKey }), deps);
    expect(read.status).toBe(200);
    expect((await read.json()).data.generation.generationId).toBe(ID);
    expect(calls.filter(call => call === "provider")).toHaveLength(1);
    expect((await handleGeoKbGenerationRead(request({ kbId: KB, generationId: ID, kind: "roles", idempotencyKey: body().idempotencyKey }), deps)).status).toBe(400);
  });
});
