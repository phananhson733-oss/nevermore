import { describe, expect, it } from "vitest";

import { buildGeoKnowledgePack } from "./kb-knowledge-pack.ts";
import { buildGeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { parseGeoKnowledgePackV1 } from "./kb-knowledge-pack-contract.ts";
import { buildGeoKnowledgeSynthesisInputV1 } from "./kb-knowledge-synthesis-contract.ts";
import { buildGeoSnapshotContextV2 } from "./snapshot-context-v2.ts";
import { parseGeoKbPayloadV2 } from "./kb-v2-contract.ts";
import { completePayloadV2, questionSetV2, V2_CANDIDATE_ID, V2_KB_ID } from "./kb-v2.test-fixtures.ts";

const AT = "2026-09-04T07:11:15.461Z";
const GENERATED = "2026-09-04T08:11:15.461Z";
const HASH = "a".repeat(64);

function page(url: string, links: Array<{ intent: "pricing" | "docs" | "about" | "changelog" | "faq"; url: string }> = []) {
  return { url, canonicalUrl: null, title: null, description: null, lang: "en", jsonLdTypes: [], hreflangLocales: [], hreflang: [], faq: [], links };
}
function evidence() {
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1", collectedAt: AT, targetUrl: "https://example.com/", confirmedCompetitors: [{ key: "rival.example", name: "Rival", confirmed: true }], availability: "partial", limitation: "The llms endpoint was unavailable.",
    pages: [
      page("https://example.com/", [{ intent: "pricing", url: "https://example.com/pricing" }, { intent: "docs", url: "https://example.com/docs" }, { intent: "about", url: "https://example.com/about" }]),
      page("https://example.com/pricing"), page("https://example.com/docs"), page("https://example.com/about"),
    ],
    machine: { jsonLd: { status: "absent", types: [], sourceRefs: ["source:home", "source:pricing", "source:docs", "source:about"] }, llms: { status: "absent", sourceRefs: ["source:llms"] }, robots: { status: "present", sourceRefs: ["source:robots"] }, sitemap: { status: "present", sourceRefs: ["source:sitemap"], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false }, hreflang: { status: "absent", locales: [], sourceRefs: ["source:home", "source:pricing", "source:docs", "source:about"] } },
    sourceCatalogue: [
      { id: "source:home", kind: "own_page", label: "Home", url: "https://example.com/", competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["Acme is analytics software for teams. Acme provides analytics tools. Analytics work needs product configuration. It helps teams work with analytics."] },
      { id: "source:pricing", kind: "own_page", label: "Pricing", url: "https://example.com/pricing", competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["Pricing information is available."] },
      { id: "source:docs", kind: "own_page", label: "Docs", url: "https://example.com/docs", competitor: null, availability: "partial", reason: "partial_body", observedAt: AT, bodyHash: HASH, excerpts: ["Documentation is available."] },
      { id: "source:about", kind: "own_page", label: "About", url: "https://example.com/about", competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["About Acme."] },
      { id: "source:rival", kind: "competitor_page", label: "Rival", url: "https://rival.example/", competitor: { key: "rival.example", name: "Rival", confirmed: true }, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["Rival is analytics software."] },
      { id: "source:robots", kind: "robots", label: "robots.txt", url: "https://example.com/robots.txt", competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["User-agent: *"] },
      { id: "source:sitemap", kind: "sitemap", label: "sitemap.xml", url: "https://example.com/sitemap.xml", competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["https://example.com/"] },
      { id: "source:seats", kind: "accepted_fact", label: "Seats", url: null, competitor: null, availability: "available", reason: null, observedAt: null, bodyHash: null, excerpts: ["3 seats are available."] },
      { id: "source:llms", kind: "llms", label: "llms.txt", url: "https://example.com/llms.txt", competitor: null, availability: "unavailable", reason: "not_found", observedAt: null, bodyHash: null, excerpts: [] },
    ],
  });
}
function payload() { return completePayloadV2(); }
function context() { const current = payload(); return buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload: current, questionSet: questionSetV2(), sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams need analytics." }], sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } }); }
function synthesisInput() { const current = payload(); return buildGeoKnowledgeSynthesisInputV1({ officialName: current.officialName, aliases: current.aliases, categoryTerms: current.categoryTerms, market: current.market.country, language: current.market.language }, evidence()); }
function narrative() { return { schemaVersion: "marketing-geo-knowledge-narrative.v1", entity: { definitions: { w25: "Acme is analytics software for teams.", w55: "Acme is analytics software for teams with documentation.", w120: "Acme is analytics software for teams with product documentation and a public pricing page." }, audience: { who: "Teams", notFor: null }, founded: { year: null, team: null, location: null }, disambiguation: null, sourceRefs: ["source:home"] }, facts: [{ id: "fact:product", type: "feature", statement: "Acme provides analytics tools.", sourceRefs: ["source:home"] }], qa: [{ id: "qa:product", intent: "definition", question: "Explain Acme.", variants: [], directAnswer: "It helps teams work with analytics.", expansion: null, sourceRefs: ["source:home"] }], comparisons: [{ id: "comparison:rival", competitor: { key: "rival.example", name: "Rival", confirmed: true }, rows: [{ id: "comparison-row:product", dimension: "Product", product: "Analytics software", competitor: "Analytics software", sourceRefs: ["source:home", "source:rival"], availability: "available" }], verdict: "Acme is analytics software; Rival is analytics software.", sourceRefs: ["source:home", "source:rival"] }], scope: { does: [{ id: "scope:does", text: "Analytics work needs product configuration.", sourceRefs: ["source:home"] }], doesNot: [], needsHuman: [], misconceptions: [] } }; }
function build(overrides: Record<string, unknown> = {}) { return buildGeoKnowledgePack({ generatedAt: GENERATED, payload: payload(), context: context(), questionSet: questionSetV2(), evidence: evidence(), synthesisInput: synthesisInput(), narrative: narrative(), narrativeFailureReason: null, ...overrides }); }

describe("GEO knowledge pack assembler", () => {
  it("assembles a deterministic, parseable available pack without mutating inputs", () => {
    const args = { generatedAt: GENERATED, payload: payload(), context: context(), questionSet: questionSetV2(), evidence: evidence(), synthesisInput: synthesisInput(), narrative: narrative(), narrativeFailureReason: null };
    const before = structuredClone(args); const first = buildGeoKnowledgePack(args); const second = buildGeoKnowledgePack(structuredClone(args));
    expect(parseGeoKnowledgePackV1(first)).toEqual(first); expect(second.contentHash).toBe(first.contentHash); expect(args).toEqual(before);
    expect(first).toMatchObject({ meta: { generatedAt: GENERATED, lastScanAt: AT, market: "US", language: "en", counts: { facts: 2, qa: 1, comparisons: 1 } }, entity: { status: "partial" }, facts: { status: "available" }, qa: { status: "available" }, comparisons: { status: "available" }, scope: { status: "available" } });
    expect(first.entity.status === "partial" ? first.entity.value.links : null).toEqual({ home: "https://example.com/", pricing: "https://example.com/pricing", docs: "https://example.com/docs", about: "https://example.com/about", changelog: null, faq: null });
    expect(first.sourceCatalogue).toEqual(evidence().sourceCatalogue); expect(JSON.stringify(first)).not.toMatch(/attachment-example|reference-price/iu);
  });

  it("keeps evidence, partial machine, and coverage deterministic when narrative is unavailable", () => {
    const result = build({ narrative: null, narrativeFailureReason: "unsupported_language" });
    expect(result.entity).toEqual({ status: "unavailable", reason: "unsupported_language" }); expect(result.facts.status).toBe("available");
    expect(result.evidence.status).toBe("partial"); expect(result.machine.status).toBe("partial"); expect(result.coverage.status).toBe("partial");
    expect(result.facts.status === "available" || result.facts.status === "partial" ? result.facts.value.some(fact => fact.statement === "3 seats are available.") : false).toBe(true);
    expect(result.coverage.status === "partial" ? result.coverage.value.map(item => item.label) : []).toEqual(["Entity", "Facts", "Q&A", "Comparisons", "Scope", "Evidence", "Machine visibility"]);
  });

  it("permits a null synthesis input only when no narrative is present", () => {
    expect(() => build({ synthesisInput: null, narrative: null, narrativeFailureReason: "insufficient_evidence" })).not.toThrow();
    expect(() => build({ synthesisInput: null })).toThrow(/synthesis/i);
  });

  it("does not leak competitor pricing or docs links into target entity links", () => {
    const raw: any = structuredClone(evidence()); const { contentHash: _contentHash, ...body } = raw;
    body.pages = [page("https://example.com/"), page("https://rival.example/", [{ intent: "pricing", url: "https://rival.example/pricing" }, { intent: "docs", url: "https://rival.example/docs" }])];
    const scopedEvidence = buildGeoKnowledgeEvidenceV1(body); const current = payload(); const scopedInput = buildGeoKnowledgeSynthesisInputV1({ officialName: current.officialName, aliases: current.aliases, categoryTerms: current.categoryTerms, market: current.market.country, language: current.market.language }, scopedEvidence);
    const result = build({ evidence: scopedEvidence, synthesisInput: scopedInput }); const entity = result.entity.status === "unavailable" ? null : result.entity.value;
    expect(Object.values(entity!.links).filter((url): url is string => url !== null).every(url => new URL(url).host === "example.com")).toBe(true); expect(entity!.links.pricing).toBeNull(); expect(entity!.links.docs).toBeNull();
  });

  it("assembles fully unavailable own-site evidence without fabricating customer content", () => {
    const unavailableEvidence = buildGeoKnowledgeEvidenceV1({ schemaVersion: "marketing-geo-knowledge-evidence.v1", collectedAt: AT, targetUrl: "https://example.com/", confirmedCompetitors: [{ key: "rival.example", name: "Rival", confirmed: true }], availability: "unavailable", limitation: "No own-site evidence could be collected.", pages: [], machine: { jsonLd: { status: "absent", types: [], sourceRefs: ["failed:own"] }, hreflang: { status: "absent", locales: [], sourceRefs: ["failed:own"] }, robots: { status: "unreachable", sourceRefs: ["failed:robots"] }, sitemap: { status: "unreachable", sourceRefs: ["failed:sitemap"], urlCount: null, knowledgePagesListed: null }, llms: { status: "unreachable", sourceRefs: ["failed:llms"] } }, sourceCatalogue: [
      { id: "failed:own", kind: "own_page", label: "Home", url: "https://example.com/", competitor: null, availability: "unavailable", reason: "fetch_failed", observedAt: null, bodyHash: null, excerpts: [] },
      { id: "failed:robots", kind: "robots", label: "robots.txt", url: "https://example.com/robots.txt", competitor: null, availability: "unavailable", reason: "fetch_failed", observedAt: null, bodyHash: null, excerpts: [] },
      { id: "failed:sitemap", kind: "sitemap", label: "sitemap.xml", url: "https://example.com/sitemap.xml", competitor: null, availability: "unavailable", reason: "fetch_failed", observedAt: null, bodyHash: null, excerpts: [] },
      { id: "failed:llms", kind: "llms", label: "llms.txt", url: "https://example.com/llms.txt", competitor: null, availability: "unavailable", reason: "fetch_failed", observedAt: null, bodyHash: null, excerpts: [] },
    ] });
    const result = build({ evidence: unavailableEvidence, synthesisInput: null, narrative: null, narrativeFailureReason: "insufficient_evidence" });
    for (const module of [result.entity, result.facts, result.qa, result.comparisons, result.scope, result.evidence]) expect(module.status).toBe("unavailable");
    expect(result.machine.status).toBe("partial"); expect(result.coverage.status).toBe("partial"); expect(JSON.stringify(result)).not.toContain("3 seats are available.");
    expect(result.coverage.status === "partial" ? result.coverage.value.flatMap(item => item.sourceRefs) : []).toContain("failed:own");
  });

  it("does not admit accepted fact values by substring", () => {
    const raw: any = structuredClone(evidence()); const { contentHash: _contentHash, ...body } = raw; const accepted = body.sourceCatalogue.find((source: any) => source.id === "source:seats"); accepted.excerpts = ["13 seats are available."];
    const boundedEvidence = buildGeoKnowledgeEvidenceV1(body); const current = payload(); const boundedInput = buildGeoKnowledgeSynthesisInputV1({ officialName: current.officialName, aliases: current.aliases, categoryTerms: current.categoryTerms, market: current.market.country, language: current.market.language }, boundedEvidence);
    const result = build({ evidence: boundedEvidence, synthesisInput: boundedInput });
    expect(result.facts.status).toBe("partial"); expect(result.facts.status === "partial" ? result.facts.value.some(fact => fact.statement === "13 seats are available.") : false).toBe(false);
  });

  it.each(["3.5 seats are available.", "3% discount is available.", "$3 seats are available.", "₩3 seats are available.", "₹3 seats are available.", "3/10 seats are available."])("does not admit an accepted numeric fact from %s", excerpt => {
    const raw: any = structuredClone(evidence()); const { contentHash: _contentHash, ...body } = raw; const accepted = body.sourceCatalogue.find((source: any) => source.id === "source:seats"); accepted.excerpts = [excerpt];
    const boundedEvidence = buildGeoKnowledgeEvidenceV1(body); const current = payload(); const boundedInput = buildGeoKnowledgeSynthesisInputV1({ officialName: current.officialName, aliases: current.aliases, categoryTerms: current.categoryTerms, market: current.market.country, language: current.market.language }, boundedEvidence);
    const result = build({ evidence: boundedEvidence, synthesisInput: boundedInput });
    expect(result.facts.status).toBe("partial"); expect(result.facts.status === "partial" ? result.facts.value.some(fact => fact.statement === excerpt) : false).toBe(false);
  });

  it("admits an accepted numeric fact when its literal token is exact", () => {
    const raw: any = structuredClone(evidence()); const { contentHash: _contentHash, ...body } = raw; const accepted = body.sourceCatalogue.find((source: any) => source.id === "source:seats"); accepted.excerpts = ["3 seats are available."];
    const boundedEvidence = buildGeoKnowledgeEvidenceV1(body); const current = payload(); const boundedInput = buildGeoKnowledgeSynthesisInputV1({ officialName: current.officialName, aliases: current.aliases, categoryTerms: current.categoryTerms, market: current.market.country, language: current.market.language }, boundedEvidence);
    const result = build({ evidence: boundedEvidence, synthesisInput: boundedInput });
    expect(result.facts.status === "available" || result.facts.status === "partial" ? result.facts.value.some(fact => fact.statement === "3 seats are available.") : false).toBe(true);
  });

  it.each([
    ["mismatched payload", () => build({ payload: { ...payload(), officialName: "Other" } })],
    ["mismatched context", () => build({ context: { ...context(), targetHost: "other.example" } })],
    ["swapped question set", () => build({ questionSet: { ...questionSetV2(), country: "CA" } })],
    ["mismatched synthesis input", () => build({ synthesisInput: buildGeoKnowledgeSynthesisInputV1({ officialName: "Other", aliases: [], categoryTerms: ["analytics"], market: "US", language: "en" }, evidence()) })],
    ["invalid missing narrative pairing", () => build({ narrative: null, narrativeFailureReason: null })],
    ["invalid present narrative pairing", () => build({ narrativeFailureReason: "timeout" })],
    ["stale generation time", () => build({ generatedAt: "2026-09-04T06:11:15.461Z" })],
  ])("rejects %s", (_label, run) => expect(run).toThrow());

  it("marks absent competitor comparisons as not applicable and does not fabricate facts", () => {
    const nextPayload = parseGeoKbPayloadV2({ ...payload(), competitors: [] }); const rawEvidence: any = structuredClone(evidence()); const { contentHash: _contentHash, ...body } = rawEvidence;
    const nextEvidence = buildGeoKnowledgeEvidenceV1({ ...body, confirmedCompetitors: [], sourceCatalogue: body.sourceCatalogue.filter((source: any) => source.kind !== "competitor_page") });
    const nextContext = buildGeoSnapshotContextV2({ candidateId: V2_CANDIDATE_ID, kbId: V2_KB_ID, payload: nextPayload, questionSet: questionSetV2(), sourceReceiptRefs: [], evidenceCatalog: [{ id: "manual:r1", kind: "manual", text: "Finance teams need analytics." }], sourceSummary: { gsc: null, selectedEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 }, availableEvidenceCounts: { profile: 0, gsc: 0, crawl: 0, manual: 1 } } });
    const nextInput = buildGeoKnowledgeSynthesisInputV1({ officialName: nextPayload.officialName, aliases: nextPayload.aliases, categoryTerms: nextPayload.categoryTerms, market: nextPayload.market.country, language: nextPayload.market.language }, nextEvidence);
    const nextNarrative = { ...narrative(), comparisons: [] };
    const result = buildGeoKnowledgePack({ generatedAt: GENERATED, payload: nextPayload, context: nextContext, questionSet: questionSetV2(), evidence: nextEvidence, synthesisInput: nextInput, narrative: nextNarrative, narrativeFailureReason: null });
    expect(result.comparisons).toEqual({ status: "unavailable", reason: "not_applicable" }); expect(result.meta.counts.comparisons).toBe(0); expect(result.facts.status).toBe("available");
  });
});
