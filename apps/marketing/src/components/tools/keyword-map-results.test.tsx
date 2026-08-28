// @input  -- keyword map results rendered through the real message bundles
// @output -- a failing test when an unread sample renders as a count, when a run
//            with no rows renders as a blank, or when the advice sinks below the evidence
// @pos    -- the guard on the report surface's reading order and its honest absences
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import type {
  KeywordOpportunityFunnel,
  KeywordOpportunityIncomplete,
  KeywordOpportunityResult,
  KeywordOpportunityRow,
} from "@sf/public-tools/keyword-opportunity/types";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import {
  FUNNEL_COLUMNS,
  FUNNEL_STEPS,
  KeywordMapResults,
  funnelGridDividesEvenly,
} from "./keyword-map-results.tsx";
import { KeywordMapArticle } from "./keyword-map-article.tsx";
import { getConnectedToolContent } from "./connected-tool-content.ts";

const FUNNEL: KeywordOpportunityFunnel = {
  generated: 150,
  deduplicated: 150,
  providerReturned: 41,
  volumePositive: 30,
  explicitZero: 11,
  providerNoData: 109,
  alreadyCovered: 0,
  serpSampled: 20,
  winnableEvidence: 10,
  shown: 2,
};

function seoRow(keyword: string): KeywordOpportunityRow {
  return {
    keyword,
    lane: "seo",
    discoveryBasis: "site_proposition",
    questionForm: false,
    propositionIndex: 0,
    validation: {
      availability: "available",
      volume: 320,
      difficulty: 14,
      intent: "commercial",
      serpFeatures: [],
    },
    serp: {
      verdict: "winnable_evidence",
      weakestTopTenDomainRank: 8,
      weakestTopTenDomain: "example.com",
      weakestTopTenPosition: 4,
      topTenDomains: ["example.com"],
      topTenDomainRanks: [8],
      pageOneItemTypes: null,
      isEstimate: false,
    },
    coverage: "not_observed_in_gsc_query_sample",
    supportingPageUrl: null,
    nextChecks: ["read_page_one_intent"],
    clusterId: "cluster-1",
  };
}

function v2SeoRow(keyword: string): KeywordOpportunityRow {
  const base = seoRow(keyword);
  return {
    ...base,
    validation: {
      ...base.validation,
      providerIntent: "commercial",
    },
    serp: {
      ...base.serp,
      status: "complete",
      failureReason: null,
      observedAt: "2026-08-20T08:00:00.000Z",
      organicResults: [
        {
          position: 2,
          domain: "new.example",
          url: "https://new.example/guide",
          title: "New clinic billing guide",
        },
        {
          position: 5,
          domain: "reddit.com",
          url: "https://reddit.com/r/dentistry/comments/billing",
          title: "Clinic billing discussion",
        },
      ],
    },
    serpIntent: {
      intent: "informational",
      source: "serp_top_ten_interpretation",
      observedAt: "2026-08-20T08:00:00.000Z",
      modelId: "gpt-5.4-mini",
      promptVersion: "keyword_serp_interpretation.v1",
    },
    signals: {
      youngDomain: {
        state: "observed",
        observation: {
          domain: "new.example",
          registrationDate: "2025-07-01T00:00:00.000Z",
          observedAt: "2026-08-20T08:00:00.000Z",
          ageMonths: 13,
        },
      },
      lowOrganicTrafficDomain: {
        state: "observed",
        observation: {
          domain: "tiny.example",
          organicEtv: 420,
          threshold: 5_000,
          marketCode: "US",
          languageCode: "en",
          observedAt: "2026-08-20T08:00:00.000Z",
        },
      },
      communityResult: {
        state: "observed",
        observation: {
          domain: "reddit.com",
          url: "https://reddit.com/r/dentistry/comments/billing",
          position: 5,
          source: "domain_fallback",
        },
      },
    },
    aiOverview: {
      availability: "observed",
      loadedAsync: true,
      answerAssessment: "complete",
      reason: null,
      modelId: "gpt-5.4-mini",
      promptVersion: "keyword_serp_interpretation.v1",
    },
    decision: {
      disposition: "eligible",
      basis: "positive_signal_observed",
      positiveSignals: [
        "young_domain",
        "low_organic_traffic_domain",
        "community_result",
      ],
      discounts: ["ai_overview_answer_discount"],
    },
    coverage: "possible_existing_page",
    nextChecks: ["read_page_one_intent", "judge_commercial_fit"],
  };
}

function v2GeoRow(keyword: string): KeywordOpportunityRow {
  const base = v2SeoRow(keyword);
  return {
    ...base,
    lane: "geo",
    questionForm: true,
    supportingPage: {
      availability: "available",
      source: "llm_proposition_source",
      url: "https://acme.test/resources/how-to-win?utm_source=fixture#answer",
    },
    supportingPageUrl:
      "https://acme.test/resources/how-to-win?utm_source=fixture#answer",
  };
}

function incomplete(
  keyword: string,
  reason: KeywordOpportunityIncomplete["reason"],
): KeywordOpportunityIncomplete {
  const unavailable = {
    state: "unavailable" as const,
    observation: null,
    reason: "fixture_unavailable",
  };
  return {
    keyword,
    lane: "seo",
    discoveryBasis: "traditional_expansion",
    validation: {
      availability: "available",
      volume: 100,
      difficulty: 20,
      providerIntent: "informational",
      intent: "informational",
      serpFeatures: [],
    },
    coverage: "not_observed_in_gsc_query_sample",
    serp: {
      status: "unavailable",
      failureReason: "provider_unavailable",
      observedAt: null,
      organicResults: [],
      verdict: "no_serp_evidence",
      weakestTopTenDomainRank: null,
      weakestTopTenDomain: null,
      weakestTopTenPosition: null,
      topTenDomains: [],
      topTenDomainRanks: [],
      pageOneItemTypes: null,
      isEstimate: false,
    },
    serpIntent: null,
    signals: {
      youngDomain: unavailable,
      lowOrganicTrafficDomain: unavailable,
      communityResult: unavailable,
    },
    aiOverview: null,
    reason,
    decision: {
      disposition: "incomplete",
      basis: "signal_evidence_unavailable",
      positiveSignals: [],
      discounts: [],
    },
  };
}

function result(
  overrides: Partial<KeywordOpportunityResult> = {},
): KeywordOpportunityResult {
  return {
    availability: "available",
    marketCode: "US",
    languageCode: "en",
    context: {
      siteUrl: "https://acme.test",
      pagesFetched: 20,
      productPagesFetched: 3,
      selection: {
        eligibleCandidates: 28,
        excludedCandidates: 8,
        attemptedCandidates: 23,
        truncatedCandidates: 5,
      },
      propositions: [
        {
          statement: "Billing for dental clinics",
          sourceUrl: "https://acme.test/",
        },
      ],
      contextSufficient: true,
      stopReason: "max_urls",
    },
    rows: [seoRow("dental billing software"), seoRow("dental billing service")],
    withheld: [],
    clusters: [],
    funnel: FUNNEL,
    unavailableStages: [],
    nextStepSuggestions: [],
    ...overrides,
  };
}

/**
 * The bundle's copy as react-dom writes it into markup.
 *
 * react escapes `&`, `<`, `>`, `"` and `'` in text children, so a string with
 * an apostrophe never appears in the output verbatim. Comparing against the
 * raw bundle value makes `toContain` fail and — worse — makes `not.toContain`
 * pass for copy that is right there on the page.
 */
function asRendered(copy: string): string {
  return copy
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

function render(
  locale: "en" | "zh",
  value: KeywordOpportunityResult = result(),
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "en" ? en : zh}
    >
      <KeywordMapResults result={value} locale={locale} />
    </NextIntlClientProvider>,
  );
}

/**
 * The one tile carrying `label`, as markup.
 *
 * Asserting that a label and a number both appear somewhere on the page proves
 * nothing about which number sits under which label — the counts could be
 * swapped, or all three could be the same value, and the assertion would hold.
 */
function tileFor(markup: string, label: string): string {
  const at = markup.indexOf(asRendered(label));
  expect(at, `no tile labelled ${label}`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf('<div class="px-3', at);
  expect(start, `${label} is not inside a tile`).toBeGreaterThan(-1);
  return markup.slice(start, at);
}

function tableRowFor(markup: string, keyword: string): string {
  const at = markup.indexOf(keyword);
  expect(at, `no row for ${keyword}`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<tr", at);
  const end = markup.indexOf("</tr>", at);
  expect(start, `${keyword} is not inside a row`).toBeGreaterThan(-1);
  expect(end, `${keyword} row never closes`).toBeGreaterThan(at);
  return markup.slice(start, end);
}

function summaryRowFor(markup: string, keyword: string): string {
  const marker = `data-keyword-row="${keyword}"`;
  const at = markup.indexOf(marker);
  expect(at, `no summary row for ${keyword}`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<tr", at);
  const end = markup.indexOf("</tr>", at);
  expect(start, `${keyword} is not inside a summary row`).toBeGreaterThan(-1);
  expect(end, `${keyword} summary row never closes`).toBeGreaterThan(at);
  return markup.slice(start, end);
}

function tableFor(markup: string, lane: "seo" | "geo"): string {
  const marker = `data-keyword-table="${lane}"`;
  const at = markup.indexOf(marker);
  expect(at, `no ${lane} keyword table`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<table", at);
  const end = markup.indexOf("</table>", at);
  expect(start, `${lane} marker is not inside a table`).toBeGreaterThan(-1);
  expect(end, `${lane} table never closes`).toBeGreaterThan(at);
  return markup.slice(start, end);
}

function detailsFor(markup: string, label: string): string {
  const at = markup.indexOf(asRendered(label));
  expect(at, `no details group labelled ${label}`).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<details", at);
  const end = markup.indexOf("</details>", at);
  expect(start, `${label} is not inside details`).toBeGreaterThan(-1);
  expect(end, `${label} details never closes`).toBeGreaterThan(at);
  return markup.slice(start, end);
}

describe("keyword map results", () => {
  it("renders six SEO columns and five GEO columns in locally scrollable compact tables", () => {
    const seo = v2SeoRow("compact seo keyword");
    const geo = v2GeoRow("compact geo question");
    const markup = render("en", result({ rows: [seo, geo] }));
    const seoTable = tableFor(markup, "seo");
    const geoTable = tableFor(markup, "geo");

    expect(seoTable.match(/<th\b/g)).toHaveLength(6);
    expect(geoTable.match(/<th\b/g)).toHaveLength(5);
    expect(seoTable).toContain("min-w-[1160px]");
    expect(geoTable).toContain("min-w-[1120px]");
    expect(seoTable).not.toContain("min-w-[1480px]");
    expect(geoTable).not.toContain("min-w-[1480px]");
    expect(seoTable).toContain("text-[13px]");
    expect(seoTable).toContain("leading-[1.45]");
    expect(seoTable).toContain("text-[15.5px]");
    expect(seoTable).toContain("tabular-nums");

    for (const lane of ["seo", "geo"] as const) {
      const marker = `data-keyword-scroll="${lane}"`;
      const at = markup.indexOf(marker);
      expect(at, `no ${lane} scroll container`).toBeGreaterThan(-1);
      const start = markup.lastIndexOf("<div", at);
      const end = markup.indexOf(">", at);
      const scroll = markup.slice(start, end);
      expect(scroll).toContain('tabindex="0"');
      expect(scroll).toContain('role="region"');
      expect(scroll).toContain(`aria-labelledby="keyword-lane-${lane}"`);
      expect(scroll).toContain("overflow-x-auto");
      expect(scroll).toContain("focus-visible:outline");
    }
  });

  it("keeps the fixed cell widths inside the SEO and GEO compact budgets", () => {
    const seo = v2SeoRow("budgeted seo keyword");
    const geo = v2GeoRow("budgeted geo question");
    const markup = render("en", result({ rows: [seo, geo] }));
    const widthsFor = (row: KeywordOpportunityRow): number[] =>
      [...summaryRowFor(markup, row.keyword).matchAll(/\bw-\[(\d+)px\]/g)].map(
        (match) => Number(match[1]),
      );
    const seoWidths = widthsFor(seo);
    const geoWidths = widthsFor(geo);

    expect(seoWidths).toEqual([220, 100, 190, 230, 170, 230]);
    expect(geoWidths).toEqual([220, 190, 230, 170, 230]);
    expect(seoWidths.reduce((total, width) => total + width, 0)).toBeLessThanOrEqual(
      1160,
    );
    expect(geoWidths.reduce((total, width) => total + width, 0)).toBeLessThanOrEqual(
      1120,
    );
  });

  it.each(["en", "zh"] as const)(
    "keeps decision facts in the compact SEO row and technical provenance out in %s",
    (locale) => {
      const row = v2SeoRow("compact evidence keyword");
      const markup = render(locale, result({ rows: [row] }));
      const summary = summaryRowFor(markup, row.keyword);
      const expected =
        locale === "en"
          ? [
              "Provider intent",
              "Commercial",
              "SERP interpreted intent",
              "Informational",
              "Volume",
              "320",
              "KD",
              "14",
              "Weakest rank",
              "8",
              "example.com",
              "#4",
              "Young domain",
              "13 months old",
              "Low organic traffic domain",
              "ETV 420",
              "Community result",
              "reddit.com",
              "Provider availability",
              "Observed on page one",
              "Answer assessment",
              "Complete answer",
              "A sitemap URL looks related; verify the page",
              "Decide whether this demand is your buyer",
            ]
          : [
              "数据源意图",
              "商业调研型",
              "SERP 解读意图",
              "信息型",
              "搜索量",
              "320",
              "KD",
              "14",
              "最弱排名",
              "8",
              "example.com",
              "#4",
              "年轻域名",
              "站龄 13 个月",
              "低自然搜索流量域名",
              "ETV 420",
              "社区结果",
              "reddit.com",
              "数据源可用性",
              "第一页已观测到",
              "答案评估",
              "完整回答",
              "Sitemap 中有疑似相关页面，需核对",
              "判断这波需求是不是你的买家",
            ];
      for (const copy of expected) expect(summary).toContain(copy);
      for (const technical of [
        "gpt-5.4-mini",
        "keyword_serp_interpretation.v1",
        "https://reddit.com/r/dentistry/comments/billing",
        "Clinic billing discussion",
        "2025-07-01",
        locale === "en" ? "threshold 5,000" : "阈值 5,000",
      ]) {
        expect(summary).not.toContain(technical);
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "renders GEO as a five-column lane with a readable supporting host/path in %s",
    (locale) => {
      const row = v2GeoRow("how does compact evidence work");
      const markup = render(locale, result({ rows: [row] }));
      const table = tableFor(markup, "geo");
      const summary = summaryRowFor(markup, row.keyword);

      expect(table.match(/<th\b/g)).toHaveLength(5);
      expect(table).not.toContain(locale === "en" ? ">Volume<" : ">搜索量<");
      expect(table).not.toContain(">KD<");
      expect(table).not.toContain(
        locale === "en" ? ">Weakest rank<" : ">最弱排名<",
      );
      expect(summary).toContain("acme.test/resources/how-to-win");
      expect(summary).not.toContain(
        "https://acme.test/resources/how-to-win?utm_source=fixture#answer",
      );
    },
  );

  it.each(["en", "zh"] as const)(
    "keeps GEO no-page-observed and invalid-page-unavailable explicit in %s",
    (locale) => {
      const observedBase = v2GeoRow("geo support evidence");
      const notObserved = {
        ...observedBase,
        keyword: "geo supporting page not observed",
        supportingPage: undefined,
        supportingPageUrl: null,
      };
      const unavailable = {
        ...observedBase,
        keyword: "geo supporting page unavailable",
        supportingPage: undefined,
        supportingPageUrl: "not a valid supporting URL",
      };
      const markup = render(
        locale,
        result({ rows: [notObserved, unavailable] }),
      );
      const notObservedRow = summaryRowFor(markup, notObserved.keyword);
      const unavailableRow = summaryRowFor(markup, unavailable.keyword);
      const notObservedCell = notObservedRow.match(/<td\b[\s\S]*?<\/td>/g)?.[1];
      const unavailableCell = unavailableRow.match(/<td\b[\s\S]*?<\/td>/g)?.[1];

      expect(notObservedCell).toContain(
        locale === "en"
          ? "No supporting page observed"
          : "未观测到支持页面",
      );
      expect(unavailableCell).toContain(
        locale === "en"
          ? "Supporting page unavailable"
          : "支持页面不可用",
      );
      expect(notObservedCell).not.toContain(">—<");
      expect(unavailableCell).not.toContain("not a valid supporting URL");
    },
  );

  it("combines scope, outcome counts and CSV before a collapsed native screening process", () => {
    const value = result({
      rows: [v2SeoRow("included keyword")],
      incomplete: [
        incomplete("incomplete keyword", "serp_evidence_unavailable"),
      ],
      withheld: [
        {
          keyword: "withheld keyword",
          discoveryBasis: "site_proposition",
          reason: "volume_priced_at_zero",
        },
      ],
      availability: "partial",
      unavailableStages: ["serp_sample"],
      funnel: { ...FUNNEL, serpSampled: 0, winnableEvidence: 0 },
      process: {
        validation: {
          requested: 3,
          available: 1,
          explicitZero: 1,
          providerNoData: 1,
          accounted: true,
        },
        serp: {
          planned: 2,
          dispatched: 2,
          completed: 0,
          failed: 2,
          legacyStatusUnreported: 0,
          failureReasons: {
            provider_unavailable: 2,
            provider_no_data: 0,
            transport_outcome_unknown: 0,
            budget_exhausted: 0,
            unreported: 0,
          },
          accounted: true,
        },
        supportingPages: {
          sources: {
            gsc_observed_query_page: 0,
            lexical_page_match: 1,
            llm_proposition_source: 0,
            inventory_url_match: 0,
          },
          sourceUnreported: 0,
          unavailable: 2,
          accounted: true,
        },
        decisions: {
          eligible: 1,
          withheld: 1,
          incomplete: 1,
          positiveWithUnavailableSignals: 1,
          withheldReasons: {
            volume_priced_at_zero: 1,
            volume_not_returned: 0,
            already_covered: 0,
            page_one_contested: 0,
            page_one_ranks_unresolved: 0,
            serp_sample_budget_exhausted: 0,
            serp_sample_unavailable: 0,
            no_supporting_page: 0,
            all_signals_not_observed: 0,
          },
          incompleteReasons: {
            serp_evidence_unavailable: 1,
            young_domain_signal_unavailable: 0,
            low_organic_traffic_signal_unavailable: 0,
            community_result_signal_unavailable: 0,
          },
          accounted: true,
        },
        signalStates: [],
        legacyWithoutSignals: 0,
        thresholds: {
          policyVersion: "keyword_opportunity_thresholds.v1",
          youngDomainMonths: 24,
          siteDomainRank: 180,
          siteRankTier: "rank_1_200",
          lowOrganicTrafficThreshold: 5_000,
        },
        durationsMs: {
          total: 3_200,
          validation: 100,
          coverage: 400,
          serpSampling: 1_200,
          serpInterpretation: 300,
          domainEnrichment: 700,
          report: 50,
        },
      },
    });
    const markup = render("en", value);
    const marker = 'data-result-summary=""';
    const at = markup.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const start = markup.lastIndexOf("<section", at);
    const end = markup.indexOf("</section>", at);
    const summary = markup.slice(start, end);

    for (const copy of [
      "https://acme.test",
      "United States / English",
      "Included",
      "1",
      "Detection incomplete",
      "Excluded",
      "Export CSV",
    ]) {
      expect(summary).toContain(copy);
    }
    const detailsAt = summary.indexOf('data-screening-process=""');
    expect(detailsAt).toBeGreaterThan(-1);
    const detailsStart = summary.lastIndexOf("<details", detailsAt);
    const detailsTagEnd = summary.indexOf(">", detailsAt);
    const details = summary.slice(detailsStart);
    expect(summary.slice(detailsStart, detailsTagEnd)).not.toContain(" open");
    expect(details).toContain("Screening process");
    expect(details.indexOf("Screening process")).toBeLessThan(
      details.indexOf("Generated"),
    );
    expect(details.match(/not checked/g)).toHaveLength(2);
    for (const copy of [
      "Run ledger",
      "Page-one sampling planned 2, dispatched 2, completed 0, and left 2 unavailable.",
      "Unavailable page-one reads: Results-page provider unavailable 2.",
      "Pricing requested 3: 1 measured positive, 1 explicit zero, 1 provider no data.",
      "Supporting-page evidence across all candidates",
      "Related crawled page 1",
      "Decision totals: 1 eligible, 1 excluded, 1 incomplete.",
      "Provisional policy keyword_opportunity_thresholds.v1",
      "Stage time: total 3,200ms.",
      "All reported ledger totals reconcile.",
    ]) {
      expect(details).toContain(copy);
    }
  });

  it.each(["en", "zh"] as const)("renders a full run in %s", (locale) => {
    const markup = render(locale);
    expect(markup).toContain("dental billing software");
    expect(markup).toContain("acme.test");
    // next-intl renders a key it cannot resolve as the dotted path rather than
    // throwing, so a hole in one bundle is invisible to any assertion about
    // the data. The namespace prefix appearing at all IS the hole.
    expect(markup).not.toContain("tools.keywordMap.");
  });

  it.each(["en", "zh"] as const)(
    "states the 20-page context boundary and the exact early stop in %s",
    (locale) => {
      const markup = render(locale);
      const expected =
        locale === "en"
          ? [
              "bounded context of up to 20 pages",
              "The 20-page context limit was reached",
            ]
          : ["最多 20 个页面的有限上下文", "已触及 20 页上下文上限"];
      for (const copy of expected) expect(markup).toContain(copy);

      expect(markup).not.toContain("covered the whole site");
      expect(markup).not.toContain("已抓完整站");
    },
  );

  it.each(["en", "zh"] as const)(
    "renders exact eligible, excluded, attempted, and truncated L2 counts in %s",
    (locale) => {
      const markup = render(locale);
      const expected =
        locale === "en"
          ? "28 eligible candidates, 8 excluded before page requests, 23 attempted, and 5 left unattempted after the 20-page limit"
          : "28 个合格候选页，8 个在页面请求前排除，实际尝试 23 个，达到 20 页上限后还有 5 个未尝试";

      expect(markup).toContain(expected);
    },
  );

  it.each(["en", "zh"] as const)(
    "keeps provider facts and SERP inference separate while deferring provenance in %s",
    (locale) => {
      const row = v2SeoRow("intent evidence keyword");
      const markup = render(locale, result({ rows: [row] }));
      const tableRow = summaryRowFor(markup, row.keyword);
      const headings =
        locale === "en"
          ? ["Provider intent", "SERP interpreted intent"]
          : ["数据源意图", "SERP 解读意图"];
      const evidence =
        locale === "en"
          ? ["Commercial", "Informational"]
          : ["商业调研型", "信息型"];
      for (const copy of headings) expect(tableRow).toContain(copy);
      for (const copy of evidence) expect(tableRow).toContain(copy);
      expect(tableRow).not.toContain("gpt-5.4-mini");
      expect(tableRow).not.toContain("keyword_serp_interpretation.v1");
    },
  );

  it.each(["en", "zh"] as const)(
    "does not collapse missing provider and inferred intent in %s",
    (locale) => {
      const base = v2SeoRow("intent unavailable keyword");
      const row = {
        ...base,
        validation: {
          ...base.validation,
          providerIntent: null,
          intent: null,
        },
        serpIntent: null,
      };
      const tableRow = tableRowFor(
        render(locale, result({ rows: [row] })),
        row.keyword,
      );
      const unavailable = locale === "en" ? "Not returned" : "未返回";
      const inference = locale === "en" ? "Unavailable" : "不可用";

      expect(tableRow).toContain(unavailable);
      expect(tableRow).toContain(inference);
    },
  );

  it.each(["en", "zh"] as const)(
    "shows compact three-signal decisions without raw technical evidence in %s",
    (locale) => {
      const row = v2SeoRow("three signals keyword");
      const tableRow = summaryRowFor(
        render(locale, result({ rows: [row] })),
        row.keyword,
      );
      const expected =
        locale === "en"
          ? [
              "Young domain",
              "13 months old",
              "Low organic traffic domain",
              "ETV 420",
              "Community result",
              "reddit.com",
              "#5",
            ]
          : [
              "年轻域名",
              "站龄 13 个月",
              "低自然搜索流量域名",
              "ETV 420",
              "社区结果",
              "reddit.com",
              "第 5 位",
            ];
      for (const copy of expected) expect(tableRow).toContain(copy);
      for (const technical of [
        "2025-07-01",
        "5,000",
        "https://reddit.com/r/dentistry/comments/billing",
        "Clinic billing discussion",
        locale === "en" ? "Domain fallback" : "域名回退识别",
      ]) {
        expect(tableRow).not.toContain(technical);
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "keeps not-observed and unavailable signal states distinct in %s",
    (locale) => {
      const base = v2SeoRow("mixed signal states keyword");
      const row = {
        ...base,
        signals: {
          youngDomain: { state: "not_observed" as const, observation: null },
          lowOrganicTrafficDomain: {
            state: "unavailable" as const,
            observation: null,
            reason: "site_rank_tier_unavailable",
          },
          communityResult: {
            state: "not_observed" as const,
            observation: null,
          },
        },
      };
      const tableRow = summaryRowFor(
        render(locale, result({ rows: [row] })),
        row.keyword,
      );
      const expected =
        locale === "en"
          ? ["Not observed", "Unavailable"]
          : ["未观测到", "不可用"];
      for (const copy of expected) expect(tableRow).toContain(copy);
      expect(tableRow).not.toContain(
        locale === "en"
          ? "Site rank tier unavailable"
          : "站点权重层级不可用",
      );
    },
  );

  it.each(["en", "zh"] as const)(
    "renders bounded-inventory coverage as human copy in %s",
    (locale) => {
      const expected = {
        en: {
          possible_existing_page:
            "A sitemap URL looks related; verify the page",
          not_observed_in_bounded_inventory:
            "Not found in this bounded sitemap inventory",
          inventory_unavailable: "Sitemap inventory unavailable",
          inventory_truncated: "Only a partial sitemap inventory was checked",
        },
        zh: {
          possible_existing_page: "Sitemap 中有疑似相关页面，需核对",
          not_observed_in_bounded_inventory:
            "本次有限 Sitemap 页面库中未发现",
          inventory_unavailable: "Sitemap 页面库不可用",
          inventory_truncated: "只检查了部分 Sitemap 页面库",
        },
      } as const;
      const states = Object.keys(expected[locale]) as readonly (keyof (typeof expected)[typeof locale])[];
      const markup = render(
        locale,
        result({
          rows: states.map((coverage, index) => ({
            ...seoRow(`inventory coverage ${String(index)}`),
            coverage,
          })),
        }),
      );

      for (const coverage of states) {
        expect(markup, coverage).toContain(
          asRendered(expected[locale][coverage]),
        );
        expect(markup, coverage).not.toContain(coverage);
      }
    },
  );

  it("says the coverage sample was never read instead of counting zero", () => {
    // The single fact this report exists to protect. `null` is "nobody looked";
    // rendering it as a count would answer a question nobody asked, in the one
    // place readers skim.
    const markup = render(
      "en",
      result({
        funnel: { ...FUNNEL, alreadyCovered: null },
        availability: "partial",
        unavailableStages: ["gsc_coverage"],
      }),
    );
    const tile = tileFor(markup, en.tools.keywordMap.funnel.alreadyCovered);
    expect(tile).toContain(asRendered(en.tools.keywordMap.notMeasured));
    expect(tile).not.toContain(">0<");
  });

  it("blanks the page-one tiles when the sampling stage did not run", () => {
    // The payload does not carry null for these: a failed stage leaves both at
    // 0, which reads as "we opened twenty page ones and found nothing" on the
    // same card whose verdict says nobody opened any.
    const markup = render(
      "en",
      result({
        availability: "partial",
        unavailableStages: ["serp_sample"],
        funnel: { ...FUNNEL, serpSampled: 0, winnableEvidence: 0 },
      }),
    );
    for (const step of ["serpSampled", "winnableEvidence"] as const) {
      const tile = tileFor(markup, en.tools.keywordMap.funnel[step]);
      expect(tile, step).toContain(asRendered(en.tools.keywordMap.notMeasured));
      expect(tile, step).not.toContain(">0<");
    }
  });

  it("keeps a capped sample's real counts, because they were measured", () => {
    // `serp_sample_cost_capped` means fewer page ones than wanted, not none.
    // Blanking a partial measurement is its own kind of lie.
    const markup = render(
      "en",
      result({
        availability: "partial",
        unavailableStages: ["serp_sample_cost_capped"],
      }),
    );
    expect(tileFor(markup, en.tools.keywordMap.funnel.serpSampled)).toContain(
      ">20<",
    );
  });

  it("keeps priced-at-zero and no-provider-data as separate gates", () => {
    // Collapsing them is the mistake the three-state volume design exists to
    // prevent. Each label is checked against ITS OWN number: three labels and
    // three numbers all present somewhere would also hold if the values were
    // swapped or all three read the same total.
    const markup = render("en");
    const expected = {
      explicitZero: FUNNEL.explicitZero,
      providerNoData: FUNNEL.providerNoData,
      volumePositive: FUNNEL.volumePositive,
    } as const;
    for (const [step, value] of Object.entries(expected)) {
      expect(
        tileFor(
          markup,
          en.tools.keywordMap.funnel[step as keyof typeof expected],
        ),
        step,
      ).toContain(`>${value}<`);
    }
  });

  it("names the two demand states apart in the withheld list too", () => {
    // The funnel splitting them at aggregate level is no use to someone
    // deciding about one term: a priced zero is finished, a provider silence
    // is still open, and they used to share one line.
    const markup = render(
      "en",
      result({
        withheld: [
          {
            keyword: "priced at zero",
            discoveryBasis: "traditional_expansion",
            reason: "volume_priced_at_zero",
          },
          {
            keyword: "never priced",
            discoveryBasis: "traditional_expansion",
            reason: "volume_not_returned",
          },
        ],
      }),
    );
    expect(markup).toContain(
      asRendered(en.tools.keywordMap.withheld.volume_priced_at_zero),
    );
    expect(markup).toContain(
      asRendered(en.tools.keywordMap.withheld.volume_not_returned),
    );
  });

  it("keeps the funnel grid divisible by its column count", () => {
    // The tiles are separated by a 1px gap over the container's colour, so a
    // column the last row does not fill renders as a slab of divider colour.
    // Adding a tenth gate without changing the grid brings that back, and it
    // is invisible in a fixture short enough to fit one row.
    expect(FUNNEL_STEPS.length).toBeGreaterThan(0);
    expect(funnelGridDividesEvenly()).toBe(true);
    // And that the constant is the column count the page actually uses.
    // Checking divisibility alone guards an arithmetic fact about a number no
    // stylesheet reads: `grid-cols-4` in the JSX would leave it true.
    expect(render("en")).toContain(`grid-cols-${FUNNEL_COLUMNS}`);
  });

  it("explains a run that produced no rows", () => {
    const markup = render(
      "en",
      result({ rows: [], funnel: { ...FUNNEL, shown: 0 } }),
    );
    expect(markup).toContain(asRendered(en.tools.keywordMap.emptyTitle));
    expect(markup).toContain(asRendered(en.tools.keywordMap.emptyBody));
    expect(markup).not.toContain(
      asRendered(en.tools.keywordMap.lane.seo.title),
    );
    expect(markup).not.toContain(
      asRendered(en.tools.keywordMap.lane.geo.title),
    );
  });

  it.each(["en", "zh"] as const)(
    "renders incomplete candidates as their own exact-reason groups in %s",
    (locale) => {
      const value = result({
        rows: [],
        incomplete: [
          incomplete("serp missing one", "serp_evidence_unavailable"),
          incomplete("serp missing two", "serp_evidence_unavailable"),
          incomplete(
            "registration missing",
            "young_domain_signal_unavailable",
          ),
        ],
        funnel: { ...FUNNEL, shown: 0 },
      });
      const markup = render(locale, value);
      const copy = locale === "en" ? en : zh;

      expect(markup).toContain(
        asRendered(copy.tools.keywordMap.incompleteTitle),
      );
      expect(markup).toContain(
        asRendered(copy.tools.keywordMap.incompleteIntro),
      );
      expect(markup).toContain(
        asRendered(
          copy.tools.keywordMap.incomplete.serp_evidence_unavailable,
        ),
      );
      expect(markup).toContain(
        asRendered(
          copy.tools.keywordMap.incomplete.young_domain_signal_unavailable,
        ),
      );
      const serpGroup = detailsFor(
        markup,
        copy.tools.keywordMap.incomplete.serp_evidence_unavailable,
      );
      expect(serpGroup).toContain(">2</span>");
      expect(serpGroup).toContain("serp missing one");
      expect(serpGroup).toContain("serp missing two");
      expect(serpGroup).not.toContain("registration missing");
      expect(serpGroup).not.toContain("<button");
      expect(markup).toContain("serp missing one");
      expect(markup).toContain("serp missing two");
      expect(markup).toContain("registration missing");
      expect(markup).not.toContain(
        asRendered(copy.tools.keywordMap.emptyTitle),
      );
      expect(markup).toContain(locale === "en" ? "3 candidates" : "3 个候选词");
      expect(markup).toContain(
        locale === "en"
          ? "Retry the unchanged run after the missing evidence source recovers"
          : "缺失的证据源恢复后，按原条件重试本次运行",
      );
    },
  );

  it.each(["en", "zh"] as const)(
    "separates eligible, excluded and incomplete totals in %s",
    (locale) => {
      const markup = render(
        locale,
        result({
          rows: [v2SeoRow("eligible keyword")],
          withheld: [
            {
              keyword: "zero keyword",
              discoveryBasis: "traditional_expansion",
              reason: "volume_priced_at_zero",
            },
            {
              keyword: "negative signals keyword",
              discoveryBasis: "site_proposition",
              reason: "all_signals_not_observed",
            },
          ],
          incomplete: [
            incomplete("incomplete keyword", "serp_evidence_unavailable"),
          ],
        }),
      );
      const expected =
        locale === "en"
          ? [
              "Eligible opportunities",
              "1 candidate",
              "Excluded",
              "2 candidates",
              "Detection incomplete",
              "Retry guidance",
            ]
          : [
              "符合条件的机会",
              "1 个候选词",
              "已排除",
              "2 个候选词",
              "检测未完成",
              "重试建议",
            ];
      for (const copy of expected) expect(markup).toContain(copy);
    },
  );

  it("does not say the gates dropped candidates a gate never saw", () => {
    // Empty because every gate ran and rejected everything is a finding.
    // Empty because a stage failed is a hole. The default body claims the
    // first, and on a partial run that dresses missing evidence as a result.
    const markup = render(
      "en",
      result({
        rows: [],
        availability: "partial",
        unavailableStages: ["serp_sample"],
        funnel: { ...FUNNEL, shown: 0, serpSampled: 0 },
      }),
    );
    expect(markup).toContain(asRendered(en.tools.keywordMap.emptyBodyPartial));
    expect(markup).not.toContain(asRendered(en.tools.keywordMap.emptyBody));
  });

  it("puts the suggestions above the tables, not below the withheld list", () => {
    // They are only ever populated by a degraded run, so they answer the first
    // question a thin report raises. Below the withheld list is the furthest
    // point on the page from the reader who needs them.
    const markup = render(
      "en",
      result({
        availability: "insufficient_evidence",
        nextStepSuggestions: ["add_seed_keywords"],
        withheld: [
          {
            keyword: "dental billing pricing",
            discoveryBasis: "traditional_expansion",
            reason: "volume_not_returned",
          },
        ],
      }),
    );
    const advice = markup.indexOf(
      asRendered(en.tools.keywordMap.nextSteps.add_seed_keywords),
    );
    const table = markup.indexOf(
      asRendered(en.tools.keywordMap.lane.seo.title),
    );
    const withheld = markup.indexOf(
      asRendered(en.tools.keywordMap.withheldIntro),
    );
    expect(advice).toBeGreaterThan(-1);
    expect(advice).toBeLessThan(table);
    expect(table).toBeLessThan(withheld);
  });

  it("groups only the clusters that hold more than one term", () => {
    // Every unmatched keyword becomes its own cluster in the payload. Rendering
    // those turns "terms that could share a page" into a second results table.
    const markup = render(
      "en",
      result({
        clusters: [
          {
            id: "cluster-1",
            label: "dental billing",
            keywords: ["dental billing software", "dental billing service"],
          },
          {
            id: "cluster-2",
            label: "orthodontic intake",
            keywords: ["orthodontic intake"],
          },
        ],
      }),
    );
    expect(markup).toContain(asRendered(en.tools.keywordMap.clustersTitle));
    expect(markup).not.toContain("orthodontic intake");
    // The heading alone would survive `groups.map` being deleted, leaving an
    // empty card that still passes a test named for the grouping.
    expect(markup).toContain(">dental billing<");
    expect(markup).toContain(">dental billing software<");
    expect(markup).toContain(">dental billing service<");
  });

  it("hides the cluster section when nothing groups", () => {
    const markup = render(
      "en",
      result({
        clusters: [
          {
            id: "cluster-1",
            label: "dental billing software",
            keywords: ["dental billing software"],
          },
        ],
      }),
    );
    expect(markup).not.toContain(asRendered(en.tools.keywordMap.clustersTitle));
  });

  it("never shows a visitor a key path, whatever the payload names", () => {
    // The reason is a deploy, not a type. A tab holds the bundle it loaded;
    // this tool's second request lands minutes later, so a run started before
    // a release and finished after it asks an old bundle to name a value only
    // the new one has. Observed on 2026-08-11: the first real run after
    // splitting `no_measured_demand` rendered
    // "tools.keywordMap.withheld.volume_not_returned  48" on screen.
    //
    // Every field here is typed as a closed union, which is exactly the
    // reasoning that left them unguarded — completeness holds within one
    // build, and the two sides of this are two builds.
    const markup = render(
      "en",
      result({
        availability: "a_state_from_a_newer_build" as never,
        rows: [
          {
            ...seoRow("dental billing software"),
            coverage: "a_coverage_from_a_newer_build" as never,
            nextChecks: ["a_check_from_a_newer_build" as never],
          },
        ],
        withheld: [
          {
            keyword: "dental billing pricing",
            discoveryBasis: "traditional_expansion",
            reason: "a_reason_from_a_newer_build" as never,
          },
        ],
      }),
    );
    expect(markup).not.toContain("tools.keywordMap.");
    for (const value of [
      "a_state_from_a_newer_build",
      "a_coverage_from_a_newer_build",
      "a_check_from_a_newer_build",
      "a_reason_from_a_newer_build",
    ]) {
      expect(markup, value).toContain(value);
    }
  });

  it("names a market, language or stage the bundle never learned", () => {
    // The API validates marketCode and languageCode only as non-empty strings,
    // and `unavailableStages` / `nextStepSuggestions` are plain string arrays.
    // next-intl renders a missing key as its dotted path, so without a
    // fallback the report reads "market tools.keywordMap.markets.PT" after the
    // visitor waited two minutes and a provider bill for it.
    const markup = render(
      "en",
      result({
        marketCode: "PT",
        languageCode: "pt",
        availability: "partial",
        unavailableStages: ["a_stage_added_after_this_bundle"],
        nextStepSuggestions: ["a_step_added_after_this_bundle"],
      }),
    );
    // Asserting the code alone would pass on the broken output too: the key
    // path CONTAINS the code. The absence of the key path is the whole test.
    expect(markup).not.toContain("tools.keywordMap.");
    expect(markup).toContain("for PT / pt");
    expect(markup).toContain("a_stage_added_after_this_bundle");
    expect(markup).toContain("a_step_added_after_this_bundle");
  });

  it("carries an exit card, because the shell drops its own once connected", () => {
    // ConnectedToolPage hides the "URL Agents to use next" aside for a
    // connected visitor on the grounds that the report has its own. Without
    // this, a finished run is the one page on the site with nowhere to go.
    expect(render("en")).toContain('href="/agents/seo"');
    expect(render("zh")).toContain('href="/zh/agents/tech"');
  });

  it("stays silent when a complete run has nothing to suggest", () => {
    const markup = render("en");
    expect(markup).not.toContain(
      asRendered(en.tools.keywordMap.nextStepsTitle),
    );
    expect(markup).not.toContain(
      asRendered(en.tools.keywordMap.availability.available),
    );
  });

  it("orders the SEO table by measured volume, unpriced rows last", () => {
    // The payload arrives in generator order; the 2026-08-14 live run had its
    // highest-volume term at row eight. Order is read off the markup indexes
    // because a set-style assertion would pass on any order.
    const small = seoRow("small term");
    const big = {
      ...seoRow("big term"),
      validation: { ...seoRow("big term").validation, volume: 22200 },
    };
    const unpriced = {
      ...seoRow("unpriced term"),
      validation: {
        availability: "provider_no_data" as const,
        volume: null,
        difficulty: null,
        intent: null,
        serpFeatures: [],
      },
    };
    const markup = render("en", result({ rows: [small, unpriced, big] }));

    const at = (keyword: string) => markup.indexOf(keyword);
    expect(at("big term")).toBeGreaterThan(-1);
    expect(at("big term")).toBeLessThan(at("small term"));
    expect(at("small term")).toBeLessThan(at("unpriced term"));
  });

  it("names the weakest holder and its position under the rank", () => {
    const markup = render("en");
    expect(markup).toContain("example.com");
    expect(markup).toContain("· #4");
  });

  it("keeps the AI Overview column tri-state", () => {
    const observed = {
      ...seoRow("with aio"),
      serp: { ...seoRow("with aio").serp, pageOneItemTypes: ["ai_overview"] },
    };
    const absent = {
      ...seoRow("without aio"),
      serp: { ...seoRow("without aio").serp, pageOneItemTypes: ["organic"] },
    };
    const markup = render("en", result({ rows: [observed, absent] }));

    expect(markup).toContain(asRendered(en.tools.keywordMap.aio.shown));
    expect(markup).toContain(asRendered(en.tools.keywordMap.aio.notShown));
    // The silent state stays a dash — the default fixture's serp reports null.
    expect(render("en")).toContain("—");
  });

  it("lets observed v2 AI Overview evidence override unreported item types", () => {
    const row = {
      ...seoRow("evidence says shown"),
      aiOverview: {
        availability: "observed" as const,
        loadedAsync: null,
        answerAssessment: "unavailable" as const,
        reason: "content_unavailable",
        modelId: null,
        promptVersion: null,
      },
    };
    const markup = render("en", result({ rows: [row] }));

    expect(tableRowFor(markup, row.keyword)).toContain(
      asRendered(en.tools.keywordMap.aio.shown),
    );
  });

  it.each(["en", "zh"] as const)(
    "separates AI Overview availability from answer assessment and keeps complete as a discount in %s",
    (locale) => {
      const row = v2SeoRow("aio discounted but eligible");
      const tableRow = tableRowFor(
        render(locale, result({ rows: [row] })),
        row.keyword,
      );
      const expected =
        locale === "en"
          ? [
              "Provider availability",
              "Observed on page one",
              "Answer assessment",
              "Complete answer",
              "Ranking discount",
              "AI Overview already answers the query",
            ]
          : [
              "数据源可用性",
              "第一页已观测到",
              "答案评估",
              "完整回答",
              "排序折扣",
              "AI Overview 已完整回答查询",
            ];
      for (const copy of expected) expect(tableRow).toContain(copy);
      expect(tableRow).not.toContain(locale === "en" ? "Excluded" : "已排除");
    },
  );

  it.each(["en", "zh"] as const)(
    "renders not-observed AI provider evidence and unavailable assessment separately in %s",
    (locale) => {
      const base = v2SeoRow("aio not observed keyword");
      const row = {
        ...base,
        aiOverview: {
          availability: "not_observed" as const,
          loadedAsync: null,
          answerAssessment: "unavailable" as const,
          reason: "interpretation_unavailable",
          modelId: null,
          promptVersion: null,
        },
        decision: { ...base.decision!, discounts: [] },
      };
      const tableRow = tableRowFor(
        render(locale, result({ rows: [row] })),
        row.keyword,
      );

      expect(tableRow).toContain(
        locale === "en" ? "Not observed on page one" : "第一页未观测到",
      );
      expect(tableRow).toContain(locale === "en" ? "Unavailable" : "不可用");
      expect(tableRow).not.toContain(
        locale === "en" ? "Ranking discount" : "排序折扣",
      );
    },
  );

  it("lets not-observed v2 AI evidence override a legacy AI item type", () => {
    const base = seoRow("evidence says absent");
    const row = {
      ...base,
      serp: { ...base.serp, pageOneItemTypes: ["ai_overview"] },
      aiOverview: {
        availability: "not_observed" as const,
        loadedAsync: null,
        answerAssessment: "unavailable" as const,
        reason: null,
        modelId: null,
        promptVersion: null,
      },
    };
    const markup = render("en", result({ rows: [row] }));
    const tableRow = tableRowFor(markup, row.keyword);

    expect(tableRow).toContain(asRendered(en.tools.keywordMap.aio.notShown));
    expect(tableRow).not.toContain(asRendered(en.tools.keywordMap.aio.shown));
  });

  it("renders unavailable v2 AI evidence as unknown despite a legacy AI item type", () => {
    const base = seoRow("evidence unavailable");
    const row = {
      ...base,
      serp: { ...base.serp, pageOneItemTypes: ["ai_overview"] },
      aiOverview: {
        availability: "unavailable" as const,
        loadedAsync: null,
        answerAssessment: "unavailable" as const,
        reason: "item_types_unreported",
        modelId: null,
        promptVersion: null,
      },
    };
    const markup = render("en", result({ rows: [row] }));
    const tableRow = tableRowFor(markup, row.keyword);

    expect(tableRow).toContain(
      asRendered(en.tools.keywordMap.aioAvailability.unavailable),
    );
    expect(tableRow).toContain(
      asRendered(en.tools.keywordMap.aioAssessments.unavailable),
    );
    expect(tableRow).not.toContain(asRendered(en.tools.keywordMap.aio.shown));
    expect(tableRow).not.toContain(
      asRendered(en.tools.keywordMap.aio.notShown),
    );
  });

  it("hoists checks shared by every row and keeps the rest in the rows", () => {
    const shared = "read_page_one_intent" as const;
    const own = "judge_commercial_fit" as const;
    const first = { ...seoRow("first"), nextChecks: [shared, own] };
    const second = { ...seoRow("second"), nextChecks: [shared] };
    const markup = render("en", result({ rows: [first, second] }));

    expect(markup).toContain(asRendered(en.tools.keywordMap.commonChecksIntro));
    // The shared check appears once, above the table, instead of per row.
    const sharedCopy = asRendered(en.tools.keywordMap.checks[shared]);
    expect(markup.indexOf(sharedCopy)).toBe(markup.lastIndexOf(sharedCopy));
    expect(markup).toContain(asRendered(en.tools.keywordMap.checks[own]));
    expect(markup).toContain("Remaining decisions");
  });

  it("offers a seeded re-run only for the terms the budget never reached", () => {
    const withheld = [
      {
        keyword: "unjudged one",
        discoveryBasis: "site_proposition" as const,
        reason: "serp_sample_budget_exhausted" as const,
      },
      {
        keyword: "priced at zero",
        discoveryBasis: "site_proposition" as const,
        reason: "volume_priced_at_zero" as const,
      },
    ];
    const markup = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en}>
        <KeywordMapResults
          result={result({ withheld })}
          locale="en"
          onRetryWithSeeds={() => {}}
        />
      </NextIntlClientProvider>,
    );

    const button = asRendered(en.tools.keywordMap.retryWithSeeds);
    // Exactly one button: the zero-priced group is a verdict, and re-running
    // on a verdict changes nothing.
    expect(markup.indexOf(button)).toBeGreaterThan(-1);
    expect(markup.indexOf(button)).toBe(markup.lastIndexOf(button));

    // Without the callback there is no button at all.
    expect(render("en", result({ withheld }))).not.toContain(button);
  });

  it("offers the CSV export whenever there are rows to export", () => {
    expect(render("en")).toContain(asRendered(en.tools.keywordMap.exportCsv));
    expect(render("en", result({ rows: [] }))).not.toContain(
      asRendered(en.tools.keywordMap.exportCsv),
    );
  });

  it.each(["en", "zh"] as const)(
    "keeps the lexical-only grouping limitation visible in %s",
    (locale) => {
      const markup = render(
        locale,
        result({
          clusters: [
            {
              id: "grouped",
              label: "billing group",
              keywords: ["billing one", "billing two"],
            },
          ],
        }),
      );
      expect(markup).toContain(
        locale === "en"
          ? "Grouping is lexical"
          : "分组只基于词面重合",
      );
      expect(markup).toContain(
        locale === "en"
          ? "does not prove page-one overlap"
          : "不能证明第一页结果重合",
      );
    },
  );

  it.each(["en", "zh"] as const)(
    "documents full explicit-zero-exception SERP coverage without a fixed duration or cost cap in %s",
    (locale) => {
      const content = getConnectedToolContent(
        locale,
        "low-competition-keywords",
      );
      const serialized = JSON.stringify(content);
      const expected =
        locale === "en"
          ? [
              "up to 20 pages",
              "The model proposes",
              "Every candidate except an explicit-zero term",
              "durable waves of up to ten concurrent",
              "provider availability",
              "answer assessment",
              "ranking discount, never a veto",
            ]
          : [
              "最多 20 个页面",
              "模型根据你确认的站点上下文提出候选词",
              "除明确核价为零以外的每个候选词",
              "每批最多 10 个并发请求的耐久步骤",
              "数据源可用性",
              "答案评估",
              "只作为排序折扣，绝不作为否决条件",
            ];
      for (const copy of expected) expect(serialized).toContain(copy);
      for (const stale of [
        "Up to twenty terms",
        "per-run cost ceiling",
        "one at a time",
        "roughly two minutes",
        "最多二十个词",
        "单次成本上限",
        "逐个打开",
        "大约两分钟",
        "Candidates are priced, not guessed",
        "候选词是核价出来的，不是猜的",
        "fixed parallel waves",
        "按固定顺序、每波",
        "replenishing pool",
        "持续补位池",
      ]) {
        expect(serialized).not.toContain(stale);
      }
    },
  );

  it.each(["en", "zh"] as const)(
    "keeps the long-form method current and has no Blog Agent handoff in %s",
    (locale) => {
      const markup = renderToStaticMarkup(
        <KeywordMapArticle locale={locale} />,
      );
      expect(markup).toContain(
        locale === "en"
          ? "Every candidate except an explicit-zero term gets a real page one"
          : "除明确核价为零外，每个候选词都检查真实第一页",
      );
      expect(markup).toContain(
        locale === "en"
          ? "complete answer lowers ordering; it does not exclude the keyword"
          : "完整回答只会降低排序，不会排除关键词",
      );
      expect(markup).toContain(
        locale === "en"
          ? "durable waves of up to ten concurrent requests"
          : "每批最多十个并发请求的耐久步骤",
      );
      expect(markup).not.toContain("replenishing pool");
      expect(markup).not.toContain("持续补位池");
      expect(markup).not.toContain("Blog Agent");
      expect(markup).not.toContain("handoff");
      expect(markup).not.toContain("写作 Agent");
    },
  );
});
