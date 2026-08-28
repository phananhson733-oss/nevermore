import { describe, expect, it } from "vitest";

import type {
  KeywordCoverageRead,
  KeywordOpportunityProviderRow,
} from "@sf/public-tools";
import type {
  KeywordCandidateDraft,
  KeywordContextToken,
  KeywordSerpSampleResult,
} from "./keyword-opportunity-handler.ts";
import type {
  KeywordSerpInterpretation,
  KeywordSerpInterpretationInput,
} from "./keyword-prompts.ts";
import {
  keywordCandidatePlan,
  keywordCoverageSnapshots,
  keywordEnrichmentTargets,
  keywordInterpretationEntries,
  keywordPricedCandidates,
  keywordSerpTargets,
  normalizeKeywordSerpSamples,
} from "./keyword-opportunity-stages.ts";

const TOKEN: KeywordContextToken = {
  siteUrl: "https://example.com/",
  marketCode: "US",
  languageCode: "en",
  propositions: [
    {
      statement: "Automate clinic appointments",
      sourceUrl: "https://example.com/product",
    },
  ],
  pages: [
    {
      url: "https://example.com/product",
      title: "Practice operations platform",
      headings: ["Automate patient intake"],
    },
  ],
  pagesFetched: 1,
  productPagesFetched: 1,
  stopReason: "completed",
  seeds: [],
  sub: "owner-a",
};

const PROPOSITION: KeywordCandidateDraft = {
  keyword: "clinic appointment automation",
  discoveryBasis: "site_proposition",
  questionForm: false,
  propositionIndex: 0,
};

const EXPANSION: KeywordCandidateDraft = {
  keyword: "medical scheduling software",
  discoveryBasis: "traditional_expansion",
  questionForm: false,
  propositionIndex: null,
};

function completeSample(
  keyword: string,
  domain = "small.example",
): KeywordSerpSampleResult {
  return {
    keyword,
    status: "complete",
    failureReason: null,
    observedAt: "2026-08-28T00:00:00.000Z",
    results: [{ domain, position: 2, title: "Result", url: `https://${domain}/` }],
    pageItemTypes: [],
    aiOverview: null,
    communityItems: [],
  };
}

describe("keyword opportunity deterministic stages", () => {
  it("deduplicates with the provider key before applying the cap", () => {
    const duplicate: KeywordCandidateDraft = {
      ...PROPOSITION,
      keyword: "  CLINIC   APPOINTMENT AUTOMATION ",
    };
    const plan = keywordCandidatePlan(
      [PROPOSITION, duplicate, EXPANSION],
      1,
    );

    expect(plan.generated).toBe(3);
    expect(plan.candidates).toEqual([PROPOSITION]);
  });

  it("compacts coverage to one provenance-bearing record per candidate", () => {
    const snapshots = keywordCoverageSnapshots(
      TOKEN,
      [PROPOSITION, EXPANSION],
      null,
    );

    expect(snapshots).toEqual([
      {
        keyword: PROPOSITION.keyword,
        coverage: expect.objectContaining({
          state: "inventory_unavailable",
          supportingPage: {
            availability: "available",
            source: "llm_proposition_source",
            url: "https://example.com/product",
          },
        }),
      },
      {
        keyword: EXPANSION.keyword,
        coverage: expect.objectContaining({
          state: "inventory_unavailable",
          supportingPage: {
            availability: "unavailable",
            source: null,
            url: null,
          },
        }),
      },
    ]);

    const gsc: KeywordCoverageRead = {
      queryRows: [
        { query: PROPOSITION.keyword, impressions: 20, position: 4 },
      ],
      queryPageRows: [
        {
          query: PROPOSITION.keyword,
          page: "https://example.com/product",
          impressions: 20,
          position: 4,
        },
      ],
      queryPaging: { pagesFetched: 1, truncated: false },
      queryPagePaging: { pagesFetched: 1, truncated: false },
    };
    expect(
      keywordCoverageSnapshots(TOKEN, [PROPOSITION], gsc)[0]?.coverage,
    ).toMatchObject({
      state: "observed_exact_strong",
      supportingPage: { source: "gsc_observed_query_page" },
    });
  });

  it("joins provider validation and compact coverage without collapsing no-data", () => {
    const providerRows: readonly KeywordOpportunityProviderRow[] = [
      {
        keyword: PROPOSITION.keyword,
        volume: 120,
        difficulty: 14,
        intent: "commercial",
        serpFeatures: [],
      },
    ];
    const coverage = keywordCoverageSnapshots(
      TOKEN,
      [PROPOSITION, EXPANSION],
      null,
    );
    const priced = keywordPricedCandidates(
      [PROPOSITION, EXPANSION],
      providerRows,
      coverage,
    );

    expect(priced[0]?.validation).toMatchObject({
      availability: "available",
      volume: 120,
      providerIntent: "commercial",
    });
    expect(priced[1]?.validation).toMatchObject({
      availability: "provider_no_data",
      volume: null,
      providerIntent: null,
    });
    expect(keywordSerpTargets(priced)).toEqual([
      PROPOSITION.keyword,
      EXPANSION.keyword,
    ]);
  });

  it("normalizes completed, unavailable, and missing SERP outcomes without inference", () => {
    const returned: readonly KeywordSerpSampleResult[] = [
      {
        ...completeSample(PROPOSITION.keyword),
        status: undefined,
        observedAt: undefined,
      },
      {
        ...completeSample(EXPANSION.keyword),
        status: "unavailable",
        failureReason: "provider_no_data",
      },
    ];
    const samples = normalizeKeywordSerpSamples(
      [PROPOSITION.keyword, EXPANSION.keyword, "missing keyword"],
      returned,
      "2026-08-28T01:00:00.000Z",
    );

    expect(samples[0]).toMatchObject({
      status: "complete",
      failureReason: null,
      observedAt: "2026-08-28T01:00:00.000Z",
    });
    expect(samples[1]).toMatchObject({
      status: "unavailable",
      failureReason: "provider_no_data",
      observedAt: null,
      results: [],
    });
    expect(samples[2]).toMatchObject({
      keyword: "missing keyword",
      status: "unavailable",
      failureReason: "provider_unavailable",
      observedAt: null,
    });
  });

  it("invalidates duplicate interpretations and ignores unrequested keywords", () => {
    const inputs: readonly KeywordSerpInterpretationInput[] = [
      {
        keyword: PROPOSITION.keyword,
        observedAt: "2026-08-28T00:00:00.000Z",
        organicResults: [],
        aiOverviewMarkdown: null,
      },
    ];
    const interpretation: KeywordSerpInterpretation = {
      keyword: PROPOSITION.keyword,
      availability: "available",
      intent: "commercial",
      aiOverviewAssessment: "not_answered",
      reason: "No AI Overview answer was returned.",
      observedAt: "2026-08-28T00:00:00.000Z",
      modelId: "test-model",
      promptVersion: "keyword_serp_interpretation.v1",
    };
    const ignored: KeywordSerpInterpretation = {
      ...interpretation,
      keyword: "not requested",
    };

    expect(
      keywordInterpretationEntries(inputs, [
        interpretation,
        { ...interpretation },
        ignored,
      ]),
    ).toEqual([[PROPOSITION.keyword, null]]);
  });

  it("derives deterministic provider and RDAP target sets", () => {
    const targets = keywordEnrichmentTargets(
      [
        completeSample(PROPOSITION.keyword, "WWW.Small.Example"),
        completeSample(EXPANSION.keyword, "forum.example"),
      ],
      "https://example.com/",
    );

    expect(targets.organicDomains).toEqual([
      "www.small.example",
      "forum.example",
    ]);
    expect(targets.trafficDomains).toEqual([
      "small.example",
      "forum.example",
    ]);
    expect(targets.registrationDomains).toEqual([
      "small.example",
      "forum.example",
    ]);
    expect(targets.siteDomain).toBe("example.com");
    expect(targets.rankTargets).toEqual([
      "www.small.example",
      "forum.example",
      "example.com",
    ]);
  });
});
