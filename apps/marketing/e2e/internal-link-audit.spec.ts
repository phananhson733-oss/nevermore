import { expect, test } from "@playwright/test";

const auditResponse = {
  data: {
    run: { tool: "internal_link_audit", schemaVersion: "internal_link_audit.v1", mode: "public_preview", scope: "bounded_same_origin_static_html_crawl", persistence: "none", completedAt: "2026-07-30T09:00:00.000Z" },
    result: {
      targetUrl: "https://acme.com/", availability: "partial", stopReason: "max_urls", limitation: "Coverage is partial after the 25-page safety budget.", pagesCrawled: 25, maxPages: 25, linksObserved: 71, sitemapFetched: true, sitemapUrlsObserved: 32,
      nodes: [
        { id: "page-01", url: "https://acme.com/", title: "Acme", depth: 0, inboundLinks: 0, outboundLinks: 4, statusCode: 200, sitemapMember: true, kind: "home" },
        { id: "page-02", url: "https://acme.com/orphan", title: "Orphan", depth: 1, inboundLinks: 0, outboundLinks: 1, statusCode: 200, sitemapMember: true, kind: "orphan_candidate" },
      ],
      edges: [{ from: "page-01", to: "page-02", anchorText: "Guide" }],
      findings: [{ id: "orphan-page-02", priority: "P1", kind: "orphan_candidate", nodeId: "page-02", title: "/orphan is a sitemap-only orphan candidate", detail: "No crawled HTML page linked to it.", evidence: "0 observed inbound HTML links.", limitation: "Coverage is partial, so this is a candidate rather than a definitive orphan.", suggestedSourceUrl: "https://acme.com/", observedAnchorText: "Guide" }],
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
  await expect(page.getByText("25/25", { exact: true })).toBeVisible();
  await expect(page.getByText("71", { exact: true })).toBeVisible();
  await expect(page.getByTestId("internal-link-graph")).toBeVisible();
  await page.getByTestId("internal-link-finding-orphan-page-02").click();
  const detail = page.getByTestId("internal-link-node-detail");
  await expect(detail.getByText("/orphan", { exact: true })).toBeVisible();
  await expect(detail.getByText("0 observed inbound HTML links.", { exact: true })).toBeVisible();
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
