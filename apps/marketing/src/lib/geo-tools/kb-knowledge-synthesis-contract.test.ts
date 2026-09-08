import { describe, expect, it } from "vitest";

import {
  buildGeoKnowledgeSynthesisInputV1,
  geoKnowledgeSynthesisInputDigest,
  GEO_KNOWLEDGE_SYNTHESIS_LIMITS,
  geoKnowledgeSynthesisSourceCatalogueDigest,
  parseGeoKnowledgeNarrativeV1,
  parseGeoKnowledgeSynthesisInputV1,
} from "./kb-knowledge-synthesis-contract.ts";
import { buildGeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";

const AT = "2026-09-04T07:11:15.461Z";
const HASH = "a".repeat(64);

function evidence() {
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1", collectedAt: AT, targetUrl: "https://product.example/",
    confirmedCompetitors: [{ key: "rival.example", name: "Rival", confirmed: true }], availability: "partial", limitation: "One endpoint was unavailable.", pages: [],
    machine: {
      jsonLd: { status: "absent", types: [], sourceRefs: ["source:own"] },
      llms: { status: "absent", sourceRefs: ["source:llms"] }, robots: { status: "present", sourceRefs: ["source:robots"] },
      sitemap: { status: "present", sourceRefs: ["source:sitemap"], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false },
      hreflang: { status: "absent", locales: [], sourceRefs: ["source:own"] },
    },
    sourceCatalogue: [
      { id: "source:own", kind: "own_page", label: "Product page", url: "https://product.example/", competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["Pine Cloud is project software for teams of 2. It requires human approval."] },
      { id: "source:rival", kind: "competitor_page", label: "Rival page", url: "https://rival.example/", competitor: { key: "rival.example", name: "Rival", confirmed: true }, availability: "partial", reason: "partial_body", observedAt: AT, bodyHash: HASH, excerpts: ["Rival supports teams of 5."] },
      { id: "source:robots", kind: "robots", label: "robots.txt", url: "https://product.example/robots.txt", competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["User-agent: *"] },
      { id: "source:sitemap", kind: "sitemap", label: "sitemap.xml", url: "https://product.example/sitemap.xml", competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH, excerpts: ["https://product.example/"] },
      { id: "source:llms", kind: "llms", label: "llms.txt", url: "https://product.example/llms.txt", competitor: null, availability: "unavailable", reason: "not_found", observedAt: null, bodyHash: null, excerpts: [] },
    ],
  });
}

function input() {
  return buildGeoKnowledgeSynthesisInputV1({
    officialName: "Pine Cloud", aliases: ["Pine"], categoryTerms: ["Project software"], market: "US", language: "en-US",
  }, evidence());
}

function narrative() {
  return {
    schemaVersion: "marketing-geo-knowledge-narrative.v1",
    entity: {
      definitions: { w25: "Pine Cloud is project software for teams of 2.", w55: "Pine Cloud is project software for teams of 2 with human approval.", w120: "Pine Cloud is project software for teams of 2. Each workflow requires human approval." },
      audience: { who: "Teams of 2", notFor: null as string | null }, founded: { year: null as string | null, team: null as string | null, location: null as string | null }, disambiguation: null as string | null, sourceRefs: ["source:own"],
    },
    facts: [{ id: "fact:teams", type: "feature", statement: "Pine Cloud supports teams of 2.", sourceRefs: ["source:own"] }],
    qa: [{ id: "qa:teams", intent: "applicability", question: "Does Pine Cloud support teams of 2?", variants: [], directAnswer: "Yes. Pine Cloud supports teams of 2.", expansion: null, sourceRefs: ["source:own"] }],
    comparisons: [{ id: "comparison:rival", competitor: { key: "rival.example", name: "Rival", confirmed: true }, rows: [{ id: "comparison-row:teams", dimension: "Supported team size", product: "Teams of 2", competitor: "Teams of 5", sourceRefs: ["source:own", "source:rival"], availability: "available" }], verdict: "Pine Cloud supports teams of 2; Rival supports teams of 5.", sourceRefs: ["source:own", "source:rival"] }],
    scope: { does: [{ id: "scope:does", text: "Supports teams of 2.", sourceRefs: ["source:own"] }], doesNot: [], needsHuman: [{ id: "scope:human", text: "Requires human approval.", sourceRefs: ["source:own"] }], misconceptions: [] },
  };
}

describe("GEO knowledge synthesis contracts", () => {
  it("projects an evidence-bound, deterministic input using only usable pack-compatible sources", () => {
    const first = input();
    expect(first.schemaVersion).toBe("marketing-geo-knowledge-synthesis-input.v1");
    expect(first.targetUrl).toBe("https://product.example/");
    expect(first.sourceCatalogueHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.sourceCatalogue.map(({ id }) => id)).toEqual(["source:own", "source:rival", "source:robots", "source:sitemap"]);
    expect(first.evidenceContentHash).toBe(evidence().contentHash);
    expect(parseGeoKnowledgeSynthesisInputV1(first)).toEqual(first);
    const { contentHash: _contentHash, ...body } = first;
    expect(geoKnowledgeSynthesisInputDigest(body)).toBe(first.contentHash);
  });

  it("parses a citation-bound narrative with pack-assembly shapes", () => {
    expect(parseGeoKnowledgeNarrativeV1(narrative(), input())).toEqual(narrative());
  });

  it.each([
    ["unknown output field", (value: any) => { value.debug = true; }],
    ["duplicate IDs", (value: any) => { value.qa[0].id = value.facts[0].id; }],
    ["duplicate text", (value: any) => { value.qa[0].directAnswer = value.facts[0].statement; }],
    ["missing required section", (value: any) => { delete value.scope; }],
    ["unknown source", (value: any) => { value.facts[0].sourceRefs = ["source:unknown"]; }],
    ["unavailable source", (value: any) => { value.facts[0].sourceRefs = ["source:llms"]; }],
    ["unconfirmed competitor", (value: any) => { value.comparisons[0].competitor.key = "other.example"; }],
    ["mismatched competitor name", (value: any) => { value.comparisons[0].competitor.name = "Other"; }],
    ["unsupported numeric literal", (value: any) => { value.facts[0].statement = "Pine Cloud supports teams of 99."; }],
    ["numeric literal wearing an unevidenced currency", (value: any) => { value.facts[0].statement = "Pine Cloud costs ₩2 per team."; }],
    ["model URL", (value: any) => { value.facts[0].statement = "See https://product.example/."; }],
    ["bare domain", (value: any) => { value.facts[0].statement = "See rival.example."; }],
    ["model URL in entity definition", (value: any) => { value.entity.definitions.w25 = "See https://product.example/."; }],
    ["observed authority", (value: any) => { value.facts[0].observedAt = AT; }],
    ["overlong word definition", (value: any) => { value.entity.definitions.w25 = Array.from({ length: 26 }, () => "word").join(" "); }],
    ["overlong CJK definition", (value: any) => { value.entity.definitions.w25 = "字".repeat(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.definitionCodePoints.w25 + 1); }],
    ["lone surrogate", (value: any) => { value.facts[0].statement = "Pine\ud800"; }],
    ["duplicate source refs", (value: any) => { value.facts[0].sourceRefs = ["source:own", "source:own"]; }],
  ])("rejects %s", (_label, mutate) => {
    const value = narrative(); mutate(value);
    expect(() => parseGeoKnowledgeNarrativeV1(value, input())).toThrow();
  });

  it("rejects invalid input hashes, source receipts, duplicate refs, and bounded overflows", () => {
    const value: any = input(); value.contentHash = HASH;
    expect(() => parseGeoKnowledgeSynthesisInputV1(value)).toThrow(/hash/i);
    const source = input() as any;
    source.sourceCatalogue[0].url = "http://product.example/";
    expect(() => parseGeoKnowledgeSynthesisInputV1(source)).toThrow();
    const duplicate = input() as any; duplicate.sourceCatalogue[1].id = duplicate.sourceCatalogue[0].id;
    expect(() => parseGeoKnowledgeSynthesisInputV1(duplicate)).toThrow();
    const unavailable = input() as any; unavailable.sourceCatalogue[0].availability = "unavailable";
    expect(() => parseGeoKnowledgeSynthesisInputV1(unavailable)).toThrow();
    const catalogueHash = input() as any; catalogueHash.sourceCatalogueHash = HASH;
    expect(() => parseGeoKnowledgeSynthesisInputV1(catalogueHash)).toThrow(/catalogue/i);
    const foreignOwnPage = input() as any; foreignOwnPage.sourceCatalogue[0].url = "https://foreign.example/"; foreignOwnPage.sourceCatalogueHash = geoKnowledgeSynthesisSourceCatalogueDigest(foreignOwnPage.sourceCatalogue);
    expect(() => parseGeoKnowledgeSynthesisInputV1(foreignOwnPage)).toThrow();
    const invalidRobots = input() as any; invalidRobots.sourceCatalogue.find((source: any) => source.kind === "robots").url = "https://product.example/not-robots.txt"; invalidRobots.sourceCatalogueHash = geoKnowledgeSynthesisSourceCatalogueDigest(invalidRobots.sourceCatalogue);
    expect(() => parseGeoKnowledgeSynthesisInputV1(invalidRobots)).toThrow();
    const loneSurrogate = input() as any; loneSurrogate.officialName = "Pine\ud800";
    expect(() => parseGeoKnowledgeSynthesisInputV1(loneSurrogate)).toThrow();
    expect(geoV2JsonbBytes(input())).toBeLessThanOrEqual(GEO_KNOWLEDGE_SYNTHESIS_LIMITS.inputBytes);
    expect(() => buildGeoKnowledgeSynthesisInputV1({ officialName: "Pine", aliases: [], categoryTerms: ["x".repeat(201)], market: "US", language: "en" }, evidence())).toThrow();
  });

  it.each([
    ["entity", (value: any) => { value.entity.sourceRefs = ["source:rival"]; }],
    ["fact", (value: any) => { value.facts[0].sourceRefs = ["source:rival"]; }],
    ["QA", (value: any) => { value.qa[0].sourceRefs = ["source:robots"]; }],
    ["scope statement", (value: any) => { value.scope.does[0].sourceRefs = ["source:rival"]; }],
  ])("requires product evidence for every %s claim", (_label, mutate) => {
    const value = narrative(); mutate(value);
    expect(() => parseGeoKnowledgeNarrativeV1(value, input())).toThrow(/product/i);
  });

  it("does not allow a product numeric claim to borrow a competitor number", () => {
    const value = narrative();
    value.facts[0] = { ...value.facts[0], statement: "Pine Cloud supports teams of 5.", sourceRefs: ["source:own", "source:rival"] };
    expect(() => parseGeoKnowledgeNarrativeV1(value, input())).toThrow(/numeric/i);
  });

  it("requires own-page, rather than accepted-fact, product evidence for comparisons", () => {
    const acceptedFactInput: any = input();
    acceptedFactInput.sourceCatalogue.push({ id: "source:accepted", kind: "accepted_fact", label: "Accepted fact", url: null, competitor: null, availability: "available", reason: null, observedAt: null, bodyHash: null, excerpts: ["Pine Cloud supports teams of 2."] });
    acceptedFactInput.sourceCatalogueHash = geoKnowledgeSynthesisSourceCatalogueDigest(acceptedFactInput.sourceCatalogue);
    const { contentHash: _contentHash, ...body } = acceptedFactInput;
    acceptedFactInput.contentHash = geoKnowledgeSynthesisInputDigest(body);
    const value = narrative();
    value.comparisons[0].sourceRefs = ["source:accepted", "source:rival"];
    value.comparisons[0].rows[0].sourceRefs = ["source:accepted", "source:rival"];
    expect(() => parseGeoKnowledgeNarrativeV1(value, acceptedFactInput)).toThrow(/comparison/i);
  });

  it.each([
    ["entity", (value: any) => { value.entity.definitions.w25 = "Rival is project software."; }],
    ["fact", (value: any) => { value.facts[0].statement = "Rival supports teams."; }],
    ["scope", (value: any) => { value.scope.does[0].text = "Rival supports teams."; }],
    ["non-comparison QA", (value: any) => { value.qa[0].question = "Can Rival support teams?"; }],
    ["comparison QA without matching competitor evidence", (value: any) => { value.qa[0].intent = "comparison"; value.qa[0].question = "How does Pine Cloud compare with Rival?"; }],
  ])("rejects a declared competitor mention in %s outside its allowed evidence scope", (_label, mutate) => {
    const value = narrative(); mutate(value);
    expect(() => parseGeoKnowledgeNarrativeV1(value, input())).toThrow(/competitor/i);
  });

  it("allows a comparison QA to mention a confirmed competitor when its page is cited", () => {
    const value = narrative(); value.qa[0].intent = "comparison"; value.qa[0].question = "How does Pine Cloud compare with Rival?"; value.qa[0].sourceRefs = ["source:own", "source:rival"];
    expect(parseGeoKnowledgeNarrativeV1(value, input())).toEqual(value);
  });

  it.each(["Acme", "rival.example:443", "rival.example/path", "user@rival.example", "RIVAL.EXAMPLE"])("rejects noncanonical confirmed competitor key %s even without a competitor page", key => {
    const value: any = input(); value.sourceCatalogue = value.sourceCatalogue.filter((source: any) => source.kind !== "competitor_page"); value.confirmedCompetitors[0].key = key;
    value.sourceCatalogueHash = geoKnowledgeSynthesisSourceCatalogueDigest(value.sourceCatalogue);
    const { contentHash: _contentHash, ...body } = value; value.contentHash = geoKnowledgeSynthesisInputDigest(body);
    expect(() => parseGeoKnowledgeSynthesisInputV1(value)).toThrow(/competitor/i);
  });

  it("rejects an undeclared proper-name competitor claim absent from its cited evidence", () => {
    const value = narrative(); value.facts[0].statement = "Acme is an alternative for Pine Cloud.";
    expect(() => parseGeoKnowledgeNarrativeV1(value, input())).toThrow(/subject|evidence/i);
  });

  it("allows an observed third-party proper name only when the claim cites that excerpt", () => {
    const observedInput: any = input();
    observedInput.sourceCatalogue.find((source: any) => source.id === "source:own").excerpts.push("Northstar offers an alternative for project teams.");
    observedInput.sourceCatalogue.push({ id: "source:accepted", kind: "accepted_fact", label: "Accepted fact", url: null, competitor: null, availability: "available", reason: null, observedAt: null, bodyHash: null, excerpts: ["Pine Cloud supports teams."] });
    observedInput.sourceCatalogueHash = geoKnowledgeSynthesisSourceCatalogueDigest(observedInput.sourceCatalogue);
    const { contentHash: _contentHash, ...body } = observedInput; observedInput.contentHash = geoKnowledgeSynthesisInputDigest(body);
    const allowed = narrative(); allowed.facts[0].statement = "Northstar offers an alternative for Pine Cloud.";
    expect(parseGeoKnowledgeNarrativeV1(allowed, observedInput)).toEqual(allowed);
    const uncited = narrative(); uncited.facts[0].statement = "Northstar offers an alternative for Pine Cloud."; uncited.facts[0].sourceRefs = ["source:accepted"];
    expect(() => parseGeoKnowledgeNarrativeV1(uncited, observedInput)).toThrow(/subject|evidence/i);
  });

  it("does not misclassify CJK summaries or ordinary sentence-initial words as company subjects", () => {
    const value = narrative(); value.facts[0].statement = "团队支持 Pine Cloud。"; value.qa[0].directAnswer = "Yes. Teams can use Pine Cloud.";
    expect(parseGeoKnowledgeNarrativeV1(value, input())).toEqual(value);
  });

  it("rejects repeated competitor comparisons and duplicate audience, founded, or disambiguation text", () => {
    const comparison = narrative();
    comparison.comparisons.push({ ...comparison.comparisons[0], id: "comparison:rival-again", rows: [{ ...comparison.comparisons[0].rows[0], id: "comparison-row:teams-again" }] });
    expect(() => parseGeoKnowledgeNarrativeV1(comparison, input())).toThrow(/competitor/i);

    const audience = narrative(); audience.entity.audience.who = audience.facts[0].statement;
    expect(() => parseGeoKnowledgeNarrativeV1(audience, input())).toThrow(/duplicate/i);
    const founded = narrative(); founded.entity.founded.team = founded.facts[0].statement;
    expect(() => parseGeoKnowledgeNarrativeV1(founded, input())).toThrow(/duplicate/i);
    const disambiguation = narrative(); disambiguation.entity.disambiguation = disambiguation.facts[0].statement;
    expect(() => parseGeoKnowledgeNarrativeV1(disambiguation, input())).toThrow(/duplicate/i);
  });
});
