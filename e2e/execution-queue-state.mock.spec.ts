import { expect, test, type Page } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installActionOverrideApi,
  overrideActionFixture,
  overrideArtifactFixture,
} from "./mock-api.ts";

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const ACTOR_ID = "00000000-0000-4000-8000-000000000721";
const DEFINITION_ID = "00000000-0000-4000-8000-000000000722";

async function useChineseUi(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([
      {
        name: "sf_ui_locale",
        value: "zh-CN",
        domain: "localhost",
        path: "/",
      },
    ]);
}

test("执行中心队列无需点开即可看到真实阻断、进度与完成状态", async ({
  page,
}) => {
  const actions = [
    overrideActionFixture(21, { title: "已完成的技术修复" }),
    overrideActionFixture(22, { title: "等待客户批准发布" }),
    overrideActionFixture(23, { title: "正在编写英文 Blog" }),
  ];
  const artifacts = actions.map((action, index) =>
    overrideArtifactFixture(index + 21, action.id),
  );
  await installActionOverrideApi(page, { actions, artifacts });

  const events = [
    {
      eventId: "00000000-0000-4000-8000-000000000731",
      projectId: E2E_PROJECT_ID,
      actionId: actions[0]!.id,
      artifactId: artifacts[0]!.id,
      revision: 2,
      expectedRevision: 1,
      transitionKind: "state_transition",
      state: "completed",
      phase: "completed",
      nextStep: null,
      blocker: null,
      progress: null,
      idempotencyKey: "e2e-execution-completed",
      actorId: ACTOR_ID,
      occurredAt: "2026-07-28T03:00:00.000Z",
    },
    {
      eventId: "00000000-0000-4000-8000-000000000732",
      projectId: E2E_PROJECT_ID,
      actionId: actions[1]!.id,
      artifactId: artifacts[1]!.id,
      revision: 1,
      expectedRevision: 0,
      transitionKind: "state_transition",
      state: "blocked",
      phase: "waiting_for_approval",
      nextStep: "等待客户完成审核。",
      blocker: {
        code: "approval.required",
        summary: "英文 Blog 发布前仍需客户确认。",
        unlockCondition: "客户批准当前版本并确认发布日期。",
        ownerId: ACTOR_ID,
        sourceKind: "approval",
        sourceRef: "approval:e2e",
        observedAt: "2026-07-28T03:05:00.000Z",
        freshness: "current",
      },
      progress: null,
      idempotencyKey: "e2e-execution-blocked",
      actorId: ACTOR_ID,
      occurredAt: "2026-07-28T03:05:00.000Z",
    },
    {
      eventId: "00000000-0000-4000-8000-000000000733",
      projectId: E2E_PROJECT_ID,
      actionId: actions[2]!.id,
      artifactId: artifacts[2]!.id,
      revision: 3,
      expectedRevision: 2,
      transitionKind: "state_update",
      state: "in_progress",
      phase: "drafting",
      nextStep: "完成事实核验与内链。",
      blocker: null,
      progress: {
        stepDefinitionId: DEFINITION_ID,
        stepDefinitionVersion: 1,
        completedSteps: 3,
        totalSteps: 7,
      },
      idempotencyKey: "e2e-execution-progress",
      actorId: ACTOR_ID,
      occurredAt: "2026-07-28T03:10:00.000Z",
    },
  ] as const;

  await page.route(
    `**${API_BASE}/artifacts/execution-states**`,
    async (route) => {
      const requested = new URL(route.request().url()).searchParams.getAll(
        "artifactId",
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            projectId: E2E_PROJECT_ID,
            items: requested.map((artifactId) => {
              const current =
                events.find((event) => event.artifactId === artifactId) ??
                null;
              const artifact = artifacts.find(
                (item) => item.id === artifactId,
              );
              return {
                actionId: artifact?.actionId ?? actions[0]!.id,
                artifactId,
                current,
              };
            }),
          },
        }),
      });
    },
  );

  await useChineseUi(page);
  await page.goto(`/p/${E2E_PROJECT_ID}/execution`);
  const queue = page.locator("[data-studio-queue]");
  await expect(queue).toBeVisible();

  const blockedCard = queue.locator(
    `[data-studio-artifact-id="${artifacts[1]!.id}"]`,
  );
  const blocked = blockedCard.locator(
    '[data-artifact-execution-state="blocked"]',
  );
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText("受阻");
  await expect(blocked).toContainText("英文 Blog 发布前仍需客户确认。");
  await expect(blocked).toContainText("客户批准当前版本并确认发布日期。");

  const progressCard = queue.locator(
    `[data-studio-artifact-id="${artifacts[2]!.id}"]`,
  );
  const progress = progressCard.locator(
    '[data-artifact-execution-state="in_progress"]',
  );
  await expect(progress).toContainText("已完成 3 / 7 个步骤");
  await expect(progress.locator("progress")).toHaveAttribute("value", "3");
  await expect(progress.locator("progress")).toHaveAttribute("max", "7");

  const completedCard = queue.locator(
    `[data-studio-artifact-id="${artifacts[0]!.id}"]`,
  );
  await expect(
    completedCard.locator(
      '[data-artifact-execution-state="completed"]',
    ),
  ).toContainText("已完成");

  const primaryNavigation = page.getByRole("navigation", {
    name: "项目分区",
  });
  await expect(primaryNavigation.getByRole("link")).toHaveCount(4);
  await expect(primaryNavigation).toContainText("概览");
  await expect(primaryNavigation).toContainText("增长地图");
  await expect(primaryNavigation).toContainText("执行中心");
  await expect(primaryNavigation).toContainText("效果追踪");
});
