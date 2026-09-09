// @input -- nothing; synthetic offline evidence, narrative and offsite collections
// @output -- assembled v3 drafts a test can vary one dimension of at a time
// @pos -- test support only; never a default, seed or production fallback
import {
  buildGeoKnowledgeEvidenceV1,
  type GeoKnowledgeEvidenceV1,
} from "./kb-knowledge-evidence.ts";
import {
  buildGeoKnowledgeSynthesisInputV2,
  type GeoKnowledgeSynthesisInputV2,
} from "./kb-knowledge-synthesis-v2-contract.ts";
import {
  geoV2NarrativeFixture,
  geoV2ProfileRefFixture,
  V2_AT,
  V2_GENERATION_INPUT_HASH,
  V2_HASH,
} from "./kb-knowledge-synthesis-v2-fixtures.ts";
import type { GeoOffsiteCollection } from "./kb-offsite-collect.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";
import {
  assembleGeoKnowledgeBodyV3,
  type AssembleGeoKnowledgeV3Input,
  type GeoKnowledgeAssemblyV3,
} from "./kb-knowledge-assemble.ts";

export const TARGET_URL = "https://product.example/";
export const PLANS_URL = "https://product.example/plans";
export const OWN_SOURCE = "source:own";
export const PLANS_SOURCE = "source:plans";
export const THIRD_PARTY_URL = "https://directory.example/pine-cloud";
export const THIRD_PARTY_SOURCE = "source:directory";
export const ASSEMBLED_AT = "2026-09-05T00:00:00.000Z";

export interface EvidenceOptions {
  /** A second own page, so a test can move a claim to a different source page. */
  readonly plansExcerpts?: readonly string[];
  readonly faq?: readonly { readonly question: string; readonly answer: string }[];
  readonly robotsExcerpts?: readonly string[];
}

export function assemblyEvidence(options: EvidenceOptions = {}): GeoKnowledgeEvidenceV1 {
  const ownRefs = options.plansExcerpts === undefined ? [OWN_SOURCE] : [OWN_SOURCE, PLANS_SOURCE];
  const pages = options.faq === undefined ? [] : [{
    url: TARGET_URL,
    canonicalUrl: null,
    title: "Pine Cloud",
    description: null,
    lang: "en",
    jsonLdTypes: [],
    hreflangLocales: [],
    hreflang: [],
    faq: options.faq.map((pair) => ({ ...pair })),
    links: [],
  }];
  return buildGeoKnowledgeEvidenceV1({
    schemaVersion: "marketing-geo-knowledge-evidence.v1",
    collectedAt: V2_AT,
    targetUrl: TARGET_URL,
    confirmedCompetitors: [{ key: "rival.example", name: "Rival", confirmed: true }],
    availability: "partial",
    limitation: "One endpoint was unavailable.",
    pages,
    machine: {
      jsonLd: { status: "absent", types: [], sourceRefs: ownRefs },
      llms: { status: "absent", sourceRefs: ["source:llms"] },
      robots: { status: "present", sourceRefs: ["source:robots"] },
      sitemap: { status: "present", sourceRefs: ["source:sitemap"], urlCount: 0, knowledgePagesListed: false, locations: [], truncated: false },
      hreflang: { status: "absent", locales: [], sourceRefs: ownRefs },
    },
    sourceCatalogue: [
      {
        id: OWN_SOURCE, kind: "own_page", label: "Product page", url: TARGET_URL, competitor: null,
        availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: [
          "Pine Cloud is project software for teams of 2. It requires human approval.",
          "Pro is $9 per month. Team is $19 per month.",
        ],
      },
      ...(options.plansExcerpts === undefined ? [] : [{
        id: PLANS_SOURCE, kind: "own_page", label: "Plans page", url: PLANS_URL, competitor: null,
        availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: [...options.plansExcerpts],
      }]),
      {
        id: "source:rival", kind: "competitor_page", label: "Rival page", url: "https://rival.example/",
        competitor: { key: "rival.example", name: "Rival", confirmed: true },
        availability: "partial", reason: "partial_body", observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: ["Rival supports teams of 5."],
      },
      {
        id: "source:robots", kind: "robots", label: "robots.txt", url: "https://product.example/robots.txt", competitor: null,
        availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
        excerpts: [...(options.robotsExcerpts ?? ["User-agent: *"])],
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

export function assemblySynthesisInput(
  evidence: GeoKnowledgeEvidenceV1,
  officialName = "Pine Cloud",
): GeoKnowledgeSynthesisInputV2 {
  return buildGeoKnowledgeSynthesisInputV2({
    officialName,
    aliases: ["Pine"],
    categoryTerms: ["Project software"],
    market: "US",
    language: "en-US",
    profileRef: geoV2ProfileRefFixture(),
    generationInputHash: V2_GENERATION_INPUT_HASH,
  }, evidence);
}

/** One third-party page that named the brand and linked back to it. */
export function assemblyOffsite(): GeoOffsiteCollection {
  return {
    collectedAt: V2_AT,
    serp: {
      availability: "available", reason: null, market: "US", language: "en-US",
      queries: [{ kind: "brand_exact", query: "\"Pine Cloud\"", status: "ok", reason: null, resultsObserved: 1 }],
      candidates: [], costUsd: 0.003, unpricedQueries: 0, ownResultsSkipped: 0, competitorResultsSkipped: 0, candidatesDropped: 0,
    },
    sources: [{
      id: THIRD_PARTY_SOURCE, kind: "third_party_page", label: "directory.example", url: THIRD_PARTY_URL,
      competitor: null, availability: "available", reason: null, observedAt: V2_AT, bodyHash: V2_HASH,
      excerpts: ["Pine Cloud is project software, listed by our editors."],
      independence: "independent",
    }],
    evidence: {
      press: [],
      thirdPartyProfiles: [{
        id: `evidence:${THIRD_PARTY_SOURCE}`, label: "directory.example",
        summary: "Pine Cloud is project software, listed by our editors.",
        url: THIRD_PARTY_URL, sourceRefs: [THIRD_PARTY_SOURCE], independence: "independent",
      }],
      firstPartyProof: [],
      collected: ["press", "thirdPartyProfiles"],
    },
    sameAsCandidates: [{
      url: THIRD_PARTY_URL, sourceRef: THIRD_PARTY_SOURCE, host: "directory.example",
      verdict: "passed", basis: "page_body", namesBrand: true, linksToOfficialDomain: true, sameAsEligible: true,
    }],
    identityCandidates: [],
    incomplete: [],
    spent: {
      serpQueries: 1, costUsd: 0.003, unpricedSerpQueries: 0,
      pagesFetched: 1, pagesUnreadable: 0, elapsedMs: 1_200,
    },
  };
}

export const ASSEMBLY_IDENTITY: AssembleGeoKnowledgeV3Input["identity"] = {
  targetUrl: TARGET_URL,
  officialName: "Pine Cloud",
  aliases: ["Pine"],
  categoryTerms: ["Project software"],
  market: { country: "US", language: "en-US" },
};

export interface AssemblyFixtureOptions extends EvidenceOptions {
  /** Mutated in place; the caller varies one thing about the model's output. */
  readonly narrative?: (value: ReturnType<typeof geoV2NarrativeFixture>) => unknown;
  readonly offsite?: GeoOffsiteCollection | null;
  readonly narrativeFailureReason?: AssembleGeoKnowledgeV3Input["narrativeFailureReason"];
}

export function assemblyInput(options: AssemblyFixtureOptions = {}): AssembleGeoKnowledgeV3Input {
  const evidence = assemblyEvidence(options);
  const failed = options.narrativeFailureReason !== undefined;
  return {
    generatedAt: ASSEMBLED_AT,
    identity: ASSEMBLY_IDENTITY,
    evidence,
    offsite: options.offsite ?? null,
    synthesisInput: failed ? null : assemblySynthesisInput(evidence),
    narrative: failed ? null : (options.narrative ?? ((value: unknown) => value))(geoV2NarrativeFixture()),
    narrativeFailureReason: options.narrativeFailureReason ?? null,
  };
}

export function assembleFixture(options: AssemblyFixtureOptions = {}): GeoKnowledgeAssemblyV3 {
  return assembleGeoKnowledgeBodyV3(assemblyInput(options));
}

/** The assembled body wrapped in the payload the merge and the parser work on. */
export function assembledPayload(options: AssemblyFixtureOptions = {}): GeoKbPayloadV3 {
  return parseGeoKbPayloadV3({
    schemaVersion: "marketing-geo-kb.v3",
    generationInput: {
      identity: ASSEMBLY_IDENTITY,
      profileRef: geoV2ProfileRefFixture(),
      competitors: [{ domain: "rival.example", brandName: "Rival", confirmed: true }],
      roles: [],
      evidenceContentHash: V2_HASH,
    },
    knowledge: assembleFixture(options).knowledge,
    review: { decisions: [], suppressions: [] },
    runRef: {
      runId: null,
      generationInputHash: V2_GENERATION_INPUT_HASH,
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    },
  });
}
