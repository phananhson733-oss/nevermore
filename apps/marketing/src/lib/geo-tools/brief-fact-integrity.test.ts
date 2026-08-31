import { describe, expect, it } from "vitest";
import { sharedGeoBriefBasis } from "./brief-shared.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import type { GeoSnapshotContext } from "./snapshot-context.ts";

function context(): GeoSnapshotContext {
  return {
    schemaVersion: "marketing-geo-snapshot-context.v1", kbId: SHARED_FROZEN.kbId,
    targetHost: "fixture.example", payloadHash: SHARED_FROZEN.contentHash,
    questionSetHash: SHARED_FROZEN.questionSetHash, contentHash: "c".repeat(64),
    enrichment: null, profile: null, roles: [], competitors: [], skippedLayers: [],
    facts: SHARED_FROZEN.payload.facts.map(fact => ({
      key: fact.key, value: fact.value || null, reason: fact.reason, source: "kb",
      sourceUrl: fact.sourceUrl || null, observedAt: fact.observedAt || null, evidenceId: null,
    })),
  };
}
function basis(value: GeoSnapshotContext | null) {
  return sharedGeoBriefBasis({ frozen: SHARED_FROZEN, context: value, questionId: "q1", questionText: "",
    runEvidence: null, runId: "fact-integrity-test", now: "2026-08-31T00:00:00Z" });
}
describe("exact frozen fact/context integrity", () => {
  it("preserves every frozen fact and explicit null when the context agrees", () => {
    expect(basis(context()).fact_table).toEqual(basis(null).fact_table);
  });
  it("does not let an empty context silently erase frozen facts", () => {
    expect(() => basis({ ...context(), facts: [] })).toThrow("snapshot_fact_mismatch");
  });
  it("rejects changed context values and source URLs instead of using a fallback", () => {
    for (const change of [{ value: "Unsupported claim" }, { sourceUrl: "https://another.example/pricing" }]) {
      const value = context();
      value.facts = [{ ...value.facts[0]!, ...change }, ...value.facts.slice(1)];
      expect(() => basis(value)).toThrow("snapshot_fact_mismatch");
    }
  });
  it("does not relabel a knowledge-base reference timestamp", () => {
    const value = context();
    value.facts = [{ ...value.facts[0]!, observedAt: "2026-08-31T12:00:00Z" }, ...value.facts.slice(1)];
    expect(() => basis(value)).toThrow("snapshot_fact_mismatch");
  });
});
