import { describe, expect, it } from "vitest";
import { consumeGeoGapHandoff, writeGeoGapHandoff, GEO_GAP_HANDOFF_KEY } from "./gap-handoff.ts";
const NOW = Date.parse("2026-08-31T00:00:00.000Z");
const payload = { destination: "geo-brief" as const, runId: "11111111-1111-4111-8111-111111111112", kbId: "11111111-1111-4111-8111-111111111113", snapshotId: "11111111-1111-4111-8111-111111111114", questionId: "q01-retrieval.category_top", gapId: "gap-q01-retrieval.category_top", pageUrl: null, questionText: null };
function storage() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; }
describe("one-time gap handoff", () => {
  it("retains exact V2 semantic question identities through Brief navigation", () => {
    const store = storage();
    for (const questionId of ["semantic:discovery", "semantic:buyer/criterion", "s".repeat(128)]) {
      const next = { ...payload, questionId, gapId: `gap-${questionId}` };
      expect(writeGeoGapHandoff(store, next, NOW)).toBe(true);
      expect(consumeGeoGapHandoff(store, NOW + 1)).toMatchObject(next);
    }
    expect(writeGeoGapHandoff(store, { ...payload, questionId: "s".repeat(129), gapId: `gap-${"s".repeat(129)}` }, NOW)).toBe(false);
    expect(writeGeoGapHandoff(store, { ...payload, questionId: "semantic:q", gapId: "gap-other" }, NOW)).toBe(false);
  });
  it("carries selectors without metrics or identity in URL and consumes exactly once", () => {
    const store = storage();
    expect(writeGeoGapHandoff(store, payload, NOW)).toBe(true);
    expect(consumeGeoGapHandoff(store, NOW + 1)).toMatchObject({ ...payload, schemaVersion: "marketing-geo-gap-handoff.v1" });
    expect(consumeGeoGapHandoff(store, NOW + 2)).toBeNull();
  });
  it("refuses extra authority fields, stale envelopes and another destination", () => {
    const store = storage();
    writeGeoGapHandoff(store, payload, NOW);
    const value = JSON.parse(store.getItem(GEO_GAP_HANDOFF_KEY)!);
    store.setItem(GEO_GAP_HANDOFF_KEY, JSON.stringify({ ...value, observedCount: 999 }));
    expect(consumeGeoGapHandoff(store, NOW)).toBeNull();
    writeGeoGapHandoff(store, payload, NOW);
    expect(consumeGeoGapHandoff(store, NOW + 20 * 60_000)).toBeNull();
    writeGeoGapHandoff(store, payload, NOW);
    expect(consumeGeoGapHandoff(store, NOW + 20 * 60_000 + 1)).toBeNull();
    writeGeoGapHandoff(store, payload, NOW);
    expect(consumeGeoGapHandoff(store, NOW, "page-citability-check")).toBeNull();
    expect(consumeGeoGapHandoff(store, NOW)).not.toBeNull();
  });
  it("only admits bounded public URL/question prefill for the anonymous T2 destination", () => {
    const store = storage();
    const t2 = { ...payload, destination: "page-citability-check" as const, pageUrl: "https://acme.test/guide", questionText: "How do reminders work?" };
    expect(writeGeoGapHandoff(store, t2, NOW)).toBe(true);
    expect(consumeGeoGapHandoff(store, NOW, "page-citability-check")).toMatchObject(t2);
    expect(writeGeoGapHandoff(store, { ...t2, pageUrl: "https://user:pass@acme.test/" }, NOW)).toBe(false);
    expect(writeGeoGapHandoff(store, { ...payload, pageUrl: "https://acme.test/" }, NOW)).toBe(false);
  });
});
