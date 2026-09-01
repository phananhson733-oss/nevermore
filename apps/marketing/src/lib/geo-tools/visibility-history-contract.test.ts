import { describe, expect, it } from "vitest";
import { parseVisibilityHistoryList, parseVisibilityHistoryRead } from "./visibility-history-contract.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import { encodeVisibilityWire } from "./visibility-wire.ts";

const report = visibilityReportFixtureV2();
const entry = { runId: report.manifest.runId, schemaVersion: "marketing-geo-visibility.v2", kbId: report.manifest.kbId, snapshotId: report.manifest.snapshotId, snapshotRevision: 1, host: "acme.test", finishedAt: report.manifest.finishedAt, createdAt: report.manifest.finishedAt, status: "ok", questionCount: 1, samplesPerQuestion: 1, engines: ["chatgpt"], costUsd: null, evidenceAvailability: "recorded" };
describe("client history boundary", () => {
  it("reads empty or bounded lists without changing unknown host or cost to zero", () => {
    expect(parseVisibilityHistoryList({ runs: [], hasMore: false })).toEqual({ runs: [], hasMore: false });
    const list = { runs: [entry, { ...entry, runId: "22222222-2222-4222-8222-222222222222", schemaVersion: "marketing-geo-visibility.v1", host: null, evidenceAvailability: "summary_only" }], hasMore: false };
    expect(parseVisibilityHistoryList(list)).toEqual(list);
  });
  it("rejects missing fields, duplicate IDs, oversized lists, and unknown engines", () => {
    for (const value of [{ runs: [] }, { runs: [entry, entry], hasMore: false }, { runs: Array(51).fill(entry), hasMore: true }, { runs: [{ ...entry, engines: ["future_engine"] }], hasMore: false }]) expect(parseVisibilityHistoryList(value)).toBeNull();
  });
  it("validates V2 report evidence through the existing wire decoder", () => {
    const value = { status: "completed", evidenceAvailability: "recorded", report: encodeVisibilityWire(report) };
    expect(parseVisibilityHistoryRead(value)).toEqual(value);
    expect(parseVisibilityHistoryRead({ ...value, report: { ...value.report, manifest: { ...report.manifest, answered: 99 } } })).toBeNull();
    expect(parseVisibilityHistoryRead({ ...value, evidenceAvailability: "summary_only" })).toBeNull();
  });
  it("preserves explicit V1 summary fields and refuses missing fields instead of reconstructing defaults", () => {
    const m = report.manifest;
    const question = report.questions[0]!;
    const summary = { runId: entry.runId, kbId: m.kbId, snapshotId: m.snapshotId, questionSetHash: m.questionSetHash, samplesPerQuestion: 1, createdAt: m.finishedAt,
      manifest: { schemaVersion: "marketing-geo-visibility.v1", kbId: m.kbId, snapshotId: m.snapshotId, snapshotRevision: 1, questionSetHash: m.questionSetHash, questionCount: 1, samplesPerQuestion: 1, marketCode: "US", model: "gpt-5", surface: "dataforseo_chat_gpt_llm_responses_api", startedAt: m.startedAt, finishedAt: m.finishedAt, calls: 1, answered: 1, successRatio: 1, costUsd: null, status: "ok" },
      metrics: { unpromptedMention: report.metrics.unpromptedMention, promptedMention: report.metrics.promptedMention, citation: report.metrics.citation, questionsMentioned: report.metrics.questionsMentioned, questionsCited: report.metrics.questionsCited, questionsAsked: 1, questionsAnswered: 1, byLayer: report.metrics.byLayer.map(({ layer, mention, citation }) => ({ layer, mention, citation })) },
      perQuestion: [{ questionId: question.questionId, text: question.text, layer: question.layer, mode: question.mode, prompted: false, answered: 1, mentioned: 0, citationEvaluable: 1, cited: 0 }], citedDomains: [],
    };
    const value = { status: "completed", evidenceAvailability: "summary_only", summary };
    expect(parseVisibilityHistoryRead(value)).toEqual(value);
    expect(parseVisibilityHistoryRead({ ...value, summary: { ...summary, perQuestion: [{ ...summary.perQuestion[0], answered: undefined }] } })).toBeNull();
    expect(parseVisibilityHistoryRead({ ...value, summary: { ...summary, manifest: { ...summary.manifest, kbId: "22222222-2222-4222-8222-222222222222" } } })).toBeNull();
  });
});
