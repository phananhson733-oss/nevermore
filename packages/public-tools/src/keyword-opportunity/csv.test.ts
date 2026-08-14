import { describe, expect, it } from "vitest";

import { keywordOpportunityCsv, keywordOpportunityCsvFilename } from "./csv.ts";
import type {
  KeywordOpportunityResult,
  KeywordOpportunityRow,
} from "./types.ts";

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
    supportingPageUrl: null,
    nextChecks: ["read_page_one_intent", "judge_commercial_fit"],
    clusterId: "cluster-1",
    ...overrides,
  };
}

function result(
  rows: readonly KeywordOpportunityRow[],
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
    withheld: [],
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

function lines(csv: string): readonly string[] {
  return csv.replace(/^\uFEFF/, "").split("\r\n");
}

describe("keywordOpportunityCsv", () => {
  it("carries the market, the evidence and the check codes on every row", () => {
    const csv = keywordOpportunityCsv(result([row()]));
    const [header, first] = lines(csv);

    expect(header).toBe(
      "market,language,lane,keyword,volume,difficulty,weakestDomainRank,weakestDomain,weakestPosition,aiOverviewObserved,coverage,supportingPageUrl,discoveryBasis,clusterId,checks",
    );
    expect(first).toBe(
      "US,en,seo,travel espresso kit,1300,12,38,smallbrew.test,6,no,not_observed_in_gsc_query_sample,,site_proposition,cluster-1,read_page_one_intent|judge_commercial_fit",
    );
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

  it("quotes cells that carry the delimiter", () => {
    const csv = keywordOpportunityCsv(
      result([row({ keyword: "espresso, but portable" })]),
    );
    expect(lines(csv)[1]).toContain('"espresso, but portable"');
  });

  it("exports rows in the display order: SEO by volume descending, then GEO", () => {
    // The file and the page are the same claim. A reader who downloads and
    // compares must not find the two disagreeing about order.
    const small = row({ keyword: "small" });
    const big = {
      ...row({ keyword: "big" }),
      validation: { ...row({}).validation, volume: 9000 },
    };
    const question = {
      ...row({ keyword: "a question", lane: "geo" as const }),
      supportingPageUrl: "https://example.test/page",
    };
    const csv = keywordOpportunityCsv(result([question, small, big]));

    expect(
      lines(csv)
        .slice(1)
        .map((line) => line.split(",")[3]),
    ).toEqual(["big", "small", "a question"]);
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
