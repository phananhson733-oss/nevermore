import { describe, expect, it, vi } from "vitest";
import { readVersionedFrozenGeoKb, readVersionedGeoKnowledgeBase, listVersionedGeoKnowledgeBases } from "./kb-versioned-read.ts";
import { listFrozenGeoKbVersions } from "./kb-history.ts";
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "./kb-v2.test-fixtures.ts";
import { completePayloadV3, V3_KB_ID } from "./kb-v3.test-fixtures.ts";
import { GEO_KB_SCHEMA_VERSION_V3 } from "./kb-v3-contract.ts";
import { contextPayload } from "./snapshot-context.test-fixtures.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import { GEO_KB_SNAPSHOT_COLUMNS, type GeoKbStoreDependencies } from "./kb-store.ts";
const USER = "11111111-1111-4111-8111-111111111111";
const input = { userId: USER, kbId: V2_KB_ID, snapshotId: V2_CANDIDATE_ID };
function fixture(v2 = true) {
  const payload = v2 ? completePayloadV2() : contextPayload(), questionSet = v2 ? questionSetV2() : buildGeoQuestionSet(contextPayload());
  const row = { id: V2_CANDIDATE_ID, kb_id: V2_KB_ID, user_id: USER, revision: 1, schema_version: payload.schemaVersion, ...(v2 ? { prepared_id: V2_CANDIDATE_ID } : {}), payload, content_hash: v2 ? geoV2Digest(payload) : geoKbDigest(payload as unknown as GeoKbValue), question_set: questionSet, question_set_hash: v2 ? geoV2Digest(questionSet) : geoQuestionSetDigest(questionSet as ReturnType<typeof buildGeoQuestionSet>), frozen_at: "2026-08-31T00:00:00.000Z" };
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
  it.each([false, true])("reads a v2 draft beside a v2=%s frozen version using only the columns the bundle asks for", async v2 => {
    // Production shape: the draft upgraded to v2 while the current frozen
    // version stayed v1. The versioned reader hands the bundle's snapshot row
    // straight to the frozen reader, so a row projected through the bundle's
    // own column list is the only honest fixture -- a hand-written row that
    // carries more columns than the query selects proves nothing.
    const current = fixture(), frozen = fixture(v2);
    const projected = Object.fromEntries(GEO_KB_SNAPSHOT_COLUMNS.split(",")
      .map(column => column.trim())
      .map(column => [column, (frozen.row as unknown as Record<string, unknown>)[column]]));
    const bundle = { knowledgeBases: [{ id: V2_KB_ID, user_id: USER, origin: "https://example.com", host: "example.com", canonical_site_key: "example.com", current_frozen_snapshot_id: frozen.row.id, created_at: frozen.row.frozen_at, updated_at: frozen.row.frozen_at }],
      drafts: [{ kb_id: V2_KB_ID, user_id: USER, schema_version: "marketing-geo-kb.v2", draft_version: 4, payload: current.row.payload, content_hash: current.row.content_hash, updated_at: frozen.row.frozen_at }],
      snapshots: [projected] };

    const result = await readVersionedGeoKnowledgeBase({ userId: USER, kbId: V2_KB_ID }, { ...current.dependencies, readDetails: async () => ({ kind: "ok" as const, data: bundle }) });

    expect(result).toMatchObject({ kind: "ok", value: { draft: { draftVersion: 4 }, frozen: { snapshotId: frozen.row.id, revision: 1 } } });
  });
  it.each([false, true])("retains exact v2=%s bytes and hashes without generation/source lookup", async v2 => {
    const { row, dependencies } = fixture(v2), before = JSON.stringify(row);
    const result = await readVersionedFrozenGeoKb(input, dependencies);
    expect(result).toMatchObject({ kind: "ok", value: { payload: row.payload, questionSet: row.question_set, contentHash: row.content_hash, questionSetHash: row.question_set_hash } });
    if (result.kind === "ok") expect(result.value.preparedId).toBe(v2 ? V2_CANDIDATE_ID : null);
    expect(JSON.stringify(row)).toBe(before);
    expect(dependencies.readSnapshot).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "null", "invalid"] as const)("requires a strict prepared_id on every V2 snapshot row (%s)", async issue => {
    const { row, dependencies } = fixture();
    if (issue === "missing") delete (row as Partial<typeof row>).prepared_id;
    if (issue === "null") row.prepared_id = null as never;
    if (issue === "invalid") row.prepared_id = "not-a-uuid";
    expect((await readVersionedFrozenGeoKb(input, dependencies)).kind).toBe("unavailable");
  });
  it("projects the exact prepared snapshot identity from the selected store columns", async () => {
    const { row, dependencies } = fixture();
    expect(GEO_KB_SNAPSHOT_COLUMNS.split(",").map(value => value.trim())).toContain("prepared_id");
    const result = await readVersionedFrozenGeoKb(input, dependencies);
    expect(result).toMatchObject({ kind: "ok", value: { preparedId: row.prepared_id } });
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

const V3_SNAPSHOT = "33333333-3333-8333-8333-333333333331";
const v3Input = { userId: USER, kbId: V3_KB_ID, snapshotId: V3_SNAPSHOT };

function v3Fixture(withQuestions = true) {
  const payload = completePayloadV3(), questionSet = withQuestions ? questionSetV2() : null;
  const row = { id: V3_SNAPSHOT, kb_id: V3_KB_ID, user_id: USER, revision: 1, schema_version: GEO_KB_SCHEMA_VERSION_V3,
    prepared_id: V2_CANDIDATE_ID, payload, content_hash: geoV2Digest(payload), question_set: questionSet,
    question_set_hash: questionSet === null ? null : geoV2Digest(questionSet), frozen_at: "2026-09-03T00:00:00.000Z" };
  const dependencies: GeoKbStoreDependencies = { readList: async () => { throw new Error("No list/source read"); },
    readDetails: async () => { throw new Error("No current draft/Profile read"); }, callRpc: async () => { throw new Error("No writes"); },
    readSnapshot: vi.fn(async () => ({ kind: "ok" as const, data: row })) };
  return { payload, questionSet, row, dependencies };
}

describe("version-aware exact frozen read of a v3 version", () => {
  it("reads a v3 version and its frozen question set without a legacy projection", async () => {
    const { row, payload, questionSet, dependencies } = v3Fixture();

    const result = await readVersionedFrozenGeoKb(v3Input, dependencies);

    expect(result).toMatchObject({ kind: "ok", value: { payload, questionSet, contentHash: row.content_hash,
      questionSetHash: row.question_set_hash, questionCount: questionSet!.questions.length, preparedId: V2_CANDIDATE_ID } });
  });

  it("reports a version published without questions as having no count, not a count of zero", async () => {
    const { dependencies } = v3Fixture(false);

    const result = await readVersionedFrozenGeoKb(v3Input, dependencies);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("Expected a readable version");
    expect(result.value.questionSet).toBeNull();
    expect(result.value.questionSetHash).toBeNull();
    // "This version asks nothing" is not "this version asks zero questions".
    expect(result.value.questionCount).toBeNull();
    expect(result.value.questionCount).not.toBe(0);
  });

  it.each(["hash_without_set", "set_without_hash", "payload_hash", "question_hash", "market", "missing_column"])("refuses a v3 row with %s", async issue => {
    const { row, dependencies } = v3Fixture(issue === "hash_without_set" ? false : true);
    if (issue === "hash_without_set") row.question_set_hash = "a".repeat(64);
    if (issue === "set_without_hash") row.question_set_hash = null;
    if (issue === "payload_hash") row.content_hash = "a".repeat(64);
    if (issue === "question_hash") row.question_set_hash = "b".repeat(64);
    // Hash-consistent on purpose: this must fail on the market check, not on the digest.
    if (issue === "market") { const other = { ...questionSetV2(), country: "GB" }; row.question_set = other; row.question_set_hash = geoV2Digest(other); }
    if (issue === "missing_column") delete (row as Partial<typeof row>).question_set;

    expect((await readVersionedFrozenGeoKb(v3Input, dependencies)).kind).toBe("unavailable");
  });

  it("lists a v3 head whose current version has no question set", async () => {
    const { row } = v3Fixture(false);
    const bundle = { knowledgeBases: [{ id: V3_KB_ID, user_id: USER, origin: "https://example.com", host: "example.com", canonical_site_key: "example.com", current_frozen_snapshot_id: row.id, created_at: row.frozen_at, updated_at: row.frozen_at }],
      drafts: [{ kb_id: V3_KB_ID, user_id: USER, schema_version: GEO_KB_SCHEMA_VERSION_V3, draft_version: 2, content_hash: row.content_hash, updated_at: row.frozen_at }],
      snapshots: [row] };
    const dependencies = { ...v3Fixture().dependencies, readList: async () => ({ kind: "ok" as const, data: bundle }) };

    const listed = await listVersionedGeoKnowledgeBases({ userId: USER }, dependencies);

    expect(listed).toMatchObject({ kind: "ok", value: [{ kbId: V3_KB_ID, frozen: { snapshotId: row.id, questionSetHash: null } }] });
  });

  it("still refuses a v1/v2 snapshot row that has lost its question-set hash", async () => {
    const { row } = fixture();
    const nulled = { ...row, question_set_hash: null };
    const bundle = { knowledgeBases: [{ id: V2_KB_ID, user_id: USER, origin: "https://example.com", host: "example.com", canonical_site_key: "example.com", current_frozen_snapshot_id: row.id, created_at: row.frozen_at, updated_at: row.frozen_at }],
      drafts: [{ kb_id: V2_KB_ID, user_id: USER, schema_version: "marketing-geo-kb.v2", draft_version: 2, content_hash: row.content_hash, updated_at: row.frozen_at }],
      snapshots: [nulled] };

    expect((await listVersionedGeoKnowledgeBases({ userId: USER }, { ...fixture().dependencies, readList: async () => ({ kind: "ok", data: bundle }) })).kind).toBe("unavailable");
  });
});
