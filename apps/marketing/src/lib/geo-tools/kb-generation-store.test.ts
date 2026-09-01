import { describe, expect, it, vi } from "vitest";
import { createGeoKbGenerationStore } from "./kb-generation-store.ts";
import { geoGenerationInputHash } from "./kb-generation.ts";
const userId = "11111111-1111-4111-8111-111111111111", kbId = "22222222-2222-4222-8222-222222222222", generationId = "33333333-3333-4333-8333-333333333333", token = "44444444-4444-4444-8444-444444444444";
const input = { userId, kbId, kind: "roles" as const, idempotencyKey: "typed_request_1", input: { kbId, baseDraftVersion: "1", baseDraftHash: "a".repeat(64), profileCopyHash: "b".repeat(64) } };
const inputHash = geoGenerationInputHash("roles", input.input);
const record = () => ({ generationId, userId, kbId, kind: "roles", inputHash, state: "claimed", result: null, errorReason: null, attempt: null });
describe("generation store transport", () => {
  it("returns the exclusive capability only for a matching claimed record", async () => {
    const callRpc = vi.fn(async () => ({ data: [{ outcome: "claimed", generation: record(), claim_token: token }], error: null }));
    expect(await createGeoKbGenerationStore({ callRpc }).claim({ ...input, inputHash })).toEqual({ kind: "claimed", generation: record(), claimToken: token });
  });
  it.each(["owner", "kb", "kind", "hash", "secret"])("refuses a wrong/leaking %s record", async field => {
    const generation = record();
    if (field === "owner") generation.userId = token;
    if (field === "kb") generation.kbId = token;
    if (field === "kind") generation.kind = "questions";
    if (field === "hash") generation.inputHash = "c".repeat(64);
    if (field === "secret") Object.assign(generation, { claimToken: token });
    const store = createGeoKbGenerationStore({ callRpc: async () => ({ data: [{ outcome: "claimed", generation, claim_token: token }], error: null }) });
    expect(await store.claim({ ...input, inputHash })).toEqual({ kind: "unavailable" });
  });
  it("fails closed on ambiguous SQL acknowledgement without dispatch authority", async () => {
    const store = createGeoKbGenerationStore({ callRpc: async () => { throw new Error("Synthetic timeout"); } });
    expect(await store.markDispatched({ userId, kbId, generationId, claimToken: token })).toEqual({ kind: "unavailable" });
  });
});
