import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
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
  type RealVertical,
  type VerticalDefinition,
} from "./real-chain-fixture.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 3100);
const BASE_URL = `http://localhost:${PORT}`;
const DATABASE_URL = process.env["E2E_DATABASE_URL"];
const BLOB_DIR = "/tmp/signalframe-e2e-real-blobs";

interface WorkerRuntime {
  stop(): Promise<WorkerShutdownResult>;
}

interface AcceptedRun {
  readonly run: { readonly id: string; readonly status: string };
  readonly statusUrl: string;
  readonly resourceRef: { readonly type: string; readonly id: string } | null;
}

interface DataEnvelope<T> {
  readonly data: T;
}

interface PreviewData {
  readonly importToken: string;
  readonly rowCount: number;
  readonly errors: readonly unknown[];
}

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
  response: APIResponse,
  operation: string,
): Promise<T> {
  if (!response.ok()) {
    throw new Error(
      `${operation} failed with HTTP ${response.status()}: ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.scroll,
    `document overflowed: ${dimensions.scroll}px > ${dimensions.client}px`,
  ).toBeLessThanOrEqual(dimensions.client + 1);
}

async function requireFreshQueueDatabase(db: DbHandle): Promise<void> {
  const table = await db.pool.query<{ queueTable: string | null }>(
    `SELECT to_regclass('pgboss.job')::text AS "queueTable"`,
  );
  if (table.rows[0]?.queueTable === null) return;

  const jobs = await db.pool.query<{ hasJobs: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pgboss.job) AS "hasJobs"`,
  );
  if (jobs.rows[0]?.hasJobs === true) {
    throw new Error(
      "Real E2E requires a fresh disposable database with no pg-boss jobs.",
    );
  }
}

async function createProjectInBrowser(
  page: Page,
  definition: VerticalDefinition,
): Promise<string> {
  await page.goto("/new-project");
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
  expect((await createResponse).status()).toBe(201);
  await page.waitForURL(/\/p\/[0-9a-f-]+\/overview$/);
  await expect(
    page.getByRole("heading", { name: definition.projectName }),
  ).toBeVisible();
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
): Promise<string> {
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
        return expected.includes(observed);
      },
      {
        message: `run ${statusUrl} did not become ${expected.join("/")}`,
        timeout: 45_000,
        intervals: [200, 400, 800, 1_000],
      },
    )
    .toBe(true);
  return observed;
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
        name: `${definition.vertical}-keyword-gap.csv`,
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

async function runDiagnosisAndConfirmFinding(
  page: Page,
  projectId: string,
  keyboard: boolean,
): Promise<void> {
  await page.goto(`/p/${projectId}/diagnosis`);
  await expect(page.getByRole("heading", { name: "Diagnosis" })).toBeVisible();
  await expectNoDocumentOverflow(page);
  const run = page.getByRole("button", { name: "Run diagnosis" });
  await expect(run).toBeEnabled();
  if (keyboard) {
    await run.focus();
    await expect(run).toBeFocused();
    await page.keyboard.press("Enter");
  } else {
    await run.click();
  }

  const finding = page.getByRole("article", { name: "HTTP status errors" });
  await expect(finding).toBeVisible({ timeout: 45_000 });
  await expect(
    page
      .getByText("Last run", { exact: true })
      .locator("..")
      .getByText("Completed", { exact: true }),
  ).toBeVisible();
  await expect(finding.getByText("Unreviewed", { exact: true })).toBeVisible();

  // Exercise the real disclosure keyboard behavior: Enter opens, Escape closes,
  // and focus returns to the exact trigger rather than becoming lost in the DOM.
  const evidence = finding
    .getByRole("button", { name: "Show evidence details" })
    .first();
  await evidence.focus();
  await page.keyboard.press("Enter");
  await expect(
    finding.getByRole("region", { name: /Evidence details:/ }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(evidence).toBeFocused();
  await expect(evidence).toHaveAttribute("aria-expanded", "false");

  const confirm = finding.getByRole("button", { name: "Confirm" });
  if (keyboard) {
    await confirm.focus();
    await page.keyboard.press("Enter");
  } else {
    await confirm.click();
  }
  await expect(finding.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(finding.getByText(/Action created:/)).toBeVisible();
}

async function generateReadyArtifact(
  page: Page,
  projectId: string,
  keyboard: boolean,
): Promise<void> {
  const studioLink = page.getByRole("link", { name: "Studio", exact: true });
  if (keyboard) {
    await studioLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`/p/${projectId}/studio`);
  } else {
    await studioLink.click();
  }
  await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
  await expectNoDocumentOverflow(page);

  await page.getByRole("button", { name: "Generate artifact" }).click();
  await expect(page.getByRole("heading", { name: "Pick an action" })).toBeVisible();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Fix|HTTP|status/i }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  const artifactGroup = page.getByRole("region", {
    name: "Technical ticket",
  });
  await expect(artifactGroup).toBeVisible({ timeout: 45_000 });
  await expect(
    artifactGroup.getByText("Draft", { exact: true }).first(),
  ).toBeVisible({ timeout: 45_000 });
  await artifactGroup.getByRole("button", { name: "Open" }).click();
  const markReady = page.getByRole("button", { name: "Mark ready" });
  await expect(markReady).toBeEnabled();
  if (keyboard) {
    await markReady.focus();
    await page.keyboard.press("Enter");
  } else {
    await markReady.click();
  }
  await expect(
    page.getByRole("button", { name: "Back to draft" }),
  ).toBeVisible();
}

async function verifyExportBytes(link: Locator): Promise<void> {
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^file:\/\//);
  const bytes = await readFile(fileURLToPath(new URL(href!)));
  expect(bytes.length).toBeGreaterThan(100);
  expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
}

async function verifyReportAndExport(
  page: Page,
  projectId: string,
  definition: VerticalDefinition,
  kind: "service" | "client",
  keyboard: boolean,
): Promise<void> {
  const reportLink = page.getByRole("link", { name: "Report", exact: true });
  if (keyboard) {
    await reportLink.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`/p/${projectId}/report`);
  } else {
    await reportLink.click();
  }
  await expect(page.getByRole("heading", { name: definition.projectName })).toBeVisible();
  const findings = page.getByRole("region", { name: "Findings" });
  await expect(findings.getByRole("heading", { name: "Findings" })).toBeVisible();
  await expect(findings.getByText(/return HTTP 404/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deliverables" })).toBeVisible();
  await expect(page.getByText("Technical ticket", { exact: true })).toBeVisible();
  await expectNoDocumentOverflow(page);

  const label = kind === "service" ? "Service bundle" : "Client bundle";
  const button = page.getByRole("button", { name: label, exact: true });
  if (keyboard) {
    await button.focus();
    await page.keyboard.press("Enter");
  } else {
    await button.click();
  }
  const download = page.getByRole("link", {
    name: `Download ${kind} bundle`,
  });
  await expect(download).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("heading", { name: "Export manifest" })).toBeVisible();
  await verifyExportBytes(download);
}

async function exerciseVertical(input: {
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly db: DbHandle;
  readonly vertical: RealVertical;
  readonly mobile: boolean;
  readonly keyboard: boolean;
  readonly exportKind: "service" | "client";
}): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const definition = verticalDefinition(input.vertical, suffix);
  if (input.mobile) {
    await input.page.setViewportSize({ width: 390, height: 844 });
  }
  const projectId = await createProjectInBrowser(input.page, definition);
  await expectNoDocumentOverflow(input.page);
  await completeContext(input.request, projectId, definition);

  // Real local CSV storage + pg-boss collection worker, followed by offline
  // Crawl/Google fixtures that avoid production credentials and all networking.
  await importCsvThroughRealWorker(input.request, projectId, definition);
  await seedOfflineProviderSnapshots(input.db, projectId, definition);

  await runDiagnosisAndConfirmFinding(input.page, projectId, input.keyboard);
  await generateReadyArtifact(input.page, projectId, input.keyboard);
  await verifyReportAndExport(
    input.page,
    projectId,
    definition,
    input.exportKind,
    input.keyboard,
  );
  await expectNoDocumentOverflow(input.page);
}

test.describe.serial(
  "real local app chain with an explicit offline Crawl/Google seam",
  () => {
    let db: DbHandle | undefined;
    let worker: WorkerRuntime | undefined;

    test.beforeAll(async () => {
      configureWorkerEnvironment();
      db = createDbHandle(DATABASE_URL!, 4);
      await requireFreshQueueDatabase(db);
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
      } finally {
        await db?.end();
      }
      if (shutdownResult) expect(shutdownResult.ok).toBe(true);
    });

    test("AC-044 B2B fixture: browser/app/CSV worker -> offline provider seam -> service export", async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      if (!db) throw new Error("real E2E fixture database did not start");
      await exerciseVertical({
        page,
        request,
        db,
        vertical: "b2b",
        mobile: false,
        keyboard: true,
        exportKind: "service",
      });
    });

    test("AC-045 B2C fixture: 390px app chain with offline provider seam -> client report/export", async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      if (!db) throw new Error("real E2E fixture database did not start");
      await exerciseVertical({
        page,
        request,
        db,
        vertical: "b2c",
        mobile: true,
        keyboard: false,
        exportKind: "client",
      });
    });
  },
);
