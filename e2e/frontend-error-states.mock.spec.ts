import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  E2E_SNAPSHOT_PROVENANCE,
  installCriticalFlowApi,
  sourceSlot,
  type CriticalFlowApiState,
  type MockDataSnapshot,
} from "./mock-api.ts";

let api: CriticalFlowApiState;

test.beforeEach(async ({ page }) => {
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
  await page.route(`**/api/mvp/projects/${E2E_PROJECT_ID}/sources`, async (route) => {
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
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  await expect(page.getByText("Error code", { exact: true })).toBeVisible();
  await expect(page.getByText("DEPENDENCY_UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(page.getByText("Request ID", { exact: true })).toBeVisible();
  await expect(page.getByText("frontend-error-e2e", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("raw provider topology");

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
    crawl.getByText("Provider rate limit reached; automatic retry is scheduled."),
  ).toBeVisible();
  await expect(crawl.getByText("Automatic retry scheduled.")).toBeVisible();
  await expect(crawl.getByRole("button", { name: "Collect now" })).toBeDisabled();

  const gsc = page.getByRole("region", { name: "Search Console" });
  await expect(gsc.getByText("Permission denied", { exact: true })).toBeVisible();
  await expect(gsc).toContainText("Disconnect and reconnect a property you can access.");
  await expect(gsc.getByText("Reconnect required before collecting again.")).toBeVisible();
  await expect(gsc.getByRole("button", { name: "Collect now" })).toHaveCount(0);

  const ga4 = page.getByRole("region", { name: "Google Analytics 4" });
  await expect(ga4.getByText("Partial", { exact: true })).toHaveCount(2);
  await expect(ga4).toContainText("session rows remain available");
  await expect(ga4.getByRole("button", { name: "Retry collection" })).toBeVisible();
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
    progress: { phase: "generate", current: 1, total: 2, messageKey: "ignored" },
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
  await page
    .getByLabel("Generation mode")
    .selectOption("structured_llm");
  await page.getByRole("button", { name: "Generate", exact: true }).click();

  await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
  await expect(page.getByText("Error code", { exact: true })).toBeVisible();
  await expect(page.getByText("DEPENDENCY_UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(page.getByText("Request ID", { exact: true })).toBeVisible();
  await expect(page.getByText("frontend-error-e2e", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("raw model-provider credential");

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
  await expect(page.locator(`[data-studio-active-run="${runId}"]`)).toBeVisible();
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
          data: [
            conflictRaised ? { ...artifact, status: "ready" } : artifact,
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
  await expect(
    card.getByRole("button", { name: "Generating…" }),
  ).toBeDisabled();
  expect(createAttempts).toBe(1);

  releaseSettledProjection();
  const regenerate = card.getByRole("button", { name: "Regenerate" });
  await expect(regenerate).toBeEnabled();
  await expect(
    page.locator("[data-studio-conflict-recovery]"),
  ).toHaveCount(0);
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

  const staleCard = page.locator(
    `[data-studio-artifact-id="${artifactId}"]`,
  );
  await expect(staleCard.getByText("Generating", { exact: true })).toBeVisible();
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

test("zh-CN Diagnosis keeps server validation detail out of localized review feedback", async ({
  page,
}) => {
  const rawMessage = "Server-only English finding review validation detail.";
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/findings/00000000-0000-4000-8000-000000000202`,
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

  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);
  await page.getByRole("button", { name: "简体中文" }).click();
  const finding = page
    .getByRole("article")
    .filter({ hasText: "A product page returned a server error." });
  await finding.getByRole("button", { name: "忽略", exact: true }).click();
  await finding.getByLabel("原因").fill("已有替代方案");
  await finding.getByRole("button", { name: "提交", exact: true }).click();

  await expect(
    finding.getByText("无法保存你的审核，请重试。", { exact: true }),
  ).toBeVisible();
  await expect(finding).not.toContainText(rawMessage);
});

for (const screen of ["plan", "studio"] as const) {
  test(`${screen} mock shell has no critical/serious axe violations`, async ({
    page,
  }) => {
    await page.goto(`/p/${E2E_PROJECT_ID}/${screen}`);
    await expect(page.getByRole("main")).toBeVisible();
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

test("Report distinguishes an existing export from a temporarily unavailable service", async ({
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

  await page.goto(`/p/${E2E_PROJECT_ID}/report`);
  await page.getByRole("button", { name: "Service bundle" }).click();
  await expect(
    page.getByText("An export is already being prepared", { exact: false }),
  ).toBeVisible();

  code = "DEPENDENCY_UNAVAILABLE";
  await page.getByRole("button", { name: "Client bundle" }).click();
  await expect(
    page.getByText("The export service is temporarily unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("Error code", { exact: true })).toBeVisible();
  await expect(page.getByText("DEPENDENCY_UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(page.getByText("Request ID", { exact: true })).toBeVisible();
  await expect(page.getByText("frontend-error-e2e", { exact: true })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText(
    "raw export-provider detail",
  );
});

test("Report maps bundle-read dependency errors and exposes a retry", async ({
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

  await page.goto(`/p/${E2E_PROJECT_ID}/report`);
  await page.getByRole("button", { name: "Client bundle" }).click();
  await expect(
    page.getByText("The export service is temporarily unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("Error code", { exact: true })).toBeVisible();
  await expect(page.getByText("DEPENDENCY_UNAVAILABLE", { exact: true })).toBeVisible();
  await expect(page.getByText("Request ID", { exact: true })).toBeVisible();
  await expect(page.getByText("frontend-error-e2e", { exact: true })).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry status check" });
  await expect(retry).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("raw object-storage");
  await expect.poll(() => bundleReads).toBe(2);

  await retry.click();
  await expect.poll(() => bundleReads).toBe(4);
});

test("OAuth callback guidance is allowlisted and raw query text is discarded", async ({
  page,
}) => {
  await page.goto(
    `/p/${E2E_PROJECT_ID}/sources?error=OAUTH_STATE_EXPIRED`,
  );
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
