import { buildContentShadowInputManifest } from "../../research/manifest.ts";
import { buildResearchPack } from "../../research/research-pack.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../../version.ts";
import type {
  BriefOutlineProjectionStats,
  ContentShadowBriefOutline,
  ContentShadowFirstPartyIdentity,
  ContentShadowResearchContext,
  QaEvaluationInput,
  ResearchPack,
  ResearchSource,
  RetrievedResearchSnapshot,
} from "../../types.ts";

/** The frozen brief outline used by most fixtures. */
export const FIXTURE_OUTLINE: ContentShadowBriefOutline = {
  briefSections: ["What onboarding analytics covers", "Audience"],
  targetKeywords: ["onboarding analytics"],
  pageAssignment: "existing_page",
};

/**
 * The customer's own web identity, matching the host the draft fixtures link
 * to. Fixtures that need an unknown-origin project override it.
 */
export const FIXTURE_FIRST_PARTY: ContentShadowFirstPartyIdentity = {
  siteOrigin: "https://signalframe.example",
  icpPrimaryConversionUrl: "https://book.signalframe-demo.example/onboarding",
};

export const FIXTURE_STATS: BriefOutlineProjectionStats = {
  briefSectionCount: 2,
  projectedSectionCount: 2,
  clusterKeywordCount: 1,
  projectedKeywordCount: 1,
  unconfirmedMappingCount: 0,
};

const FIXTURE_KEYWORD_ID = "00000000-0000-4000-8000-00000000000a";
const FIXTURE_PAGE_SNAPSHOT_ID = "00000000-0000-4000-8000-00000000000b";
const FIXTURE_DATA_SNAPSHOT_ID = "00000000-0000-4000-8000-00000000000c";
const FIXTURE_PAGE_URL = "https://signalframe.example/editorial-policy";
const FIXTURE_PAGE_TEXT = [
  "The editorial policy asks writers to explain operational tradeoffs in plain",
  "language. It describes review ownership, source capture, correction records,",
  "and the difference between customer statements and independent research.",
  "Every published claim should keep its frozen provenance visible to the",
  "reviewer. Marketing adjectives never replace the evidence behind a statement.",
].join(" ");

const FIXTURE_RESEARCH_CONTEXT: ContentShadowResearchContext = {
  firstPartyPageSnapshots: [
    {
      pageSnapshotId: FIXTURE_PAGE_SNAPSHOT_ID,
      dataSnapshotId: FIXTURE_DATA_SNAPSHOT_ID,
      url: FIXTURE_PAGE_URL,
      urlHash: "a".repeat(64),
      contentHash: "b".repeat(64),
      capturedAt: "2026-07-27T08:00:00.000Z",
    },
  ],
  searchKeywordFacts: [
    {
      id: FIXTURE_KEYWORD_ID,
      display: "onboarding analytics",
      market: "US",
      language: "en",
      intent: "commercial",
      buyerStage: "consideration",
      cluster: "onboarding-analytics",
      mapping: {
        decision: "existing_page",
        mappedSitePageId: FIXTURE_PAGE_SNAPSHOT_ID,
        reviewState: "confirmed",
        revision: 1,
      },
      lastSeen: "2026-07-27T07:00:00.000Z",
      evidenceRefs: [],
    },
  ],
  generativeKeywordFacts: [],
  competitorFacts: [],
  externalTargets: [],
  contentPolicy: {
    brandConstraints: [],
    complianceConstraints: [],
    prohibitedTerms: [],
    claimRestrictions: [
      "no_guarantees",
      "no_unsupported_quantified_claims",
      "no_unverified_superlatives",
    ],
  },
};

const FIXTURE_RETRIEVED_SNAPSHOTS: readonly RetrievedResearchSnapshot[] = [
  {
    ref: FIXTURE_PAGE_SNAPSHOT_ID,
    kind: "first_party_page",
    label: "SignalFrame editorial policy",
    requestedUrl: FIXTURE_PAGE_URL,
    url: FIXTURE_PAGE_URL,
    availability: "available",
    capturedAt: "2026-07-27T08:00:00.000Z",
    urlHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    contentHashMethod: "sha256_canonical_extract",
    contentText: FIXTURE_PAGE_TEXT,
    contentTruncated: false,
    excerpt: FIXTURE_PAGE_TEXT,
    excerptTruncated: false,
    metrics: {
      status: 200,
      contentType: "text/html",
      bodyBytes: FIXTURE_PAGE_TEXT.length,
      wordCount: FIXTURE_PAGE_TEXT.split(/\s+/).length,
      responseMs: null,
      redirectChain: [],
    },
    evidenceRefs: [],
    limitation: null,
  },
];

export function fixturePack(
  overrides: {
    readonly outline?: ContentShadowBriefOutline;
    readonly outputLocale?: string;
    readonly stats?: BriefOutlineProjectionStats;
    readonly firstParty?: ContentShadowFirstPartyIdentity;
    readonly includeFirstPartyPageSnapshots?: boolean;
  } = {},
): ResearchPack {
  const outline = overrides.outline ?? FIXTURE_OUTLINE;
  const includeFirstPartyPageSnapshots =
    overrides.includeFirstPartyPageSnapshots ?? true;
  return buildResearchPack(
    buildContentShadowInputManifest({
      primaryFindingId: "00000000-0000-4000-8000-000000000001",
      sourceActionId: "00000000-0000-4000-8000-000000000002",
      sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000003",
      contentBriefArtifactId: "00000000-0000-4000-8000-000000000004",
      contentBriefRevision: 1,
      competitorEntityIds: [],
      searchCluster: {
        clusterKey: "onboarding-analytics",
        keywordEntityIds: [FIXTURE_KEYWORD_ID],
      },
      generativeQueryEntityIds: [],
      firstParty: overrides.firstParty ?? FIXTURE_FIRST_PARTY,
      contentBriefOutline: outline,
      researchContext: {
        ...FIXTURE_RESEARCH_CONTEXT,
        firstPartyPageSnapshots: includeFirstPartyPageSnapshots
          ? FIXTURE_RESEARCH_CONTEXT.firstPartyPageSnapshots
          : [],
      },
      flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
      promptSetVersion: "mvp.prompts.content-shadow.0.4.0",
      projectionVersion: "content-shadow.0.3.2",
      outputLocale: overrides.outputLocale ?? "en",
    }),
    overrides.stats ?? FIXTURE_STATS,
    includeFirstPartyPageSnapshots ? FIXTURE_RETRIEVED_SNAPSHOTS : [],
  );
}

/**
 * A pack whose sources carry legacy, non-page CITABLE identities.
 *
 * Governed packs now use `external_page`; older resolution tests intentionally
 * keep exercising human-readable competitor refs so backward-compatible
 * attribution shapes remain covered without rebuilding a page snapshot for
 * every case.
 */
export function packWithCitableSources(
  refs: readonly string[],
  base: ResearchPack = fixturePack(),
): ResearchPack {
  const sources: ResearchSource[] = refs.map((ref) => {
    const url = /^https?:\/\//i.test(ref) ? ref : null;
    return {
      kind: "competitor",
      ref,
      authorityTier: "B",
      label: ref,
      url,
      availability: "available",
      capturedAt: "2026-07-27T08:00:00.000Z",
      urlHash: url === null ? null : "c".repeat(64),
      contentHash: null,
      contentHashMethod: null,
      contentText: null,
      contentTruncated: false,
      excerpt: null,
      excerptTruncated: false,
      metrics: null,
      evidenceRefs: [],
      limitation: null,
    };
  });
  return { ...base, sources: [...base.sources, ...sources] };
}

/** A realistic confirmed brief the draft must not simply restate. */
export const FIXTURE_BRIEF = [
  "## What onboarding analytics covers",
  "",
  "Define the activation milestone and say who owns it.",
  "",
  "## Audience",
  "",
  "RevOps leads evaluating onboarding tooling.",
  "",
].join("\n");

export function qaInput(
  draftMarkdown: string,
  pack: ResearchPack = fixturePack(),
  stats: BriefOutlineProjectionStats = FIXTURE_STATS,
  briefMarkdown: string = FIXTURE_BRIEF,
): QaEvaluationInput {
  return { draftMarkdown, briefMarkdown, pack, briefOutlineStats: stats };
}
