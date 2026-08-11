import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  ApproveKeywordReviewSuggestionRequest,
  GrowthMapKeywordLibraryItem,
  KeywordGovernancePendingSuggestion,
  KeywordGovernanceSuggestionState,
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
const KEYWORD_C = "41000000-0000-4000-8000-000000000009";
const ROOT_TOPIC = "41000000-0000-4000-8000-000000000003";
const CONFLICT_TOPIC = "41000000-0000-4000-8000-000000000004";
const TOPIC_ACTOR = "41000000-0000-4000-8000-000000000005";
const SUGGESTION_A = "41000000-0000-4000-8000-000000000006";
const SUGGESTION_B = "41000000-0000-4000-8000-000000000007";
const SUGGESTION_INVOCATION = "41000000-0000-4000-8000-000000000008";

type KeywordFixture = GrowthMapKeywordLibraryItem;

interface KeywordReviewApiState {
  readonly patchBodies: ReviewKeywordRequest[];
  readonly approveBodies: ApproveKeywordReviewSuggestionRequest[];
  keywordDetailReads: number;
  topicInsightReads: number;
  relationReads: number;
  forceRevisionConflict: boolean;
  forceApprovalConflict: boolean;
  readonly setSuggestionState: (
    state: KeywordGovernanceSuggestionState | null,
  ) => void;
}

function keywordSuggestion(
  state: KeywordGovernanceSuggestionState = "pending_ready",
  expectedGovernanceRevision = 0,
  suggestionId = SUGGESTION_A,
): KeywordGovernancePendingSuggestion {
  if (state === "pending_needs_review") {
    return {
      ...keywordSuggestion(
        "pending_ready",
        expectedGovernanceRevision,
        suggestionId,
      ),
      state,
      intent: null,
      readinessReason: "insufficient_authority",
      limitation: "搜索意图仍需人工确认。",
      intentLineage: {
        authority: "unavailable",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: null,
        observedAt: null,
      },
    };
  }
  if (state !== "pending_ready") {
    const readinessReason = {
      generating: "generation_in_progress",
      pending_needs_review: "insufficient_authority",
      stale: "governance_revision_changed",
      unavailable: "authority_unavailable",
    } as const;
    return {
      suggestionId,
      suggestionVersion: "keyword-governance-suggestion.v1",
      state,
      expectedGovernanceRevision,
      status: null,
      intent: null,
      buyerStage: null,
      topicNodeId: null,
      topicModelRevision: null,
      topicLabel: null,
      mappingDecision: null,
      mappedSitePageId: null,
      mappedSitePageTitle: null,
      reason: null,
      readinessReason: readinessReason[state],
      limitation:
        state === "generating"
          ? "系统正在基于已确认权威生成建议。"
          : state === "stale"
              ? "关键词治理版本已变化。"
              : "当前缺少生成建议所需的权威。",
      lineage: null,
      intentLineage: null,
      createdAt: "2026-08-10T08:00:00.000Z",
    };
  }
  return {
    suggestionId,
    suggestionVersion: "keyword-governance-suggestion.v1",
    state,
    expectedGovernanceRevision,
    status: "approved",
    intent: "commercial",
    buyerStage: "consideration",
    topicNodeId: ROOT_TOPIC,
    topicModelRevision: 7,
    topicLabel: "客户入职",
    mappingDecision: "existing_page",
    mappedSitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
    mappedSitePageTitle: "Customer onboarding",
    reason: "已确认的产品画像、Topic 与规范页面共同支持这条建议。",
    readinessReason: "all_authorities_confirmed",
    limitation: null,
    lineage: {
      generationVersion: "keyword-governance-suggestion-generation.v1",
      promptSetVersion: "keyword-governance-suggestion.prompt.v1",
      authority: "llm_generated",
      analysisInvocationId: SUGGESTION_INVOCATION,
    },
    intentLineage: {
      authority: "llm_generated",
      snapshotId: null,
      observationId: null,
      analysisInvocationId: SUGGESTION_INVOCATION,
      observedAt: null,
    },
    createdAt: "2026-08-10T08:00:00.000Z",
  };
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
    reviewOrigin: null,
    revision: 0,
    intent: null,
    searchIntent: {
      value: null,
      authority: "unavailable" as const,
      snapshotId: null,
      observationId: null,
      analysisInvocationId: null,
      observedAt: null,
      limitation:
        "No user-confirmed, provider-observed, or durably generated search intent is available for this keyword.",
    },
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
    recollection: null,
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
      confirmationMode: "user",
      contentHash: "a".repeat(64),
      generationSummary: null,
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
      ? { clusterId: ROOT_TOPIC, topicModelRevision: 7, name: "客户入职" }
      : body.topicNodeId === CONFLICT_TOPIC
        ? {
            clusterId: CONFLICT_TOPIC,
            topicModelRevision: 7,
            name: "流程自动化",
          }
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
    reviewOrigin: "user",
    revision,
    intent: body.intent,
    searchIntent:
      body.intent === null
        ? {
            value: null,
            authority: "unavailable",
            snapshotId: null,
            observationId: null,
            analysisInvocationId: null,
            observedAt: null,
            limitation:
              "No user-confirmed, provider-observed, or durably generated search intent is available for this keyword.",
          }
        : {
            value: body.intent,
            authority: "user_confirmed",
            snapshotId: null,
            observationId: null,
            analysisInvocationId: null,
            observedAt: null,
            limitation: null,
          },
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
  let currentSuggestion: KeywordGovernancePendingSuggestion | null =
    keywordSuggestion();
  const state: KeywordReviewApiState = {
    patchBodies: [],
    approveBodies: [],
    keywordDetailReads: 0,
    topicInsightReads: 0,
    relationReads: 0,
    forceRevisionConflict: false,
    forceApprovalConflict: false,
    setSuggestionState: (suggestionState) => {
      currentSuggestion =
        suggestionState === null
          ? null
          : keywordSuggestion(suggestionState, keywordA.revision);
    },
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
      searchIntent: {
        value: "informational",
        authority: "governed_legacy",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: null,
        observedAt: null,
        limitation:
          "This governed search intent predates durable provider or LLM invocation provenance; its original value is preserved as a pre-ledger classification.",
      },
      buyerStage: "awareness",
      cluster: {
        clusterId: ROOT_TOPIC,
        topicModelRevision: 7,
        name: "客户入职",
      },
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
  let keywordC = keywordFixture(
    KEYWORD_C,
    "human confirmed onboarding guide",
    3,
    {
      status: "approved",
      reviewOrigin: "user",
      revision: 5,
      intent: "informational",
      searchIntent: {
        value: "informational",
        authority: "user_confirmed",
        snapshotId: null,
        observationId: null,
        analysisInvocationId: null,
        observedAt: null,
        limitation: null,
      },
      buyerStage: "awareness",
      cluster: {
        clusterId: ROOT_TOPIC,
        topicModelRevision: 7,
        name: "客户入职",
      },
      classificationLimitations: {
        intent: null,
        buyerStage: null,
        cluster: null,
      },
      mappedTarget: {
        kind: "new_asset",
        reviewState: "approved",
        revision: 5,
        reason: "用户已确认由新内容资产承接。",
      },
    },
  );

  await page.route(`**${BASE}/audit/keywords**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const approvalMatch = url.pathname.match(
      new RegExp(
        `^${BASE}/audit/keywords/([^/]+)/review-suggestions/([^/]+)/approve$`,
      ),
    );
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

    if (approvalMatch !== null && request.method() === "POST") {
      const keywordId = decodeURIComponent(approvalMatch[1] ?? "");
      const suggestionId = decodeURIComponent(approvalMatch[2] ?? "");
      const body = request.postDataJSON() as ApproveKeywordReviewSuggestionRequest;
      state.approveBodies.push(body);
      if (
        keywordId !== KEYWORD_A ||
        currentSuggestion === null ||
        currentSuggestion.state !== "pending_ready" ||
        suggestionId !== currentSuggestion.suggestionId
      ) {
        await json(route, problem409(), 409);
        return;
      }
      if (state.forceApprovalConflict) {
        state.forceApprovalConflict = false;
        keywordA = { ...keywordA, revision: 4 };
        currentSuggestion = keywordSuggestion(
          "pending_ready",
          4,
          SUGGESTION_B,
        );
        await json(route, problem409(), 409);
        return;
      }
      keywordA = reviewedKeyword(
        keywordA,
        {
          expectedGovernanceRevision:
            currentSuggestion.expectedGovernanceRevision,
          status: currentSuggestion.status ?? "candidate",
          intent: currentSuggestion.intent,
          buyerStage: currentSuggestion.buyerStage,
          topicNodeId: currentSuggestion.topicNodeId,
          topicModelRevision: currentSuggestion.topicModelRevision,
          mappingDecision: currentSuggestion.mappingDecision ?? "unassigned",
          mappedSitePageId: currentSuggestion.mappedSitePageId,
          reason: currentSuggestion.reason ?? "批准系统建议。",
        },
        currentSuggestion.expectedGovernanceRevision + 1,
      );
      currentSuggestion = null;
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          diagnosticRunId: null,
          data: { ...keywordA, pendingSuggestion: null },
        },
      });
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
          currentSuggestion = null;
          await json(route, problem409(), 409);
          return;
        }
        if (keywordId === KEYWORD_A) {
          keywordA = reviewedKeyword(
            keywordA,
            body,
            body.expectedGovernanceRevision + 1,
          );
        } else if (keywordId === KEYWORD_B) {
          keywordB = reviewedKeyword(
            keywordB,
            body,
            body.expectedGovernanceRevision + 1,
          );
        } else {
          keywordC = reviewedKeyword(
            keywordC,
            body,
            body.expectedGovernanceRevision + 1,
          );
        }
        if (keywordId === KEYWORD_A) currentSuggestion = null;
        const selected =
          keywordId === KEYWORD_A
            ? keywordA
            : keywordId === KEYWORD_B
              ? keywordB
              : keywordC;
        await json(route, {
          data: {
            projectId: E2E_PROJECT_ID,
            diagnosticRunId: null,
            data: { ...selected, pendingSuggestion: null },
          },
        });
        return;
      }

      state.keywordDetailReads += 1;
      const selected =
        keywordId === KEYWORD_A
          ? keywordA
          : keywordId === KEYWORD_B
            ? keywordB
            : keywordC;
      await json(route, {
        data: {
          projectId: E2E_PROJECT_ID,
          diagnosticRunId: null,
          data: {
            ...selected,
            pendingSuggestion:
              keywordId === KEYWORD_A ? currentSuggestion : null,
          },
        },
      });
      return;
    }

    await json(route, {
      data: {
        projectId: E2E_PROJECT_ID,
        diagnosticRunId: url.searchParams.get("diagnosticRunId"),
        data: [keywordA, keywordB, keywordC],
        meta: {
          limit: 50,
          nextCursor: null,
          hasNext: false,
          coverage: {
            availability: "partial",
            limitations: ["部分关键词仍需客户审核。"],
          },
          sourceCounts: null,
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

async function expandKeywordReview(
  dialog: Awaited<ReturnType<typeof openKeywordReview>>,
): Promise<void> {
  await dialog.getByRole("button", { name: "展开修改" }).click();
  await expect(dialog.getByLabel("关键词状态")).toBeVisible();
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

test("选中关键词默认显示 ready 系统建议，并分开呈现当前正式状态与建议状态", async ({
  page,
}) => {
  const state = await installKeywordReviewApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}`,
  );

  const detail = page.locator('aside[aria-label="所选关键词详情"]');
  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: "customer onboarding automation",
    }),
  ).toBeVisible();
  await expect.poll(() => state.keywordDetailReads).toBeGreaterThan(0);

  // “候选”是当前已经生效的治理事实；建议里的“已确认”仍只是待批准值。
  await expect(
    detail.locator(":scope > header").getByText("候选", { exact: true }),
  ).toBeVisible();
  const rail = detail.locator(
    '[data-keyword-suggestion-state="pending_ready"]',
  );
  await expect(rail).toBeVisible();
  await expect(
    rail.getByText("系统建议待批准", { exact: true }),
  ).toBeVisible();
  await expect(rail.getByText("可批准", { exact: true })).toBeVisible();
  await expect(rail.getByText("关键词状态", { exact: true })).toBeVisible();
  await expect(rail.getByText("已确认", { exact: true })).toBeVisible();
  await expect(rail.getByText("客户入职", { exact: true })).toBeVisible();
  await expect(
    rail.getByRole("button", { name: "展开修改" }),
  ).toBeVisible();
  const accessibilityScan = await new AxeBuilder({ page })
    .include('[data-keyword-suggestion-state="pending_ready"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    accessibilityScan.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => violation.id),
  ).toEqual([]);
  await rail.getByRole("button", { name: "批准系统建议" }).click();
  await expect.poll(() => state.approveBodies.length).toBe(1);
  expect(state.approveBodies[0]).toEqual({
    expectedGovernanceRevision: 0,
    suggestionVersion: "keyword-governance-suggestion.v1",
  });
  expect(state.patchBodies).toHaveLength(0);
  await expect(
    detail.locator('[data-keyword-suggestion-state="pending_ready"]'),
  ).toHaveCount(0);
  await expect(
    detail.locator(":scope > header").getByText("已确认", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.locator(":scope > header").getByText("用户已确认", { exact: true }),
  ).toBeVisible();
});

test("needs-review 系统建议默认显示需修改状态，且只能展开预填审核", async ({
  page,
}) => {
  const state = await installKeywordReviewApi(page);
  state.setSuggestionState("pending_needs_review");
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}`,
  );

  const detail = page.locator('aside[aria-label="所选关键词详情"]');
  const rail = detail.locator(
    '[data-keyword-suggestion-state="pending_needs_review"]',
  );
  await expect(rail).toBeVisible();
  await expect(
    rail.getByText("需要人工修改", { exact: true }),
  ).toBeVisible();
  await expect(rail.getByText("需修改", { exact: true })).toBeVisible();
  await expect(
    rail.getByRole("button", { name: "批准系统建议" }),
  ).toHaveCount(0);

  await rail.getByRole("button", { name: "展开修改" }).click();
  const dialog = page.getByRole("dialog", {
    name: "审核“customer onboarding automation”",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("关键词状态")).toHaveValue("approved");
  await expect(dialog.getByLabel("搜索意图")).toHaveValue("");
  await expect(dialog.getByLabel("购买阶段")).toHaveValue("consideration");
});

test("生成中、已过期与不可用建议默认诚实显示阻断状态且没有批准入口", async ({
  page,
}) => {
  const state = await installKeywordReviewApi(page);
  const cases = [
    ["generating", "系统建议生成中"],
    ["stale", "系统建议已过期"],
    ["unavailable", "系统建议不可用"],
  ] as const;

  for (const [suggestionState, label] of cases) {
    state.setSuggestionState(suggestionState);
    await page.goto(
      `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}&railState=${suggestionState}`,
    );

    const detail = page.locator('aside[aria-label="所选关键词详情"]');
    const rail = detail.locator(
      `[data-keyword-suggestion-state="${suggestionState}"]`,
    );
    await expect(rail).toBeVisible();
    await expect(rail.getByText(label, { exact: true })).toBeVisible();
    await expect(rail.getByText("已阻断", { exact: true })).toBeVisible();
    await expect(
      rail.getByRole("button", { name: "批准系统建议" }),
    ).toHaveCount(0);
    await expect(
      rail.getByRole("button", { name: "展开修改" }),
    ).toHaveCount(0);
  }
});

test("用户已确认且没有 pending suggestion 时不渲染系统建议 rail", async ({
  page,
}) => {
  await installKeywordReviewApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_C}`,
  );

  const detail = page.locator('aside[aria-label="所选关键词详情"]');
  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: "human confirmed onboarding guide",
    }),
  ).toBeVisible();
  await expect(
    detail.locator(":scope > header").getByText("已确认", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.locator(":scope > header").getByText("用户已确认", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.locator("[data-keyword-suggestion-state]"),
  ).toHaveCount(0);
  await expect(detail.getByText("系统建议", { exact: true })).toHaveCount(0);
});

test("ready 系统建议默认只显示结论，一次批准发送严格两字段 POST", async ({
  page,
}) => {
  const state = await installKeywordReviewApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}`,
  );

  const dialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  await expect(dialog.getByRole("heading", { name: "系统建议" })).toBeVisible();
  await expect(dialog.getByText("建议依据")).toBeVisible();
  await expect(dialog.getByText("客户入职", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("关键词状态")).toHaveCount(0);
  await expect(dialog.getByLabel("搜索意图")).toHaveCount(0);
  await expect(dialog.getByLabel("购买阶段")).toHaveCount(0);
  await expect(dialog.getByLabel("已发布 Topic")).toHaveCount(0);
  await expect(dialog.getByLabel("页面映射决定")).toHaveCount(0);
  await expect(dialog.getByLabel("审核说明")).toHaveCount(0);
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "批准系统建议" }),
  ).toHaveCount(1);

  await dialog.getByRole("button", { name: "批准系统建议" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => state.approveBodies.length).toBe(1);
  expect(state.approveBodies[0]).toEqual({
    expectedGovernanceRevision: 0,
    suggestionVersion: "keyword-governance-suggestion.v1",
  });
  expect(Object.keys(state.approveBodies[0] ?? {}).sort()).toEqual([
    "expectedGovernanceRevision",
    "suggestionVersion",
  ]);
  expect(state.patchBodies).toHaveLength(0);
});

test("移动端默认与展开后的三项审核操作都可见可用", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await installKeywordReviewApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}`,
  );

  const detail = page.locator('aside[aria-label="所选关键词详情"]');
  const rail = detail.locator(
    '[data-keyword-suggestion-state="pending_ready"]',
  );
  await expect(rail).toBeVisible();
  for (const action of ["展开修改", "批准系统建议"]) {
    const button = rail.getByRole("button", { name: action });
    await expect(button).toBeVisible();
    await expect
      .poll(async () => (await button.boundingBox())?.height ?? 0)
      .toBeGreaterThanOrEqual(44);
  }

  const dialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  for (const action of ["取消", "展开修改", "批准系统建议"]) {
    await expect(dialog.getByRole("button", { name: action })).toBeVisible();
  }

  await expandKeywordReview(dialog);
  for (const action of ["取消", "收起修改", "保存审核"]) {
    await expect(dialog.getByRole("button", { name: action })).toBeVisible();
  }
});

test("展开修改才挂载预填表单，并继续使用人工 PATCH 保存例外", async ({
  page,
}) => {
  const state = await installKeywordReviewApi(page);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}`,
  );

  const dialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  await expandKeywordReview(dialog);
  await expect(dialog.getByLabel("关键词状态")).toHaveValue("approved");
  await expect(dialog.getByLabel("搜索意图")).toHaveValue("commercial");
  await expect(dialog.getByLabel("购买阶段")).toHaveValue("consideration");
  await expect(dialog.getByLabel("已发布 Topic")).toHaveValue(ROOT_TOPIC);
  await expect(dialog.getByLabel("页面映射决定")).toHaveValue(
    "existing_page",
  );
  await expect(dialog.getByLabel("规范页面")).toHaveValue(
    E2E_ONBOARDING_SITE_PAGE_ID,
  );
  await expect(dialog.getByLabel("审核说明")).toHaveValue(
    "已确认的产品画像、Topic 与规范页面共同支持这条建议。",
  );

  await dialog.getByLabel("购买阶段").selectOption("decision");
  await dialog
    .getByLabel("审核说明")
    .fill("客户确认建议，但把购买阶段调整为购买决策。");
  await dialog.getByRole("button", { name: "保存审核" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => state.patchBodies.length).toBe(1);
  expect(state.patchBodies[0]).toMatchObject({
    expectedGovernanceRevision: 0,
    status: "approved",
    intent: "commercial",
    buyerStage: "decision",
    topicNodeId: ROOT_TOPIC,
    topicModelRevision: 7,
    mappingDecision: "existing_page",
    mappedSitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
    reason: "客户确认建议，但把购买阶段调整为购买决策。",
  });
  expect(state.approveBodies).toHaveLength(0);
});

test("一键批准发生 CAS 冲突时刷新并呈现新的可审核建议", async ({
  page,
}) => {
  const state = await installKeywordReviewApi(page);
  state.forceApprovalConflict = true;
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}`,
  );

  const dialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  const readsBeforeApproval = state.keywordDetailReads;
  await dialog.getByRole("button", { name: "批准系统建议" }).click();

  await expect(
    dialog.getByText(
      "关键词或建议已更新；系统已重新加载最新建议，请核对后再批准。",
    ),
  ).toBeVisible();
  await expect.poll(() => state.keywordDetailReads).toBeGreaterThan(
    readsBeforeApproval,
  );
  await expect(dialog.getByText("当前治理版本 4")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "批准系统建议" }),
  ).toBeVisible();
  expect(state.approveBodies[0]).toEqual({
    expectedGovernanceRevision: 0,
    suggestionVersion: "keyword-governance-suggestion.v1",
  });
});

test("非 ready 与无建议状态可访问且不会出现一键批准", async ({ page }) => {
  const state = await installKeywordReviewApi(page);
  const cases = [
    ["generating", "系统正在生成建议"],
    ["pending_needs_review", "这条建议仍需人工补充"],
    ["stale", "建议已过期"],
    ["unavailable", "当前无法生成可批准建议"],
  ] as const;

  for (const [suggestionState, label] of cases) {
    state.setSuggestionState(suggestionState);
    await page.goto(
      `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}&state=${suggestionState}`,
    );
    const dialog = await openKeywordReview(
      page,
      "customer onboarding automation",
    );
    await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "批准系统建议" }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "展开修改" }),
    ).toBeVisible();
    if (suggestionState === "pending_needs_review") {
      await expandKeywordReview(dialog);
      await expect(dialog.getByLabel("关键词状态")).toHaveValue("approved");
      await expect(dialog.getByLabel("搜索意图")).toHaveValue("");
      await expect(dialog.getByLabel("购买阶段")).toHaveValue(
        "consideration",
      );
      await expect(dialog.getByLabel("已发布 Topic")).toHaveValue(ROOT_TOPIC);
      await expect(dialog.getByLabel("页面映射决定")).toHaveValue(
        "existing_page",
      );
      await expect(dialog.getByLabel("规范页面")).toHaveValue(
        E2E_ONBOARDING_SITE_PAGE_ID,
      );
    }
    await dialog.getByRole("button", { name: "关闭关键词审核" }).click();
  }

  state.setSuggestionState(null);
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=keywords&selectedKeywordId=${KEYWORD_A}&diagnosticRunId=41000000-0000-4000-8000-000000000099`,
  );
  const pinnedDialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  await expect(
    pinnedDialog.getByText("当前无法生成可批准建议", { exact: true }),
  ).toBeVisible();
  await expect(
    pinnedDialog.getByRole("button", { name: "批准系统建议" }),
  ).toHaveCount(0);
});

test("关键词审核要求 conflict Topic 二次确认，A→B→A 不串状态且不篡改已发布代际", async ({
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
  await expandKeywordReview(dialog);
  await dialog.getByLabel("关键词状态").selectOption("approved");
  await dialog.getByLabel("搜索意图").selectOption("commercial");
  await dialog.getByRole("button", { name: "关闭关键词审核" }).click();

  await page
    .getByRole("button")
    .filter({ hasText: "customer onboarding workflow" })
    .first()
    .click();
  dialog = await openKeywordReview(page, "customer onboarding workflow");
  await expandKeywordReview(dialog);
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
  await expandKeywordReview(dialog);
  // Reopening discards the unsaved local draft and deterministically restores
  // the durable ready suggestion, not the previous component state.
  await expect(dialog.getByLabel("关键词状态")).toHaveValue("approved");
  await expect(dialog.getByLabel("搜索意图")).toHaveValue("commercial");
  await expect(dialog.getByLabel("购买阶段")).toHaveValue("consideration");

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
  // A current governance write refreshes current Topic coverage and relation
  // eligibility. Historical diagnosticRunId caches remain separate.
  await expect.poll(() => state.topicInsightReads).toBeGreaterThan(
    topicReadsBeforeSave,
  );
  await expect.poll(() => state.relationReads).toBeGreaterThan(
    relationReadsBeforeSave,
  );
  const detail = page.locator('aside[aria-label="所选关键词详情"]');
  await expect(detail).toContainText("流程自动化");
  // The conversion path states the mapped page as its site path; the full
  // normalized URL now lives in the sources-and-detail dialog.
  await expect(detail).toContainText("/customer-onboarding/");
  await detail.getByRole("button", { name: "查看来源与明细" }).click();
  const evidence = page.getByRole("dialog", { name: "来源与明细" });
  await expect(evidence).toContainText(
    "https://example.test/customer-onboarding/",
  );
  await evidence.getByRole("button", { name: "关闭来源与明细" }).click();
  await expect(detail.getByText("审核结果已同步")).toBeVisible();

  // Reopening the editor reads the separately cached live review authority, so
  // the successful write is immediately reviewable without contaminating the
  // frozen published projection.
  dialog = await openKeywordReview(
    page,
    "customer onboarding automation",
  );
  await expandKeywordReview(dialog);
  await expect(dialog.getByLabel("关键词状态")).toHaveValue("approved");
  await expect(dialog.getByLabel("搜索意图")).toHaveValue("commercial");
  await expect(dialog.getByLabel("购买阶段")).toHaveValue("consideration");
  await expect(dialog.getByLabel("已发布 Topic")).toHaveValue(CONFLICT_TOPIC);
  await expect(dialog.getByLabel("页面映射决定")).toHaveValue(
    "existing_page",
  );
  await expect(dialog.getByLabel("规范页面")).toHaveValue(
    E2E_ONBOARDING_SITE_PAGE_ID,
  );
  await expect(dialog.getByText("当前治理版本 1")).toBeVisible();
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
  await expandKeywordReview(dialog);
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
