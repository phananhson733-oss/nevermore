import { describe, expect, it } from "vitest";

import {
  buildGeoKnowledgePackV1,
  GEO_KNOWLEDGE_PACK_LIMITS,
  parseGeoKnowledgePackV1,
} from "./kb-knowledge-pack-contract.ts";
import { geoV2JsonbBytes } from "./kb-v2-json.ts";

const AT = "2026-09-04T07:11:15.461Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function body(): any {
  const statement = (id: string, text: string, sourceRefs = ["source:home"]) => ({ id, text, sourceRefs });
  return {
    schemaVersion: "marketing-geo-knowledge-pack.v1",
    meta: {
      generatedAt: AT,
      lastScanAt: AT,
      market: "US",
      language: "en-US",
      counts: { facts: 1, qa: 1, comparisons: 1 },
    },
    entity: {
      status: "available",
      value: {
        name: "Example Cloud",
        aliases: ["Example"],
        categories: { primary: "Workflow software", secondary: ["Team software"] },
        definitions: {
          w25: "Example Cloud is workflow software for teams of 2.",
          w55: "Example Cloud gives teams of 2 a shared workflow.",
          w120: "Example Cloud gives teams of 2 a shared workflow with documented handoffs.",
        },
        audience: { who: "Teams of 2", notFor: null },
        founded: { year: null, team: null, location: null },
        disambiguation: null,
        links: {
          home: "https://example.com/",
          pricing: null,
          docs: "https://example.com/docs",
          about: null,
          changelog: null,
          faq: null,
        },
        sameAs: [],
        sourceRefs: ["source:home"],
      },
    },
    facts: {
      status: "available",
      value: [{
        id: "fact:team-size",
        type: "feature",
        statement: "Example Cloud supports teams of 2.",
        sourceRefs: ["source:home"],
        observedAt: AT,
        nextReviewAt: null,
      }],
    },
    qa: {
      status: "available",
      value: [{
        id: "qa:team-size",
        intent: "applicability",
        question: "Does Example Cloud support teams of 2?",
        variants: ["Can a team of 2 use Example Cloud?"],
        directAnswer: "Yes. Example Cloud supports teams of 2.",
        expansion: null,
        sourceRefs: ["source:home"],
      }],
    },
    comparisons: {
      status: "available",
      value: [{
        id: "comparison:rival",
        competitor: { key: "rival.example", name: "Rival", confirmed: true },
        checkedAt: AT,
        rows: [{
          id: "comparison-row:team-size",
          dimension: "Supported team size",
          product: "Teams of 2",
          competitor: "Teams of 5",
          sourceRefs: ["source:home", "source:rival"],
          availability: "available",
        }],
        verdict: "Example Cloud supports teams of 2; Rival supports teams of 5.",
        sourceRefs: ["source:home", "source:rival"],
      }],
    },
    scope: {
      status: "available",
      value: {
        does: [statement("scope:does", "Supports teams of 2.")],
        doesNot: [statement("scope:not", "Does not replace human approval.")],
        needsHuman: [statement("scope:human", "A person approves each workflow.")],
        misconceptions: [statement("scope:myth", "It is workflow software, not a human team.")],
      },
    },
    evidence: {
      status: "available",
      value: {
        proof: [{
          id: "evidence:docs",
          label: "Product documentation",
          summary: "The documentation describes support for teams of 2.",
          url: "https://example.com/docs",
          sourceRefs: ["source:home"],
        }],
        changelog: [],
        press: [],
        thirdPartyProfiles: [],
      },
    },
    machine: {
      status: "available",
      value: {
        jsonLd: { status: "present", types: ["Organization"], sourceRefs: ["source:home"] },
        llms: { status: "present", sourceRefs: ["source:llms"] },
        robots: { status: "present", sourceRefs: ["source:robots"] },
        sitemap: { status: "present", urlCount: 2, knowledgePagesListed: true, sourceRefs: ["source:sitemap"] },
        hreflang: { status: "present", locales: ["en-US"], sourceRefs: ["source:home"] },
      },
    },
    coverage: {
      status: "available",
      value: [{
        id: "coverage:entity",
        label: "Entity definition",
        status: "covered",
        summary: "Definitions are supported by the product page.",
        nextAction: null,
        sourceRefs: ["source:home"],
      }],
    },
    sourceCatalogue: [
      {
        id: "source:home", kind: "own_page", label: "Product page", url: "https://example.com/",
        competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH_A,
        excerpts: ["Example Cloud is workflow software. It supports teams of 2. A person approves each workflow. It does not replace human approval."],
      },
      {
        id: "source:rival", kind: "competitor_page", label: "Rival product page", url: "https://rival.example/",
        competitor: { key: "rival.example", name: "Rival", confirmed: true }, availability: "available", reason: null,
        observedAt: AT, bodyHash: HASH_B, excerpts: ["Rival supports teams of 5."],
      },
      {
        id: "source:llms", kind: "llms", label: "llms.txt", url: "https://example.com/llms.txt",
        competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH_A,
        excerpts: ["Example Cloud product index."],
      },
      {
        id: "source:robots", kind: "robots", label: "robots.txt", url: "https://example.com/robots.txt",
        competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH_A,
        excerpts: ["User-agent: * Allow: /"],
      },
      {
        id: "source:sitemap", kind: "sitemap", label: "sitemap.xml", url: "https://example.com/sitemap.xml",
        competitor: null, availability: "available", reason: null, observedAt: AT, bodyHash: HASH_A,
        excerpts: ["Two product URLs were observed."],
      },
    ],
  };
}

describe("GEO customer knowledge pack contract", () => {
  it("builds and parses an evidence-bound pack with a deterministic content hash", () => {
    const first = buildGeoKnowledgePackV1(body());
    const second = buildGeoKnowledgePackV1(structuredClone(body()));

    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.contentHash).toBe(first.contentHash);
    expect(parseGeoKnowledgePackV1(first)).toEqual(first);
  });

  it("accepts partial modules with a readable limitation and unavailable modules without a value", () => {
    const value = body();
    value.qa = { status: "partial", limitation: "Only the supported use cases could be answered.", value: value.qa.value };
    value.scope = { status: "unavailable", reason: "generation_unavailable" };
    expect(() => buildGeoKnowledgePackV1(value)).not.toThrow();

    value.scope.value = { does: [], doesNot: [], needsHuman: [], misconceptions: [] };
    expect(() => buildGeoKnowledgePackV1(value)).toThrow();
  });

  it.each([
    ["unknown fields", (value: any) => { value.debug = true; }],
    ["invalid public URLs", (value: any) => { value.sourceCatalogue[0].url = "http://localhost/private"; }],
    ["invalid ISO timestamps", (value: any) => { value.meta.generatedAt = "2026-09-04"; }],
    ["duplicate content IDs", (value: any) => { value.facts.value.push({ ...value.facts.value[0] }); value.meta.counts.facts = 2; }],
    ["unknown source references", (value: any) => { value.facts.value[0].sourceRefs = ["source:unknown"]; }],
    ["unconfirmed competitor membership", (value: any) => { value.comparisons.value[0].competitor.key = "other.example"; }],
    ["oversized arrays", (value: any) => { value.entity.value.aliases = Array.from({ length: GEO_KNOWLEDGE_PACK_LIMITS.aliases + 1 }, (_, index) => `Alias ${index}`); }],
    ["oversized excerpts", (value: any) => { value.sourceCatalogue[0].excerpts = ["x".repeat(GEO_KNOWLEDGE_PACK_LIMITS.excerptCodePoints + 1)]; }],
    ["unsupported numeric claims", (value: any) => { value.qa.value[0].directAnswer = "Yes. It supports 99 teams."; }],
    ["numeric claims that drop the currency the evidence priced in", (value: any) => { value.sourceCatalogue[0].excerpts = ["Example Cloud is workflow software. It supports teams of 2. A seat costs ₩9,900. A person approves each workflow."]; value.qa.value[0].directAnswer = "Yes. Example Cloud supports teams of 2 and a seat costs 9,900."; }],
    ["numeric claims that swap the currency the evidence priced in", (value: any) => { value.sourceCatalogue[0].excerpts = ["Example Cloud is workflow software. It supports teams of 2. A seat costs ₩9,900. A person approves each workflow."]; value.qa.value[0].directAnswer = "Yes. Example Cloud supports teams of 2 and a seat costs ¥9,900."; }],
    ["inconsistent customer counts", (value: any) => { value.meta.counts.qa = 7; }],
  ])("rejects %s", (_label, mutate) => {
    const value = body();
    mutate(value);
    expect(() => buildGeoKnowledgePackV1(value)).toThrow();
  });

  it("accepts press evidence as a first-class customer evidence section", () => {
    const value = body();
    value.evidence.value.press.push({
      id: "evidence:press-1",
      label: "Industry press mention",
      summary: "An industry article describes Example Cloud as workflow software for teams of 2.",
      url: "https://example.com/press/example-cloud",
      sourceRefs: ["source:home"],
    });

    expect(() => buildGeoKnowledgePackV1(value)).not.toThrow();
  });

  it("allows available GSC and accepted-fact sources without a synthetic body hash", () => {
    const value = body();
    value.sourceCatalogue.push(
      {
        id: "source:gsc",
        kind: "gsc",
        label: "Search Console",
        url: null,
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: AT,
        bodyHash: null,
        excerpts: ["Teams of 2 workflow software"],
      },
      {
        id: "source:accepted-fact",
        kind: "accepted_fact",
        label: "Accepted exact fact",
        url: null,
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: AT,
        bodyHash: null,
        excerpts: ["It supports teams of 2."],
      },
    );
    value.facts.value[0].sourceRefs = ["source:accepted-fact"];
    value.qa.value[0].sourceRefs = ["source:gsc", "source:accepted-fact"];

    expect(() => buildGeoKnowledgePackV1(value)).not.toThrow();
  });

  it("rejects a comparison row that claims both sides without product-side and competitor-side support", () => {
    const value = body();
    value.comparisons.value[0].rows[0].sourceRefs = ["source:rival"];
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Unsupported comparison row evidence");

    value.comparisons.value[0].rows[0].sourceRefs = ["source:home"];
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Unsupported comparison row evidence");
  });

  it("rejects a comparison verdict that omits either product-side or competitor-side support", () => {
    const value = body();
    value.comparisons.value[0].sourceRefs = ["source:rival"];
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Unsupported comparison verdict evidence");

    value.comparisons.value[0].sourceRefs = ["source:home"];
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Unsupported comparison verdict evidence");
  });

  it("rejects customer claims that cite an unavailable source entry", () => {
    const value = body();
    value.sourceCatalogue[0] = {
      ...value.sourceCatalogue[0],
      availability: "unavailable",
      reason: "fetch_failed",
      observedAt: null,
      bodyHash: null,
      excerpts: [],
    };

    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Unavailable source reference");
  });

  it("rejects a content hash that does not identify the exact parsed body", () => {
    const pack = buildGeoKnowledgePackV1(body());
    expect(() => parseGeoKnowledgePackV1({ ...pack, contentHash: "f".repeat(64) })).toThrow("hash mismatch");
  });

  it("does not fabricate crawl observation metadata for accepted facts or GSC evidence", () => {
    const value = body();
    value.sourceCatalogue.push(
      {
        id: "source:accepted", kind: "accepted_fact", label: "Accepted fact", url: null, competitor: null,
        availability: "available", reason: null, observedAt: null, bodyHash: null,
        excerpts: ["Example Cloud supports teams of 2."],
      },
      {
        id: "source:gsc", kind: "gsc", label: "Search Console", url: null, competitor: null,
        availability: "partial", reason: "partial_body", observedAt: AT, bodyHash: null,
        excerpts: ["Example Cloud teams of 2"],
      },
    );
    value.facts.value[0].sourceRefs = ["source:accepted"];

    expect(() => buildGeoKnowledgePackV1(value)).not.toThrow();
  });

  it("retains typed timeout unavailability for modules and sources without observed content", () => {
    const value = body();
    value.scope = { status: "unavailable", reason: "timeout" };
    value.sourceCatalogue.push({
      id: "source:timeout", kind: "gsc", label: "Timed-out Search Console source", url: null, competitor: null,
      availability: "unavailable", reason: "timeout", observedAt: null, bodyHash: null, excerpts: [],
    });

    expect(() => buildGeoKnowledgePackV1(value)).not.toThrow();
  });

  it("uses unavailable machine probes as evidence for missing resources and customer coverage gaps", () => {
    const value = body();
    value.sourceCatalogue[2] = {
      ...value.sourceCatalogue[2], availability: "unavailable", reason: "not_found",
      observedAt: null, bodyHash: null, excerpts: [],
    };
    value.sourceCatalogue[3] = {
      ...value.sourceCatalogue[3], availability: "unavailable", reason: "timeout",
      observedAt: null, bodyHash: null, excerpts: [],
    };
    value.machine.value.llms = { status: "absent", sourceRefs: ["source:llms"] };
    value.machine.value.robots = { status: "unreachable", sourceRefs: ["source:robots"] };
    value.coverage.value.push({
      id: "coverage:machine-gap",
      label: "2 machine resources need attention",
      status: "missing",
      summary: "The llms and robots probes did not produce readable content.",
      nextAction: "Publish llms guidance and retry the robots check.",
      sourceRefs: ["source:llms", "source:robots"],
    });

    expect(() => buildGeoKnowledgePackV1(value)).not.toThrow();
  });

  it("requires machine resource status to agree with the cited probe availability", () => {
    const absentButAvailable = body();
    absentButAvailable.machine.value.llms.status = "absent";
    expect(() => buildGeoKnowledgePackV1(absentButAvailable)).toThrow("Machine source availability mismatch");

    const absentStructuredSignals = body();
    absentStructuredSignals.machine.value.jsonLd = { status: "absent", types: [], sourceRefs: ["source:home"] };
    absentStructuredSignals.machine.value.hreflang = { status: "absent", locales: [], sourceRefs: ["source:home"] };
    expect(() => buildGeoKnowledgePackV1(absentStructuredSignals)).not.toThrow();
  });

  it("requires source-kind-specific provenance and strips all evidence from unavailable sources", () => {
    const accepted = body();
    accepted.sourceCatalogue.push({
      id: "source:accepted", kind: "accepted_fact", label: "Accepted fact", url: null, competitor: null,
      availability: "partial", reason: null, observedAt: null, bodyHash: null, excerpts: ["Supported fact"],
    });
    expect(() => buildGeoKnowledgePackV1(accepted)).toThrow();

    const gsc = body();
    gsc.sourceCatalogue.push({
      id: "source:gsc", kind: "gsc", label: "Search Console", url: null, competitor: null,
      availability: "available", reason: null, observedAt: null, bodyHash: null, excerpts: ["Observed query"],
    });
    expect(() => buildGeoKnowledgePackV1(gsc)).toThrow();

    const crawl = body();
    crawl.sourceCatalogue[0].bodyHash = null;
    expect(() => buildGeoKnowledgePackV1(crawl)).toThrow();

    const unavailable = body();
    unavailable.sourceCatalogue[2] = {
      ...unavailable.sourceCatalogue[2], availability: "unavailable", reason: "not_found",
      observedAt: AT, bodyHash: HASH_A, excerpts: ["This must not survive."],
    };
    expect(() => buildGeoKnowledgePackV1(unavailable)).toThrow();
  });

  it.each([
    ["product side", ["source:robots", "source:rival"]],
    ["competitor side", ["source:home", "source:robots"]],
  ])("requires an own-page and matching competitor-page citation for each available comparison row: %s", (_side, sourceRefs) => {
    const value = body();
    value.comparisons.value[0].rows[0] = {
      ...value.comparisons.value[0].rows[0],
      product: "Workflow software",
      competitor: "Workflow software",
      sourceRefs,
    };
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("comparison");
  });

  it("requires both evidence sides for the comparison verdict", () => {
    const value = body();
    value.comparisons.value[0].verdict = "The products have different documented workflows.";
    value.comparisons.value[0].sourceRefs = ["source:robots", "source:rival"];
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("comparison");
  });

  it("allows partial comparison rows to omit an unknown side but scopes every retained value", () => {
    const productOnly = body();
    productOnly.comparisons.value[0].rows[0] = {
      ...productOnly.comparisons.value[0].rows[0], competitor: null,
      sourceRefs: ["source:home"], availability: "partial",
    };
    expect(() => buildGeoKnowledgePackV1(productOnly)).not.toThrow();

    const competitorOnly = body();
    competitorOnly.comparisons.value[0].rows[0] = {
      ...competitorOnly.comparisons.value[0].rows[0], product: null,
      sourceRefs: ["source:rival"], availability: "partial",
    };
    expect(() => buildGeoKnowledgePackV1(competitorOnly)).not.toThrow();

    const wronglyScoped = body();
    wronglyScoped.comparisons.value[0].rows[0] = {
      ...wronglyScoped.comparisons.value[0].rows[0],
      product: "Workflow software", competitor: null,
      sourceRefs: ["source:rival"], availability: "partial",
    };
    expect(() => buildGeoKnowledgePackV1(wronglyScoped)).toThrow("comparison");
  });

  it("rejects customer claims that cite an unavailable source", () => {
    const value = body();
    value.sourceCatalogue.push({
      id: "source:unavailable-fact", kind: "accepted_fact", label: "Unavailable accepted fact", url: null, competitor: null,
      availability: "unavailable", reason: "not_found", observedAt: null, bodyHash: null, excerpts: [],
    });
    value.facts.value[0].sourceRefs = ["source:unavailable-fact"];
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Unavailable source");
  });

  it.each([
    ["non-normalized URL", (value: any) => { value.sourceCatalogue[0].url = "https://example.com"; }],
    ["foreign own-page host", (value: any) => { value.sourceCatalogue[0].url = "https://other.example/"; }],
    ["foreign competitor host", (value: any) => { value.sourceCatalogue[1].url = "https://other.example/"; }],
    ["wrong llms path", (value: any) => { value.sourceCatalogue[2].url = "https://example.com/ai.txt"; }],
    ["wrong robots path", (value: any) => { value.sourceCatalogue[3].url = "https://example.com/crawlers.txt"; }],
    ["wrong sitemap path", (value: any) => { value.sourceCatalogue[4].url = "https://example.com/feed.xml"; }],
  ])("rejects source URL scope: %s", (_label, mutate) => {
    const value = body();
    mutate(value);
    expect(() => buildGeoKnowledgePackV1(value)).toThrow();
  });

  it("enforces bounded page and machine-source cardinality", () => {
    const ownPages = body();
    ownPages.sourceCatalogue.push(...Array.from({ length: 8 }, (_, index) => ({
      id: `source:own-${index}`, kind: "own_page", label: `Own page ${index}`,
      url: `https://example.com/page-${index}`, competitor: null,
      availability: "available", reason: null, observedAt: AT, bodyHash: HASH_A, excerpts: ["Product page."],
    })));
    expect(() => buildGeoKnowledgePackV1(ownPages)).toThrow();

    const competitors = body();
    competitors.sourceCatalogue.push(...Array.from({ length: 5 }, (_, index) => ({
      id: `source:competitor-${index}`, kind: "competitor_page", label: `Competitor ${index}`,
      url: `https://rival-${index}.example/`, competitor: { key: `rival-${index}.example`, name: `Rival ${index}`, confirmed: true },
      availability: "available", reason: null, observedAt: AT, bodyHash: HASH_B, excerpts: ["Competitor product page."],
    })));
    expect(() => buildGeoKnowledgePackV1(competitors)).toThrow();

    const competitorPages = body();
    competitorPages.sourceCatalogue.push(...[1, 2].map((index) => ({
      ...competitorPages.sourceCatalogue[1], id: `source:rival-${index}`, url: `https://rival.example/page-${index}`,
    })));
    expect(() => buildGeoKnowledgePackV1(competitorPages)).toThrow();

    const machine = body();
    machine.sourceCatalogue.push({ ...machine.sourceCatalogue[3], id: "source:robots-copy" });
    expect(() => buildGeoKnowledgePackV1(machine)).toThrow();
  });

  it.each([
    ["jsonLd", "source:robots"],
    ["hreflang", "source:robots"],
    ["llms", "source:robots"],
    ["robots", "source:llms"],
    ["sitemap", "source:robots"],
  ])("requires %s observations to cite the matching source kind", (field, sourceId) => {
    const value = body();
    value.machine.value[field].sourceRefs = [sourceId];
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Machine source kind mismatch");
  });

  it("derives one own-site host from machine sources when entity and own pages are unavailable", () => {
    const machineOnly = body();
    machineOnly.meta.counts = { facts: 0, qa: 0, comparisons: 0 };
    for (const key of ["entity", "facts", "qa", "comparisons", "scope", "evidence", "machine", "coverage"]) {
      machineOnly[key] = { status: "unavailable", reason: "insufficient_evidence" };
    }
    machineOnly.sourceCatalogue = machineOnly.sourceCatalogue.filter((source: any) => ["llms", "robots", "sitemap"].includes(source.kind));
    expect(() => buildGeoKnowledgePackV1(machineOnly)).not.toThrow();

    machineOnly.sourceCatalogue.find((source: any) => source.kind === "robots").url = "https://other.example/robots.txt";
    expect(() => buildGeoKnowledgePackV1(machineOnly)).toThrow("Foreign own-site source");
  });

  it("requires both sitemap result fields when the sitemap is present", () => {
    const value = body();
    value.machine.value.sitemap.knowledgePagesListed = null;
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Invalid sitemap observation");
  });

  it.each([
    ["after pack generation", "2026-09-05T00:00:00.000Z"],
    ["before cited source observations", "2026-09-04T06:00:00.000Z"],
  ])("rejects a comparison checked %s", (_label, checkedAt) => {
    const value = body();
    value.comparisons.value[0].checkedAt = checkedAt;
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("comparison check time");
  });

  it.each([
    ["product", "Teams of 2", null],
    ["competitor", null, "Teams of 5"],
  ])("requires both comparison values to be null when an unavailable row retains the %s side", (_side, product, competitor) => {
    const value = body();
    value.comparisons.value[0].rows[0] = {
      ...value.comparisons.value[0].rows[0], product, competitor, availability: "unavailable",
    };
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("Unavailable comparison row");
  });

  it("checks the byte limit against the final pack including its content hash", () => {
    const value = body();
    value.sourceCatalogue.push(...Array.from(
      { length: GEO_KNOWLEDGE_PACK_LIMITS.sources - value.sourceCatalogue.length },
      (_, index) => ({
        id: `source:accepted-${index}`, kind: "accepted_fact", label: `Accepted fact ${index}`,
        url: null, competitor: null, availability: "available", reason: null, observedAt: null, bodyHash: null,
        excerpts: Array.from({ length: GEO_KNOWLEDGE_PACK_LIMITS.excerptsPerSource }, () => "界".repeat(640)),
      }),
    ));
    const packedOverhead = geoV2JsonbBytes({ ...value, contentHash: HASH_A }) - geoV2JsonbBytes(value);
    let padding = GEO_KNOWLEDGE_PACK_LIMITS.maxBytes - geoV2JsonbBytes(value) - Math.floor(packedOverhead / 2);
    for (const source of value.sourceCatalogue.slice(5)) {
      for (let index = 0; index < source.excerpts.length && padding > 0; index += 1) {
        const room = GEO_KNOWLEDGE_PACK_LIMITS.excerptCodePoints - Array.from(source.excerpts[index]).length;
        const added = Math.min(room, padding);
        source.excerpts[index] += "x".repeat(added);
        padding -= added;
      }
    }
    expect(padding).toBe(0);
    expect(geoV2JsonbBytes(value)).toBeLessThanOrEqual(GEO_KNOWLEDGE_PACK_LIMITS.maxBytes);
    expect(geoV2JsonbBytes({ ...value, contentHash: HASH_A })).toBeGreaterThan(GEO_KNOWLEDGE_PACK_LIMITS.maxBytes);
    expect(() => buildGeoKnowledgePackV1(value)).toThrow("byte limit");
  });

  it("enforces the total serialized byte limit after field-level validation", () => {
    const value = body();
    const hugeExcerpt = "💡".repeat(GEO_KNOWLEDGE_PACK_LIMITS.excerptCodePoints);
    value.sourceCatalogue.push(...Array.from(
      { length: GEO_KNOWLEDGE_PACK_LIMITS.sources - value.sourceCatalogue.length },
      (_, index) => ({
        id: `source:bulk-${index}`,
        kind: "accepted_fact",
        label: `Bulk source ${index}`,
        url: null,
        competitor: null,
        availability: "available",
        reason: null,
        observedAt: null,
        bodyHash: null,
        excerpts: Array.from({ length: GEO_KNOWLEDGE_PACK_LIMITS.excerptsPerSource }, () => hugeExcerpt),
      }),
    ));

    expect(() => buildGeoKnowledgePackV1(value)).toThrow("byte limit");
  });
});
