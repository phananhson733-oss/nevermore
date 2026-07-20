import { expect, test, type Page } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  overviewWorkspaceFixture,
} from "./mock-api.ts";

const WORKSPACE_ROUTE = `**/api/mvp/projects/${E2E_PROJECT_ID}/workspace?view=overview`;

async function serveOverview(page: Page, data: unknown): Promise<void> {
  await page.route(WORKSPACE_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data }),
    });
  });
}

async function openOverview(page: Page): Promise<void> {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await expect(
    page.getByRole("heading", { name: "E2E Critical Flow" }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
});

test("ready Overview renders the canonical signal → action → delivery chain", async ({
  page,
}) => {
  await openOverview(page);

  const freshness = page.getByRole("group", { name: "Freshness" });
  await expect(freshness).toContainText("Jul 18, 2026");
  await expect(freshness).not.toContainText("No data collected yet");

  const delivery = page.getByRole("group", { name: "Delivery" });
  await expect(delivery).toContainText("Draft");
  await expect(delivery.getByText("EN", { exact: true })).toHaveCount(0);

  const rail = page.getByRole("region", { name: "Signal rail" });
  await expect(rail).toContainText("Diagnosis");
  await expect(rail).toContainText("Action");
  await expect(rail).toContainText("Delivery");

  const action = page.getByRole("region", { name: "Highest-priority action" });
  await expect(action).toContainText("Fix the failing product page");
  await expect(action).toContainText("High");
  await expect(action).toContainText("Planned");
  await expect(action).toContainText("1 linked evidence item");

  const evidence = page.getByRole("region", { name: "Evidence focus" });
  await expect(evidence).toContainText("crawl");
  await expect(evidence).toContainText("Jul 18, 2026");

  const focus = page.getByRole("region", { name: "Delivery focus" });
  await expect(focus).toContainText("Technical ticket");
  await expect(focus).toContainText("Draft");
});

test("empty and partial Overview states stay explicit about unavailable links", async ({
  page,
}) => {
  await serveOverview(
    page,
    overviewWorkspaceFixture({
      coverage: { overall: "unavailable", domains: {}, limitations: [] },
      topActions: [],
      latestSnapshot: null,
      topActionEvidence: [],
      deliveryFocus: null,
    }),
  );
  await openOverview(page);

  await expect(page.getByRole("group", { name: "Freshness" })).toContainText(
    "Unavailable",
  );
  await expect(page.getByRole("group", { name: "Delivery" })).toContainText(
    "Unavailable",
  );
  await expect(page.getByRole("region", { name: "Signal rail" })).toContainText(
    "No diagnosis data",
  );

  await page.unroute(WORKSPACE_ROUTE);
  const partial = overviewWorkspaceFixture({
    topActionEvidence: [],
    deliveryFocus: null,
  });
  await serveOverview(page, partial);
  await page.reload();

  await expect(page.getByRole("group", { name: "Freshness" })).toContainText(
    "Jul 18, 2026",
  );
  await expect(
    page.getByRole("region", { name: "Highest-priority action" }),
  ).toContainText("Fix the failing product page");
  await expect(page.getByRole("region", { name: "Evidence focus" })).toContainText(
    "Unavailable",
  );
  await expect(page.getByRole("region", { name: "Delivery focus" })).toContainText(
    "Unavailable",
  );
});

test("Overview chrome localizes to zh-CN while canonical content stays intact", async ({
  page,
}) => {
  await openOverview(page);
  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(page.getByRole("region", { name: "信号链" })).toBeVisible();
  const action = page.getByRole("region", { name: "最高优先级行动" });
  await expect(action).toContainText("Fix the failing product page");
  await expect(action.getByText("已计划", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "证据焦点" })).toBeVisible();
  await expect(page.getByRole("region", { name: "交付焦点" })).toContainText(
    "草稿",
  );
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
] as const) {
  test(`Overview renders at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openOverview(page);
    await expect(page.getByRole("region", { name: "Signal rail" })).toBeVisible();
    await page.screenshot({
      path: `/tmp/signalframe-overview-${viewport.width}.png`,
      fullPage: true,
    });
  });
}
