import { expect, test } from "@playwright/test";

const auditResponse = {
  data: {
    run: { tool: "internal_link_audit", schemaVersion: "internal_link_audit.v3", mode: "public_preview", scope: "bounded_same_origin_static_html_crawl", persistence: "none", completedAt: "2026-07-30T09:00:00.000Z" },
    result: {
      targetUrl: "https://acme.com/", availability: "partial", stopReason: "max_requests", limitation: "Coverage is partial after an online processing boundary.", pagesCrawled: 4, linksObserved: 3, sitemapFetched: true, sitemapUrlsObserved: 32, actionablePages: 1,
      clickDepthDistribution: { oneClick: 2, twoClicks: 0, threeClicks: 0, fourPlusClicks: 0, unreachable: 1 },
      nodes: [
        { id: "page-01", url: "https://acme.com/", title: "Acme", crawlDepth: 0, clickDepth: 0, primaryParentId: null, inboundLinks: 0, outboundLinks: 2, statusCode: 200, sitemapMember: true, robotsIndexable: true, canonicalTarget: null, kind: "home" },
        { id: "page-02", url: "https://acme.com/guide", title: "Guide", crawlDepth: 1, clickDepth: 1, primaryParentId: "page-01", inboundLinks: 1, outboundLinks: 1, statusCode: 200, sitemapMember: true, robotsIndexable: true, canonicalTarget: null, kind: "page" },
        { id: "page-03", url: "https://acme.com/guide/article", title: "Article", crawlDepth: 2, clickDepth: 1, primaryParentId: "page-01", inboundLinks: 2, outboundLinks: 0, statusCode: 200, sitemapMember: true, robotsIndexable: true, canonicalTarget: null, kind: "page" },
        { id: "page-04", url: "https://acme.com/orphan", title: "Orphan", crawlDepth: 1, clickDepth: null, primaryParentId: null, inboundLinks: 0, outboundLinks: 0, statusCode: 200, sitemapMember: true, robotsIndexable: true, canonicalTarget: null, kind: "orphan_undetermined" },
      ],
      edges: [
        { from: "page-01", to: "page-02", anchorText: "Guide" },
        { from: "page-02", to: "page-03", anchorText: "Article" },
        { from: "page-01", to: "page-03", anchorText: "Featured article" },
      ],
      findings: [
        { id: "orphan-pages", priority: "P2", confidence: "low", impact: "high", kind: "orphan_undetermined", nodeId: "page-04", nodeIds: ["page-04"], affectedUrls: ["https://acme.com/orphan"], title: "1 sitemap page could not be checked for inbound links", detail: "No collected HTML page linked to it, but this crawl stopped early.", evidence: "0 observed inbound HTML links.", limitation: "Complete the crawl before treating it as an orphan.", suggestedSourceUrl: null, observedAnchorText: null },
        { id: "unresolved-targets", priority: "P2", confidence: "low", impact: "medium", kind: "unresolved_target", nodeId: "page-01", nodeIds: ["page-01"], affectedUrls: ["https://acme.com/pricing", "https://acme.com/terms"], title: "2 internal targets could not be verified", detail: "The targets /pricing and /terms were not collected in this bounded crawl.", evidence: "Observed source: /; anchors: Pricing and Terms.", limitation: "The targets may be outside the crawl budget.", suggestedSourceUrl: "https://acme.com/", observedAnchorText: "Pricing" },
      ],
    },
  },
};

const deepAuditResponse = {
  data: {
    run: auditResponse.data.run,
    result: {
      ...auditResponse.data.result,
      pagesCrawled: 31,
      linksObserved: 30,
      actionablePages: 0,
      clickDepthDistribution: { oneClick: 1, twoClicks: 1, threeClicks: 1, fourPlusClicks: 27, unreachable: 0 },
      nodes: Array.from({ length: 31 }, (_, index) => ({
        id: `deep-${index}`,
        url:
          index === 0
            ? "https://acme.com/"
            : `https://acme.com/${Array.from(
                { length: index },
                (__, segment) => `level-${segment + 1}`,
              ).join("/")}`,
        title: index === 0 ? "Acme" : `Level ${index}`,
        crawlDepth: index,
        clickDepth: index,
        primaryParentId: index === 0 ? null : `deep-${index - 1}`,
        inboundLinks: index === 0 ? 0 : 1,
        outboundLinks: index === 30 ? 0 : 1,
        statusCode: 200,
        sitemapMember: true,
        robotsIndexable: true,
        canonicalTarget: null,
        kind: index === 0 ? "home" : "page",
      })),
      edges: Array.from({ length: 30 }, (_, index) => ({
        from: `deep-${index}`,
        to: `deep-${index + 1}`,
        anchorText: `Level ${index + 1}`,
      })),
      findings: [],
    },
  },
};

test("submits the audit request and renders a synchronous API response", async ({ page }) => {
  let requestedBody: unknown;
  await page.route("**/api/tools/internal-link-audit", async (route) => {
    requestedBody = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(auditResponse) });
  });
  await page.goto("/tools/internal-link-audit");
  await expect(page.getByRole("heading", { level: 1, name: "Internal Link Audit" })).toBeVisible();
  await expect(page.getByText("MOCK DATA.", { exact: true })).toHaveCount(0);
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Report ready · partial coverage" })).toBeVisible();
  expect(requestedBody).toEqual({ url: "acme.com" });
  await expect(
    page.getByText(
      "Collected 4 page(s) before this online run reached a processing boundary. You can review the available evidence, but it does not represent complete site coverage.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Request limit reached", { exact: true })).toBeVisible();
  await expect(page.getByText("stop: max_requests", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Coverage is partial after an online processing boundary.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByTestId("internal-link-pages-collected")).toHaveText("4");
  await expect(page.getByText("Up to 25 pages", { exact: false })).toHaveCount(0);
  const tree = page.getByTestId("internal-link-tree");
  const treeRows = tree.locator('button[data-testid^="internal-link-node-"]');
  await expect(tree).toBeVisible();
  await page.getByRole("button", { name: "All pages", exact: true }).click();
  await expect(treeRows).toHaveCount(4);
  await expect(page.getByText("Outside the main hierarchy", { exact: true })).toBeVisible();
  await expect(page.getByTestId("internal-link-node-page-03")).toHaveAccessibleName(
    /\/guide\/article.*1 other mapped inbound link.*Inbound 2.*Outbound 0.*Homepage clicks 1/,
  );
  const detail = page.getByTestId("internal-link-node-detail");
  await expect(
    detail.getByText("The targets /pricing and /terms were not collected in this bounded crawl.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    detail.getByText("The target may be outside the crawl budget.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await detail.getByRole("button", { name: "Interpretation limit (1)" }).click();
  await expect(
    page.getByRole("tooltip").getByText(
      "The target may be outside the crawl budget.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  const treeSearch = page.getByRole("searchbox", { name: "Find a page in this crawl" });
  await treeSearch.fill("article");
  await expect(treeRows).toHaveCount(2);
  await expect(page.getByText("1/4 pages match", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Collapse branch: /" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Expand all", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Collapse all", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Clear tree search" }).click();
  await expect(treeRows).toHaveCount(4);

  await page.getByRole("button", { name: "Collapse branch: /" }).click();
  await expect(treeRows).toHaveCount(2);
  await page.getByRole("button", { name: "Expand branch: /" }).click();
  await expect(treeRows).toHaveCount(4);

  await page.getByTestId("internal-link-node-page-04").click();
  await expect(detail.getByText("/orphan", { exact: true })).toBeVisible();
  await expect(detail.getByText("0 observed inbound HTML links.", { exact: true })).toBeVisible();

  const unresolvedFinding = page.getByTestId("internal-link-finding-unresolved-targets");
  await unresolvedFinding.click();
  await expect(unresolvedFinding).toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByText("The targets /pricing and /terms were not collected in this bounded crawl.", { exact: true })).toBeVisible();
});

test("renders API failures and a responsive localized tool without horizontal overflow", async ({ page }) => {
  await page.route("**/api/tools/internal-link-audit", async (route) => {
    await route.fulfill({
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "42" },
      body: JSON.stringify({ error: { code: "rate_limited" } }),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/zh/tools/internal-link-audit");
  await expect(page.getByRole("heading", { level: 1, name: "内链审计" })).toBeVisible();
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();
  await expect(
    page.getByText(
      "该网络最近已发起多次抓取。每次都会从目标站点获取数百个页面，因此设有每小时上限。 请在 42 秒后重试。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("MOCK DATA.", { exact: true })).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(4);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("renders a touch-friendly crawl tree on mobile without horizontal overflow", async ({ page }) => {
  await page.route("**/api/tools/internal-link-audit", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(deepAuditResponse) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/zh/tools/internal-link-audit");
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();
  await page.getByRole("button", { name: "全部页面", exact: true }).click();

  const tree = page.getByTestId("internal-link-tree");
  await expect(tree).toBeVisible();
  await expect(page.getByTestId("internal-link-pages-collected")).toHaveText("31");
  await expect(page.getByText("已达到请求次数上限", { exact: true })).toBeVisible();
  await expect(page.getByText("31/25", { exact: true })).toHaveCount(0);
  await expect(page.getByText("网站页面层级树", { exact: true })).toBeVisible();
  const firstTreeRow = page.getByTestId("internal-link-node-deep-0");
  await expect(firstTreeRow).toBeVisible();
  const rowBox = await firstTreeRow.boundingBox();
  expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(56);
  const deepestTreeRow = page.getByTestId("internal-link-node-deep-30");
  await expect(deepestTreeRow).toBeVisible();
  const deepestBox = await deepestTreeRow.boundingBox();
  expect(deepestBox?.width ?? 0).toBeGreaterThanOrEqual(160);
  const treeOverflow = await tree.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(treeOverflow).toBe(false);
  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(documentOverflow).toBe(false);
});
