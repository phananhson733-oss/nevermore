import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import {
  AuditModuleId as AuditModuleIdSchema,
  ConfirmedProductProfileRowDto as ConfirmedProductProfileRowSchema,
  GrowthAuditResponse as GrowthAuditResponseSchema,
  GrowthMapUrlDetailResponse as GrowthMapUrlDetailResponseSchema,
  GrowthMapUrlPortfolioResponse as GrowthMapUrlPortfolioResponseSchema,
  ProductProfileDraft as ProductProfileDraftSchema,
  type AuditLensSummary,
  type ConfirmedProductProfileRowDto,
  type GrowthAuditResponse,
  type GrowthMapUrlDetailResponse,
  type GrowthMapUrlPortfolioItem,
  type GrowthMapUrlPortfolioResponse,
} from "../packages/contracts/src/index.ts";
import {
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  E2E_SNAPSHOT_PROVENANCE,
  installCriticalFlowApi,
  overviewWorkspaceFixture,
  sourceSlot,
} from "./mock-api.ts";

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const WORKSPACE_ROUTE = `**${BASE}/workspace?view=overview`;
const PORTFOLIO_ROUTE = `**${BASE}/audit/urls?limit=100`;
const DETAIL_ROUTE = `**${BASE}/audit/urls/*`;
const SOURCES_ROUTE = `**${BASE}/sources`;
const PRODUCT_PROFILE_ROUTE = `**${BASE}/product-profile`;
/**
 * The whole-project opportunity mix is a second, independent read. `**…/audit`
 * cannot swallow `**…/audit/urls`, so this route never shadows the portfolio.
 */
const AUDIT_ROUTE = `**${BASE}/audit`;

const NOW = "2026-07-21T08:00:00.000Z";
const DIAGNOSTIC_RUN_ID = "00000000-0000-4000-8000-000000000701";
const CRAWL_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000702";
const TOP_SITE_PAGE_ID = "00000000-0000-4000-8000-000000000703";
const TOP_PAGE_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000704";
const TOP_FINDING_ID = "00000000-0000-4000-8000-000000000705";
const TOP_EVIDENCE_ID = "00000000-0000-4000-8000-000000000706";
const SECOND_SITE_PAGE_ID = "00000000-0000-4000-8000-000000000707";
const SECOND_PAGE_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000708";
const SECOND_FINDING_ID = "00000000-0000-4000-8000-000000000709";
const EMPTY_SITE_PAGE_ID = "00000000-0000-4000-8000-000000000710";
const EMPTY_PAGE_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000711";
const GSC_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000720";
const GA4_SNAPSHOT_ID = "00000000-0000-4000-8000-000000000721";
const PROFILE_ROW_ID = "00000000-0000-4000-8000-000000000730";
const PRIMARY_AUDIENCE_ID = "00000000-0000-4000-8000-000000000731";
const DIRECT_COMPETITOR_ID = "00000000-0000-4000-8000-000000000732";
const INDIRECT_COMPETITOR_ID = "00000000-0000-4000-8000-000000000733";
const AUDIT_RUN_ID = "00000000-0000-4000-8000-000000000750";

const TOP_OPPORTUNITY_TITLE =
  "The product page points to the wrong canonical URL.";

type SourceFixture = ReturnType<typeof sourceSlot>;

interface ProductProfileWorkspaceFixture {
  readonly projectId: string;
  readonly currentProfile: ConfirmedProductProfileRowDto | null;
  readonly confirmedProfile: ConfirmedProductProfileRowDto | null;
  readonly activeSynthesisRun: null;
  readonly activeCrawlRun: null;
}

interface OverviewScenario {
  readonly workspace: ReturnType<typeof overviewWorkspaceFixture>;
  readonly portfolio: GrowthMapUrlPortfolioResponse;
  readonly detail: GrowthMapUrlDetailResponse | null;
  readonly sources: readonly SourceFixture[];
  readonly productProfile: ProductProfileWorkspaceFixture;
  /** `null` models a project that has never had a Growth Audit run (404). */
  readonly audit: GrowthAuditResponse | null;
}

function unavailablePriority() {
  return {
    availability: "unavailable" as const,
    value: null,
    limitation: "No current-run Finding targets this URL.",
  };
}

function unavailableDelta() {
  return {
    availability: "unavailable" as const,
    value: null,
    limitation: "No immutable before-and-after recheck is available.",
  };
}

function portfolioItem(input: {
  readonly sitePageId: string;
  readonly pageSnapshotId: string;
  readonly normalizedUrl: string;
  readonly title: string;
  readonly findingIds?: readonly string[];
  readonly reviewableFindingIds?: readonly string[];
  readonly priority?: "critical" | "high" | "medium" | "low";
  readonly coverage?: "available" | "partial";
}): GrowthMapUrlPortfolioItem {
  const findingIds = [...(input.findingIds ?? [])];
  const reviewableFindingIds = [...(input.reviewableFindingIds ?? [])];
  const coverage = input.coverage ?? "available";

  return {
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: CRAWL_SNAPSHOT_ID,
    sitePageId: input.sitePageId,
    pageSnapshotId: input.pageSnapshotId,
    pageSnapshotCapturedAt: NOW,
    identitySources: [
      {
        kind: "page_snapshot",
        provider: "crawl",
        snapshotId: CRAWL_SNAPSHOT_ID,
        pageSnapshotId: input.pageSnapshotId,
        observedAt: NOW,
      },
    ],
    normalizedUrl: input.normalizedUrl,
    title: input.title,
    pageType: "product",
    templateKey: "product-detail",
    clusterKey: null,
    ownerId: null,
    coverage: {
      availability: coverage,
      limitations:
        coverage === "available"
          ? []
          : ["One customer analytics source is not available for this URL."],
    },
    metricObservations: [],
    findingIds,
    reviewableFindingIds,
    priority:
      input.priority && findingIds.length > 0
        ? {
            availability: "available",
            value: input.priority,
            basis: {
              derivationVersion: "max_finding_severity.v1",
              projectId: E2E_PROJECT_ID,
              siteId: E2E_SITE_ID,
              diagnosticRunId: DIAGNOSTIC_RUN_ID,
              sitePageId: input.sitePageId,
              findingIds,
            },
            limitation: null,
          }
        : unavailablePriority(),
    delta: unavailableDelta(),
  };
}

const TOP_PORTFOLIO_ITEM = portfolioItem({
  sitePageId: TOP_SITE_PAGE_ID,
  pageSnapshotId: TOP_PAGE_SNAPSHOT_ID,
  normalizedUrl: "https://example.test/product",
  title: "RelayOps product",
  findingIds: [TOP_FINDING_ID],
  reviewableFindingIds: [TOP_FINDING_ID],
  priority: "high",
});

const SECOND_PORTFOLIO_ITEM = portfolioItem({
  sitePageId: SECOND_SITE_PAGE_ID,
  pageSnapshotId: SECOND_PAGE_SNAPSHOT_ID,
  normalizedUrl: "https://example.test/solutions/customer-success",
  title: "Customer success solution",
  findingIds: [SECOND_FINDING_ID],
  priority: "medium",
});

const EMPTY_PORTFOLIO_ITEM = portfolioItem({
  sitePageId: EMPTY_SITE_PAGE_ID,
  pageSnapshotId: EMPTY_PAGE_SNAPSHOT_ID,
  normalizedUrl: "https://example.test/about",
  title: "About RelayOps",
});

function portfolioFixture(input: {
  readonly data: readonly GrowthMapUrlPortfolioItem[];
  readonly coverage?: "available" | "partial" | "unavailable";
  readonly hasNext?: boolean;
}): GrowthMapUrlPortfolioResponse {
  const coverage = input.coverage ?? "available";
  const hasNext = input.hasNext ?? false;
  return GrowthMapUrlPortfolioResponseSchema.parse({
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: CRAWL_SNAPSHOT_ID,
    data: input.data,
    meta: {
      limit: 100,
      nextCursor: hasNext ? "bmV4dC1wYWdl" : null,
      hasNext,
      coverage: {
        availability: coverage,
        limitations:
          coverage === "available"
            ? []
            : [
                coverage === "partial"
                  ? "Additional URLs exist beyond this bounded page."
                  : "No URLs were captured in this frozen audit.",
              ],
      },
    },
  });
}

function detailFixture(
  item: GrowthMapUrlPortfolioItem = TOP_PORTFOLIO_ITEM,
): GrowthMapUrlDetailResponse {
  return GrowthMapUrlDetailResponseSchema.parse({
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    diagnosticRunId: DIAGNOSTIC_RUN_ID,
    crawlSnapshotId: CRAWL_SNAPSHOT_ID,
    data: {
      ...item,
      findings: [
        {
          projectId: E2E_PROJECT_ID,
          siteId: E2E_SITE_ID,
          findingId: TOP_FINDING_ID,
          diagnosticRunId: DIAGNOSTIC_RUN_ID,
          ruleId: "TECH-CANONICAL-002",
          ruleVersion: 2,
          title: TOP_OPPORTUNITY_TITLE,
          severity: "high",
          reviewState: "unreviewed",
          reviewRevision: 0,
          active: true,
          regressed: false,
          evidenceIds: [TOP_EVIDENCE_ID],
          targetRelation: {
            relation: "direct_url",
            targetKind: "url",
            targetRef: item.normalizedUrl,
            sitePageId: item.sitePageId,
            pageSnapshotId: item.pageSnapshotId,
          },
          executionRef: null,
        },
      ],
    },
  });
}

function auditLens(
  lensId: AuditLensSummary["lensId"],
  findingCount: number,
): AuditLensSummary {
  return {
    lensId,
    coverageState: "available",
    evidenceCount: findingCount + 5,
    findingCount,
    limitations: [],
  };
}

/**
 * `no_data` is missing coverage, so the contract forces its counts to the
 * placeholder `0`. The screen must show a dash for it, never that zero.
 */
function uncoveredLens(lensId: AuditLensSummary["lensId"]): AuditLensSummary {
  return {
    lensId,
    coverageState: "no_data",
    evidenceCount: 0,
    findingCount: 0,
    limitations: ["No confirmed competitor set covers this lens yet."],
  };
}

function auditFixture(
  lenses: readonly AuditLensSummary[],
): GrowthAuditResponse {
  return GrowthAuditResponseSchema.parse({
    auditRunId: AUDIT_RUN_ID,
    projectId: E2E_PROJECT_ID,
    siteId: E2E_SITE_ID,
    status: "completed",
    outputLocale: "en",
    completedAt: NOW,
    modules: AuditModuleIdSchema.options.map((moduleId) => ({
      moduleId,
      coverageState: "available",
      evidenceCount: 2,
      findingCount: 1,
      sourceProviders: ["crawl"],
      latestObservedAt: NOW,
      limitations: [],
    })),
    lenses,
    coverageAndLimitations: [],
  });
}

function sourceSnapshot(
  provider: "gsc" | "ga4",
  snapshotId: string,
  availability: "available" | "partial" = "available",
) {
  return {
    id: snapshotId,
    siteId: E2E_SITE_ID,
    provider,
    datasetKey: E2E_SNAPSHOT_PROVENANCE[provider].datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: E2E_SNAPSHOT_PROVENANCE[provider].methodVersion,
    capturedAt: NOW,
    sourceWindow: {
      start: "2026-06-23T00:00:00.000Z",
      end: "2026-07-20T23:59:59.000Z",
    },
    availability,
    limitation:
      provider === "gsc"
        ? "GSC rows are limited to the connected Search Console property."
        : "GA4 rows include configured organic landing-page traffic only.",
    rowCount: provider === "gsc" ? 128 : 96,
    checksum: provider === "gsc" ? "a".repeat(64) : "b".repeat(64),
  };
}

function connectedSourceFixtures(): readonly SourceFixture[] {
  return [
    sourceSlot("crawl"),
    sourceSlot("gsc", {
      id: "00000000-0000-4000-8000-000000000740",
      state: "available",
      connectedAt: NOW,
      latestSnapshot: sourceSnapshot("gsc", GSC_SNAPSHOT_ID),
      limitation: "Connected and collected.",
    }),
    sourceSlot("ga4", {
      id: "00000000-0000-4000-8000-000000000741",
      state: "available",
      connectedAt: NOW,
      latestSnapshot: sourceSnapshot("ga4", GA4_SNAPSHOT_ID),
      limitation: "Connected and collected.",
    }),
    sourceSlot("csv"),
    sourceSlot("dataforseo"),
  ];
}

function disconnectedSourceFixtures(): readonly SourceFixture[] {
  return [
    sourceSlot("crawl"),
    sourceSlot("gsc"),
    sourceSlot("ga4"),
    sourceSlot("csv"),
    sourceSlot("dataforseo"),
  ];
}

function partialSourceFixtures(): readonly SourceFixture[] {
  return [
    sourceSlot("crawl"),
    sourceSlot("gsc", {
      id: "00000000-0000-4000-8000-000000000740",
      state: "available",
      connectedAt: NOW,
      latestSnapshot: sourceSnapshot("gsc", GSC_SNAPSHOT_ID),
      limitation: "Connected and collected.",
    }),
    sourceSlot("ga4", {
      id: "00000000-0000-4000-8000-000000000741",
      state: "connected",
      connectedAt: NOW,
      latestSnapshot: null,
      limitation: "Connected, but no canonical snapshot is available yet.",
    }),
    sourceSlot("csv"),
    sourceSlot("dataforseo"),
  ];
}

function confirmedProfileFixture(): ConfirmedProductProfileRowDto {
  const semanticRoots = [
    "/businessHint",
    "/productName",
    "/oneLiner",
    "/category",
    "/productType",
    "/businessModels",
    "/valueProposition",
    "/coreFeatures",
    "/targetMarkets",
    "/targetAudiences",
    "/competitorCandidates",
  ] as const;
  const profile = ProductProfileDraftSchema.parse({
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: E2E_SITE_ID,
    sourcePageUrl: "https://relayops.com/product/",
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
    businessHint: "B2B customer operations software for global teams.",
    productName: "RelayOps",
    oneLiner: "Customer onboarding operations for global B2B teams.",
    category: "Customer Operations",
    productType: "B2B SaaS",
    businessModels: ["Subscription"],
    valueProposition:
      "Standardize complex onboarding without slowing customer-facing teams.",
    coreFeatures: ["Workflow orchestration", "Handoff visibility"],
    targetMarkets: [
      { marketCode: "US", priority: "primary" },
      { marketCode: "GB", priority: "secondary" },
    ],
    targetAudiences: [
      {
        candidateId: PRIMARY_AUDIENCE_ID,
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies with 50–500 employees",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize onboarding handoffs"],
        triggers: ["Rising implementation volume"],
        pains: ["Inconsistent handoffs"],
        jtbd: ["Launch customers predictably"],
        outcomes: ["Shorter time to value"],
        barriers: ["Fragmented tooling"],
        qualificationSignals: ["Dedicated customer operations team"],
        disqualifiers: ["No repeatable onboarding motion"],
      },
    ],
    competitorCandidates: [
      {
        candidateId: DIRECT_COMPETITOR_ID,
        name: "GuideCX",
        domain: "guidecx.com",
        relationship: "direct",
        analysisScope: ["positioning", "keyword_gap"],
        similarity: 0.88,
        reason: "Overlapping customer onboarding workflow category.",
        reviewStatus: "approved",
        confidence: "high",
      },
      {
        candidateId: INDIRECT_COMPETITOR_ID,
        name: "Notion",
        domain: "notion.so",
        relationship: "indirect",
        analysisScope: ["content"],
        similarity: 0.54,
        reason: "Teams may assemble onboarding operations in a general workspace.",
        reviewStatus: "approved",
        confidence: "medium",
      },
    ],
    fieldProvenance: semanticRoots.map((path, index) => ({
      path,
      derivation: "declared",
      confidence: "high",
      evidenceRefs: [
        {
          evidenceRefId: `00000000-0000-4000-8000-${String(760 + index).padStart(12, "0")}`,
          kind: "userEdit",
        },
      ],
      limitation: null,
      observedAt: null,
    })),
    missingFields: [],
    conflictingFields: [],
  });

  return ConfirmedProductProfileRowSchema.parse({
    id: PROFILE_ROW_ID,
    projectId: E2E_PROJECT_ID,
    version: 4,
    status: "complete",
    profile,
    contentHash: "d".repeat(64),
    createdAt: NOW,
    isCurrent: true,
    isConfirmed: true,
  });
}

function readyScenario(): OverviewScenario {
  const confirmedProfile = confirmedProfileFixture();
  return {
    workspace: overviewWorkspaceFixture({
      frozenDiagnosticRunId: DIAGNOSTIC_RUN_ID,
    }),
    portfolio: portfolioFixture({
      data: [TOP_PORTFOLIO_ITEM, SECOND_PORTFOLIO_ITEM, EMPTY_PORTFOLIO_ITEM],
    }),
    detail: detailFixture(),
    sources: connectedSourceFixtures(),
    productProfile: {
      projectId: E2E_PROJECT_ID,
      currentProfile: confirmedProfile,
      confirmedProfile,
      activeSynthesisRun: null,
      activeCrawlRun: null,
    },
    audit: auditFixture([
      auditLens("site_health", 4),
      auditLens("search_ai_visibility", 3),
      auditLens("demand_competition", 1),
    ]),
  };
}

function emptyScenario(): OverviewScenario {
  return {
    workspace: overviewWorkspaceFixture({
      frozenDiagnosticRunId: DIAGNOSTIC_RUN_ID,
      topActions: [],
    }),
    portfolio: portfolioFixture({
      data: [],
      coverage: "unavailable",
    }),
    detail: null,
    sources: disconnectedSourceFixtures(),
    productProfile: {
      projectId: E2E_PROJECT_ID,
      currentProfile: null,
      confirmedProfile: null,
      activeSynthesisRun: null,
      activeCrawlRun: null,
    },
    // Never audited: the mix must say so rather than show a failure or a zero.
    audit: null,
  };
}

function partialScenario(): OverviewScenario {
  return {
    workspace: overviewWorkspaceFixture({
      frozenDiagnosticRunId: DIAGNOSTIC_RUN_ID,
    }),
    portfolio: portfolioFixture({
      data: [
        {
          ...TOP_PORTFOLIO_ITEM,
          coverage: {
            availability: "partial",
            limitations: ["GA4 has no canonical snapshot for this URL."],
          },
        },
      ],
      coverage: "partial",
      hasNext: true,
    }),
    detail: detailFixture({
      ...TOP_PORTFOLIO_ITEM,
      coverage: {
        availability: "partial",
        limitations: ["GA4 has no canonical snapshot for this URL."],
      },
    }),
    sources: partialSourceFixtures(),
    productProfile: {
      projectId: E2E_PROJECT_ID,
      currentProfile: null,
      confirmedProfile: null,
      activeSynthesisRun: null,
      activeCrawlRun: null,
    },
    audit: auditFixture([
      auditLens("site_health", 4),
      auditLens("search_ai_visibility", 3),
      uncoveredLens("demand_competition"),
    ]),
  };
}

async function fulfill(route: Route, data: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

async function serveOverview(
  page: Page,
  scenario: OverviewScenario,
): Promise<void> {
  await page.route(WORKSPACE_ROUTE, (route) =>
    fulfill(route, scenario.workspace),
  );
  await page.route(PORTFOLIO_ROUTE, (route) =>
    fulfill(route, scenario.portfolio),
  );
  if (scenario.detail) {
    await page.route(DETAIL_ROUTE, (route) => fulfill(route, scenario.detail));
  }
  await page.route(SOURCES_ROUTE, (route) =>
    fulfill(route, scenario.sources),
  );
  await page.route(PRODUCT_PROFILE_ROUTE, (route) =>
    fulfill(route, scenario.productProfile),
  );
  await page.route(AUDIT_ROUTE, async (route) => {
    if (scenario.audit === null) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Not found",
          status: 404,
          code: "NOT_FOUND",
          detail: "No Growth Audit has been run for this project.",
          requestId: "e2e-request",
        }),
      });
      return;
    }
    await fulfill(route, scenario.audit);
  });
}

async function openOverview(
  page: Page,
  scenario: OverviewScenario,
): Promise<void> {
  await serveOverview(page, scenario);
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Where growth should move next",
    }),
  ).toBeVisible();
  await expect(
    page.locator("#main-content").getByText(
      "E2E Critical Flow's confirmed context, current frozen audit, and next customer decisions in one view.",
      { exact: true },
    ),
  ).toBeVisible();
  for (const title of [
    "What to decide and do next",
    "Opportunity distribution in the frozen audit",
    "Signals used for analysis",
    "Product, market, and ICP",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name: title }),
    ).toBeVisible();
  }
  await waitForOverviewAnimations(page);
}

function sectionByHeading(page: Page, name: string): Locator {
  return page
    .getByRole("heading", { level: 2, name, exact: true })
    .locator("xpath=ancestor::section[1]");
}

function metricByLabel(section: Locator, label: string): Locator {
  return section.getByText(label, { exact: true }).locator("xpath=..");
}

async function visibleBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error("Expected a visible layout box.");
  return box;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
}

async function waitForOverviewAnimations(page: Page): Promise<void> {
  await page.locator("[data-overview-page]").evaluate(async (element) => {
    await Promise.allSettled(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    );
  });
}

/**
 * The document must expose exactly one `main` landmark — the shell's
 * (`layout.tsx:187`). Overview nested a second one inside it until `c73b621`,
 * which is an axe `landmark-one-main` violation and gives a screen reader two
 * "main" regions with an ambiguous skip-to-content target.
 *
 * This is asserted directly rather than left to `blockingAxeViolations`, which
 * structurally cannot see it: that scan is `.include("#main-content")`, so it
 * evaluates what is INSIDE the shell's landmark and never the document's
 * landmark structure. That scoping is why the defect survived a whole slice of
 * mock coverage and was only caught the first time `test:e2e:real` was run
 * (stop gate §17.1).
 */
async function expectExactlyOneMainLandmark(page: Page): Promise<void> {
  await expect(page.getByRole("main")).toHaveCount(1);
}

async function blockingAxeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .include("#main-content")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations
    .filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    )
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    );
}

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "en",
      domain: "localhost",
      path: "/",
    },
  ]);
  await installCriticalFlowApi(page);
});

test("ready Overview renders the four current customer modules", async ({
  page,
}) => {
  await openOverview(page, readyScenario());

  const priority = sectionByHeading(page, "What to decide and do next");
  await expect(priority.getByText("PRIORITY", { exact: true })).toBeVisible();
  await expect(priority).toContainText(
    "Loaded-scope Findings + project-wide Actions · up to 3",
  );
  await expect(
    priority.getByRole("heading", { level: 3, name: TOP_OPPORTUNITY_TITLE }),
  ).toBeVisible();
  // Severity now rides the row's kind label; the rule id and the evidence count
  // moved to the Growth Map detail this row links to (PRD :283).
  await expect(priority).toContainText("Evidence review · High");
  await expect(priority).not.toContainText("TECH-CANONICAL-002");
  await expect(priority).not.toContainText("1 evidence item");
  await expect(
    priority.getByRole("link", { name: "Review Opportunity" }),
  ).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${TOP_SITE_PAGE_ID}`,
  );
  await expect(priority.getByText("Planned", { exact: true })).toBeVisible();
  await expect(priority).toContainText("Fix the failing product page");
  await expect(
    priority.getByRole("link", {
      name: "Planned: Fix the failing product page",
    }),
  ).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/execution?actionId=00000000-0000-4000-8000-000000000301`,
  );
  // One Opportunity and one Action share the same bounded decision list.
  await expect(priority.locator("[data-decision-kind]")).toHaveCount(2);
  await expect(priority).toContainText("No verified before/after result yet");

  const portfolio = sectionByHeading(
    page,
    "Opportunity distribution in the frozen audit",
  );
  await expect(metricByLabel(portfolio, "URLs loaded")).toContainText("3");
  await expect(
    metricByLabel(portfolio, "URLs with Opportunities"),
  ).toContainText("2");
  await expect(metricByLabel(portfolio, "Active Findings")).toContainText("2");
  await expect(metricByLabel(portfolio, "Findings to review")).toContainText("1");
  await expect(portfolio).toContainText("Loaded page only");
  // The Findings-to-review description is the review entry point; the count
  // itself stays plain text so an empty queue can never be linked.
  await expect(
    portfolio.getByRole("link", { name: "Customer decisions, one by one" }),
  ).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${TOP_SITE_PAGE_ID}&findingId=${TOP_FINDING_ID}`,
  );

  // Whole-project mix: a second scope on the same card, labelled apart from the
  // loaded-page stat cells above it.
  await expect(portfolio).toContainText("Project-wide opportunity mix");
  await expect(portfolio).toContainText(
    "Counts the whole project, not only the loaded page",
  );
  await expect(portfolio.locator('[data-lens="site_health"]')).toContainText(
    "Site Health",
  );
  await expect(
    portfolio.locator('[data-lens="site_health"] strong'),
  ).toHaveText("4");
  await expect(
    portfolio.locator('[data-lens="search_ai_visibility"] strong'),
  ).toHaveText("3");
  await expect(
    portfolio.locator('[data-lens="demand_competition"] strong'),
  ).toHaveText("1");
  await expect(portfolio).toContainText("8 Opportunities in total");
  await expect(portfolio).toContainText("Audit identity");
  await expect(
    portfolio.locator(`code[title="${DIAGNOSTIC_RUN_ID}"]`),
  ).toBeVisible();
  await expect(portfolio).toContainText("Coverage available");

  const sources = sectionByHeading(page, "Signals used for analysis");
  await expect(sources.locator("article")).toHaveCount(3);
  const gsc = sources.locator("article").filter({
    hasText: "Google Search Console",
  });
  const ga4 = sources.locator("article").filter({
    hasText: "Google Analytics 4",
  });
  const github = sources.locator("article").filter({ hasText: "GitHub" });
  await expect(gsc.getByText("Available", { exact: true })).toBeVisible();
  await expect(ga4.getByText("Available", { exact: true })).toBeVisible();
  await expect(gsc).toContainText("Jul 21, 2026");
  await expect(ga4).toContainText("Jul 21, 2026");
  await expect(github.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(github).toContainText(
    "reserved for automated pull-request creation and merge workflows",
  );
  await expect(sources).not.toContainText("Site crawl");
  await expect(sources).not.toContainText("CSV upload");
  await expect(sources).not.toContainText("DataForSEO");
  await gsc.getByText("Source record / original wording", { exact: true }).click();
  await expect(gsc).toContainText(
    "GSC rows are limited to the connected Search Console property.",
  );

  const context = sectionByHeading(page, "Product, market, and ICP");
  await expect(
    context.getByRole("heading", { level: 3, name: "RelayOps" }),
  ).toBeVisible();
  await expect(context).toContainText(
    "Customer onboarding operations for global B2B teams.",
  );
  await expect(context).toContainText("Customer Operations");
  await expect(context).toContainText("B2B SaaS");
  await expect(metricByLabel(context, "Primary market")).toContainText("US");
  await expect(metricByLabel(context, "Primary ICP")).toContainText(
    "B2B SaaS companies with 50–500 employees",
  );
  await expect(metricByLabel(context, "JTBD")).toContainText(
    "Launch customers predictably",
  );
  await expect(metricByLabel(context, "Approved competitors")).toContainText(
    "1 direct · 1 indirect",
  );
  await context.getByText("Version and provenance", { exact: true }).click();
  await expect(context).toContainText(
    "Declared input only · no source snapshot",
  );
});

test("content-decay advice stays in the existing priority queue and deep-links the exact Growth Map URL", async ({
  page,
}) => {
  const ready = readyScenario();
  const scenario: OverviewScenario = {
    ...ready,
    workspace: overviewWorkspaceFixture({
      frozenDiagnosticRunId: DIAGNOSTIC_RUN_ID,
      contentDecayMonitor: {
        version: "content-decay-monitor.v1",
        projectionMode: "read_time",
        scheduleState: "not_configured",
        status: "available",
        timezone: "UTC",
        timezoneSource: "provider",
        latestCheckpointMonth: "2026-06",
        limitations: [
          "Monthly scheduling is not connected; this is a read-time projection.",
        ],
        alerts: [
          {
            sitePageId: TOP_SITE_PAGE_ID,
            normalizedUrl: "https://example.test/product",
            detectedAt: "2026-06-29T08:00:00.000Z",
            currentMonth: "2026-06",
            triggers: ["rank_decline", "traffic_decline"],
            rankTrend: {
              olderMonth: "2026-04",
              previousMonth: "2026-05",
              currentMonth: "2026-06",
              olderPosition: 8,
              previousPosition: 13.1,
              currentPosition: 18.2,
              firstDecline: 5.1,
              secondDecline: 5.1,
            },
            trafficTrend: {
              previousMonth: "2026-05",
              currentMonth: "2026-06",
              previousClicks: 500,
              currentClicks: 350,
              changeRatio: -0.3,
            },
            sourceSnapshotIds: [
              "00000000-0000-4000-8000-000000000741",
              "00000000-0000-4000-8000-000000000742",
              "00000000-0000-4000-8000-000000000743",
            ],
          },
        ],
      },
    }),
  };

  await openOverview(page, scenario);
  await page.getByRole("button", { name: "简体中文" }).click();

  const priority = sectionByHeading(page, "接下来要决定、要完成什么");
  const alert = priority.locator("[data-content-decay-alert]");
  await expect(alert).toHaveCount(1);
  // The warning is an observation: it sits in its own block and never spends
  // one of the three decision slots.
  await expect(priority).toContainText("内容健康度观察");
  await expect(priority).toContainText("观察信号，不占用上方 3 项决策名额。");
  await expect(priority.locator("[data-decision-kind]")).toHaveCount(2);
  await expect(alert).toContainText("建议内容复审");
  await expect(alert).toContainText("连续两个月平均位置分别下降 5.1 / 5.1 位");
  // The click sample travels with the percentage: 30% off 500 and 30% off 5 are
  // not the same evidence.
  await expect(alert).toContainText(
    "最近 28 天 clicks 由 500 降至 350，环比下降 30%",
  );
  await expect(alert).toContainText("/product");
  await expect(
    alert.getByRole("link", {
      name: "在增长地图查看需要内容复审的页面：/product",
    }),
  ).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/growth-map?object=pages&selectedSitePageId=${TOP_SITE_PAGE_ID}`,
  );
  await expect(page.locator("[data-overview-page] section")).toHaveCount(4);
  await expect(page.getByText("自动执行内容复审", { exact: true })).toHaveCount(
    0,
  );
});

test("empty Overview keeps absence explicit across all four modules", async ({
  page,
}) => {
  await openOverview(page, emptyScenario());

  const priority = sectionByHeading(page, "What to decide and do next");
  await expect(priority).toContainText("No current Opportunity is available");
  await expect(priority).toContainText(
    "The latest frozen audit has no active Finding for the loaded URL portfolio.",
  );
  // Nothing to decide means an empty list, not a fabricated row.
  await expect(priority.locator("[data-decision-kind]")).toHaveCount(0);
  await expect(priority).toContainText("No verified before/after result yet");
  await expect(
    priority.getByRole("link", { name: "Open Growth Map" }),
  ).toBeVisible();

  const portfolio = sectionByHeading(
    page,
    "Opportunity distribution in the frozen audit",
  );
  for (const label of [
    "URLs loaded",
    "URLs with Opportunities",
    "Active Findings",
    "Findings to review",
  ]) {
    await expect(metricByLabel(portfolio, label)).toContainText("0");
  }
  await expect(portfolio).toContainText("Coverage unavailable");
  // A project that has never been audited is honest absence, not a failed read.
  await expect(portfolio).toContainText(
    "The current frozen audit has no Opportunity to classify.",
  );
  await expect(portfolio).not.toContainText(
    "The project-wide opportunity mix could not be loaded.",
  );
  await expect(portfolio.locator("[data-lens]")).toHaveCount(0);
  await expect(
    portfolio.getByRole("link", { name: "Customer decisions, one by one" }),
  ).toHaveCount(0);

  const sources = sectionByHeading(page, "Signals used for analysis");
  await expect(sources.locator("article")).toHaveCount(3);
  for (const provider of ["Google Search Console", "Google Analytics 4"]) {
    const card = sources.locator("article").filter({ hasText: provider });
    await expect(card.getByText("Disconnected", { exact: true })).toBeVisible();
    await expect(card).toContainText("No source snapshot is available");
  }
  await expect(
    sources
      .locator("article")
      .filter({ hasText: "GitHub" })
      .getByText("Unavailable", { exact: true }),
  ).toBeVisible();

  const context = sectionByHeading(page, "Product, market, and ICP");
  await expect(context).toContainText("No confirmed Product Profile");
  await expect(context).toContainText(
    "A draft or legacy context is not substituted for confirmed customer context.",
  );
  await expect(
    context.getByRole("link", { name: "Complete Product Profile" }),
  ).toHaveAttribute("href", `/p/${E2E_PROJECT_ID}/context`);
});

test("partial Overview preserves bounded audit and mixed connection truth", async ({
  page,
}) => {
  await openOverview(page, partialScenario());

  const priority = sectionByHeading(page, "What to decide and do next");
  await expect(priority).toContainText(TOP_OPPORTUNITY_TITLE);
  await expect(priority).toContainText("Fix the failing product page");
  await expect(priority).toContainText("No verified before/after result yet");

  const portfolio = sectionByHeading(
    page,
    "Opportunity distribution in the frozen audit",
  );
  await expect(metricByLabel(portfolio, "URLs loaded")).toContainText("1");
  await expect(portfolio).toContainText(
    "This page only · more URLs are available",
  );
  await expect(portfolio).toContainText("Partial coverage");
  // A downgraded coverage badge without its reasons is a grade the customer
  // cannot judge, so the contract's limitations must be on the screen.
  await expect(portfolio).toContainText("Why this coverage is incomplete");
  await expect(portfolio).toContainText(
    "Additional URLs exist beyond this bounded page.",
  );
  // An uncovered lens reports missing coverage, never a measured zero — and
  // without it the whole-project total stays unavailable rather than partial.
  await expect(
    portfolio.locator('[data-lens="demand_competition"]'),
  ).toHaveAttribute("data-coverage", "no_data");
  await expect(
    portfolio.locator('[data-lens="demand_competition"] strong'),
  ).toHaveText("—");
  await expect(
    portfolio.locator('[data-lens="site_health"] strong'),
  ).toHaveText("4");
  await expect(portfolio).not.toContainText("in total");

  const sources = sectionByHeading(page, "Signals used for analysis");
  const gsc = sources.locator("article").filter({
    hasText: "Google Search Console",
  });
  const ga4 = sources.locator("article").filter({
    hasText: "Google Analytics 4",
  });
  await expect(gsc.getByText("Available", { exact: true })).toBeVisible();
  await expect(gsc).toContainText("Jul 21, 2026");
  await expect(ga4.getByText("Connected", { exact: true })).toBeVisible();
  await expect(ga4).toContainText("No source snapshot is available");

  await expect(
    sectionByHeading(page, "Product, market, and ICP"),
  ).toContainText("No confirmed Product Profile");
});

test("ready four-module Overview keeps desktop and mobile WCAG AA semantics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openOverview(page, readyScenario());
  await expect(
    page.getByRole("heading", { level: 3, name: TOP_OPPORTUNITY_TITLE }),
  ).toBeVisible();

  const main = page.locator("#main-content");
  await expect(main.locator("h1")).toHaveCount(1);
  await expect(main.locator("h2")).toHaveCount(4);
  await expect(main.locator("section")).toHaveCount(4);
  for (const title of [
    "What to decide and do next",
    "Opportunity distribution in the frozen audit",
    "Signals used for analysis",
    "Product, market, and ICP",
  ]) {
    await expect(sectionByHeading(page, title).locator("h2")).toHaveCount(1);
  }
  await expect(
    main.getByRole("link", { name: "Open Growth Map" }).first(),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Manage connections" }),
  ).toBeVisible();

  const sources = sectionByHeading(page, "Signals used for analysis");
  await sources
    .locator("article")
    .filter({ hasText: "Google Search Console" })
    .getByText("Source record / original wording", { exact: true })
    .click();
  await sectionByHeading(page, "Product, market, and ICP")
    .getByText("Version and provenance", { exact: true })
    .click();
  expect(await blockingAxeViolations(page)).toEqual([]);
  await expectExactlyOneMainLandmark(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Where growth should move next" }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(await blockingAxeViolations(page)).toEqual([]);
  await expectExactlyOneMainLandmark(page);
});

test("Overview chrome localizes to zh-CN while canonical customer data stays intact", async ({
  page,
}) => {
  await openOverview(page, readyScenario());
  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "下一步，增长该往哪里走" }),
  ).toBeVisible();
  for (const title of [
    "接下来要决定、要完成什么",
    "冻结审计中的机会分布",
    "用于分析的数据信号",
    "产品、市场与 ICP",
  ]) {
    await expect(
      page.getByRole("heading", { level: 2, name: title }),
    ).toBeVisible();
  }

  const priority = sectionByHeading(page, "接下来要决定、要完成什么");
  await expect(priority).toContainText("优先处理");
  await expect(priority).toContainText(TOP_OPPORTUNITY_TITLE);
  await expect(priority).toContainText("证据审核 · 高优先级");
  await expect(priority.getByText("已计划", { exact: true })).toBeVisible();
  await expect(priority).toContainText("Fix the failing product page");
  await expect(priority).toContainText("暂无经过验证的审计前后结果");

  const portfolio = sectionByHeading(page, "冻结审计中的机会分布");
  await expect(portfolio).toContainText("本页已加载 URL");
  await expect(portfolio).toContainText("有效 Finding");
  await expect(portfolio).toContainText("当前加载页");
  await expect(portfolio).toContainText("全项目机会构成");
  await expect(portfolio).toContainText("统计全项目，不限于当前加载页");
  await expect(portfolio).toContainText("共 8 个 Opportunity");
  await expect(portfolio).toContainText("审计身份");
  await expect(portfolio).toContainText("覆盖可用");

  const sources = sectionByHeading(page, "用于分析的数据信号");
  const gsc = sources.locator("article").filter({
    hasText: "Google Search Console",
  });
  await expect(gsc.getByText("可用", { exact: true })).toBeVisible();
  await gsc.getByText("来源记录 / 原始说明（保留原文）", { exact: true }).click();
  const originalWording = gsc.getByText(
    "GSC rows are limited to the connected Search Console property.",
    { exact: true },
  );
  await expect(originalWording).toBeVisible();
  await expect(originalWording).toHaveAttribute("lang", "en");
  await expect(
    sources
      .locator("article")
      .filter({ hasText: "GitHub" })
      .getByText("不可用", { exact: true }),
  ).toBeVisible();
  await expect(sources).toContainText(
    "暂不可用 · 为后续自动创建与合并 PR 的流程预留",
  );

  const context = sectionByHeading(page, "产品、市场与 ICP");
  await expect(context).toContainText("RelayOps");
  await expect(context).toContainText("主要市场");
  await expect(context).toContainText("主要 ICP");
  await expect(context).toContainText("1 个直接竞品 · 1 个间接竞品");
});

test("Overview uses the two-column folio on wide screens and one ordered column on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openOverview(page, readyScenario());
  await expect(
    page.getByRole("heading", { level: 3, name: TOP_OPPORTUNITY_TITLE }),
  ).toBeVisible();

  const priority = sectionByHeading(page, "What to decide and do next");
  const portfolio = sectionByHeading(
    page,
    "Opportunity distribution in the frozen audit",
  );
  const sources = sectionByHeading(page, "Signals used for analysis");
  const context = sectionByHeading(page, "Product, market, and ICP");
  const priorityWide = await visibleBox(priority);
  const portfolioWide = await visibleBox(portfolio);
  const sourcesWide = await visibleBox(sources);
  const contextWide = await visibleBox(context);

  expect(Math.abs(priorityWide.y - portfolioWide.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(sourcesWide.y - contextWide.y)).toBeLessThanOrEqual(1);
  expect(priorityWide.x).toBeLessThan(portfolioWide.x);
  expect(sourcesWide.x).toBeLessThan(contextWide.x);
  expect(priorityWide.width / portfolioWide.width).toBeGreaterThan(1.45);
  expect(priorityWide.width / portfolioWide.width).toBeLessThan(1.85);
  expect(sourcesWide.y).toBeGreaterThan(priorityWide.y + priorityWide.height);
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileCards = await Promise.all(
    [priority, portfolio, sources, context].map((section) => visibleBox(section)),
  );
  for (let index = 1; index < mobileCards.length; index += 1) {
    const previous = mobileCards[index - 1]!;
    const current = mobileCards[index]!;
    expect(Math.abs(current.x - mobileCards[0]!.x)).toBeLessThanOrEqual(1);
    expect(current.y).toBeGreaterThan(previous.y + previous.height);
  }
  const editProfile = await visibleBox(
    page.getByRole("link", { name: "Edit Product Profile" }).first(),
  );
  const openGrowthMap = await visibleBox(
    page.getByRole("link", { name: "Open Growth Map" }).first(),
  );
  expect(openGrowthMap.y).toBeGreaterThan(editProfile.y + editProfile.height);
  await expectNoHorizontalOverflow(page);
});

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
] as const) {
  test(`current four-module Overview renders without overflow at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openOverview(page, readyScenario());
    await expect(
      page.getByRole("heading", { level: 3, name: TOP_OPPORTUNITY_TITLE }),
    ).toBeVisible();
    const priority = sectionByHeading(page, "What to decide and do next");
    const portfolio = sectionByHeading(
      page,
      "Opportunity distribution in the frozen audit",
    );
    const sources = sectionByHeading(page, "Signals used for analysis");
    const context = sectionByHeading(page, "Product, market, and ICP");
    const cardBoxes = await Promise.all(
      [priority, portfolio, sources, context].map((section) =>
        visibleBox(section),
      ),
    );
    if (viewport.width > 1050) {
      expect(Math.abs(cardBoxes[0]!.y - cardBoxes[1]!.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(cardBoxes[2]!.y - cardBoxes[3]!.y)).toBeLessThanOrEqual(1);
      expect(cardBoxes[0]!.x).toBeLessThan(cardBoxes[1]!.x);
      expect(cardBoxes[2]!.x).toBeLessThan(cardBoxes[3]!.x);
    } else {
      for (let index = 1; index < cardBoxes.length; index += 1) {
        const previous = cardBoxes[index - 1]!;
        const current = cardBoxes[index]!;
        expect(Math.abs(current.x - cardBoxes[0]!.x)).toBeLessThanOrEqual(1);
        expect(current.y).toBeGreaterThan(previous.y + previous.height);
      }
      const editProfile = await visibleBox(
        page.getByRole("link", { name: "Edit Product Profile" }).first(),
      );
      const openGrowthMap = await visibleBox(
        page.getByRole("link", { name: "Open Growth Map" }).first(),
      );
      expect(openGrowthMap.y).toBeGreaterThan(
        editProfile.y + editProfile.height,
      );
    }
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `/tmp/signalframe-overview-current-${viewport.width}.png`,
      fullPage: true,
    });
  });
}

/**
 * Regression net for stop gate §17.4. The shell-hiding print rule
 * (`globals.css`) was gated on `[data-report-page]`, an attribute that survives
 * only inside the client no file imports, so printing any screen carried the
 * sidebar and the sticky toolbar into the output. Overview is asserted here
 * because it already ships a print stylesheet of its own
 * (`overview.module.css:1342`) — it is a screen someone deliberately made
 * printable, and the gate was defeating that.
 */
test("printing Overview leaves the shell chrome out of the output", async ({
  page,
}) => {
  await openOverview(page, readyScenario());
  const sidebar = page.locator("[data-app-shell-sidebar]");
  const topbar = page.locator("[data-app-shell-topbar]");
  await expect(sidebar).toBeVisible();

  await page.emulateMedia({ media: "print" });
  await expect(sidebar).toBeHidden();
  await expect(topbar).toBeHidden();
  // The page itself must still be there — a rule that hid everything would
  // satisfy the two assertions above and be worse than the defect.
  await expect(
    page.getByRole("heading", { level: 1, name: "Where growth should move next" }),
  ).toBeVisible();

  await page.emulateMedia({ media: "screen" });
  await expect(sidebar).toBeVisible();
});


