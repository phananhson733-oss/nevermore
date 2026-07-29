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
  expect(snapshots.data.map((snapshot) => snapshot.provider).sort()).toEqual([
    "crawl",
    "csv",
    "ga4",
    "gsc",
  ]);
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

async function runDiagnosisThroughRealApi(
  request: APIRequestContext,
  projectId: string,
  snapshotIds: readonly string[],
): Promise<void> {
  const response = await request.post(
    `/api/mvp/projects/${projectId}/diagnostic-runs`,
    {
      headers: {
        "Idempotency-Key": randomUUID(),
        cookie: "sf_ui_locale=en",
      },
      data: {
        snapshotIds,
        outputLocale: "en",
      },
    },
  );
  expect(
    response.status(),
    `diagnosis enqueue failed: ${await response.text()}`,
  ).toBe(202);
  const accepted = await responseJson<DataEnvelope<AcceptedRun>>(
    response,
    "diagnosis enqueue",
  );
  expect(accepted.data.run.status).toBe("queued");
  await waitForRun(request, accepted.data.statusUrl, ["completed"]);
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
  await expect(
    page.getByRole("list", { name: "URLs and opportunities" }),
  ).toBeVisible();
}

async function rapidUrlSelectionRoundTrip(input: {
  readonly page: Page;
  readonly pageA: GrowthMapUrlDetail;
  readonly pageB: GrowthMapUrlDetail;
  readonly findingA: GrowthMapUrlFinding;
  readonly findingB: GrowthMapUrlFinding;
}): Promise<void> {
  const { page, pageA, pageB, findingA, findingB } = input;
  const rowA = exactPortfolioRow(page, pageA.normalizedUrl);
  const rowB = exactPortfolioRow(page, pageB.normalizedUrl);

  await rowB.click();
  await rowA.click();
  await expect(rowA).toHaveAttribute("aria-pressed", "true");
  await expect(rowB).toHaveAttribute("aria-pressed", "false");
  const detail = page.locator('aside[aria-label="Selected URL detail"]');
  await expect(
    detail.getByTitle(pageA.sitePageId, { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByTitle(findingB.findingId, { exact: true }),
  ).toHaveCount(0);

  await assertExactSelection({
    page,
    expected: pageA,
    other: pageB,
    expectedFinding: findingA,
    otherFinding: findingB,
    select: false,
  });
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

async function assertKeywordLibraryTraceability(input: {
  readonly page: Page;
  readonly item: GrowthMapKeywordLibraryItem;
  readonly expectedCount: number;
  readonly csvSnapshotId: string;
}): Promise<void> {
  const { page, item, expectedCount, csvSnapshotId } = input;
  const list = page.getByRole("list", { name: "Keyword list" });
  await expect(list.getByRole("button")).toHaveCount(expectedCount);
  const row = list
    .getByText(item.displayKeyword, { exact: true })
    .locator("xpath=ancestor::button[1]");
  // The first visible Keyword is intentionally rendered as an implicit
  // selection when the URL has no selectedKeywordId. This assertion makes the
  // acceptance test exercise a real row change instead of mistaking that
  // fallback presentation for a successful click-driven navigation.
  await expect(row).toHaveAttribute("aria-pressed", "false");
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedKeywordId"))
    .toBe(item.keywordId);

  const detail = page.locator('aside[aria-label="Selected Keyword detail"]');
  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: item.displayKeyword,
      exact: true,
    }),
  ).toBeVisible();
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
  const list = page.getByRole("list", { name: "Competitor list" });
  await expect(list.getByRole("button")).toHaveCount(expectedCount);
  const row = list.getByRole("button").filter({ hasText: item.domain });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(row).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("selectedCompetitorId"))
    .toBe(item.competitorId);

  const detail = page.locator('aside[aria-label="Selected Competitor detail"]');
  await expect(
    detail.getByRole("heading", {
      level: 2,
      name: item.name ?? item.domain,
      exact: true,
    }),
  ).toBeVisible();
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
  const selectedRow = exactPortfolioRow(page, expected.normalizedUrl);
  const otherRow = exactPortfolioRow(page, other.normalizedUrl);
  if (select) await selectedRow.click();

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
): Promise<void> {
  const button = objectModeButton(page, label);
  await button.click();
  await expect(button).toHaveAttribute("aria-current", "page");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("object"))
    .toBe(object);
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
    await runDiagnosisThroughRealApi(
      request,
      projectId,
      diagnosticSnapshots.map((snapshot) => snapshot.id),
    );

    const portfolio = await readPortfolio(request, projectId);
    expect(portfolio.data).toHaveLength(3);
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
    // Skip the implicit first-row fallback so the browser must persist an
    // explicit, different Keyword identity into the address and detail panel.
    const keyword = keywordLibrary.data.slice(1).find((item) =>
      item.sourceOccurrences.some(
        (occurrence) =>
          occurrence.sourceKind === "csv_import" &&
          occurrence.snapshotId === csvSnapshot.id,
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
    await expect(
      page.getByRole("list", { name: "URLs and opportunities" }),
    ).toBeVisible();
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
    await expect(
      page.getByRole("list", { name: "URLs and opportunities" }),
    ).toBeVisible();

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
