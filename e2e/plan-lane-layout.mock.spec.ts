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

test("seven blocked actions share one honest reason and form a responsive dense lane", async ({
  page,
}) => {
  const blockedActions = Array.from({ length: 7 }, (_, index) => ({
    ...actionFixture("later", index),
    status: "blocked",
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlanActionsApi(page, blockedActions);
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);

  const board = page.getByTestId("plan-board");
  const lane = board.getByRole("region", { name: /^Later —/ });
  const cards = lane.getByTestId("plan-action-card");
  const sharedNote = lane.getByTestId("plan-lane-blocked-note");
  const laneActions = lane.getByTestId("plan-lane-actions");

  await expect(board).toHaveAttribute("data-lane-count", "1");
  await expect(cards).toHaveCount(7);
  expect(
    await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-action-status")),
    ),
  ).toEqual(Array.from({ length: 7 }, () => "blocked"));
  expect(
    await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-describedby")),
    ),
  ).toEqual(
    Array.from({ length: 7 }, () => "plan-later-blocked-explanation"),
  );
  await expect(sharedNote).toHaveCount(1);
  await expect(sharedNote).toContainText("Blocked — waiting on data");
  await expect(sharedNote).toContainText(
    "Confidence was too low to schedule this action",
  );
  await expect(laneActions).toHaveCSS("display", "grid");

  const blockedStatusPills = cards.getByText("Blocked", { exact: true });
  await expect(blockedStatusPills).toHaveCount(7);
  await expect(
    cards.getByText("Blocked — waiting on data", { exact: true }),
  ).toHaveCount(0);

  const desktopColumns = await laneActions.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns,
  );
  expect(desktopColumns.trim().split(/\s+/).length).toBeGreaterThan(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cards).toHaveCount(7);
  await expect(sharedNote).toBeVisible();
  await expect(laneActions).toHaveCSS("display", "grid");

  const mobileColumns = await laneActions.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns,
  );
  expect(mobileColumns.trim().split(/\s+/)).toHaveLength(1);

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
