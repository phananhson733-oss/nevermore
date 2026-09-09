import { describe, expect, it, vi } from "vitest";
import { handleGeoKbGeneration, handleGeoKbGenerationRead, type GeoKbGenerationHandlerDependencies } from "./kb-generation-handler.ts";
import type { GeoGenerationValue, GeoKbGenerationRecord } from "./kb-generation.ts";

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
    prepare: vi.fn(async (input) => {
      calls.push("prepare");
      const base = { kbId: input.kbId, baseDraftVersion: String(input.baseVersion), baseDraftHash: input.draftHash, profileCopyHash: HASH };
      // A real knowledge-pack result carries the manifest naming the draft it
      // was built on. Everything that decides whether a stored attempt answers
      // this request reads that manifest, so the fixture has to have one.
      const value: GeoGenerationValue = input.kind === "knowledge_pack" ? { manifest: base } : { roles: [] };
      return { kind: "ready" as const, input: base, invoke: async () => { calls.push("provider"); return { ok: true as const, value }; } };
    }),
    store: {
      claim: async (input) => {
        calls.push("claim");
        record = { userId: input.userId, kbId: input.kbId, generationId: ID, kind: input.kind, inputHash: input.inputHash, state: "claimed", result: null, errorReason: null, attempt: null };
        return { kind: "claimed", generation: record, claimToken: TOKEN };
      },
      markDispatched: async () => { calls.push("dispatch"); record = { ...record!, state: "dispatched" }; return { kind: "dispatched", generation: record }; },
      finish: async (_scope, finish) => { calls.push("finish"); record = { ...record!, ...finish }; return { kind: "ok", generation: record }; },
      read: async () => ({ kind: "ok", generation: record === null ? null : { ...record, claimToken: TOKEN } }),
      readByKey: async () => ({ kind: "ok", generation: record }),
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
  it("accepts an optional knowledge generation ID only for questions", async () => {
    const questions = fixture();
    const response = await handleGeoKbGeneration(request({ ...body(), knowledgeGenerationId: ID }), "questions", questions.deps);
    expect(response.status).toBe(200);
    expect(questions.deps.prepare).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, kind: "questions", knowledgeGenerationId: ID }));

    for (const [kind, value] of [["questions", "not-a-uuid"], ["roles", ID], ["knowledge_pack", ID]] as const) {
      const state = fixture();
      expect((await handleGeoKbGeneration(request({ ...body(), knowledgeGenerationId: value }), kind, state.deps)).status).toBe(400);
      expect(state.calls).toEqual([]);
    }
  });
  it("returns explicit missing/stale/config errors without a durable or billable claim", async () => {
    const { deps, calls } = fixture();
    // The code, not only the status. Two of these refusals are RENAMED on the
    // way out -- `missing` becomes `not_found` and `unavailable` becomes
    // `store_unavailable` -- and one is passed through unchanged. Asserting the
    // status alone cannot tell those apart: `unavailable` and
    // `model_unavailable` are both 503, so a mapping that leaked the raw kind
    // would ship a code no client knows and every status assertion would stay
    // green. `unavailable` had never been exercised here at all.
    for (const [kind, status, code] of [["missing", 404, "not_found"], ["input_stale", 409, "input_stale"],
      ["model_unavailable", 503, "model_unavailable"], ["unavailable", 503, "store_unavailable"]] as const) {
      const response = await handleGeoKbGeneration(request(), "roles", { ...deps, prepare: async () => ({ kind }) });
      expect({ kind, status: response.status }).toEqual({ kind, status });
      expect({ kind, code: ((await response.json()) as { error: { code: string } }).error.code }).toEqual({ kind, code });
    }
    expect(calls).toEqual([]);
  });
  it("reports an unsupported draft as a permanent refusal, never as an outage", async () => {
    // A v3 draft reaching the roles or questions route: this deployment has no
    // result shape it could store, so retrying cannot help. 503 would invite the
    // client to retry a request that will refuse identically forever.
    const { deps, calls } = fixture();
    const response = await handleGeoKbGeneration(request(), "roles", { ...deps, prepare: async () => ({ kind: "unsupported_draft" }) });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("unsupported_draft");
    expect(calls).toEqual([]);
  });
  it("keeps an oversized prompt distinct from a malformed one, and spends nothing for either", async () => {
    // The two refusals ask the owner for opposite things: `invalid_input` says
    // a field is wrong, `input_too_large` says every field is fine and there is
    // more evidence here than one prompt may carry. They were the same code
    // until now, so nothing downstream could tell an owner which one happened.
    const { deps, calls } = fixture();
    const oversized = await handleGeoKbGeneration(request(), "knowledge_pack", { ...deps, prepare: async () => ({ kind: "input_too_large" }) });
    expect(oversized.status).toBe(422);
    expect((await oversized.json()).error.code).toBe("input_too_large");
    // The control: same route, same status, and the code an owner has always
    // been given. It is here so the assertion above is about the new code and
    // not about 422 -- both refusals are 422, so the code is the distinction.
    const malformed = await handleGeoKbGeneration(request(), "knowledge_pack", { ...deps, prepare: async () => ({ kind: "invalid_input" }) });
    expect(malformed.status).toBe(422);
    expect((await malformed.json()).error.code).toBe("invalid_input");
    expect(calls).toEqual([]);
  });
  it("admits a v3 durable input, which names generationInputHash and carries no profile copy", async () => {
    const { deps, calls } = fixture();
    const prepare: GeoKbGenerationHandlerDependencies["prepare"] = async (input) => ({
      kind: "ready",
      input: { schemaVersion: "marketing-geo-knowledge-generation-input.v2", kbId: input.kbId, baseDraftVersion: String(input.baseVersion),
        baseDraftHash: input.draftHash, generationInputHash: HASH, sourceReceiptRefs: [], knowledgeSynthesisInput: {} },
      invoke: async () => ({ ok: true, value: { manifest: { baseDraftVersion: String(input.baseVersion), baseDraftHash: input.draftHash } } }),
    });
    expect((await handleGeoKbGeneration(request(), "knowledge_pack", { ...deps, prepare })).status).toBe(200);
    // It reached the durable path rather than being turned away at the binding
    // check: claimed, quota spent, dispatched, finished.
    expect(calls).toEqual(["claim", "quota", "dispatch", "finish"]);
  });
  it("refuses a prepared input naming both Profile identity domains, or neither", async () => {
    // Exactly one has to be present: the claim picks its branch by the draft's
    // schema version, and an input carrying both would be admitted here and then
    // judged by a branch that ignores the half this request actually depends on.
    const identities: readonly Readonly<Record<string, string>>[] = [{ profileCopyHash: HASH, generationInputHash: HASH }, {}];
    for (const identity of identities) {
      const { deps, calls } = fixture();
      const prepare: GeoKbGenerationHandlerDependencies["prepare"] = async (input) => ({
        kind: "ready", input: { kbId: input.kbId, baseDraftVersion: String(input.baseVersion), baseDraftHash: input.draftHash, ...identity },
        invoke: async () => ({ ok: true, value: { roles: [] } }),
      });
      expect((await handleGeoKbGeneration(request(), "roles", { ...deps, prepare })).status).toBe(503);
      expect(calls).toEqual([]);
    }
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
  it("uses the unchanged common preflight and safe response for knowledge-pack generation", async () => {
    const { deps, calls } = fixture();
    const response = await handleGeoKbGeneration(request(), "knowledge_pack", deps);
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.data.generation).toMatchObject({ kind: "knowledge_pack", state: "succeeded" });
    expect(value.data.generation).not.toHaveProperty("userId");
    expect(value.data.generation).not.toHaveProperty("claimToken");
    expect(calls).toEqual(["prepare", "claim", "quota", "dispatch", "provider", "finish"]);

    const loaded = await handleGeoKbGenerationRead(request({
      kbId: KB,
      kind: "knowledge_pack",
      idempotencyKey: body().idempotencyKey,
    }), deps);
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).data.generation.kind).toBe("knowledge_pack");
    expect(calls.filter(call => call === "provider")).toHaveLength(1);
  });
  it("does not turn unavailable/foreign generation reads into a missing-state success", async () => {
    const { deps } = fixture();
    const query = request({ kbId: KB, generationId: ID });
    expect((await handleGeoKbGenerationRead(query, { ...deps, store: { ...deps.store, read: async () => ({ kind: "unavailable" }) } })).status).toBe(503);
    expect((await handleGeoKbGenerationRead(request({ kbId: KB, generationId: ID }), deps)).status).toBe(404);
  });
  it.each(["generationId", "idempotencyKey"] as const)("maps a nullable concrete-store %s read to private not_found", async (path) => {
    const { deps } = fixture();
    const store = path === "generationId"
      ? { ...deps.store, read: async () => ({ kind: "ok" as const, generation: null }) }
      : { ...deps.store, readByKey: async () => ({ kind: "ok" as const, generation: null }) };
    const input = path === "generationId" ? { kbId: KB, generationId: ID } : { kbId: KB, kind: "roles" as const, idempotencyKey: body().idempotencyKey };
    const response = await handleGeoKbGenerationRead(request(input), { ...deps, store });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
  });
  it("finds an earlier knowledge-pack attempt by its key before spending the evidence crawl", async () => {
    // `prepare` for a knowledge pack is not a preflight: it runs the live
    // evidence crawl. Sending the same request twice must therefore run that
    // crawl once, which is only possible if the key is read before prepare.
    const { deps, calls } = fixture();
    expect((await handleGeoKbGeneration(request(), "knowledge_pack", deps)).status).toBe(200);
    const retry = await handleGeoKbGeneration(request(), "knowledge_pack", deps);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ data: { reused: true, generation: { generationId: ID, kind: "knowledge_pack" } } });
    expect(calls.filter(call => call === "prepare")).toHaveLength(1);
    expect(calls.filter(call => call === "provider")).toHaveLength(1);
  });
  it("returns an unfinished knowledge-pack attempt rather than starting a second crawl for it", async () => {
    const { deps, calls } = fixture();
    const claimed: GeoKbGenerationRecord = { userId: USER, kbId: KB, generationId: ID, kind: "knowledge_pack", inputHash: HASH, state: "claimed", result: null, errorReason: null, attempt: null };
    const response = await handleGeoKbGeneration(request(), "knowledge_pack", { ...deps, store: { ...deps.store, readByKey: async () => ({ kind: "ok", generation: claimed }) } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { reused: true, generation: { state: "claimed" } } });
    expect(calls).toEqual([]);
  });
  it("refuses a knowledge-pack key that already answers a different draft, without crawling again", async () => {
    const { deps, calls } = fixture();
    expect((await handleGeoKbGeneration(request(), "knowledge_pack", deps)).status).toBe(200);
    const moved = await handleGeoKbGeneration(request({ ...body(), draftHash: "b".repeat(64) }), "knowledge_pack", deps);
    expect(moved.status).toBe(409);
    expect(await moved.json()).toEqual({ error: { code: "conflict" } });
    expect(calls.filter(call => call === "prepare")).toHaveLength(1);
  });
  it("does not read a knowledge-pack key past an unavailable or foreign store answer", async () => {
    const { deps, calls } = fixture();
    const unavailable = { ...deps, store: { ...deps.store, readByKey: async () => ({ kind: "unavailable" as const }) } };
    expect((await handleGeoKbGeneration(request(), "knowledge_pack", unavailable)).status).toBe(503);
    const foreign: GeoKbGenerationRecord = { userId: USER, kbId: ID, generationId: ID, kind: "knowledge_pack", inputHash: HASH, state: "claimed", result: null, errorReason: null, attempt: null };
    const mismatched = { ...deps, store: { ...deps.store, readByKey: async () => ({ kind: "ok" as const, generation: foreign }) } };
    expect((await handleGeoKbGeneration(request(), "knowledge_pack", mismatched)).status).toBe(503);
    expect(calls).toEqual([]);
  });
  it.each(["roles", "questions"] as const)("keeps preparing %s on every request, whose durable input is already content-addressed", async (kind) => {
    const { deps, calls } = fixture();
    expect((await handleGeoKbGeneration(request(), kind, deps)).status).toBe(200);
    expect((await handleGeoKbGeneration(request(), kind, deps)).status).toBe(200);
    expect(calls.filter(call => call === "prepare")).toHaveLength(2);
  });
  it("says which check rejected the model output, so a repeated failure is not a black box", async () => {
    const { deps } = fixture();
    const prepare: GeoKbGenerationHandlerDependencies["prepare"] = async (input) => ({
      kind: "ready", input: { kbId: input.kbId, baseDraftVersion: String(input.baseVersion), baseDraftHash: input.draftHash, profileCopyHash: HASH },
      invoke: async () => ({ ok: false, reason: "invalid_output", delivery: "response_received", rejection: "schema_invalid:roles.evidenceRefs" }),
    });
    const response = await handleGeoKbGeneration(request(), "roles", { ...deps, prepare });
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.data.rejection).toBe("schema_invalid:roles.evidenceRefs");
    expect(value.data.generation.state).toBe("failed");
    // The token is a response-only diagnostic; the stored record's key set is
    // fixed by a database CHECK and must not grow one.
    expect(JSON.stringify(value.data.generation)).not.toContain("evidenceRefs");
  });
  it("omits the rejection key entirely when no check named one", async () => {
    const { deps } = fixture();
    const response = await handleGeoKbGeneration(request(), "roles", deps);
    expect(Object.keys((await response.json()).data).sort()).toEqual(["generation", "reused"]);
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
