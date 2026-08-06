import { expect, test } from "@playwright/test";

import {
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
} from "./mock-api.ts";

test.beforeEach(async ({ page }) => {
  await installGrowthVerticalApi(page);
});

test("结果摘要不会把仍在加载或失败的 Measurement Window 误报成无数据", async ({
  page,
}) => {
  let releaseRequest: (() => void) | undefined;
  const requestGate = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/measurement-windows/recent**`,
    async (route) => {
      await requestGate;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Dependency unavailable",
          status: 503,
          code: "DEPENDENCY_UNAVAILABLE",
        }),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  const summary = page.getByRole("tabpanel", { name: "结果摘要" });
  await expect(summary).toContainText("正在读取可验证的改前 / 改后记录");
  await expect(summary).not.toContainText("当前没有可读取的 Measurement Window");

  releaseRequest?.();
  await expect(summary).toContainText("暂时无法读取效果记录");
  await expect(summary.getByRole("button", { name: "重新读取" })).toBeVisible();
});

test("效果追踪按 URL 独立切换真实改前改后与 UTM 记录", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/results`);

  const navigation = page.getByRole("navigation", { name: "项目分区" });
  await expect(navigation.getByRole("link")).toHaveCount(4);

  const panel = page.getByRole("region", {
    name: "URL 效果与 UTM 审计",
  });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("2 个 URL 记录")).toBeVisible();

  const tabs = panel.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveText("结果摘要");
  await expect(tabs.nth(1)).toHaveText("页面改前 / 改后");
  await expect(tabs.nth(2)).toHaveText("Campaign / UTM");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(
    panel.getByRole("tabpanel", { name: "结果摘要" }),
  ).toContainText("回执不等于效果");
  await expect(
    panel.getByTestId("result-kpi-organic-clicks"),
  ).toContainText("410");
  await expect(
    panel.getByTestId("result-kpi-organic-clicks"),
  ).toContainText("574");

  const selector = panel.getByRole("complementary", {
    name: "选择要查看的 URL 效果记录",
  });
  const urlButtons = selector.getByRole("button");
  await expect(urlButtons).toHaveCount(2);

  const onboarding = urlButtons.nth(0);
  const pricing = urlButtons.nth(1);
  await expect(onboarding).toHaveAttribute("aria-pressed", "true");
  await expect(pricing).toHaveAttribute("aria-pressed", "false");
  await expect(
    panel.getByRole("heading", {
      name: "/customer-onboarding/",
      level: 2,
    }),
  ).toBeHidden();

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(
    panel.getByRole("heading", {
      name: "/customer-onboarding/",
      level: 2,
    }),
  ).toBeVisible();

  const clicksRow = panel
    .getByRole("row")
    .filter({ hasText: "自然搜索点击" });
  await expect(clicksRow).toContainText("410");
  await expect(clicksRow).toContainText("574");
  const targetRanks = panel.getByRole("region", {
    name: "目标关键词排名",
  });
  await expect(
    targetRanks.getByRole("link", {
      name: /customer onboarding automation/,
    }),
  ).toHaveAttribute(
    "href",
    /object=keywords&selectedKeywordId=20000000-0000-4000-8000-000000000130/,
  );
  await expect(
    targetRanks.getByRole("row", {
      name: /customer onboarding automation/,
    }),
  ).toContainText("12");
  await expect(
    targetRanks.getByRole("row", {
      name: /customer onboarding automation/,
    }),
  ).toContainText("7");
  await expect(targetRanks.getByText("提升 5 位")).toBeVisible();
  await expect(targetRanks).not.toContainText(
    "DataForSEO 未提供独立的数据时点，因此这里按实际采集观测时间比较绝对排名。",
  );
  const limitationDisclosure = targetRanks.getByRole("button", {
    name: "限制说明 (1)",
  });
  await expect(limitationDisclosure).toBeVisible();
  await limitationDisclosure.click();
  await expect(page.getByRole("tooltip")).toContainText(
    "DataForSEO 未提供独立的数据时点，因此这里按实际采集观测时间比较绝对排名。",
  );
  await expect(
    targetRanks.getByText(
      /DataForSEO absolute rank is compared by collection observation time/,
    ),
  ).toHaveCount(0);

  await pricing.click();

  await expect(pricing).toHaveAttribute("aria-pressed", "true");
  await expect(onboarding).toHaveAttribute("aria-pressed", "false");
  await expect(panel.getByTestId("result-kpi-ai-citations")).toContainText(
    "不可用",
  );
  await expect(panel.getByTestId("result-kpi-ai-citations")).not.toContainText(
    "0",
  );
  await expect(panel.getByTestId("result-kpi-direct-conversions")).toContainText(
    "9",
  );
  await expect(panel.getByTestId("result-kpi-direct-conversions")).toContainText(
    "14",
  );
  await expect(
    panel.getByTestId("result-kpi-utm-direct-conversions"),
  ).toContainText("2");
  await expect(
    panel.getByTestId("result-kpi-utm-direct-conversions"),
  ).toContainText("6");
  await expect(
    panel.getByRole("heading", { name: "/pricing/", level: 2 }),
  ).toBeVisible();
  await expect(clicksRow).toContainText("721");
  await expect(clicksRow).toContainText("982");
  await expect(
    targetRanks.getByRole("link", {
      name: /customer onboarding pricing/,
    }),
  ).toBeVisible();
  await expect(
    targetRanks.getByText("下降 1 位"),
  ).toBeVisible();
  await expect(
    targetRanks.getByText("customer onboarding automation"),
  ).toHaveCount(0);

  // Regression guard for the historical "only the first URL switch works"
  // bug: a second switch must restore the exact first URL's independent
  // measurement and must remove the second URL's target Keyword.
  await onboarding.click();
  await expect(onboarding).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel.getByRole("heading", {
      name: "/customer-onboarding/",
      level: 2,
    }),
  ).toBeVisible();
  await expect(
    targetRanks.getByText("提升 5 位"),
  ).toBeVisible();
  await expect(
    targetRanks.getByText("customer onboarding pricing"),
  ).toHaveCount(0);

  await tabs.nth(0).focus();
  await tabs.nth(0).press("End");
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(
    panel.getByRole("tabpanel", { name: "Campaign / UTM" }),
  ).toContainText("customer-onboarding");
  await pricing.click();
  await expect(
    panel.getByRole("tabpanel", { name: "Campaign / UTM" }),
  ).toContainText("pricing-intent");
});
