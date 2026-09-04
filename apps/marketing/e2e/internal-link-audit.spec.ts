import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
          kind: "deep_page",
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

const designScalePaths = [
  "/templates/marketing",
  "/templates/sales",
  "/blog/internal-linking",
  "/help/importing-data",
  "/guides/api-migration",
  "/zh/guides/api-migration",
  "/integrations/notion",
  "/integrations/zapier",
  "/zh/integrations/notion",
  ...Array.from({ length: 16 }, (_, index) => `/unmarked/page-${index + 1}`),
];

const designScaleAuditResponse = {
  data: {
    run: auditResponse.data.run,
    result: {
      ...auditResponse.data.result,
      availability: "available",
      stopReason: null,
      limitation: "Bounded same-origin static HTML crawl.",
      pagesCrawled: 25,
      linksObserved: 79,
      sitemapFetched: true,
      sitemapUrlsObserved: 22,
      actionablePages: 9,
      nodes: designScalePaths.map((path, index) => {
        const isOrphan = index >= 6 && index <= 8;
        const isDeep = index === 4 || index === 5;
        return {
          id: `design-${index}`,
          url: `https://acme.com${path}`,
          title: `Page ${index + 1}`,
          crawlDepth: isDeep ? 4 : 1,
          clickDepth: isOrphan ? null : isDeep ? 4 : 1,
          primaryParentId: isOrphan ? null : "design-9",
          inboundLinks: isOrphan ? 0 : index === 2 || index === 3 ? 1 : 2,
          outboundLinks: index % 3,
          statusCode: 200,
          sitemapMember: true,
          robotsIndexable: true,
          canonicalTarget: `https://acme.com${path}`,
          kind: isOrphan ? "orphan_candidate" : isDeep ? "deep" : "page",
        };
      }),
      edges: [],
      findings: [
        {
          id: "design-duplicate",
          priority: "P2",
          confidence: "high",
          impact: "medium",
          kind: "duplicate_content",
          nodeId: "design-0",
          nodeIds: ["design-0", "design-1"],
          affectedUrls: [
            "https://acme.com/templates/marketing",
            "https://acme.com/templates/sales",
          ],
          title: "Two template pages share a projected fingerprint",
          detail: "The bounded static projections matched.",
          evidence: "Matched title, headings, body, and link targets.",
          limitation: "This is a candidate, not a redirect instruction.",
          suggestedSourceUrl: null,
          observedAnchorText: null,
        },
        {
          id: "design-low-inbound",
          priority: "P2",
          confidence: "high",
          impact: "medium",
          kind: "low_inbound",
          nodeId: "design-2",
          nodeIds: ["design-2", "design-3"],
          affectedUrls: [
            "https://acme.com/blog/internal-linking",
            "https://acme.com/help/importing-data",
          ],
          title: "Two pages have one observed inbound link",
          detail: "Each page has one observed inbound HTML link.",
          evidence: "Observed inboundLinks=1.",
          limitation: "Inbound count does not prove business value.",
          suggestedSourceUrl: "https://acme.com/blog",
          observedAnchorText: "Internal linking guide",
        },
        {
          id: "design-deep",
          priority: "P1",
          confidence: "high",
          impact: "high",
          kind: "deep_page",
          nodeId: "design-4",
          nodeIds: ["design-4", "design-5"],
          affectedUrls: [
            "https://acme.com/guides/api-migration",
            "https://acme.com/zh/guides/api-migration",
          ],
          title: "Two migration guides require four homepage clicks",
          detail: "Both pages have clickDepth=4.",
          evidence: "Homepage BFS found a four-click path.",
          limitation: "Click depth is not a ranking prediction.",
          suggestedSourceUrl: "https://acme.com/product",
          observedAnchorText: "Migration guide",
        },
        {
          id: "design-orphan",
          priority: "P1",
          confidence: "high",
          impact: "high",
          kind: "orphan_candidate",
          nodeId: "design-6",
          nodeIds: ["design-6", "design-7", "design-8"],
          affectedUrls: [
            "https://acme.com/integrations/notion",
            "https://acme.com/integrations/zapier",
            "https://acme.com/zh/integrations/notion",
          ],
          title: "Three Sitemap URLs have no observed inbound link",
          detail: "No observed homepage path reached these pages.",
          evidence: "inboundLinks=0 and clickDepth=null.",
          limitation: "JavaScript-only links were not evaluated.",
          suggestedSourceUrl: "https://acme.com/integrations",
          observedAnchorText: null,
        },
        {
          id: "design-unresolved",
          priority: "P2",
          confidence: "low",
          impact: "medium",
          kind: "unresolved_target",
          nodeId: "design-3",
          nodeIds: ["design-3", "design-4"],
          affectedUrls: [
            "https://acme.com/docs/legacy-importer",
            "https://acme.com/webinars/automation-clinic",
          ],
          title: "Two observed targets were not collected",
          detail: "The report exposes target and source sets, not pairs.",
          evidence: "Two targets are outside the collected node set.",
          limitation: "Unresolved does not mean broken.",
          suggestedSourceUrl: "https://acme.com/help/importing-data",
          observedAnchorText: "Legacy importer",
        },
      ],
    },
  },
};

test("renders the completed report as one URL ledger with one AI handoff", async ({
  page,
}) => {
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(auditResponse),
    });
  });

  await page.goto("/tools/internal-link-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();

  const result = page.getByTestId("internal-link-audit-result");
  const table = result.getByRole("table", {
    name: "Collected URLs and their observed internal-link state",
  });
  await expect(table).toHaveCount(1);
  await expect(table.getByRole("columnheader")).toHaveCount(6);
  await expect(result.getByTestId("internal-link-problem-group")).toHaveAttribute(
    "aria-label",
    "URLs linked to findings",
  );
  await expect(result.getByTestId("internal-link-unmarked-group")).toHaveAttribute(
    "aria-label",
    "URLs not linked to findings",
  );
  await expect(result.getByTestId("internal-link-copy-ai")).toHaveCount(1);
  await expect(result.getByTestId("internal-link-problem-row")).toHaveCount(2);
  await expect(result.getByTestId("internal-link-unmarked-row")).toHaveCount(2);
  await expect(result.getByTestId("internal-link-url-path")).toHaveText([
    "/",
    "/orphan",
    "/guide",
    "/guide/article",
  ]);
  const unresolvedOnlyRow = result.getByTestId("internal-link-problem-row").first();
  await expect(unresolvedOnlyRow).toHaveAttribute("data-tone", "info");
  await expect(unresolvedOnlyRow.locator("td").first()).toHaveClass(
    /border-l-dashed/,
  );
  await expect(
    unresolvedOnlyRow.locator('[data-finding-kind="unresolved_target"]'),
  ).toHaveAttribute("data-tone", "info");
  await expect(
    result.getByText("Not marked this run", { exact: true }),
  ).toHaveCount(2);

  await expect(result.getByTestId("internal-link-tree")).toHaveCount(0);
  await expect(result.getByRole("searchbox")).toHaveCount(0);
  await expect(result.getByTestId("internal-link-node-detail")).toHaveCount(0);
  await expect(
    result.getByTestId("internal-link-finding-unresolved-targets"),
  ).toHaveCount(0);

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("renders the approved 25 URL fixture as 9 problem rows and 16 unmarked rows", async ({
  page,
}) => {
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(designScaleAuditResponse),
    });
  });

  await page.goto("/zh/tools/internal-link-audit");
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();

  const result = page.getByTestId("internal-link-audit-result");
  await expect(result.getByTestId("internal-link-url-path")).toHaveCount(25);
  await expect(result.getByTestId("internal-link-problem-row")).toHaveCount(9);
  await expect(result.getByTestId("internal-link-unmarked-row")).toHaveCount(16);
  await expect(result).toContainText(
    "已采集 25 个 URL · 9 个需要关注 · 2 个目标待验证",
  );

  const salesRow = result
    .getByTestId("internal-link-problem-row")
    .filter({ hasText: "/templates/sales" });
  await expect(salesRow).toContainText("重复内容候选");
  await expect(salesRow).not.toContainText("低入链");
  await expect(
    salesRow.getByText("重复内容候选", { exact: true }),
  ).toHaveCount(1);
  for (const theme of ["light", "deep"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-testid="internal-link-audit-result"]')
      .analyze();
    expect(accessibility.violations, `${theme} theme violations`).toEqual([]);
  }

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("copies the problem-only AI handoff after a confirmed Clipboard write", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          Reflect.set(window, "__internalLinkAuditCopiedText", text);
        },
      },
    });
  });
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(auditResponse),
    });
  });

  await page.goto("/tools/internal-link-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();

  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__internalLinkAuditCopiedText"),
    ),
  ).toBeUndefined();
  await page.getByTestId("internal-link-copy-ai").click();

  await expect(page.getByTestId("internal-link-copy-ai")).toHaveText(
    "Copied",
  );
  await expect(page.getByTestId("internal-link-copy-status")).toHaveText(
    "Copied 2 problem URLs and 2 unverified targets.",
  );
  const copiedText = await page.evaluate(() =>
    Reflect.get(window, "__internalLinkAuditCopiedText"),
  );
  expect(copiedText).toContain("https://acme.com/");
  expect(copiedText).toContain("https://acme.com/orphan");
  expect(copiedText).not.toContain("2. https://acme.com/guide\n");
  expect(copiedText).not.toContain("https://acme.com/guide/article");
  expect(copiedText).toContain("## Instructions for a Chatbot");
  expect(copiedText).toContain("## Instructions for a Code Agent");
  expect(copiedText).toContain(
    "The current contract does not pair each target with each source.",
  );

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("reveals and fully selects the manual handoff when Clipboard is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException("Denied", "NotAllowedError");
        },
      },
    });
  });
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(auditResponse),
    });
  });

  await page.goto("/zh/tools/internal-link-audit");
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();
  await page.getByTestId("internal-link-copy-ai").click();

  const fallback = page.getByLabel("供手动复制的完整 AI 交接文本");
  await expect(fallback).toBeVisible();
  await expect(fallback).toBeFocused();
  expect(
    await fallback.evaluate(
      (element) =>
        element instanceof HTMLTextAreaElement &&
        element.selectionStart === 0 &&
        element.selectionEnd === element.value.length,
    ),
  ).toBe(true);
  await expect(page.getByTestId("internal-link-copy-ai")).toHaveText(
    "复制给 AI 解决",
  );
  await expect(page.getByTestId("internal-link-copy-status")).toContainText(
    "完整交接文本已全选",
  );

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("disables the AI handoff when the report has no finding-linked URL", async ({
  page,
}) => {
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...auditResponse.data,
          result: {
            ...auditResponse.data.result,
            actionablePages: 0,
            findings: [],
          },
        },
      }),
    });
  });

  await page.goto("/zh/tools/internal-link-audit");
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();

  await expect(page.getByTestId("internal-link-copy-ai")).toBeDisabled();
  await expect(page.getByTestId("internal-link-copy-status")).toHaveText(
    "本次没有需要交给 AI 的 URL",
  );
  await expect(page.getByTestId("internal-link-problem-row")).toHaveCount(0);
  await expect(page.getByTestId("internal-link-unmarked-row")).toHaveCount(4);

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("falls back when the Clipboard promise does not settle", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => new Promise<void>(() => undefined),
      },
    });
  });
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(auditResponse),
    });
  });

  await page.goto("/tools/internal-link-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();
  await page.getByTestId("internal-link-copy-ai").click();

  await expect(
    page.getByLabel("Full AI handoff text for manual copying"),
  ).toBeVisible({ timeout: 2_000 });
  await expect(page.getByTestId("internal-link-copy-ai")).toHaveText(
    "Copy for AI resolution",
  );

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("falls back when reading the Clipboard API throws synchronously", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => {
        throw new DOMException("Denied", "SecurityError");
      },
    });
  });
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(auditResponse),
    });
  });

  await page.goto("/tools/internal-link-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();
  await page.getByTestId("internal-link-copy-ai").click();

  await expect(
    page.getByLabel("Full AI handoff text for manual copying"),
  ).toBeVisible({ timeout: 2_000 });
  await expect(page.getByTestId("internal-link-copy-ai")).toHaveText(
    "Copy for AI resolution",
  );

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("keeps an unavailable report out of the URL ledger", async ({ page }) => {
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...auditResponse.data,
          result: {
            ...auditResponse.data.result,
            availability: "unavailable",
            stopReason: "robots_unreachable",
            limitation:
              "No crawl evidence is available because robots.txt could not be read.",
            pagesCrawled: 0,
            linksObserved: 0,
            sitemapFetched: false,
            sitemapUrlsObserved: 0,
            actionablePages: 0,
            nodes: [],
            edges: [],
            findings: [],
          },
        },
      }),
    });
  });

  await page.goto("/tools/internal-link-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();

  const result = page.getByTestId("internal-link-audit-result");
  await expect(
    result.getByRole("heading", { name: "Internal link audit unavailable" }),
  ).toBeVisible();
  await expect(result).toContainText(
    "No crawl evidence is available because robots.txt could not be read.",
  );
  await expect(result.getByRole("table")).toHaveCount(0);
  await expect(result.getByTestId("internal-link-copy-ai")).toHaveCount(0);

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("does not attach a stale Clipboard completion to a replacement report", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            Reflect.set(window, "__resolveInternalLinkAuditCopy", resolve);
          }),
      },
    });
  });
  let responseCount = 0;
  const api = await installApiGuard(page, async (route) => {
    responseCount += 1;
    const result =
      responseCount === 1
        ? auditResponse.data.result
        : {
            ...auditResponse.data.result,
            actionablePages: 0,
            findings: [],
          };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { ...auditResponse.data, result } }),
    });
  });

  await page.goto("/tools/internal-link-audit");
  await page.getByLabel("Website URL").fill("first.example");
  await page.getByRole("button", { name: "Run internal link audit" }).click();
  await page.getByTestId("internal-link-copy-ai").click();
  await expect(page.getByTestId("internal-link-copy-ai")).toHaveText(
    "Copying…",
  );

  await page.getByLabel("Website URL").fill("second.example");
  await page.getByRole("button", { name: "Run internal link audit" }).click();
  await expect(page.getByTestId("internal-link-copy-ai")).toBeDisabled();
  await page.evaluate(() => {
    const resolve = Reflect.get(window, "__resolveInternalLinkAuditCopy");
    if (typeof resolve === "function") resolve();
  });
  await page.waitForTimeout(50);

  await expect(page.getByTestId("internal-link-copy-ai")).toHaveText(
    "Copy for AI resolution",
  );
  await expect(page.getByTestId("internal-link-copy-status")).toHaveText(
    "This run has no URLs that need an AI handoff.",
  );
  expect(api.auditRequestCount).toBe(2);
  await expectNoUnexpectedApiRequests(api);
});

test("keeps the no-login audit flow while presenting the partial URL ledger", async ({
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

  expect(requestedBody).toEqual({ url: "acme.com" });
  const result = page.getByTestId("internal-link-audit-result");
  await expect(
    result.getByRole("heading", {
      level: 2,
      name: "Internal link audit URL details",
    }),
  ).toBeVisible();
  await expect(result.getByText("Partial coverage", { exact: true })).toBeVisible();
  await expect(result).toContainText(
    "4 URLs collected · 2 need attention · 2 targets unverified",
  );
  await expect(result.getByRole("table")).toHaveCount(1);
  await expect(result.getByTestId("internal-link-problem-row")).toHaveCount(2);
  await expect(result.getByTestId("internal-link-unmarked-row")).toHaveCount(2);
  await expect(result.getByTestId("internal-link-tree")).toHaveCount(0);
  await expect(result.getByTestId("internal-link-node-detail")).toHaveCount(0);

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

test("renders a deep URL ledger at 320px without horizontal overflow", async ({
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
  await page.setViewportSize({ width: 320, height: 844 });

  await page.goto("/zh/tools/internal-link-audit");
  await page.getByLabel("网站 URL").fill("acme.com");
  await page.getByRole("button", { name: "开始内链审计" }).click();

  expect(requestedBody).toEqual({ url: "acme.com" });
  const result = page.getByTestId("internal-link-audit-result");
  await expect(
    result.getByRole("heading", { level: 2, name: "内链审计 URL 明细" }),
  ).toBeVisible();
  await expect(result.getByRole("table")).toHaveCount(1);
  await expect(result.getByTestId("internal-link-problem-row")).toHaveCount(27);
  await expect(result.getByTestId("internal-link-unmarked-row")).toHaveCount(4);
  await expect(result.getByTestId("internal-link-url-path")).toHaveCount(31);
  await expect(result.getByText("点击较深", { exact: true })).toHaveCount(27);

  const deepestPath = result
    .getByTestId("internal-link-url-path")
    .filter({ hasText: "level-30-with-a-deliberately-long-slug" });
  await expect(deepestPath).toBeVisible();
  const resultOverflow = await result.evaluate(
    (element) => element.scrollWidth > element.clientWidth,
  );
  expect(resultOverflow).toBe(false);
  const documentOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(documentOverflow).toBe(false);

  expect(api.auditRequestCount).toBe(1);
  await expectNoUnexpectedApiRequests(api);
});

test("keeps the URL ledger free of horizontal overflow at supported widths", async ({
  page,
}) => {
  const api = await installApiGuard(page, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(auditResponse),
    });
  });

  await page.goto("/tools/internal-link-audit");
  await page.getByLabel("Website URL").fill("acme.com");
  await page.getByRole("button", { name: "Run internal link audit" }).click();

  for (const width of [320, 736, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page
      .getByTestId("internal-link-audit-result")
      .evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      }));
    expect(geometry.scrollWidth, `result overflow at ${width}px`).toBeLessThanOrEqual(
      geometry.clientWidth,
    );
    expect(
      geometry.documentScrollWidth,
      `document overflow at ${width}px`,
    ).toBeLessThanOrEqual(geometry.documentClientWidth);
  }

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
