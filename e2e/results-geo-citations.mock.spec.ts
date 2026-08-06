import { expect, test } from "@playwright/test";

import {
  E2E_PROJECT_ID,
  installGrowthVerticalApi,
} from "./mock-api.ts";

test("效果追踪切换 URL 时同步切换真实 GEO 引用证据", async ({
  page,
}) => {
  const state = await installGrowthVerticalApi(page);
  await page.goto(`/p/${E2E_PROJECT_ID}/results`);

  const panel = page.getByRole("region", {
    name: "URL 效果与 UTM 审计",
  });
  const selector = panel.getByRole("complementary", {
    name: "选择要查看的 URL 效果记录",
  });
  const urlButtons = selector.getByRole("button");
  const onboarding = urlButtons.nth(0);
  const pricing = urlButtons.nth(1);
  const geo = panel.getByRole("region", {
    name: "GEO / AI 引用",
  });

  await expect(onboarding).toHaveAttribute("aria-pressed", "true");
  const citationsRow = geo
    .getByRole("row")
    .filter({ hasText: "AI 引用次数" });
  await expect(citationsRow).toContainText("4");
  await expect(citationsRow).toContainText("9");

  const onboardingQuery = geo
    .locator("details")
    .filter({ hasText: "best customer onboarding software" });
  await expect(onboardingQuery.locator("summary")).toContainText(
    "ChatGPT",
  );
  await expect(onboardingQuery.locator("summary")).toContainText(
    "gpt-search",
  );
  await onboardingQuery.locator("summary").click();
  await expect(onboardingQuery).toContainText("gengrowth-browser");
  await expect(
    onboardingQuery
      .locator("dl")
      .locator("div")
      .filter({ hasText: "采集时间" }),
  ).toContainText("2026");
  await expect(onboardingQuery).toContainText(
    "RelayOps appears in the compared onboarding tools.",
  );
  await expect(onboardingQuery).toContainText(
    "Automate customer onboarding handoffs.",
  );
  await expect(onboardingQuery).toContainText(
    "main p:nth-of-type(2)",
  );
  await expect(onboardingQuery).toContainText(
    "被引用与未引用内容的结构差异",
  );
  await expect(onboardingQuery).toContainText(
    "被引用页面使用了明确的产品定义、分步骤流程和可定位的证据段落",
  );
  await expect(onboardingQuery).not.toContainText("不证明该结构导致了引用");
  const inference = onboardingQuery
    .getByText("受限推断", { exact: true })
    .locator("xpath=ancestor::li[1]");
  const limitationDisclosure = inference.getByRole("button", {
    name: "限制说明 (1)",
  });
  await expect(limitationDisclosure).toBeVisible();
  await limitationDisclosure.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "不证明该结构导致了引用",
  );

  const citationLink = onboardingQuery.getByRole("link", {
    name: "打开被引用页面",
  });
  await expect(citationLink).toHaveAttribute(
    "href",
    "https://example.test/customer-onboarding/",
  );
  await expect(citationLink).toHaveAttribute("target", "_blank");
  await expect(citationLink).toHaveAttribute(
    "rel",
    "noreferrer noopener",
  );

  await pricing.click();
  await expect(pricing).toHaveAttribute("aria-pressed", "true");
  await expect(
    panel.getByRole("heading", { name: "/pricing/", level: 2 }),
  ).toBeVisible();
  await expect(geo.getByText("当前固定窗口尚无可验证的查询与引用快照。")).toHaveCount(
    2,
  );
  await expect(citationsRow).toContainText("不可用");
  await expect(citationsRow).not.toContainText("0");
  await expect(
    geo.getByText("best customer onboarding software"),
  ).toHaveCount(0);
  await expect(
    geo.getByText("RelayOps appears in the compared onboarding tools."),
  ).toHaveCount(0);

  expect(state.geoCitationReads).toEqual([
    "20000000-0000-4000-8000-000000000101",
    "20000000-0000-4000-8000-000000000201",
  ]);
});
