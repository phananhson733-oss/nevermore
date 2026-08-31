// Synthetic offline fixture; never a default or production fallback.
import { GEO_KB_SCHEMA_VERSION } from "./kb-contract.ts";
import type { GeoKbFrozenSnapshot } from "./kb-store.ts";
export const SHARED_FROZEN: GeoKbFrozenSnapshot = {
  kbId: "fixture-kb", snapshotId: "fixture-snapshot", revision: 1, contentHash: "a".repeat(64), questionSetHash: "b".repeat(64), frozenAt: "2026-08-31T00:00:00.000Z", questionCount: 1,
  payload: { schemaVersion: GEO_KB_SCHEMA_VERSION, targetUrl: "https://fixture.example", officialName: "Fixture", aliases: ["Fixture"], categoryTerms: ["tool"], market: { country: "US", language: "en" }, roles: [{ id: "buyer", label: "Buyer", segment: "small team", painPoints: [], decisionCriteria: ["State the supported scope"], vocabulary: [] }], competitors: [], facts: [{ key: "Seats", value: "Three seats", reason: "", sourceUrl: "https://fixture.example/pricing", observedAt: "2026-08-30T00:00:00Z" }, { key: "Price", value: "", reason: "notPublished", sourceUrl: "", observedAt: "" }], importedFrom: null },
  questionSet: { schemaVersion: "marketing-geo-question-set.v1", registryVersion: "fixture", country: "US", language: "en", questions: [{ id: "q1", text: "Which fixture tool is suitable?", layer: "comparison", mode: "retrieval", roleId: "buyer", requiredEntities: ["Fixture"], templateId: null, calibrated: false }] },
};
