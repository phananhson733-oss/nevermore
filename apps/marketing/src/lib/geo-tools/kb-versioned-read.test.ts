import { describe, expect, it, vi } from "vitest";
import { readVersionedFrozenGeoKb, readVersionedGeoKnowledgeBase, listVersionedGeoKnowledgeBases } from "./kb-versioned-read.ts";
import { listFrozenGeoKbVersions } from "./kb-history.ts";
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "./kb-v2.test-fixtures.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import type { GeoKbStoreDependencies } from "./kb-store.ts";
const USER = "11111111-1111-4111-8111-111111111111";
const input = { userId: USER, kbId: V2_KB_ID, snapshotId: V2_CANDIDATE_ID };
function fixture(v2 = true) {
  const payload = v2 ? completePayloadV2() : contextPayload(), questionSet = v2 ? questionSetV2() : buildGeoQuestionSet(contextPayload());
  const row = { id: V2_CANDIDATE_ID, kb_id: V2_KB_ID, user_id: USER, revision: 1, schema_version: payload.schemaVersion, payload, content_hash: v2 ? geoV2Digest(payload) : geoKbDigest(payload as unknown as GeoKbValue), question_set: questionSet, question_set_hash: v2 ? geoV2Digest(questionSet) : geoQuestionSetDigest(questionSet as ReturnType<typeof buildGeoQuestionSet>), frozen_at: "2026-08-31T00:00:00.000Z" };
  const dependencies: GeoKbStoreDependencies = { readList: async () => { throw new Error("No list/source read"); }, readDetails: async () => { throw new Error("No current draft/Profile read"); }, callRpc: async () => { throw new Error("No writes"); }, readSnapshot: vi.fn(async () => ({ kind: "ok" as const, data: row })) };
  return { row, dependencies };
}
describe("version-aware exact frozen read", () => {
  it("lists V2 heads and drafts through one bounded bundle and keeps mixed frozen history readable", async () => {
    const current = fixture(), legacy = fixture(false);
    legacy.row.id = "55555555-5555-4555-8555-555555555555";
    const bundle = { knowledgeBases: [{ id: V2_KB_ID, user_id: USER, origin: "https://example.com", host: "example.com", canonical_site_key: "example.com", current_frozen_snapshot_id: current.row.id, created_at: current.row.frozen_at, updated_at: current.row.frozen_at }],
      drafts: [{ kb_id: V2_KB_ID, user_id: USER, schema_version: "marketing-geo-kb.v2", draft_version: 2, content_hash: current.row.content_hash, updated_at: current.row.frozen_at }], snapshots: [current.row] };
    const readList = vi.fn(async () => ({ kind: "ok" as const, data: bundle }));
    const dependencies = { ...current.dependencies, readList };
    const listed = await listVersionedGeoKnowledgeBases({ userId: USER }, dependencies);
    expect(listed).toMatchObject({ kind: "ok", value: [{ kbId: V2_KB_ID, draft: { draftVersion: 2 }, frozen: { snapshotId: current.row.id } }] });
    expect(readList).toHaveBeenCalledTimes(1); expect(current.dependencies.readSnapshot).not.toHaveBeenCalled();
    const history = await listFrozenGeoKbVersions({ userId: USER }, { listKnowledgeBases: input => listVersionedGeoKnowledgeBases(input, dependencies), readPage: async () => ({ kind: "ok", data: [current.row, legacy.row] }) });
    expect(history.kind).toBe("ok");
    if (history.kind === "ok") expect(history.value.map(item => item.snapshot.payload.schemaVersion)).toEqual(["marketing-geo-kb.v2", "marketing-geo-kb.v1"]);
  });
  it.each(["foreign_draft", "foreign_snapshot", "wrong_pointer", "duplicate_head", "unknown_schema"]) ("refuses invalid versioned list %s rather than empty state", async issue => {
    const { row, dependencies } = fixture();
    const bundle = { knowledgeBases: [{ id: V2_KB_ID, user_id: USER, origin: "https://example.com", host: "example.com", canonical_site_key: "example.com", current_frozen_snapshot_id: row.id, created_at: row.frozen_at, updated_at: row.frozen_at }], drafts: [{ kb_id: V2_KB_ID, user_id: USER, schema_version: "marketing-geo-kb.v2", draft_version: 2, content_hash: row.content_hash, updated_at: row.frozen_at }], snapshots: [row] };
    if (issue === "foreign_draft") bundle.drafts[0]!.user_id = V2_KB_ID;
    if (issue === "foreign_snapshot") bundle.snapshots[0]!.user_id = V2_KB_ID;
    if (issue === "wrong_pointer") bundle.knowledgeBases[0]!.current_frozen_snapshot_id = USER;
    if (issue === "duplicate_head") bundle.knowledgeBases.push(bundle.knowledgeBases[0]!);
    if (issue === "unknown_schema") bundle.drafts[0]!.schema_version = "unknown";
    expect((await listVersionedGeoKnowledgeBases({ userId: USER }, { ...dependencies, readList: async () => ({ kind: "ok", data: bundle }) })).kind).toBe("unavailable");
  });
  it("reads the actual v2 mutable draft without a lossy V1 projection or current Profile join", async () => {
    const { row, dependencies } = fixture();
    const bundle = { knowledgeBases: [{ id: V2_KB_ID, user_id: USER, origin: "https://example.com", host: "example.com", canonical_site_key: "example.com", current_frozen_snapshot_id: null, created_at: row.frozen_at, updated_at: row.frozen_at }], drafts: [{ kb_id: V2_KB_ID, user_id: USER, schema_version: row.schema_version, draft_version: 2, payload: row.payload, content_hash: row.content_hash, updated_at: row.frozen_at }], snapshots: [] };
    const readDetails = vi.fn(async () => ({ kind: "ok" as const, data: bundle }));
    expect(await readVersionedGeoKnowledgeBase(input, { ...dependencies, readDetails })).toMatchObject({ kind: "ok", value: { draft: { draftVersion: 2, payload: row.payload } } });
    expect(readDetails).toHaveBeenCalledTimes(1);
    expect(dependencies.readSnapshot).not.toHaveBeenCalled();
  });
  it.each([false, true])("retains exact v2=%s bytes and hashes without generation/source lookup", async v2 => {
    const { row, dependencies } = fixture(v2), before = JSON.stringify(row);
    const result = await readVersionedFrozenGeoKb(input, dependencies);
    expect(result).toMatchObject({ kind: "ok", value: { payload: row.payload, questionSet: row.question_set, contentHash: row.content_hash, questionSetHash: row.question_set_hash } });
    expect(JSON.stringify(row)).toBe(before);
    expect(dependencies.readSnapshot).toHaveBeenCalledTimes(1);
  });
  it.each(["owner", "kb", "snapshot", "payload_hash", "question_hash", "schema", "question_schema"])("refuses %s mismatch", async field => {
    const { row, dependencies } = fixture();
    if (field === "owner") row.user_id = V2_KB_ID;
    if (field === "kb") row.kb_id = USER;
    if (field === "snapshot") row.id = USER;
    if (field === "payload_hash") row.content_hash = "a".repeat(64);
    if (field === "question_hash") row.question_set_hash = "a".repeat(64);
    if (field === "schema") row.schema_version = "marketing-geo-kb.v1";
    if (field === "question_schema") row.question_set = buildGeoQuestionSet(contextPayload());
    expect((await readVersionedFrozenGeoKb(input, dependencies)).kind).toBe("unavailable");
  });
});
