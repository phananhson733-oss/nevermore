import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  diagnosisFindingFixture,
  diagnosisFindingsEnvelopeFixture,
  installCriticalFlowApi,
  type MockEvidence,
} from "./mock-api.ts";

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const NOW = "2026-07-20T00:00:00.000Z";
const CAPTURE_DIR = process.env["SF_PLAN_CAPTURE_DIR"];

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

async function installLinkedFindingApi(
  page: Page,
  action: ReturnType<typeof actionFixture>,
): Promise<void> {
  await page.route("**/api/mvp/projects/*/findings**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === `${API_BASE}/findings`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          diagnosisFindingsEnvelopeFixture([
            diagnosisFindingFixture({
              id: action.findingId,
              summary: "This finding is the real reason for the plan action.",
              evidence: [
                {
                  id: "00000000-0000-4000-8000-000000000991",
                  sourceProvider: "crawl",
                  origin: "direct_public",
                  method: "observed",
                  grade: "B",
                  availability: "available",
                  support: "supports",
                  claim: "The linked page returned a server error.",
                  subjectRefs: [
                    {
                      type: "url",
                      value: "https://example.test/failing-product-page",
                    },
                  ],
                  observedAt: NOW,
                  limitation: "One captured response.",
                  snapshotId: "00000000-0000-4000-8000-000000000992",
                  collectionRunId:
                    "00000000-0000-4000-8000-000000000993",
                  analysisInvocationId: null,
                } satisfies MockEvidence,
              ],
            }),
          ]),
        ),
      });
      return;
    }
    await route.fallback();
  });
}

test("the roadmap always reserves three equal canonical delivery lanes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlanActionsApi(page, [
    actionFixture("now", 0),
    actionFixture("now", 1),
    actionFixture("now", 2),
    actionFixture("next", 3),
    actionFixture("next", 4),
    actionFixture("later", 5),
  ]);
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);

  const board = page.getByTestId("plan-board");
  await expect(board).toHaveAttribute("data-lane-count", "3");
  await expect(board).toHaveAttribute("data-populated-lane-count", "3");

  const lanes = board.getByRole("region");
  await expect(lanes).toHaveCount(3);
  await expect(lanes.nth(0)).toHaveAccessibleName(/^First 30 days —/);
  await expect(lanes.nth(1)).toHaveAccessibleName(/^Days 31–60 —/);
  await expect(lanes.nth(2)).toHaveAccessibleName(/^Days 61–90 —/);
  await expect(board.getByText("01", { exact: true })).toBeVisible();
  await expect(board.getByText("02", { exact: true })).toBeVisible();
  await expect(board.getByText("03", { exact: true })).toBeVisible();

  const laneBoxes = await Promise.all([
    lanes.nth(0).boundingBox(),
    lanes.nth(1).boundingBox(),
    lanes.nth(2).boundingBox(),
  ]);
  expect(laneBoxes.every((box) => box !== null)).toBe(true);
  expect(laneBoxes[0]!.x).toBeLessThan(laneBoxes[1]!.x);
  expect(laneBoxes[1]!.x).toBeLessThan(laneBoxes[2]!.x);
  expect(Math.abs(laneBoxes[0]!.width - laneBoxes[1]!.width)).toBeLessThan(2);
  expect(Math.abs(laneBoxes[1]!.width - laneBoxes[2]!.width)).toBeLessThan(2);
  expect(
    await page
      .getByTestId("plan-lane-now")
      .getByTestId("plan-action-card")
      .evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-action-id")),
      ),
  ).toEqual([
    actionFixture("now", 0).id,
    actionFixture("now", 1).id,
    actionFixture("now", 2).id,
  ]);

  if (CAPTURE_DIR !== undefined) {
    await page.screenshot({
      path: `${CAPTURE_DIR}/plan-page-1440.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({
      path: `${CAPTURE_DIR}/plan-page-1920.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${CAPTURE_DIR}/plan-page-390.png`,
      fullPage: true,
    });
  }
});

test("lane tracks become two columns at tablet width and one column on mobile", async ({
  page,
}) => {
  const laterActions = Array.from({ length: 4 }, (_, index) =>
    actionFixture("later", index),
  );
  await page.setViewportSize({ width: 900, height: 900 });
  await installPlanActionsApi(page, laterActions);
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);

  const board = page.getByTestId("plan-board");
  const lanes = board.getByRole("region");
  const laterTrack = page
    .getByTestId("plan-lane-later")
    .getByTestId("plan-lane-actions");
  const tabletLaneBoxes = await Promise.all([
    lanes.nth(0).boundingBox(),
    lanes.nth(1).boundingBox(),
    lanes.nth(2).boundingBox(),
  ]);
  expect(tabletLaneBoxes[0]!.y).toBeLessThan(tabletLaneBoxes[1]!.y);
  expect(tabletLaneBoxes[1]!.y).toBeLessThan(tabletLaneBoxes[2]!.y);
  await expect(laterTrack).toHaveCSS("display", "grid");
  expect(
    (
      await laterTrack.evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns,
      )
    )
      .trim()
      .split(/\s+/),
  ).toHaveLength(2);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (
      await laterTrack.evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns,
      )
    )
      .trim()
      .split(/\s+/),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
});

test("seven blocked actions share one honest explanation without duplicating it", async ({
  page,
}) => {
  const blockedActions = Array.from({ length: 7 }, (_, index) => ({
    ...actionFixture("later", index),
    status: "blocked",
  }));

  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlanActionsApi(page, blockedActions);
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);

  const lane = page.getByTestId("plan-lane-later");
  const cards = lane.getByTestId("plan-action-card");
  const sharedNote = lane.getByTestId("plan-lane-blocked-note");

  await expect(cards).toHaveCount(7);
  expect(
    await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-action-status")),
    ),
  ).toEqual(Array.from({ length: 7 }, () => "blocked"));
  expect(
    await cards
      .getByRole("button")
      .evaluateAll((nodes) =>
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
  await expect(
    cards.getByText("Blocked — waiting on data", { exact: true }),
  ).toHaveCount(0);
});

test("Action drawer uses a 690px desktop panel, restores focus on Escape, and is full-width on mobile", async ({
  page,
}) => {
  const action = actionFixture("now", 0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installPlanActionsApi(page, [action]);
  await installLinkedFindingApi(page, action);
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);

  const trigger = page.getByRole("button", {
    name: `Open action details — ${action.title}`,
  });
  await trigger.focus();
  await trigger.click();

  const drawer = page.getByTestId("plan-action-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(page.getByTestId("plan-priority-grid").locator("article")).toHaveCount(8);
  await expect(drawer).toContainText(
    "This finding is the real reason for the plan action.",
  );
  await expect(drawer).toContainText("The linked page returned a server error.");
  await expect(drawer).toContainText("Site crawl · Available");
  const drawerA11y = await new AxeBuilder({ page })
    .include('[data-testid="plan-action-drawer"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    drawerA11y.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  const desktopBox = await drawer.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.width).toBeGreaterThanOrEqual(688);
  expect(desktopBox!.width).toBeLessThanOrEqual(691);
  const desktopViewportWidth = await page.evaluate(() => window.innerWidth);
  await expect
    .poll(async () => {
      const box = await drawer.boundingBox();
      return box === null
        ? Number.POSITIVE_INFINITY
        : Math.abs(box.x + box.width - desktopViewportWidth);
    })
    .toBeLessThan(1);

  if (CAPTURE_DIR !== undefined) {
    await page.screenshot({
      path: `${CAPTURE_DIR}/plan-drawer-1440.png`,
      fullPage: false,
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    const wideViewportWidth = await page.evaluate(() => window.innerWidth);
    await expect
      .poll(async () => {
        const box = await drawer.boundingBox();
        return box === null
          ? Number.POSITIVE_INFINITY
          : Math.abs(box.x + box.width - wideViewportWidth);
      })
      .toBeLessThan(1);
    await page.screenshot({
      path: `${CAPTURE_DIR}/plan-drawer-1920.png`,
      fullPage: false,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

  await trigger.click();
  await expect(page.getByTestId("plan-action-drawer")).toBeVisible();
  await page
    .getByTestId("plan-action-backdrop")
    .click({ position: { x: 2, y: 2 } });
  await expect(page.getByTestId("plan-action-drawer")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  const mobileDrawer = page.getByTestId("plan-action-drawer");
  await expect
    .poll(async () => (await mobileDrawer.boundingBox())?.x ?? -1)
    .toBe(0);
  const mobileBox = await mobileDrawer.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.x).toBe(0);
  expect(mobileBox!.width).toBe(390);
  if (CAPTURE_DIR !== undefined) {
    await page.screenshot({
      path: `${CAPTURE_DIR}/plan-drawer-390.png`,
      fullPage: false,
    });
  }

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("plan-action-drawer")).toHaveCount(0);
});

test("Action drawer localizes the evidence provider and availability in Chinese", async ({
  page,
}) => {
  const action = actionFixture("now", 0);
  await installPlanActionsApi(page, [action]);
  await installLinkedFindingApi(page, action);
  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);
  await page.getByRole("button", { name: "简体中文" }).click();

  await page
    .getByRole("button", {
      name: `打开行动详情 — ${action.title}`,
    })
    .click();

  const drawer = page.getByTestId("plan-action-drawer");
  await expect(drawer).toContainText("站点抓取 · 可用");
  await expect(drawer.getByText("crawl · 可用", { exact: true })).toHaveCount(
    0,
  );
});
