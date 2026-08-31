import { describe, expect, it } from "vitest";
import { SHARED_FROZEN } from "./brief-shared-fixtures.ts";
import { assembleSharedGeoBrief, sharedGeoBriefBasis } from "./brief-shared.ts";
import { parseGeoContentBrief } from "@sf/public-tools/content-brief/parse-geo-brief";
import type { GeoSnapshotContext } from "./snapshot-context.ts";

describe("GEO shared Brief producer", () => {
  it("carries only provenance-backed Profile values into factual receipts", () => {
    const context: GeoSnapshotContext = { schemaVersion: "marketing-geo-snapshot-context.v1", kbId: SHARED_FROZEN.kbId, targetHost: "fixture.example", payloadHash: SHARED_FROZEN.contentHash, questionSetHash: SHARED_FROZEN.questionSetHash, contentHash: "c".repeat(64), enrichment: null, roles: [], facts: [], competitors: [], skippedLayers: [], profile: { reference: { schemaVersion: "website-profile-reference.v1", websiteId: "fixture-website", snapshotId: "fixture-profile", snapshotRevision: 1, profileSchemaVersion: "marketing-website-profile.v1", profileHash: "d".repeat(64) }, productName: "Fixture product", oneLinePositioning: "Inferred superiority claim", coreFeatures: ["Declared feature"], market: { country: "US", language: "en" }, fieldProvenance: ["productName", "oneLinePositioning", "coreFeatures"].map(field => ({ path: `/${field}` as "/productName" | "/oneLinePositioning" | "/coreFeatures", derivation: field === "oneLinePositioning" ? "inferred" : "declared", confidence: "high", source: "user_edit", limitation: null, observedAt: null, evidenceUrls: [] })) } };
    const brief = sharedGeoBriefBasis({ frozen: SHARED_FROZEN, context, questionId: "q1", questionText: "", runEvidence: null, runId: "fixture-brief", now: "2026-08-31T00:00:01Z" });
    expect(brief.evidence.facts.map(fact => [fact.source, fact.text])).toEqual([["product_profile", "Fixture product"], ["product_profile", "Declared feature"]]);
    expect(brief.fact_table.find(fact => fact.label === "oneLinePositioning")).toMatchObject({ value: null, reason: "unverified" });
    expect(brief.geo_origin.profile_ref?.profile_hash).toBe(context.profile?.reference.profileHash);
    if (context.profile?.fieldProvenance) {
      const original = context.profile.fieldProvenance[2]!;
      context.profile.fieldProvenance = [context.profile.fieldProvenance[0]!, context.profile.fieldProvenance[1]!, { ...original, derivation: "observed", source: "public_page", observedAt: "2026-07-01T00:00:00Z", evidenceUrls: ["https://fixture.example/features"] }];
    }
    const preserved = sharedGeoBriefBasis({ frozen: SHARED_FROZEN, context, questionId: "q1", questionText: "", runEvidence: null, runId: "fixture-brief", now: "2026-08-31T00:00:01Z" });
    expect(preserved.evidence.facts.find(fact => fact.text === "Declared feature")).toMatchObject({ observed_at: "2026-07-01T00:00:00Z", url: "https://fixture.example/features" });
  });
  it("produces a valid frozen/manual Brief with KB Q1 and no invented sample evidence", async () => {
    const basis = sharedGeoBriefBasis({ frozen: SHARED_FROZEN, context: null, questionId: "q1", questionText: "CLIENT OVERRIDE", runEvidence: null, runId: "brief-1", now: "2026-08-31T00:00:01Z" });
    expect(basis.keyword.primary).toBe(SHARED_FROZEN.questionSet.questions[0]!.text);
    expect(basis.geo_origin).toMatchObject({ kind: "manual", run_ref: null, sample_refs: [], question: { id: "q1" } });
    expect(basis.evidence.samples).toEqual([]);
    expect(basis.lead_answer.source).toBe("kb");
    expect(basis.lead_answer.requirement).toContain("opening 200 words");
    expect(basis.evidence.facts[0]).toMatchObject({ source: "kb", url: "https://fixture.example/pricing" });
    expect(basis.fact_table[1]).toMatchObject({ value: null, reason: "notPublished" });
    const brief = await assembleSharedGeoBrief(basis, { ok: true, outline: [{ id: "O1", h2: "Direct answer", h3: [], answers: basis.must_answer.items.map(item => item.id), provenance: { method: "model", derived_from: ["kb"] } }] });
    expect((await parseGeoContentBrief(brief)).ok).toBe(true);
  });
  it("marks typed manual Q1 user_input with no frozen question, role, entities or sample", () => {
    const brief = sharedGeoBriefBasis({ frozen: SHARED_FROZEN, context: null, questionId: null, questionText: "A custom question?", runEvidence: null, runId: "brief-1", now: "2026-08-31T00:00:01Z" });
    expect(brief.lead_answer).toMatchObject({ source: "user_input", requirement: "A custom question?", required_entities: [] });
    expect(brief.geo_origin).toMatchObject({ question: { id: null }, role: null, layer: null });
    expect(brief.evidence.kb_requirements).toEqual([]);
  });
});
