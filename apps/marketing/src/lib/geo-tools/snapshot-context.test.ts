import { describe, expect, it } from "vitest";
import { buildGeoSnapshotContext, parseGeoSnapshotContext } from "./snapshot-context.ts";
import { CONTEXT_KB_ID, CONTEXT_PROFILE, contextPayload, contextReceipt } from "./snapshot-context.test-fixtures.ts";

const input = () => ({ kbId: CONTEXT_KB_ID, targetHost: "example.com", payload: contextPayload(), profile: CONTEXT_PROFILE, receipt: null });

describe("immutable GEO snapshot context", () => {
  it("keeps manual source URLs as KB claims and skips unsupported role layers", () => {
    const { context, questionSet } = buildGeoSnapshotContext(input());
    expect(context.facts[0]).toMatchObject({ source: "kb", sourceUrl: "https://example.com/pricing", evidenceId: null });
    expect(context.roles[0]).toMatchObject({ source: "kb", queryCount: null });
    expect(context.skippedLayers).toEqual(["problem", "evaluation"]);
    expect(questionSet.questions.some((q) => q.layer === "problem" || q.layer === "evaluation")).toBe(false);
    expect(parseGeoSnapshotContext(context)).toEqual(context);
  });
  it("binds real matching GSC/crawl receipts and preserves exact Profile", () => {
    const { context } = buildGeoSnapshotContext({ ...input(), receipt: contextReceipt() });
    expect(context.profile?.reference).toEqual(CONTEXT_PROFILE.reference);
    expect(context.roles[0]).toMatchObject({ source: "gsc", evidenceId: "R1", queryCount: 2 });
    expect(context.facts[0]).toMatchObject({ source: "crawl", evidenceId: "F1", observedAt: "2026-08-31T00:00:00.000Z" });
    expect(context.competitors[0]).toMatchObject({ source: "crawl", aliases: ["Rival Analytics"] });
    expect(context.skippedLayers).toEqual([]);
  });
  it("downgrades edited facts and roles instead of borrowing their old provenance", () => {
    const payload = contextPayload();
    const result = buildGeoSnapshotContext({ ...input(), receipt: contextReceipt(), payload: { ...payload, roles: [{ ...payload.roles[0]!, label: "Manual persona" }], facts: [{ ...payload.facts[0]!, value: "$999" }] } });
    expect(result.context.roles[0]?.source).toBe("kb");
    expect(result.context.facts[0]?.source).toBe("kb");
    expect(result.context.skippedLayers).toEqual(["problem", "evaluation"]);
  });
  it("refuses an enrichment belonging to another asset or Profile", () => {
    expect(() => buildGeoSnapshotContext({ ...input(), receipt: contextReceipt("22222222-2222-4222-8222-222222222222") })).toThrow();
    expect(() => buildGeoSnapshotContext({ ...input(), profile: { ...CONTEXT_PROFILE, reference: { ...CONTEXT_PROFILE.reference, snapshotRevision: 2 } }, receipt: contextReceipt() })).toThrow();
  });
  it("changes the context hash when inherited Profile identity changes", () => {
    const a = buildGeoSnapshotContext(input());
    const b = buildGeoSnapshotContext({ ...input(), profile: { ...CONTEXT_PROFILE, reference: { ...CONTEXT_PROFILE.reference, snapshotRevision: 2 } } });
    expect(a.context.payloadHash).toBe(b.context.payloadHash);
    expect(a.context.contentHash).not.toBe(b.context.contentHash);
  });
  it("refuses mutated or extra persisted fields even when the shape looks plausible", () => {
    const { context } = buildGeoSnapshotContext(input());
    expect(() => parseGeoSnapshotContext({ ...context, targetHost: "other.example" })).toThrow();
    expect(() => parseGeoSnapshotContext({ ...context, token: "not-allowed" })).toThrow();
  });
});
