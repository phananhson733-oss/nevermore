import { randomUUID } from "node:crypto";
import {
  GrowthMapCompetitorLibraryResponse,
  GrowthMapKeywordLibraryResponse,
  GrowthMapUrlDetailResponse,
  GrowthMapUrlPortfolioResponse,
  type GrowthMapCompetitorLibraryItem,
  type GrowthMapKeywordLibraryItem,
  type GrowthMapUrlDetail,
  type GrowthMapUrlFinding,
  type GrowthMapUrlMetricObservation,
} from "../packages/contracts/src/index.ts";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  CompetitorsRepository,
  createDbHandle,
  KeywordGovernanceRepository,
  KeywordsRepository,
  TopicModelsRepository,
  type DbHandle,
} from "../packages/db/src/index.ts";
import type { WorkerShutdownResult } from "../apps/worker/src/shutdown-coordinator.ts";
import {
  KEYWORD_GAP_MAPPING,
  completeContextBody,
  keywordGapCsv,
  publishDiagnosticThroughAnalysisRefresh,
  seedOfflineProviderSnapshots,
  verticalDefinition,
  type VerticalDefinition,
} from "./real-chain-fixture.ts";
import {
  getRealE2eSegmentPaths,
  requireRealE2eSegment,
} from "./real-e2e-runtime.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const DATABASE_URL = process.env["E2E_DATABASE_URL"];
const BLOB_DIR = getRealE2eSegmentPaths(
  requireRealE2eSegment(process.env["REAL_E2E_SEGMENT"]),
  process.env["REAL_E2E_INVOCATION_ID"] ?? "",
).blobDir;
const CLIENT_READ_MODEL_TIMEOUT_MS = 45_000;

interface WorkerRuntime {
  stop(): Promise<WorkerShutdownResult>;
}

interface DataEnvelope<T> {
  readonly data: T;
}

interface AcceptedRun {
  readonly run: { readonly id: string; readonly status: string };
  readonly statusUrl: string;
}

interface PreviewData {
  readonly importToken: string;
  readonly rowCount: number;
  readonly errors: readonly unknown[];
}

interface SnapshotRecord {
  readonly id: string;
  readonly provider: "crawl" | "gsc" | "ga4" | "csv" | "dataforseo";
}

interface SnapshotListEnvelope {
  readonly data: readonly SnapshotRecord[];
  readonly meta: {
    readonly hasNext: boolean;
    readonly nextCursor: string | null;
  };
}

interface JsonResponse {
  ok(): boolean;
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

const METRIC_LABELS: Readonly<Record<string, string>> = {
  "crawl:/status": "Crawl HTTP status",
  "crawl:/finalStatus": "Final HTTP status",
  "crawl:/wordCount": "Page word count",
  "crawl:/responseMs": "Response time",
  "gsc:/current28d/clicks": "GSC clicks · current 28 days",
  "gsc:/current28d/impressions": "GSC impressions · current 28 days",
  "gsc:/current28d/position": "GSC avg. position · current 28 days",
  "gsc:/previous28d/clicks": "GSC clicks · previous 28 days",
  "gsc:/previous28d/impressions": "GSC impressions · previous 28 days",
  "gsc:/previous28d/position": "GSC avg. position · previous 28 days",
  "ga4:/sessions": "GA4 Sessions",
  "ga4:/engagedSessions": "GA4 Engaged Sessions",
  "ga4:/engagementRate": "GA4 Engagement Rate",
  "ga4:/keyEvents": "GA4 Key Events",
};

function configureWorkerEnvironment(): void {
  if (!DATABASE_URL) throw new Error("E2E_DATABASE_URL is required");
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_ORIGIN: BASE_URL,
    DATABASE_URL,
    DB_POOL_MAX: "4",
    SUPABASE_URL: "http://127.0.0.1:1",
    SUPABASE_SERVICE_ROLE_KEY: "e2e-local-only",
    CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    GOOGLE_OAUTH_CLIENT_ID: "e2e-local-only",
    GOOGLE_OAUTH_CLIENT_SECRET: "e2e-local-only",
    OPENAI_API_KEY: "e2e-local-only",
    OPENAI_MODEL: "e2e-local-template-only",
    DATAFORSEO_ENABLED: "false",
    RAW_IMPORT_BUCKET: "e2e-local-only",
    EXPORT_BUCKET: "e2e-local-only",
    SF_BLOB_BACKEND: "local",
    SF_BLOB_DIR: BLOB_DIR,
    LOG_LEVEL: "error",
  });
}

async function responseJson<T>(
  response: JsonResponse,
  operation: string,
): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${operation} failed with HTTP ${response.status()}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function createProjectInBrowser(
  page: Page,
  definition: VerticalDefinition,
): Promise<string> {
  await page.context().addCookies([
    { name: "sf_ui_locale", value: "en", url: BASE_URL },
  ]);
  await page.goto("/new-project");
  // The heading is server-rendered, but the form submit handler belongs to the
  // hydrated client island. Wait for its script requests to settle before
  // editing so an early native form submission cannot reload the empty form.
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Add a product" })).toBeVisible();
  await page.getByLabel("Product name").fill(definition.productName);
  await page.getByLabel("Product URL").fill(definition.siteUrl);
  await page.getByLabel("Customer model").selectOption(definition.customerModel);
  await page.getByLabel("Primary target market").selectOption("US");
  const growthObjective =
    definition.customerModel === "b2b"
      ? "Generate qualified leads"
      : "Increase revenue";
  await page.getByRole("checkbox", { name: growthObjective }).check();

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/mvp/projects",
  );
  await page
    .getByRole("button", { name: "Create and generate initial profile" })
    .click();
  const created = await createResponse;
  expect(
    created.status(),
    `create project failed: ${await created.text()}`,
  ).toBe(201);
  expect(created.request().postDataJSON()).toEqual({
    mode: "product_profile",
    productName: definition.productName,
    productUrl: definition.siteUrl,
    customerModel: definition.customerModel,
    primaryMarket: "US",
    growthObjectives: [
      definition.customerModel === "b2b"
        ? "generate_qualified_leads"
        : "increase_revenue",
    ],
  });
  await page.waitForURL(/\/p\/[0-9a-f-]+\/context$/);
  const match = new URL(page.url()).pathname.match(
    /^\/p\/([0-9a-f-]+)\/context$/,
  );
  if (!match?.[1]) throw new Error("created project id was missing from URL");
  await expect(
    page.getByRole("button", { name: "Edit Product Profile" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("link", { name: "Connect live data" }),
  ).toHaveCount(0);
  return match[1];
}

async function completeContext(
  request: APIRequestContext,
  projectId: string,
  definition: VerticalDefinition,
): Promise<void> {
  // Next development mode lazily compiles this API route. In CI, its first
  // request can overlap a manifest write and briefly return an unparseable 500
  // before the route is stable. Warm only this idempotent read boundary; the
  // real read and PATCH below still fail immediately on any product error.
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/mvp/projects/${projectId}/context`,
        );
        if (!response.ok()) return false;
        try {
          const body = (await response.json()) as DataEnvelope<{
            readonly version: number;
          }>;
          return Number.isInteger(body.data.version);
        } catch {
          return false;
        }
      },
      {
        message: "context API route did not finish compiling",
        timeout: 30_000,
        intervals: [200, 400, 800, 1_000],
      },
    )
    .toBe(true);

  const current = await responseJson<
    DataEnvelope<{ readonly version: number }>
  >(
    await request.get(`/api/mvp/projects/${projectId}/context`),
    "read current context version",
  );
  const response = await request.patch(
    `/api/mvp/projects/${projectId}/context`,
    {
      data: {
        ...completeContextBody(definition),
        baseVersion: current.data.version,
      },
    },
  );
  await responseJson<DataEnvelope<unknown>>(response, "complete context");
}

async function waitForRun(
  request: APIRequestContext,
  statusUrl: string,
  expected: readonly string[],
): Promise<void> {
  let observed = "missing";
  await expect
    .poll(
      async () => {
        const response = await request.get(statusUrl);
        if (!response.ok()) {
          observed = `http-${response.status()}`;
          return false;
        }
        const body = (await response.json()) as DataEnvelope<{
          readonly status: string;
        }>;
        observed = body.data.status;
        if (
          observed === "partial" ||
          observed === "failed" ||
          observed === "cancelled"
        ) {
          throw new Error(`run ${statusUrl} became terminal: ${observed}`);
        }
        return expected.includes(observed);
      },
      {
        message: `run ${statusUrl} did not reach ${expected.join("/")}`,
        timeout: 45_000,
        intervals: [200, 400, 800, 1_000],
      },
    )
    .toBe(true);
}

async function readDiagnosticSnapshots(
  request: APIRequestContext,
  projectId: string,
  seededProviderSnapshotIds: readonly string[],
): Promise<readonly SnapshotRecord[]> {
  const response = await request.get(
    `/api/mvp/projects/${projectId}/snapshots?limit=50`,
    { headers: { cookie: "sf_ui_locale=en" } },
  );
  const snapshots = await responseJson<SnapshotListEnvelope>(
    response,
    "list diagnostic snapshots",
  );
  expect(snapshots.meta).toMatchObject({
    hasNext: false,
    nextCursor: null,
  });
  expect(
    [...new Set(snapshots.data.map((snapshot) => snapshot.provider))].sort(),
  ).toEqual(["crawl", "csv", "ga4", "gsc"]);
  expect(snapshots.data.map((snapshot) => snapshot.id)).toEqual(
    expect.arrayContaining([...seededProviderSnapshotIds]),
  );
  return snapshots.data;
}

async function importCsvThroughRealWorker(
  request: APIRequestContext,
  projectId: string,
  definition: VerticalDefinition,
): Promise<void> {
  const route = `/api/mvp/projects/${projectId}/sources/csv/import`;
  const previewResponse = await request.post(route, {
    multipart: {
      templateId: "keyword_gap_v1",
      file: {
        name: "growth-map-keyword-gap.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(keywordGapCsv(definition), "utf8"),
      },
    },
  });
  const preview = await responseJson<DataEnvelope<PreviewData>>(
    previewResponse,
    "CSV preview",
  );
  expect(preview.data.rowCount).toBe(10);
  expect(preview.data.errors).toEqual([]);

  const confirmResponse = await request.post(route, {
    headers: { "Idempotency-Key": randomUUID() },
    data: {
      mode: "confirm",
      importToken: preview.data.importToken,
      mapping: KEYWORD_GAP_MAPPING,
    },
  });
  expect(
    confirmResponse.status(),
    `CSV confirm failed: ${await confirmResponse.text()}`,
  ).toBe(202);
  const accepted = await responseJson<DataEnvelope<AcceptedRun>>(
    confirmResponse,
    "CSV confirm",
  );
  expect(accepted.data.run.status).toBe("queued");
  await waitForRun(request, accepted.data.statusUrl, ["completed"]);
}

async function approveImportedGrowthGovernance(
  db: DbHandle,
  projectId: string,
): Promise<void> {
  const authority = await db.pool.query<{
    workspace_id: string;
    actor_id: string;
  }>(
    `SELECT
       project.workspace_id,
       operator.user_id AS actor_id
     FROM app.client_projects AS project
     INNER JOIN app.operator_profiles AS operator
       ON operator.workspace_id = project.workspace_id
     WHERE project.id = $1
     ORDER BY operator.created_at, operator.user_id
     LIMIT 1`,
    [projectId],
  );
  const canonicalAuthority = authority.rows[0];
  if (!canonicalAuthority) {
    throw new Error(
      "Growth Map fixture could not resolve its workspace-scoped review actor",
    );
  }
  const scope = {
    workspaceId: canonicalAuthority.workspace_id,
    projectId,
  };

  const keywords = await new KeywordsRepository(db.db).listByProject(scope, {
    limit: 20,
    cursor: null,
  });
  if (keywords.rows.length !== 10 || keywords.nextCursor !== null) {
    throw new Error(
      "Growth Map fixture requires exactly ten imported Keyword candidates",
    );
  }

  const topics = new TopicModelsRepository(db.db);
  const draft = await topics.beginDraftFromLatestConfirmed(
    scope,
    canonicalAuthority.actor_id,
    {
      expectedLatestConfirmedRevision: 0,
      reason: "Create the governed Topic for the Growth Map fixture.",
    },
  );
  const edited = await topics.patchDraft(
    scope,
    canonicalAuthority.actor_id,
    {
      topicModelRevision: draft.topicModelRevision,
      expectedEditRevision: draft.editRevision,
      reason: "Add the imported Keyword cluster before publication.",
      intents: [
        {
          kind: "create",
          parentTopicNodeId: null,
          label: "Revenue operations workflow",
          description:
            "Reviewed Keyword demand for the real Growth Map browser chain.",
          intentEnvelope: ["Commercial"],
        },
      ],
    },
  );
  const confirmed = await topics.confirmDraft(
    scope,
    canonicalAuthority.actor_id,
    {
      topicModelRevision: edited.topicModelRevision,
      expectedEditRevision: edited.editRevision,
      reason: "Confirm the Topic before freezing the Growth Audit generation.",
    },
  );
  if (confirmed.rootTopicNodeId === null) {
    throw new Error("Growth Map fixture did not produce a confirmed Topic root");
  }

  const governance = new KeywordGovernanceRepository(db.db);
  for (const keyword of keywords.rows) {
    await governance.reviewKeyword(
      scope,
      keyword.id,
      canonicalAuthority.actor_id,
      {
        expectedGovernanceRevision: keyword.mapping_revision,
        status: "approved",
        intent: "commercial",
        buyerStage: "consideration",
        topicNodeId: confirmed.rootTopicNodeId,
        topicModelRevision: confirmed.topicModelRevision,
        mappingDecision: "new_asset",
        mappedSitePageId: null,
        reason:
          "Approve the imported Keyword before freezing this browser fixture.",
      },
    );
  }

  const competitors = new CompetitorsRepository(db.db);
  const competitorPage = await competitors.listByProject(scope, {
    limit: 20,
    cursor: null,
  });
  if (
    competitorPage.rows.length !== 1 ||
    competitorPage.nextCursor !== null
  ) {
    throw new Error(
      "Growth Map fixture requires exactly one imported Competitor candidate",
    );
  }
  const competitor = competitorPage.rows[0]!;
  const reviewed = await competitors.review(scope, competitor.id, {
    expectedRevision: competitor.revision,
    name: competitor.name,
    reviewStatus: "approved",
    relationship: "direct",
    analysisScope: ["keyword_gap", "serp_visibility"],
  });
  if (!reviewed || reviewed.review_status !== "approved") {
    throw new Error(
      "Growth Map fixture could not approve its imported Competitor",
    );
  }
}

async function runGrowthAuditThroughRealApi(
  request: APIRequestContext,
  db: DbHandle,
  projectId: string,
): Promise<string> {
  const inputs = await db.pool.query<{
    site_id: string;
    icp_profile_id: string;
  }>(
    `SELECT
       site.id AS site_id,
       project.confirmed_icp_profile_id AS icp_profile_id
     FROM app.client_projects AS project
     INNER JOIN app.sites AS site
       ON site.workspace_id = project.workspace_id
      AND site.project_id = project.id
      AND site.is_primary
     WHERE project.id = $1
       AND project.confirmed_icp_profile_id IS NOT NULL
     LIMIT 1`,
    [projectId],
  );
  const canonicalInputs = inputs.rows[0];
  if (!canonicalInputs) {
    throw new Error(
      "confirmed Product Profile and primary Site were unavailable for Growth Audit",
    );
  }

  const response = await request.post(
    `/api/mvp/projects/${projectId}/audit-runs`,
    {
      headers: {
        "Idempotency-Key": randomUUID(),
        cookie: "sf_ui_locale=en",
      },
      data: {
        siteId: canonicalInputs.site_id,
        icpProfileId: canonicalInputs.icp_profile_id,
        scope: { kind: "site" },
        outputLocale: "en",
        capabilityContractVersion: "growth-audit.0.3.0",
      },
    },
  );
  expect(
    response.status(),
    `Growth Audit enqueue failed: ${await response.text()}`,
  ).toBe(202);
  const accepted = await responseJson<DataEnvelope<AcceptedRun>>(
    response,
    "Growth Audit enqueue",
  );
  expect(accepted.data.run.status).toBe("queued");
  await waitForRun(request, accepted.data.statusUrl, ["completed"]);
  return accepted.data.run.id;
}

function objectModeButton(page: Page, label: string): Locator {
  return page
    .getByRole("navigation", { name: "Growth Map objects" })
    .getByRole("button", { name: new RegExp(`^${label}`) });
}

function trackGrowthMapRscRequests(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.endsWith("/growth-map") &&
      url.searchParams.has("_rsc")
    ) {
      count += 1;
    }
  });
  return () => count;
}

async function expectOpportunityLedger(page: Page): Promise<void> {
  await expect(
    page.getByRole("list", { name: "Growth opportunities" }),
  ).toBeVisible();
}

async function openFullUrlDetail(detail: Locator): Promise<void> {
  const disclosure = detail.locator("[data-full-evidence-disclosure]");
  if ((await disclosure.getAttribute("open")) === null) {
    await disclosure.locator(":scope > summary").click();
  }
  await expect(disclosure).toHaveAttribute("open", "");
}

async function rapidObjectModeRoundTrip(page: Page): Promise<void> {
  const pages = objectModeButton(page, "Pages & opportunities");
  const keywords = objectModeButton(page, "Keyword library");
  const competitors = objectModeButton(page, "Competitor library");

  // Growth Map object state is same-page query state. Exercise three rapid
  // clicks without waiting for a server navigation; the final browser URL and
  // rendered pane must both retain the latest customer intent.
  await keywords.click();
  await competitors.click();
  await pages.click();
  await expect(pages).toHaveAttribute("aria-pressed", "true");
  await expect(pages).toHaveAttribute("aria-current", "page");
  await expect(keywords).toHaveAttribute("aria-pressed", "false");
  await expect(keywords).not.toHaveAttribute("aria-current", "page");
  await expect(competitors).toHaveAttribute("aria-pressed", "false");
  await expect(competitors).not.toHaveAttribute("aria-current", "page");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("object"), {
      message: "rapid object-tab round trip did not keep Pages as latest intent",
    })
    .toBe("pages");
  await expectOpportunityLedger(page);
}

async function rapidUrlSelectionRoundTrip(input: {
  readonly page: Page;
  readonly pageA: GrowthMapUrlDetail;
  readonly pageB: GrowthMapUrlDetail;
  readonly findingA: GrowthMapUrlFinding;
  readonly findingB: GrowthMapUrlFinding;
}): Promise<void> {
  const { page, pageA, pageB, findingA, findingB } = input;
  const rowA = opportunityRow(page, findingA.findingId);
  const rowB = opportunityRow(page, findingB.findingId);

  // Opportunity selection is same-page query state. Exercise a rapid B -> A
  // round trip without waiting; the address, the pressed row, and the rail
  // must all retain the latest intent.
  await rowB.click();
  await rowA.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedOpportunityId"))
    .toBe(findingA.findingId);
  await expect(rowA).toHaveAttribute("aria-pressed", "true");
  await expect(rowB).toHaveAttribute("aria-pressed", "false");

  const opportunityDetail = page.locator(
    `[data-opportunity-detail="${findingA.findingId}"]`,
  );
  await expect(opportunityDetail).toBeVisible();
  await opportunityDetail
    .getByRole("button", { name: new URL(pageA.normalizedUrl).pathname })
    .first()
    .click();
  const detail = page.locator('aside[aria-label="Selected URL detail"]');
  await openFullUrlDetail(detail);
  await expect(
    detail.getByTitle(pageA.sitePageId, { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByTitle(findingB.findingId, { exact: true }),
  ).toHaveCount(0);
  await expect(
    detail.getByTitle(pageB.sitePageId, { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Back to opportunities" }).click();
  await expect(opportunityDetail).toBeVisible();
}

async function readPortfolio(
  request: APIRequestContext,
  projectId: string,
): Promise<ReturnType<typeof GrowthMapUrlPortfolioResponse.parse>> {
  const response = await request.get(
    `/api/mvp/projects/${projectId}/audit/urls?limit=50`,
    {
      // Playwright's standalone request fixture is created before this test
      // adds the browser cookie. State the same workbench locale explicitly so
      // the real API exercises, rather than bypasses, the locale/run guard.
      headers: { cookie: "sf_ui_locale=en" },
    },
  );
  const envelope = await responseJson<DataEnvelope<unknown>>(
    response,
    "read Growth Map URL portfolio",
  );
  return GrowthMapUrlPortfolioResponse.parse(envelope.data);
}

async function readDetail(
  request: APIRequestContext,
  projectId: string,
  sitePageId: string,
): Promise<GrowthMapUrlDetail> {
  const response = await request.get(
    `/api/mvp/projects/${projectId}/audit/urls/${sitePageId}`,
    { headers: { cookie: "sf_ui_locale=en" } },
  );
  const envelope = await responseJson<DataEnvelope<unknown>>(
    response,
    `read Growth Map URL ${sitePageId}`,
  );
  return GrowthMapUrlDetailResponse.parse(envelope.data).data;
}

async function readKeywordLibrary(
  request: APIRequestContext,
  projectId: string,
): Promise<ReturnType<typeof GrowthMapKeywordLibraryResponse.parse>> {
  const response = await request.get(
    `/api/mvp/projects/${projectId}/audit/keywords?limit=50`,
    { headers: { cookie: "sf_ui_locale=en" } },
  );
  const envelope = await responseJson<DataEnvelope<unknown>>(
    response,
    "read Growth Map Keyword Library",
  );
  return GrowthMapKeywordLibraryResponse.parse(envelope.data);
}

async function readCompetitorLibrary(
  request: APIRequestContext,
  projectId: string,
): Promise<ReturnType<typeof GrowthMapCompetitorLibraryResponse.parse>> {
  const response = await request.get(
    `/api/mvp/projects/${projectId}/audit/competitors?limit=50`,
    { headers: { cookie: "sf_ui_locale=en" } },
  );
  const envelope = await responseJson<DataEnvelope<unknown>>(
    response,
    "read Growth Map Competitor Library",
  );
  return GrowthMapCompetitorLibraryResponse.parse(envelope.data);
}

async function warmJsonReadRoute(
  request: APIRequestContext,
  path: string,
): Promise<void> {
  const response = await request.get(path, {
    headers: { cookie: "sf_ui_locale=en" },
  });
  expect(response.ok(), `${path} failed on its first read`).toBe(true);
  await expect(
    response.json(),
    `${path} did not return JSON on its first read`,
  ).resolves.toBeDefined();
}

async function warmGrowthMapDetailRoutes(input: {
  readonly request: APIRequestContext;
  readonly projectId: string;
  readonly keywordIds: readonly string[];
  readonly selectedKeywordId: string;
  readonly selectedCompetitorId: string;
  readonly initialSitePageId: string;
}): Promise<void> {
  const {
    request,
    projectId,
    keywordIds,
    selectedKeywordId,
    selectedCompetitorId,
    initialSitePageId,
  } = input;
  const prefix = `/api/mvp/projects/${projectId}/audit`;
  const relationParams = new URLSearchParams({ limit: "100" });
  for (const keywordId of keywordIds) {
    relationParams.append("keywordId", keywordId);
  }
  const paths = [
    `${prefix}/topic-model`,
    `${prefix}/topic-model/insights`,
    `${prefix}/urls?limit=100`,
    `${prefix}/internal-link-map?sitePageId=${encodeURIComponent(initialSitePageId)}`,
    `${prefix}/keywords/${selectedKeywordId}?view=review`,
    `${prefix}/keywords/${selectedKeywordId}/rank-history`,
    `${prefix}/keyword-relations?${relationParams.toString()}`,
    `${prefix}/competitors/${selectedCompetitorId}?view=review`,
    `${prefix}/competitor-monitor`,
  ];
  for (const path of paths) await warmJsonReadRoute(request, path);
}

async function assertKeywordLibraryTraceability(input: {
  readonly page: Page;
  readonly item: GrowthMapKeywordLibraryItem;
  readonly expectedCount: number;
  readonly csvSnapshotId: string;
}): Promise<void> {
  const { page, item, expectedCount, csvSnapshotId } = input;
  const intakePath = page.getByRole("region", {
    name: "Intake path",
  });
  await expect(intakePath).toBeVisible();

  const keywordSearch = page.getByRole("searchbox", {
    name: "Search a Keyword, market, language, or mapped page",
  });
  const sourceFilter = page.getByRole("combobox", {
    name: "Source filter",
  });
  await expect(keywordSearch).toBeVisible();
  await expect(sourceFilter).toBeVisible();

  let list = page.getByRole("list", { name: "Keyword list" });
  await expect(list.locator("li button[aria-pressed]")).toHaveCount(
    expectedCount,
  );
  await expect(
    list.locator("xpath=preceding-sibling::*[1]").locator(":scope > span"),
  ).toHaveCount(8);

  await sourceFilter.selectOption("csv_import");
  await expect(sourceFilter).toHaveValue("csv_import");
  await expect(
    intakePath.getByRole("button", { name: /^CSV import\b/ }),
  ).toHaveAttribute("aria-pressed", "true");

  // Prove that search changes the rendered library before restoring one exact,
  // fixture-derived result. The assertion never relies on repository ordering.
  await keywordSearch.fill("__growth_map_no_matching_keyword__");
  await expect(list).toHaveCount(0);
  await keywordSearch.fill(item.displayKeyword);
  list = page.getByRole("list", { name: "Keyword list" });
  await expect(list.locator("li button[aria-pressed]")).toHaveCount(1);
  const row = list.locator("li button[aria-pressed]").filter({
    hasText: item.displayKeyword,
  });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-pressed", "true");

  const detail = page.locator('aside[aria-label="Selected Keyword detail"]');
  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: item.displayKeyword,
      exact: true,
    }),
  ).toBeVisible({ timeout: CLIENT_READ_MODEL_TIMEOUT_MS });

  // Clicking the already synchronized filtered row makes its identity explicit
  // in the address without changing the selected detail.
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedKeywordId"))
    .toBe(item.keywordId);

  // The detail rail is correct only when the selected Keyword's exact text has
  // arrived inside the panel, but the h2 can briefly remount while the
  // relation/read-model refresh settles. Assert the operator-visible identity
  // on the panel itself, then continue into the immutable record details.
  // The rail now keeps its landmark name while loading, so this wait is the
  // only gate on the read model; hold it to the same deadline as the other
  // rails rather than a shorter local one.
  await expect(detail).toContainText(item.displayKeyword, {
    timeout: CLIENT_READ_MODEL_TIMEOUT_MS,
  });
  const recordDetails = detail.locator("details").filter({
    hasText: "View record details",
  });
  await recordDetails.locator("summary").click();
  await expect(
    recordDetails.getByTitle(item.keywordId, { exact: true }),
  ).toBeVisible();

  const occurrence = item.sourceOccurrences.find(
    (candidate) =>
      candidate.sourceKind === "csv_import" &&
      candidate.snapshotId === csvSnapshotId,
  );
  if (!occurrence || occurrence.sourceKind !== "csv_import") {
    throw new Error(
      `${item.displayKeyword} lost its exact CSV Keyword source occurrence`,
    );
  }
  const sourceCard = detail
    .getByTitle(occurrence.occurrenceId, { exact: true })
    .locator("xpath=ancestor::article[1]");
  await sourceCard.getByText("View source details", { exact: true }).click();
  for (const identity of [
    occurrence.occurrenceId,
    occurrence.snapshotId,
    occurrence.sourceObservationId,
    occurrence.importPreviewId,
  ]) {
    if (identity === null) {
      throw new Error(`${item.displayKeyword} emitted incomplete CSV lineage`);
    }
    await expect(
      sourceCard.getByTitle(identity, { exact: true }),
    ).toBeVisible();
  }
  await expect(
    sourceCard.getByText(occurrence.sourcePointer, { exact: true }),
  ).toBeVisible();
}

async function assertCompetitorLibraryTraceability(input: {
  readonly page: Page;
  readonly item: GrowthMapCompetitorLibraryItem;
  readonly expectedCount: number;
  readonly csvSnapshotId: string;
}): Promise<void> {
  const { page, item, expectedCount, csvSnapshotId } = input;
  const discoveryPath = page
    .getByTestId("competitor-library-provenance")
    .getByRole("region", { name: "Discovery path" });
  await expect(discoveryPath).toBeVisible({
    timeout: CLIENT_READ_MODEL_TIMEOUT_MS,
  });

  const competitorSearch = page.getByRole("searchbox", {
    name: "Search Competitors",
  });
  const statusFilter = page.getByRole("combobox", {
    name: "Status filter",
  });
  await expect(competitorSearch).toBeVisible();
  await expect(statusFilter).toBeVisible();

  let list = page.getByRole("list", { name: "Competitor list" });
  await expect(list.locator("li button[aria-pressed]")).toHaveCount(
    expectedCount,
  );
  await expect(
    list.locator("xpath=preceding-sibling::*[1]").locator(":scope > span"),
  ).toHaveCount(7);

  await statusFilter.selectOption("approved");
  await expect(statusFilter).toHaveValue("approved");
  await competitorSearch.fill("__growth_map_no_matching_competitor__");
  await expect(list).toHaveCount(0);
  await competitorSearch.fill(item.domain);
  list = page.getByRole("list", { name: "Competitor list" });
  await expect(list.locator("li button[aria-pressed]")).toHaveCount(1);
  const row = list.locator("li button[aria-pressed]").filter({
    hasText: item.domain,
  });
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-pressed", "true");

  const detail = page.locator('aside[aria-label="Selected Competitor detail"]');
  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: item.name ?? item.domain,
      exact: true,
    }),
  ).toBeVisible({ timeout: CLIENT_READ_MODEL_TIMEOUT_MS });

  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedCompetitorId"))
    .toBe(item.competitorId);

  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: item.name ?? item.domain,
      exact: true,
    }),
  ).toBeVisible({ timeout: CLIENT_READ_MODEL_TIMEOUT_MS });
  const recordDetails = detail.locator("details").filter({
    hasText: "View record details",
  });
  await recordDetails.locator("summary").click();
  await expect(
    recordDetails.getByTitle(item.competitorId, { exact: true }),
  ).toBeVisible();

  const origin = item.originOccurrences.find(
    (candidate) =>
      candidate.originKind === "csv_keyword_gap" &&
      candidate.snapshotId === csvSnapshotId,
  );
  if (!origin || origin.originKind !== "csv_keyword_gap") {
    throw new Error(`${item.domain} lost its exact CSV Competitor origin`);
  }
  const originCard = detail
    .getByTitle(origin.occurrenceId, { exact: true })
    .locator("xpath=ancestor::article[1]");
  await originCard.getByText("View source details", { exact: true }).click();
  for (const identity of [
    origin.occurrenceId,
    origin.snapshotId,
    origin.observationId,
    origin.importPreviewId,
  ]) {
    await expect(
      originCard.getByTitle(identity, { exact: true }),
    ).toBeVisible();
  }
  await expect(
    originCard.getByText(origin.sourcePointer, { exact: true }),
  ).toBeVisible();
}

async function assertUrlPortfolioPresentation(input: {
  readonly page: Page;
  readonly expectedFrozenUrlCount: number;
}): Promise<void> {
  const { page, expectedFrozenUrlCount } = input;
  const summary = page.getByRole("region", {
    name: "Growth Map scope summary",
  });
  await expect(summary).toBeVisible();
  await expect(summary.locator(":scope > div")).toHaveCount(4);
  const collectedPages = summary
    .getByText("Collected pages", { exact: true })
    .locator("xpath=parent::*[1]");
  await expect(collectedPages.locator(":scope > strong")).toHaveText(
    String(expectedFrozenUrlCount),
  );

  await expect(
    page.getByRole("combobox", { name: "Page type" }),
  ).toBeVisible();
  const moreFilters = page.getByRole("button", { name: "More filters" });
  await moreFilters.click();
  await expect(moreFilters).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("combobox", { name: "Priority" }),
  ).toBeVisible();
  await moreFilters.click();
  await expect(moreFilters).toHaveAttribute("aria-expanded", "false");
}

function opportunityRow(page: Page, findingId: string): Locator {
  return page
    .locator(`[data-growth-map-opportunity-row="${findingId}"]`)
    .getByRole("button")
    .first();
}

function exclusiveFinding(
  selected: GrowthMapUrlDetail,
  other: GrowthMapUrlDetail,
): GrowthMapUrlFinding {
  const otherIds = new Set(other.findings.map((finding) => finding.findingId));
  const finding = selected.findings.find(
    (candidate) => !otherIds.has(candidate.findingId),
  );
  if (!finding) {
    throw new Error(
      `${selected.normalizedUrl} has no Finding identity exclusive from ${other.normalizedUrl}`,
    );
  }
  return finding;
}

function expectCompleteCustomerTitle(finding: GrowthMapUrlFinding): void {
  expect(finding.title.trim().length).toBeGreaterThan(0);
  expect(finding.title).not.toContain("()");
  expect(finding.title).not.toMatch(/\s{2,}/);
  expect(finding.title).not.toMatch(/position\s*\.$/);
}

function metricLabel(observation: GrowthMapUrlMetricObservation): string {
  const source =
    observation.valueSource.kind === "value_json"
      ? observation.valueSource.pointer
      : "value_numeric";
  const label = METRIC_LABELS[`${observation.provider}:${source}`];
  if (!label) {
    throw new Error(
      `Growth Map real E2E has no UI label for ${observation.provider}:${source}`,
    );
  }
  return label;
}

function formattedMetricValue(observation: GrowthMapUrlMetricObservation): string {
  if (observation.availability !== "available" || observation.value === null) {
    throw new Error("Growth Map real fixture unexpectedly emitted a missing metric");
  }
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: Number.isInteger(observation.value) ? 0 : 2,
  }).format(observation.value);
}

async function assertExactSelection(input: {
  readonly page: Page;
  readonly expected: GrowthMapUrlDetail;
  readonly other: GrowthMapUrlDetail;
  readonly expectedFinding: GrowthMapUrlFinding;
  readonly otherFinding: GrowthMapUrlFinding;
  readonly select?: boolean;
}): Promise<void> {
  const {
    page,
    expected,
    other,
    expectedFinding,
    otherFinding,
    select = true,
  } = input;
  const selectedRow = opportunityRow(page, expectedFinding.findingId);
  const otherRow = opportunityRow(page, otherFinding.findingId);
  if (select) {
    // Select the Opportunity that owns the exclusive Finding, then drill into
    // its exact target URL from the detail rail.
    await selectedRow.click();
    await expect(selectedRow).toHaveAttribute("aria-pressed", "true");
    await expect(otherRow).toHaveAttribute("aria-pressed", "false");
    await page
      .locator(`[data-opportunity-detail="${expectedFinding.findingId}"]`)
      .getByRole("button", { name: new URL(expected.normalizedUrl).pathname })
      .first()
      .click();
  }

  await expect
    .poll(
      () => new URL(page.url()).searchParams.get("selectedSitePageId"),
      { message: `address did not select ${expected.sitePageId}` },
    )
    .toBe(expected.sitePageId);

  const detail = page.locator('aside[aria-label="Selected URL detail"]');
  // The rail keeps its landmark name while empty, loading, and failed, so its
  // mere presence no longer proves the read model arrived. Wait for the
  // selected URL's own heading instead, on the same client read-model deadline
  // the Competitor rail already uses.
  const expectedPath = new URL(expected.normalizedUrl).pathname;
  const detailHeading = detail.getByRole("heading", {
    level: 2,
    name: expectedPath,
    exact: true,
  });
  await expect(detailHeading).toBeVisible({
    timeout: CLIENT_READ_MODEL_TIMEOUT_MS,
  });
  await expect(detailHeading).toHaveAttribute(
    "title",
    expected.normalizedUrl,
  );
  await openFullUrlDetail(detail);
  const detailTitle = detailHeading.locator("xpath=following-sibling::p[1]");
  await expect(detailTitle).toHaveText(
    expected.title ?? "Page title not collected",
  );
  await expect(
    detail.getByRole("link", {
      name: "Open the live page in a new tab",
    }),
  ).toHaveAttribute("href", expected.normalizedUrl);
  await expect(
    detail.getByTitle(expected.sitePageId, { exact: true }),
  ).toBeVisible();

  // Keep the descendant selector relative to each candidate article. Passing
  // a locator rooted at `detail` into `filter({ has })` carries the aside
  // ancestor into Playwright's relative match and yields zero records even
  // though the real MetricLedger DOM contains `[data-provider]` descendants.
  const metricRecords = detail.locator("article:has([data-provider])");
  await expect(metricRecords).toHaveCount(expected.metricObservations.length);
  for (const observation of expected.metricObservations) {
    const record = metricRecords.filter({ hasText: metricLabel(observation) });
    await expect(record).toHaveCount(1);
    await expect(
      record.getByText(formattedMetricValue(observation), { exact: true }),
    ).toBeVisible();
    await expect(
      record.getByTitle(observation.observationId, { exact: true }),
    ).toBeVisible();
  }

  const findingId = detail.getByTitle(expectedFinding.findingId, {
    exact: true,
  });
  await expect(findingId).toBeVisible();
  const findingCard = findingId.locator("xpath=ancestor::article[1]");
  await expect(
    findingCard.getByText(expectedFinding.ruleId, { exact: true }),
  ).toBeVisible();
  await expect(
    findingCard.getByRole("heading", {
      level: 4,
      name: expectedFinding.title,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    findingCard.getByTitle(expectedFinding.targetRelation.targetRef, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    detail.getByTitle(otherFinding.findingId, { exact: true }),
  ).toHaveCount(0);
  await expect(
    detail.getByTitle(other.sitePageId, { exact: true }),
  ).toHaveCount(0);

  const traceability = detail.locator("[data-identity-ledger]");
  if ((await traceability.getAttribute("open")) === null) {
    await traceability.locator("summary").click();
  }
  await expect(traceability).toHaveAttribute("open", "");
  if (expected.pageSnapshotId === null) {
    throw new Error(`${expected.normalizedUrl} lost its Crawl PageSnapshot`);
  }
  await expect(
    traceability.getByTitle(expected.pageSnapshotId, { exact: true }),
  ).toBeVisible();
  for (const source of expected.identitySources) {
    const sourceId =
      source.kind === "page_snapshot"
        ? source.pageSnapshotId
        : source.observationId;
    await expect(
      traceability.getByTitle(sourceId, { exact: true }),
    ).toBeVisible();
  }

  // Drilling from an Opportunity pins its exact primary Finding, so the rail
  // opens straight in Opportunity Review; Confirm belongs only to this exact
  // canonical Finding. Audit Evidence stays the read-only state without any
  // review control.
  const detailState = detail.getByRole("group", {
    name: "Selected URL detail state",
  });
  const evidenceState = detailState.getByRole("button", {
    name: /^Audit Evidence/,
  });
  const reviewState = detailState.getByRole("button", {
    name: /^Opportunity Review/,
  });
  await expect(reviewState).toHaveAttribute("aria-pressed", "true");
  await expect(
    detail.locator('[data-detail-panel="opportunity-review"]'),
  ).toBeVisible();
  const reviewFindingCard = detail
    .getByTitle(expectedFinding.findingId, { exact: true })
    .locator("xpath=ancestor::article[1]");
  if (expected.reviewableFindingIds.includes(expectedFinding.findingId)) {
    await expect(
      reviewFindingCard.getByRole("button", { name: "Confirm", exact: true }),
    ).toBeVisible();
  } else {
    await expect(
      reviewFindingCard.getByRole("button", { name: "Confirm", exact: true }),
    ).toHaveCount(0);
  }

  await evidenceState.click();
  await expect(evidenceState).toHaveAttribute("aria-pressed", "true");
  await expect(
    detail.locator('[data-detail-panel="audit-evidence"]'),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Confirm", exact: true }),
  ).toHaveCount(0);

  // Leave the rail in Opportunity Review so a follow-up confirmation can act
  // on the exact card this assertion just verified.
  await reviewState.click();
  await expect(
    detail.locator('[data-detail-panel="opportunity-review"]'),
  ).toBeVisible();
}

async function switchObjectMode(
  page: Page,
  label: string,
  object: "pages" | "keywords" | "competitors",
): Promise<void> {
  const button = objectModeButton(page, label);
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("object"))
    .toBe(object);
  if (object === "pages") await expectOpportunityLedger(page);
}

test.describe.serial("real Growth Map selected-page identity", () => {
  test.describe.configure({ retries: 0 });

  let db: DbHandle | undefined;
  let worker: WorkerRuntime | undefined;
  let projectId: string | undefined;

  test.beforeAll(async () => {
    configureWorkerEnvironment();
    db = createDbHandle(DATABASE_URL!, 4);
    const workerModule = await import("../apps/worker/src/index.ts");
    worker = await workerModule.start({
      installSignalHandlers: false,
      shutdownStageTimeoutMs: 10_000,
    });
  });

  test.afterAll(async () => {
    let shutdownResult: WorkerShutdownResult | undefined;
    try {
      shutdownResult = await worker?.stop();
      // This suite may run before the older real-chain file, whose explicit
      // freshness guard expects no prior pg-boss deliveries. Remove only jobs
      // whose canonical async_run belongs to this disposable fixture project.
      // Analysis Refresh continuations intentionally have a fresh pg-boss id,
      // so bind them through their immutable payload.runId as well as the
      // initial job.id = async_runs.id delivery. Application audit rows and
      // jobs from every other project are preserved.
      if (db && projectId) {
        await db.pool.query(
          `DELETE FROM pgboss.job AS job
            USING app.async_runs AS run
           WHERE run.project_id = $1
             AND (
               job.id = run.id
               OR job.data ->> 'runId' = run.id::text
             )`,
          [projectId],
        );
      }
    } finally {
      await db?.end();
    }
    if (shutdownResult) expect(shutdownResult.ok).toBe(true);
  });

  test("keeps rapid tab and A -> B -> A latest intent exact across address, row, detail, metrics, and Finding identity", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!db) throw new Error("real Growth Map fixture database did not start");

    const definition = verticalDefinition("b2b", randomUUID().slice(0, 8));
    projectId = await createProjectInBrowser(page, definition);
    await completeContext(request, projectId, definition);
    await importCsvThroughRealWorker(request, projectId, definition);
    await approveImportedGrowthGovernance(db, projectId);
    const seededProviderSnapshotIds = await seedOfflineProviderSnapshots(
      db,
      projectId,
      definition,
    );
    const diagnosticSnapshots = await readDiagnosticSnapshots(
      request,
      projectId,
      seededProviderSnapshotIds,
    );
    const diagnosticRunId = await runGrowthAuditThroughRealApi(
      request,
      db,
      projectId,
    );
    await publishDiagnosticThroughAnalysisRefresh(
      db,
      projectId,
      diagnosticRunId,
    );

    const portfolio = await readPortfolio(request, projectId);
    expect(portfolio.data).toHaveLength(2);
    expect(
      portfolio.data.some(
        (item) => item.normalizedUrl === `${definition.siteUrl}/about`,
      ),
      "URLs without an Opportunity must stay out of the actionable portfolio",
    ).toBe(false);
    const keywordLibrary = await readKeywordLibrary(request, projectId);
    const competitorLibrary = await readCompetitorLibrary(request, projectId);
    expect(keywordLibrary.data).toHaveLength(10);
    expect(competitorLibrary.data).toHaveLength(1);
    const csvSnapshot = diagnosticSnapshots.find(
      (snapshot) => snapshot.provider === "csv",
    );
    if (!csvSnapshot) {
      throw new Error("real Growth Map fixture lost its CSV Snapshot identity");
    }
    // Use a search term unique within the loaded fixture rather than relying
    // on repository ordering or an implicit first-row selection.
    const keyword = keywordLibrary.data.find(
      (item) =>
        item.sourceOccurrences.some(
          (occurrence) =>
            occurrence.sourceKind === "csv_import" &&
            occurrence.snapshotId === csvSnapshot.id,
        ) &&
        keywordLibrary.data.every(
          (candidate) =>
            candidate.keywordId === item.keywordId ||
            !candidate.displayKeyword
              .toLocaleLowerCase("en")
              .includes(item.displayKeyword.toLocaleLowerCase("en")),
        ),
    );
    const competitor = competitorLibrary.data.find((item) =>
      item.originOccurrences.some(
        (origin) =>
          origin.originKind === "csv_keyword_gap" &&
          origin.snapshotId === csvSnapshot.id,
      ),
    );
    if (!keyword || !competitor) {
      throw new Error(
        "real Growth Map libraries lost their exact CSV Snapshot lineage",
      );
    }
    const pageA = portfolio.data.find(
      (item) => item.normalizedUrl === `${definition.siteUrl}/product`,
    );
    const pageB = portfolio.data.find(
      (item) => item.normalizedUrl === `${definition.siteUrl}/gone`,
    );
    const initialPortfolioPage = portfolio.data[0];
    if (!pageA || !pageB || !initialPortfolioPage) {
      throw new Error("real Growth Map portfolio lost /product or /gone");
    }
    // Next development mode compiles these dynamic API routes lazily. Read
    // each route exactly once, serially, before measuring browser navigation
    // so an HMR refresh from compilation cannot be mistaken for an
    // interaction-driven RSC request. Any first-read HTTP or JSON failure is a
    // real test failure; the browser then exercises the same reads below.
    await warmGrowthMapDetailRoutes({
      request,
      projectId,
      keywordIds: keywordLibrary.data.map((item) => item.keywordId),
      selectedKeywordId: keyword.keywordId,
      selectedCompetitorId: competitor.competitorId,
      // The UI applies the first visible portfolio ID when the URL carries no
      // explicit selection, so compile the exact first-render detail route.
      initialSitePageId: initialPortfolioPage.sitePageId,
    });
    const [detailA, detailB] = await Promise.all([
      readDetail(request, projectId, pageA.sitePageId),
      readDetail(request, projectId, pageB.sitePageId),
    ]);
    expect(detailA.title).toBe("Product Overview");
    expect(detailB.title).toBeNull();
    expect(detailA.findings.length).toBeGreaterThan(0);
    expect(detailB.findings.length).toBeGreaterThan(0);
    for (const finding of [...detailA.findings, ...detailB.findings]) {
      expectCompleteCustomerTitle(finding);
    }
    const findingA = exclusiveFinding(detailA, detailB);
    const findingB = exclusiveFinding(detailB, detailA);

    await page.goto(`/p/${projectId}/growth-map`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Find the next growth opportunity, page by real page.",
      }),
    ).toBeVisible();
    await expectOpportunityLedger(page);
    await assertUrlPortfolioPresentation({
      page,
      expectedFrozenUrlCount: portfolio.meta.summary.urlCount,
    });
    const growthMapRscRequestCount = trackGrowthMapRscRequests(page);
    await switchObjectMode(page, "Keyword library", "keywords");
    await assertKeywordLibraryTraceability({
      page,
      item: keyword,
      expectedCount: keywordLibrary.data.length,
      csvSnapshotId: csvSnapshot.id,
    });
    expect(
      growthMapRscRequestCount(),
      "Keyword row selection must remain client-side query state",
    ).toBe(0);
    await switchObjectMode(page, "Competitor library", "competitors");
    await assertCompetitorLibraryTraceability({
      page,
      item: competitor,
      expectedCount: competitorLibrary.data.length,
      csvSnapshotId: csvSnapshot.id,
    });
    expect(
      growthMapRscRequestCount(),
      "Competitor row selection must remain client-side query state",
    ).toBe(0);
    await switchObjectMode(page, "Pages & opportunities", "pages");
    await rapidObjectModeRoundTrip(page);
    await switchObjectMode(page, "Competitor library", "competitors");
    await expect(
      page.getByRole("list", { name: "Competitor list" }),
    ).toBeVisible();
    await switchObjectMode(page, "Keyword library", "keywords");
    await expect(
      page.getByRole("list", { name: "Keyword list" }),
    ).toBeVisible();
    await switchObjectMode(page, "Pages & opportunities", "pages");

    await assertExactSelection({
      page,
      expected: detailA,
      other: detailB,
      expectedFinding: findingA,
      otherFinding: findingB,
    });
    expect(
      growthMapRscRequestCount(),
      "URL row selection must remain client-side query state",
    ).toBe(0);
    await rapidUrlSelectionRoundTrip({
      page,
      pageA: detailA,
      pageB: detailB,
      findingA,
      findingB,
    });
    expect(
      growthMapRscRequestCount(),
      "rapid URL row selection must not reintroduce an RSC race",
    ).toBe(0);
    await assertExactSelection({
      page,
      expected: detailB,
      other: detailA,
      expectedFinding: findingB,
      otherFinding: findingA,
    });
    await assertExactSelection({
      page,
      expected: detailA,
      other: detailB,
      expectedFinding: findingA,
      otherFinding: findingB,
    });

    const findingToConfirm = detailA.findings.find(
      (finding) =>
        finding.reviewState === "unreviewed" &&
        detailA.reviewableFindingIds.includes(finding.findingId),
    );
    if (!findingToConfirm) {
      throw new Error("real Growth Map fixture had no reviewable Finding to confirm");
    }
    const confirmationCard = page
      .getByTitle(findingToConfirm.findingId, { exact: true })
      .locator("xpath=ancestor::article[1]");
    const confirmationResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "PATCH" &&
        url.pathname ===
          `/api/mvp/projects/${projectId}/findings/${findingToConfirm.findingId}`
      );
    });
    await confirmationCard
      .getByRole("button", { name: "Confirm", exact: true })
      .click();
    const confirmed = await confirmationResponse;
    expect(
      confirmed.status(),
      `Finding confirmation failed: ${await confirmed.text()}`,
    ).toBe(200);
    await expect(
      confirmationCard.getByText("Confirmed", { exact: true }),
    ).toBeVisible();
    await expect(
      confirmationCard.getByRole("button", { name: "Confirm", exact: true }),
    ).toHaveCount(0);
    await expect(
      confirmationCard.getByRole("link", {
        name: /^Open Execution\b/,
      }),
    ).toBeVisible();

    const detailAfterConfirmation = await readDetail(
      request,
      projectId,
      detailA.sitePageId,
    );
    const confirmedFinding = detailAfterConfirmation.findings.find(
      (finding) => finding.findingId === findingToConfirm.findingId,
    );
    expect(confirmedFinding).toMatchObject({
      reviewState: "confirmed",
      reviewRevision: findingToConfirm.reviewRevision + 1,
      executionRef: {
        artifactIds: [],
      },
    });
    expect(confirmedFinding?.executionRef?.actionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
  });
});
