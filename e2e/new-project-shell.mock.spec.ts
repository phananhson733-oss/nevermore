import { expect, test, type Page, type Route } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

async function json(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

async function hasRootHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
}

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies();
  await installCriticalFlowApi(page);
});

test("zero-project entry uses the Chinese-first four-module GenGrowth shell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/new-project");

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("[data-app-shell]")).toHaveAttribute(
    "data-app-shell-state",
    "empty-project",
  );
  const sidebar = page.locator("[data-app-shell-sidebar]");
  const topbar = page.locator("[data-app-shell-topbar]");
  await expect(sidebar).toBeVisible();
  await expect(topbar).toBeVisible();
  await expect(
    sidebar.getByLabel("GenGrowth", { exact: true }),
  ).toContainText("GenGrowth");
  await expect(topbar).toContainText("GenGrowth 工作区");
  await expect(topbar).toContainText("添加产品");

  const navigation = page.locator("[data-app-shell-locked-navigation]");
  await expect(navigation).toHaveAttribute("aria-label", "项目分区");
  await expect(navigation).toHaveAttribute(
    "data-project-navigation-state",
    "disabled",
  );
  await expect(navigation).toHaveAttribute("tabindex", "0");
  await expect(navigation).toHaveAccessibleDescription("添加产品后即可进入");
  const modules = navigation.locator("[data-workspace-module]");
  await expect(modules).toHaveCount(4);
  for (const [key, label] of [
    ["overview", "概览"],
    ["growth-map", "增长地图"],
    ["execution", "执行中心"],
    ["results", "效果追踪"],
  ] as const) {
    const module = navigation.locator(`[data-workspace-module="${key}"]`);
    await expect(module).toBeDisabled();
    await expect(module).toHaveAccessibleDescription("添加产品后即可进入");
    await expect(module).toContainText(label);
  }
  await expect(navigation.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.locator("[data-nav-count]")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "切换项目" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "添加产品" })).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "添加产品", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("产品名称")).toBeVisible();
  await expect(page.getByLabel("产品 URL")).toBeVisible();
  await expect(page.getByLabel("客户模式")).toBeVisible();
  await expect(page.getByLabel("主要目标市场")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "提升注册" }),
  ).toBeVisible();
  await expect(page.getByLabel("补充业务背景（选填）")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "创建并生成初始画像" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("RelayOps");
  await expect(page.locator("body")).not.toContainText("SignalFrame");

  expect(await hasRootHorizontalOverflow(page)).toBe(false);
});

test("product creation preserves trimming, declared inputs, and context redirect", async ({
  page,
}) => {
  const createRequests: unknown[] = [];
  await page.route("**/api/mvp/projects", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    createRequests.push(route.request().postDataJSON());
    await json(route, { id: E2E_PROJECT_ID }, 201);
  });

  const cases = [
    {
      productName: "  RelayOps  ",
      productUrl: "  https://example.com/product/  ",
      customerModel: "b2b",
      primaryMarket: "US",
      growthObjectives: [
        { label: "提升注册", value: "increase_signups" },
        {
          label: "获取高质量销售线索",
          value: "generate_qualified_leads",
        },
      ],
    },
    {
      productName: "  Second Product  ",
      productUrl: "https://example.com/second-product",
      customerModel: "b2c",
      primaryMarket: "GB",
      growthObjectives: [{ label: "提升收入", value: "increase_revenue" }],
    },
  ] as const;

  for (const [index, input] of cases.entries()) {
    await page.goto("/new-project");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("产品名称").fill(input.productName);
    await page.getByLabel("产品 URL").fill(input.productUrl);
    await page.getByLabel("客户模式").selectOption(input.customerModel);
    await page.getByLabel("主要目标市场").selectOption(input.primaryMarket);
    for (const objective of input.growthObjectives) {
      await page.getByRole("checkbox", { name: objective.label }).check();
    }
    await page
      .getByRole("button", { name: "创建并生成初始画像" })
      .click();

    await expect.poll(() => createRequests.length).toBe(index + 1);
    await page.waitForURL(`/p/${E2E_PROJECT_ID}/context`);
  }

  expect(createRequests).toEqual([
    {
      mode: "product_profile",
      productName: "RelayOps",
      productUrl: "https://example.com/product/",
      customerModel: "b2b",
      primaryMarket: "US",
      growthObjectives: [
        "increase_signups",
        "generate_qualified_leads",
      ],
    },
    {
      mode: "product_profile",
      productName: "Second Product",
      productUrl: "https://example.com/second-product",
      customerModel: "b2c",
      primaryMarket: "GB",
      growthObjectives: ["increase_revenue"],
    },
  ]);
});

test("zero-project shell remains usable on a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/new-project");

  await expect(page.locator("[data-app-shell-sidebar]")).toBeVisible();
  await expect(page.locator("[data-app-shell-topbar]")).toBeVisible();
  await expect(
    page.locator("[data-app-shell-locked-navigation] [data-workspace-module]"),
  ).toHaveCount(4);
  await expect(page.getByLabel("产品名称")).toBeVisible();
  await expect(page.getByLabel("产品 URL")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "创建并生成初始画像" }),
  ).toBeVisible();

  const sidebar = page.locator("[data-app-shell-sidebar]");
  const topbar = page.locator("[data-app-shell-topbar]");
  const navigation = page.locator("[data-app-shell-locked-navigation]");
  await expect(sidebar).toHaveCSS("position", "sticky");
  await expect(topbar).toHaveCSS("position", "sticky");
  expect(await hasRootHorizontalOverflow(page)).toBe(false);

  const navMetrics = await navigation.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(navMetrics.scrollWidth).toBeGreaterThan(navMetrics.clientWidth);
  await navigation.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(
    navigation.getByRole("button", { name: "效果追踪", exact: true }),
  ).toBeInViewport();
});
