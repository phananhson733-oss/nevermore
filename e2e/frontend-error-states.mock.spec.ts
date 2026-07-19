import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  sourceSlot,
  type CriticalFlowApiState,
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
    provider: "ga4",
    datasetKey: "ga4.organic_landing_daily.v1",
    schemaVersion: "0.2.0",
    methodVersion: "ga4.organic_landing.v1",
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
  };
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

test("Studio clears a failed run poll, refreshes artifacts, and shows an action", async ({
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
    `**/api/mvp/projects/${E2E_PROJECT_ID}/artifacts`,
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
  const refresh = page.getByRole("button", { name: "Refresh artifacts" });
  await expect(refresh).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("raw model-provider");
  await expect.poll(() => runReads).toBe(2);
  await expect.poll(() => artifactReads).toBeGreaterThanOrEqual(2);

  await refresh.click();
  await expect(
    page.getByText("We couldn't refresh the generation status", {
      exact: false,
    }),
  ).toHaveCount(0);
  await page.waitForTimeout(750);
  expect(runReads).toBe(2);
});

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
