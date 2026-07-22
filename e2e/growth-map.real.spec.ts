import { randomUUID } from "node:crypto";
import {
  GrowthMapUrlDetailResponse,
  GrowthMapUrlPortfolioResponse,
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
import { createDbHandle, type DbHandle } from "../packages/db/src/index.ts";
import type { WorkerShutdownResult } from "../apps/worker/src/shutdown-coordinator.ts";
import {
  KEYWORD_GAP_MAPPING,
  completeContextBody,
  keywordGapCsv,
  seedOfflineProviderSnapshots,
  verticalDefinition,
  type VerticalDefinition,
} from "./real-chain-fixture.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const DATABASE_URL = process.env["E2E_DATABASE_URL"];
const BLOB_DIR = "/tmp/signalframe-e2e-real-blobs";

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
  await expect(page.getByRole("heading", { name: "New project" })).toBeVisible();
  await page.getByLabel("Client name").fill(definition.clientName);
  await page.getByLabel("Project name").fill(definition.projectName);
  await page.getByLabel("Site URL").fill(definition.siteUrl);
  await page.getByLabel("Target markets").fill("US");
  await page.getByLabel("Site languages").fill("en");
  await page.getByLabel("Delivery language").fill("en");

  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/mvp/projects",
  );
  await page.getByRole("button", { name: "Create project" }).click();
  const created = await createResponse;
  expect(
    created.status(),
    `create project failed: ${await created.text()}`,
  ).toBe(201);
  await page.waitForURL(/\/p\/[0-9a-f-]+\/overview$/);
  const match = new URL(page.url()).pathname.match(
    /^\/p\/([0-9a-f-]+)\/overview$/,
  );
  if (!match?.[1]) throw new Error("created project id was missing from URL");
  return match[1];
}

async function completeContext(
  request: APIRequestContext,
  projectId: string,
  definition: VerticalDefinition,
): Promise<void> {
  const response = await request.patch(
    `/api/mvp/projects/${projectId}/context`,
    { data: completeContextBody(definition) },
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
        if (observed === "failed" || observed === "cancelled") {
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
  expect(confirmResponse.status()).toBe(202);
  const accepted = await responseJson<DataEnvelope<AcceptedRun>>(
    confirmResponse,
    "CSV confirm",
  );
  expect(accepted.data.run.status).toBe("queued");
  await waitForRun(request, accepted.data.statusUrl, ["completed"]);
}

async function runDiagnosisThroughBrowser(
  page: Page,
  request: APIRequestContext,
  projectId: string,
): Promise<void> {
  await page.goto(`/p/${projectId}/diagnosis`);
  await expect(
    page.getByRole("heading", {
      name: "Every finding should stand up to scrutiny.",
    }),
  ).toBeVisible();
  const acceptedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.pathname === `/api/mvp/projects/${projectId}/diagnostic-runs`
    );
  });
  const runButton = page.getByRole("button", {
    name: "Run diagnosis",
    exact: true,
  });
  await expect(runButton).toBeEnabled();
  await runButton.click();
  const response = await acceptedResponse;
  expect(
    response.status(),
    `diagnosis enqueue failed: ${await response.text()}`,
  ).toBe(202);
  const accepted = await responseJson<DataEnvelope<AcceptedRun>>(
    response,
    "diagnosis enqueue",
  );
  await waitForRun(request, accepted.data.statusUrl, ["completed"]);
  await expect(
    page.getByRole("article", { name: "HTTP status errors" }),
  ).toBeVisible({ timeout: 45_000 });
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

function exactPortfolioRow(page: Page, normalizedUrl: string): Locator {
  const portfolio = page.getByRole("list", {
    name: "URLs and opportunities",
  });
  return portfolio
    .getByTitle(normalizedUrl, { exact: true })
    .locator("xpath=ancestor::button[1]");
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
}): Promise<void> {
  const { page, expected, other, expectedFinding, otherFinding } = input;
  const selectedRow = exactPortfolioRow(page, expected.normalizedUrl);
  const otherRow = exactPortfolioRow(page, other.normalizedUrl);
  await selectedRow.click();

  await expect
    .poll(
      () => new URL(page.url()).searchParams.get("selectedSitePageId"),
      { message: `address did not select ${expected.sitePageId}` },
    )
    .toBe(expected.sitePageId);
  await expect(selectedRow).toHaveAttribute("aria-pressed", "true");
  await expect(otherRow).toHaveAttribute("aria-pressed", "false");

  const detail = page.locator('aside[aria-label="Selected URL detail"]');
  await expect(detail).toBeVisible();
  const expectedPath = new URL(expected.normalizedUrl).pathname;
  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: expectedPath,
      exact: true,
    }),
  ).toHaveAttribute("title", expected.normalizedUrl);
  await expect(
    detail.getByText(expected.title ?? "Page title not collected", {
      exact: true,
    }),
  ).toBeVisible();
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

  const traceability = detail.locator("details").filter({
    hasText: "Inspect data provenance",
  });
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

  // Every URL selection must remount in the read-only evidence state. Review
  // controls may exist only after the operator explicitly enters Opportunity
  // Review, and even there they belong to this exact canonical Finding.
  const detailState = detail.getByRole("group", {
    name: "Selected URL detail state",
  });
  const evidenceState = detailState.getByRole("button", {
    name: /^Audit Evidence/,
  });
  const reviewState = detailState.getByRole("button", {
    name: /^Opportunity Review/,
  });
  await expect(evidenceState).toHaveAttribute("aria-pressed", "true");
  await expect(
    detail.locator('[data-detail-panel="audit-evidence"]'),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Confirm", exact: true }),
  ).toHaveCount(0);

  await reviewState.click();
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
}

async function switchObjectMode(
  page: Page,
  label: string,
  object: "pages" | "keywords" | "competitors",
  expectedHeading?: string,
): Promise<void> {
  const navigation = page.getByRole("navigation", {
    name: "Growth Map objects",
  });
  const button = navigation.getByRole("button", {
    name: new RegExp(`^${label}`),
  });
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("object"))
    .toBe(object);
  if (expectedHeading) {
    await expect(
      page.getByRole("heading", { level: 2, name: expectedHeading }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("list", { name: "URLs and opportunities" }),
    ).toBeVisible();
  }
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
      // whose canonical async_run belongs to this disposable fixture project;
      // application audit rows and jobs from every other project are preserved.
      if (db && projectId) {
        await db.pool.query(
          `DELETE FROM pgboss.job AS job
            USING app.async_runs AS run
           WHERE job.id = run.id
             AND run.project_id = $1`,
          [projectId],
        );
      }
    } finally {
      await db?.end();
    }
    if (shutdownResult) expect(shutdownResult.ok).toBe(true);
  });

  test("switches object libraries, then keeps A -> B -> A address, row, detail, metrics, and Finding identity exact", async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    if (!db) throw new Error("real Growth Map fixture database did not start");

    const definition = verticalDefinition("b2b", randomUUID().slice(0, 8));
    projectId = await createProjectInBrowser(page, definition);
    await completeContext(request, projectId, definition);
    await importCsvThroughRealWorker(request, projectId, definition);
    await seedOfflineProviderSnapshots(db, projectId, definition);
    await runDiagnosisThroughBrowser(page, request, projectId);

    const portfolio = await readPortfolio(request, projectId);
    expect(portfolio.data).toHaveLength(3);
    const pageA = portfolio.data.find(
      (item) => item.normalizedUrl === `${definition.siteUrl}/product`,
    );
    const pageB = portfolio.data.find(
      (item) => item.normalizedUrl === `${definition.siteUrl}/gone`,
    );
    if (!pageA || !pageB) {
      throw new Error("real Growth Map portfolio lost /product or /gone");
    }
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
    await switchObjectMode(
      page,
      "Keyword library",
      "keywords",
      "No traceable keyword records yet",
    );
    await switchObjectMode(
      page,
      "Competitor library",
      "competitors",
      "No traceable competitor records yet",
    );
    await switchObjectMode(page, "Pages & opportunities", "pages");
    await switchObjectMode(
      page,
      "Competitor library",
      "competitors",
      "No traceable competitor records yet",
    );
    await switchObjectMode(
      page,
      "Keyword library",
      "keywords",
      "No traceable keyword records yet",
    );
    await switchObjectMode(page, "Pages & opportunities", "pages");

    await assertExactSelection({
      page,
      expected: detailA,
      other: detailB,
      expectedFinding: findingA,
      otherFinding: findingB,
    });
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
