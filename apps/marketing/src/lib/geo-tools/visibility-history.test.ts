import { beforeEach, describe, expect, it, vi } from "vitest";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { encodeVisibilityWire } from "./visibility-wire.ts";
import { parseVisibilityHistoryList, parseVisibilityHistoryRead } from "./visibility-history-contract.ts";
import { DEFAULT_VISIBILITY_HISTORY_DEPENDENCIES, VISIBILITY_HISTORY_LIMIT, listVisibilityHistory, readVisibilityHistory, type VisibilityHistoryDependencies } from "./visibility-history.ts";

const db = vi.hoisted(() => {
  const calls: { method: string; args: readonly unknown[] }[] = [];
  const response = { data: [] as unknown, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "select", "eq", "order", "limit", "maybeSingle"]) builder[method] = (...args: readonly unknown[]) => { calls.push({ method, args }); return builder; };
  builder.then = (resolve: (value: typeof response) => unknown) => Promise.resolve(resolve(response));
  return { calls, response, builder };
});
vi.mock("../supabase/admin.ts", () => ({ createAdminSupabaseClient: () => db.builder }));
const USER = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const OLD_RUN = "11111111-1111-4111-8111-111111111115";
const value = visibilityReportFixtureV2();
const ok = (data: unknown) => ({ kind: "ok" as const, data });
function rowV2(overrides: Record<string, unknown> = {}) {
  return { id: value.manifest.runId, user_id: USER, kb_id: value.manifest.kbId, snapshot_id: value.manifest.snapshotId, question_set_hash: value.manifest.questionSetHash, created_at: "2026-08-31T00:01:01.000Z", manifest: value.manifest, context: value.context, report: encodeVisibilityWire(value), ...overrides };
}
function rowV1(overrides: Record<string, unknown> = {}) {
  const { manifest: v2 } = value;
  const manifest = { schemaVersion: "marketing-geo-visibility.v1", kbId: v2.kbId, snapshotId: v2.snapshotId, snapshotRevision: 1, questionSetHash: v2.questionSetHash, questionCount: 1, samplesPerQuestion: 1, marketCode: "US", model: "gpt-5-2025-08-07", surface: "dataforseo_chat_gpt_llm_responses_api", startedAt: "2026-08-30T00:00:00.000Z", finishedAt: "2026-08-30T00:01:00.000Z", calls: 1, answered: 1, successRatio: 1, costUsd: null, status: "ok" };
  const { questionId, text, layer, mode, prompted, answered, mentioned, citationEvaluable, cited } = value.questions[0]!;
  return { id: OLD_RUN, user_id: USER, kb_id: manifest.kbId, snapshot_id: manifest.snapshotId, question_set_hash: manifest.questionSetHash, samples_per_question: 1, created_at: "2026-08-30T00:01:01.000Z", manifest, metrics: value.metrics, per_question: [{ questionId, text, layer, mode, prompted, answered, mentioned, citationEvaluable, cited }], cited_domains: value.citedDomains, ...overrides };
}
function dependencies(overrides: Partial<VisibilityHistoryDependencies> = {}): VisibilityHistoryDependencies {
  return { listRuns: vi.fn(async () => ok([])), readRun: vi.fn(async () => ok(null)), ...overrides };
}
beforeEach(() => { db.calls.length = 0; db.response.data = []; });

describe("account visibility history", () => {
  it("merges V1 summaries and V2 metadata without answer text, preserving unknown cost/host", async () => {
    const deps = dependencies({ listRuns: vi.fn(async ({ version }) => ok(version === "v1" ? [rowV1()] : [rowV2()])) });
    const result = await listVisibilityHistory({ userId: USER }, deps);
    expect(result).toMatchObject({ kind: "ok", value: { hasMore: false, runs: [
      { runId: value.manifest.runId, host: "acme.test", evidenceAvailability: "recorded", engines: ["chatgpt"] },
      { runId: OLD_RUN, host: null, costUsd: null, evidenceAvailability: "summary_only", engines: ["chatgpt"] },
    ] } });
    expect(JSON.stringify(result)).not.toContain("Offline observed answer");
    expect(JSON.stringify(result)).not.toContain(USER);
    if (result.kind === "ok") expect(parseVisibilityHistoryList(result.value)).toEqual(result.value);
    expect(deps.listRuns).toHaveBeenCalledWith({ userId: USER, version: "v2", limit: VISIBILITY_HISTORY_LIMIT + 1 });
  });
  it("bounds each read and the combined latest history, with an explicit hasMore flag", async () => {
    const rows = Array.from({ length: VISIBILITY_HISTORY_LIMIT + 1 }, (_, i) => rowV1({ id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}` }));
    const result = await listVisibilityHistory({ userId: USER }, dependencies({ listRuns: async ({ version }) => ok(version === "v1" ? rows : []) }));
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") { expect(result.value.runs).toHaveLength(VISIBILITY_HISTORY_LIMIT); expect(result.value.hasMore).toBe(true); }
  });
  it("never inspects or exposes a foreign payload and fails a malformed list closed", async () => {
    const hostile = { user_id: FOREIGN, get manifest() { throw new Error("must not inspect foreign data"); } };
    expect(await listVisibilityHistory({ userId: USER }, dependencies({ listRuns: async () => ok([hostile]) }))).toMatchObject({ kind: "unavailable" });
    expect(await listVisibilityHistory({ userId: USER }, dependencies({ listRuns: async () => ok({}) }))).toMatchObject({ kind: "unavailable" });
  });
  it("refuses oversized pages, identity mismatch, and unavailable/missing metadata instead of inventing zero", async () => {
    for (const data of [Array(VISIBILITY_HISTORY_LIMIT + 2).fill(rowV2()), [rowV2({ snapshot_id: FOREIGN })], [rowV2({ manifest: { ...value.manifest, costUsd: undefined } })]]) {
      expect(await listVisibilityHistory({ userId: USER }, dependencies({ listRuns: async ({ version }) => ok(version === "v2" ? data : []) }))).toMatchObject({ kind: "unavailable" });
    }
  });
  it("returns the exact validated V2 report via the existing bounded wire", async () => {
    const deps = dependencies({ readRun: vi.fn(async ({ version }) => ok(version === "v2" ? rowV2() : null)) });
    expect(await readVisibilityHistory({ userId: USER, runId: value.manifest.runId }, deps)).toEqual({ kind: "ok", value: { status: "completed", evidenceAvailability: "recorded", report: encodeVisibilityWire(value) } });
  });
  it("returns V1 persisted counts as a summary without fabricating answers, calibration, unknowns, or comparisons", async () => {
    const result = await readVisibilityHistory({ userId: USER, runId: OLD_RUN }, dependencies({ readRun: async ({ version }) => ok(version === "v1" ? rowV1() : null) }));
    expect(result).toMatchObject({ kind: "ok", value: { status: "completed", evidenceAvailability: "summary_only", summary: { runId: OLD_RUN, manifest: { costUsd: null }, perQuestion: [{ answered: 1, mentioned: 0 }] } } });
    for (const field of ["samples", "citationUnknown", "calibrated", "comparison", "report"]) expect(JSON.stringify(result)).not.toContain(`"${field}":`);
    if (result.kind === "ok") expect(parseVisibilityHistoryRead(result.value)).toEqual(result.value);
  });
  it("preserves the database's sub-millisecond ordering across both history versions", async () => {
    const result = await listVisibilityHistory({ userId: USER }, dependencies({ listRuns: async ({ version }) => ok(version === "v1" ? [rowV1({ created_at: "2026-08-31T00:01:01.123400+00:00" })] : [rowV2({ created_at: "2026-08-31T00:01:01.123999+00:00" })]) }));
    expect(result).toMatchObject({ kind: "ok", value: { runs: [{ runId: value.manifest.runId }, { runId: OLD_RUN }] } });
  });
  it("answers a foreign and a missing run identically, before parsing report contents", async () => {
    const foreign = { id: value.manifest.runId, user_id: FOREIGN, get report() { throw new Error("secret"); } };
    expect(await readVisibilityHistory({ userId: USER, runId: value.manifest.runId }, dependencies({ readRun: async () => ok(foreign) }))).toEqual({ kind: "missing" });
    expect(await readVisibilityHistory({ userId: USER, runId: value.manifest.runId }, dependencies())).toEqual({ kind: "missing" });
  });
  it("rejects corrupted V2 metrics and V1 counts instead of exposing a misleading report", async () => {
    const badV2 = rowV2({ report: { ...value, manifest: { ...value.manifest, answered: 99 } } });
    expect(await readVisibilityHistory({ userId: USER, runId: value.manifest.runId }, dependencies({ readRun: async () => ok(badV2) }))).toMatchObject({ kind: "unavailable" });
    const old = rowV1();
    const badV1 = { ...old, per_question: [{ ...old.per_question[0], mentioned: 9 }] };
    expect(await readVisibilityHistory({ userId: USER, runId: OLD_RUN }, dependencies({ readRun: async ({ version }) => ok(version === "v1" ? badV1 : null) }))).toMatchObject({ kind: "unavailable" });
  });
  it("rejects invalid identities before any storage call and contains transport errors", async () => {
    const deps = dependencies();
    expect((await readVisibilityHistory({ userId: USER, runId: "not-a-run" }, deps)).kind).toBe("invalid");
    expect((await listVisibilityHistory({ userId: "unknown" }, deps)).kind).toBe("invalid");
    expect(deps.readRun).not.toHaveBeenCalled(); expect(deps.listRuns).not.toHaveBeenCalled();
    const result = await readVisibilityHistory({ userId: USER, runId: OLD_RUN }, dependencies({ readRun: async () => { throw new Error("PRIVATE_ERROR"); } }));
    expect(result).toMatchObject({ kind: "unavailable" }); expect(JSON.stringify(result)).not.toContain("PRIVATE_ERROR");
  });
  it("scopes the production adapter by owner and requests only bounded metadata in lists", async () => {
    await DEFAULT_VISIBILITY_HISTORY_DEPENDENCIES.listRuns({ userId: USER, version: "v2", limit: VISIBILITY_HISTORY_LIMIT + 1 });
    expect(db.calls).toContainEqual({ method: "eq", args: ["user_id", USER] });
    expect(db.calls).toContainEqual({ method: "limit", args: [VISIBILITY_HISTORY_LIMIT + 1] });
    expect(db.calls.find((call) => call.method === "select")?.args[0]).toBe("id,user_id,kb_id,snapshot_id,question_set_hash,created_at,manifest:report->manifest,context:report->context");
    db.calls.length = 0;
    await DEFAULT_VISIBILITY_HISTORY_DEPENDENCIES.readRun({ userId: USER, runId: OLD_RUN, version: "v1" });
    expect(db.calls).toContainEqual({ method: "eq", args: ["user_id", USER] });
    expect(db.calls).toContainEqual({ method: "eq", args: ["id", OLD_RUN] });
    expect(db.calls).toContainEqual({ method: "maybeSingle", args: [] });
  });
});
