import { expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
});

test("mobile project shell keeps a compact persistent navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);

  const sidebar = page.locator("aside");
  const projectNav = page.getByRole("navigation", {
    name: "Project sections",
  });
  const topbar = page.locator("header").first();

  await expect(page.getByText("signalframe", { exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "New project" })).toBeHidden();
  await expect(sidebar).toHaveCSS("position", "sticky");
  await expect(topbar).toHaveCSS("position", "sticky");

  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox?.height).toBeLessThanOrEqual(60);

  const navMetrics = await projectNav.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(navMetrics.scrollWidth).toBeGreaterThan(navMetrics.clientWidth);

  await projectNav.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const reportLink = page.getByRole("link", { name: "Report", exact: true });
  await expect(reportLink).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrolledSidebarBox = await sidebar.boundingBox();
  expect(scrolledSidebarBox?.y).toBe(0);
  await expect(projectNav).toBeVisible();
});
