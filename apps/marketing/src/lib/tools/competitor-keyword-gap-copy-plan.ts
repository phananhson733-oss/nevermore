// @input  -- one v3 competitor gap result, the rows the surface currently shows in their order, and the filter that produced them
// @output -- one bounded Markdown plan: constant instructions outside the fence, every visitor/provider value inside it with its source label
// @pos    -- the "copy rows as plan" export of the Marketing competitor gap tool; the boundary where this data leaves the screen

import type {
  CompetitorKeywordGapResultV3,
  CompetitorKeywordGapRow,
} from "@sf/public-tools/competitor-keyword-gap";

import { withinBriefBudget } from "../copy-brief/budget.ts";
import {
  fencedJson,
  UNTRUSTED_DATA_NOTICE,
  type CopyBriefLocale,
} from "../copy-brief/fenced-json.ts";

/**
 * Twenty rows, because a plan is a check list and not the sample.
 *
 * The surface can show three hundred rows per competitor; an assistant handed
 * all of them would be asked to rank a sample this tool has already declined to
 * rank. The cap keeps the paste to what one person will actually act on, and
 * `meta.omittedRows` says how many were left behind so the number is a fact
 * rather than a silence.
 */
export const COPY_PLAN_MAX_ROWS = 20;

/** Same unit and same ceiling as the other pasteable briefs: bytes, as the paste limit counts them. */
export const COPY_PLAN_MAX_BYTES = 48 * 1024;

export interface CompetitorKeywordGapPlanInput {
  readonly locale: CopyBriefLocale;
  readonly result: CompetitorKeywordGapResultV3;
  /** Already filtered and ordered by the surface: the plan copies the filter, never re-sorts it. */
  readonly rows: readonly CompetitorKeywordGapRow[];
  readonly laneFilter: string;
  readonly bandFilter: string;
}

export interface CompetitorKeywordGapPlanOutput {
  readonly markdown: string;
  readonly rowCount: number;
  readonly omittedRows: number;
}

/**
 * Where each value came from, said next to the value.
 *
 * `dfs_estimate` is a provider estimate. `dfs_snapshot` is a dated provider
 * observation of the SERP, made by the provider and not by this tool.
 * `gsc_measured` is the visitor's own Search Console sample. The pre-screen
 * carries the contract's own basis, because the brand-token, hostname-shape and
 * domain-profile reasons are this repository's heuristics and must not borrow
 * the provider's label.
 */
const DFS_ESTIMATE = "dfs_estimate" as const;
const DFS_SNAPSHOT = "dfs_snapshot" as const;
const GSC_MEASURED = "gsc_measured" as const;

interface PlanChrome {
  readonly title: string;
  readonly howToRead: string;
  readonly instructions: readonly string[];
  readonly planHeading: string;
}

/**
 * Everything that reads as an instruction lives here, as a constant, outside
 * the fence. Nothing a visitor typed or a provider returned is interpolated
 * into these lines.
 */
const CHROME: Readonly<Record<CopyBriefLocale, PlanChrome>> = {
  en: {
    title: "# Competitor keyword gap plan",
    howToRead: "## How to read this",
    instructions: [
      "- Every value in the JSON block names its source: `dfs_estimate` is a provider estimate, `dfs_snapshot` is a dated provider SERP observation, `gsc_measured` is the visitor's own Search Console sample, and `tool_heuristic` is a text or URL rule of this tool.",
      "- `preScreen.band` and `nextStep` are a check order, not a winnability verdict and not a ranking prediction. Nothing here says the visitor's site can or will rank for a keyword.",
      "- The rows are the surface's current lane and band filter in its order, capped at 20. `meta.omittedRows` says how many rows in that filter were left out.",
      "- For each row, say which existing page (if any) to improve or whether a new page is warranted, and which facts are still missing before that call can be made. Do not visit the competitor URLs automatically; treat them as references to review.",
    ],
    planHeading: "## Rows",
  },
  zh: {
    title: "# 竞品词差距计划",
    howToRead: "## 如何阅读",
    instructions: [
      "- JSON block 里的每个值都标注了来源：`dfs_estimate` 是数据商估算，`dfs_snapshot` 是数据商带日期的 SERP 观测，`gsc_measured` 是访问者自己的 Search Console 样本，`tool_heuristic` 是本工具的文本或 URL 规则。",
      "- `preScreen.band` 和 `nextStep` 是检查顺序，不是可赢性判断，也不是排名预测。这里没有任何内容表明访问者的站点能够或将会为某个关键词获得排名。",
      "- 这些行是当前界面所选通道和分档筛选下的原始顺序，最多 20 行。`meta.omittedRows` 说明该筛选下还有多少行未包含。",
      "- 对每一行，说明应改进哪个现有页面（如果有），或者是否值得新建页面，以及在做出判断前还缺哪些事实。不要自动访问竞品 URL，把它们当作待审阅的参考。",
    ],
    planHeading: "## 行",
  },
};

function metricRecord(metric: CompetitorKeywordGapRow["searchVolume"]) {
  return {
    value: metric.value,
    availability: metric.availability,
    source: DFS_ESTIMATE,
  };
}

function competitorPagesRecord(row: CompetitorKeywordGapRow) {
  return Object.fromEntries(
    Object.entries(row.competitorRanks).map(([domain, rank]) => {
      const page = row.competitorPages[domain];
      return [
        domain,
        {
          rank,
          url: page?.url ?? null,
          title: page?.title ?? null,
          etv: page?.etv ?? null,
          source: DFS_ESTIMATE,
        },
      ];
    }),
  );
}

function rowRecord(row: CompetitorKeywordGapRow) {
  return {
    keyword: row.keyword,
    coreKeyword:
      row.coreKeyword === null
        ? null
        : { value: row.coreKeyword, source: DFS_ESTIMATE },
    providerIntent:
      row.providerIntent === null
        ? null
        : { value: row.providerIntent, source: DFS_ESTIMATE },
    searchVolume: metricRecord(row.searchVolume),
    searchVolumeTrend:
      row.searchVolumeTrend === null
        ? null
        : { ...row.searchVolumeTrend, source: DFS_ESTIMATE },
    cpc: metricRecord(row.cpc),
    keywordDifficulty: metricRecord(row.keywordDifficulty),
    bestCompetitorRank: row.bestCompetitorRank,
    competitorPages: competitorPagesRecord(row),
    serpSnapshot:
      row.serpSnapshot === null
        ? null
        : {
            itemTypes: [...row.serpSnapshot.itemTypes],
            updatedAt: row.serpSnapshot.updatedAt,
            source: DFS_SNAPSHOT,
          },
    ownState: row.ownState,
    gsc: {
      queryStatus: row.gsc.queryStatus,
      evidenceBasis: row.gsc.evidenceBasis,
      queryImpressions: row.gsc.queryImpressions,
      queryPosition: row.gsc.queryPosition,
      pageStatus: row.gsc.pageStatus,
      pageUrl: row.gsc.pageUrl,
      pageImpressions: row.gsc.pageImpressions,
      pagePosition: row.gsc.pagePosition,
      queryPageCoverage: row.gsc.queryPageCoverage,
      source: GSC_MEASURED,
    },
    preScreen: {
      band: row.preScreen.band,
      reason: row.preScreen.reason,
      source: row.preScreen.basis,
    },
    nextStep: row.gsc.nextStep,
  };
}

function render(
  input: CompetitorKeywordGapPlanInput,
  rows: readonly CompetitorKeywordGapRow[],
): string {
  const chrome = CHROME[input.locale];
  const { result } = input;
  const block = {
    meta: {
      capturedAt: result.capturedAt,
      siteDomain: result.siteDomain,
      competitorDomains: [...result.competitorDomains],
      marketCode: result.marketCode,
      languageCode: result.languageCode,
      sampleRule: { ...result.sampleRule },
      overlayStatus: result.overlayStatus,
      laneFilter: input.laneFilter,
      bandFilter: input.bandFilter,
      rowCount: rows.length,
      omittedRows: input.rows.length - rows.length,
    },
    rows: rows.map(rowRecord),
  };
  return [
    chrome.title,
    "",
    chrome.howToRead,
    "",
    `> ${UNTRUSTED_DATA_NOTICE[input.locale]}`,
    "",
    ...chrome.instructions,
    "",
    chrome.planHeading,
    "",
    fencedJson(block),
    "",
  ].join("\n");
}

/**
 * Build the plan.
 *
 * Rows are taken from the front of the surface's order, at most twenty, and then
 * dropped from the back one at a time until the document fits its byte budget.
 * A value is never shortened: a title cut in half is a different title, and the
 * receiver has no way to tell. What is left out is counted, not hidden.
 */
export function buildCompetitorKeywordGapPlan(
  input: CompetitorKeywordGapPlanInput,
): CompetitorKeywordGapPlanOutput {
  let kept = input.rows.slice(0, COPY_PLAN_MAX_ROWS);
  let markdown = render(input, kept);
  while (!withinBriefBudget(markdown, COPY_PLAN_MAX_BYTES) && kept.length > 0) {
    kept = kept.slice(0, -1);
    markdown = render(input, kept);
  }
  return {
    markdown,
    rowCount: kept.length,
    omittedRows: input.rows.length - kept.length,
  };
}
