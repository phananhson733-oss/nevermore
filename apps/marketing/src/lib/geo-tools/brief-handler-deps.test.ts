import { expect, it } from "vitest";
import { listFrozenVersions } from "./brief-handler-deps.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";

it("keeps all immutable snapshots of one KB in the Brief selector", async () => {
  const result = await listFrozenVersions("owner", async () => ({ kind: "ok", value: [1, 2].map(revision => ({ host: "fixture.example", snapshot: { ...SHARED_FROZEN, snapshotId: `snapshot-${revision}`, revision } })) }));
  expect(result.kind).toBe("ok");
  if (result.kind === "ok") expect(result.value.map(item => item.snapshotId)).toEqual(["snapshot-1", "snapshot-2"]);
});
it("does not hide a failed frozen history read behind an empty no-frozen state", async () => {
  expect((await listFrozenVersions("owner", async () => ({ kind: "unavailable", reason: "failed" }))).kind).toBe("unavailable");
});

it("projects each archived snapshot's own role and prompt-set identity", async () => {
  const snapshots = [1, 2].map(revision => ({
    ...SHARED_FROZEN,
    snapshotId: `snapshot-${revision}`,
    revision,
    contentHash: String(revision).repeat(64),
    questionSetHash: String(revision + 2).repeat(64),
    payload: { ...SHARED_FROZEN.payload, roles: [{ ...SHARED_FROZEN.payload.roles[0]!, label: `Buyer at revision ${revision}`, segment: `Segment ${revision}` }] },
    questionSet: { ...SHARED_FROZEN.questionSet, registryVersion: `registry-${revision}` },
  }));
  const result = await listFrozenVersions("owner", async () => ({ kind: "ok", value: snapshots.map(snapshot => ({ host: "fixture.example", snapshot })) }));
  expect(result).toMatchObject({ kind: "ok", value: snapshots.map(snapshot => ({
    snapshotId: snapshot.snapshotId,
    contentHash: snapshot.contentHash,
    promptsetRef: { schema: snapshot.questionSet.schemaVersion, registryVersion: snapshot.questionSet.registryVersion, hash: snapshot.questionSetHash },
    questions: [{ roleId: "buyer", role: { id: "buyer", label: `Buyer at revision ${snapshot.revision}`, segment: `Segment ${snapshot.revision}` } }],
  })) });
});

it.each([null, "missing-role"])("keeps an unresolved frozen role %s explicitly null", async roleId => {
  const snapshot = { ...SHARED_FROZEN, questionSet: { ...SHARED_FROZEN.questionSet, questions: [{ ...SHARED_FROZEN.questionSet.questions[0]!, roleId }] } };
  const result = await listFrozenVersions("owner", async () => ({ kind: "ok", value: [{ host: "fixture.example", snapshot }] }));
  expect(result).toMatchObject({ kind: "ok", value: [{ questions: [{ roleId, role: null }] }] });
});

it("projects market, proper names and quality issues from each immutable history entry", async () => {
  const snapshot = {
    ...SHARED_FROZEN,
    payload: { ...SHARED_FROZEN.payload, categoryTerms: ["占星工具", "journaling"], aliases: ["Fixture Alias"], competitors: [{ domain: "rival.example", brandName: "Rival", aliases: ["Rival Alias"], confirmed: true }] },
    questionSet: { ...SHARED_FROZEN.questionSet, questions: [{ ...SHARED_FROZEN.questionSet.questions[0]!, text: "What are the top 占星工具 tools?", requiredEntities: ["占星工具", "journaling"] }] },
  };
  const result = await listFrozenVersions("owner", async () => ({ kind: "ok", value: [{ host: "fixture.example", snapshot }] }));
  expect(result).toMatchObject({ kind: "ok", value: [{ market: { country: "US", language: "en" }, properNames: ["Fixture", "Fixture Alias", "Rival", "Rival Alias"], questions: [{ qualityIssues: ["category_language_mismatch", "question_language_mismatch", "unrelated_required_entities"] }] }] });
  if (result.kind === "ok") expect(result.value[0]).not.toHaveProperty("evidenceSummary");
});
