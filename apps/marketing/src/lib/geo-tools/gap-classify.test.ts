import { describe, expect, it } from "vitest";
import { classifyVisibilityGaps } from "./gap-classify.ts";
import { visibilityReportFixtureV2 } from "./visibility-v2.test-fixtures.ts";
import type { VisibilitySiteEvidenceV1, GeoReadPage } from "./site-index-contract.ts";

function report() {
  const base = visibilityReportFixtureV2();
  return visibilityReportFixtureV2({ questions: [{ ...base.questions[0]!.definition, text: "How can accounting teams automate invoice reminders?", requiredEntities: ["invoice reminders"] }], samplesPerQuestion: 3, samples: Array.from({ length: 3 }, (_, index) => ({ ...base.questions[0]!.samples[0]!, sampleIndex: index + 1, slotId: `chatgpt:q1:${index + 1}`, providerTaskId: `task-${index}` })) });
}
const page = (extra: Partial<GeoReadPage> = {}): GeoReadPage => ({ id: "page-1", url: "https://acme.test/guide", finalUrl: "https://acme.test/guide", fetchedAt: "2026-08-31T00:02:00.000Z", state: "read", reason: null, httpStatus: 200, contentSha256: "a".repeat(64), contentMethod: "raw_html", bodyComplete: true, title: "Guide", headings: [], pageType: "article", pageTypeBasis: "title_headings", ownPresence: true, ownPresenceBasis: "brand_text", ownPresenceExcerpt: "Acme", matches: [], ...extra });
function evidence(extra: Partial<VisibilitySiteEvidenceV1> = {}): VisibilitySiteEvidenceV1 { return { schemaVersion: "marketing-geo-site-evidence.v1", collectedAt: "2026-08-31T00:02:00.000Z", index: { scope: "declared_and_reachable_inventory", status: "complete", targetHost: "acme.test", discoveredCount: 1, pages: [page()], sitemapUrls: ["https://acme.test/sitemap.xml"], inventorySources: [{ url: "https://acme.test/sitemap.xml", fetchedAt: "2026-08-31T00:02:00.000Z", httpStatus: 200, bodyComplete: true, contentSha256: "a".repeat(64) }], limits: [] }, references: [], referenceOmittedCount: 0, citability: [], citabilityOmittedCount: 0, ...extra }; }
describe("evidence-conditioned GEO gaps", () => {
  it("only yields A for a fully read bounded inventory with a searchable frozen question", () => {
    expect(classifyVisibilityGaps(report(), evidence())[0]).toMatchObject({ kind: "A", reason: "no_matching_page_in_audited_inventory", action: "brief", questionId: "q1" });
    expect(classifyVisibilityGaps(report(), null)[0]).toMatchObject({ kind: "unattributed", reason: "site_evidence_unavailable", action: "none" });
    const partial = evidence();
    expect(classifyVisibilityGaps(report(), { ...partial, index: { ...partial.index, status: "partial", limits: ["incomplete_inventory"] } })[0]).toMatchObject({ kind: "unattributed", reason: "inventory_incomplete" });
  });
  it("yields B only for an independently read relevant page's counted failure", () => {
    const read = evidence();
    const relevant = page({ matches: [{ questionId: "q1", entities: ["invoice reminders"], terms: [] }] });
    const input = { ...read, index: { ...read.index, pages: [relevant] }, citability: [{ id: "t2-1", pageId: relevant.id, questionId: "q1", url: relevant.url, checkedAt: read.collectedAt, checks: [{ ruleId: "canonical", section: "readable" as const, kind: "deterministic" as const, weight: "counted" as const, state: "fail" as const, measured: { key: "canonicalMissing" }, fix: { key: "addCanonical" } }], renderStatus: "unavailable" as const, renderReason: "not_configured" as const, rawToRenderedRatio: null }] };
    expect(classifyVisibilityGaps(report(), input)[0]).toMatchObject({ kind: "B", action: "citability", pageUrl: relevant.url, evidenceIds: [relevant.id, "t2-1"] });
    expect(classifyVisibilityGaps(report(), { ...input, citability: [] })[0]).toMatchObject({ kind: "unattributed", reason: "citability_unavailable" });
  });
  it("C requires read third-party list evidence of absence and never generates content", () => {
    const read = evidence();
    const relevant = page({ matches: [{ questionId: "q1", entities: ["invoice reminders"], terms: [] }] });
    const reference = { ...page({ id: "ref-1", url: "https://publisher.test/best", finalUrl: "https://publisher.test/best", pageType: "listicle", ownPresence: false, ownPresenceBasis: "none", ownPresenceExcerpt: null }), sampleSlots: ["chatgpt:q1:1", "chatgpt:q1:2"] };
    const input = { ...read, index: { ...read.index, pages: [relevant] }, references: [reference], citability: [{ id: "t2-1", pageId: relevant.id, questionId: "q1", url: relevant.url, checkedAt: read.collectedAt, checks: [], renderStatus: "measured" as const, renderReason: null, rawToRenderedRatio: 1 }] };
    expect(classifyVisibilityGaps(report(), input)[0]).toMatchObject({ kind: "C", action: "third_party", sourceUrls: [reference.url] });
    expect(classifyVisibilityGaps(report(), { ...input, references: [{ ...reference, bodyComplete: false, ownPresence: null }] })[0]?.kind).toBe("unattributed");
  });
  it.each(["demand", "retrieval"] as const)("does not infer C from an unevaluable %s citation zero when the brand was mentioned", (mode) => {
    const base = report();
    const value = visibilityReportFixtureV2({
      questions: [{ ...base.questions[0]!.definition, mode, templateId: mode === "retrieval" ? base.questions[0]!.definition.templateId : null }],
      samplesPerQuestion: 3,
      samples: base.questions[0]!.samples.map((sample) => ({ ...sample, mentioned: true, cited: false, citedDomains: [], citedUrls: [], webSearchPerformed: false })),
    });
    expect(value.questions[0]).toMatchObject({ mode, mentioned: 3, citationEvaluable: 0, cited: 0 });
    const read = evidence();
    const relevant = page({ matches: [{ questionId: "q1", entities: ["invoice reminders"], terms: [] }] });
    const reference = { ...page({ id: "ref-1", url: "https://publisher.test/best", finalUrl: "https://publisher.test/best", pageType: "listicle", ownPresence: false, ownPresenceBasis: "none", ownPresenceExcerpt: null }), sampleSlots: ["chatgpt:q1:1", "chatgpt:q1:2"] };
    const input = { ...read, index: { ...read.index, pages: [relevant] }, references: [reference], citability: [{ id: "t2-1", pageId: relevant.id, questionId: "q1", url: relevant.url, checkedAt: read.collectedAt, checks: [], renderStatus: "measured" as const, renderReason: null, rawToRenderedRatio: 1 }] };
    expect(classifyVisibilityGaps(value, input)[0]).toMatchObject({ kind: "unattributed", reason: "no_actionable_gap", action: "none" });
  });
  it("does not infer A from an unevaluable citation zero when the brand was mentioned", () => {
    const base = report();
    const value = visibilityReportFixtureV2({
      questions: [base.questions[0]!.definition],
      samplesPerQuestion: 3,
      samples: base.questions[0]!.samples.map((sample) => ({ ...sample, mentioned: true, cited: false, citedDomains: [], citedUrls: [], webSearchPerformed: false })),
    });
    expect(value.questions[0]).toMatchObject({ mode: "retrieval", mentioned: 3, citationEvaluable: 0, cited: 0 });
    expect(classifyVisibilityGaps(value, evidence())[0]).toMatchObject({ kind: "unattributed", reason: "no_actionable_gap", action: "none" });
  });
  it("treats an evaluable retrieval citation miss as a third-party gap", () => {
    const base = report();
    const value = visibilityReportFixtureV2({
      questions: [base.questions[0]!.definition],
      samplesPerQuestion: 3,
      samples: base.questions[0]!.samples.map((sample) => ({ ...sample, mentioned: true, cited: false, citedDomains: [], citedUrls: [], webSearchPerformed: true })),
    });
    expect(value.questions[0]).toMatchObject({ mode: "retrieval", mentioned: 3, citationEvaluable: 3, cited: 0 });
    const read = evidence();
    const relevant = page({ matches: [{ questionId: "q1", entities: ["invoice reminders"], terms: [] }] });
    const reference = { ...page({ id: "ref-1", url: "https://publisher.test/best", finalUrl: "https://publisher.test/best", pageType: "listicle", ownPresence: false, ownPresenceBasis: "none", ownPresenceExcerpt: null }), sampleSlots: ["chatgpt:q1:1", "chatgpt:q1:2"] };
    const input = { ...read, index: { ...read.index, pages: [relevant] }, references: [reference], citability: [{ id: "t2-1", pageId: relevant.id, questionId: "q1", url: relevant.url, checkedAt: read.collectedAt, checks: [], renderStatus: "measured" as const, renderReason: null, rawToRenderedRatio: 1 }] };
    expect(classifyVisibilityGaps(value, input)[0]).toMatchObject({ kind: "C", reason: "missing_from_read_reference_pages", action: "third_party", sourceUrls: [reference.url] });
  });
  it("does not infer any content gap from insufficient or branded measurements", () => {
    const value = report();
    expect(classifyVisibilityGaps({ ...value, manifest: { ...value.manifest, status: "insufficient" } }, evidence())[0]?.reason).toBe("measurement_insufficient");
    expect(classifyVisibilityGaps({ ...value, questions: [{ ...value.questions[0]!, prompted: true }] }, evidence())[0]?.reason).toBe("prompted_question");
  });
  it("D requires repeated explicit confirmed-rival list positions; B wins when both apply", () => {
    const base = report();
    const value = visibilityReportFixtureV2({ context: { ...base.context, competitors: [{ domain: "rival.test", brandName: "Rival", confirmed: true }] }, questions: [{ ...base.questions[0]!.definition, layer: "comparison" }], samplesPerQuestion: 3, samples: base.questions[0]!.samples.map((sample) => ({ ...sample, mentioned: true, listPosition: 2, competitorsMentioned: ["Rival"], competitorPositions: [{ brandName: "Rival", position: 1 }] })) });
    const read = evidence(), relevant = page({ matches: [{ questionId: "q1", entities: ["invoice reminders"], terms: [] }] });
    const input = { ...read, index: { ...read.index, pages: [relevant] } };
    expect(classifyVisibilityGaps(value, input)[0]).toMatchObject({ kind: "D", action: "brief", reason: "repeated_competitor_list_position" });
    const unknownRank = { ...value, questions: [{ ...value.questions[0]!, samples: value.questions[0]!.samples.map((sample) => ({ ...sample, listPosition: null, mentioned: true })) }] };
    expect(classifyVisibilityGaps(unknownRank, input)[0]?.kind).toBe("unattributed");
    const oneRank = { ...value, questions: [{ ...value.questions[0]!, samples: value.questions[0]!.samples.map((sample, index) => ({ ...sample, competitorPositions: index === 0 ? sample.competitorPositions : [] })) }] };
    expect(classifyVisibilityGaps(oneRank, input)[0]?.kind).toBe("unattributed");
    const failed = { id: "t2-1", pageId: relevant.id, questionId: "q1", url: relevant.url, checkedAt: read.collectedAt, checks: [{ ruleId: "canonical", section: "readable" as const, kind: "deterministic" as const, weight: "counted" as const, state: "fail" as const, measured: { key: "canonicalMissing" }, fix: { key: "addCanonical" } }], renderStatus: "unavailable" as const, renderReason: "not_configured" as const, rawToRenderedRatio: null };
    expect(classifyVisibilityGaps(value, { ...input, citability: [failed] })[0]?.kind).toBe("B");
  });
});
