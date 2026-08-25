import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

const AUDIT_API_REQUEST = "POST /api/tools/internal-link-audit";
const HEADER_PROFILE_REQUEST = "GET /api/auth/profile";
const SESSION_REQUEST = "GET /api/auth/session";
const KNOWN_ABORTED_REQUESTS = new Set([
  HEADER_PROFILE_REQUEST,
  SESSION_REQUEST,
]);

interface ApiGuardEvidence {
  auditRequestCount: number;
  readonly blockedRequests: string[];
  readonly unexpectedRequests: string[];
}

async function installApiGuard(
  page: Page,
  fulfillAudit?: (route: Route) => Promise<void>,
): Promise<ApiGuardEvidence> {
  const evidence: ApiGuardEvidence = {
    auditRequestCount: 0,
    blockedRequests: [],
    unexpectedRequests: [],
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const requestId = `${request.method()} ${new URL(request.url()).pathname}`;

    if (requestId === AUDIT_API_REQUEST && fulfillAudit) {
      evidence.auditRequestCount += 1;
      await fulfillAudit(route);
      return;
    }

    evidence.blockedRequests.push(requestId);
    if (!KNOWN_ABORTED_REQUESTS.has(requestId)) {
      evidence.unexpectedRequests.push(requestId);
    }
    await route.abort("blockedbyclient");
  });

  return evidence;
}

async function expectNoUnexpectedApiRequests(
  evidence: ApiGuardEvidence,
  expectedBlockedRequests: readonly string[] = [HEADER_PROFILE_REQUEST],
): Promise<void> {
  await expect
    .poll(() => [...evidence.blockedRequests].sort())
    .toEqual([...expectedBlockedRequests].sort());
  expect(evidence.unexpectedRequests).toEqual([]);
}

const auditResponse = {
  data: {
    run: {
      tool: "internal_link_audit",
      schemaVersion: "internal_link_audit.v3",
      mode: "public_preview",
      scope: "bounded_same_origin_static_html_crawl",
      persistence: "none",
      completedAt: "2026-07-30T09:00:00.000Z",
    },
    result: {
      targetUrl: "https://acme.com/",
      availability: "partial",
      stopReason: "max_requests",
      limitation: "Coverage is partial after an online processing boundary.",
      pagesCrawled: 4,
      linksObserved: 3,
      sitemapFetched: true,
      sitemapUrlsObserved: 32,
      actionablePages: 1,
      clickDepthDistribution: {
        oneClick: 2,
        twoClicks: 0,
        threeClicks: 0,
        fourPlusClicks: 0,
        unreachable: 1,
      },
      nodes: [
        {
          id: "page-01",
          url: "https://acme.com/",
          title: "Acme",
          crawlDepth: 0,
          clickDepth: 0,
          primaryParentId: null,
          inboundLinks: 0,
          outboundLinks: 2,
          statusCode: 200,
          sitemapMember: true,
          robotsIndexable: true,
          canonicalTarget: null,
          kind: "home",
        },
        {
          id: "page-02",
          url: "https://acme.com/guide",
          title: "Guide",
          crawlDepth: 1,
          clickDepth: 1,
          primaryParentId: "page-01",
          inboundLinks: 1,
          outboundLinks: 1,
          statusCode: 200,
          sitemapMember: true,
          robotsIndexable: true,
          canonicalTarget: null,
          kind: "page",
        },
        {
          id: "page-03",
          url: "https://acme.com/guide/article",
          title: "Article",
          crawlDepth: 2,
          clickDepth: 1,
          primaryParentId: "page-01",
          inboundLinks: 2,
          outboundLinks: 0,
          statusCode: 200,
          sitemapMember: true,
          robotsIndexable: true,
          canonicalTarget: null,
          kind: "page",
        },
        {
          id: "page-04",
          url: "https://acme.com/orphan",
          title: "Orphan",
          crawlDepth: 1,
          clickDepth: null,
          primaryParentId: null,
          inboundLinks: 0,
          outboundLinks: 0,
          statusCode: 200,
          sitemapMember: true,
          robotsIndexable: true,
          canonicalTarget: null,
          kind: "orphan_undetermined",
        },
      ],
      edges: [
        { from: "page-01", to: "page-02", anchorText: "Guide" },
        { from: "page-02", to: "page-03", anchorText: "Article" },
        {
          from: "page-01",
          to: "page-03",
          anchorText: "Featured article",
        },
      ],
      findings: [
        {
          id: "orphan-pages",
          priority: "P2",
          confidence: "low",
          impact: "high",
          kind: "orphan_undetermined",
          nodeId: "page-04",
          nodeIds: ["page-04"],
          affectedUrls: ["https://acme.com/orphan"],
          title: "1 sitemap page could not be checked for inbound links",
          detail:
            "No collected HTML page linked to it, but this crawl stopped early.",
          evidence: "0 observed inbound HTML links.",
          limitation: "Complete the crawl before treating it as an orphan.",
          suggestedSourceUrl: null,
          observedAnchorText: null,
        },
        {
          id: "unresolved-targets",
          priority: "P2",
          confidence: "low",
          impact: "medium",
          kind: "unresolved_target",
          nodeId: "page-01",
          nodeIds: ["page-01"],
          affectedUrls: [
            "https://acme.com/pricing",
            "https://acme.com/terms",
          ],
          title: "2 internal targets could not be verified",
          detail:
            "The targets /pricing and /terms were not collected in this bounded crawl.",
          evidence: "Observed source: /; anchors: Pricing and Terms.",
          limitation: "The targets may be outside the crawl budget.",
          suggestedSourceUrl: "https://acme.com/",
          observedAnchorText: "Pricing",
        },
      ],
    },
  },
};

const deepAuditResponse = {
  data: {
    run: auditResponse.data.run,
    result: {
      ...auditResponse.data.result,
      availability: "available",
      stopReason: null,
      limitation: "Bounded same-origin static HTML crawl.",
      pagesCrawled: 31,
      linksObserved: 31,
      actionablePages: 27,
      clickDepthDistribution: {
        oneClick: 1,
        twoClicks: 1,
        threeClicks: 1,
        fourPlusClicks: 27,
        unreachable: 0,
      },
      nodes: Array.from({ length: 31 }, (_, index) => ({
        id: `deep-${index}`,
        url:
          index === 0
            ? "https://acme.com/"
            : `https://acme.com/${Array.from(
                { length: index },
                (__, segment) =>
                  segment === index - 1
                    ? `level-${segment + 1}-with-a-deliberately-long-slug-that-must-wrap-inside-the-mobile-tree`
                    : `level-${segment + 1}`,
              ).join("/")}`,
        title: index === 0 ? "Acme" : `Deep page ${index}`,
        crawlDepth: index,
        clickDepth: index === 30 ? 29 : index,
        primaryParentId: index === 0 ? null : `deep-${index - 1}`,
        inboundLinks: index === 0 ? 0 : index === 30 ? 2 : 1,
        outboundLinks: index === 30 ? 0 : index === 28 ? 2 : 1,
        statusCode: 200,
        sitemapMember: true,
        robotsIndexable: true,
        canonicalTarget: null,
        kind: index === 0 ? "home" : index >= 4 ? "deep" : "page",
      })),
      edges: [
        ...Array.from({ length: 30 }, (_, index) => ({
          from: `deep-${index}`,
          to: `deep-${index + 1}`,
          anchorText: `Level ${index + 1}`,
        })),
        {
          from: "deep-28",
          to: "deep-30",
          anchorText: "Skip to the deepest guide",
        },
      ],
      findings: [
        {
          id: "deep-pages",
          priority: "P2",
          confidence: "high",
          impact: "medium",
          kind: "deep",
          nodeId: "deep-30",
          nodeIds: Array.from({ length: 27 }, (_, index) => `deep-${index + 4}`),
          affectedUrls: [],
          title: "27 pages are at least four clicks from the homepage",
          detail: "The observed HTML-link hierarchy contains a deep branch.",
          evidence: "Observed click depth is four or more for 27 pages.",
          limitation: "This result covers only collected static HTML links.",
          suggestedSourceUrl: null,
          observedAnchorText: null,
        },
      ],
    },
  },
};

test("runs the no-login audit and renders the mocked v3 report", async ({
  page,
}) => {
  let requestedBody: unknown;
  const api = await installApiGuard(page, async (route) => {
    requestedBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(auditResponse),
    });
  });

  await page.goto("/tools/internal-link-audit");
  await expect(
    page.getByRole("heading", { level: 1, name: "Internal Link Audit" }),
  ).toBeVisible();
  await expect(page.getByText(/No login required/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const relatedAuditLink = page.getByRole("link", {
    name: /Website Health Map/,
  });
  await expect(relatedAuditLink).toHaveAttribute("href", "/agents/seo");
  await expect(relatedAuditLink).not.toHaveAttribute(
    "href",
    "/tools/seo-audit",
  );
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Report ready · partial coverage",
    }),
  ).toBeVisible();
  expect(requestedBody).toEqual({ url: "acme.com" });
  await expect(
    page.getByText(/Collected 4 page\(s\).*processing boundary/i),
  ).toBeVisible();
  await expect(
    page.getByText("Request limit reached", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("internal-link-pages-collected")).toHaveText(
    "4",
  );
  await expect(
    page.getByText("Homepage click depth", { exact: true }),
  ).toBeVisible();

  const tree = page.getByTestId("internal-link-tree");
  const treeRows = tree.locator('button[data-testid^="internal-link-node-"]');
  await expect(tree).toBeVisible();
  await page.getByRole("button", { name: "All pages", exact: true }).click();
  await expect(treeRows).toHaveCount(4);
  await expect(
    page.getByText("Outside the main hierarchy", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("internal-link-node-page-03")).toHaveAccessibleName(
    /\/guide\/article.*1 other mapped inbound link.*Inbound 2.*Outbound 0.*Homepage clicks 1/,
  );

  const detail = page.getByTestId("internal-link-node-detail");
  await expect(
    detail.getByText(
      "The targets /pricing and /terms were not collected in this bounded crawl.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    detail.getByText("The targets may be outside the crawl budget.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await detail
    .getByRole("button", { name: "Interpretation limit (1)" })
    .click();
  await expect(
    page
      .getByRole("tooltip")
      .getByText("The targets may be outside the crawl budget.", {
        exact: true,
      }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  const treeSearch = page.getByRole("searchbox", {
    name: "Find a page in this crawl",
  });
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
  await expect(
    detail.getByText("0 observed inbound HTML links.", { exact: true }),
  ).toBeVisible();

  const unresolvedFinding = page.getByTestId(
    "internal-link-finding-unresolved-targets",
  );
  await unresolvedFinding.click();
  await expect(unresolvedFinding).toHaveAttribute("aria-pressed", "true");
  await expect(
    detail.getByText(
      "The targets /pricing and /terms were not collected in this bounded crawl.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("canonicalizes the legacy English URL once and serves the standalone page", async ({
  page,
}) => {
  const api = await installApiGuard(page);

  const response = await page.goto("/en/tools/internal-link-audit");
  expect(response).not.toBeNull();
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/tools\/internal-link-audit$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Internal Link Audit" }),
  ).toBeVisible();

  const redirectRequests: Request[] = [];
  let request: Request | null = response?.request() ?? null;
  while (request) {
    redirectRequests.unshift(request);
    request = request.redirectedFrom();
  }
  expect(
    redirectRequests.map((redirectRequest) => {
      const url = new URL(redirectRequest.url());
      return `${url.pathname}${url.search}`;
    }),
  ).toEqual([
    "/en/tools/internal-link-audit",
    "/tools/internal-link-audit",
  ]);
  const legacyResponse = await redirectRequests[0]?.response();
  expect(legacyResponse).not.toBeNull();
  expect(legacyResponse?.status()).toBe(308);

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://gengrowth.ai/tools/internal-link-audit",
  );
  const jsonLdTypes = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts.flatMap((script) => {
        const data = JSON.parse(script.textContent ?? "{}") as {
          "@type"?: string | string[];
        };
        const type = data["@type"];
        return Array.isArray(type) ? type : type ? [type] : [];
      }),
    );
  expect(jsonLdTypes).toEqual(
    expect.arrayContaining([
      "BreadcrumbList",
      "HowTo",
      "FAQPage",
      "WebApplication",
    ]),
  );

  expect(api.auditRequestCount).toBe(0);
  await expectNoUnexpectedApiRequests(api);
});

test("renders a localized API failure at 390px without horizontal overflow", async ({
  page,
}) => {
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "42" },
      body: JSON.stringify({ error: { code: "rate_limited" } }),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/zh/tools/internal-link-audit");
  await expect(
    page.getByRole("heading", { level: 1, name: "内链审计" }),
  ).toBeVisible();
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();
  const rateError = page
    .getByTestId("internal-link-audit-tool")
    .getByRole("alert");
  await expect(rateError).toContainText("该网络最近已发起多次抓取");
  await expect(rateError).toContainText(/42\s*秒后重试/);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
    document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("renders a deep mocked v3 report at 390px without horizontal overflow", async ({
  page,
}) => {
  let requestedBody: unknown;
  const api = await installApiGuard(page, async (route) => {
    requestedBody = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(deepAuditResponse),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/zh/tools/internal-link-audit");
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "报告已生成" }),
  ).toBeVisible();
  expect(requestedBody).toEqual({ url: "acme.com" });
  await page.getByRole("button", { name: "全部页面", exact: true }).click();

  const tree = page.getByTestId("internal-link-tree");
  await expect(tree).toBeVisible();
  await expect(page.getByTestId("internal-link-pages-collected")).toHaveText(
    "31",
  );
  await expect(
    page.getByText("网站页面层级树", { exact: true }),
  ).toBeVisible();

  const deepestTreeRow = page.getByTestId("internal-link-node-deep-30");
  await expect(deepestTreeRow).toBeVisible();
  await expect(
    deepestTreeRow.locator(
      'strong[title*="level-30-with-a-deliberately-long-slug"]',
    ),
  ).toBeVisible();
  await expect(
    deepestTreeRow.getByText("深层页面", { exact: true }),
  ).toBeVisible();
  await expect(
    deepestTreeRow.locator('[title="1 条其他已映射入链"]'),
  ).toBeVisible();
  const deepestBox = await deepestTreeRow.boundingBox();
  expect(deepestBox?.height ?? 0).toBeGreaterThanOrEqual(56);

  const treeOverflow = await tree.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(treeOverflow).toBe(false);
  const documentOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(documentOverflow).toBe(false);
  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("keeps the Chinese Internal Link Audit in Tools rather than Agents", async ({
  page,
}) => {
  const api = await installApiGuard(page);
  await page.goto("/zh/");
  const primary = page.getByRole("navigation", { name: "Main navigation" });
  await primary.getByRole("button", { name: "Agents" }).click();

  await expect(
    primary.getByRole("link", { name: /内链审计/ }),
  ).toHaveCount(0);

  await primary.getByRole("button", { name: "资源" }).click();
  const toolsLink = primary.getByRole("link", { name: /^Tools/ });
  await expect(toolsLink).toBeVisible();
  await expect(toolsLink).toHaveAttribute("href", "/zh/tools");
  await toolsLink.click();
  await expect(page).toHaveURL(/\/zh\/tools$/);

  const auditLink = page
    .getByRole("main")
    .getByRole("link")
    .filter({
      has: page.getByRole("heading", { level: 3, name: "内链审计" }),
    });
  await expect(auditLink).toBeVisible();
  await expect(auditLink).toHaveAttribute(
    "href",
    "/zh/tools/internal-link-audit",
  );
  await auditLink.click();
  await expect(page).toHaveURL(/\/zh\/tools\/internal-link-audit$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "内链审计" }),
  ).toBeVisible();
  expect(api.auditRequestCount).toBe(0);
  await expectNoUnexpectedApiRequests(api, [
    HEADER_PROFILE_REQUEST,
    SESSION_REQUEST,
    SESSION_REQUEST,
  ]);
});
