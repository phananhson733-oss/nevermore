// @input -- nothing; these are hand-written v3 values used by tests
// @output -- a complete, parseable v3 draft and the pieces to vary in a test
// @pos -- test fixture shared by contract, assembler, publish and consumer tests
import { geoItemKey } from "./kb-item-key.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
import { parseGeoKbPayloadV3, type GeoKbPayloadV3 } from "./kb-v3-contract.ts";

export const V3_KB_ID = "11111111-1111-8111-8111-111111111113";
export const V3_WEBSITE_ID = "11111111-1111-8111-8111-111111111114";
export const V3_SNAPSHOT_ID = "11111111-1111-8111-8111-111111111115";
export const V3_TARGET_URL = "https://example.com/";
const PRICING_URL = "https://example.com/pricing";
const ROBOTS_URL = "https://example.com/robots.txt";
const LLMS_URL = "https://example.com/llms.txt";
const SITEMAP_URL = "https://example.com/sitemap.xml";
const PLANS_URL = "https://example.com/plans";
export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const OBSERVED_AT = "2026-09-01T00:00:00.000Z";
export const GENERATED_AT = "2026-09-02T00:00:00.000Z";

const OWN_SOURCE = "own:home";
const PRICING_SOURCE = "own:pricing";
const ROBOTS_SOURCE = "machine:robots";
const LLMS_SOURCE = "machine:llms";
const SITEMAP_SOURCE = "machine:sitemap";
export const PLANS_SOURCE = "own:plans";

export const FACT_KEY_PRO = geoItemKey({
  module: "facts", type: "price", subject: "Pro plan", attribute: "monthly price", qualifiers: ["usd", "monthly"],
});
export const FACT_KEY_TEAM = geoItemKey({
  module: "facts", type: "price", subject: "Team plan", attribute: "monthly price", qualifiers: ["usd", "monthly"],
});
export const QA_KEY = geoItemKey({ module: "qa", intent: "price", canonicalQuestion: "how much does it cost" });
export const SCOPE_KEY = geoItemKey({ module: "scope", kind: "doesNot", statement: "Acme does not run on Android." });
export const ENTITY_NAME_KEY = geoItemKey({ module: "entity", field: "name" });

function source(id: string, kind: string, url: string | null, excerpts: readonly string[]) {
  return {
    id, kind, label: id, url,
    competitor: null,
    availability: "available" as const,
    reason: null,
    observedAt: OBSERVED_AT,
    bodyHash: HASH_A,
    excerpts,
    independence: null,
  };
}

/**
 * A draft that exercises every module state a publish has to handle: two facts
 * that differ only by qualifier (so a correction to one must not reach the
 * other), one Q&A, one scope statement, an unavailable comparisons module, and
 * an evidence module that distinguishes "not collected" from "collected and
 * empty".
 */
/**
 * A draft whose recorded generation-input hash no longer matches the input it
 * carries -- what a payload edited in transit looks like. Publishing or
 * reviewing it must refuse rather than let the edit inherit the identity a paid
 * run established. Build it explicitly: a fixture that merely happens to carry
 * a wrong hash makes every such test pass for the wrong reason.
 */
export function stalePayloadV3(): GeoKbPayloadV3 {
  const base = completePayloadV3();
  return { ...base, runRef: { ...base.runRef, generationInputHash: HASH_B } };
}

/**
 * The same draft with `/pricing` and `/plans` disagreeing about the Pro price.
 * One content identity, two observations: the fact withholds its value rather
 * than picking a page arbitrarily, and the owner resolves it.
 */
export function conflictingPayloadV3(): GeoKbPayloadV3 {
  const base = completePayloadV3();
  const knowledge = JSON.parse(JSON.stringify(base.knowledge)) as {
    facts: { value: Record<string, unknown>[] };
    sourceCatalogue: unknown[];
  };
  knowledge.facts.value[0] = {
    ...knowledge.facts.value[0],
    value: null,
    reason: "conflicting",
    statement: "Two pages state different Pro plan prices.",
    sourceRefs: [PRICING_SOURCE, PLANS_SOURCE],
    alternateObservations: [
      { summary: "The Pro plan costs 9 per month.", sourceRefs: [PRICING_SOURCE], observedAt: OBSERVED_AT },
      { summary: "The Pro plan costs 19 per month.", sourceRefs: [PLANS_SOURCE], observedAt: OBSERVED_AT },
    ],
  };
  knowledge.sourceCatalogue.push(source(PLANS_SOURCE, "own_page", PLANS_URL, ["The Pro plan costs 19 per month."]));
  return parseGeoKbPayloadV3({ ...base, knowledge });
}

export function completePayloadV3(overrides: Partial<GeoKbPayloadV3> = {}): GeoKbPayloadV3 {
  const knowledge = {
    entity: {
      status: "available" as const,
      value: {
        name: "Acme",
        aliases: ["Acme Inc"],
        categories: { primary: "astrology software", secondary: [] },
        definitions: { w25: "Acme is a chart tool.", w55: "Acme is a chart tool for astrologers.", w120: "Acme is a chart tool for astrologers and their clients." },
        audience: { who: "Astrologers", notFor: null },
        founded: { year: null, team: null, location: null },
        disambiguation: null,
        links: { home: V3_TARGET_URL, pricing: null, docs: null, about: null, changelog: null, faq: null },
        sameAs: [],
        sourceRefs: [OWN_SOURCE],
        fields: [{
          field: "name", itemKey: ENTITY_NAME_KEY, origin: "observed_own" as const,
          sourceRefs: [OWN_SOURCE], evidenceChecks: "cited_and_literals_match" as const, alternateObservations: [],
        }],
      },
    },
    facts: {
      status: "available" as const,
      value: [
        {
          id: "fact:pro", type: "price" as const,
          statement: "The Pro plan costs 9 per month.",
          label: "Pro plan monthly price", value: "9", reason: "" as const,
          subject: "Pro plan", attribute: "monthly price", qualifiers: ["usd", "monthly"],
          observedAt: OBSERVED_AT, nextReviewAt: null,
          itemKey: FACT_KEY_PRO, origin: "observed_own" as const,
          sourceRefs: [PRICING_SOURCE], evidenceChecks: "cited_and_literals_match" as const, alternateObservations: [],
        },
        {
          id: "fact:team", type: "price" as const,
          statement: "The Team plan costs 29 per month.",
          label: "Team plan monthly price", value: "29", reason: "" as const,
          subject: "Team plan", attribute: "monthly price", qualifiers: ["usd", "monthly"],
          observedAt: OBSERVED_AT, nextReviewAt: null,
          itemKey: FACT_KEY_TEAM, origin: "observed_own" as const,
          sourceRefs: [PRICING_SOURCE], evidenceChecks: "cited_and_literals_match" as const, alternateObservations: [],
        },
      ],
    },
    qa: {
      status: "available" as const,
      value: [{
        id: "qa:price", intent: "price" as const,
        question: "How much does Acme cost?",
        canonicalQuestion: "how much does it cost",
        variants: [], directAnswer: "Plans start at 9 per month.", expansion: null,
        itemKey: QA_KEY, origin: "synthesized" as const,
        sourceRefs: [PRICING_SOURCE], evidenceChecks: "cited_and_literals_match" as const, alternateObservations: [],
      }],
    },
    comparisons: { status: "unavailable" as const, reason: "not_applicable" as const },
    scope: {
      status: "available" as const,
      value: {
        does: [],
        doesNot: [{
          id: "scope:android", text: "Acme does not run on Android.",
          itemKey: SCOPE_KEY, origin: "synthesized" as const,
          sourceRefs: [OWN_SOURCE], evidenceChecks: "cited_and_literals_match" as const, alternateObservations: [],
        }],
        needsHuman: [], misconceptions: [],
      },
    },
    evidence: {
      status: "partial" as const,
      limitation: "Off-site sources were not collected in this run.",
      value: {
        proof: [{ id: "evidence:home", label: "Home", summary: "Product overview.", url: V3_TARGET_URL, sourceRefs: [OWN_SOURCE], independence: "first_party" as const }],
        changelog: [],
        press: [],
        thirdPartyProfiles: [],
        firstPartyProof: [],
        // `changelog` was looked for and found nothing; press / thirdPartyProfiles
        // / firstPartyProof were never collected. v1 rendered both as absent.
        collected: ["proof", "changelog"] as const,
      },
    },
    machine: {
      status: "partial" as const,
      limitation: "Some machine-readable signals were absent.",
      value: {
        jsonLd: { status: "absent" as const, types: [], sourceRefs: [OWN_SOURCE] },
        llms: { status: "absent" as const, sourceRefs: [LLMS_SOURCE] },
        robots: { status: "present" as const, sourceRefs: [ROBOTS_SOURCE] },
        sitemap: { status: "absent" as const, urlCount: null, knowledgePagesListed: null, sourceRefs: [SITEMAP_SOURCE] },
        hreflang: { status: "absent" as const, locales: [], sourceRefs: [OWN_SOURCE] },
        aiCrawlers: {
          search: [{ agent: "OAI-SearchBot", access: "allowed" as const }],
          training: [{ agent: "GPTBot", access: "disallowed" as const }],
          sourceRefs: [ROBOTS_SOURCE],
        },
        snippets: { status: "allowed" as const, sourceRefs: [OWN_SOURCE] },
      },
    },
    coverage: {
      status: "partial" as const,
      limitation: "Some sections are incomplete.",
      value: [{ id: "coverage:facts", label: "Facts", status: "covered" as const, summary: "Supported content is available.", nextAction: null, sourceRefs: [PRICING_SOURCE] }],
    },
    sourceCatalogue: [
      source(OWN_SOURCE, "own_page", V3_TARGET_URL, ["Acme is a chart tool for astrologers. Acme does not run on Android."]),
      source(PRICING_SOURCE, "own_page", PRICING_URL, ["The Pro plan costs 9 per month. The Team plan costs 29 per month."]),
      source(ROBOTS_SOURCE, "robots", ROBOTS_URL, ["User-agent: GPTBot\nDisallow: /"]),
      source(LLMS_SOURCE, "llms", LLMS_URL, ["No llms.txt was served."]),
      source(SITEMAP_SOURCE, "sitemap", SITEMAP_URL, ["No sitemap was served."]),
    ],
    collectedAt: OBSERVED_AT,
    generatedAt: GENERATED_AT,
  };

  const generationInput = {
    identity: {
      targetUrl: V3_TARGET_URL,
      officialName: "Acme",
      aliases: ["Acme Inc"],
      categoryTerms: ["astrology software"],
      market: { country: "US", language: "en" },
    },
    profileRef: {
      websiteId: V3_WEBSITE_ID,
      snapshotId: V3_SNAPSHOT_ID,
      snapshotRevision: "3",
      profileHash: HASH_A,
      subsetHash: HASH_B,
      subset: {
        productName: "Acme",
        oneLinePositioning: "Charts for astrologers.",
        coreFeatures: ["birth charts"],
        country: "US",
        locale: "en",
        categories: ["astrology software"],
        buyer: "Astrologer",
        primaryIcp: "Independent astrologers",
        triggerPain: "Manual chart drawing",
        icpPain: "Slow chart production",
        qualificationSignals: ["runs a practice"],
        icpInterests: ["astrology"],
        directCompetitors: ["astro.example"],
        fieldProvenance: [{ path: "/productName", derivation: "declared", observedAt: null, evidenceUrl: null }],
      },
    },
    competitors: [{ domain: "astro.example", brandName: "Astro", confirmed: true }],
    roles: [{
      id: "r1", label: "Independent astrologers", questionLabel: "independent astrologers",
      segment: "solo practitioners", painPoints: ["manual charts"], decisionCriteria: ["speed"],
      vocabulary: ["natal chart"], alternatives: ["paper"], review: "accepted",
      source: { kind: "manual", generationId: null, itemId: null, evidenceRefs: ["manual:r1"] },
    }],
    evidenceContentHash: HASH_A,
  };

  return parseGeoKbPayloadV3({
    schemaVersion: "marketing-geo-kb.v3",
    generationInput,
    knowledge,
    review: { decisions: [], suppressions: [] },
    runRef: {
      runId: null,
      // The real digest, not a constant: publishing checks that the draft's
      // recorded hash matches the generation input it is about to reuse, and a
      // fixture carrying an arbitrary hash would let that check rot untested.
      generationInputHash: geoV2Digest(generationInput),
      rolesGenerationId: null,
      knowledgeGenerationId: null,
      questionsGenerationId: null,
    },
    ...overrides,
  });
}
