import { describe, expect, it, vi } from "vitest";
import { createVisibilityReportV2 } from "./visibility-v2.ts";
import { encodeVisibilityWire } from "./visibility-wire.ts";
import { recordVisibilityRunV2, readVisibilityRunV2, type VisibilityStoreV2Dependencies } from "./visibility-store-v2.ts";

const USER = "11111111-1111-4111-8111-111111111111";
const report = () => createVisibilityReportV2({ runId: "11111111-1111-4111-8111-111111111112", kbId: "11111111-1111-4111-8111-111111111113", snapshotId: "11111111-1111-4111-8111-111111111114", snapshotRevision: 1, questionSetHash: "a".repeat(64), startedAt: "2026-08-31T00:00:00.000Z", finishedAt: "2026-08-31T00:01:00.000Z", engines: ["chatgpt"], samplesPerQuestion: 1, context: { officialName: "Acme", aliases: [], competitors: [], targetHost: "acme.test", marketCode: "US", language: "en" }, questions: [{ id: "q1", text: "Best tools?", layer: "discovery", mode: "retrieval", calibrated: false, roleId: null, requiredEntities: [], templateId: null }], samples: [{ engine: "chatgpt", questionId: "q1", sampleIndex: 1, slotId: "chatgpt:q1:1", status: "ok", mentioned: false, cited: false, citedUrls: [], citedDomains: [], competitorsMentioned: [], excerpt: null, answerExcerpt: "Offline observed answer.", answerExcerptTruncated: false, subtopics: [], subtopicsOmitted: 0, competitorPositions: [], citedDomainsOmitted: 0, citedUrlsOmitted: 0, excerptOmitted: false, listPosition: null, modelRequested: "gpt-5-2025-08-07", modelObserved: "gpt-5", providerTaskId: "offline-task", webSearchPerformed: true, observedAt: "2026-08-31T00:00:30.000Z", costUsd: 0.01 }] });
function dependencies(overrides: Partial<VisibilityStoreV2Dependencies> = {}): VisibilityStoreV2Dependencies { return { callRpc: vi.fn(async () => ({ kind: "ok" as const, data: [{ outcome: "recorded", run_id: report().manifest.runId, recorded_at: "2026-08-31T00:01:01.000Z" }] })), readRun: vi.fn(async () => ({ kind: "ok" as const, data: null })), readLatest: vi.fn(async () => ({ kind: "ok" as const, data: null })), ...overrides }; }
describe("V2 private append-only store", () => {
  it("writes the durable run id and same report bytes on every idempotent attempt", async () => {
    const deps = dependencies();
    const value = report();
    expect((await recordVisibilityRunV2({ userId: USER, report: value }, deps)).kind).toBe("ok");
    expect((await recordVisibilityRunV2({ userId: USER, report: value }, deps)).kind).toBe("ok");
    expect(deps.callRpc).toHaveBeenNthCalledWith(1, "marketing_geo_record_visibility_run_v2", { p_run_id: value.manifest.runId, p_user_id: USER, p_kb_id: value.manifest.kbId, p_snapshot_id: value.manifest.snapshotId, p_question_set_hash: value.manifest.questionSetHash, p_report: encodeVisibilityWire(value) });
    expect(vi.mocked(deps.callRpc).mock.calls[0]).toEqual(vi.mocked(deps.callRpc).mock.calls[1]);
  });
  it("refuses tampered derived metrics before touching the database", async () => {
    const value = report();
    const deps = dependencies();
    const result = await recordVisibilityRunV2({ userId: USER, report: { ...value, manifest: { ...value.manifest, answered: 99 } } }, deps);
    expect(result.kind).toBe("invalid");
    expect(deps.callRpc).not.toHaveBeenCalled();
  });
  it("requires the database row, owner, and report identity to agree", async () => {
    const value = report();
    const row = { id: value.manifest.runId, user_id: USER, kb_id: value.manifest.kbId, snapshot_id: value.manifest.snapshotId, question_set_hash: value.manifest.questionSetHash, report: value, created_at: "2026-08-31T00:01:01.000Z" };
    const deps = dependencies({ readRun: vi.fn(async () => ({ kind: "ok" as const, data: row })) });
    const read = await readVisibilityRunV2({ userId: USER, runId: value.manifest.runId }, deps);
    expect(read).toMatchObject({ kind: "ok", value: { report: value, provenance: "server_owned" } });
    expect(deps.readRun).toHaveBeenCalledWith({ userId: USER, runId: value.manifest.runId });
    expect((await readVisibilityRunV2({ userId: "22222222-2222-4222-8222-222222222222", runId: value.manifest.runId }, deps)).kind).toBe("unavailable");
    const wrong = dependencies({ readRun: async () => ({ kind: "ok", data: { ...row, snapshot_id: "22222222-2222-4222-8222-222222222222" } }) });
    expect((await readVisibilityRunV2({ userId: USER, runId: value.manifest.runId }, wrong)).kind).toBe("unavailable");
  });
});
