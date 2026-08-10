import { expect, test, type Page } from "@playwright/test";
import {
  CompetitorMonitorResponse,
  GrowthMapCompetitorDetailResponse,
  GrowthMapCompetitorLibraryResponse,
  UpdateCompetitorMonitorRequest as UpdateCompetitorMonitorRequestSchema,
  type GrowthMapCompetitorLibraryItem,
  type UpdateCompetitorMonitorRequest,
} from "../packages/contracts/src/index.ts";

import { E2E_PROJECT_ID, installGrowthVerticalApi } from "./mock-api.ts";

const COMPETITOR_A_ID = "41000000-0000-4000-8000-000000000001";
const COMPETITOR_B_ID = "41000000-0000-4000-8000-000000000002";
const TOPIC_ID = "41000000-0000-4000-8000-000000000003";
const KEYWORD_ID = "41000000-0000-4000-8000-000000000004";
const CURRENT_SNAPSHOT_ID = "41000000-0000-4000-8000-000000000005";
const PREVIOUS_SNAPSHOT_ID = "41000000-0000-4000-8000-000000000006";
const RANK_SIGNAL_ID = "41000000-0000-4000-8000-000000000007";
const CONTENT_SIGNAL_ID = "41000000-0000-4000-8000-000000000008";
const CONTENT_KEYWORD_ID = "41000000-0000-4000-8000-000000000009";
const CONTENT_KEYWORD_ID_B = "41000000-0000-4000-8000-000000000010";
const OBSERVED_AT = "2026-07-28T08:00:00.000Z";

/**
 * `sharedKeywordCount` mirrors the canonical DataForSEO competitor-domain
 * projection: passing a count also seeds the exact `serp_overlap` origin the
 * contract requires as its lineage, so the available insight stays traceable.
 * Passing `null` keeps the competitor on manual-only origins and an honest
 * unavailable insight.
 */
function competitor(
  competitorId: string,
  name: string,
  domain: string,
  suffix: string,
  sharedKeywordCount: number | null = null,
): GrowthMapCompetitorLibraryItem {
  const sharedKeywordSnapshotId = `44000000-0000-4000-8000-0000000000${suffix}`;
  const sharedKeywordObservationId = `45000000-0000-4000-8000-0000000000${suffix}`;
  const aiCitationSnapshotId = `47000000-0000-4000-8000-0000000000${suffix}`;
  const aiCitationObservationId = `48000000-0000-4000-8000-0000000000${suffix}`;
  return {
    projectId: E2E_PROJECT_ID,
    competitorId,
    domain,
    name,
    reviewStatus: "approved",
    relationship: "direct",
    analysisScope: ["keyword_gap", "content", "serp_visibility"],
    revision: 2,
    originOccurrences: [
      {
        occurrenceId: `42000000-0000-4000-8000-0000000000${suffix}`,
        observedAt: OBSERVED_AT,
        originKind: "manual",
        manualEntryId: `43000000-0000-4000-8000-0000000000${suffix}`,
        evidenceRefs: [],
      },
      ...(sharedKeywordCount === null
        ? []
        : [
            {
              occurrenceId: `46000000-0000-4000-8000-0000000000${suffix}`,
              observedAt: OBSERVED_AT,
              originKind: "serp_overlap" as const,
              snapshotId: sharedKeywordSnapshotId,
              observationId: sharedKeywordObservationId,
              evidenceRefs: [],
            },
            {
              occurrenceId: `49000000-0000-4000-8000-0000000000${suffix}`,
              observedAt: OBSERVED_AT,
              originKind: "ai_citation" as const,
              snapshotId: aiCitationSnapshotId,
              observationId: aiCitationObservationId,
              evidenceRefs: [],
            },
          ]),
    ],
    lastObservedAt: OBSERVED_AT,
    serpOverlap:
      sharedKeywordCount === null
        ? {
            availability: "unavailable",
            value: null,
            limitation: "尚无已确认的 SERP overlap 观测。",
          }
        : {
            availability: "available",
            value: sharedKeywordCount / 100,
            snapshotId: sharedKeywordSnapshotId,
            observationId: sharedKeywordObservationId,
            valuePointer: "/valueJson/serpOverlap",
            observedAt: OBSERVED_AT,
            limitation: null,
          },
    aiCitationInsight:
      sharedKeywordCount === null
        ? {
            availability: "unavailable",
            value: null,
            limitation: "尚无已确认的 AI citation 观测。",
          }
        : {
            availability: "available",
            value: 8,
            attemptedQueries: 20,
            observedQueries: 17,
            unavailableQueries: 3,
            cohortCoverage: "partial",
            querySetHash: "a".repeat(64),
            platform: "chat_gpt",
            model: "gpt-5",
            marketCode: "US",
            languageTag: "en-US",
            snapshotId: aiCitationSnapshotId,
            observationId: aiCitationObservationId,
            valuePointer: "/valueJson/citedQueries",
            observedAt: OBSERVED_AT,
            limitation: "3 个供应商回答不可用，比例仅基于 17 个已观测回答。",
          },
    sharedKeywordInsight:
      sharedKeywordCount === null
        ? {
            availability: "unavailable",
            value: null,
            limitation: "尚无覆盖该域名的规范竞品域名观测。",
          }
        : {
            availability: "available",
            value: sharedKeywordCount,
            snapshotId: sharedKeywordSnapshotId,
            observationId: sharedKeywordObservationId,
            valuePointer: "/valueJson/intersections",
            observedAt: OBSERVED_AT,
            limitation:
              "共同关键词为交集计数（非比率），口径为单市场、单搜索语言、仅自然结果的排名窗口，供应商每周刷新且不提供精确数据时间。",
          },
    coverage: {
      availability: "available",
      limitations: [],
    },
  };
}

const COMPETITOR_A_SHARED_KEYWORDS = 17;
const COMPETITOR_A = competitor(
  COMPETITOR_A_ID,
  "AtlasFlow",
  "atlasflow.com",
  "11",
  COMPETITOR_A_SHARED_KEYWORDS,
);
const COMPETITOR_B = competitor(
  COMPETITOR_B_ID,
  "BeaconPath",
  "beaconpath.com",
  "12",
);

const LIBRARY_RESPONSE = GrowthMapCompetitorLibraryResponse.parse({
  projectId: E2E_PROJECT_ID,
  data: [COMPETITOR_A, COMPETITOR_B],
  meta: {
    limit: 50,
    nextCursor: null,
    hasNext: false,
    coverage: {
      availability: "available",
      limitations: [],
    },
    discoveryCounts: {
      customer_input: 2,
      serp_duplicate: 1,
      ai_co_citation: 1,
      approved_corpus: 0,
    },
  },
});

const MONITOR_RESPONSE = CompetitorMonitorResponse.parse({
  projectId: E2E_PROJECT_ID,
  config: {
    enabled: true,
    frequency: "monthly",
    revision: 1,
    updatedAt: OBSERVED_AT,
  },
  scope: {
    market: "US",
    languageTag: "en-US",
    topicModelRevision: 4,
  },
  availability: "available",
  limitation: null,
  competitors: [
    {
      competitorId: COMPETITOR_A_ID,
      domain: "atlasflow.com",
      name: "AtlasFlow",
      relationship: "direct",
      analysisScopes: ["content", "serp_visibility"],
      eligibility: "eligible",
      collectionState: "collected",
      evaluationState: "available",
      lastCollectionAt: OBSERVED_AT,
      nextCollectionAt: "2026-08-28T08:00:00.000Z",
      limitation: null,
      recentSignals: [
        {
          kind: "rank_gain",
          signalId: RANK_SIGNAL_ID,
          competitorId: COMPETITOR_A_ID,
          detectedAt: OBSERVED_AT,
          currentSnapshotId: CURRENT_SNAPSHOT_ID,
          previousSnapshotId: PREVIOUS_SNAPSHOT_ID,
          topicNodeId: TOPIC_ID,
          topicLabel: "客户入职自动化",
          limitation: null,
          opportunityUpdate: {
            state: "ready",
            growthMapSection: "competitor_library",
            sourceRef: `competitor_monitor_signal:${RANK_SIGNAL_ID}`,
          },
          keywordId: KEYWORD_ID,
          keyword: "customer onboarding automation",
          previousRank: 18,
          currentRank: 9,
          improvement: 9,
        },
        {
          kind: "new_content_overlap",
          signalId: CONTENT_SIGNAL_ID,
          competitorId: COMPETITOR_A_ID,
          detectedAt: OBSERVED_AT,
          currentSnapshotId: CURRENT_SNAPSHOT_ID,
          previousSnapshotId: PREVIOUS_SNAPSHOT_ID,
          topicNodeId: TOPIC_ID,
          topicLabel: "客户入职自动化",
          limitation:
            "首次在两个完整、可比的 DataForSEO 排名采集中观察到该 URL；这不是发布日期证明。",
          opportunityUpdate: {
            state: "ready",
            growthMapSection: "competitor_library",
            sourceRef: `competitor_monitor_signal:${CONTENT_SIGNAL_ID}`,
          },
          url: "https://atlasflow.com/guides/customer-onboarding-playbook",
          matchedKeywordIds: [CONTENT_KEYWORD_ID, CONTENT_KEYWORD_ID_B],
          overlapRatio: 0.67,
          publicationEvidence: "first_observed_in_ranked_keywords",
        },
      ],
    },
    {
      competitorId: COMPETITOR_B_ID,
      domain: "beaconpath.com",
      name: "BeaconPath",
      relationship: "direct",
      analysisScopes: ["content", "serp_visibility"],
      eligibility: "eligible",
      collectionState: "collected",
      evaluationState: "baseline",
      lastCollectionAt: OBSERVED_AT,
      nextCollectionAt: "2026-08-28T08:00:00.000Z",
      limitation: "首次采集仅建立 baseline，不生成竞品动态提醒。",
      recentSignals: [],
    },
  ],
  generatedAt: OBSERVED_AT,
});

async function useChineseUi(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "zh-CN",
      domain: "localhost",
      path: "/",
    },
  ]);
}

async function installCompetitorApi(
  page: Page,
  options: { readonly empty?: boolean } = {},
): Promise<{
  readonly detailReads: string[];
  readonly monitorUpdates: UpdateCompetitorMonitorRequest[];
  conflictNextUpdate: boolean;
}> {
  const state = {
    detailReads: [] as string[],
    monitorUpdates: [] as UpdateCompetitorMonitorRequest[],
    conflictNextUpdate: false,
  };
  let monitorResponse = MONITOR_RESPONSE;
  const libraryResponse = options.empty
    ? GrowthMapCompetitorLibraryResponse.parse({
        ...LIBRARY_RESPONSE,
        data: [],
        meta: {
          ...LIBRARY_RESPONSE.meta,
          discoveryCounts: {
            customer_input: 0,
            serp_duplicate: 0,
            ai_co_citation: 0,
            approved_corpus: 0,
          },
        },
      })
    : LIBRARY_RESPONSE;

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/audit/competitors**`,
    async (route) => {
      const url = new URL(route.request().url());
      const listPath = `/api/mvp/projects/${E2E_PROJECT_ID}/audit/competitors`;
      if (url.pathname === listPath) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: libraryResponse }),
        });
        return;
      }

      const competitorId = decodeURIComponent(
        url.pathname.slice(`${listPath}/`.length),
      );
      const item = libraryResponse.data.find(
        (candidate) => candidate.competitorId === competitorId,
      );
      if (item === undefined) {
        await route.fulfill({
          status: 404,
          contentType: "application/problem+json",
          body: JSON.stringify({
            title: "Not found",
            status: 404,
            code: "NOT_FOUND",
          }),
        });
        return;
      }
      state.detailReads.push(competitorId);
      const detail = GrowthMapCompetitorDetailResponse.parse({
        projectId: E2E_PROJECT_ID,
        data: item,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: detail }),
      });
    },
  );

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/audit/competitor-monitor`,
    async (route) => {
      if (route.request().method() === "PUT") {
        const update = UpdateCompetitorMonitorRequestSchema.parse(
          route.request().postDataJSON(),
        );
        state.monitorUpdates.push(update);
        if (state.conflictNextUpdate) {
          state.conflictNextUpdate = false;
          await route.fulfill({
            status: 409,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "about:blank",
              title: "Version conflict",
              status: 409,
              code: "VERSION_CONFLICT",
              detail: "Competitor monitor settings changed.",
              requestId: "e2e-monitor-conflict",
            }),
          });
          return;
        }
        const currentRevision = monitorResponse.config?.revision ?? 0;
        if (update.expectedRevision !== currentRevision) {
          await route.fulfill({
            status: 409,
            contentType: "application/problem+json",
            body: JSON.stringify({
              type: "about:blank",
              title: "Version conflict",
              status: 409,
              code: "VERSION_CONFLICT",
              detail: "Competitor monitor settings changed.",
              requestId: "e2e-monitor-stale",
            }),
          });
          return;
        }
        monitorResponse = CompetitorMonitorResponse.parse({
          ...monitorResponse,
          config: {
            enabled: update.enabled,
            frequency: "monthly",
            revision: currentRevision + 1,
            updatedAt: "2026-07-28T09:00:00.000Z",
          },
          competitors: monitorResponse.competitors.map((item) =>
            item.competitorId !== COMPETITOR_A_ID
              ? item
              : {
                  ...item,
                  limitation: update.enabled
                    ? null
                    : "竞品动态监控已暂停；历史可比结果仍保留。",
                },
          ),
          generatedAt: "2026-07-28T09:00:00.000Z",
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: monitorResponse.config }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: monitorResponse }),
      });
    },
  );

  return state;
}

function competitorButton(page: Page, name: string) {
  return page.getByRole("button").filter({ hasText: name }).first();
}

/**
 * CompetitorMonitorSection moved from the detail panel into the full-profile
 * drawer (d7a0d11). Every monitor assertion must first open the drawer, either
 * from the row arrow or from the detail panel's "查看完整档案" action.
 */
function competitorDrawer(page: Page) {
  return page.getByTestId("competitor-profile-drawer");
}

function sharedKeywordCell(page: Page, domain: string) {
  return page
    .getByRole("listitem")
    .filter({ hasText: domain })
    .locator('[data-column="共同关键词"]');
}

function organicOverlapCell(
  page: Page,
  domain: string,
  column = "自然搜索重叠度",
) {
  return page
    .getByRole("listitem")
    .filter({ hasText: domain })
    .locator(`[data-column="${column}"]`);
}

function aiCitationCell(page: Page, domain: string, column = "AI 引用") {
  return page
    .getByRole("listitem")
    .filter({ hasText: domain })
    .locator(`[data-column="${column}"]`);
}

function rowArrowButton(page: Page, domain: string) {
  return page
    .getByRole("listitem")
    .filter({ hasText: domain })
    .getByRole("button", { name: "查看竞品档案" });
}

async function closeCompetitorDrawer(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(competitorDrawer(page)).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await useChineseUi(page);
  await installGrowthVerticalApi(page);
});

test("uses the row disclosure for the Artifact compact profile and keeps noisy secondary data out of the default view", async ({
  page,
}) => {
  await installCompetitorApi(page);
  await page.setViewportSize({ width: 2048, height: 1152 });
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=competitors&selectedCompetitorId=${COMPETITOR_A_ID}`,
  );

  const detail = page.getByRole("complementary", {
    name: "所选竞品详情",
  });
  await expect(
    detail.getByRole("heading", { name: "AtlasFlow", level: 2 }),
  ).toBeVisible();
  await expect(
    detail.getByTestId("competitor-detail-organic-overlap"),
  ).toHaveText(/自然搜索重叠度\s*17%/);
  await expect(
    detail.getByTestId("competitor-detail-shared-keywords"),
  ).toHaveText(/共同关键词\s*17/);
  await expect(
    detail.getByTestId("competitor-detail-ai-citations"),
  ).toHaveText(/AI 引用\s*8/);
  await expect(
    detail.getByTestId("competitor-detail-ai-citations"),
  ).not.toContainText("/");

  await rowArrowButton(page, "beaconpath.com").click();
  await expect(competitorDrawer(page)).toHaveCount(0);
  await expect(page).toHaveURL(
    new RegExp(`selectedCompetitorId=${COMPETITOR_B_ID}`),
  );
  const competitorList = page.getByRole("list", { name: "竞品列表" });
  await expect
    .poll(() =>
      competitorList.evaluate(
        (element) => element.parentElement?.scrollLeft ?? -1,
      ),
    )
    .toBe(0);
  await expect(
    competitorList
      .getByRole("listitem")
      .filter({ hasText: "beaconpath.com" })
      .getByText("BeaconPath", { exact: true }),
  ).toBeInViewport();

  await expect(
    detail.getByRole("heading", { name: "BeaconPath", level: 2 }),
  ).toBeVisible();
  for (const label of [
    "为什么进入竞品池",
    "自然搜索重叠度",
    "共同关键词",
    "AI 引用",
    "证据",
    "竞争关系",
    "分析范围",
    "关键词缺口",
    "系统证据",
  ]) {
    await expect(detail.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(detail.getByText("可用", { exact: true })).toHaveCount(0);
  await expect(detail.getByText("查看来源详情", { exact: true })).toHaveCount(
    0,
  );
  await expect(detail.getByText("月度动态", { exact: true })).toHaveCount(0);

  await detail.getByRole("button", { name: "查看完整档案" }).click();
  const drawer = competitorDrawer(page);
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText("查看来源详情", { exact: true }),
  ).toHaveCount(0);
  await expect(
    drawer.getByText("查看记录详情", { exact: true }),
  ).toHaveCount(0);
  await expect(drawer.getByTestId("competitor-monitor")).toHaveCount(0);

  await closeCompetitorDrawer(page);
  await detail.getByTestId("competitor-review-open").click();
  const review = page.getByRole("dialog", { name: "确认竞品范围" });
  await expect(review).toBeVisible();
  await expect(review.getByText(/当前审核版本/)).toHaveCount(0);
  await expect(
    review.getByRole("combobox", { name: "审核决定" }),
  ).toBeVisible();
  await expect(
    review.getByRole("combobox", { name: "竞品关系" }),
  ).toBeVisible();
  await expect(
    review.getByRole("group", { name: "分析范围（至少选择一项）" }),
  ).toBeVisible();
});

test("keeps two Competitors isolated inside the existing four-module Growth Map and links real evidence to Execution", async ({
  page,
}) => {
  const api = await installCompetitorApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=competitors&selectedCompetitorId=${COMPETITOR_A_ID}`,
  );

  const workspaceNavigation = page.getByRole("navigation", {
    name: "项目分区",
  });
  await expect(workspaceNavigation.getByRole("link")).toHaveCount(4);
  await expect(workspaceNavigation).toContainText("概览");
  await expect(workspaceNavigation).toContainText("增长地图");
  await expect(workspaceNavigation).toContainText("执行中心");
  await expect(workspaceNavigation).toContainText("效果追踪");

  const objectNavigation = page.getByRole("navigation", {
    name: "增长地图对象",
  });
  await expect(
    objectNavigation.getByRole("button", { name: /竞品库/ }),
  ).toBeVisible();
  const competitorProvenance = page.getByTestId(
    "competitor-library-provenance",
  );
  await expect(
    page.getByRole("link", { name: "添加竞品", exact: true }),
  ).toHaveAttribute("href", `/p/${E2E_PROJECT_ID}/context`);
  await expect(
    competitorProvenance.getByRole("link", { name: "管理数据来源" }),
  ).toHaveCount(0);

  // Shared keywords render the canonical intersections count only for the
  // Competitor whose serp_overlap origin backs it. The count is the exact
  // contract value, its scope caveat stays reachable behind the coverage hint,
  // and the Competitor without that origin keeps the honest fallback instead
  // of borrowing a neighbouring metric or a zero.
  const atlasSharedKeywords = sharedKeywordCell(page, "atlasflow.com");
  await expect(atlasSharedKeywords).toHaveText(
    String(COMPETITOR_A_SHARED_KEYWORDS),
  );
  await expect(
    atlasSharedKeywords.locator("[data-limitation-hint]"),
  ).toHaveAttribute("data-print-limitations", /交集计数/);
  const beaconSharedKeywords = sharedKeywordCell(page, "beaconpath.com");
  await expect(beaconSharedKeywords).toHaveText("数据不足");
  await expect(beaconSharedKeywords).not.toContainText(
    String(COMPETITOR_A_SHARED_KEYWORDS),
  );

  // Organic overlap is the persisted ratio rendered as a percentage. AI
  // citations use cited/observed for a partial cohort and disclose the fixed
  // attempted count separately, so the three unavailable responses never
  // become implicit zero-citation responses.
  await expect(organicOverlapCell(page, "atlasflow.com")).toHaveText("17%");
  const atlasAiCitations = aiCitationCell(page, "atlasflow.com");
  await expect(atlasAiCitations).toHaveText("8/17");
  await expect(
    atlasAiCitations.locator("[data-limitation-hint]"),
  ).toHaveAttribute(
    "data-print-limitations",
    /已尝试 20 个查询 · 3 个不可用/,
  );
  await expect(organicOverlapCell(page, "beaconpath.com")).toHaveText(
    "数据不足",
  );
  await expect(aiCitationCell(page, "beaconpath.com")).toHaveText("不可用");
  await expect(aiCitationCell(page, "beaconpath.com")).not.toContainText("0");

  const selectedDetail = page.getByRole("complementary", {
    name: "所选竞品详情",
  });
  await expect(
    selectedDetail
      .getByText("自然搜索重叠度", { exact: true })
      .locator("xpath=following-sibling::*[1]"),
  ).toHaveText("17%");
  const detailAiCitations = selectedDetail
    .getByText("AI 引用", { exact: true })
    .locator("xpath=following-sibling::*[1]");
  await expect(detailAiCitations).toHaveText("8");
  await expect(
    detailAiCitations.locator("[data-limitation-hint]"),
  ).toHaveCount(0);

  // The row disclosure stays in the same-page Artifact layout. Monitoring is
  // reachable only through the explicit full-profile action.
  const drawer = competitorDrawer(page);
  const monitor = page.getByTestId("competitor-monitor");
  await rowArrowButton(page, "atlasflow.com").click();
  await expect(drawer).toHaveCount(0);
  await selectedDetail.getByRole("button", { name: "查看完整档案" }).click();
  await expect(drawer).toBeVisible();
  await expect(monitor).toHaveAttribute("data-competitor-id", COMPETITOR_A_ID);
  await expect(
    drawer
      .getByText("共同关键词", { exact: true })
      .locator("xpath=following-sibling::*[1]"),
  ).toHaveText(String(COMPETITOR_A_SHARED_KEYWORDS));
  await expect(
    drawer
      .getByText("自然搜索重叠度", { exact: true })
      .locator("xpath=following-sibling::*[1]"),
  ).toHaveText("17%");
  const drawerAiCitations = drawer
    .getByText("AI 引用", { exact: true })
    .locator("xpath=following-sibling::*[1]");
  await expect(drawerAiCitations).toHaveText("8/17");
  await expect(
    drawerAiCitations.locator("[data-limitation-hint]"),
  ).toHaveAttribute(
    "data-print-limitations",
    /已尝试 20 个查询 · 3 个不可用/,
  );
  await expect(monitor.getByTestId("competitor-monitor-status")).toHaveText(
    "本期可比较",
  );
  await expect(monitor).toContainText("customer onboarding automation");
  await expect(monitor).toContainText("排名 18 → 9，提升 9 位");
  await expect(monitor).toContainText(
    "https://atlasflow.com/guides/customer-onboarding-playbook",
  );
  await expect(monitor).not.toContainText("这不是发布日期证明");
  const contentSignal = monitor.getByTestId(
    `competitor-monitor-signal-${CONTENT_SIGNAL_ID}`,
  );
  await contentSignal.locator("summary").click();
  const contentLimitation = contentSignal.getByRole("button", {
    name: "限制说明 (1)",
  });
  await expect(contentLimitation).toBeVisible();
  await contentLimitation.hover();
  await expect(page.getByRole("tooltip")).toContainText("这不是发布日期证明");
  const rankSignal = monitor.getByTestId(
    `competitor-monitor-signal-${RANK_SIGNAL_ID}`,
  );
  const opportunityUpdate = rankSignal.getByRole("link", {
    name: "打开增长机会更新",
  });
  await expect(opportunityUpdate).toHaveAttribute(
    "href",
    new RegExp(
      `object=competitors.*selectedCompetitorId=${COMPETITOR_A_ID}.*competitorSignalId=${RANK_SIGNAL_ID}#competitor-signal-${RANK_SIGNAL_ID}`,
    ),
  );
  await opportunityUpdate.click();
  await expect(page).toHaveURL(
    new RegExp(`competitorSignalId=${RANK_SIGNAL_ID}`),
  );
  await expect(rankSignal).toHaveAttribute("data-selected", "true");
  await expect(
    monitor.getByRole("link", { name: /进入执行中心/ }),
  ).toHaveAttribute("href", `/p/${E2E_PROJECT_ID}/execution`);

  // A baseline without a comparable result does not allocate an empty monthly
  // card in B's profile.
  await closeCompetitorDrawer(page);
  await competitorButton(page, "BeaconPath").click();
  await expect(page).toHaveURL(
    new RegExp(`selectedCompetitorId=${COMPETITOR_B_ID}`),
  );
  await expect(
    selectedDetail.getByRole("heading", { name: "BeaconPath", level: 2 }),
  ).toBeVisible();
  await selectedDetail.getByRole("button", { name: "查看完整档案" }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId("competitor-monitor")).toHaveCount(0);
  await expect(drawer).not.toContainText("首次真实采集只用于建立基线");

  await closeCompetitorDrawer(page);
  await competitorButton(page, "AtlasFlow").click();
  await expect(page).toHaveURL(
    new RegExp(`selectedCompetitorId=${COMPETITOR_A_ID}`),
  );
  // Reopen the drawer through the second entry point: the detail panel's
  // "查看完整档案" action.
  await page.getByRole("button", { name: "查看完整档案" }).click();
  await expect(drawer).toBeVisible();
  await expect(monitor).toHaveAttribute("data-competitor-id", COMPETITOR_A_ID);
  await expect(monitor).toContainText("customer onboarding automation");
  await expect(monitor).not.toContainText("首次采集仅建立 baseline");

  // The current Competitor Library is live review authority, rather than the
  // frozen published diagnosis projection. Returning to A therefore performs
  // a fresh authority read instead of reusing the earlier published detail.
  await expect
    .poll(() => api.detailReads)
    .toEqual([COMPETITOR_A_ID, COMPETITOR_B_ID, COMPETITOR_A_ID]);

  await monitor.getByRole("link", { name: /进入执行中心/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${E2E_PROJECT_ID}/execution`));
});

test("updates the only supported monthly cadence with CAS and keeps conflicts explicit", async ({
  page,
}) => {
  const api = await installCompetitorApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=competitors&selectedCompetitorId=${COMPETITOR_A_ID}`,
  );

  // Comparable monitor results remain in the explicit full profile.
  await page.getByRole("button", { name: "查看完整档案" }).click();
  await expect(competitorDrawer(page)).toBeVisible();
  const monitor = page.getByTestId("competitor-monitor");
  await expect(monitor).toContainText("更新频率");
  await expect(monitor).toContainText("每月一次");
  await expect(monitor).not.toContainText("每周");

  api.conflictNextUpdate = true;
  await monitor.getByRole("button", { name: "暂停监控" }).click();
  const conflict = monitor.getByTestId("competitor-monitor-config-error");
  await expect(conflict).toContainText(
    "设置已被其他成员更新，请刷新真实状态后重试。",
  );
  await expect(monitor.getByTestId("competitor-monitor-status")).toHaveText(
    "本期可比较",
  );
  await expect(api.monitorUpdates).toEqual([
    {
      expectedRevision: 1,
      enabled: false,
      frequency: "monthly",
    },
  ]);

  await conflict.getByRole("button", { name: "刷新状态" }).click();
  await expect(conflict).toHaveCount(0);
  await monitor.getByRole("button", { name: "暂停监控" }).click();
  await expect(monitor.getByTestId("competitor-monitor-status")).toHaveText(
    "已暂停",
  );
  await expect(monitor).toContainText("监控设置已更新");
  await expect(
    monitor.getByRole("button", { name: "启用每月监控" }),
  ).toBeVisible();

  await monitor.getByRole("button", { name: "启用每月监控" }).click();
  await expect(monitor.getByTestId("competitor-monitor-status")).toHaveText(
    "本期可比较",
  );
  await expect(api.monitorUpdates).toEqual([
    {
      expectedRevision: 1,
      enabled: false,
      frequency: "monthly",
    },
    {
      expectedRevision: 1,
      enabled: false,
      frequency: "monthly",
    },
    {
      expectedRevision: 2,
      enabled: true,
      frequency: "monthly",
    },
  ]);
});

test("localizes partial AI cohort evidence in English without changing metric arithmetic", async ({
  page,
}) => {
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "en",
      domain: "localhost",
      path: "/",
    },
  ]);
  await installCompetitorApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=competitors&selectedCompetitorId=${COMPETITOR_A_ID}`,
  );

  await expect(
    organicOverlapCell(
      page,
      "atlasflow.com",
      "Organic search overlap",
    ),
  ).toHaveText("17%");
  const citations = aiCitationCell(page, "atlasflow.com", "AI citations");
  await expect(citations).toHaveText("8/17");
  await expect(citations.locator("[data-limitation-hint]")).toHaveAttribute(
    "data-print-limitations",
    /20 attempted · 3 unavailable/,
  );
  await expect(
    aiCitationCell(page, "beaconpath.com", "AI citations"),
  ).toHaveText("Unavailable");
});

test("routes the empty Competitor Library to product-profile completion instead of source connections", async ({
  page,
}) => {
  await installCompetitorApi(page, { empty: true });
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map?object=competitors`);

  const emptyState = page.getByTestId("competitor-library-empty");
  await expect(emptyState).toBeVisible();
  await expect(
    emptyState.getByRole("link", {
      name: "完善产品画像 / 添加竞品",
    }),
  ).toHaveAttribute("href", `/p/${E2E_PROJECT_ID}/context`);
  await expect(
    emptyState.getByRole("link", { name: "管理数据来源" }),
  ).toHaveCount(0);
});
