import { describe, expect, it } from "vitest";
import { handleGeoKbPreparedFreeze, handleGeoKbPreparedRead, type GeoKbPreparedHandlerDependencies } from "./kb-prepared-handler.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const KB = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);
const request = (body: unknown, origin = "https://gengrowth.ai") => new Request("https://gengrowth.ai/api/tools/geo-knowledge-base/freeze-prepared", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
function fixture() {
  const calls: unknown[] = [];
  const deps: GeoKbPreparedHandlerDependencies = {
    authenticate: async () => ({ status: "authenticated", userId: USER, email: null, avatarUrl: null }),
    read: async (input) => { calls.push(input); return { kind: "missing" }; },
    freeze: async (input) => { calls.push(input); return { kind: "ok", value: { snapshotId: ID, revision: 1, contentHash: HASH, questionSetHash: HASH,
      frozenAt: "2026-08-31T00:00:00.000Z", questionCount: 8, reusedExisting: false } }; },
  };
  return { deps, calls };
}
describe("exact prepared-only freeze HTTP", () => {
  it("authenticates and checks origin before even reading a candidate", async () => {
    const { deps, calls } = fixture();
    expect((await handleGeoKbPreparedFreeze(request({ kbId: KB, candidateId: ID, candidateHash: HASH }), { ...deps, authenticate: async () => ({ status: "unauthenticated" }) })).status).toBe(401);
    expect((await handleGeoKbPreparedRead(request({ kbId: KB }, "https://evil.example"), deps)).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it("freezes by owned candidate identity only and never accepts client content or an old context hash", async () => {
    const { deps, calls } = fixture();
    for (const extra of [{ payload: {} }, { questionSet: {} }, { contextHash: HASH }, { baseVersion: 2 }]) {
      expect((await handleGeoKbPreparedFreeze(request({ kbId: KB, candidateId: ID, candidateHash: HASH, ...extra }), deps)).status).toBe(400);
    }
    expect(calls).toEqual([]);
    const response = await handleGeoKbPreparedFreeze(request({ kbId: KB, candidateId: ID, candidateHash: HASH }), deps);
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ userId: USER, kbId: KB, candidateId: ID, candidateHash: HASH }]);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await response.json()).data).toMatchObject({ snapshotId: ID, revision: 1 });
  });
  it("maps stale, missing and unavailable freeze outcomes without regeneration", async () => {
    const { deps } = fixture();
    for (const [kind, status] of [["stale", 409], ["missing", 404], ["unavailable", 503]] as const) {
      expect((await handleGeoKbPreparedFreeze(request({ kbId: KB, candidateId: ID, candidateHash: HASH }), { ...deps, freeze: async () => ({ kind }) })).status).toBe(status);
    }
  });
  it("distinguishes no latest candidate from an unavailable store and a missing exact candidate", async () => {
    const { deps } = fixture();
    const empty = await handleGeoKbPreparedRead(request({ kbId: KB }), deps);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ data: { candidate: null } });
    expect((await handleGeoKbPreparedRead(request({ kbId: KB, candidateId: ID }), deps)).status).toBe(404);
    expect((await handleGeoKbPreparedRead(request({ kbId: KB }), { ...deps, read: async () => ({ kind: "unavailable" }) })).status).toBe(503);
  });
});
