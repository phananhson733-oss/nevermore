import { describe, expect, it } from "vitest";

import {
  keywordOpportunityCsv,
  keywordOpportunityCsvFilename,
  keywordOpportunityDisplayItems,
  keywordOpportunityDisplayRows,
} from "./csv.ts";
import type {
  KeywordOpportunityDecision,
  KeywordOpportunityIncomplete,
  KeywordOpportunityResult,
  KeywordOpportunityRow,
  KeywordOpportunitySignals,
  KeywordOpportunityWithheld,
} from "./types.ts";

const V2_COLUMNS = [
  "providerIntent",
  "serpIntent",
  "youngDomainState",
  "youngDomain",
  "youngDomainAgeMonths",
  "lowOrganicTrafficDomainState",
  "lowOrganicTrafficDomain",
  "lowOrganicTrafficDomainEtv",
  "communityResultState",
  "communityResultDomain",
  "communityResultPosition",
  "aiOverviewAvailability",
  "aiOverviewAssessment",
  "aiOverviewDiscount",
  "decisionReason",
] as const;

const SUPPORTING_PAGE_SOURCE_COLUMN = "supportingPageSource";

const YOUNG_DOMAIN_OBSERVATION = {
  domain: "young.test",
  registrationDate: "2026-01-02T00:00:00.000Z",
  observedAt: "2026-08-20T00:00:00.000Z",
  ageMonths: 7,
} as const;

const SIGNALS: KeywordOpportunitySignals = {
  youngDomain: {
    state: "observed",
    observation: YOUNG_DOMAIN_OBSERVATION,
  },
  lowOrganicTrafficDomain: {
    state: "observed",
    observation: {
      domain: "quiet.test",
      organicEtv: 321,
      threshold: 5_000,
      marketCode: "US",
      languageCode: "en",
      observedAt: "2026-08-20T00:00:00.000Z",
    },
  },
  communityResult: {
    state: "observed",
    observation: {
      domain: "forum.test",
      url: "https://forum.test/thread",
      position: 4,
      source: "provider_item_type",
    },
  },
};

function decision(
  overrides: Partial<KeywordOpportunityDecision> = {},
): KeywordOpportunityDecision {
  return {
    disposition: "eligible",
    basis: "positive_signal_observed",
    positiveSignals: ["young_domain"],
    discounts: [],
    ...overrides,
  };
}

function row(
  overrides: Partial<KeywordOpportunityRow> = {},
): KeywordOpportunityRow {
  return {
    keyword: "travel espresso kit",
    lane: "seo",
    discoveryBasis: "site_proposition",
    questionForm: false,
    propositionIndex: 0,
    validation: {
      availability: "available",
      volume: 1300,
      difficulty: 12,
      intent: "informational",
      serpFeatures: [],
    },
    serp: {
      verdict: "winnable_evidence",
      weakestTopTenDomainRank: 38,
      weakestTopTenDomain: "smallbrew.test",
      weakestTopTenPosition: 6,
      topTenDomains: ["big.test", "smallbrew.test"],
      topTenDomainRanks: [900, 38],
      pageOneItemTypes: ["organic"],
      isEstimate: false,
    },
    coverage: "not_observed_in_gsc_query_sample",
    supportingPage: { availability: "unavailable", source: null, url: null },
    supportingPageUrl: null,
    nextChecks: ["read_page_one_intent", "judge_commercial_fit"],
    clusterId: "cluster-1",
    ...overrides,
  };
}

function result(
  rows: readonly KeywordOpportunityRow[],
  options: {
    readonly withheld?: readonly KeywordOpportunityWithheld[];
    readonly incomplete?: readonly KeywordOpportunityIncomplete[];
  } = {},
): KeywordOpportunityResult {
  return {
    availability: "available",
    marketCode: "US",
    languageCode: "en",
    context: {
      siteUrl: "https://example.test",
      pagesFetched: 12,
      productPagesFetched: 5,
      propositions: [],
      contextSufficient: true,
      stopReason: "budget",
    },
    rows,
    withheld: options.withheld ?? [],
    ...(options.incomplete === undefined
      ? {}
      : { incomplete: options.incomplete }),
    clusters: [],
    funnel: {
      generated: 100,
      deduplicated: 90,
      providerReturned: 40,
      volumePositive: 30,
      explicitZero: 10,
      providerNoData: 50,
      alreadyCovered: 3,
      serpSampled: 20,
      winnableEvidence: 8,
      shown: rows.length,
    },
    unavailableStages: [],
    nextStepSuggestions: [],
  };
}

function incomplete(
  keyword: string,
  reason: KeywordOpportunityIncomplete["reason"],
): KeywordOpportunityIncomplete {
  const source = row({ keyword });
  return {
    keyword,
    lane: source.lane,
    discoveryBasis: source.discoveryBasis,
    validation: source.validation,
    coverage: source.coverage,
    serp: { ...source.serp, status: "unavailable" },
    serpIntent: null,
    signals: {
      ...SIGNALS,
      communityResult: {
        state: "unavailable",
        observation: null,
        reason: "provider_unavailable",
      },
    },
    aiOverview: null,
    reason,
    decision: decision({
      disposition: "incomplete",
      basis: "signal_evidence_unavailable",
    }),
  };
}

function lines(csv: string): readonly string[] {
  return csv.replace(/^\uFEFF/, "").split("\r\n");
}

describe("keywordOpportunityCsv", () => {
  it("carries the market, the evidence and the check codes on every row", () => {
    const csv = keywordOpportunityCsv(result([row()]));
    const [header, first] = lines(csv);

    expect(header).toBe(
      `market,language,lane,keyword,volume,difficulty,weakestDomainRank,weakestDomain,weakestPosition,aiOverviewObserved,coverage,${SUPPORTING_PAGE_SOURCE_COLUMN},supportingPageUrl,discoveryBasis,clusterId,checks,${V2_COLUMNS.join(",")}`,
    );
    expect(first?.split(",").slice(0, 16)).toEqual(
      "US,en,seo,travel espresso kit,1300,12,38,smallbrew.test,6,no,not_observed_in_gsc_query_sample,,,site_proposition,cluster-1,read_page_one_intent|judge_commercial_fit".split(
        ",",
      ),
    );
    expect(first?.split(",").slice(16)).toEqual(V2_COLUMNS.map(() => ""));
  });

  it("exports public v2 provider, signal, AI Overview, and decision metadata without a raw-answer column", () => {
    const csv = keywordOpportunityCsv(
      result([
        row({
          validation: {
            ...row().validation,
            providerIntent: "commercial",
          },
          serpIntent: {
            intent: "mixed",
            source: "serp_top_ten_interpretation",
            observedAt: "2026-08-20T00:00:00.000Z",
            modelId: "model-1",
            promptVersion: "serp-intent.v1",
          },
          signals: SIGNALS,
          aiOverview: {
            availability: "observed",
            loadedAsync: true,
            answerAssessment: "complete",
            reason: "fully_answered",
            modelId: "model-1",
            promptVersion: "aio-answer.v1",
          },
          decision: decision({
            positiveSignals: [
              "young_domain",
              "low_organic_traffic_domain",
              "community_result",
            ],
            discounts: ["ai_overview_answer_discount"],
          }),
        }),
      ]),
    );
    const [header, first] = lines(csv);
    const columns = header?.split(",") ?? [];
    const cells = first?.split(",") ?? [];
    const v2Cells = V2_COLUMNS.map(
      (column) => cells[columns.indexOf(column)] ?? "missing",
    );

    expect(v2Cells).toEqual([
      "commercial",
      "mixed",
      "observed",
      "young.test",
      "7",
      "observed",
      "quiet.test",
      "321",
      "observed",
      "forum.test",
      "4",
      "observed",
      "complete",
      "yes",
      "positive_signal_observed",
    ]);
    expect(header).not.toContain("markdown");
  });

  it("starts with a byte-order mark and joins rows with CRLF, for Excel", () => {
    const csv = keywordOpportunityCsv(result([row()]));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
  });

  it("writes an unavailable number as an empty cell, never as zero", () => {
    // The three-state volume design survives into the file or the file lies:
    // a reader summing the column must not mistake provider silence for
    // measured zero demand.
    const csv = keywordOpportunityCsv(
      result([
        row({
          validation: {
            availability: "provider_no_data",
            volume: null,
            difficulty: null,
            intent: null,
            serpFeatures: [],
          },
        }),
      ]),
    );
    const cells = lines(csv)[1]?.split(",");
    expect(cells?.[4]).toBe("");
    expect(cells?.[5]).toBe("");
  });

  it("keeps the AI Overview column tri-state: yes, no, and blank for silence", () => {
    const observed = row({
      keyword: "a",
      serp: { ...row().serp, pageOneItemTypes: ["ai_overview"] },
    });
    const absent = row({
      keyword: "b",
      serp: { ...row().serp, pageOneItemTypes: ["organic"] },
    });
    const silent = row({
      keyword: "c",
      serp: { ...row().serp, pageOneItemTypes: null },
    });

    const rows = lines(
      keywordOpportunityCsv(result([observed, absent, silent])),
    ).slice(1);
    expect(rows.map((line) => line.split(",")[9])).toEqual(["yes", "no", ""]);
  });

  it("neutralises formula-leading keywords so a spreadsheet cannot execute them", () => {
    // Keywords come out of a model reading arbitrary websites, which makes
    // them attacker-influenced input for whatever spreadsheet opens the file.
    const csv = keywordOpportunityCsv(
      result([row({ keyword: "=cmd|'/c calc'!A0" })]),
    );
    expect(lines(csv)[1]).toContain("'=cmd|'/c calc'!A0");
  });

  it("neutralises formula-leading v2 evidence values too", () => {
    const csv = keywordOpportunityCsv(
      result([
        row({
          signals: {
            ...SIGNALS,
            youngDomain: {
              state: "observed",
              observation: {
                ...YOUNG_DOMAIN_OBSERVATION,
                domain: "=malicious-domain",
              },
            },
          },
          decision: decision(),
        }),
      ]),
    );

    expect(lines(csv)[1]).toContain(",'=malicious-domain,");
  });

  it("quotes cells that carry the delimiter", () => {
    const csv = keywordOpportunityCsv(
      result([row({ keyword: "espresso, but portable" })]),
    );
    expect(lines(csv)[1]).toContain('"espresso, but portable"');
  });

  it("exports eligible rows in the shared v2 display order", () => {
    // The file and the page are the same claim. A reader who downloads and
    // compares must not find the two disagreeing about order.
    const small = row({ keyword: "small" });
    const big = {
      ...row({ keyword: "big" }),
      validation: { ...row({}).validation, volume: 9000 },
    };
    const question = {
      ...row({ keyword: "a question", lane: "geo" as const }),
      decision: decision({
        positiveSignals: ["young_domain", "community_result"],
      }),
      supportingPageUrl: "https://example.test/page",
    };
    const csv = keywordOpportunityCsv(
      result([
        question,
        { ...small, decision: decision() },
        { ...big, decision: decision() },
      ]),
    );

    expect(
      lines(csv)
        .slice(1)
        .map((line) => line.split(",")[3]),
    ).toEqual(["big", "small", "a question"]);
  });
});

describe("keywordOpportunityDisplayItems", () => {
  it("orders dispositions, then gives excluded and incomplete deterministic keyword/reason order", () => {
    const ordered = keywordOpportunityDisplayItems(
      result([row({ keyword: "eligible" })], {
        withheld: [
          {
            keyword: "Zulu",
            discoveryBasis: "site_proposition",
            reason: "volume_priced_at_zero",
          },
          {
            keyword: "alpha",
            discoveryBasis: "site_proposition",
            reason: "already_covered",
          },
        ],
        incomplete: [
          incomplete("Zulu", "serp_evidence_unavailable"),
          incomplete("alpha", "community_result_signal_unavailable"),
        ],
      }),
    );

    expect(
      ordered.map(
        (item) =>
          `${item.disposition}:${item.candidate.keyword}:${"reason" in item.candidate ? item.candidate.reason : ""}`,
      ),
    ).toEqual([
      "eligible:eligible:",
      "excluded:alpha:already_covered",
      "excluded:Zulu:volume_priced_at_zero",
      "incomplete:alpha:community_result_signal_unavailable",
      "incomplete:Zulu:serp_evidence_unavailable",
    ]);
  });

  it("orders eligible rows by positive signal count descending", () => {
    const one = row({ keyword: "one", decision: decision() });
    const two = row({
      keyword: "two",
      decision: decision({
        positiveSignals: ["young_domain", "community_result"],
      }),
    });

    expect(keywordOpportunityDisplayRows([one, two]).map((item) => item.keyword)).toEqual([
      "two",
      "one",
    ]);
  });

  it("keeps the page's SEO section before GEO even when GEO has more signals", () => {
    const seo = row({
      keyword: "seo opening",
      lane: "seo",
      validation: { ...row().validation, volume: 1 },
      decision: decision({ positiveSignals: ["young_domain"] }),
    });
    const geo = row({
      keyword: "geo opening",
      lane: "geo",
      validation: { ...row().validation, volume: 100_000 },
      decision: decision({
        positiveSignals: [
          "young_domain",
          "low_organic_traffic_domain",
          "community_result",
        ],
      }),
    });

    expect(keywordOpportunityDisplayRows([geo, seo])).toEqual([seo, geo]);
  });

  it.each(["excluded", "incomplete"] as const)(
    "fails closed when result.rows contains a %s decision",
    (disposition) => {
      const invalid = row({
        keyword: "misclassified",
        decision: decision({ disposition }),
      });

      expect(() =>
        keywordOpportunityDisplayItems(result([invalid])),
      ).toThrowError(
        `KeywordOpportunityResult.rows contains a ${disposition} decision`,
      );
    },
  );

  it("puts an undiscounted eligible row before an AI-answer-discounted row", () => {
    const undiscounted = row({
      keyword: "undiscounted",
      validation: { ...row().validation, volume: 10 },
      decision: decision(),
    });
    const discounted = row({
      keyword: "discounted",
      validation: { ...row().validation, volume: 10_000 },
      decision: decision({ discounts: ["ai_overview_answer_discount"] }),
    });

    expect(
      keywordOpportunityDisplayRows([discounted, undiscounted]).map(
        (item) => item.keyword,
      ),
    ).toEqual(["undiscounted", "discounted"]);
  });

  it("sorts measured volume descending and puts null last", () => {
    const unpriced = row({
      keyword: "unpriced",
      validation: { ...row().validation, volume: null },
      decision: decision(),
    });
    const low = row({
      keyword: "low",
      validation: { ...row().validation, volume: 10 },
      decision: decision(),
    });
    const high = row({
      keyword: "high",
      validation: { ...row().validation, volume: 100 },
      decision: decision(),
    });

    expect(
      keywordOpportunityDisplayRows([unpriced, low, high]).map(
        (item) => item.keyword,
      ),
    ).toEqual(["high", "low", "unpriced"]);
  });

  it("uses normalized keyword order and preserves input order for a normalized tie", () => {
    const firstTie = row({ keyword: "  Ｂeta  ", decision: decision() });
    const alpha = row({ keyword: "alpha", decision: decision() });
    const secondTie = row({ keyword: "beta", decision: decision() });

    expect(
      keywordOpportunityDisplayRows([firstTie, secondTie, alpha]),
    ).toEqual([alpha, firstTie, secondTie]);
  });

  it("keeps an old result bundle with no optional v2 fields exportable", () => {
    const oldRow = row({
      keyword: "legacy",
      validation: { ...row().validation, volume: null },
    });
    const oldResult = result([oldRow]);

    expect(keywordOpportunityDisplayItems(oldResult)).toEqual([
      { disposition: "eligible", candidate: oldRow },
    ]);
    expect(lines(keywordOpportunityCsv(oldResult))).toHaveLength(2);
    expect(lines(keywordOpportunityCsv(oldResult))[1]?.split(",").slice(16)).toEqual(
      V2_COLUMNS.map(() => ""),
    );
  });
});

describe("keywordOpportunityCsvFilename", () => {
  it("carries the market pair when both codes look like codes", () => {
    expect(
      keywordOpportunityCsvFilename({ marketCode: "US", languageCode: "en" }),
    ).toBe("keyword-opportunity-map-us-en.csv");
  });

  it("drops the suffix rather than interpolating an unrecognised value", () => {
    // The codes arrive from an API payload; a path separator or a quote has
    // no business reaching a `download` attribute.
    expect(
      keywordOpportunityCsvFilename({
        marketCode: "../etc",
        languageCode: "en",
      }),
    ).toBe("keyword-opportunity-map.csv");
  });
});
