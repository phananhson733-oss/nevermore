import { describe, expect, it } from "vitest";
import { sharedGeoBriefBasis } from "./brief-shared.ts";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import type { GeoKbValue } from "./kb-contract.ts";
import { geoKbDigest } from "./kb-digest.ts";
import { geoQuestionSetDigest } from "./kb-questions.ts";
import type { GeoKbFrozenSnapshot } from "./kb-store.ts";
import type { GeoSnapshotContext } from "./snapshot-context.ts";

const LEGACY_REGISTRY = "2026-08-17/13/question-entities-v2";
const OVERRIDE_REGISTRY = `${LEGACY_REGISTRY}/profile-fact-overrides-v1`;

function frozenWithFact(key: string, value: string, registryVersion = OVERRIDE_REGISTRY): GeoKbFrozenSnapshot {
  const payload = { ...SHARED_FROZEN.payload,
    facts: [{ ...SHARED_FROZEN.payload.facts[0]!, key, value }, ...SHARED_FROZEN.payload.facts.slice(1)] };
  const questionSet = { ...SHARED_FROZEN.questionSet, registryVersion };
  return { ...SHARED_FROZEN, payload, questionSet,
    contentHash: geoKbDigest(payload as unknown as GeoKbValue), questionSetHash: geoQuestionSetDigest(questionSet) };
}
function context(frozen: GeoKbFrozenSnapshot = SHARED_FROZEN): GeoSnapshotContext {
  return {
    schemaVersion: "marketing-geo-snapshot-context.v1", kbId: frozen.kbId,
    targetHost: "fixture.example", payloadHash: frozen.contentHash,
    questionSetHash: frozen.questionSetHash, contentHash: "c".repeat(64),
    enrichment: null, profile: null, roles: [], competitors: [], skippedLayers: [],
    facts: frozen.payload.facts.map(fact => ({
      key: fact.key, value: fact.value || null, reason: fact.reason, source: "kb",
      sourceUrl: fact.sourceUrl || null, observedAt: fact.observedAt || null, evidenceId: null,
    })),
  };
}
function basis(value: GeoSnapshotContext | null, frozen: GeoKbFrozenSnapshot = SHARED_FROZEN) {
  return sharedGeoBriefBasis({ frozen, context: value, questionId: "q1", questionText: "",
    runEvidence: null, runId: "fact-integrity-test", now: "2026-08-31T00:00:00Z" });
}
function withPositioning(frozen: GeoKbFrozenSnapshot, text: string, derivation: "declared" | "inferred", source: "kb" | "crawl" = "kb"): GeoSnapshotContext {
  const inherited = context(frozen);
  return { ...inherited,
    enrichment: source === "crawl" ? { receiptId: "00000000-0000-4000-8000-000000000001", contentHash: "e".repeat(64) } : null,
    facts: [{ ...inherited.facts[0]!, source, observedAt: source === "crawl" ? "2026-08-31T12:00:00Z" : inherited.facts[0]!.observedAt, evidenceId: source === "crawl" ? "crawl-fact-1" : null }, ...inherited.facts.slice(1)],
    profile: {
      reference: { schemaVersion: "website-profile-reference.v1", websiteId: "fixture-website", snapshotId: "fixture-profile", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "d".repeat(64) },
      productName: "", oneLinePositioning: text, coreFeatures: [], market: { country: "US", language: "en" },
      fieldProvenance: [{ path: "/oneLinePositioning", derivation, confidence: "high", source: "user_edit", limitation: null, observedAt: null, evidenceUrls: [] }],
    },
  };
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
  it.each([LEGACY_REGISTRY, `${LEGACY_REGISTRY}/profile-fact-overrides-v10`])("preserves the historical duplicate projection byte shape without the exact new registry policy: %s", (registryVersion) => {
    const frozen = frozenWithFact("oneLinePositioning", "Three seats", registryVersion);
    const brief = basis(withPositioning(frozen, "THREE   SEATS", "inferred"), frozen);
    expect(brief.fact_table.filter((fact) => fact.label === "oneLinePositioning")).toEqual([
      { id: "F1", label: "oneLinePositioning", value: "Three seats", reason: null, evidence_refs: ["K1"] },
      { id: "F3", label: "oneLinePositioning", value: null, reason: "unverified", evidence_refs: [] },
    ]);
  });
  it.each(["kb", "crawl"] as const)("uses the new policy to omit an exact stable-key/value Profile duplicate backed by a %s receipt", (source) => {
    const frozen = frozenWithFact("oneLinePositioning", "Thr\u00e9e seats");
    const brief = basis(withPositioning(frozen, "  THRE\u0301E   SEATS  ", "inferred", source), frozen);
    expect(brief.evidence.facts).toContainEqual(expect.objectContaining({ source, text: "Thr\u00e9e seats" }));
    expect(brief.evidence.facts.some((fact) => fact.source === "product_profile")).toBe(false);
    expect(brief.fact_table.filter((fact) => fact.label === "oneLinePositioning")).toEqual([
      expect.objectContaining({ value: "Thr\u00e9e seats", reason: null }),
    ]);
  });
  it("uses the exact coreFeatures index as the stable override key", () => {
    const frozen = frozenWithFact("coreFeatures[1]", "Second feature");
    const inherited = context(frozen);
    const value: GeoSnapshotContext = { ...inherited, profile: {
      reference: { schemaVersion: "website-profile-reference.v1", websiteId: "fixture-website", snapshotId: "fixture-profile", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "d".repeat(64) },
      productName: "", oneLinePositioning: "", coreFeatures: ["First feature", "SECOND   FEATURE"], market: { country: "US", language: "en" },
      fieldProvenance: [{ path: "/coreFeatures", derivation: "inferred", confidence: "high", source: "user_edit", limitation: null, observedAt: null, evidenceUrls: [] }],
    } };
    const brief = basis(value, frozen);
    expect(brief.fact_table.filter((fact) => fact.label === "coreFeatures[1]")).toEqual([
      expect.objectContaining({ value: "Second feature", evidence_refs: ["K1"] }),
    ]);
    expect(brief.fact_table.find((fact) => fact.label === "coreFeatures[0]")).toMatchObject({ value: null, reason: "unverified" });
  });
  it.each([
    ["productName", "Three seats", "THREE SEATS"],
    ["oneLinePositioning", "Three seats", "Three-seats"],
  ] as const)("does not override an unverified Profile row when sourced key/value is %s / %s", (key, value, profileValue) => {
    const frozen = frozenWithFact(key, value);
    const brief = basis(withPositioning(frozen, profileValue, "inferred"), frozen);
    expect(brief.fact_table.some((fact) => fact.label === "oneLinePositioning" && fact.value === null && fact.reason === "unverified")).toBe(true);
  });
  it("retains a verified Profile receipt and row under the new exact override policy", () => {
    const frozen = frozenWithFact("oneLinePositioning", "Three seats");
    const brief = basis(withPositioning(frozen, "THREE   SEATS", "declared"), frozen);
    expect(brief.evidence.facts).toContainEqual({ id: "P1", source: "product_profile", text: "THREE   SEATS", observed_at: frozen.frozenAt, url: null });
    expect(brief.fact_table.find((fact) => fact.evidence_refs.includes("P1"))).toMatchObject({ label: "oneLinePositioning", value: "THREE   SEATS" });
  });
  it("keeps later verified Profile receipt numbering stable after an override", () => {
    const frozen = frozenWithFact("productName", "Three seats");
    const inherited = withPositioning(frozen, "Verified positioning", "declared");
    const positioningProvenance = inherited.profile?.fieldProvenance?.[0];
    if (!inherited.profile || !positioningProvenance) throw new Error("invalid test profile");
    const value: GeoSnapshotContext = { ...inherited, profile: { ...inherited.profile, productName: "THREE SEATS",
      fieldProvenance: [
        { path: "/productName", derivation: "inferred", confidence: "high", source: "user_edit", limitation: null, observedAt: null, evidenceUrls: [] },
        positioningProvenance,
      ],
    } };
    const brief = basis(value, frozen);
    expect(brief.fact_table.filter((fact) => fact.label === "productName")).toEqual([
      expect.objectContaining({ value: "Three seats", evidence_refs: ["K1"] }),
    ]);
    expect(brief.evidence.facts).toContainEqual({ id: "P2", source: "product_profile", text: "Verified positioning", observed_at: frozen.frozenAt, url: null });
    expect(brief.fact_table.find((fact) => fact.label === "oneLinePositioning")).toMatchObject({ evidence_refs: ["P2"] });
  });
});
