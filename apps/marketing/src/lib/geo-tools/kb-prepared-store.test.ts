import { describe, expect, it, vi } from "vitest";
import { completePayloadV2, V2_KB_ID, V2_CANDIDATE_ID } from "./kb-v2.test-fixtures.ts";
import { createGeoKbPreparedStore, saveGeoKbDraftV2 } from "./kb-prepared-store.ts";
const userId = "11111111-1111-4111-8111-111111111111";
describe("prepared store boundary", () => {
  it("does not mislabel infrastructure failures as malformed draft input", async () => {
    const callRpc = vi.fn();
    expect(await saveGeoKbDraftV2({ userId, kbId: V2_KB_ID, baseVersion: 1, payload: completePayloadV2() }, { readKnowledgeBase: async () => { throw new Error("Synthetic store outage"); }, callRpc })).toMatchObject({ kind: "unavailable" });
    expect(callRpc).not.toHaveBeenCalled();
  });
  it("never treats an absent exact candidate id as permission to load latest", async () => {
    const readCandidate = vi.fn(async () => ({ data: null, error: null }));
    const store = createGeoKbPreparedStore({ readCandidate, callRpc: vi.fn() });
    expect(await store.read({ userId, kbId: V2_KB_ID } as never)).toMatchObject({ kind: "unavailable" });
    expect(readCandidate).not.toHaveBeenCalled();
  });
  it("distinguishes a real missing candidate from a malformed response", async () => {
    const readCandidate = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null }));
    const store = createGeoKbPreparedStore({ readCandidate, callRpc: vi.fn() });
    expect(await store.read({ userId, kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID })).toEqual({ kind: "ok", value: null });
    readCandidate.mockResolvedValue({ data: undefined, error: null });
    expect((await store.read({ userId, kbId: V2_KB_ID, candidateId: V2_CANDIDATE_ID })).kind).toBe("unavailable");
  });
});
