import { expect, test, type Page } from "@playwright/test";
import {
  E2E_CANONICAL_ACTION_ID,
  E2E_CONTENT_FINDING_ID,
  E2E_ONBOARDING_SITE_PAGE_ID,
  E2E_PROJECT_ID,
  E2E_SECOND_SITE_PAGE_ID,
  growthInternalLinkMapFixture,
  installGrowthVerticalApi,
  type GrowthVerticalApiState,
} from "./mock-api.ts";

async function useChineseUi(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "zh-CN",
      domain: "localhost",
      path: "/",
    },
  ]);
}

async function selectUrl(page: Page, path: string): Promise<void> {
  await page
    .getByRole("button")
    .filter({ hasText: path })
    .first()
    .click();
}

let api: GrowthVerticalApiState;

test.beforeEach(async ({ page }) => {
  await useChineseUi(page);
  api = await installGrowthVerticalApi(page);
});

test("keeps Internal Link Map inside the existing URL detail and refreshes it on every URL selection", async ({
  page,
}) => {
  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
  );

  const workspaceNavigation = page.getByRole("navigation", {
    name: "项目分区",
  });
  await expect(workspaceNavigation.getByRole("link")).toHaveCount(4);
  await expect(workspaceNavigation).toContainText("概览");
  await expect(workspaceNavigation).toContainText("增长地图");
  await expect(workspaceNavigation).toContainText("执行中心");
  await expect(workspaceNavigation).toContainText("效果追踪");

  const objectNavigation = page.getByRole("navigation", {
    name: "增长地图对象",
  });
  await expect(
    objectNavigation.getByRole("button", { name: /页面与机会/ }),
  ).toBeVisible();
  await expect(
    objectNavigation.getByRole("button", { name: /关键词库/ }),
  ).toBeVisible();
  await expect(
    objectNavigation.getByRole("button", { name: /竞品库/ }),
  ).toBeVisible();
  await expect(
    objectNavigation.getByRole("button", { name: /内链地图/ }),
  ).toHaveCount(0);

  const linkMap = page.locator("[data-internal-link-map]");
  await expect(linkMap).toHaveAttribute(
    "data-site-page-id",
    E2E_ONBOARDING_SITE_PAGE_ID,
  );
  await expect(linkMap).toHaveAttribute("data-link-map-state", "ready");
  await expect(
    linkMap.getByRole("heading", { name: "内链地图" }),
  ).toBeVisible();
  await expect(linkMap.getByText("站点页面节点")).toBeVisible();
  await expect(linkMap.getByText("已观测有向边")).toBeVisible();

  const inbound = linkMap.getByRole("list", {
    name: "当前 URL 的真实入链来源",
  });
  await expect(inbound).toContainText("/pricing");
  await expect(inbound).toContainText("锚文本：Customer onboarding");
  const onboardingRecommendation = linkMap
    .locator("[data-link-recommendation]")
    .first();
  await expect(onboardingRecommendation).toContainText("/resources");
  await expect(onboardingRecommendation).toContainText(
    "/customer-onboarding",
  );
  await expect(onboardingRecommendation).toContainText("Finding");
  await expect(
    onboardingRecommendation.getByRole("link", { name: /打开 Action/ }),
  ).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/execution?actionId=${E2E_CANONICAL_ACTION_ID}`,
  );

  await selectUrl(page, "/pricing");
  await expect(page).toHaveURL(
    new RegExp(`selectedSitePageId=${E2E_SECOND_SITE_PAGE_ID}`),
  );
  await expect(page.getByRole("heading", { name: "/pricing" })).toBeVisible();
  await expect(linkMap).toHaveAttribute(
    "data-site-page-id",
    E2E_SECOND_SITE_PAGE_ID,
  );
  await expect(linkMap).toHaveAttribute("data-link-map-state", "ready");
  await expect(
    linkMap.getByText("完整 Crawl 中未观察到任何入链。"),
  ).toBeVisible();
  const pricingRecommendation = linkMap
    .locator("[data-link-recommendation]")
    .first();
  await expect(pricingRecommendation).toContainText("/customer-onboarding");
  await expect(pricingRecommendation).toContainText("/pricing");

  // Repeat the round trip: selection is not a one-shot interaction. Every
  // reactivated exact SitePage re-reads its live Finding/Action references.
  await selectUrl(page, "/customer-onboarding");
  await expect(linkMap).toHaveAttribute(
    "data-site-page-id",
    E2E_ONBOARDING_SITE_PAGE_ID,
  );
  await expect(linkMap.getByText("锚文本：Customer onboarding")).toBeVisible();
  await selectUrl(page, "/pricing");
  await expect(linkMap).toHaveAttribute(
    "data-site-page-id",
    E2E_SECOND_SITE_PAGE_ID,
  );
  await expect(
    linkMap.getByText("完整 Crawl 中未观察到任何入链。"),
  ).toBeVisible();

  await expect.poll(() => api.internalLinkMapReads).toEqual([
    E2E_ONBOARDING_SITE_PAGE_ID,
    E2E_SECOND_SITE_PAGE_ID,
    E2E_ONBOARDING_SITE_PAGE_ID,
    E2E_SECOND_SITE_PAGE_ID,
  ]);
});

test("补链建议通过现有 Finding 审核生成任务，不绕过客户确认", async ({
  page,
}) => {
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/audit/internal-link-map**`,
    async (route) => {
      const sitePageId = new URL(route.request().url()).searchParams.get(
        "sitePageId",
      );
      if (sitePageId !== E2E_ONBOARDING_SITE_PAGE_ID) {
        await route.fallback();
        return;
      }
      const fixture = growthInternalLinkMapFixture(sitePageId);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            ...fixture,
            graph: {
              ...fixture.graph,
              nodes: fixture.graph.nodes.map((node) =>
                node.sitePageIds.includes(E2E_ONBOARDING_SITE_PAGE_ID)
                  ? {
                      ...node,
                      executionRefs: [
                        {
                          findingId: E2E_CONTENT_FINDING_ID,
                          actionId: null,
                        },
                      ],
                    }
                  : node,
              ),
            },
          },
        }),
      });
    },
  );

  await page.goto(
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
  );

  const recommendation = page
    .locator("[data-link-recommendation]")
    .first();
  const reviewLink = recommendation.getByRole("link", {
    name: "审核后生成补链任务",
  });
  await expect(reviewLink).toBeVisible();
  await reviewLink.click();

  await expect(page).toHaveURL(
    new RegExp(`findingId=${E2E_CONTENT_FINDING_ID}`),
  );
  const review = page.locator(
    `[data-finding-review="${E2E_CONTENT_FINDING_ID}"]`,
  );
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => api.findingReviewRequests).toContainEqual({
    findingId: E2E_CONTENT_FINDING_ID,
    body: {
      reviewState: "confirmed",
      baseRevision: 0,
    },
  });
});
