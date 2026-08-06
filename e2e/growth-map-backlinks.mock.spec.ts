import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  GrowthMapBacklinkReadModel,
  type BacklinkSnapshotSource,
  type GrowthMapBacklinkReadModel as GrowthMapBacklinkReadModelDto,
} from "../packages/contracts/src/index.ts";
import {
  E2E_ONBOARDING_SITE_PAGE_ID,
  E2E_PROJECT_ID,
  E2E_SECOND_SITE_PAGE_ID,
  installGrowthVerticalApi,
} from "./mock-api.ts";

const PRIMARY_SNAPSHOT_ID = "91000000-0000-4000-8000-000000000001";
const COMPETITOR_SNAPSHOT_ID =
  "91000000-0000-4000-8000-000000000002";
const FACT_ID = "91000000-0000-4000-8000-000000000003";
const IMPORT_PREVIEW_ID = "91000000-0000-4000-8000-000000000004";

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

async function useEnglishUi(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "en",
      domain: "localhost",
      path: "/",
    },
  ]);
}

function providerSource(
  subjectKind: "primary_site" | "approved_competitor",
): BacklinkSnapshotSource {
  const primary = subjectKind === "primary_site";
  return {
    snapshotId: primary ? PRIMARY_SNAPSHOT_ID : COMPETITOR_SNAPSHOT_ID,
    subjectKind,
    subjectId: primary
      ? "91000000-0000-4000-8000-000000000011"
      : "91000000-0000-4000-8000-000000000012",
    subjectName: primary ? "RelayOps" : "Userpilot",
    domain: primary ? "example.test" : "userpilot.example",
    sourceKind: "provider_import",
    provider: "ahrefs",
    capturedAt: "2026-07-28T00:00:00.000Z",
    coverage: {
      availability: "available",
      indexScope: "provider_index",
      limitations: [],
    },
    backlinks: {
      semantics: "provider_index_total",
      value: primary ? 120 : 940,
    },
    referringDomains: {
      semantics: "provider_index_total",
      value: primary ? 40 : 160,
    },
    authorityMetric: {
      kind: "domain_rating",
      value: primary ? 42 : 68,
    },
    trace: {
      sourceRef: primary
        ? "ahrefs:example.test:2026-07"
        : "ahrefs:userpilot.example:2026-07",
      checksum: (primary ? "a" : "b").repeat(64),
      rowCount: primary ? 120 : 940,
      importPreviewId: null,
    },
  };
}

function providerModel(
  locale: "zh-CN" | "en" = "zh-CN",
): GrowthMapBacklinkReadModelDto {
  const primary = providerSource("primary_site");
  const competitor = providerSource("approved_competitor");
  const opportunityCopy =
    locale === "en"
      ? {
          title:
            "No backlinks are observed for this page by the Provider",
          summary:
            "Ahrefs currently reports zero backlinks and zero referring domains for this exact page.",
        }
      : {
          title: "页面尚无 Provider 观测到的外链",
          summary: "Ahrefs 当前索引中，该页面的外链与引用域均为 0。",
        };
  return GrowthMapBacklinkReadModel.parse({
    projectId: E2E_PROJECT_ID,
    generatedAt: "2026-07-28T01:00:00.000Z",
    coverage: primary.coverage,
    sources: [primary, competitor],
    primarySite: primary,
    approvedCompetitors: [competitor],
    comparison: {
      state: "comparable",
      provider: "ahrefs",
      primarySiteSnapshotId: PRIMARY_SNAPSHOT_ID,
      competitorSnapshotIds: [COMPETITOR_SNAPSHOT_ID],
      limitation: null,
    },
    pages: [
      {
        sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
        canonicalUrl: "https://example.test/customer-onboarding",
        title: "Customer onboarding guide",
        backlinks: { semantics: "provider_index_total", value: 0 },
        referringDomains: {
          semantics: "provider_index_total",
          value: 0,
        },
        snapshotId: PRIMARY_SNAPSHOT_ID,
      },
      {
        sitePageId: E2E_SECOND_SITE_PAGE_ID,
        canonicalUrl: "https://example.test/pricing",
        title: "Pricing overview",
        backlinks: { semantics: "provider_index_total", value: 18 },
        referringDomains: {
          semantics: "provider_index_total",
          value: 11,
        },
        snapshotId: PRIMARY_SNAPSHOT_ID,
      },
    ],
    referringDomains: [
      {
        domain: "example.org",
        observedBacklinks: 2,
        authorityMetric: { kind: "domain_rating", value: 61 },
        topTargetUrl: "https://example.test/customer-onboarding",
        snapshotId: PRIMARY_SNAPSHOT_ID,
        factIds: [FACT_ID],
      },
    ],
    opportunities: [
      {
        opportunityKey: `backlink:page:${E2E_ONBOARDING_SITE_PAGE_ID}:${PRIMARY_SNAPSHOT_ID}`,
        kind: "page_without_provider_backlinks",
        severity: "medium",
        title: opportunityCopy.title,
        summary: opportunityCopy.summary,
        sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
        evidenceSnapshotIds: [PRIMARY_SNAPSHOT_ID],
        executionRef: null,
      },
    ],
  });
}

function observedModel(
  sourceKind: "manual_csv" | "search_derived",
): GrowthMapBacklinkReadModelDto {
  const manual = sourceKind === "manual_csv";
  const limitation = manual
    ? "仅统计本次已导入 CSV 中的可验证记录，不代表完整外链索引。"
    : "Search-derived 仅表示本次已验证发现，不代表完整外链索引。";
  const primary: BacklinkSnapshotSource = {
    snapshotId: PRIMARY_SNAPSHOT_ID,
    subjectKind: "primary_site",
    subjectId: "91000000-0000-4000-8000-000000000011",
    subjectName: "RelayOps",
    domain: "example.test",
    sourceKind,
    provider: sourceKind,
    capturedAt: "2026-07-28T00:00:00.000Z",
    coverage: {
      availability: "partial",
      indexScope: "observed_subset",
      limitations: [limitation],
    },
    backlinks: { semantics: "observed_fact_count", value: 6 },
    referringDomains: { semantics: "observed_fact_count", value: 4 },
    authorityMetric: null,
    trace: {
      sourceRef: manual
        ? "csv:backlinks-july.csv"
        : "search-derived:example.test:2026-07-28",
      checksum: (manual ? "c" : "d").repeat(64),
      rowCount: 6,
      importPreviewId: manual ? IMPORT_PREVIEW_ID : null,
    },
  };
  return GrowthMapBacklinkReadModel.parse({
    projectId: E2E_PROJECT_ID,
    generatedAt: "2026-07-28T01:00:00.000Z",
    coverage: primary.coverage,
    sources: [primary],
    primarySite: primary,
    approvedCompetitors: [],
    comparison: {
      state: "insufficient",
      provider: null,
      primarySiteSnapshotId: null,
      competitorSnapshotIds: [],
      limitation: "没有同一 Provider、相近采集窗口的已批准竞品快照。",
    },
    pages: [
      {
        sitePageId: E2E_ONBOARDING_SITE_PAGE_ID,
        canonicalUrl: "https://example.test/customer-onboarding",
        title: "Customer onboarding guide",
        backlinks: { semantics: "observed_fact_count", value: 4 },
        referringDomains: {
          semantics: "observed_fact_count",
          value: 3,
        },
        snapshotId: PRIMARY_SNAPSHOT_ID,
      },
    ],
    referringDomains: [
      {
        domain: "observed.example",
        observedBacklinks: 2,
        authorityMetric: null,
        topTargetUrl: "https://example.test/customer-onboarding",
        snapshotId: PRIMARY_SNAPSHOT_ID,
        factIds: [FACT_ID],
      },
    ],
    opportunities: [],
  });
}

function unavailableModel(): GrowthMapBacklinkReadModelDto {
  return GrowthMapBacklinkReadModel.parse({
    projectId: E2E_PROJECT_ID,
    generatedAt: "2026-07-28T01:00:00.000Z",
    coverage: {
      availability: "unavailable",
      indexScope: "unavailable",
      limitations: ["尚无可读取的外链数据快照。"],
    },
    sources: [],
    primarySite: null,
    approvedCompetitors: [],
    comparison: {
      state: "unavailable",
      provider: null,
      primarySiteSnapshotId: null,
      competitorSnapshotIds: [],
      limitation: "尚无可读取的外链数据快照。",
    },
    pages: [],
    referringDomains: [],
    opportunities: [],
  });
}

async function installBacklinkResponse(
  page: Page,
  model: GrowthMapBacklinkReadModelDto,
): Promise<void> {
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/audit/backlinks`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: model }),
      });
    },
  );
}

async function blockingAxeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .include("[data-backlink-growth-path]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    )
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}) @ ${violation.nodes
          .flatMap((node) => node.target)
          .join(", ")}`,
    );
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
}

test.beforeEach(async ({ page }) => {
  await useChineseUi(page);
  await installGrowthVerticalApi(page);
});

test("外链增长保持为增长地图内置路径，并可在不同 URL 间反复切换", async ({
  page,
}) => {
  await installBacklinkResponse(page, providerModel());
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map?object=backlinks`);

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
  const backlinks = objectNavigation.getByRole("button", {
    name: /外链增长/,
  });
  await expect(objectNavigation.getByRole("button")).toHaveCount(4);
  await expect(backlinks).toHaveAttribute("aria-pressed", "true");

  const path = page.locator("[data-backlink-growth-path]");
  await expect(
    path.getByRole("heading", {
      name: "看清站外权重从哪里来，以及下一步该补哪里",
    }),
  ).toBeVisible();
  await expect(path.getByText("Provider 索引总量").first()).toBeVisible();
  await expect(path.getByText("Domain Rating").first()).toBeVisible();
  await expect(path.getByText("42", { exact: true })).toBeVisible();
  await expect(path.getByText("与已批准竞品按同口径比较")).toBeVisible();
  await expect(path.getByText("GSC、GA4 与 GitHub")).toBeVisible();
  await expect(path.getByText("审核后进入执行")).toBeVisible();

  await path
    .getByRole("link", { name: /Customer onboarding guide/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
    ),
  );
  await expect(
    page.getByRole("heading", { name: "/customer-onboarding" }),
  ).toBeVisible();

  await backlinks.click();
  await expect(backlinks).toHaveAttribute("aria-pressed", "true");
  await path.getByRole("link", { name: /Pricing overview/ }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `object=pages&selectedSitePageId=${E2E_SECOND_SITE_PAGE_ID}`,
    ),
  );
  await expect(page.getByRole("heading", { name: "/pricing" })).toBeVisible();

  await backlinks.click();
  await path
    .getByRole("link", { name: /Customer onboarding guide/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp(
      `object=pages&selectedSitePageId=${E2E_ONBOARDING_SITE_PAGE_ID}`,
    ),
  );
  await expect(
    page.getByRole("heading", { name: "/customer-onboarding" }),
  ).toBeVisible();
});

for (const sourceKind of ["manual_csv", "search_derived"] as const) {
  test(`${sourceKind} 只呈现已观测子集，不冒充 Provider 总量或 DR`, async ({
    page,
  }) => {
    await installBacklinkResponse(page, observedModel(sourceKind));
    await page.goto(`/p/${E2E_PROJECT_ID}/growth-map?object=backlinks`);

    const path = page.locator("[data-backlink-growth-path]");
    await expect(
      path
        .getByText(
          sourceKind === "manual_csv"
            ? "手动 CSV"
            : "Search-derived 发现",
        )
        .first(),
    ).toBeVisible();
    await expect(path.getByText("本次已发现记录").first()).toBeVisible();
    await expect(path.getByText("Provider 索引总量")).toHaveCount(0);
    await expect(
      path.getByText("仅真实 Provider 数据显示"),
    ).toBeVisible();
    await expect(path.getByText("未提供 DR / DA")).toBeVisible();
    await expect(path).not.toContainText("不代表完整外链索引");
    const limitationDisclosure = path
      .getByRole("button", { name: "数据范围说明 (1)" })
      .first();
    await expect(limitationDisclosure).toBeVisible();
    await limitationDisclosure.hover();
    await expect(
      page.getByRole("tooltip").filter({ hasText: "不代表完整外链索引" }),
    ).toBeVisible();
  });
}

test("缺失快照明确显示不可用，绝不补成零", async ({ page }) => {
  await installBacklinkResponse(page, unavailableModel());
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map?object=backlinks`);

  const path = page.locator("[data-backlink-growth-path]");
  await expect(
    path.getByRole("heading", { name: "还没有可读取的外链证据" }),
  ).toBeVisible();
  await expect(path).not.toContainText("尚无可读取的外链数据快照。");
  const limitationDisclosure = path.getByRole("button", {
    name: "数据范围说明 (1)",
  });
  await expect(limitationDisclosure).toBeVisible();
  await limitationDisclosure.hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "尚无可读取的外链数据快照。",
  );
  await expect(path.getByText("0", { exact: true })).toHaveCount(0);
  await expect(path.getByText("Provider 索引总量")).toHaveCount(0);
});

test("外链路径英文渲染无系统中文泄漏，且桌面与窄屏均通过可访问性检查", async ({
  page,
}) => {
  await useEnglishUi(page);
  await installBacklinkResponse(page, providerModel("en"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map?object=backlinks`);

  const objectNavigation = page.getByRole("navigation", {
    name: "Growth Map objects",
  });
  await expect(objectNavigation.getByRole("button")).toHaveCount(4);
  await expect(
    objectNavigation.getByRole("button", { name: /Backlink growth/ }),
  ).toHaveAttribute("aria-pressed", "true");

  const path = page.locator("[data-backlink-growth-path]");
  await expect(path).toBeVisible();
  await expect(
    path.getByRole("heading", {
      name: "See where off-site authority comes from and what to strengthen next",
    }),
  ).toBeVisible();
  await expect(path.getByText("Provider index total").first()).toBeVisible();
  await expect(
    path.getByRole("heading", {
      name: "No backlinks are observed for this page by the Provider",
    }),
  ).toBeVisible();
  await expect(
    path.getByText(
      "Ahrefs currently reports zero backlinks and zero referring domains for this exact page.",
    ),
  ).toBeVisible();
  await expect(
    path.getByText(
      "Customer-visible connections remain GSC, GA4, and GitHub.",
      { exact: false },
    ),
  ).toBeVisible();
  expect(await path.textContent()).not.toMatch(/[\u3400-\u9fff]/u);
  await expect(page.getByRole("main")).toHaveCount(1);
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(await blockingAxeViolations(page)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-backlink-growth-path]")).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
  expect(await blockingAxeViolations(page)).toEqual([]);
});
