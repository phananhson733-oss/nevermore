import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyGeoKbPayload } from "./kb-contract.ts";
import { buildGeoQuestionSet, geoQuestionSetDigest } from "./kb-questions.ts";
import { seal } from "../auth/sealed-cookie.ts";
import { createGeoProviderClient } from "../agents/geo-provider.ts";
import { completePayloadV2, questionSetV2, V2_KB_ID, V2_CANDIDATE_ID } from "./kb-v2.test-fixtures.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";

const mocks = vi.hoisted(() => ({ knowledge: vi.fn(), recordVisibilityRunV2: vi.fn(), readPreviousVisibilityRunV2: vi.fn() }));
vi.mock("./kb-complete-read.ts", () => ({ readCompleteGeoKnowledgeBase: mocks.knowledge }));
vi.mock("./visibility-store-v2.ts", () => ({ recordVisibilityRunV2: mocks.recordVisibilityRunV2, readPreviousVisibilityRunV2: mocks.readPreviousVisibilityRunV2 }));
import { visibilityPrepareStep, visibilitySampleStep, visibilityAssembleStep, visibilityPersistStep } from "./visibility-workflow-steps.ts";
import { observeVisibilityV2 } from "./visibility-sampling-v2.ts";
import { parseVisibilityReportV2 } from "./visibility-export.ts";

afterEach(() => vi.unstubAllEnvs());
describe("versioned visibility workflow", () => {
  it("uses frozen words in all engine slots then produces and durably records one V2 report", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "07".repeat(32));
    const payload = { ...emptyGeoKbPayload("https://www.acme.test"), officialName: "Acme", categoryTerms: ["analytics"], competitors: [{ domain: "www.rival.test", brandName: "Rival", confirmed: true }] };
    const questionSet = buildGeoQuestionSet(payload);
    mocks.knowledge.mockResolvedValue({ kind: "ok", value: { snapshot: { kbId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", revision: 1, payload, questionSet, questionSetHash: geoQuestionSetDigest(questionSet) }, context: { kbId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", targetHost: "acme.test", contentHash: "b".repeat(64), questionSetHash: geoQuestionSetDigest(questionSet), profile: { coreFeatures: ["Invoice reminder"] } } } });
    mocks.readPreviousVisibilityRunV2.mockResolvedValue({ kind: "missing" });
    mocks.recordVisibilityRunV2.mockResolvedValue({ kind: "ok", value: { runId: "3f2504e0-4f89-41d3-9a0c-0305e82c3300" } });
    const input = { inputToken: seal("gg_geo_visibility_input", { sub: "3f2504e0-4f89-41d3-9a0c-0305e82c3399", kbId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", revision: 1, samplesPerQuestion: 3, engines: ["chatgpt", "perplexity"], recordRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3300", startedAt: new Date().toISOString() }, 3600) };
    const prepared = await visibilityPrepareStep(input);
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") throw new Error("not prepared");
    expect(prepared.plan).toHaveLength(questionSet.questions.length * 3 * 2);
    expect(prepared.context).toMatchObject({ targetHost: "acme.test", language: "en" });
    expect(prepared.context.competitors[0]?.domain).toBe("rival.test");
    expect(mocks.knowledge).toHaveBeenCalledWith({ userId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399", kbId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", snapshotId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302" });
    expect(prepared.priorityHints).toMatchObject({ contextHash: "b".repeat(64), coreFeatures: ["Invoice reminder"] });
    const requests: { url: string; body: unknown }[] = [];
    const provider = createGeoProviderClient({ login: "offline", password: "offline", fetchImpl: async (url, init) => {
      const body: unknown = JSON.parse(String(init?.body));
      requests.push({ url, body });
      return Response.json({ status_code: 20000, tasks: [{ id: `task-${requests.length}`, status_code: 20000, cost: 0.01, result: [{ model_name: url.includes("perplexity") ? "sonar" : "gpt-5", datetime: "2026-08-31 00:01:00 +00:00", web_search: true, items: [{ type: "message", sections: [{ text: "1. **Acme** — analytics\n2. **Rival** — tools", annotations: [{ title: "Acme", url: "https://acme.test/", start_index: null, end_index: null }] }] }] }] }] });
    } });
    const samples = [];
    for (const item of prepared.plan) {
      if (item.engine === undefined || item.slotId === undefined) throw new Error("unversioned slot");
      samples.push(await observeVisibilityV2({ ...prepared.context, language: prepared.context.language! }, { ...item, engine: item.engine, slotId: item.slotId }, { provider }));
    }
    expect(requests).toHaveLength(prepared.plan.length);
    expect(requests[0]?.body).toEqual([expect.objectContaining({ user_prompt: questionSet.questions[0]?.text, web_search: true })]);
    expect(requests.at(-1)?.body).toEqual([expect.objectContaining({ model_name: "sonar" })]);
    const output = await visibilityAssembleStep(input, prepared, samples);
    expect(output.kind).toBe("completed");
    if (output.kind !== "completed") throw new Error("not complete");
    expect(output.report.manifest).toMatchObject({ schemaVersion: "marketing-geo-visibility.v2", calls: prepared.plan.length, answered: prepared.plan.length, costUsd: prepared.plan.length * 0.01 });
    expect(parseVisibilityReportV2(output.report)).not.toBeNull();
    expect(mocks.recordVisibilityRunV2).not.toHaveBeenCalled();
    await visibilityPersistStep(input, output);
    expect(mocks.recordVisibilityRunV2).toHaveBeenCalledWith({ userId: "3f2504e0-4f89-41d3-9a0c-0305e82c3399", report: output.report });
    expect(visibilitySampleStep.maxRetries).toBe(0);
  });
  it.each([1, 2])("prepares a complete V2 snapshot only at its sealed revision (requested %s)", async revision => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "07".repeat(32));
    const payload = completePayloadV2();
    const original = questionSetV2(), questionSet = { ...original, questions: [{ ...original.questions[0]!, id: "semantic:finance/invoices" }] };
    const context = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload, questionSet, sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Late invoices" }], sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
    const snapshot = { kbId: V2_KB_ID, snapshotId: V2_CANDIDATE_ID, revision: 2, frozenAt: "2026-08-31T00:00:00.000Z", contentHash: geoV2Digest(payload), questionSetHash: geoV2Digest(questionSet), questionCount: 1, payload, questionSet };
    mocks.knowledge.mockResolvedValue({ kind: "ok", value: { snapshot, context, completeness: "complete" } });
    const input = { inputToken: seal("gg_geo_visibility_input", { sub: "3f2504e0-4f89-41d3-9a0c-0305e82c3399", kbId: V2_KB_ID, snapshotId: V2_CANDIDATE_ID, revision, samplesPerQuestion: 3, engines: ["chatgpt", "perplexity"], recordRunId: "3f2504e0-4f89-41d3-9a0c-0305e82c3300", startedAt: "2026-08-31T00:00:00.000Z" }, 3600) };
    const prepared = await visibilityPrepareStep(input);
    if (revision !== 2) expect(prepared).toEqual({ status: "failed", code: "not_found" });
    else {
      expect(prepared.status).toBe("ready");
      if (prepared.status !== "ready") throw new Error("not prepared");
      expect(prepared.plan).toHaveLength(6); expect(prepared.questionSetHash).toBe(snapshot.questionSetHash);
      expect(prepared.questions[0]?.id).toBe("semantic:finance/invoices"); expect(prepared.questions[0]).not.toHaveProperty("provenance");
      expect(snapshot.questionSet.questions[0]?.provenance.kind).toBe("semantic");
    }
  });
});
