import { expect, test } from "@playwright/test";

const auditResponse = {
  data: {
    run: { tool: "internal_link_audit", schemaVersion: "internal_link_audit.v1", mode: "public_preview", scope: "bounded_same_origin_static_html_crawl", persistence: "none", completedAt: "2026-07-30T09:00:00.000Z" },
    result: {
      targetUrl: "https://acme.com/", availability: "partial", stopReason: "max_urls", limitation: "Coverage is partial after the 25-page safety budget.", pagesCrawled: 4, maxPages: 25, linksObserved: 3, sitemapFetched: true, sitemapUrlsObserved: 32,
      nodes: [
        { id: "page-01", url: "https://acme.com/", title: "Acme", depth: 0, inboundLinks: 0, outboundLinks: 2, statusCode: 200, sitemapMember: true, kind: "home" },
        { id: "page-02", url: "https://acme.com/guide", title: "Guide", depth: 1, inboundLinks: 1, outboundLinks: 1, statusCode: 200, sitemapMember: true, kind: "page" },
        { id: "page-03", url: "https://acme.com/guide/article", title: "Article", depth: 2, inboundLinks: 2, outboundLinks: 0, statusCode: 200, sitemapMember: true, kind: "page" },
        { id: "page-04", url: "https://acme.com/orphan", title: "Orphan", depth: 1, inboundLinks: 0, outboundLinks: 0, statusCode: 200, sitemapMember: true, kind: "orphan_candidate" },
      ],
      edges: [
        { from: "page-01", to: "page-02", anchorText: "Guide" },
        { from: "page-02", to: "page-03", anchorText: "Article" },
        { from: "page-01", to: "page-03", anchorText: "Featured article" },
      ],
      findings: [
        { id: "orphan-page-04", priority: "P1", kind: "orphan_candidate", nodeId: "page-04", title: "/orphan is a sitemap-only orphan candidate", detail: "No crawled HTML page linked to it.", evidence: "0 observed inbound HTML links.", limitation: "Coverage is partial, so this is a candidate rather than a definitive orphan.", suggestedSourceUrl: null, observedAnchorText: null },
        { id: "unresolved-pricing", priority: "P2", kind: "unresolved_target", nodeId: "page-01", title: "/ links to an unverified target", detail: "The target /pricing was not collected in this bounded crawl.", evidence: "Observed source: /; anchor: Pricing.", limitation: "The target may be outside the crawl budget.", suggestedSourceUrl: "https://acme.com/", observedAnchorText: "Pricing" },
        { id: "unresolved-terms", priority: "P2", kind: "unresolved_target", nodeId: "page-01", title: "/ links to an unverified target", detail: "The target /terms was not collected in this bounded crawl.", evidence: "Observed source: /; anchor: Terms.", limitation: "The target may be outside the crawl budget.", suggestedSourceUrl: "https://acme.com/", observedAnchorText: "Terms" },
      ],
    },
  },
};

test("submits the audit request and renders a bounded API response", async ({ page }) => {
  let requestedBody: unknown;
  await page.route("**/api/tools/internal-link-audit", async (route) => {
    requestedBody = route.request().postDataJSON();
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(auditResponse) });
  });
  await page.goto("/en/tools/internal-link-audit");
  await expect(page.getByRole("heading", { level: 1, name: "Internal Link Audit" })).toBeVisible();
  await expect(page.getByText("MOCK DATA.", { exact: true })).toHaveCount(0);
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Partial coverage" })).toBeVisible();
  expect(requestedBody).toEqual({ url: "acme.com" });
  await expect(
    page.getByText(
      "Collected 4 page(s) before the 25-page safety budget was reached. You can review the available results, but they do not represent complete site coverage.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("Page limit reached", { exact: true })).toBeVisible();
  await expect(page.getByText("stop: max_urls", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Coverage is partial after the 25-page safety budget.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("4/25", { exact: true })).toBeVisible();
  const tree = page.getByTestId("internal-link-tree");
  const treeRows = tree.locator('button[data-testid^="internal-link-node-"]');
  await expect(tree).toBeVisible();
  await expect(treeRows).toHaveCount(4);
  await expect(tree.getByText("URL path", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Outside the main hierarchy", { exact: true })).toBeVisible();
  await expect(page.getByText("1 additional observed inbound link(s)", { exact: true })).toBeVisible();
  await expect(page.getByTestId("internal-link-node-page-03")).toHaveAccessibleName(
    /\/guide\/article.*URL path.*Crawl depth 2.*Inbound 2.*Outbound 0.*1 additional observed inbound link/,
  );
  const detail = page.getByTestId("internal-link-node-detail");
  await expect(
    detail.getByText("The target /pricing was not collected in this bounded crawl.", {
      exact: true,
    }),
  ).toBeVisible();

  const treeSearch = page.getByRole("searchbox", { name: "Find a page in this crawl" });
  await treeSearch.fill("article");
  await expect(treeRows).toHaveCount(3);
  await expect(page.getByText("3 pages shown", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear tree search" }).click();
  await expect(treeRows).toHaveCount(4);

  await page.getByTestId("internal-link-node-page-04").click();
  await expect(detail.getByText("/orphan", { exact: true })).toBeVisible();
  await expect(detail.getByText("0 observed inbound HTML links.", { exact: true })).toBeVisible();

  const pricingFinding = page.getByTestId("internal-link-finding-unresolved-pricing");
  const termsFinding = page.getByTestId("internal-link-finding-unresolved-terms");
  await pricingFinding.click();
  await expect(pricingFinding).toHaveAttribute("aria-pressed", "true");
  await expect(termsFinding).toHaveAttribute("aria-pressed", "false");
  await expect(detail.getByText("The target /pricing was not collected in this bounded crawl.", { exact: true })).toBeVisible();
});

test("renders API failures and a responsive localized tool without horizontal overflow", async ({ page }) => {
  await page.route("**/api/tools/internal-link-audit", async (route) => {
    await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "rate_limited" } }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/zh/tools/internal-link-audit");
  await expect(page.getByRole("heading", { level: 1, name: "内链审计" })).toBeVisible();
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();
  await expect(page.getByText("公开预览有频率限制，请稍后再试。", { exact: true })).toBeVisible();
  await expect(page.getByText("MOCK DATA.", { exact: true })).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(4);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("renders a touch-friendly crawl tree on mobile without horizontal overflow", async ({ page }) => {
  await page.route("**/api/tools/internal-link-audit", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(auditResponse) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/zh/tools/internal-link-audit");
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();

  const tree = page.getByTestId("internal-link-tree");
  await expect(tree).toBeVisible();
  await expect(
    page.getByText(
      "本次已采集 4 个页面；达到 25 页安全预算后停止。当前结果可继续查看，但不能代表整站完整覆盖。",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("已达到页面数量上限", { exact: true })).toBeVisible();
  await expect(page.getByText("网站页面层级树", { exact: true })).toBeVisible();
  const firstTreeRow = page.getByTestId("internal-link-node-page-01");
  await expect(firstTreeRow).toBeVisible();
  const rowBox = await firstTreeRow.boundingBox();
  expect(rowBox?.height ?? 0).toBeGreaterThanOrEqual(56);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
