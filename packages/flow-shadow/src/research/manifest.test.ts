import { describe, expect, it } from "vitest";
import {
  assertObservationSeparation,
  buildContentShadowInputManifest,
  ContentShadowResearchContextConflictError,
  ContentShadowObservationSeparationError,
} from "./manifest.ts";
import { CONTENT_SHADOW_ADAPTER_VERSION } from "../version.ts";
import type {
  ContentShadowFrozenInput,
  ContentShadowResearchContext,
} from "../types.ts";

const FINDING = "00000000-0000-4000-8000-000000000001";
const ACTION = "00000000-0000-4000-8000-000000000002";
const DIAGNOSTIC = "00000000-0000-4000-8000-000000000003";
const BRIEF = "00000000-0000-4000-8000-000000000004";
const KEYWORD_A = "00000000-0000-4000-8000-00000000000a";
const KEYWORD_B = "00000000-0000-4000-8000-00000000000b";
const GENERATIVE_A = "00000000-0000-4000-8000-00000000001a";
const COMPETITOR_A = "00000000-0000-4000-8000-00000000002a";
const COMPETITOR_B = "00000000-0000-4000-8000-00000000002b";
const PAGE_A = "00000000-0000-4000-8000-00000000003a";
const PAGE_B = "00000000-0000-4000-8000-00000000003b";
const DATA_A = "00000000-0000-4000-8000-00000000004a";
const DATA_B = "00000000-0000-4000-8000-00000000004b";

function keywordFact(
  id: string,
  display: string,
): ContentShadowResearchContext["searchKeywordFacts"][number] {
  return {
    id,
    display,
    market: "US",
    language: "en",
    intent: "commercial",
    buyerStage: "consideration",
    cluster: "growth-analytics",
    mapping: {
      decision: "existing_page",
      mappedSitePageId: PAGE_A,
      reviewState: "confirmed",
      revision: 4,
    },
    lastSeen: "2026-07-24T12:00:00.000Z",
    evidenceRefs: ["evidence:z", "evidence:a", "evidence:z"],
  };
}

function researchContext(
  overrides: Partial<ContentShadowResearchContext> = {},
): ContentShadowResearchContext {
  return {
    firstPartyPageSnapshots: [
      {
        pageSnapshotId: PAGE_B,
        dataSnapshotId: DATA_B,
        url: "https://acme.example/pricing",
        urlHash: "b".repeat(64),
        contentHash: "d".repeat(64),
        capturedAt: "2026-07-24T13:00:00.000Z",
      },
      {
        pageSnapshotId: PAGE_A,
        dataSnapshotId: DATA_A,
        url: "https://acme.example/analytics",
        urlHash: "a".repeat(64),
        contentHash: "c".repeat(64),
        capturedAt: "2026-07-24T12:00:00.000Z",
      },
      {
        pageSnapshotId: PAGE_A,
        dataSnapshotId: DATA_A,
        url: "https://acme.example/analytics",
        urlHash: "a".repeat(64),
        contentHash: "c".repeat(64),
        capturedAt: "2026-07-24T12:00:00.000Z",
      },
    ],
    searchKeywordFacts: [
      keywordFact(KEYWORD_B, "Product analytics"),
      keywordFact(KEYWORD_A, "Growth analytics"),
      keywordFact(KEYWORD_B, "Product analytics"),
    ],
    generativeKeywordFacts: [
      {
        ...keywordFact(GENERATIVE_A, "What is growth analytics?"),
        cluster: null,
        mapping: {
          decision: "unassigned",
          mappedSitePageId: null,
          reviewState: "unreviewed",
          revision: 0,
        },
      },
    ],
    competitorFacts: [
      {
        id: COMPETITOR_B,
        domain: "beta.example",
        name: null,
        status: "candidate",
        relationship: null,
        scopes: ["serp_visibility", "content", "content"],
        revision: 1,
      },
      {
        id: COMPETITOR_A,
        domain: "alpha.example",
        name: "Alpha",
        status: "approved",
        relationship: "direct",
        scopes: ["positioning", "content"],
        revision: 3,
      },
    ],
    externalTargets: [
      {
        ref: "brief-link:https://research.example/report",
        kind: "content_brief_link",
        url: "https://research.example/report",
        label: "Research report",
      },
      {
        ref: "competitor-home:https://alpha.example/",
        kind: "competitor_homepage",
        url: "https://alpha.example/",
        label: "Alpha",
      },
      {
        ref: "brief-link:https://research.example/report",
        kind: "content_brief_link",
        url: "https://research.example/report",
        label: "Research report",
      },
    ],
    contentPolicy: {
      brandConstraints: ["Use a practical voice", "Use a practical voice"],
      complianceConstraints: [
        "Qualify forward-looking statements",
        "Do not imply certification",
      ],
      prohibitedTerms: ["guaranteed", "best-in-class", "guaranteed"],
      claimRestrictions: [
        "Do not publish unverified percentages",
        "Do not promise outcomes",
      ],
    },
    ...overrides,
  };
}

function frozen(
  overrides: Partial<ContentShadowFrozenInput> = {},
): ContentShadowFrozenInput {
  return {
    primaryFindingId: FINDING,
    sourceActionId: ACTION,
    sourceDiagnosticRunId: DIAGNOSTIC,
    contentBriefArtifactId: BRIEF,
    contentBriefRevision: 2,
    competitorEntityIds: [COMPETITOR_B, COMPETITOR_A],
    searchCluster: {
      clusterKey: "growth-analytics",
      keywordEntityIds: [KEYWORD_B, KEYWORD_A, KEYWORD_B],
    },
    generativeQueryEntityIds: [GENERATIVE_A],
    firstParty: {
      siteOrigin: "https://acme.example",
      icpPrimaryConversionUrl: "https://acme.example/demo",
    },
    contentBriefOutline: {
      briefSections: ["Objective", "Audience"],
      targetKeywords: ["growth analytics", "product analytics"],
      pageAssignment: "existing_page",
    },
    researchContext: researchContext(),
    flowAdapterVersion: CONTENT_SHADOW_ADAPTER_VERSION,
    promptSetVersion: "mvp.prompts.content-shadow.0.4.0",
    projectionVersion: "content-shadow.0.4.0",
    outputLocale: "en",
    ...overrides,
  };
}

describe("buildContentShadowInputManifest", () => {
  it("sorts and de-duplicates every identity collection", () => {
    const manifest = buildContentShadowInputManifest(frozen());

    expect(manifest.competitorEntityIds).toEqual([COMPETITOR_A, COMPETITOR_B]);
    expect(manifest.searchCluster.keywordEntityIds).toEqual([
      KEYWORD_A,
      KEYWORD_B,
    ]);
    expect(manifest.generativeQueryEntityIds).toEqual([GENERATIVE_A]);
    expect(
      manifest.researchContext.firstPartyPageSnapshots.map(
        (snapshot) => snapshot.pageSnapshotId,
      ),
    ).toEqual([PAGE_A, PAGE_B]);
    expect(
      manifest.researchContext.searchKeywordFacts.map((fact) => fact.id),
    ).toEqual([KEYWORD_A, KEYWORD_B]);
    expect(
      manifest.researchContext.competitorFacts.map((fact) => fact.id),
    ).toEqual([COMPETITOR_A, COMPETITOR_B]);
    expect(
      manifest.researchContext.externalTargets.map((target) => target.ref),
    ).toEqual([
      "brief-link:https://research.example/report",
      "competitor-home:https://alpha.example/",
    ]);
    expect(
      manifest.researchContext.searchKeywordFacts[0]?.evidenceRefs,
    ).toEqual(["evidence:a", "evidence:z"]);
    expect(manifest.researchContext.competitorFacts[0]?.scopes).toEqual([
      "content",
      "positioning",
    ]);
    expect(manifest.researchContext.contentPolicy.prohibitedTerms).toEqual([
      "best-in-class",
      "guaranteed",
    ]);
  });

  it("is order-independent so an equivalent request freezes the same tuple", () => {
    const left = buildContentShadowInputManifest(frozen());
    const right = buildContentShadowInputManifest(
      frozen({
        competitorEntityIds: [COMPETITOR_A, COMPETITOR_B],
        searchCluster: {
          clusterKey: "growth-analytics",
          keywordEntityIds: [KEYWORD_A, KEYWORD_B],
        },
      }),
    );

    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });

  it("canonicalizes every research collection independently of caller order", () => {
    const context = researchContext();
    const left = buildContentShadowInputManifest(frozen());
    const right = buildContentShadowInputManifest(
      frozen({
        competitorEntityIds: [COMPETITOR_A, COMPETITOR_B],
        searchCluster: {
          clusterKey: "growth-analytics",
          keywordEntityIds: [KEYWORD_A, KEYWORD_B],
        },
        researchContext: {
          firstPartyPageSnapshots: [
            ...context.firstPartyPageSnapshots,
          ].reverse(),
          searchKeywordFacts: [...context.searchKeywordFacts].reverse(),
          generativeKeywordFacts: [
            ...context.generativeKeywordFacts,
          ].reverse(),
          competitorFacts: [...context.competitorFacts].reverse(),
          externalTargets: [...context.externalTargets].reverse(),
          contentPolicy: {
            brandConstraints: [
              ...context.contentPolicy.brandConstraints,
            ].reverse(),
            complianceConstraints: [
              ...context.contentPolicy.complianceConstraints,
            ].reverse(),
            prohibitedTerms: [
              ...context.contentPolicy.prohibitedTerms,
            ].reverse(),
            claimRestrictions: [
              ...context.contentPolicy.claimRestrictions,
            ].reverse(),
          },
        },
      }),
    );

    expect(JSON.stringify(right)).toBe(JSON.stringify(left));
  });

  it("puts research facts and policy inside the frozen hash tuple", () => {
    const pinned = buildContentShadowInputManifest(frozen());
    const changed = buildContentShadowInputManifest(
      frozen({
        researchContext: researchContext({
          contentPolicy: {
            ...researchContext().contentPolicy,
            claimRestrictions: ["Require a named primary source"],
          },
        }),
      }),
    );

    expect(JSON.stringify(changed)).not.toBe(JSON.stringify(pinned));
  });

  it("rejects conflicting rows that reuse one stable research identity", () => {
    const context = researchContext();
    expect(() =>
      buildContentShadowInputManifest(
        frozen({
          researchContext: {
            ...context,
            externalTargets: [
              ...context.externalTargets,
              {
                ref: "brief-link:https://research.example/report",
                kind: "content_brief_link",
                url: "https://other.example/report",
                label: "A different target",
              },
            ],
          },
        }),
      ),
    ).toThrow(ContentShadowResearchContextConflictError);
  });

  it("requires frozen fact coverage to match every identity set exactly", () => {
    const context = researchContext();
    expect(() =>
      buildContentShadowInputManifest(
        frozen({
          researchContext: {
            ...context,
            searchKeywordFacts: context.searchKeywordFacts.filter(
              (fact) => fact.id !== KEYWORD_A,
            ),
          },
        }),
      ),
    ).toThrow(/search keyword fact identities/i);
  });

  it("carries the pinned adapter, prompt and projection versions", () => {
    const manifest = buildContentShadowInputManifest(frozen());

    expect(manifest.flowAdapterVersion).toBe(CONTENT_SHADOW_ADAPTER_VERSION);
    expect(manifest.promptSetVersion).toBe("mvp.prompts.content-shadow.0.4.0");
    expect(manifest.projectionVersion).toBe("content-shadow.0.4.0");
  });

  it("changes the frozen tuple when the pinned adapter advances", () => {
    const pinned = buildContentShadowInputManifest(frozen());
    const advanced = buildContentShadowInputManifest(
      frozen({ flowAdapterVersion: "content-shadow-adapter.0.5.0" }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(advanced));
  });

  it("rejects a search identity reused as a generative identity", () => {
    expect(() =>
      buildContentShadowInputManifest(
        frozen({ generativeQueryEntityIds: [KEYWORD_A] }),
      ),
    ).toThrow(ContentShadowObservationSeparationError);
  });
});

describe("assertObservationSeparation", () => {
  it("accepts disjoint search and generative identity sets", () => {
    expect(() =>
      assertObservationSeparation([KEYWORD_A], [GENERATIVE_A]),
    ).not.toThrow();
  });

  it("names every collapsed identity in a stable order", () => {
    expect(() =>
      assertObservationSeparation(
        [KEYWORD_B, KEYWORD_A],
        [KEYWORD_B, KEYWORD_A],
      ),
    ).toThrow(new RegExp(`${KEYWORD_A}, ${KEYWORD_B}`));
  });
});

describe("brief outline is part of the frozen address (Task 4b)", () => {
  it("carries the extracted outline through unchanged, in extraction order", () => {
    const manifest = buildContentShadowInputManifest(frozen());

    // Order is meaningful (document order / normalized-keyword order), so this
    // is the one collection the manifest does NOT sort or de-duplicate.
    expect(manifest.contentBriefOutline).toEqual({
      briefSections: ["Objective", "Audience"],
      targetKeywords: ["growth analytics", "product analytics"],
      pageAssignment: "existing_page",
    });
  });

  it("changes the frozen tuple when a single brief heading is renamed", () => {
    // THIS is the machine proof that a brief edit now reaches the draft: before
    // Task 4b the brief and the draft were siblings and this assertion could
    // not have been written.
    const pinned = buildContentShadowInputManifest(frozen());
    const renamed = buildContentShadowInputManifest(
      frozen({
        contentBriefOutline: {
          briefSections: ["North Star Metric", "Audience"],
          targetKeywords: ["growth analytics", "product analytics"],
          pageAssignment: "existing_page",
        },
      }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(renamed));
  });

  it("changes the frozen tuple when a keyword's mapping decision moves", () => {
    const pinned = buildContentShadowInputManifest(frozen());
    const remapped = buildContentShadowInputManifest(
      frozen({
        contentBriefOutline: {
          briefSections: ["Objective", "Audience"],
          targetKeywords: ["growth analytics", "product analytics"],
          pageAssignment: "new_asset",
        },
      }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(remapped));
  });

  it("changes the frozen tuple when the brief section ORDER changes", () => {
    const pinned = buildContentShadowInputManifest(frozen());
    const reordered = buildContentShadowInputManifest(
      frozen({
        contentBriefOutline: {
          briefSections: ["Audience", "Objective"],
          targetKeywords: ["growth analytics", "product analytics"],
          pageAssignment: "existing_page",
        },
      }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(reordered));
  });

  it("keeps identity-set order irrelevant even with an outline present", () => {
    const left = buildContentShadowInputManifest(frozen());
    const right = buildContentShadowInputManifest(
      frozen({
        competitorEntityIds: [COMPETITOR_A, COMPETITOR_B],
        searchCluster: {
          clusterKey: "growth-analytics",
          keywordEntityIds: [KEYWORD_A, KEYWORD_B],
        },
      }),
    );

    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });

  it("does not let a caller smuggle an extra key into the frozen outline", () => {
    const manifest = buildContentShadowInputManifest(
      frozen({
        contentBriefOutline: {
          briefSections: ["Objective"],
          targetKeywords: [],
          pageAssignment: "unassigned",
          smuggled: "payload",
        } as never,
      }),
    );

    expect(Object.keys(manifest.contentBriefOutline).sort()).toEqual([
      "briefSections",
      "pageAssignment",
      "targetKeywords",
    ]);
  });
});

describe("first-party identity is part of the frozen address (Task 6b)", () => {
  it("carries the site origin and the ICP conversion target through", () => {
    const manifest = buildContentShadowInputManifest(frozen());

    expect(manifest.firstParty).toEqual({
      siteOrigin: "https://acme.example",
      icpPrimaryConversionUrl: "https://acme.example/demo",
    });
  });

  /**
   * Red line C, stated as a test. `sites.origin` is a mutable row: freezing it
   * is what makes an origin that moves between accept and claim a drift failure
   * instead of a silent re-render against a different first-party identity.
  */
  it("changes the frozen tuple when the site origin moves", () => {
    const withoutPages = researchContext({
      firstPartyPageSnapshots: [],
    });
    const pinned = buildContentShadowInputManifest(
      frozen({ researchContext: withoutPages }),
    );
    const moved = buildContentShadowInputManifest(
      frozen({
        firstParty: {
          siteOrigin: "https://acme-rebrand.example",
          icpPrimaryConversionUrl: "https://acme.example/demo",
        },
        researchContext: withoutPages,
      }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(moved));
  });

  it("changes the frozen tuple when the conversion target moves", () => {
    const pinned = buildContentShadowInputManifest(frozen());
    const moved = buildContentShadowInputManifest(
      frozen({
        firstParty: {
          siteOrigin: "https://acme.example",
          icpPrimaryConversionUrl: null,
        },
      }),
    );

    expect(JSON.stringify(pinned)).not.toBe(JSON.stringify(moved));
  });

  /**
   * Normalization lives in the builder, not in its two callers: the accepting
   * service and the worker's replay guard hash this tuple independently, so a
   * value that normalized differently on the two sides would fail every normal
   * replay as input drift.
   */
  it("normalizes the frozen identity so both sides hash the same bytes", () => {
    const padded = buildContentShadowInputManifest(
      frozen({
        firstParty: {
          siteOrigin: "  HTTPS://ACME.EXAMPLE:443/  ",
          icpPrimaryConversionUrl: "  https://acme.example/demo  ",
        },
      }),
    );

    expect(JSON.stringify(padded)).toBe(
      JSON.stringify(buildContentShadowInputManifest(frozen())),
    );
  });

  it("refuses to freeze a conversion target that is not an absolute URL", () => {
    const manifest = buildContentShadowInputManifest(
      frozen({
        firstParty: {
          siteOrigin: "https://acme.example",
          icpPrimaryConversionUrl: "book a demo",
        },
      }),
    );

    // `null`, never the raw token: a non-URL in the pack would be matched by the
    // NAME half of the resolution chain and could confirm a reference nothing in
    // our records supports.
    expect(manifest.firstParty.icpPrimaryConversionUrl).toBeNull();
  });

  it("preserves a third-party conversion URL as an exact identity", () => {
    const manifest = buildContentShadowInputManifest(
      frozen({
        firstParty: {
          siteOrigin: "https://acme.example",
          icpPrimaryConversionUrl: "https://github.io/acme/demo",
        },
      }),
    );

    expect(manifest.firstParty.icpPrimaryConversionUrl).toBe(
      "https://github.io/acme/demo",
    );
  });

  it("fails closed when the required site origin is not an absolute URL", () => {
    expect(() =>
      buildContentShadowInputManifest(
        frozen({
          firstParty: {
            siteOrigin: "Acme Analytics",
            icpPrimaryConversionUrl: null,
          },
        }),
      ),
    ).toThrow(/siteOrigin[\s\S]*absolute http/i);
  });

  it.each([
    ["a path", "https://acme.example/path"],
    ["a query", "https://acme.example/?tenant=acme"],
    ["a fragment", "https://acme.example/#section"],
    ["a single-label hostname", "https://com"],
  ])("fails closed when siteOrigin contains %s", (_label, siteOrigin) => {
    expect(() =>
      buildContentShadowInputManifest(
        frozen({
          firstParty: {
            siteOrigin,
            icpPrimaryConversionUrl: null,
          },
          researchContext: researchContext({
            firstPartyPageSnapshots: [],
          }),
        }),
      ),
    ).toThrow(/siteOrigin[\s\S]*(origin|dotted DNS hostname)/i);
  });

  it("does not let a caller smuggle an extra key into the frozen identity", () => {
    const manifest = buildContentShadowInputManifest(
      frozen({
        firstParty: {
          siteOrigin: "https://acme.example",
          icpPrimaryConversionUrl: null,
          smuggled: "payload",
        } as never,
      }),
    );

    expect(Object.keys(manifest.firstParty).sort()).toEqual([
      "icpPrimaryConversionUrl",
      "siteOrigin",
    ]);
  });
});

describe("frozen first-party PageSnapshot ownership", () => {
  it("freezes a PageSnapshot on the exact site hostname", () => {
    const siteOrigin = "https://acme.example:443";
    const pageUrl = "https://acme.example/analytics";
    const manifest = buildContentShadowInputManifest(
      frozen({
        firstParty: {
          siteOrigin,
          icpPrimaryConversionUrl: "https://scheduler.example/acme",
        },
        researchContext: researchContext({
          firstPartyPageSnapshots: [
            {
              pageSnapshotId: PAGE_A,
              dataSnapshotId: DATA_A,
              url: pageUrl,
              urlHash: "a".repeat(64),
              contentHash: "c".repeat(64),
              capturedAt: "2026-07-24T12:00:00.000Z",
            },
          ],
        }),
      }),
    );

    expect(manifest.researchContext.firstPartyPageSnapshots[0]?.url).toBe(
      pageUrl,
    );
    expect(manifest.firstParty.icpPrimaryConversionUrl).toBe(
      "https://scheduler.example/acme",
    );
  });

  it.each([
    ["an unverified subdomain", "http://docs.acme.example:80/analytics"],
    ["a sibling host", "https://beta.example/analytics"],
    ["a lookalike prefix", "https://evilacme.example/analytics"],
    ["a lookalike suffix", "https://acme.example.attacker.test/analytics"],
    ["an unrelated host", "https://attacker.test/analytics"],
    [
      "userinfo targeting an unrelated host",
      "https://acme.example@attacker.test/analytics",
    ],
    [
      "userinfo targeting the owned host",
      "https://attacker.test@acme.example/analytics",
    ],
    ["a non-HTTP URL", "ftp://acme.example/analytics"],
  ])("refuses to freeze a PageSnapshot on %s", (_label, pageUrl) => {
    expect(() =>
      buildContentShadowInputManifest(
        frozen({
          researchContext: researchContext({
            firstPartyPageSnapshots: [
              {
                pageSnapshotId: PAGE_A,
                dataSnapshotId: DATA_A,
                url: pageUrl,
                urlHash: "a".repeat(64),
                contentHash: "c".repeat(64),
                capturedAt: "2026-07-24T12:00:00.000Z",
              },
            ],
          }),
        }),
      ),
    ).toThrow(/first-party PageSnapshot[\s\S]*(siteOrigin|hostname)/i);
  });
});
