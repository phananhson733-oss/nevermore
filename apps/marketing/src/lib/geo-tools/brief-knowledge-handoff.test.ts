import { describe, expect, it } from "vitest";
import { consumeGeoBriefReturn, consumeGeoKnowledgeRepair, GEO_BRIEF_RETURN_KEY, GEO_KNOWLEDGE_REPAIR_KEY, writeGeoBriefReturn, writeGeoKnowledgeRepair } from "./brief-knowledge-handoff.ts";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const selection = { kbId: "11111111-1111-4111-8111-111111111111", snapshotId: "22222222-2222-4222-8222-222222222222", questionId: "q01-category" };
describe("knowledge repair navigation", () => {
  it("carries only the selected version and repair intent and consumes it once", () => {
    const store = storage();
    expect(writeGeoKnowledgeRepair(store, { ...selection, reason: "question" }, 1_000)).toBe(true);
    expect(consumeGeoKnowledgeRepair(store, 2_000)).toEqual({ ...selection, reason: "question", manualQuestion: null });
    expect(consumeGeoKnowledgeRepair(store, 2_000)).toBeNull();
  });
  it("returns the exact new snapshot without old visibility evidence", () => {
    const store = storage(); const next = { ...selection, snapshotId: "33333333-3333-4333-8333-333333333333" };
    expect(writeGeoBriefReturn(store, next, 1_000)).toBe(true);
    expect(consumeGeoKnowledgeRepair(store, 2_000)).toBeNull();
    expect(consumeGeoBriefReturn(store, 2_000)).toEqual({ ...next, manualQuestion: null });
    expect(consumeGeoBriefReturn(store, 2_000)).toBeNull();
  });
  it("preserves a manually typed question without putting its text in a URL", () => {
    const store = storage(); const manual = { ...selection, questionId: null, manualQuestion: "How can readers compare astrology tools?" };
    expect(writeGeoKnowledgeRepair(store, { ...manual, reason: "facts" }, 1_000)).toBe(true);
    const repair = consumeGeoKnowledgeRepair(store, 2_000)!;
    expect(writeGeoBriefReturn(store, repair, 2_000)).toBe(true);
    expect(consumeGeoBriefReturn(store, 3_000)).toEqual(manual);
  });
  it.each(["broken JSON", JSON.stringify({ ...selection, destination: "https://evil.example" })])("rejects malformed records with explicit recovery instead of a different editor", raw => {
    const store = storage(); store.setItem(GEO_KNOWLEDGE_REPAIR_KEY, raw);
    expect(() => consumeGeoKnowledgeRepair(store, 2_000)).toThrow();
    expect(store.getItem(GEO_KNOWLEDGE_REPAIR_KEY)).toBeNull();
  });
  it("rejects expired returns and unexpected fields", () => {
    const store = storage(); writeGeoBriefReturn(store, selection, 1_000);
    expect(() => consumeGeoBriefReturn(store, 3_601_000)).toThrow();
    writeGeoBriefReturn(store, selection, 1_000);
    store.setItem(GEO_BRIEF_RETURN_KEY, JSON.stringify({ ...JSON.parse(store.getItem(GEO_BRIEF_RETURN_KEY)!), runId: "untrusted" }));
    expect(() => consumeGeoBriefReturn(store, 2_000)).toThrow();
  });
  it("does not accept a mismatched manual/frozen question or arbitrary identifier", () => {
    const store = storage();
    expect(writeGeoBriefReturn(store, { ...selection, manualQuestion: "different question" })).toBe(false);
    expect(writeGeoBriefReturn(store, { ...selection, kbId: "https://evil.example" })).toBe(false);
  });
  it("reports blocked storage without permitting navigation", () => {
    const store = { ...storage(), setItem: () => { throw new Error("blocked"); } };
    expect(writeGeoBriefReturn(store, selection)).toBe(false);
  });
});
