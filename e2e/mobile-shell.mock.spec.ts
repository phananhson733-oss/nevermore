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
  const projectSwitcher = page.getByRole("combobox", {
    name: "Switch project",
  });

  await expect(page.getByText("signalframe", { exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "New project" })).toBeHidden();
  await expect(projectSwitcher).toBeVisible();
  await expect(projectSwitcher).toHaveValue(E2E_PROJECT_ID);
  await expect(projectSwitcher.locator("option")).toHaveCount(2);
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

  await expect(
    page
      .getByRole("link", { name: "Diagnosis", exact: true })
      .locator("[data-nav-count]"),
  ).toHaveText("1");
  await expect(
    page
      .getByRole("link", { name: "Studio", exact: true })
      .locator("[data-nav-count]"),
  ).toHaveText("1");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrolledSidebarBox = await sidebar.boundingBox();
  expect(scrolledSidebarBox?.y).toBe(0);
  await expect(projectNav).toBeVisible();
});

test("desktop project cockpit exposes canonical progress and product chrome", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);

  await expect(
    page.getByRole("progressbar", { name: "90-day program progress" }),
  ).toHaveAttribute("aria-valuenow", "30");
  await expect(page.getByText("Day 30 of 90", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Help" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});
