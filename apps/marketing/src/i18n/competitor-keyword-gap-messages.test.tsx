// @vitest-environment jsdom
// @input  -- real EN/ZH catalogs and the competitor-gap form/results components
// @output -- proof representative form, status, intent, and coverage copy localizes
// @pos    -- integration guard against shipping literal next-intl key paths

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorKeywordGapEnvelope } from "@sf/public-tools/competitor-keyword-gap";
import { CompetitorKeywordGapResults } from "../components/tools/competitor-keyword-gap-results";
import { CompetitorKeywordGapTool } from "../components/tools/competitor-keyword-gap-tool";
import enMessages from "./messages/en.json";
import zhMessages from "./messages/zh.json";

vi.mock("../components/auth/sign-in-dialog", () => ({
  SignInDialog: () => null,
}));

vi.mock("../components/layout/google-analytics", () => ({
  trackMarketingEvent: vi.fn(),
}));

const ENVELOPE: CompetitorKeywordGapEnvelope = {
  run: {
    tool: "competitor_keyword_gap",
    schemaVersion: "competitor_keyword_gap.v3",
    mode: "public_preview",
    scope: "site",
    persistence: "none",
    completedAt: "2026-08-24T12:00:00.000Z",
    status: "partial",
  },
  result: {
    capturedAt: "2026-08-24T12:00:00.000Z",
    siteDomain: "example.com",
    competitorDomains: ["alpha.example", "beta.example"],
    marketCode: "US",
    languageCode: "en",
    sampleRule: {
      maxCompetitorRank: 20,
      perCompetitorLimit: 300,
      serpSnapshotRequested: true,
    },
    requestedCompetitors: 2,
    completedCompetitors: 1,
    unavailableCompetitors: 1,
    competitors: [
      {
        domain: "alpha.example",
        status: "complete",
        returnedRows: 1,
        totalCount: 1,
        truncated: false,
        failureCode: null,
      },
      {
        domain: "beta.example",
        status: "unavailable",
        returnedRows: 0,
        totalCount: null,
        truncated: false,
        failureCode: "keyword_source_unavailable",
      },
    ],
    rows: [
      {
        keyword: "approval workflow software",
        competitorRanks: { "alpha.example": 4 },
        competitorPages: {
          "alpha.example": {
            url: "https://alpha.example/approvals",
            title: "Approval workflow software",
            etv: 812.4,
          },
        },
        competitorCount: 1,
        bestCompetitorRank: 4,
        ownState: "not_observed_in_provider_rankings",
        searchVolume: { availability: "available", value: 2900 },
        cpc: { availability: "available", value: 4.2 },
        keywordDifficulty: { availability: "available", value: 31 },
        providerIntent: "commercial",
        coreKeyword: "approval workflow",
        searchVolumeTrend: { monthly: 4, quarterly: -2, yearly: 11 },
        serpSnapshot: {
          itemTypes: ["organic", "ai_overview"],
          updatedAt: "2026-05-14T18:17:21.000Z",
        },
        preScreen: {
          band: "stretch",
          basis: "dfs_estimate",
          reason: "kd_mid_rank_top20",
        },
        gsc: {
          queryStatus: "not_observed_in_gsc_query_sample",
          evidenceBasis: null,
          queryImpressions: null,
          queryPosition: null,
          pageStatus: "not_observed_in_gsc_query_page_sample",
          pageUrl: null,
          pageImpressions: null,
          pagePosition: null,
          queryPageCoverage: null,
          nextStep: "review_content_gap",
        },
      },
      {
        keyword: "query-page-only evidence",
        competitorRanks: { "alpha.example": 7 },
        competitorPages: {
          "alpha.example": { url: null, title: null, etv: null },
        },
        competitorCount: 1,
        bestCompetitorRank: 7,
        ownState: "not_observed_in_provider_rankings",
        searchVolume: { availability: "available", value: 1_200 },
        cpc: { availability: "provider_no_data", value: null },
        keywordDifficulty: { availability: "available", value: 28 },
        providerIntent: "informational",
        coreKeyword: null,
        searchVolumeTrend: null,
        serpSnapshot: null,
        preScreen: {
          band: "prioritize_serp_check",
          basis: "dfs_estimate",
          reason: "kd_low_rank_top10",
        },
        gsc: {
          queryStatus: "observed_weak",
          evidenceBasis: "query_page",
          queryImpressions: null,
          queryPosition: null,
          pageStatus: "observed_partial",
          pageUrl: "https://example.com/partial",
          pageImpressions: 12,
          pagePosition: 18,
          queryPageCoverage: null,
          nextStep: "review_existing_query",
        },
      },
      {
        keyword: "already ranking evidence",
        competitorRanks: { "alpha.example": 3 },
        competitorPages: {
          "alpha.example": { url: null, title: null, etv: null },
        },
        competitorCount: 1,
        bestCompetitorRank: 3,
        ownState: "not_observed_in_provider_rankings",
        searchVolume: { availability: "available", value: 640 },
        cpc: { availability: "provider_no_data", value: null },
        keywordDifficulty: { availability: "available", value: 22 },
        providerIntent: "informational",
        coreKeyword: null,
        searchVolumeTrend: null,
        serpSnapshot: null,
        preScreen: {
          band: "stretch",
          basis: "dfs_estimate",
          reason: "kd_mid_rank_top20",
        },
        gsc: {
          queryStatus: "observed_strong",
          evidenceBasis: "query",
          queryImpressions: 900,
          queryPosition: 4.1,
          pageStatus: "observed_sufficient",
          pageUrl: "https://example.com/ranking",
          pageImpressions: 880,
          pagePosition: 4.2,
          queryPageCoverage: 0.95,
          nextStep: "review_existing_query",
        },
      },
    ],
    resultTruncated: false,
    overlayStatus: "available",
    gscQueryTruncated: false,
    gscQueryPageTruncated: false,
    gscQueryRowCount: 40,
    gscQueryPageRowCount: 12,
  },
};

let root: Root | null = null;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

async function renderLocale(locale: "en" | "zh"): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const messages = locale === "en" ? enMessages : zhMessages;

  await act(async () => {
    root?.render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <CompetitorKeywordGapTool
          locale={locale}
          properties={["sc-domain:example.com"]}
          markets={["US"]}
        />
        <CompetitorKeywordGapResults
          envelope={ENVELOPE}
          locale={locale}
          selectedProperty="sc-domain:example.com"
          onFocusProperty={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
  });

  return host;
}

describe.each([
  {
    locale: "en" as const,
    form: "Set up your competitor keyword gap",
    status: "Partial result",
    intent: "Commercial",
    unavailable: "1 competitor unavailable",
    eyebrow: "Competitor keyword gap report",
    versus: "vs",
    returnedRows: "Returned gap rows",
    observedBody:
      "Returned rows observed in the bounded own-site GSC query or query-page sample.",
    recommendationHeader: "Recommended action",
    recommendation:
      "Not observed in this sample; review the gap before creating a page.",
    boundaries: "Evidence boundaries",
    manualSnapshot:
      "This is a manual snapshot with no saved history or automatic refresh.",
    band: "Higher KD or page two",
    preScreenBasis:
      "DataForSEO estimate; a pre-screen, not SERP winnability.",
    sampleRule: "Sample rule:",
    rankingStatus: "Already ranking · avg position 4.1",
    positionTitle:
      "Impression-weighted average position across the 28-day Search Console window, which ends three days behind today.",
    impressionsLine: "900 impressions",
    notInSample: "Not in sample",
    opportunityFinder: "Open Opportunity Finder →",
    exportCsv: "Export all 3 rows as CSV",
  },
  {
    locale: "zh" as const,
    form: "设置竞品关键词差距分析",
    status: "部分结果",
    intent: "商业调研",
    unavailable: "1 个竞品不可用",
    eyebrow: "竞品关键词差距报告",
    versus: "对比",
    returnedRows: "本次返回的差距行",
    observedBody: "在有限本站 GSC query 或 query-page 样本中观测到的返回行。",
    recommendationHeader: "建议",
    recommendation: "本次样本未观测本站；先复核差距，再决定是否新建。",
    boundaries: "数据与证据边界",
    manualSnapshot: "这是一次手动快照，不保存历史，也不会自动刷新。",
    band: "难度较高或第二页",
    preScreenBasis: "DataForSEO 估算；只是预筛，不是 SERP 可赢性。",
    sampleRule: "采样规则",
    rankingStatus: "已在排 · 均位 4.1",
    positionTitle:
      "在 28 天 Search Console 窗口内按曝光加权的平均排名；该窗口比今天滞后 3 天。",
    impressionsLine: "曝光 900",
    notInSample: "样本未观测",
    opportunityFinder: "打开 Opportunity Finder →",
    exportCsv: "导出全部 3 行 CSV",
  },
])("competitor keyword gap $locale messages", (expected) => {
  it("renders real localized scope, overview, recommendation, and boundary copy", async () => {
    const host = await renderLocale(expected.locale);

    expect(host.textContent).toContain(expected.form);
    expect(host.textContent).toContain(expected.status);
    expect(host.textContent).toContain(expected.intent);
    expect(host.textContent).toContain(expected.unavailable);
    expect(host.textContent).toContain(expected.eyebrow);
    const scope = host.querySelector("[data-scope-strip]");
    expect(scope?.textContent).toContain("example.com");
    expect(scope?.textContent).toContain("alpha.example");
    expect(scope?.textContent).toContain("beta.example");
    expect(scope?.textContent).toContain(expected.versus);
    expect(host.textContent).toContain(expected.returnedRows);
    expect(host.textContent).toContain(expected.observedBody);
    expect(host.textContent).toContain(expected.recommendationHeader);
    expect(host.textContent).toContain(expected.recommendation);
    expect(host.textContent).toContain(expected.boundaries);
    expect(host.textContent).toContain(expected.manualSnapshot);
    expect(host.textContent).toContain(expected.band);
    expect(host.textContent).toContain(expected.rankingStatus);
    // The pill states the position and the line under it does not repeat the
    // number. Only the already-ranking row carries query impressions, so this
    // is the one such line in the render.
    const impressions = host.querySelectorAll('[data-gsc-metrics="query"]');
    expect(impressions).toHaveLength(1);
    expect(impressions[0]?.textContent).toBe(expected.impressionsLine);
    expect(impressions[0]?.textContent).not.toContain("4.1");
    // "Already ranking · avg position 4.1" is present tense about Search from a
    // lagged, averaged sample. Exactly one row in this envelope carries a
    // position, so exactly one pill may carry the qualification.
    const qualified = [...host.querySelectorAll("[data-gsc-status]")].filter(
      (pill) => pill.hasAttribute("title"),
    );
    expect(qualified).toHaveLength(1);
    expect(qualified[0]?.textContent).toBe(expected.rankingStatus);
    expect(qualified[0]?.getAttribute("title")).toBe(expected.positionTitle);
    expect(host.textContent).toContain(expected.notInSample);
    // A row Search Console did not return is absent from a bounded sample, not
    // absent from Search. The reference report says "not covered"; this must
    // not, in either language.
    expect(host.textContent).not.toMatch(/not covered/i);
    expect(host.textContent).not.toContain("未覆盖");
    expect(
      host.querySelector('[data-row-action="open-opportunity-finder"]')
        ?.textContent,
    ).toBe(expected.opportunityFinder);
    expect(
      host.querySelector('[data-export-csv]')?.textContent,
    ).toBe(expected.exportCsv);
    expect(
      host.querySelector("[data-pre-screen]")?.getAttribute("title"),
    ).toContain(expected.preScreenBasis);
    expect(host.textContent).not.toContain(expected.preScreenBasis);
    expect(host.textContent).toContain(expected.sampleRule);
    expect(host.textContent).not.toContain("tools.competitorKeywordGap");
    expect(host.textContent).not.toContain("preScreen.band");
    expect(host.textContent).not.toContain("preScreen.basis");
    expect(host.textContent).not.toContain("preScreen.reason");
    expect(host.textContent).not.toContain("coverage.sampleRule");
    expect(host.textContent).not.toContain("overview.gscQueryRows");
    expect(host.textContent).not.toContain("summary.unavailable");
    expect(host.textContent).not.toContain("intent.commercial");
    expect(host.textContent).not.toContain("overview.returnedGapRows");
    expect(host.textContent).not.toContain("table.nextAction");
    expect(host.textContent).not.toContain("actions.optimizeObservedPage");
    expect(host.textContent).not.toContain("actions.openCompetitorPageNamed");
    expect(host.textContent).not.toContain("actions.openOpportunityFinder");
    expect(host.textContent).not.toContain("actions.exportCsv");
    expect(host.textContent).not.toContain("gsc.statusWithPosition");
    expect(host.textContent).not.toContain("gsc.impressionsLine");
    expect(host.textContent).not.toContain("sources.short");
    expect(host.textContent).not.toContain("legend.dfsMeans");
    expect(host.textContent).not.toContain("status.partialBody");
    expect(host.textContent).not.toContain("boundaries.manualSnapshot");
  });
});
