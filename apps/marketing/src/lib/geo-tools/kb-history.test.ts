import { describe, expect, it, vi } from "vitest";
import { listFrozenGeoKbVersions, type GeoKbHistoryDependencies } from "./kb-history.ts";
import { contextPayload, CONTEXT_KB_ID } from "./snapshot-context.test-fixtures.ts";
import { geoKbDigest } from "./kb-digest.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";

const USER = "11111111-1111-4111-8111-111111111111";
function fixture(count = 2) {
  const rows = Array.from({ length: count }, (_, index) => {
    const payload = { ...contextPayload(), officialName: `Acme ${index + 1}` };
    const questionSet = buildGeoQuestionSet(payload);
    return { id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`, user_id: USER, kb_id: CONTEXT_KB_ID, schema_version: payload.schemaVersion, revision: index + 1, payload, content_hash: geoKbDigest(payload as unknown as GeoKbValue), question_set: questionSet, question_set_hash: geoQuestionSetDigest(questionSet), frozen_at: "2026-08-31T00:00:00.000Z" };
  }).reverse();
  const current = rows[0];
  const dependencies: GeoKbHistoryDependencies = {
    listKnowledgeBases: vi.fn(async () => ({ kind: "ok" as const, value: [{ kbId: CONTEXT_KB_ID, origin: "https://example.com", host: "example.com", canonicalSiteKey: "example.com", createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z", draft: null, frozen: current ? { snapshotId: current.id, revision: current.revision, contentHash: current.content_hash, questionSetHash: current.question_set_hash, frozenAt: current.frozen_at } : null }] })),
    readPage: vi.fn(async (_userId, offset, limit) => ({ kind: "ok" as const, data: rows.slice(offset, offset + limit) })),
  };
  return { dependencies, rows };
}
describe("owned frozen version history", () => {
  it("lists historical and current snapshots of the same KB without mixing identities", async () => {
    const { dependencies, rows } = fixture();
    const result = await listFrozenGeoKbVersions({ userId: USER }, dependencies);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.map((item) => item.snapshot.snapshotId)).toEqual(rows.map((item) => item.id));
    expect(result.value.map((item) => item.snapshot.revision)).toEqual([2, 1]);
  });
  it("reads multiple bounded pages rather than losing versions at the provider page limit", async () => {
    const { dependencies } = fixture(52);
    const result = await listFrozenGeoKbVersions({ userId: USER }, dependencies);
    expect(result.kind === "ok" && result.value.length).toBe(52);
    expect(dependencies.readPage).toHaveBeenCalledTimes(3);
  });
  it("does not turn an unreadable declared snapshot into an empty selector", async () => {
    const { dependencies } = fixture();
    vi.mocked(dependencies.readPage).mockResolvedValue({ kind: "ok", data: [] });
    expect((await listFrozenGeoKbVersions({ userId: USER }, dependencies)).kind).toBe("unavailable");
  });
  it("refuses a foreign or corrupted old row even when the current row is good", async () => {
    const { dependencies, rows } = fixture();
    rows[1]!.user_id = "22222222-2222-4222-8222-222222222222";
    expect((await listFrozenGeoKbVersions({ userId: USER }, dependencies)).kind).toBe("unavailable");
    rows[1]!.user_id = USER;
    rows[1]!.question_set_hash = "0".repeat(64);
    expect((await listFrozenGeoKbVersions({ userId: USER }, dependencies)).kind).toBe("unavailable");
  });
  it("reports a history budget overflow without a silently truncated list", async () => {
    const { dependencies } = fixture(201);
    expect(await listFrozenGeoKbVersions({ userId: USER }, dependencies)).toMatchObject({ kind: "unavailable", reason: "frozen_history_limit" });
  });
  it("can distinguish genuinely empty history from a transport failure", async () => {
    const { dependencies } = fixture(0);
    expect(await listFrozenGeoKbVersions({ userId: USER }, dependencies)).toEqual({ kind: "ok", value: [] });
    vi.mocked(dependencies.readPage).mockResolvedValue({ kind: "error", code: "503" });
    expect((await listFrozenGeoKbVersions({ userId: USER }, dependencies)).kind).toBe("unavailable");
  });
});
