import { expect, test, type Page } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
} from "./mock-api.ts";

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const NOW = "2026-07-20T00:00:00.000Z";

type RoadmapLane = "now" | "next" | "later";

function actionFixture(lane: RoadmapLane, index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(700 + index).padStart(12, "0")}`,
    findingId: `00000000-0000-4000-8000-${String(800 + index).padStart(12, "0")}`,
    templateId: `plan_${lane}_${index}.v1`,
    title: `${lane} action ${index + 1}`,
    description: `Fixture assigned to the ${lane} delivery window.`,
    contentLocale: "en",
    priorityBand: "medium",
    roadmapLane: lane,
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: "The populated delivery lane remains readable.",
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function installPlanActionsApi(
  page: Page,
  actions: readonly ReturnType<typeof actionFixture>[],
): Promise<void> {
  await installCriticalFlowApi(page);
  await page.route("**/api/mvp/projects/*/actions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === `${API_BASE}/actions`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: actions,
          meta: { nextCursor: null, hasNext: false, limit: 100 },
        }),
      });
      return;
    }

    await route.fallback();
  });
}

test("a single populated delivery lane expands instead of reserving empty columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlanActionsApi(
    page,
    Array.from({ length: 7 }, (_, index) => actionFixture("later", index)),
  );
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);

  const board = page.getByTestId("plan-board");
  await expect(board).toHaveAttribute("data-lane-count", "1");
  await expect(board.getByRole("region", { name: /^Later —/ })).toBeVisible();
  await expect(board.getByRole("region", { name: /^Now —/ })).toHaveCount(0);
  await expect(board.getByRole("region", { name: /^Next —/ })).toHaveCount(0);
  await expect(board.getByText("03", { exact: true })).toBeVisible();

  const boardBox = await board.boundingBox();
  const laneBox = await board.getByRole("region", { name: /^Later —/ }).boundingBox();
  expect(boardBox).not.toBeNull();
  expect(laneBox).not.toBeNull();
  expect(laneBox!.width / boardBox!.width).toBeGreaterThan(0.95);
});

test("multiple populated delivery lanes retain the canonical three-column order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlanActionsApi(page, [
    actionFixture("now", 0),
    actionFixture("next", 1),
    actionFixture("later", 2),
  ]);
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);

  const board = page.getByTestId("plan-board");
  await expect(board).toHaveAttribute("data-lane-count", "3");
  const lanes = board.getByRole("region");
  await expect(lanes).toHaveCount(3);
  await expect(lanes.nth(0)).toHaveAccessibleName(/^Now —/);
  await expect(lanes.nth(1)).toHaveAccessibleName(/^Next —/);
  await expect(lanes.nth(2)).toHaveAccessibleName(/^Later —/);

  const laneBoxes = await Promise.all([
    lanes.nth(0).boundingBox(),
    lanes.nth(1).boundingBox(),
    lanes.nth(2).boundingBox(),
  ]);
  expect(laneBoxes.every((box) => box !== null)).toBe(true);
  expect(laneBoxes[0]!.x).toBeLessThan(laneBoxes[1]!.x);
  expect(laneBoxes[1]!.x).toBeLessThan(laneBoxes[2]!.x);
});
