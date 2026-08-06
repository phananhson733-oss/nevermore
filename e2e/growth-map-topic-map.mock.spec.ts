import { expect, test, type Page } from "@playwright/test";

import {
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
} from "./mock-api.ts";

const ROOT_TOPIC_ID = "30000000-0000-4000-8000-000000000001";
const CHILD_TOPIC_ID = "30000000-0000-4000-8000-000000000002";
const TOPIC_ACTOR_ID = "30000000-0000-4000-8000-000000000003";
const VOC_KEYWORD_ID = "30000000-0000-4000-8000-000000000004";

const vocKeyword = {
  projectId: E2E_PROJECT_ID,
  keywordId: VOC_KEYWORD_ID,
  displayKeyword: "customer onboarding friction",
  normalizedKeyword: "customer onboarding friction",
  marketCode: "US",
  languageTag: "en-US",
  queryKind: "search_query",
  status: "candidate",
  revision: 0,
  intent: null,
  buyerStage: null,
  cluster: null,
  classificationLimitations: {
    intent: "搜索意图尚未审核。",
    buyerStage: "购买阶段尚未审核。",
    cluster: "关键词尚未分配到已确认话题。",
  },
  mappedTarget: {
    kind: "unassigned",
    reviewState: "unreviewed",
    revision: 0,
    reason: null,
  },
  sourceOccurrences: [
    {
      occurrenceId: "30000000-0000-4000-8000-000000000005",
      sourceKind: "interview_summary",
      collectionRunId: "30000000-0000-4000-8000-000000000011",
      snapshotId: "30000000-0000-4000-8000-000000000006",
      sourceObservationId: "30000000-0000-4000-8000-000000000007",
      sourcePointer: "/valueJson/keyword",
      collectedAt: "2026-07-22T08:00:00.000Z",
      providerDataAsOf: "2026-07-18T00:00:00.000Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "user_provided",
      scopeLimitation:
        "访谈摘要来自客户批准的去标识化研究范围，不包含逐字稿或受访者身份。",
      marketCode: "US",
      languageTag: "en-US",
      evidenceLabel: "第二季度客户入职访谈摘要",
      sourceRecordHash: "a".repeat(64),
    },
    {
      occurrenceId: "30000000-0000-4000-8000-000000000008",
      sourceKind: "user_review",
      collectionRunId: "30000000-0000-4000-8000-000000000012",
      snapshotId: "30000000-0000-4000-8000-000000000009",
      sourceObservationId: "30000000-0000-4000-8000-000000000010",
      sourcePointer: "/valueJson/keyword",
      collectedAt: "2026-07-22T08:05:00.000Z",
      providerDataAsOf: "2026-07-19T00:00:00.000Z",
      freshness: "current",
      limitation: null,
      scopeBasis: "provider_collection_scope",
      scopeLimitation:
        "用户评价来自有限的 G2 公开评价采集范围，不代表平台完整评价全集。",
      marketCode: "US",
      languageTag: "en-US",
      evidenceLabel: "RelayOps 的 G2 公开评价语料",
      sourceRecordHash: "b".repeat(64),
      reviewPlatform: "g2",
      sourceUrl: "https://www.g2.com/products/relayops/reviews",
    },
  ],
  metrics: {
    volume: null,
    kd: null,
    currentRank: null,
    currentUrl: null,
    competitorDomain: null,
    competitorRank: null,
    limitations: {
      volume: "该证据来源没有搜索量观测。",
      kd: "该证据来源没有关键词难度观测。",
      currentRank: "该证据来源没有绝对排名观测。",
      currentUrl: "该证据来源没有排名 URL 观测。",
      competitorDomain: "该证据来源没有竞品域名观测。",
      competitorRank: "该证据来源没有竞品排名观测。",
    },
  },
  coverage: {
    availability: "partial",
    limitations: ["VOC 来源不提供搜索量、难度或排名指标。"],
  },
} as const;

async function fulfillJson(page: Page): Promise<void> {
  const topicNode = (
    topicNodeId: string,
    parentTopicNodeId: string | null,
    label: string,
  ) => ({
    projectId: E2E_PROJECT_ID,
    topicNodeId,
    topicModelRevision: 1,
    parentTopicNodeId,
    label,
    description: null,
    intentEnvelope: [],
    lifecycleState: "active",
  });

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/audit/keywords**`,
    async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith(`/${VOC_KEYWORD_ID}/rank-history`)) {
        await route.fulfill({
          status: 404,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "about:blank",
            title: "暂无排名历史",
            status: 404,
            code: "NOT_FOUND",
          }),
        });
        return;
      }
      if (pathname.endsWith(`/${VOC_KEYWORD_ID}`)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              projectId: E2E_PROJECT_ID,
              data: vocKeyword,
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            projectId: E2E_PROJECT_ID,
            data: [vocKeyword],
            meta: {
              limit: 50,
              nextCursor: null,
              hasNext: false,
              coverage: { availability: "available", limitations: [] },
            },
          },
        }),
      });
    },
  );

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/audit/competitors**`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            projectId: E2E_PROJECT_ID,
            data: [],
            meta: {
              limit: 50,
              nextCursor: null,
              hasNext: false,
              coverage: { availability: "available", limitations: [] },
            },
          },
        }),
      });
    },
  );

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/audit/topic-model`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            projectId: E2E_PROJECT_ID,
            latestConfirmed: {
              projectId: E2E_PROJECT_ID,
              topicModelRevision: 1,
              editRevision: 2,
              rootTopicNodeId: ROOT_TOPIC_ID,
              nodes: [
                topicNode(ROOT_TOPIC_ID, null, "客户入职"),
                topicNode(CHILD_TOPIC_ID, ROOT_TOPIC_ID, "流程自动化"),
              ],
              aliases: [],
              successorRelationships: [],
              createdAt: "2026-07-20T00:00:00.000Z",
              createdBy: TOPIC_ACTOR_ID,
              state: "confirmed",
              confirmedAt: "2026-07-21T00:00:00.000Z",
              confirmedBy: TOPIC_ACTOR_ID,
              contentHash: "c".repeat(64),
            },
            draft: null,
            generatedAt: "2026-07-22T00:00:00.000Z",
          },
        }),
      });
    },
  );

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/audit/topic-model/insights`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            projectId: E2E_PROJECT_ID,
            topicModelRevision: 1,
            nodes: [
              {
                projectId: E2E_PROJECT_ID,
                topicNodeId: ROOT_TOPIC_ID,
                topicModelRevision: 1,
                label: "客户入职",
                keywordCount: 2,
                approvedKeywordCount: 1,
                reviewPendingKeywordCount: 1,
                existingPageKeywordCount: 1,
                newAssetKeywordCount: 0,
                unassignedKeywordCount: 1,
                mappedPageCount: 1,
                conflictingIntentCount: 0,
                coverageState: "partial",
                limitation: "仍有 1 个关键词等待映射审核。",
              },
              {
                projectId: E2E_PROJECT_ID,
                topicNodeId: CHILD_TOPIC_ID,
                topicModelRevision: 1,
                label: "流程自动化",
                keywordCount: 0,
                approvedKeywordCount: 0,
                reviewPendingKeywordCount: 0,
                existingPageKeywordCount: 0,
                newAssetKeywordCount: 0,
                unassignedKeywordCount: 0,
                mappedPageCount: 0,
                conflictingIntentCount: 0,
                coverageState: "empty",
                limitation: "这个话题还没有已治理关键词。",
              },
            ],
            coverage: {
              availability: "partial",
              limitations: ["部分话题的内容覆盖仍不完整。"],
            },
            generatedAt: "2026-07-22T00:00:00.000Z",
          },
        }),
      });
    },
  );
}

test.beforeEach(async ({ page }) => {
  await installGrowthVerticalApi(page);
  await fulfillJson(page);
});

test("增长地图三个内置对象可以反复切换", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);

  const objectNav = page.getByRole("navigation", { name: "增长地图对象" });
  const pages = objectNav.getByRole("button", { name: "页面与机会 逐 URL 查看审计与执行" });
  const keywords = objectNav.getByRole("button", { name: "关键词库 关键词来源、市场与映射" });
  const competitors = objectNav.getByRole("button", { name: "竞品库 竞品关系、范围与证据" });

  await expect(pages).toHaveAttribute("aria-pressed", "true");
  await keywords.click();
  await expect(keywords).toHaveAttribute("aria-pressed", "true");
  await competitors.click();
  await expect(competitors).toHaveAttribute("aria-pressed", "true");
  await pages.click();
  await expect(pages).toHaveAttribute("aria-pressed", "true");
  await keywords.click();
  await expect(keywords).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("话题地图决定关键词如何进入增长路径")).toBeVisible();
});

test("话题地图可重复打开并切换不同节点详情", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map?object=keywords`);

  const manage = page.getByRole("button", { name: "管理话题地图" });
  await expect(manage).toBeVisible();
  await manage.click();

  let dialog = page.getByRole("dialog", { name: "话题地图" });
  await expect(dialog).toBeVisible();
  const root = dialog.getByRole("treeitem", { name: "客户入职 2 个关键词 · 1 个已有内容 部分覆盖" });
  const child = dialog.getByRole("treeitem", { name: "流程自动化 0 个关键词 · 0 个已有内容 暂无关键词" });
  await expect(root).toHaveAttribute("aria-selected", "true");
  await child.click();
  await expect(child).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("heading", { name: "流程自动化", level: 3 })).toBeVisible();

  await dialog.getByRole("button", { name: "关闭话题地图" }).click();
  await expect(dialog).toBeHidden();

  await manage.click();
  dialog = page.getByRole("dialog", { name: "话题地图" });
  await expect(dialog).toBeVisible();
  const reopenedRoot = dialog.getByRole("treeitem", { name: "客户入职 2 个关键词 · 1 个已有内容 部分覆盖" });
  await reopenedRoot.click();
  await expect(reopenedRoot).toHaveAttribute("aria-selected", "true");
  await expect(dialog.getByRole("heading", { name: "客户入职", level: 3 })).toBeVisible();
});

test("关键词库把访谈摘要与用户评价作为两个独立内置来源展示", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map?object=keywords`);

  const row = page
    .getByRole("list", { name: "关键词列表" })
    .getByRole("listitem")
    .filter({ hasText: vocKeyword.displayKeyword })
    .first();
  await expect(row).toContainText("访谈摘要");
  await expect(row).toContainText("用户评价");
  await row.locator("button[aria-pressed]").click();

  const detail = page.locator('aside[aria-label="所选关键词详情"]');
  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: vocKeyword.displayKeyword,
    }),
  ).toBeVisible();

  const interview = detail.locator(
    'article[data-source-kind="interview_summary"]',
  );
  const review = detail.locator('article[data-source-kind="user_review"]');
  await expect(interview).toContainText("第二季度客户入职访谈摘要");
  await expect(review).toContainText("RelayOps 的 G2 公开评价语料");
  await expect(review).toContainText("G2");
  await expect(
    review.getByRole("link", { name: "打开公开评价来源" }),
  ).toHaveAttribute(
    "href",
    "https://www.g2.com/products/relayops/reviews",
  );
  await expect(interview).toContainText(
    "不展示受访者身份、评价作者或完整正文",
  );
  await expect(review).toContainText(
    "不展示受访者身份、评价作者或完整正文",
  );

  await interview.getByText("查看来源详情", { exact: true }).click();
  await review.getByText("查看来源详情", { exact: true }).click();
  await expect(
    interview.getByTitle(vocKeyword.sourceOccurrences[0].sourceRecordHash),
  ).toBeVisible();
  await expect(
    interview.getByTitle(vocKeyword.sourceOccurrences[0].collectionRunId),
  ).toBeVisible();
  await expect(
    review.getByTitle(vocKeyword.sourceOccurrences[1].sourceRecordHash),
  ).toBeVisible();
  await expect(
    review.getByTitle(vocKeyword.sourceOccurrences[1].collectionRunId),
  ).toBeVisible();
  await expect(detail).not.toContainText("participantName");
  await expect(detail).not.toContainText("reviewBody");
});
