import { describe, expect, it } from "vitest";
import { buildContentShadowInputManifest } from "./manifest.ts";
import {
  buildResearchPack,
  CONTENT_SHADOW_OUTLINE,
  MAX_RESEARCH_SOURCE_CONTENT_CHARS,
  ResearchSnapshotIntegrityError,
  researchPackToJson,
} from "./research-pack.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../version.ts";
import type {
  BriefOutlineProjectionStats,
  ContentShadowFrozenInput,
  RetrievedResearchSnapshot,
} from "../types.ts";

const KEYWORD_A = "00000000-0000-4000-8000-00000000000a";
const KEYWORD_B = "00000000-0000-4000-8000-00000000000b";
const GENERATIVE_A = "00000000-0000-4000-8000-00000000001a";
const COMPETITOR_A = "00000000-0000-4000-8000-00000000002a";
const PAGE_A = "00000000-0000-4000-8000-00000000003a";
const DATA_A = "00000000-0000-4000-8000-00000000004a";
const PAGE_URL = "https://acme.example/analytics";
const EXTERNAL_REF = "brief-link:https://research.example/report";
const EXTERNAL_URL = "https://research.example/report";

const FROZEN: ContentShadowFrozenInput = {
  primaryFindingId: "00000000-0000-4000-8000-000000000001",
  sourceActionId: "00000000-0000-4000-8000-000000000002",
  sourceDiagnosticRunId: "00000000-0000-4000-8000-000000000003",
  contentBriefArtifactId: "00000000-0000-4000-8000-000000000004",
  contentBriefRevision: 3,
  competitorEntityIds: [COMPETITOR_A],
  searchCluster: {
    clusterKey: "growth-analytics",
    keywordEntityIds: [KEYWORD_B, KEYWORD_A],
  },
  generativeQueryEntityIds: [GENERATIVE_A],
  firstParty: {
    siteOrigin: "https://acme.example",
    icpPrimaryConversionUrl: "https://acme.example/demo",
  },
  contentBriefOutline: {
    briefSections: ["Objective", "Audience"],
    targetKeywords: ["growth analytics"],
    pageAssignment: "existing_page",
  },
  researchContext: {
    firstPartyPageSnapshots: [
      {
        pageSnapshotId: PAGE_A,
        dataSnapshotId: DATA_A,
        url: PAGE_URL,
        urlHash: "a".repeat(64),
        contentHash: "b".repeat(64),
        capturedAt: "2026-07-24T12:00:00.000Z",
      },
    ],
    searchKeywordFacts: [
      {
        id: KEYWORD_B,
        display: "Product analytics",
        market: "US",
        language: "en",
        intent: null,
        buyerStage: null,
        cluster: "growth-analytics",
        mapping: {
          decision: "new_asset",
          mappedSitePageId: null,
          reviewState: "unreviewed",
          revision: 1,
        },
        lastSeen: "2026-07-24T10:00:00.000Z",
        evidenceRefs: [],
      },
      {
        id: KEYWORD_A,
        display: "Growth analytics",
        market: "US",
        language: "en",
        intent: "commercial",
        buyerStage: "consideration",
        cluster: "growth-analytics",
        mapping: {
          decision: "existing_page",
          mappedSitePageId: PAGE_A,
          reviewState: "confirmed",
          revision: 2,
        },
        lastSeen: "2026-07-24T11:00:00.000Z",
        evidenceRefs: ["evidence:search-a"],
      },
    ],
    generativeKeywordFacts: [
      {
        id: GENERATIVE_A,
        display: "What is growth analytics?",
        market: "US",
        language: "en",
        intent: "informational",
        buyerStage: "awareness",
        cluster: null,
        mapping: {
          decision: "unassigned",
          mappedSitePageId: null,
          reviewState: "unreviewed",
          revision: 0,
        },
        lastSeen: "2026-07-24T09:00:00.000Z",
        evidenceRefs: ["evidence:generative-a"],
      },
    ],
    competitorFacts: [
      {
        id: COMPETITOR_A,
        domain: "alpha.example",
        name: "Alpha",
        status: "approved",
        relationship: "direct",
        scopes: ["content", "positioning"],
        revision: 3,
      },
    ],
    externalTargets: [
      {
        ref: EXTERNAL_REF,
        kind: "content_brief_link",
        url: EXTERNAL_URL,
        label: "Research report",
      },
    ],
    contentPolicy: {
      brandConstraints: ["Use a practical voice"],
      complianceConstraints: ["Qualify forward-looking statements"],
      prohibitedTerms: ["guaranteed"],
      claimRestrictions: ["Do not publish unverified percentages"],
    },
  },
  flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
  promptSetVersion: "mvp.prompts.content-shadow.0.4.0",
  projectionVersion: "content-shadow.0.4.0",
  outputLocale: "en",
};

const STATS: BriefOutlineProjectionStats = {
  briefSectionCount: 2,
  projectedSectionCount: 2,
  clusterKeywordCount: 1,
  projectedKeywordCount: 1,
  unconfirmedMappingCount: 0,
};

const manifest = buildContentShadowInputManifest(FROZEN);

const SNAPSHOTS: readonly RetrievedResearchSnapshot[] = [
  {
    ref: EXTERNAL_REF,
    kind: "external_page",
    label: "Research report",
    requestedUrl: EXTERNAL_URL,
    url: "https://research.example/report/",
    availability: "available",
    capturedAt: "2026-07-25T10:00:00.000Z",
    urlHash: "c".repeat(64),
    contentHash: "d".repeat(64),
    contentHashMethod: "sha256_normalized_text",
    contentText: "Independent benchmark evidence.",
    excerpt: "Independent benchmark evidence.",
    contentTruncated: false,
    excerptTruncated: false,
    metrics: {
      status: 200,
      contentType: "text/html",
      bodyBytes: 4_096,
      wordCount: 3,
      responseMs: 120,
      redirectChain: ["https://research.example/report/"],
    },
    evidenceRefs: ["retrieval:external-a"],
    limitation: null,
  },
  {
    ref: PAGE_A,
    kind: "first_party_page",
    label: "Analytics",
    requestedUrl: PAGE_URL,
    url: PAGE_URL,
    availability: "available",
    capturedAt: "2026-07-24T12:00:00.000Z",
    urlHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    contentHashMethod: "sha256_canonical_extract",
    contentText: "Acme analytics product facts.",
    excerpt: "Acme analytics product facts.",
    contentTruncated: false,
    excerptTruncated: false,
    metrics: null,
    evidenceRefs: [`page-snapshot:${PAGE_A}`, `data-snapshot:${DATA_A}`],
    limitation: null,
  },
];

describe("buildResearchPack", () => {
  it("is deterministic: the same manifest yields a byte-identical pack", () => {
    expect(JSON.stringify(buildResearchPack(manifest, STATS, SNAPSHOTS))).toBe(
      JSON.stringify(
        buildResearchPack(manifest, STATS, [...SNAPSHOTS].reverse()),
      ),
    );
  });

  it("keeps search and generative observation in separate shapes", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);

    expect(pack.searchObservation.clusterKey).toBe("growth-analytics");
    expect(pack.searchObservation.keywordEntityIds).toEqual([
      KEYWORD_A,
      KEYWORD_B,
    ]);
    expect(pack.searchObservation.keywordFacts.map((fact) => fact.id)).toEqual([
      KEYWORD_A,
      KEYWORD_B,
    ]);
    expect(pack.generativeObservation.generativeQueryEntityIds).toEqual([
      GENERATIVE_A,
    ]);
    expect(
      pack.generativeObservation.keywordFacts.map((fact) => fact.id),
    ).toEqual([GENERATIVE_A]);
  });

  it("never emits a shared volume or any merged demand metric field", () => {
    // Invariant 8 is about STRUCTURE, not prose: a limitation may honestly say
    // "carries no demand volume", but no key may ever hold a merged metric.
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        walk(child);
      }
    };
    walk(buildResearchPack(manifest, STATS, SNAPSHOTS));

    for (const key of keys) {
      expect(key).not.toMatch(/volume|impression|click|combined|merged/i);
    }
    // The two observations never share a container.
    expect(keys.has("searchObservation")).toBe(true);
    expect(keys.has("generativeObservation")).toBe(true);
    expect(keys.has("queries")).toBe(false);
  });

  it("freezes the confirmed brief revision instead of recasting it", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);

    expect(pack.brief).toEqual({
      artifactId: FROZEN.contentBriefArtifactId,
      revision: 3,
    });
    expect(pack.outline).toEqual([...CONTENT_SHADOW_OUTLINE]);
  });

  it("emits auditable first-party and external pages without Authority D", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);

    expect(pack.sources.map((source) => source.kind)).toEqual([
      "content_brief",
      "first_party_site",
      "first_party_conversion",
      "first_party_page",
      "search_query",
      "search_query",
      "generative_query",
      "competitor",
      "external_page",
    ]);
    expect(
      pack.sources.every(
        (source) => (source.authorityTier as string) !== "D",
      ),
    ).toBe(true);
    const firstPartyPage = pack.sources.find(
      (source) => source.kind === "first_party_page",
    );
    expect(firstPartyPage).toMatchObject({
      ref: PAGE_A,
      label: "Analytics",
      url: PAGE_URL,
      availability: "available",
      capturedAt: "2026-07-24T12:00:00.000Z",
      urlHash: "a".repeat(64),
      contentHash: "b".repeat(64),
      contentHashMethod: "sha256_canonical_extract",
      contentText: "Acme analytics product facts.",
      contentTruncated: false,
      excerptTruncated: false,
    });
    expect(firstPartyPage?.evidenceRefs).toEqual([
      `data-snapshot:${DATA_A}`,
      `page-snapshot:${PAGE_A}`,
    ]);

    const externalPage = pack.sources.find(
      (source) => source.kind === "external_page",
    );
    expect(externalPage).toMatchObject({
      ref: EXTERNAL_REF,
      label: "Research report",
      url: "https://research.example/report/",
      availability: "available",
      contentHashMethod: "sha256_normalized_text",
      contentText: "Independent benchmark evidence.",
      contentTruncated: false,
      excerptTruncated: false,
    });
  });

  it("keeps every customer-visible research limitation free of the internal brand", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);
    const customerVisibleLimitations = [
      ...pack.limitations,
      ...pack.sources.map((source) => source.limitation),
    ];

    expect(customerVisibleLimitations.join("\n")).not.toMatch(/SignalFrame/i);
  });

  /**
   * The pack used to state, unconditionally, that the SEO/GEO judgement "is not
   * implemented yet". The read API returns this list verbatim, so a reviewer
   * looking at a draft the gate had really BLOCKED was told in the same
   * response that the block was a placeholder — which cancels out the one
   * verdict that matters. The remaining limitations have to describe what the
   * implemented gate does not check, not claim it does not exist.
   */
  it("derives limitations from actual retrieval and policy inputs", () => {
    const limitations = buildResearchPack(
      manifest,
      STATS,
      SNAPSHOTS,
    ).limitations.join(" ");

    expect(limitations).not.toMatch(/not implemented yet/i);
    expect(limitations).not.toMatch(/\bpending\b/i);
    expect(limitations).not.toMatch(/no external source/i);
    expect(limitations).not.toMatch(/no plagiarism detection/i);
    expect(limitations).not.toMatch(/no brand-tone review/i);
  });

  it("serializes to a plain JSON object for the jsonb column", () => {
    const json = researchPackToJson(
      buildResearchPack(manifest, STATS, SNAPSHOTS),
    );

    expect(Object.getPrototypeOf(json)).toBe(Object.prototype);
    expect(json["adapterVersion"]).toBe(CONTENT_SHADOW_ADAPTER_VERSION);
  });

  it("projects the exact frozen content policy and a derived retrieval summary", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);

    expect(pack.policy).toEqual({
      brandConstraints: ["Use a practical voice"],
      complianceConstraints: ["Qualify forward-looking statements"],
      prohibitedTerms: ["guaranteed"],
      claimRestrictions: ["Do not publish unverified percentages"],
    });
    expect(pack.retrievalSummary).toEqual({
      targetCount: 2,
      suppliedSnapshotCount: 2,
      availableSourceCount: 2,
      partialSourceCount: 0,
      unavailableSourceCount: 0,
      firstPartyPageCount: 1,
      externalPageCount: 1,
      contentSourceCount: 2,
      contentCharacterCount:
        "Acme analytics product facts.".length +
        "Independent benchmark evidence.".length,
      truncatedSourceCount: 0,
    });
  });

  it("emits accurate missing-retrieval sources and limitations", () => {
    const pack = buildResearchPack(manifest, STATS, []);
    const firstPartyPage = pack.sources.find(
      (source) => source.kind === "first_party_page",
    );
    const externalPage = pack.sources.find(
      (source) => source.kind === "external_page",
    );

    expect(firstPartyPage).toMatchObject({
      ref: PAGE_A,
      availability: "partial",
      capturedAt: "2026-07-24T12:00:00.000Z",
      urlHash: "a".repeat(64),
      contentHash: "b".repeat(64),
      contentText: null,
      contentTruncated: false,
      excerptTruncated: false,
    });
    expect(externalPage).toMatchObject({
      ref: EXTERNAL_REF,
      availability: "unavailable",
      url: EXTERNAL_URL,
      capturedAt: null,
      contentHash: null,
      contentText: null,
      contentTruncated: false,
      excerptTruncated: false,
    });
    expect(pack.limitations.join(" ")).toMatch(
      /1 frozen first-party page snapshot body was not supplied/i,
    );
    expect(pack.limitations.join(" ")).toMatch(
      /1 frozen external target has no retrieved snapshot/i,
    );
    expect(pack.limitations.join(" ")).not.toMatch(/plagiarism|brand-tone/i);
  });

  it("rejects a first-party body whose identity drifted from the frozen snapshot", () => {
    const drifted: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[1]!,
      contentHash: "e".repeat(64),
    };

    expect(() =>
      buildResearchPack(manifest, STATS, [SNAPSHOTS[0]!, drifted]),
    ).toThrow(ResearchSnapshotIntegrityError);
  });

  it("rejects a retrieved target that was never frozen", () => {
    const unpinned: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      ref: "brief-link:https://unfrozen.example/",
      requestedUrl: "https://unfrozen.example/",
      url: "https://unfrozen.example/",
    };

    expect(() => buildResearchPack(manifest, STATS, [unpinned])).toThrow(
      /not present in the frozen research context/i,
    );
  });

  it("rejects internally inconsistent retrieval metadata", () => {
    const impossible: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      availability: "unavailable",
      url: null,
      urlHash: null,
      contentHash: null,
      contentHashMethod: null,
      contentText: "A body cannot be unavailable.",
    };

    expect(() => buildResearchPack(manifest, STATS, [impossible])).toThrow(
      /unavailable[\s\S]*content body/i,
    );

    const invalidMetrics: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      metrics: {
        ...SNAPSHOTS[0]!.metrics!,
        bodyBytes: -1,
      },
    };
    expect(() => buildResearchPack(manifest, STATS, [invalidMetrics])).toThrow(
      /bodyBytes[\s\S]*non-negative/i,
    );

    const blankRedirect: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      metrics: {
        ...SNAPSHOTS[0]!.metrics!,
        redirectChain: ["   "],
      },
    };
    expect(() => buildResearchPack(manifest, STATS, [blankRedirect])).toThrow(
      /redirect[\s\S]*absolute http/i,
    );

    const truncatedWithoutBody: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      availability: "partial",
      contentText: null,
      excerpt: null,
      contentTruncated: true,
      excerptTruncated: false,
      limitation: "The adapter retained only a bounded content projection.",
    };
    expect(() =>
      buildResearchPack(manifest, STATS, [truncatedWithoutBody]),
    ).toThrow(/contentTruncated[\s\S]*body/i);

    const truncatedButAvailable: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      availability: "available",
      contentTruncated: true,
      limitation: "The adapter retained only a bounded content projection.",
    };
    expect(() =>
      buildResearchPack(manifest, STATS, [truncatedButAvailable]),
    ).toThrow(/contentTruncated[\s\S]*partial/i);

    const excerptFlagWithoutExcerpt: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      excerpt: null,
      excerptTruncated: true,
      limitation: "The excerpt is a bounded preview.",
    };
    expect(() =>
      buildResearchPack(manifest, STATS, [excerptFlagWithoutExcerpt]),
    ).toThrow(/excerptTruncated[\s\S]*excerpt/i);

    const excerptWithoutBody: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      availability: "partial",
      contentText: null,
      excerpt: "An excerpt cannot exist without its retained body.",
      limitation: "Retrieval returned only metadata.",
    };
    expect(() =>
      buildResearchPack(manifest, STATS, [excerptWithoutBody]),
    ).toThrow(/excerpt[\s\S]*body/i);

    const excerptFlagWithoutLongerBody: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      contentText: "same preview",
      excerpt: "same preview",
      excerptTruncated: true,
      limitation: "The excerpt is a bounded preview.",
    };
    expect(() =>
      buildResearchPack(manifest, STATS, [excerptFlagWithoutLongerBody]),
    ).toThrow(/excerptTruncated[\s\S]*shorter[\s\S]*body/i);

    const nonBooleanFlag = {
      ...SNAPSHOTS[0]!,
      contentTruncated: "false",
    } as unknown as RetrievedResearchSnapshot;
    expect(() =>
      buildResearchPack(manifest, STATS, [nonBooleanFlag]),
    ).toThrow(/contentTruncated[\s\S]*boolean/i);
  });

  it("accepts a supplied first-party PageSnapshot only as an available body", () => {
    const partial: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[1]!,
      availability: "partial",
    };

    expect(() =>
      buildResearchPack(manifest, STATS, [SNAPSHOTS[0]!, partial]),
    ).toThrow(/first-party PageSnapshot[\s\S]*available body/i);
  });

  it("bounds stored source bodies without changing their audited content hash", () => {
    const oversizedText = "x".repeat(MAX_RESEARCH_SOURCE_CONTENT_CHARS + 17);
    const adapterLimitation = "Adapter audit text must remain exact.";
    const oversized: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      contentText: oversizedText,
      excerpt: oversizedText,
      limitation: adapterLimitation,
    };
    const pack = buildResearchPack(manifest, STATS, [
      oversized,
      SNAPSHOTS[1]!,
    ]);
    const source = pack.sources.find(
      (candidate) => candidate.ref === EXTERNAL_REF,
    );

    expect(source?.contentText).toHaveLength(
      MAX_RESEARCH_SOURCE_CONTENT_CHARS,
    );
    expect(source?.excerpt?.length).toBeLessThanOrEqual(2_000);
    expect(source?.contentHash).toBe("d".repeat(64));
    expect(source?.availability).toBe("partial");
    expect(source?.contentTruncated).toBe(true);
    expect(source?.excerptTruncated).toBe(true);
    expect(source?.limitation).toMatch(/bounded research-pack limit/i);
    expect(source?.limitation?.startsWith(`${adapterLimitation} `)).toBe(true);
    expect(pack.retrievalSummary.truncatedSourceCount).toBe(1);
  });

  it("keeps pack-level preview-only truncation available and out of the body count", () => {
    const longBody = "b".repeat(3_000);
    const longExcerpt = "e".repeat(2_500);
    const previewOnly: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      contentText: longBody,
      excerpt: longExcerpt,
    };
    const pack = buildResearchPack(manifest, STATS, [
      previewOnly,
      SNAPSHOTS[1]!,
    ]);
    const source = pack.sources.find(
      (candidate) => candidate.ref === EXTERNAL_REF,
    );

    expect(source?.availability).toBe("available");
    expect(source?.contentTruncated).toBe(false);
    expect(source?.excerptTruncated).toBe(true);
    expect(source?.excerpt).toHaveLength(2_000);
    expect(source?.limitation).toMatch(/Excerpt exceeded.*pack limit/i);
    expect(pack.retrievalSummary.truncatedSourceCount).toBe(0);
  });

  it("preserves adapter-level body truncation below the pack cap", () => {
    const adapterLimitation =
      "Normalized HTML content projection exceeded the adapter bound and was truncated; contentHash identifies the full normalized extraction.";
    const truncated: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      availability: "partial",
      contentText: "Retained normalized body.",
      excerpt: "Retained preview.",
      contentTruncated: true,
      excerptTruncated: true,
      limitation: adapterLimitation,
    };
    const pack = buildResearchPack(manifest, STATS, [
      truncated,
      SNAPSHOTS[1]!,
    ]);
    const source = pack.sources.find(
      (candidate) => candidate.ref === EXTERNAL_REF,
    );

    expect(source).toMatchObject({
      availability: "partial",
      contentText: "Retained normalized body.",
      excerpt: "Retained preview.",
      contentTruncated: true,
      excerptTruncated: true,
      limitation: adapterLimitation,
    });
    expect(pack.retrievalSummary.truncatedSourceCount).toBe(1);
    expect(researchPackToJson(pack)).toMatchObject({
      sources: expect.arrayContaining([
        expect.objectContaining({
          ref: EXTERNAL_REF,
          contentTruncated: true,
          excerptTruncated: true,
        }),
      ]),
    });
  });

  it("preserves preview-only truncation without counting body truncation", () => {
    const adapterLimitation =
      "Excerpt is a bounded preview; inspect contentText for the retained normalized projection.";
    const previewOnly: RetrievedResearchSnapshot = {
      ...SNAPSHOTS[0]!,
      availability: "available",
      contentText: "The complete retained normalized body is longer.",
      excerpt: "Bounded preview.",
      contentTruncated: false,
      excerptTruncated: true,
      limitation: adapterLimitation,
    };
    const pack = buildResearchPack(manifest, STATS, [
      previewOnly,
      SNAPSHOTS[1]!,
    ]);
    const source = pack.sources.find(
      (candidate) => candidate.ref === EXTERNAL_REF,
    );

    expect(source).toMatchObject({
      availability: "available",
      contentTruncated: false,
      excerptTruncated: true,
      limitation: adapterLimitation,
    });
    expect(pack.retrievalSummary.truncatedSourceCount).toBe(0);
    expect(pack.limitations.join(" ")).not.toMatch(
      /source body projections were truncated/i,
    );
  });

  it("gives every source the complete auditable shape", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);

    for (const source of pack.sources) {
      expect(Object.keys(source).sort()).toEqual(
        [
          "authorityTier",
          "availability",
          "capturedAt",
          "contentHash",
          "contentHashMethod",
          "contentText",
          "contentTruncated",
          "evidenceRefs",
          "excerpt",
          "excerptTruncated",
          "kind",
          "label",
          "limitation",
          "metrics",
          "ref",
          "url",
          "urlHash",
        ].sort(),
      );
    }
  });

  it("round-trips to persisted JSON without mutating any metric or source field", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);

    expect(JSON.stringify(researchPackToJson(pack))).toBe(
      JSON.stringify(pack),
    );
  });
});

describe("buildResearchPack brief outline projection (Task 4b)", () => {
  it("projects the brief outline beside — never merged into — the fixed scaffold", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);

    // O-6: the scaffold is the document structure, the brief outline is the
    // coverage checklist. Two fields, never asserted against each other.
    expect(pack.outline).toEqual([...CONTENT_SHADOW_OUTLINE]);
    expect(pack.briefOutline).toEqual({
      briefSections: ["Objective", "Audience"],
      targetKeywords: ["growth analytics"],
      pageAssignment: "existing_page",
    });
  });

  it("no longer describes the brief as consumed as-is", () => {
    const pack = buildResearchPack(manifest, STATS, SNAPSHOTS);
    const briefSource = pack.sources.find(
      (source) => source.kind === "content_brief",
    );

    expect(briefSource?.limitation).toMatch(/coverage checklist/i);
    expect(briefSource?.limitation).not.toMatch(/as-is/i);
  });

  it("states an extraction failure loudly instead of degrading in silence", () => {
    const broken = buildContentShadowInputManifest({
      ...FROZEN,
      contentBriefOutline: {
        briefSections: [],
        targetKeywords: [],
        pageAssignment: "unassigned",
      },
    });

    const limitations = buildResearchPack(
      broken,
      {
        briefSectionCount: 0,
        projectedSectionCount: 0,
        clusterKeywordCount: 0,
        projectedKeywordCount: 0,
        unconfirmedMappingCount: 0,
      },
      SNAPSHOTS,
    ).limitations;

    expect(limitations.join(" ")).toMatch(
      /outline extraction FAILED[\s\S]*NOT guided by the brief/,
    );
  });

  it("discloses projection truncation and unconfirmed mapping review states", () => {
    const limitations = buildResearchPack(
      manifest,
      {
        briefSectionCount: 2,
        projectedSectionCount: 2,
        clusterKeywordCount: 120,
        projectedKeywordCount: 50,
        unconfirmedMappingCount: 7,
      },
      SNAPSHOTS,
    ).limitations;

    expect(limitations.join(" ")).toContain(
      "The frozen search cluster holds 120 keywords; only the first 50",
    );
    expect(limitations.join(" ")).toContain(
      "7 of 120 frozen cluster keywords carry an unconfirmed page-mapping review state",
    );
  });

  /**
   * A PARTIAL extraction failure is still a failure of the brief -> draft
   * causal chain for the topics it dropped. Decision O-4 only spelled out total
   * failure, but its principle ("an honest shortfall beats a silent pass")
   * covers this: the drop has to be visible, even though it is not `failed`.
   */
  it("discloses brief sections the outline cap dropped", () => {
    const limitations = buildResearchPack(
      manifest,
      {
        briefSectionCount: 19,
        projectedSectionCount: 12,
        clusterKeywordCount: 1,
        projectedKeywordCount: 1,
        unconfirmedMappingCount: 0,
      },
      SNAPSHOTS,
    ).limitations;

    expect(limitations.join(" ")).toContain(
      "The pinned content brief carried 19 distinct section headings; only the first 12 (in document order) reached the draft prompt, so 7 committed topic(s) did not guide this draft.",
    );
  });

  it("says nothing about truncation or review state when neither applies", () => {
    const limitations = buildResearchPack(
      manifest,
      STATS,
      SNAPSHOTS,
    ).limitations;

    expect(limitations.join(" ")).not.toContain("only the first");
    expect(limitations.join(" ")).not.toContain("unconfirmed page-mapping");
    expect(limitations.join(" ")).not.toContain("distinct section headings");
  });
});
