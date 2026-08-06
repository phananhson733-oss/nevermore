import { expect, test, type Page } from "@playwright/test";
import {
  CompetitorMonitorResponse,
  GrowthMapCompetitorDetailResponse,
  GrowthMapCompetitorLibraryResponse,
  UpdateCompetitorMonitorRequest as UpdateCompetitorMonitorRequestSchema,
  type GrowthMapCompetitorLibraryItem,
  type UpdateCompetitorMonitorRequest,
} from "../packages/contracts/src/index.ts";

import {
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
} from "./mock-api.ts";

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

function competitor(
  competitorId: string,
  name: string,
  domain: string,
  suffix: string,
): GrowthMapCompetitorLibraryItem {
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
    ],
    lastObservedAt: OBSERVED_AT,
    serpOverlap: {
      availability: "unavailable",
      value: null,
      limitation: "尚无已确认的 SERP overlap 观测。",
    },
    aiCitationInsight: {
      availability: "unavailable",
      value: null,
      limitation: "尚无已确认的 AI citation 观测。",
    },
    coverage: {
      availability: "available",
      limitations: [],
    },
  };
}

const COMPETITOR_A = competitor(
  COMPETITOR_A_ID,
  "AtlasFlow",
  "atlasflow.com",
  "11",
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

test.beforeEach(async ({ page }) => {
  await useChineseUi(page);
  await installGrowthVerticalApi(page);
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

  const monitor = page.getByTestId("competitor-monitor");
  await expect(monitor).toHaveAttribute(
    "data-competitor-id",
    COMPETITOR_A_ID,
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
  await expect(page.getByRole("tooltip")).toContainText(
    "这不是发布日期证明",
  );
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

  await competitorButton(page, "BeaconPath").click();
  await expect(page).toHaveURL(
    new RegExp(`selectedCompetitorId=${COMPETITOR_B_ID}`),
  );
  await expect(monitor).toHaveAttribute(
    "data-competitor-id",
    COMPETITOR_B_ID,
  );
  await expect(monitor.getByTestId("competitor-monitor-status")).toHaveText(
    "基线已建立",
  );
  await expect(monitor).toContainText(
    "首次真实采集只用于建立基线",
  );
  await expect(monitor).not.toContainText("customer onboarding automation");
  await expect(monitor).not.toContainText("atlasflow.com/guides");

  await competitorButton(page, "AtlasFlow").click();
  await expect(page).toHaveURL(
    new RegExp(`selectedCompetitorId=${COMPETITOR_A_ID}`),
  );
  await expect(monitor).toHaveAttribute(
    "data-competitor-id",
    COMPETITOR_A_ID,
  );
  await expect(monitor).toContainText("customer onboarding automation");
  await expect(monitor).not.toContainText("首次采集仅建立 baseline");

  // The current Competitor Library is live review authority, rather than the
  // frozen published diagnosis projection. Returning to A therefore performs
  // a fresh authority read instead of reusing the earlier published detail.
  await expect.poll(() => api.detailReads).toEqual([
    COMPETITOR_A_ID,
    COMPETITOR_B_ID,
    COMPETITOR_A_ID,
  ]);

  await monitor.getByRole("link", { name: /进入执行中心/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/p/${E2E_PROJECT_ID}/execution`),
  );
});

test("updates the only supported monthly cadence with CAS and keeps conflicts explicit", async ({
  page,
}) => {
  const api = await installCompetitorApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=competitors&selectedCompetitorId=${COMPETITOR_A_ID}`,
  );

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
