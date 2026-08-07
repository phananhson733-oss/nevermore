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
  publishDiagnosticThroughAnalysisRefresh,
  seedOfflineProviderSnapshots,
  verticalDefinition,
  type RealVertical,
  type VerticalDefinition,
} from "./real-chain-fixture.ts";
import { ACTION_TEMPLATES } from "../packages/engine/src/index.ts";
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
const ASYNC_EXPORT_TIMEOUT_MS = 90_000;

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

interface FixtureFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly summary: string;
  readonly reviewState:
    | "unreviewed"
    | "confirmed"
    | "ignored"
    | "needs_more_data";
  readonly reviewRevision: number;
}

interface FixtureAction {
  readonly id: string;
  readonly findingId: string;
  readonly templateId: string;
  readonly priorityBand: "critical" | "high" | "medium" | "low";
  readonly revision: number;
}

interface FixtureArtifact {
  readonly id: string;
  readonly actionId: string;
  readonly status: "generating" | "draft" | "ready" | "failed" | "archived";
  readonly currentRevision: number;
  readonly validationState: "pending" | "valid" | "invalid";
}

const ARTIFACT_TYPE_BY_TEMPLATE = new Map(
  Object.values(ACTION_TEMPLATES).map((template) => [
    template.templateId,
    template.artifactType,
  ]),
);

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
  // Every assertion in this suite reads English chrome, but the app's
  // `DEFAULT_LOCALE` is `zh-CN` (`packages/i18n/src/config.ts`). `3c2ecc6`
  // flipped that default and edited this spec without giving it a cookie, so
  // the suite has been asserting English against a Chinese UI ever since and
  // died on the very next line. No assertion is relaxed here: the same English
  // strings are simply now read in the locale they were written for. This is
  // the cookie the sibling real spec already sets (`growth-map.real.spec.ts`).
  await page
    .context()
    .addCookies([{ name: "sf_ui_locale", value: "en", url: BASE_URL }]);
  await page.goto("/new-project");
  await expect(
    page.getByRole("heading", { name: "Add a product" }),
  ).toBeVisible();
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
  ).toBeVisible({ timeout: CLIENT_READ_MODEL_TIMEOUT_MS });
  await expect(
    page.getByRole("link", { name: "Connect live data" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Switch project" }),
  ).toHaveValue(match[1]);
  return match[1];
}

async function completeContext(
  request: APIRequestContext,
  projectId: string,
  definition: VerticalDefinition,
): Promise<void> {
  const payload = completeContextBody(definition);
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
        ...payload,
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

/**
 * Exercise the multi-Artifact delivery path through the same authenticated
 * APIs used by the product. This is functional coverage only: it deliberately
 * does not render, screenshot, or define a second customer visual authority.
 */
async function exerciseExtendedDeliveryCoverage(
  request: APIRequestContext,
  projectId: string,
): Promise<void> {
  const findingsResponse = await request.get(
    `/api/mvp/projects/${projectId}/findings?activeOnly=true&limit=100`,
  );
  const findings = await responseJson<DataEnvelope<readonly FixtureFinding[]>>(
    findingsResponse,
    "list findings for extended delivery coverage",
  );
  const orderedFindings = [...findings.data].sort(
    (left, right) =>
      left.ruleId.localeCompare(right.ruleId) ||
      left.summary.localeCompare(right.summary),
  );
  for (const finding of orderedFindings) {
    if (finding.reviewState !== "unreviewed") continue;
    const response = await request.patch(
      `/api/mvp/projects/${projectId}/findings/${finding.id}`,
      {
        data: {
          reviewState: "confirmed",
          baseRevision: finding.reviewRevision,
        },
      },
    );
    await responseJson<DataEnvelope<unknown>>(
      response,
      `confirm finding ${finding.id}`,
    );
  }

  const actionsResponse = await request.get(
    `/api/mvp/projects/${projectId}/actions?limit=100`,
  );
  const actions = await responseJson<DataEnvelope<readonly FixtureAction[]>>(
    actionsResponse,
    "list actions for extended delivery coverage",
  );
  const findingOrder = new Map(
    orderedFindings.map((finding, index) => [finding.id, index] as const),
  );
  const deterministicActions = [...actions.data].sort(
    (left, right) =>
      (findingOrder.get(left.findingId) ?? Number.MAX_SAFE_INTEGER) -
        (findingOrder.get(right.findingId) ?? Number.MAX_SAFE_INTEGER) ||
      left.templateId.localeCompare(right.templateId),
  );
  const leadTemplateId = "improve_landing_conversion.v1";
  if (
    !deterministicActions.some((action) => action.templateId === leadTemplateId)
  ) {
    throw new Error(
      `Extended delivery lead action ${leadTemplateId} was not generated`,
    );
  }

  for (const action of [...deterministicActions].reverse()) {
    const response = await request.patch(
      `/api/mvp/projects/${projectId}/actions/${action.id}`,
      {
        data: {
          baseRevision: action.revision,
          priorityBand:
            action.templateId === leadTemplateId
              ? "critical"
              : action.priorityBand,
          reason: "Real E2E deterministic action ordering",
          note: null,
        },
      },
    );
    await responseJson<DataEnvelope<unknown>>(
      response,
      `order real E2E action ${action.id}`,
    );
  }

  const existingResponse = await request.get(
    `/api/mvp/projects/${projectId}/artifacts?limit=100`,
  );
  const existing = await responseJson<DataEnvelope<readonly FixtureArtifact[]>>(
    existingResponse,
    "list existing Artifacts for extended delivery coverage",
  );
  const coveredActions = new Set(
    existing.data.map((artifact) => artifact.actionId),
  );

  for (const action of deterministicActions) {
    if (coveredActions.has(action.id)) continue;
    const artifactType = ARTIFACT_TYPE_BY_TEMPLATE.get(action.templateId);
    if (!artifactType) {
      throw new Error(
        `No Artifact type for Action template ${action.templateId}`,
      );
    }
    const response = await request.post(
      `/api/mvp/projects/${projectId}/actions/${action.id}/artifacts`,
      {
        headers: { "Idempotency-Key": randomUUID() },
        data: {
          artifactType,
          generationMode: "template",
          outputLocale: "en",
          operatorInstructions: null,
        },
      },
    );
    expect(
      response.status(),
      `Artifact enqueue failed: ${await response.text()}`,
    ).toBe(202);
    const accepted = await responseJson<DataEnvelope<AcceptedRun>>(
      response,
      `generate Artifact for Action ${action.id}`,
    );
    await waitForRun(request, accepted.data.statusUrl, ["completed"]);
  }

  const generatedResponse = await request.get(
    `/api/mvp/projects/${projectId}/artifacts?limit=100`,
  );
  const generated = await responseJson<
    DataEnvelope<readonly FixtureArtifact[]>
  >(generatedResponse, "list generated Artifacts");
  for (const artifact of generated.data) {
    if (artifact.status !== "draft" || artifact.validationState !== "valid")
      continue;
    const response = await request.patch(
      `/api/mvp/projects/${projectId}/artifacts/${artifact.id}`,
      {
        data: {
          baseRevision: artifact.currentRevision,
          status: "ready",
        },
      },
    );
    await responseJson<DataEnvelope<unknown>>(
      response,
      `mark Artifact ${artifact.id} ready`,
    );
  }

  const readyResponse = await request.get(
    `/api/mvp/projects/${projectId}/artifacts?status=ready&limit=100`,
  );
  const ready = await responseJson<DataEnvelope<readonly FixtureArtifact[]>>(
    readyResponse,
    "list ready Artifacts",
  );
  expect(ready.data.length).toBeGreaterThanOrEqual(3);
}

async function verifySourcesReadModel(
  page: Page,
  projectId: string,
): Promise<void> {
  await page.goto(`/p/${projectId}/sources`);
  // The real chain starts Next in development mode and reads multiple
  // database-backed projections. A loaded page shell is not the same thing as
  // a ready client read model, especially on a contended CI runner.
  await expect(page.locator('main [role="status"]')).toHaveCount(0, {
    timeout: CLIENT_READ_MODEL_TIMEOUT_MS,
  });
  await expect(
    page.getByRole("region", { name: "Source readiness" }),
  ).toBeVisible({ timeout: CLIENT_READ_MODEL_TIMEOUT_MS });
  await page.waitForLoadState("networkidle");
  await expect(page.locator('main [role="status"]')).toHaveCount(0);
  await expectNoDocumentOverflow(page);
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

async function runDiagnosisAndConfirmFinding(
  page: Page,
  request: APIRequestContext,
  db: DbHandle,
  projectId: string,
  keyboard: boolean,
): Promise<void> {
  // The Diagnosis screen is retired; review lives in the Growth Map detail.
  // This suite intentionally uses an offline Crawl/Google provider seam, so it
  // queues the real Growth Audit child through HTTP/pg-boss and then supplies
  // only the durable Analysis Refresh publication lineage. The customer CTA is
  // independently wired to the full server-owned Analysis Refresh command.
  await page.goto(`/p/${projectId}/growth-map`);
  await expect(
    page.getByRole("heading", {
      name: "Find the next growth opportunity, page by real page.",
    }),
  ).toBeVisible();
  await expectNoDocumentOverflow(page);

  // Before the first diagnostic, a missing frozen audit is a valid empty state
  // rather than a transport failure. Pin it, together with the absent
  // provenance band, so the post-terminal recovery below proves the transition.
  await expect(page.getByText("No URL audit result yet")).toBeVisible({
    timeout: CLIENT_READ_MODEL_TIMEOUT_MS,
  });
  await expect(page.getByLabel("Audit provenance for this page")).toHaveCount(
    0,
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
  await page.reload({ waitUntil: "networkidle" });

  // The pre-diagnosis empty state pinned above must now resolve into the
  // readable portfolio.
  await expect(page.getByLabel("Audit provenance for this page")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("No URL audit result yet")).toHaveCount(0);

  // Select the URL that carries the TECH-HTTP-001 Finding (the /gone page).
  await page.getByRole("button").filter({ hasText: "/gone" }).first().click();
  await expect(
    page.locator('[data-detail-panel="audit-evidence"]'),
  ).toBeVisible({ timeout: CLIENT_READ_MODEL_TIMEOUT_MS });

  // Confirm renders only in Opportunity Review; the default panel is the
  // read-only Audit Evidence state.
  await page.locator('[data-detail-state="opportunity-review"]').click();
  const review = page.locator('[data-detail-panel="opportunity-review"]');
  await expect(review).toBeVisible();
  const finding = review
    .locator("[data-finding-card]")
    .filter({ hasText: "return HTTP 404" });
  await expect(finding).toBeVisible();
  await expect(finding.getByText("Unreviewed", { exact: true })).toBeVisible();

  // The keyboard contract of the real evidence disclosure: Enter opens the
  // named dialog and hands it focus, Escape closes it and returns focus to
  // the exact <summary> trigger, whose aria-expanded tracks the open state.
  const trigger = finding.locator("summary");
  await expect(trigger).toHaveCount(1);
  const dialog = finding.getByRole("dialog", { name: "Inspect Evidence IDs" });
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  const confirm = finding.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeEnabled();
  const reviewResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "PATCH" &&
      url.pathname.startsWith(`/api/mvp/projects/${projectId}/findings/`)
    );
  });
  if (keyboard) {
    await confirm.focus();
    await expect(confirm).toBeFocused();
    await confirm.press("Enter");
  } else {
    await confirm.click();
  }
  const settledReview = await reviewResponse;
  expect(
    settledReview.status(),
    `Finding review failed: ${await settledReview.text()}`,
  ).toBe(200);
  const reviewEnvelope = (await settledReview.json()) as DataEnvelope<{
    readonly action: { readonly id: string } | null;
  }>;
  const confirmedActionId = reviewEnvelope.data.action?.id;
  expect(
    confirmedActionId,
    "Confirm must return the same-transaction Action",
  ).toBeTruthy();
  await expect(finding.getByText("Confirmed", { exact: true })).toBeVisible({
    timeout: CLIENT_READ_MODEL_TIMEOUT_MS,
  });
  // The confirmation created the canonical Action: the card now carries a
  // real execution deep link whose target is that exact Action on this
  // project's Execution surface. (The retired Diagnosis DOM's
  // "Action created:" banner no longer exists anywhere.)
  const executionLink = finding.getByRole("link", { name: /Open Execution/ });
  await expect(executionLink).toBeVisible();
  const executionHref = await executionLink.getAttribute("href");
  expect(executionHref, "Open Execution must be a real link").not.toBeNull();
  const executionUrl = new URL(executionHref!, BASE_URL);
  expect(executionUrl.pathname).toBe(`/p/${projectId}/execution`);
  expect(executionUrl.searchParams.get("actionId")).toBe(confirmedActionId);
}

async function generateReadyArtifact(
  page: Page,
  projectId: string,
  keyboard: boolean,
): Promise<void> {
  // `runDiagnosisAndConfirmFinding` already proves the canonical "Open
  // Execution" deep link exists and targets this exact project/action. On the
  // 390px shell, the sidebar link can remain outside the active viewport while
  // the Growth Map keeps its own selection query in place, so this helper
  // enters the verified Execution URL directly rather than retesting sidebar
  // navigation here.
  await page.goto(`/p/${projectId}/execution`);
  await expect(page).toHaveURL(`/p/${projectId}/execution`);
  const studioHero = page.locator("[data-studio-page-hero]");
  const studioWorkspace = page.locator("[data-studio-workspace]");
  const editorCanvas = page.locator("[data-studio-editor-column]");
  await expect(studioHero).toBeVisible();
  await expect(studioHero.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(studioWorkspace).toBeVisible();
  await expectNoDocumentOverflow(page);

  await studioHero
    .getByRole("button", { name: "Configure a new deliverable" })
    .click();
  const picker = editorCanvas.locator('[aria-labelledby="sf-picker-title"]');
  await expect(picker.locator("#sf-picker-title")).toBeVisible();
  await picker
    .getByRole("button", { name: "Configure a new deliverable", exact: true })
    .first()
    .click();

  const generationForm = editorCanvas.locator(
    '[aria-labelledby="sf-generate-title"]',
  );
  await expect(generationForm.locator("#sf-generate-title")).toBeVisible();
  // This vertical deliberately proves the deterministic offline provider seam.
  // Product UX defaults to AI, so the test must opt into the template instead
  // of accidentally reaching a live LLM from the isolated CI environment.
  await generationForm.getByLabel("Generation mode").selectOption("template");
  await generationForm
    .getByRole("button", { name: "Generate", exact: true })
    .click();

  // Re-aimed for the unified queue, not loosened. The queue is one list ordered
  // by type instead of a stack of per-type `<section>`s, so the region this
  // scoped to is gone; the row is now identified by the type it carries.
  const artifactRow = page
    .locator("[data-studio-queue]")
    .locator(
      '[data-studio-artifact-id][data-studio-artifact-type="technical_ticket"]',
    );
  await expect(artifactRow).toHaveCount(1, { timeout: 45_000 });
  await expect(artifactRow.getByText("Draft", { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await artifactRow
    .getByRole("button", { name: "View", exact: true })
    .click();
  const markReady = page.getByRole("button", { name: "Mark ready" });
  await expect(markReady).toBeEnabled();
  if (keyboard) {
    await markReady.focus();
    await expect(markReady).toBeFocused();
    await markReady.press("Enter");
  } else {
    await markReady.click();
  }
  // The anchor for "marking ready took" moved; it was not loosened.
  //
  // This used to read the "Back to draft" button, which appeared only on a
  // `ready` artifact. That control has been removed:
  // `MANUAL_STATUS_TRANSITIONS.ready` is `["archived"]`
  // (`apps/web/src/lib/services/artifact-state.ts`), so it could only ever
  // return `VERSION_CONFLICT` — a control whose one possible outcome is a
  // refusal. It was never what this step proves; it was only where the proof
  // happened to be pinned. The proof is now pinned to the state itself, at the
  // same strength: under strict mode `getByText` must resolve exactly one
  // element and it must be visible, exactly as `getByRole` did before.
  const editor = page.locator("[data-studio-editor]");
  await expect(editor.getByText("Ready", { exact: true })).toBeVisible({
    timeout: CLIENT_READ_MODEL_TIMEOUT_MS,
  });
  // The removed control must stay removed: shipping it back is the defect.
  await expect(page.getByRole("button", { name: "Back to draft" })).toHaveCount(
    0,
  );
  // And `ready` is not a dead end — the editor states the real path back.
  await expect(editor.locator("[data-studio-ready-path]")).toBeVisible();
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
  const reportLink = page.getByRole("link", { name: "Results", exact: true });
  if (keyboard) {
    await reportLink.focus();
    await expect(reportLink).toBeFocused();
    await reportLink.press("Enter");
    await page.waitForURL(`/p/${projectId}/results`);
  } else {
    await reportLink.click();
  }
  // Route navigation completes before the report projection necessarily does.
  // Wait on the report document's own ready marker, not unrelated Results
  // panels that may continue loading independently.
  await expect(page.locator("[data-report-document]")).toBeVisible({
    timeout: CLIENT_READ_MODEL_TIMEOUT_MS,
  });
  // The onboarding flow now persists the declared product name as the project
  // display name up front. The report cover therefore leads with the declared
  // Product Profile identity while still naming the submitted host beneath it.
  const reportDocument = page.locator("[data-report-document]");
  await expect(
    reportDocument.getByRole("heading", {
      level: 2,
      name: definition.productName,
      exact: true,
    }),
  ).toBeVisible({ timeout: CLIENT_READ_MODEL_TIMEOUT_MS });
  await expect(
    reportDocument.getByText(new URL(definition.siteUrl).host, {
      exact: true,
    }),
  ).toBeVisible({ timeout: CLIENT_READ_MODEL_TIMEOUT_MS });
  const findings = page.getByRole("region", { name: "Findings" });
  await expect(
    findings.getByRole("heading", { name: "Findings" }),
  ).toBeVisible();
  await expect(findings.getByText(/return HTTP 404/)).toBeVisible();
  const deliverables = page.getByRole("region", { name: "Deliverables" });
  await expect(
    deliverables.getByRole("heading", { name: "Deliverables" }),
  ).toBeVisible();
  await expect(
    deliverables.getByText("Technical ticket", { exact: true }).first(),
  ).toBeVisible();
  await expectNoDocumentOverflow(page);

  const label = kind === "service" ? "Service bundle" : "Client bundle";
  const button = page.getByRole("button", { name: label, exact: true });
  if (keyboard) {
    await button.focus();
    await expect(button).toBeFocused();
    await button.press("Enter");
  } else {
    await button.click();
  }
  const download = page.getByRole("link", {
    name: `Download ${kind} bundle`,
  });
  // Export completion includes a repeatable-read snapshot, paginated assembly,
  // ZIP upload, and an initial detail read whose own 30s timeout may retry
  // once. Keep this bound specific to the requested bundle instead of waiting
  // on unrelated Results-page activity.
  await expect(download).toBeVisible({ timeout: ASYNC_EXPORT_TIMEOUT_MS });
  await expect(
    page.getByRole("heading", { name: "Export manifest" }),
  ).toBeVisible();
  await verifyExportBytes(download);
}

async function exerciseVertical(input: {
  readonly page: Page;
  readonly request: APIRequestContext;
  readonly db: DbHandle;
  readonly vertical: RealVertical;
  readonly suffix?: string;
  readonly extendedDeliveryCoverage?: boolean;
  readonly mobile: boolean;
  readonly keyboard: boolean;
  readonly exportKind: "service" | "client";
}): Promise<{
  readonly projectId: string;
  readonly definition: VerticalDefinition;
}> {
  const suffix = input.suffix ?? randomUUID().slice(0, 8);
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

  await runDiagnosisAndConfirmFinding(
    input.page,
    input.request,
    input.db,
    projectId,
    input.keyboard,
  );
  await generateReadyArtifact(input.page, projectId, input.keyboard);
  if (input.extendedDeliveryCoverage) {
    await exerciseExtendedDeliveryCoverage(input.request, projectId);
    await verifySourcesReadModel(input.page, projectId);
  }
  await verifyReportAndExport(
    input.page,
    projectId,
    definition,
    input.exportKind,
    input.keyboard,
  );
  await expectNoDocumentOverflow(input.page);
  return { projectId, definition };
}

test.describe
  .serial("real local app chain with an explicit offline Crawl/Google seam", () => {
  // This suite intentionally mutates one guarded disposable database and
  // proves the queue started empty. Retrying only the failed test would reuse
  // pg-boss history from the first attempt and could never be a valid retry.
  test.describe.configure({ retries: 0 });

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
    test.setTimeout(240_000);
    if (!db) throw new Error("real E2E fixture database did not start");
    await exerciseVertical({
      page,
      request,
      db,
      vertical: "b2b",
      suffix: "c0ffee00",
      extendedDeliveryCoverage: true,
      mobile: false,
      keyboard: true,
      exportKind: "service",
    });
  });

  test("AC-045 B2C fixture: 390px app chain with offline provider seam -> client report/export", async ({
    page,
    request,
  }) => {
    // This exercises the same database-backed read models and async export path
    // as AC-044. A 120s test cap can terminate the request before the
    // export-specific 90s assertion is allowed to finish, so both verticals
    // share the same bounded end-to-end budget.
    test.setTimeout(240_000);
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
});
