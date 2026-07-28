import { expect, test } from "@playwright/test";

import {
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
} from "./mock-api.ts";

test.beforeEach(async ({ page }) => {
  await installGrowthVerticalApi(page);
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
  ).toBeVisible();

  const clicksRow = panel
    .getByRole("row")
    .filter({ hasText: "自然搜索点击" });
  await expect(clicksRow).toContainText("410");
  await expect(clicksRow).toContainText("574");
  await expect(panel.getByText("customer-onboarding", { exact: true })).toBeVisible();
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
  await targetRanks
    .getByText("1 条排名数据限制")
    .click();
  await expect(
    targetRanks.getByText(
      "DataForSEO 未提供独立的数据时点，因此这里按实际采集观测时间比较绝对排名。",
    ),
  ).toBeVisible();
  await expect(
    targetRanks.getByText(
      /DataForSEO absolute rank is compared by collection observation time/,
    ),
  ).toHaveCount(0);

  await pricing.click();

  await expect(pricing).toHaveAttribute("aria-pressed", "true");
  await expect(onboarding).toHaveAttribute("aria-pressed", "false");
  await expect(
    panel.getByRole("heading", { name: "/pricing/", level: 2 }),
  ).toBeVisible();
  await expect(clicksRow).toContainText("721");
  await expect(clicksRow).toContainText("982");
  await expect(panel.getByText("pricing-intent", { exact: true })).toBeVisible();
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
});
