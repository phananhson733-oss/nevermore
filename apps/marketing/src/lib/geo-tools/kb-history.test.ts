import { describe, expect, it } from "vitest";
import { GEO_HISTORY_SNAPSHOT_COLUMNS, listFrozenGeoKbVersions } from "./kb-history.ts";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "./kb-v2.test-fixtures.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";

const USER = "22222222-2222-4222-8222-222222222222";
const SNAPSHOT = "33333333-3333-4333-8333-333333333333";
const HOST = "example.com";

function snapshotRow() {
  const payload = completePayloadV2();
  const questionSet = questionSetV2();
  return {
    id: SNAPSHOT,
    kb_id: V2_KB_ID,
    user_id: USER,
    revision: 1,
    schema_version: "marketing-geo-kb.v2",
    content_hash: geoV2Digest(payload),
    question_set: questionSet,
    question_set_hash: geoV2Digest(questionSet),
    prepared_id: V2_CANDIDATE_ID,
    frozen_at: "2026-09-01T00:00:00.000Z",
    payload,
  } as Record<string, unknown>;
}

/**
 * What the database would actually return for this select: only the columns
 * that were asked for. Reading a full hand-written row instead is exactly how
 * the missing column went unnoticed.
 */
function asSelected(row: Record<string, unknown>, columns: string) {
  return Object.fromEntries(columns.split(",").map((column) => [column, row[column]]));
}

function dependencies(row: Record<string, unknown>) {
  return {
    listKnowledgeBases: async () => ({
      kind: "ok" as const,
      value: [{
        kbId: V2_KB_ID,
        host: HOST,
        origin: `https://${HOST}`,
        canonicalSiteKey: HOST,
        frozen: {
          snapshotId: SNAPSHOT,
          revision: 1,
          contentHash: row.content_hash as string,
          questionSetHash: row.question_set_hash as string,
          frozenAt: row.frozen_at as string,
        },
      }],
    }),
    readPage: async () => ({ kind: "ok" as const, data: [row] }),
  } as never;
}

describe("the frozen version list", () => {
  it("reads a v2 snapshot from exactly the columns it selects", async () => {
    // Regression: the page used its own column list without `prepared_id`,
    // which the frozen reader requires for every v2 row. Every account with a
    // v2 version therefore got an unavailable history, not a shorter one.
    const row = asSelected(snapshotRow(), GEO_HISTORY_SNAPSHOT_COLUMNS);
    const result = await listFrozenGeoKbVersions({ userId: USER }, dependencies(row));
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.host).toBe(HOST);
    expect(result.value[0]?.snapshot.snapshotId).toBe(SNAPSHOT);
  });

  it("still fails when that column is absent, so the test above is not vacuous", async () => {
    const { prepared_id: _dropped, ...withoutPreparedId } = asSelected(snapshotRow(), GEO_HISTORY_SNAPSHOT_COLUMNS);
    const result = await listFrozenGeoKbVersions({ userId: USER }, dependencies(withoutPreparedId));
    expect(result.kind).toBe("unavailable");
  });

  it("selects the same columns the frozen reader is given", () => {
    // Not a tautology: this pins the actual column names the query asks for,
    // and the two tests above prove the reader depends on them.
    for (const column of ["id", "kb_id", "user_id", "revision", "schema_version", "content_hash", "question_set", "question_set_hash", "prepared_id", "frozen_at", "payload"]) {
      expect(GEO_HISTORY_SNAPSHOT_COLUMNS.split(",")).toContain(column);
    }
  });
});
