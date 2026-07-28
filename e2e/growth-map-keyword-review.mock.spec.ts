import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  GrowthMapKeywordLibraryItem,
  ReviewKeywordRequest,
} from "../packages/contracts/src/index.ts";

import {
  E2E_ONBOARDING_SITE_PAGE_ID,
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
} from "./mock-api.ts";

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const KEYWORD_A = "41000000-0000-4000-8000-000000000001";
const KEYWORD_B = "41000000-0000-4000-8000-000000000002";
const ROOT_TOPIC = "41000000-0000-4000-8000-000000000003";
const CONFLICT_TOPIC = "41000000-0000-4000-8000-000000000004";
const TOPIC_ACTOR = "41000000-0000-4000-8000-000000000005";

type KeywordFixture = GrowthMapKeywordLibraryItem;

interface KeywordReviewApiState {
  readonly patchBodies: ReviewKeywordRequest[];
  keywordDetailReads: number;
  topicInsightReads: number;
  relationReads: number;
  forceRevisionConflict: boolean;
}

function manualOccurrence(offset: number) {
  return {
    occurrenceId: `41000000-0000-4000-8000-${String(100 + offset).padStart(12, "0")}`,
    sourceKind: "manual" as const,
    snapshotId: null,
    sourceObservationId: null,
    sourcePointer: null,
    collectedAt: "2026-07-28T00:00:00.000Z",
    providerDataAsOf: null,
    freshness: "unknown" as const,
    limitation: "人工来源没有提供方数据时点。",
    scopeBasis: "manual" as const,
    scopeLimitation: null,
    marketCode: "US",
    languageTag: "en-US",
  };
}

function emptyMetrics() {
  return {
    volume: null,
    kd: null,
    currentRank: null,
    currentUrl: null,
    competitorDomain: null,
    competitorRank: null,
    limitations: {
      volume: "暂无规范搜索量观测。",
      kd: "暂无规范关键词难度观测。",
      currentRank: "暂无规范绝对排名观测。",
      currentUrl: "暂无规范排名 URL 观测。",
      competitorDomain: "暂无规范竞品域名观测。",
      competitorRank: "暂无规范竞品排名观测。",
    },
  };
}

function keywordFixture(
  keywordId: string,
  displayKeyword: string,
  offset: number,
  overrides: Partial<GrowthMapKeywordLibraryItem> = {},
): GrowthMapKeywordLibraryItem {
  return {
    projectId: E2E_PROJECT_ID,
    keywordId,
    displayKeyword,
    normalizedKeyword: displayKeyword.toLowerCase(),
    marketCode: "US",
    languageTag: "en-US",
    queryKind: "search_query" as const,
    status: "candidate" as const,
    revision: 0,
    intent: null,
    buyerStage: null,
    cluster: null,
    classificationLimitations: {
      intent: "搜索意图尚未审核。",
      buyerStage: "购买阶段尚未审核。",
      cluster: "关键词尚未绑定已确认 Topic。",
    },
    mappedTarget: {
      kind: "unassigned" as const,
      reviewState: "unreviewed" as const,
      revision: 0,
      reason: null,
    },
    sourceOccurrences: [manualOccurrence(offset)],
    metrics: emptyMetrics(),
    coverage: {
      availability: "partial" as const,
      limitations: ["当前仅有人工关键词来源，暂无搜索量或排名观测。"],
    },
    ...overrides,
  } as GrowthMapKeywordLibraryItem;
}

function topicWorkspace() {
  const node = (
    topicNodeId: string,
    parentTopicNodeId: string | null,
    label: string,
    intentEnvelope: readonly string[],
  ) => ({
    projectId: E2E_PROJECT_ID,
    topicNodeId,
    topicModelRevision: 7,
    parentTopicNodeId,
    label,
    description: null,
    intentEnvelope,
    lifecycleState: "active",
  });
  return {
    projectId: E2E_PROJECT_ID,
    latestConfirmed: {
      projectId: E2E_PROJECT_ID,
      topicModelRevision: 7,
      editRevision: 9,
      rootTopicNodeId: ROOT_TOPIC,
      nodes: [
        node(ROOT_TOPIC, null, "客户入职", ["informational", "commercial"]),
        node(CONFLICT_TOPIC, ROOT_TOPIC, "流程自动化", ["commercial"]),
      ],
      aliases: [],
      successorRelationships: [],
      createdAt: "2026-07-27T00:00:00.000Z",
      createdBy: TOPIC_ACTOR,
      state: "confirmed",
      confirmedAt: "2026-07-28T00:00:00.000Z",
      confirmedBy: TOPIC_ACTOR,
      contentHash: "a".repeat(64),
    },
    draft: null,
    generatedAt: "2026-07-28T00:05:00.000Z",
  };
}

function topicInsights() {
  return {
    projectId: E2E_PROJECT_ID,
    topicModelRevision: 7,
    nodes: [
      {
        projectId: E2E_PROJECT_ID,
        topicNodeId: ROOT_TOPIC,
        topicModelRevision: 7,
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
        limitation: "仍有一个关键词等待映射审核。",
      },
      {
        projectId: E2E_PROJECT_ID,
        topicNodeId: CONFLICT_TOPIC,
        topicModelRevision: 7,
        label: "流程自动化",
        keywordCount: 2,
        approvedKeywordCount: 2,
        reviewPendingKeywordCount: 0,
        existingPageKeywordCount: 2,
        newAssetKeywordCount: 0,
        unassignedKeywordCount: 0,
        mappedPageCount: 2,
        conflictingIntentCount: 1,
        coverageState: "conflict",
        limitation: "两个已映射页面正在竞争同一商业意图。",
      },
    ],
    coverage: {
      availability: "partial",
      limitations: ["流程自动化 Topic 存在页面与意图冲突。"],
    },
    generatedAt: "2026-07-28T00:06:00.000Z",
  };
}

async function json(route: Route, value: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType:
      status >= 400 ? "application/problem+json" : "application/json",
    body: JSON.stringify(value),
  });
}

function problem409() {
  return {
    type: "about:blank",
    title: "Conflict",
    status: 409,
    code: "REVISION_CONFLICT",
    detail: "Keyword governance revision changed.",
    requestId: "keyword-review-e2e",
  };
}

function reviewedKeyword(
  current: KeywordFixture,
  body: ReviewKeywordRequest,
  revision: number,
): KeywordFixture {
  const selectedTopic =
    body.topicNodeId === ROOT_TOPIC
      ? { clusterId: ROOT_TOPIC, name: "客户入职" }
      : body.topicNodeId === CONFLICT_TOPIC
        ? { clusterId: CONFLICT_TOPIC, name: "流程自动化" }
        : null;
  const mappedTarget =
    body.mappingDecision === "existing_page" &&
    body.mappedSitePageId !== null
      ? {
          kind: "existing_page" as const,
          reviewState: "approved" as const,
          revision,
          reason: body.reason,
          sitePageId: body.mappedSitePageId,
          normalizedUrl: "https://example.test/customer-onboarding/",
        }
      : body.mappingDecision === "new_asset"
        ? {
            kind: "new_asset" as const,
            reviewState: "approved" as const,
            revision,
            reason: body.reason,
          }
        : {
            kind: "unassigned" as const,
            reviewState: "approved" as const,
            revision,
            reason: body.reason,
          };
  return {
    ...current,
    status: body.status,
    revision,
    intent: body.intent,
    buyerStage: body.buyerStage,
    cluster: selectedTopic,
    classificationLimitations: {
      intent: body.intent === null ? "搜索意图尚未审核。" : null,
      buyerStage:
        body.buyerStage === null ? "购买阶段尚未审核。" : null,
      cluster:
        selectedTopic === null ? "关键词尚未绑定已确认 Topic。" : null,
    },
    mappedTarget,
  };
}

async function installKeywordReviewApi(
  page: Page,
): Promise<KeywordReviewApiState> {
  await installGrowthVerticalApi(page);
  const state: KeywordReviewApiState = {
    patchBodies: [],
    keywordDetailReads: 0,
    topicInsightReads: 0,
    relationReads: 0,
    forceRevisionConflict: false,
  };
  let keywordA = keywordFixture(
    KEYWORD_A,
    "customer onboarding automation",
    1,
  );
  let keywordB = keywordFixture(
    KEYWORD_B,
    "customer onboarding workflow",
    2,
    {
      status: "parked",
      revision: 3,
      intent: "informational",
      buyerStage: "awareness",
      cluster: { clusterId: ROOT_TOPIC, name: "客户入职" },
      classificationLimitations: {
        intent: null,
        buyerStage: null,
        cluster: null,
      },
      mappedTarget: {
        kind: "new_asset",
        reviewState: "approved",
        revision: 3,
        reason: "等待产品团队补充工作流案例。",
      },
    },
  );

  await page.route(`**${BASE}/audit/keywords**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const detailMatch = url.pathname.match(
      new RegExp(`^${BASE}/audit/keywords/([^/]+)$`),
    );

    if (url.pathname.endsWith("/rank-history")) {
      await json(route, {
        ...problem409(),
        title: "Not found",
        status: 404,
        code: "NOT_FOUND",
        detail: "No canonical rank history is available.",
      }, 404);
      return;
    }

    if (detailMatch !== null) {
      const keywordId = decodeURIComponent(detailMatch[1] ?? "");
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as ReviewKeywordRequest;
        state.patchBodies.push(body);
        if (state.forceRevisionConflict) {
          state.forceRevisionConflict = false;
          keywordA = reviewedKeyword(
            keywordA,
            {
              expectedGovernanceRevision: keywordA.revision,
              status: "parked",
              intent: "informational",
              buyerStage: "awareness",
              topicNodeId: ROOT_TOPIC,
              topicModelRevision: 7,
              mappingDecision: "unassigned",
              mappedSitePageId: null,
              reason: "另一位审核者已把关键词暂存并保留 Topic。",
            },
            4,
          );
          await json(route, problem409(), 409);
          return;
        }
        if (keywordId === KEYWORD_A) {
          keywordA = reviewedKeyword(
            keywordA,
            body,
            body.expectedGovernanceRevision + 1,
          );
        } else {
          keywordB = reviewedKeyword(
            keywordB,
            body,
            body.expectedGovernanceRevision + 1,
          );
        }
        const selected = keywordId === KEYWORD_A ? keywordA : keywordB;
        await json(route, {
          data: { projectId: E2E_PROJECT_ID, data: selected },
        });
        return;
      }

      state.keywordDetailReads += 1;
      const selected = keywordId === KEYWORD_A ? keywordA : keywordB;
      await json(route, {
        data: { projectId: E2E_PROJECT_ID, data: selected },
      });
      return;
    }

    await json(route, {
      data: {
        projectId: E2E_PROJECT_ID,
        data: [keywordA, keywordB],
        meta: {
          limit: 50,
          nextCursor: null,
          hasNext: false,
          coverage: {
            availability: "partial",
            limitations: ["部分关键词仍需客户审核。"],
          },
        },
      },
    });
  });

  await page.route(
    `**${BASE}/audit/topic-model/insights`,
    async (route) => {
      state.topicInsightReads += 1;
      await json(route, { data: topicInsights() });
    },
  );

  await page.route(`**${BASE}/audit/topic-model`, async (route) => {
    await json(route, { data: topicWorkspace() });
  });

  await page.route(
    `**${BASE}/audit/keyword-relations**`,
    async (route) => {
      if (route.request().method() === "POST") {
        await json(route, {
          data: {
            projectId: E2E_PROJECT_ID,
            eligiblePairCount: 0,
            createdRelationCount: 0,
            createdCandidateCount: 0,
            generatedAt: "2026-07-28T00:10:00.000Z",
          },
        });
        return;
      }
      state.relationReads += 1;
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          data: [],
          meta: {
            limit: 100,
            nextCursor: null,
            hasNext: false,
            coverage: { availability: "available", limitations: [] },
          },
        },
      });
    },
  );

  return state;
}

async function openKeywordReview(page: Page, keyword: string) {
  const detail = page.locator('aside[aria-label="所选关键词详情"]');
  await expect(
    detail.getByRole("heading", { level: 2, name: keyword }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "审核 / 修改" }).click();
  const dialog = page.getByRole("dialog", {
    name: `审核“${keyword}”`,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "zh-CN",
      domain: "localhost",
      path: "/",
    },
  ]);
});

test("关键词审核要求 conflict Topic 二次确认，并且 A→B→A 不串表单状态", async ({
  page,
}) => {
  const state = await installKeywordReviewApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}`,
  );

  let dialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  await dialog.getByLabel("关键词状态").selectOption("approved");
  await dialog.getByLabel("搜索意图").selectOption("commercial");
  await dialog.getByRole("button", { name: "关闭关键词审核" }).click();

  await page
    .getByRole("button")
    .filter({ hasText: "customer onboarding workflow" })
    .first()
    .click();
  dialog = await openKeywordReview(page, "customer onboarding workflow");
  await expect(dialog.getByLabel("关键词状态")).toHaveValue("parked");
  await expect(dialog.getByLabel("搜索意图")).toHaveValue("informational");
  await dialog.getByRole("button", { name: "关闭关键词审核" }).click();

  await page
    .getByRole("button")
    .filter({ hasText: "customer onboarding automation" })
    .first()
    .click();
  dialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  await expect(dialog.getByLabel("关键词状态")).toHaveValue("candidate");
  await expect(dialog.getByLabel("搜索意图")).toHaveValue("");

  await dialog.getByLabel("关键词状态").selectOption("approved");
  await dialog.getByLabel("搜索意图").selectOption("commercial");
  await dialog.getByLabel("购买阶段").selectOption("consideration");
  await dialog.getByLabel("已发布 Topic").selectOption(CONFLICT_TOPIC);
  await dialog
    .getByLabel("页面映射决定")
    .selectOption("existing_page");
  await dialog
    .getByLabel("规范页面")
    .selectOption(E2E_ONBOARDING_SITE_PAGE_ID);
  await dialog
    .getByLabel("审核说明")
    .fill("确认冲突范围后，仍将该词映射到核心客户入职页面。");

  const topicReadsBeforeSave = state.topicInsightReads;
  const relationReadsBeforeSave = state.relationReads;
  await dialog.getByRole("button", { name: "保存审核" }).click();
  await expect(
    dialog.getByTestId("keyword-review-conflict-confirmation"),
  ).toBeVisible();
  expect(state.patchBodies).toHaveLength(0);

  await dialog
    .getByRole("button", { name: "确认冲突并保存" })
    .click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => state.patchBodies.length)
    .toBe(1);
  expect(state.patchBodies[0]).toEqual({
    expectedGovernanceRevision: 0,
    status: "approved",
    intent: "commercial",
    buyerStage: "consideration",
    topicNodeId: CONFLICT_TOPIC,
    topicModelRevision: 7,
    mappingDecision: "existing_page",
    mappedSitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
    reason: "确认冲突范围后，仍将该词映射到核心客户入职页面。",
  });
  await expect
    .poll(() => state.topicInsightReads)
    .toBeGreaterThan(topicReadsBeforeSave);
  await expect
    .poll(() => state.relationReads)
    .toBeGreaterThan(relationReadsBeforeSave);

  const detail = page.locator('aside[aria-label="所选关键词详情"]');
  await expect(detail).toContainText("流程自动化");
  await expect(detail).toContainText(
    "https://example.test/customer-onboarding/",
  );
  await expect(detail.getByText("审核结果已同步")).toBeVisible();
});

test("关键词 CAS 冲突会刷新最新 revision、提示用户并用新版本重试", async ({
  page,
}) => {
  const state = await installKeywordReviewApi(page);
  state.forceRevisionConflict = true;
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}`,
  );

  const dialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  await dialog.getByLabel("关键词状态").selectOption("approved");
  await dialog.getByLabel("搜索意图").selectOption("commercial");
  await dialog.getByLabel("购买阶段").selectOption("consideration");
  await dialog.getByLabel("已发布 Topic").selectOption(ROOT_TOPIC);
  await dialog
    .getByLabel("页面映射决定")
    .selectOption("new_asset");
  await dialog
    .getByLabel("审核说明")
    .fill("确认客户入职 Topic，并进入新内容资产队列。");
  await dialog.getByRole("button", { name: "保存审核" }).click();

  await expect(
    dialog.getByText(
      "该关键词已被其他审核更新；系统已重新加载最新版本，请核对后再次提交。",
    ),
  ).toBeVisible();
  await expect(dialog.getByText("当前治理版本 4")).toBeVisible();
  await expect(dialog.getByLabel("关键词状态")).toHaveValue("parked");
  await expect(dialog.getByLabel("搜索意图")).toHaveValue("informational");
  expect(state.patchBodies[0]?.expectedGovernanceRevision).toBe(0);

  await dialog.getByLabel("关键词状态").selectOption("approved");
  await dialog
    .getByLabel("页面映射决定")
    .selectOption("new_asset");
  await dialog
    .getByLabel("审核说明")
    .fill("核对最新版本后，确认进入新内容资产队列。");
  await dialog.getByRole("button", { name: "保存审核" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => state.patchBodies.length)
    .toBe(2);
  expect(state.patchBodies[1]?.expectedGovernanceRevision).toBe(4);
});
