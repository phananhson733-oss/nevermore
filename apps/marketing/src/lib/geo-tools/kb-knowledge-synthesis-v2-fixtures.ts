// @input -- nothing; these are synthetic offline fixtures for v2 contract tests
// @output -- one evidence bundle, one synthesis input v2 and one narrative v2
// @pos -- test support only; never a default, seed or production fallback
import { buildGeoKnowledgeEvidenceV1 } from "./kb-knowledge-evidence.ts";
import {
  buildGeoKnowledgeSynthesisInputV2,
  type GeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";

export const V2_AT = "2026-09-04T07:11:15.461Z";
export const V2_HASH = "a".repeat(64);
export const V2_GENERATION_INPUT_HASH = "d".repeat(64);
/**
 * UUIDv8 on purpose. The product's entity identities are v8, so a fixture that
 * used a v4 id would pass under a version-pinning validator and hide the very
 * rejection this contract has to avoid.
 */
export const V2_WEBSITE_ID = "1f08f279-3b6c-8d4e-9a1b-2c3d4e5f6a7b";
export const V2_SNAPSHOT_ID = "2a19e380-4c7d-8e5f-8b2c-3d4e5f6a7b8c";
export const V2_KB_ID = "3b2af491-5d8e-8f60-9c3d-4e5f6a7b8c9d";
export const V2_GENERATION_ID = "4c3bf5a2-6e9f-8071-ad4e-5f6a7b8c9d0e";

export function geoV2ProfileRefFixture() {
  return {
    websiteId: V2_WEBSITE_ID,
    snapshotId: V2_SNAPSHOT_ID,
    snapshotRevision: "3",
    profileHash: "b".repeat(64),
    subsetHash: "c".repeat(64),
    subset: {
      productName: "Pine Cloud",
      oneLinePositioning: "Project software for very small teams.",
      coreFeatures: ["Approval workflow"],
      country: "US",
      locale: "en-US",
      categories: ["Project software"],
      buyer: "Operations lead",
      primaryIcp: "Two-person operations teams",
      triggerPain: "Approvals get lost in chat.",
      icpPain: "No audit trail for approvals.",
      qualificationSignals: ["Currently approves work in spreadsheets"],
      icpInterests: ["Workflow automation"],
      directCompetitors: ["Rival"],
      fieldProvenance: [
        { path: "/productName" as const, derivation: "declared" as const, observedAt: V2_AT, evidenceUrl: null },
      ],
    },
  };
}

export function geoV2EvidenceFixture() {
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1",
    collectedAt: V2_AT,
    targetUrl: "https://product.example/",
    confirmedCompetitors: [{ key: "rival.example", name: "Rival", confirmed: true }],
    availability: "partial",
    limitation: "One endpoint was unavailable.",
    pages: [],
    machine: {
      jsonLd: { status: "absent", types: [], sourceRefs: ["source:own"] },
      llms: { status: "absent", sourceRefs: ["source:llms"] },
      robots: { status: "present", sourceRefs: ["source:robots"] },
      sitemap: { status: "present", sourceRefs: ["source:sitemap"], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false },
      hreflang: { status: "absent", locales: [], sourceRefs: ["source:own"] },
    },
    sourceCatalogue: [
      {
        id: "source:own", kind: "own_page", label: "Product page", url: "https://product.example/", competitor: null,
        availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: [
          "Pine Cloud is project software for teams of 2. It requires human approval.",
          "Pro is $9 per month. Team is $19 per month.",
        ],
      },
      {
        id: "source:rival", kind: "competitor_page", label: "Rival page", url: "https://rival.example/",
        competitor: { key: "rival.example", name: "Rival", confirmed: true },
        availability: "partial", reason: "partial_body", observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: ["Rival supports teams of 5."],
      },
      {
        id: "source:robots", kind: "robots", label: "robots.txt", url: "https://product.example/robots.txt", competitor: null,
        availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH, excerpts: ["User-agent: *"],
      },
      {
        id: "source:sitemap", kind: "sitemap", label: "sitemap.xml", url: "https://product.example/sitemap.xml", competitor: null,
        availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH, excerpts: ["https://product.example/"],
      },
      {
        id: "source:llms", kind: "llms", label: "llms.txt", url: "https://product.example/llms.txt", competitor: null,
        availability: "unavailable", reason: "not_found", observedAt: null, bodyHash: null, excerpts: [],
      },
    ],
  });
}

export function geoV2SynthesisInputFixture(): GeoKnowledgeSynthesisInputV2 {
  return buildGeoKnowledgeSynthesisInputV2({
    officialName: "Pine Cloud",
    aliases: ["Pine"],
    categoryTerms: ["Project software"],
    market: "US",
    language: "en-US",
    profileRef: geoV2ProfileRefFixture(),
    generationInputHash: V2_GENERATION_INPUT_HASH,
  }, geoV2EvidenceFixture());
}

/**
 * Three of the four facts share a subject and an attribute and differ only by
 * qualifier: that is the case section 4.4 exists for, so the happy path has to
 * carry it. The fourth is unqualified, and one of the three is unavailable.
 */
export function geoV2NarrativeFixture() {
  return {
    schemaVersion: "marketing-geo-knowledge-narrative.v2",
    entity: {
      definitions: {
        w25: "Pine Cloud is project software for teams of 2.",
        w55: "Pine Cloud is project software for teams of 2 with human approval.",
        w120: "Pine Cloud is project software for teams of 2. Each workflow requires human approval.",
      },
      audience: { who: "Teams of 2", notFor: null as string | null },
      founded: { year: null as string | null, team: null as string | null, location: null as string | null },
      disambiguation: null as string | null,
      sourceRefs: ["source:own"],
    },
    facts: [
      {
        id: "fact:teams", type: "feature", statement: "Pine Cloud supports teams of 2.",
        label: "Supported team size", value: "2" as string | null, reason: "",
        subject: "Pine Cloud", attribute: "Supported team size", qualifiers: [] as string[],
        sourceRefs: ["source:own"],
      },
      {
        id: "fact:pro-price", type: "price", statement: "The Pro plan costs $9 per month.",
        label: "Monthly price", value: "$9" as string | null, reason: "",
        subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Pro plan"] as string[],
        sourceRefs: ["source:own"],
      },
      {
        id: "fact:team-price", type: "price", statement: "The Team plan costs $19 per month.",
        label: "Monthly price", value: "$19" as string | null, reason: "",
        subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Team plan"] as string[],
        sourceRefs: ["source:own"],
      },
      {
        id: "fact:enterprise-price", type: "price", statement: "Enterprise pricing stays unpublished.",
        label: "Monthly price", value: null as string | null, reason: "notPublished",
        subject: "Pine Cloud", attribute: "Monthly price", qualifiers: ["Enterprise plan"] as string[],
        sourceRefs: ["source:own"],
      },
    ],
    qa: [
      {
        id: "qa:teams", intent: "applicability",
        question: "Does Pine Cloud support teams of 2?",
        canonicalQuestion: "Does Pine Cloud support teams of 2?",
        variants: [] as string[],
        directAnswer: "Yes. Pine Cloud supports teams of 2.",
        expansion: null as string | null,
        sourceRefs: ["source:own"],
      },
      {
        id: "qa:definition", intent: "definition",
        question: "What is Pine Cloud?",
        canonicalQuestion: "What is Pine Cloud?",
        variants: ["What does Pine Cloud do?"] as string[],
        directAnswer: "Pine Cloud is project software for teams of 2 that requires human approval.",
        expansion: null as string | null,
        sourceRefs: ["source:own"],
      },
    ],
    comparisons: [
      {
        id: "comparison:rival",
        competitor: { key: "rival.example", name: "Rival", confirmed: true },
        rows: [
          {
            id: "comparison-row:teams", dimension: "Supported team size",
            product: "Teams of 2" as string | null, competitor: "Teams of 5" as string | null,
            sourceRefs: ["source:own", "source:rival"], availability: "available",
          },
        ],
        verdict: "Pine Cloud supports teams of 2; Rival supports teams of 5.",
        sourceRefs: ["source:own", "source:rival"],
      },
    ],
    scope: {
      does: [{ id: "scope:does", text: "Supports teams of 2.", sourceRefs: ["source:own"] }],
      doesNot: [] as Array<{ id: string; text: string; sourceRefs: string[] }>,
      needsHuman: [{ id: "scope:human", text: "Requires human approval.", sourceRefs: ["source:own"] }],
      misconceptions: [] as Array<{ id: string; text: string; sourceRefs: string[] }>,
    },
  };
}
