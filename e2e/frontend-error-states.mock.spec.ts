import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  E2E_ACTIVE_EXPORT_BUNDLE_ID,
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  E2E_SNAPSHOT_PROVENANCE,
  installCriticalFlowApi,
  recheckResultsFixture,
  sourceSlot,
  type CriticalFlowApiState,
  type MockDataSnapshot,
} from "./mock-api.ts";

let api: CriticalFlowApiState;

/** This spec asserts BOTH locales. The default UI locale is zh-CN
 *  (`packages/i18n/src/config.ts:6`), so its English assertions would otherwise
 *  be reading a Chinese page. The base locale is selected explicitly here; the
 *  tests that assert Chinese chrome still click the in-app locale switch, so
 *  neither half rides on the default. */
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
  api = await installCriticalFlowApi(page);
});

function problem(code: string, detail: string, status: number) {
  return {
    type: "about:blank",
    title: status === 409 ? "Conflict" : "Service unavailable",
    status,
    code,
    detail,
    requestId: "frontend-error-e2e",
  };
}

function validationProblem(message: string) {
  return {
    ...problem("VALIDATION_ERROR", "Request failed validation.", 422),
    title: "Validation failed",
    errors: [
      {
        pointer: "/reason",
        code: "too_small",
        message,
      },
    ],
  };
}

async function nodeInSidebar(
  page: import("@playwright/test").Page,
  target: readonly string[],
): Promise<boolean> {
  const selector = target.join(" ");
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && !!el.closest('[class*="sidebar"]');
  }, selector);
}

test("CSV preview has a readable 390px card view without horizontal panning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  const csv = page.getByRole("region", { name: "CSV upload" });
  await csv.locator('input[type="file"]').setInputFiles({
    name: "keywords.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "keyword,search_volume,market_code,language_code\nsignal frame,120,US,en\n",
    ),
  });

  const caption = "CSV preview with 1 row and 4 columns";
  const cards = csv.getByRole("list", { name: caption });
  await expect(cards).toBeVisible();
  await expect(csv.getByRole("table", { name: caption })).toBeHidden();
  await expect(cards.locator("dt")).toHaveText([
    "keyword",
    "search_volume",
    "market_code",
    "language_code",
  ]);
  await expect(cards.locator("dd")).toHaveText([
    "signal frame",
    "120",
    "US",
    "en",
  ]);

  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(false);

  const results = await new AxeBuilder({ page })
    .include('section[aria-labelledby="source-csv"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => violation.id),
  ).toEqual([]);
});

test("Sources full-screen query errors expose stable code, request ID, and retry without raw detail", async ({
  page,
}) => {
  let failuresRemaining = 2;
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/sources`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      if (failuresRemaining > 0) {
        failuresRemaining -= 1;
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify(
            problem(
              "DEPENDENCY_UNAVAILABLE",
              "raw provider topology detail",
              503,
            ),
          ),
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  await expect(page.getByText("Error code", { exact: true })).toBeVisible();
  await expect(
    page.getByText("DEPENDENCY_UNAVAILABLE", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Request ID", { exact: true })).toBeVisible();
  await expect(
    page.getByText("frontend-error-e2e", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(
    "raw provider topology",
  );

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Sources" })).toBeVisible();
});

test("Sources settles a failed status query once and offers a status retry", async ({
  page,
}) => {
  let runReads = 0;
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/runs/collection-run`,
    async (route) => {
      runReads += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify(
          problem(
            "DEPENDENCY_UNAVAILABLE",
            "raw upstream response containing internal topology",
            503,
          ),
        ),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  const crawl = page.getByRole("region", { name: "Site crawl" });
  await crawl.getByRole("button", { name: "Collect now" }).click();

  await expect(
    crawl.getByText("We couldn't refresh this run's status", { exact: false }),
  ).toBeVisible();
  await expect(crawl.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(crawl).not.toContainText("raw upstream response");
  await expect.poll(() => runReads).toBe(2);
  // Initial read + mutation-success invalidation + exactly one settled-error
  // invalidation. A repeated error effect would continue increasing this.
  await expect.poll(() => api.sourceReads).toBe(3);

  const settledSourceReads = api.sourceReads;
  await page.waitForTimeout(750);
  expect(api.sourceReads).toBe(settledSourceReads);
  expect(api.collectionRequests).toHaveLength(1);

  await crawl.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => runReads).toBe(4);
  expect(api.collectionRequests).toHaveLength(1);
});

test("AC-046: Sources exposes permission, partial, and automatic rate-limit retry states", async ({
  page,
}) => {
  const rateRun = {
    id: "rate-limit-run",
    projectId: E2E_PROJECT_ID,
    kind: "collection",
    status: "queued",
    progress: {
      phase: "retry_wait",
      current: 1,
      total: 3,
      messageKey: "worker.collection.retry_wait",
    },
    lastError: {
      code: "RATE_LIMITED",
      summary: "Provider rate limit reached; automatic retry is scheduled.",
    },
    resultRef: null,
    queuedAt: "2026-07-18T12:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
  const partialSnapshot = {
    id: "00000000-0000-4000-8000-000000000151",
    siteId: E2E_SITE_ID,
    provider: "ga4",
    datasetKey: E2E_SNAPSHOT_PROVENANCE.ga4.datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: E2E_SNAPSHOT_PROVENANCE.ga4.methodVersion,
    capturedAt: "2026-07-18T12:00:00.000Z",
    sourceWindow: {
      start: "2026-05-23T00:00:00.000Z",
      end: "2026-07-17T00:00:00.000Z",
    },
    availability: "partial",
    limitation:
      "GA4 key-event report is incompatible; session rows remain available.",
    rowCount: 42,
    checksum: "a".repeat(64),
  } satisfies MockDataSnapshot;
  const sources = [
    sourceSlot("crawl", {
      state: "syncing",
      activeRun: rateRun,
      limitation: "Provider rate limit reached; automatic retry is scheduled.",
    }),
    sourceSlot("gsc", {
      id: "00000000-0000-4000-8000-000000000152",
      state: "permission_denied",
      connectedAt: "2026-07-18T12:00:00.000Z",
      limitation:
        "Google provider permission was denied. Disconnect and reconnect a property you can access.",
    }),
    sourceSlot("ga4", {
      id: "00000000-0000-4000-8000-000000000153",
      state: "partial",
      connectedAt: "2026-07-18T12:00:00.000Z",
      latestSnapshot: partialSnapshot,
      limitation: partialSnapshot.limitation,
    }),
    sourceSlot("csv"),
    sourceSlot("dataforseo"),
  ];

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/sources`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: sources }),
      });
    },
  );
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/runs/rate-limit-run`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: rateRun }),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  const crawl = page.getByRole("region", { name: "Site crawl" });
  await expect(crawl.getByText("Syncing", { exact: true })).toBeVisible();
  await expect(
    crawl.getByText(
      "Provider rate limit reached; automatic retry is scheduled.",
    ),
  ).toBeVisible();
  await expect(crawl.getByText("Automatic retry scheduled.")).toBeVisible();
  await expect(
    crawl.getByRole("button", { name: "Collect now" }),
  ).toBeDisabled();

  const gsc = page.getByRole("region", { name: "Search Console" });
  await expect(
    gsc.getByText("Permission denied", { exact: true }),
  ).toBeVisible();
  await expect(gsc).toContainText(
    "Disconnect and reconnect a property you can access.",
  );
  await expect(
    gsc.getByText("Reconnect required before collecting again."),
  ).toBeVisible();
  await expect(gsc.getByRole("button", { name: "Collect now" })).toHaveCount(0);

  const ga4 = page.getByRole("region", { name: "Google Analytics 4" });
  await expect(ga4.getByText("Partial", { exact: true })).toHaveCount(2);
  await expect(ga4).toContainText("session rows remain available");
  await expect(
    ga4.getByRole("button", { name: "Retry collection" }),
  ).toBeVisible();
});

test("Studio retries the same run after a transient status outage", async ({
  page,
}) => {
  const now = "2026-07-18T12:00:00.000Z";
  const activeRun = {
    id: "artifact-error-run",
    projectId: E2E_PROJECT_ID,
    kind: "artifact_generation",
    status: "running",
    progress: {
      phase: "generate",
      current: 1,
      total: 2,
      messageKey: "ignored",
    },
    lastError: null,
    resultRef: null,
    queuedAt: now,
    startedAt: now,
    completedAt: null,
  };
  const activeArtifact = {
    id: "00000000-0000-4000-8000-000000000401",
    actionId: "00000000-0000-4000-8000-000000000301",
    artifactType: "technical_ticket",
    status: "generating",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 0,
    validationState: "pending",
    current: null,
    activeRun,
    createdAt: now,
    updatedAt: now,
  };
  let artifactReads = 0;
  let runReads = 0;

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/artifacts**`,
    async (route) => {
      artifactReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [activeArtifact],
          meta: { nextCursor: null, hasNext: false, limit: 100 },
        }),
      });
    },
  );
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/runs/artifact-error-run`,
    async (route) => {
      runReads += 1;
      if (runReads > 2) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              ...activeRun,
              status: "completed",
              progress: {
                phase: "completed",
                current: 2,
                total: 2,
                messageKey: "ignored",
              },
              resultRef: { type: "artifact", id: activeArtifact.id },
              completedAt: now,
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify(
          problem(
            "DEPENDENCY_UNAVAILABLE",
            "raw model-provider credential failure",
            503,
          ),
        ),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  await expect(
    page.getByText("We couldn't refresh the generation status", {
      exact: false,
    }),
  ).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry generation status" });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("raw model-provider");
  await expect.poll(() => runReads).toBe(2);
  await expect.poll(() => artifactReads).toBeGreaterThanOrEqual(2);

  await retry.click();
  await expect.poll(() => runReads).toBe(3);
  await expect(
    page.getByText("We couldn't refresh the generation status", {
      exact: false,
    }),
  ).toHaveCount(0);
  await page.waitForTimeout(750);
  expect(runReads).toBe(3);
});

test("Studio generation errors expose stable code and request ID without raw provider text", async ({
  page,
}) => {
  let createAttempts = 0;
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/actions/00000000-0000-4000-8000-000000000301/artifacts`,
    async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      createAttempts += 1;
      if (createAttempts === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/problem+json",
          body: JSON.stringify(
            problem(
              "DEPENDENCY_UNAVAILABLE",
              "raw model-provider credential detail",
              503,
            ),
          ),
        });
        return;
      }
      await route.fallback();
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  const hero = page.locator("[data-studio-page-hero]");
  const canvas = page.locator("[data-studio-editor-column]");
  await hero.getByRole("button", { name: "Generate artifact" }).click();
  await canvas
    .getByRole("listitem")
    .filter({ hasText: "Fix the failing product page" })
    .getByRole("button", { name: /Generate|Regenerate/ })
    .click();
  await page.getByLabel("Output language").fill("fr-FR");
  await page.getByLabel("Generation mode").selectOption("structured_llm");
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect(
    page.getByText("Something went wrong", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Error code", { exact: true })).toBeVisible();
  await expect(
    page.getByText("DEPENDENCY_UNAVAILABLE", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Request ID", { exact: true })).toBeVisible();
  await expect(
    page.getByText("frontend-error-e2e", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(
    "raw model-provider credential",
  );

  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => createAttempts).toBe(2);
  await expect.poll(() => api.artifactCreateRequests.length).toBe(1);
});

test("Studio adopts a cross-tab active generation from the refreshed artifact projection", async ({
  page,
}) => {
  const now = "2026-07-20T12:00:00.000Z";
  const actionId = "00000000-0000-4000-8000-000000000301";
  const artifactId = "00000000-0000-4000-8000-000000000401";
  const runId = "cross-tab-artifact-run";
  const activeRun = {
    id: runId,
    projectId: E2E_PROJECT_ID,
    kind: "artifact_generation",
    status: "running",
    progress: {
      phase: "generate",
      current: 1,
      total: 2,
      messageKey: "worker.artifact_generation",
    },
    lastError: null,
    resultRef: null,
    queuedAt: now,
    startedAt: now,
    completedAt: null,
  };
  const artifact = {
    id: artifactId,
    actionId,
    artifactType: "technical_ticket",
    status: "draft",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 2,
    validationState: "valid",
    current: {
      id: "00000000-0000-4000-8000-000000000402",
      revision: 2,
      contentFormat: "markdown",
      content: "Canonical artifact content",
      contentHash: "sha256:cross-tab-artifact",
      validationErrors: [],
      note: null,
      createdAt: now,
    },
    activeRun: null,
    createdAt: now,
    updatedAt: now,
  };
  let conflictRaised = false;
  let createAttempts = 0;
  let artifactReads = 0;
  let runReads = 0;

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/artifacts**`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      artifactReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            conflictRaised
              ? { ...artifact, status: "generating", activeRun }
              : artifact,
          ],
          meta: { nextCursor: null, hasNext: false, limit: 100 },
        }),
      });
    },
  );
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/actions/${actionId}/artifacts`,
    async (route) => {
      createAttempts += 1;
      conflictRaised = true;
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        headers: {
          Location: `/api/mvp/projects/${E2E_PROJECT_ID}/runs/${runId}`,
        },
        body: JSON.stringify(
          problem(
            "RUN_ALREADY_ACTIVE",
            "raw provider detail: this artifact is already generating",
            409,
          ),
        ),
      });
    },
  );
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/runs/${runId}`,
    async (route) => {
      runReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: activeRun }),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  const card = page.locator(`[data-studio-artifact-id="${artifactId}"]`);
  await card.getByRole("button", { name: "Regenerate" }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect.poll(() => artifactReads).toBeGreaterThanOrEqual(2);
  await expect.poll(() => runReads).toBeGreaterThanOrEqual(1);
  await expect.poll(() => createAttempts).toBe(1);
  await expect(
    page.locator(`[data-studio-active-run="${runId}"]`),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Generating…" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Something went wrong", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("main")).not.toContainText("raw provider detail");

  await page
    .locator("[data-studio-page-hero]")
    .getByRole("button", { name: "Generate artifact" })
    .click();
  const activeAction = page
    .locator("[data-studio-editor-column]")
    .getByRole("listitem")
    .filter({ hasText: "Fix the failing product page" })
    .getByRole("button", { name: "Generating…" });
  await expect(activeAction).toBeDisabled();
  expect(createAttempts).toBe(1);
});

test("Studio releases a 409 recovery fence when the canonical run has already settled", async ({
  page,
}) => {
  const now = "2026-07-20T12:00:00.000Z";
  const actionId = "00000000-0000-4000-8000-000000000301";
  const artifactId = "00000000-0000-4000-8000-000000000401";
  const artifact = {
    id: artifactId,
    actionId,
    artifactType: "technical_ticket",
    status: "draft",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 2,
    validationState: "valid",
    current: {
      id: "00000000-0000-4000-8000-000000000402",
      revision: 2,
      contentFormat: "markdown",
      content: "Canonical artifact content after the winning run settled.",
      contentHash: "sha256:settled-cross-tab-artifact",
      validationErrors: [],
      note: null,
      createdAt: now,
    },
    activeRun: null,
    createdAt: now,
    updatedAt: now,
  };
  let conflictRaised = false;
  let createAttempts = 0;
  let artifactReads = 0;
  let releaseSettledProjection!: () => void;
  const settledProjectionGate = new Promise<void>((resolve) => {
    releaseSettledProjection = resolve;
  });

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/artifacts**`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      artifactReads += 1;
      if (conflictRaised && artifactReads === 2) {
        // Hold the first recovery refetch open long enough to prove the local
        // fence is active before canonical settlement releases it.
        await settledProjectionGate;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [conflictRaised ? { ...artifact, status: "ready" } : artifact],
          meta: { nextCursor: null, hasNext: false, limit: 100 },
        }),
      });
    },
  );
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/actions/${actionId}/artifacts`,
    async (route) => {
      createAttempts += 1;
      conflictRaised = true;
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify(
          problem(
            "RUN_ALREADY_ACTIVE",
            "The winning run settled before the artifact refetch.",
            409,
          ),
        ),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  const card = page.locator(`[data-studio-artifact-id="${artifactId}"]`);
  await card.getByRole("button", { name: "Regenerate" }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect.poll(() => createAttempts).toBe(1);
  await expect.poll(() => artifactReads).toBe(2);
  // Re-aimed for the unified queue, not loosened. The fence used to show as a
  // disabled "Generating…" button on the card. In the unified queue a fenced
  // row is not given a regenerate handler at all and its Open control is
  // disabled (studio/_studio.tsx:3089 `generationFenced`, :711 `onRegenerate`,
  // :705 `disabled={selectionBlocked}`), so the same fence is now proven by
  // the ABSENCE of the control plus a blocked selection. Both halves are
  // required: a fence that silently dropped would restore the button, and a
  // fence that stopped blocking selection would enable Open.
  await expect(card.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Open", exact: true }),
  ).toBeDisabled();
  expect(createAttempts).toBe(1);

  releaseSettledProjection();
  const regenerate = card.getByRole("button", { name: "Regenerate" });
  await expect(regenerate).toBeEnabled();
  await expect(page.locator("[data-studio-conflict-recovery]")).toHaveCount(0);
  expect(createAttempts).toBe(1);

  await regenerate.click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => createAttempts).toBe(2);
});

test("Studio fences a locally queued generation before artifact projection catches up", async ({
  page,
}) => {
  const runId = "artifact-run";
  const actionId = "00000000-0000-4000-8000-000000000301";
  const artifactId = "00000000-0000-4000-8000-000000000401";
  const staleArtifact = {
    id: artifactId,
    actionId,
    artifactType: "technical_ticket",
    status: "draft",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 2,
    validationState: "valid",
    current: {
      id: "00000000-0000-4000-8000-000000000402",
      revision: 2,
      contentFormat: "markdown",
      content: "Projection remains stale while the accepted run starts.",
      contentHash: "sha256:stale-artifact-projection",
      validationErrors: [],
      note: null,
      createdAt: "2026-07-20T12:00:00.000Z",
    },
    activeRun: null,
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
  };
  let artifactReads = 0;
  let runReads = 0;

  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/artifacts**`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      artifactReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          // Deliberately keep returning the pre-202 projection. The card must
          // consume the local action/type fence instead of waiting for this
          // record to expose status=generating and activeRun.
          data: [staleArtifact],
          meta: { nextCursor: null, hasNext: false, limit: 100 },
        }),
      });
    },
  );
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/runs/${runId}`,
    async (route) => {
      runReads += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            id: runId,
            projectId: E2E_PROJECT_ID,
            kind: "artifact_generation",
            status: "running",
            progress: {
              phase: "generate",
              current: 1,
              total: 2,
              messageKey: "worker.artifact_generation",
            },
            lastError: null,
            resultRef: null,
            queuedAt: "2026-07-20T12:00:00.000Z",
            startedAt: "2026-07-20T12:00:00.000Z",
            completedAt: null,
          },
        }),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  const hero = page.locator("[data-studio-page-hero]");
  const canvas = page.locator("[data-studio-editor-column]");
  await hero.getByRole("button", { name: "Generate artifact" }).click();
  await canvas
    .getByRole("listitem")
    .filter({ hasText: "Fix the failing product page" })
    .getByRole("button", { name: "Regenerate", exact: true })
    .click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect.poll(() => artifactReads).toBeGreaterThanOrEqual(2);
  await expect.poll(() => runReads).toBeGreaterThanOrEqual(1);
  await expect.poll(() => api.artifactCreateRequests.length).toBe(1);

  const staleCard = page.locator(`[data-studio-artifact-id="${artifactId}"]`);
  await expect(
    staleCard.getByText("Generating", { exact: true }),
  ).toBeVisible();
  await expect(
    staleCard.getByRole("button", { name: "Generating…" }),
  ).toBeDisabled();

  await hero.getByRole("button", { name: "Generate artifact" }).click();
  const queuedAction = canvas
    .getByRole("listitem")
    .filter({ hasText: "Fix the failing product page" })
    .getByRole("button", { name: "Generating…" });
  await expect(queuedAction).toBeDisabled();
  expect(api.artifactCreateRequests).toHaveLength(1);
});

test("zh-CN Studio keeps server validation detail out of localized feedback", async ({
  page,
}) => {
  const rawMessage = "Server-only English artifact validation detail.";
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/artifacts/00000000-0000-4000-8000-000000000401`,
    async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 422,
        contentType: "application/problem+json",
        body: JSON.stringify(validationProblem(rawMessage)),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  await page.getByRole("button", { name: "简体中文" }).click();
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await page.getByLabel("内容").fill("更新后的执行物内容");
  await page.getByRole("button", { name: "保存版本" }).click();

  await expect(
    page.getByText("此执行物暂时无法标记为就绪，请解决下列错误。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(rawMessage);
});

// REMOVED: "zh-CN Diagnosis keeps server validation detail out of localized
// review feedback". It filled the finding card's inline review form, which
// lives in diagnosis/_finding-card.tsx — a file only DiagnosisClient
// (_diagnosis.tsx:722) mounts, and nothing mounts DiagnosisClient since
// /diagnosis became a redirect (diagnosis/page.tsx:19). Growth Map reviews a
// Finding from its own detail rail (growth-map/_growth-map.tsx:552): a
// different control with different copy, so this is a deletion rather than a
// re-aim. The zh-CN sibling for the Studio editor, directly above, still
// proves that server validation detail never reaches localized feedback.

for (const screen of ["execution", "results"] as const) {
  test(`${screen} mock shell has no critical/serious axe violations`, async ({
    page,
  }) => {
    await page.goto(`/p/${E2E_PROJECT_ID}/${screen}`);
    await expect(page.getByRole("main")).toBeVisible();
    if (screen === "results") {
      // Scan the ready surface, not a spinner (R3 blueprint D8): the report
      // document must be mounted and query traffic settled before axe runs.
      await expect(page.locator("[data-report-document]")).toBeVisible();
      await expect(page.locator("[data-results-recheck-settled]")).toHaveCount(
        1,
      );
      await page.waitForLoadState("networkidle");
    }
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking: string[] = [];
    for (const violation of results.violations) {
      if (violation.impact !== "critical" && violation.impact !== "serious") {
        continue;
      }
      if (violation.id === "color-contrast") {
        for (const node of violation.nodes) {
          if (!(await nodeInSidebar(page, node.target as string[]))) {
            blocking.push(`${violation.id} @ ${node.target.join(" ")}`);
          }
        }
      } else {
        blocking.push(violation.id);
      }
    }
    expect(blocking, `axe violations on ${screen}`).toEqual([]);
  });
}

/**
 * D8: the ready-state keyboard path through the export rail. From the locale
 * input, Tab reaches Print, then Service bundle, then Client bundle — the
 * full operator flow is reachable without a pointer.
 */
test("results export rail is keyboard-traversable in its ready state", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await expect(page.locator("[data-report-document]")).toBeVisible();
  await page.waitForLoadState("networkidle");

  const locale = page.getByLabel("Requested methodology locale");
  await locale.focus();
  await expect(locale).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Print" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Service bundle", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Client bundle", exact: true }),
  ).toBeFocused();
});

// Revived (R3 blueprint D8): the two export error-state cases the hardening
// round REMOVED with ReportClient, re-aimed at the restored export rail on
// /results, plus the new closed-state-machine scenarios (D5): sequence-driven
// recovery to a manifest, the single-flight fence, 409 takeover with and
// without a body pointer, and the 202-without-resourceRef protocol error.

test("Results distinguishes an existing export from a temporarily unavailable service", async ({
  page,
}) => {
  let code = "RUN_ALREADY_ACTIVE";
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/exports`,
    async (route) => {
      const status = code === "RUN_ALREADY_ACTIVE" ? 409 : 503;
      await route.fulfill({
        status,
        contentType: "application/problem+json",
        body: JSON.stringify(
          problem(code, "raw export-provider detail", status),
        ),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await page.getByRole("button", { name: "Service bundle" }).click();
  await expect(
    page.getByText("An export is already being prepared", { exact: false }),
  ).toBeVisible();
  // A pointerless 409 never pretends to track: recovery is an explicit retry.
  await expect(
    page.getByRole("button", { name: "Retry export" }),
  ).toBeVisible();
  expect(api.exportDetailReads).toEqual([]);

  code = "DEPENDENCY_UNAVAILABLE";
  await page.getByRole("button", { name: "Client bundle" }).click();
  await expect(
    page.getByText("The export service is temporarily unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(
    "raw export-provider detail",
  );
});

test("Results maps bundle-read dependency errors and exposes a retry", async ({
  page,
}) => {
  let bundleReads = 0;
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/exports/export-bundle`,
    async (route) => {
      bundleReads += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify(
          problem(
            "DEPENDENCY_UNAVAILABLE",
            "raw object-storage endpoint detail",
            503,
          ),
        ),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await page.getByRole("button", { name: "Client bundle" }).click();
  await expect(
    page.getByText("The export service is temporarily unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry status check" });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("raw object-storage");
  await expect.poll(() => bundleReads).toBe(2);

  await retry.click();
  await expect.poll(() => bundleReads).toBe(4);
});

/**
 * D8: the programmable detail sequence drives the whole closed loop — queued,
 * running, a surfaced 503 (two steps because the query client retries once),
 * an explicit Retry, and a completion that must reach the manifest and the
 * download link, not merely count requests.
 */
test("Results export recovers from a mid-poll outage through Retry to a manifest", async ({
  page,
}) => {
  const scoped = await installCriticalFlowApi(page, {
    exportDetailSequence: [
      "queued",
      "running",
      "unavailable",
      "unavailable",
      "running",
      "completed",
    ],
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await page.getByRole("button", { name: "Client bundle" }).click();

  // The poll reads queued/running, then the double 503 surfaces as a
  // dependency error with the status retry.
  await expect(
    page.getByText("The export service is temporarily unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  await expect.poll(() => scoped.exportDetailReads.length).toBe(4);
  // While the poll errors the tracked export is not abandoned: both create
  // buttons stay locked and only one command ever left the browser.
  await expect(
    page.getByRole("button", { name: "Service bundle", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Client bundle", exact: true }),
  ).toBeDisabled();
  expect(scoped.exportRequests).toHaveLength(1);

  await page.getByRole("button", { name: "Retry status check" }).click();
  await expect(
    page.getByRole("heading", { name: "Export manifest" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("link", { name: "Download client bundle" }),
  ).toBeVisible();
  expect(scoped.exportRequests).toHaveLength(1);
  // Terminal settles the machine: the create buttons unlock again.
  await expect(
    page.getByRole("button", { name: "Service bundle", exact: true }),
  ).toBeEnabled();
});

/**
 * D5 single flight: a double click is one server command, and while the
 * export is live the tracked poll is never unmounted by further clicks — the
 * old rail cleared the exportId on every click and lost the running export.
 */
test("Results export double click sends exactly one POST and never drops the live poll", async ({
  page,
}) => {
  const scoped = await installCriticalFlowApi(page, {
    exportDetailSequence: ["queued", "running", "running", "completed"],
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await page
    .getByRole("button", { name: "Client bundle", exact: true })
    .dblclick();

  await expect.poll(() => scoped.exportRequests.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Client bundle", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Service bundle", exact: true }),
  ).toBeDisabled();

  // The same tracked exportId keeps being polled across the lock window.
  await expect
    .poll(() => scoped.exportDetailReads.length, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3);
  expect(new Set(scoped.exportDetailReads)).toEqual(new Set(["export-bundle"]));
  expect(scoped.exportRequests).toHaveLength(1);

  await expect(
    page.getByRole("heading", { name: "Export manifest" }),
  ).toBeVisible({ timeout: 15_000 });
});

/**
 * D5 takeover: a 409 whose body names the active export (the server's new
 * `current` pointer) is adopted — the rail tracks the existing export to its
 * manifest without issuing another create command.
 */
test("Results adopts a 409 current pointer and tracks the existing export", async ({
  page,
}) => {
  const scoped = await installCriticalFlowApi(page, {
    exportCreate: "conflictWithCurrent",
    exportDetailSequence: ["running", "completed"],
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await page
    .getByRole("button", { name: "Client bundle", exact: true })
    .click();

  // The adopted export is the pointer's UUID, not a fresh create.
  await expect
    .poll(() => scoped.exportDetailReads.length)
    .toBeGreaterThanOrEqual(1);
  expect(new Set(scoped.exportDetailReads)).toEqual(
    new Set([E2E_ACTIVE_EXPORT_BUNDLE_ID]),
  );
  await expect(
    page.getByText("An export is already being prepared", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Export manifest" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(scoped.exportRequests).toHaveLength(1);
});

/**
 * D5: a 202 that names no trackable export must become a visible protocol
 * error — never a silently blank rail (the old rail rendered nothing).
 */
test("Results surfaces a 202 without a resourceRef as a protocol error", async ({
  page,
}) => {
  const scoped = await installCriticalFlowApi(page, {
    exportCreate: "acceptedMissingResourceRef",
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await page
    .getByRole("button", { name: "Client bundle", exact: true })
    .click();

  await expect(
    page.getByText("no trackable export id was returned", { exact: false }),
  ).toBeVisible();
  expect(scoped.exportDetailReads).toEqual([]);
  // The failure is retryable: the create buttons unlock again.
  await expect(
    page.getByRole("button", { name: "Client bundle", exact: true }),
  ).toBeEnabled();
});

/**
 * D2 four-quadrant isolation: the recheck block and the report block are
 * independent query boundaries — each failure mode must leave the sibling
 * fully readable.
 */
test("Results keeps the recheck and report blocks independent across all four quadrants", async ({
  page,
}) => {
  let recheckMode: "ok" | "missing" = "ok";
  let reportMode: "ok" | "down" = "ok";
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/results`,
    async (route) => {
      if (recheckMode === "ok") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: recheckResultsFixture() }),
        });
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: "application/problem+json",
        body: JSON.stringify(problem("NOT_FOUND", "No recheck yet.", 404)),
      });
    },
  );
  await page.route(
    new RegExp(`/api/mvp/projects/${E2E_PROJECT_ID}/report(\\?|$)`),
    async (route) => {
      if (reportMode === "ok") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify(
          problem("DEPENDENCY_UNAVAILABLE", "raw report backend detail", 503),
        ),
      });
    },
  );

  // Quadrant 1: recheck 200 / report 200.
  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await expect(
    page.getByText("Prior run observed", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-report-document]")).toBeVisible();

  // Quadrant 2: recheck 404 / report 200 — the honest empty state, and the
  // report document is untouched.
  recheckMode = "missing";
  await page.reload();
  await expect(page.getByText("No recheck yet", { exact: true })).toBeVisible();
  await expect(page.locator("[data-report-document]")).toBeVisible();

  // Quadrant 3: recheck 200 / report 503 — the comparison stays readable, the
  // report block alone shows the failure, and its Retry restores the document
  // once the read recovers.
  recheckMode = "ok";
  reportMode = "down";
  await page.reload();
  await expect(
    page.getByText("Prior run observed", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-report-document]")).toHaveCount(0);
  const reportRetry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(reportRetry).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(
    "raw report backend detail",
  );
  reportMode = "ok";
  await reportRetry.click();
  await expect(page.locator("[data-report-document]")).toBeVisible();
  await expect(
    page.getByText("Prior run observed", { exact: true }),
  ).toBeVisible();

  // Quadrant 4: recheck 404 / report 503 — both honest states coexist under
  // the screen's h1; neither block swallows the page.
  recheckMode = "missing";
  reportMode = "down";
  await page.reload();
  await expect(page.getByText("No recheck yet", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Results", level: 1 }),
  ).toBeVisible();
});

test("OAuth callback guidance is allowlisted and raw query text is discarded", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/sources?error=OAUTH_STATE_EXPIRED`);
  await expect(
    page.getByText("This Google connection session expired", { exact: false }),
  ).toBeVisible();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/sources`);

  const attackerText = "<img src=x onerror=alert(document.cookie)>";
  await page.goto(
    `/p/${E2E_PROJECT_ID}/sources?error=${encodeURIComponent(attackerText)}`,
  );
  await expect(
    page.getByText("We couldn't complete the Google connection", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(attackerText);
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/sources`);
});

/**
 * Reproduction for §16.7: the 409 recovery fence is component state, so a route
 * change unmounts it. The window that matters is the one the fence exists for —
 * the canonical artifact projection has NOT caught up — so the projection is
 * held deliberately incomplete here (`hasNext: true` with the follow-up page
 * never answered), which is exactly the condition under which §16 requires the
 * fence to stay. A settled projection would prove nothing: `c4c92a3` correctly
 * RELEASES the fence in that case.
 *
 * The second POST this exposes is refused by the server anyway
 * (`artifacts.ts:263` active key, `:466` unique-index handling,
 * `0001_init.sql:318`), so this is a UX defect, not a correctness one. The test
 * asserts the fence, not the absence of a duplicate run.
 */
test("Studio keeps the 409 fence across a route change while the projection is incomplete", async ({
  page,
}) => {
  const now = "2026-07-20T12:00:00.000Z";
  const actionId = "00000000-0000-4000-8000-000000000301";
  const artifactId = "00000000-0000-4000-8000-000000000401";
  const artifact = {
    id: artifactId,
    actionId,
    artifactType: "technical_ticket",
    status: "draft",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 2,
    validationState: "valid",
    current: {
      id: "00000000-0000-4000-8000-000000000402",
      revision: 2,
      contentFormat: "markdown",
      content:
        "Artifact whose winning run the projection has not caught up to.",
      contentHash: "sha256:route-change-fence",
      validationErrors: [],
      note: null,
      createdAt: now,
    },
    activeRun: null,
  };

  let createAttempts = 0;
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/artifacts**`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      // Page 2 is never answered, so `hasNextPage` stays true and the
      // projection never completes — the exact state the fence guards.
      if (new URL(route.request().url()).searchParams.get("cursor")) {
        await new Promise(() => {});
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [artifact],
          meta: { nextCursor: "cursor-page-2", hasNext: true, limit: 100 },
        }),
      });
    },
  );
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/actions/${actionId}/artifacts`,
    async (route) => {
      createAttempts += 1;
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify(
          problem(
            "RUN_ALREADY_ACTIVE",
            "A run for this artifact is live.",
            409,
          ),
        ),
      });
    },
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/execution`);
  const card = page.locator(`[data-studio-artifact-id="${artifactId}"]`);
  await card.getByRole("button", { name: "Regenerate" }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => createAttempts).toBe(1);

  // Fenced on this mount, proven the way §16.4 proves it.
  await expect(card.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Open", exact: true }),
  ).toBeDisabled();

  const navLinks = page
    .getByRole("navigation", { name: "Project sections" })
    .getByRole("link");
  await navLinks.nth(0).click();
  await expect(page).toHaveURL(
    new RegExp(`/p/${E2E_PROJECT_ID}/overview(\\?|$)`),
  );
  await navLinks.nth(2).click();
  // Studio writes the selected deliverable into the query once it mounts, so
  // the destination is asserted by path. Anchoring on the end of the URL made
  // this pass alone and fail in the full suite, which is a race in the
  // assertion rather than anything about the fence.
  await expect(page).toHaveURL(
    new RegExp(`/p/${E2E_PROJECT_ID}/execution(\\?|$)`),
  );

  // The run is still live and the projection still cannot prove otherwise, so
  // the fence has to survive the round trip.
  await expect(card.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Open", exact: true }),
  ).toBeDisabled();
  expect(createAttempts).toBe(1);
});
