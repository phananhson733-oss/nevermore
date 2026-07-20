import { expect, test, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  diagnosisFindingFixture,
  diagnosisFindingsEnvelopeFixture,
  installCriticalFlowApi,
  type CriticalFlowApiState,
} from "./mock-api.ts";

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const NOW = "2026-07-20T00:00:00.000Z";

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: status >= 400 ? "application/problem+json" : "application/json",
    body: JSON.stringify(body),
  });
}

function listEnvelope(
  data: readonly unknown[],
  nextCursor: string | null,
) {
  return {
    data,
    meta: {
      nextCursor,
      hasNext: nextCursor !== null,
      limit: 100,
    },
  };
}

function actionFixture(index: number, title: string) {
  const suffix = String(700 + index).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    findingId: `00000000-0000-4000-8001-${suffix}`,
    templateId: "fix_http_status.v1",
    title,
    description: `Description for ${title}`,
    contentLocale: "en",
    priorityBand: "high",
    roadmapLane: index === 1 ? "now" : "next",
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: `Outcome for ${title}`,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function artifactFixture(
  index: number,
  actionId: string,
  artifactType: "technical_ticket" | "content_brief",
) {
  const suffix = String(800 + index).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    actionId,
    artifactType,
    status: "draft",
    generationMode: "template",
    outputLocale: "en",
    currentRevision: 1,
    validationState: "valid",
    current: {
      id: `00000000-0000-4000-8001-${suffix}`,
      revision: 1,
      outputLocale: "en",
      contentFormat: "markdown",
      content: `Artifact page ${index}`,
      contentHash: `sha256:artifact-${index}`,
      validationErrors: [],
      note: null,
      createdAt: NOW,
    },
    activeRun: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function snapshotFixture(index: number) {
  const suffix = String(900 + index).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    provider: "crawl",
    datasetKey: "crawl_pages",
    schemaVersion: "1.0.0",
    methodVersion: "crawl-v1",
    capturedAt: `2026-07-${String(20 - index).padStart(2, "0")}T00:00:00.000Z`,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "Static HTML only.",
    rowCount: index,
    checksum: `sha256:snapshot-${index}`,
  };
}

let api: CriticalFlowApiState;

test.beforeEach(async ({ page }) => {
  api = await installCriticalFlowApi(page);
});

test("Diagnosis keeps the first sidecar canonical and retries a de-duplicated next page", async ({
  page,
}) => {
  const first = diagnosisFindingFixture({ summary: "First page finding" });
  const second = diagnosisFindingFixture({
    id: "00000000-0000-4000-8000-000000000222",
    ruleId: "CONTENT-COVERAGE-001",
    domain: "content_intent",
    summary: "Second page finding",
  });
  const canonical = diagnosisFindingsEnvelopeFixture([first]);
  let nextPageAttempts = 0;

  await page.route(`**${API_BASE}/findings**`, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("limit")).toBe("100");
    if (url.searchParams.get("cursor") === null) {
      await json(route, {
        ...canonical,
        meta: {
          ...canonical.meta,
          nextCursor: "diagnosis-page-2",
          hasNext: true,
          coverage: {
            ...canonical.meta.coverage,
            limitations: ["Canonical page-one coverage"],
          },
        },
      });
      return;
    }

    nextPageAttempts += 1;
    // QueryClient retries one failed read automatically. Fail both transport
    // attempts so the inline operator retry state becomes observable.
    if (nextPageAttempts <= 2) {
      await json(
        route,
        {
          type: "about:blank",
          title: "Service unavailable",
          status: 503,
          code: "DEPENDENCY_UNAVAILABLE",
          detail: "Temporary pagination failure.",
          requestId: "pagination-e2e",
        },
        503,
      );
      return;
    }
    await json(route, {
      ...diagnosisFindingsEnvelopeFixture([first, second]),
      meta: {
        ...canonical.meta,
        coverage: {
          ...canonical.meta.coverage,
          limitations: ["Later-page sidecar must not replace page one"],
        },
      },
    });
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);
  await expect(page.getByText("First page finding", { exact: true })).toBeVisible();
  await expect(page.getByText("Canonical page-one coverage", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();

  await expect(
    page.getByText(
      "We couldn't load the next page. Items already loaded are still shown.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText("First page finding", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByText("Second page finding", { exact: true })).toBeVisible();
  await expect(page.getByText("First page finding", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Canonical page-one coverage", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Later-page sidecar must not replace page one", { exact: true }),
  ).toHaveCount(0);
  expect(nextPageAttempts).toBe(3);
});

test("Diagnosis exhausts snapshot pages before freezing the latest capture per provider", async ({
  page,
}) => {
  const persistedLaterButCapturedOlder = {
    ...snapshotFixture(1),
    id: "00000000-0000-4000-8000-000000000911",
    capturedAt: "2026-07-18T00:00:00.000Z",
  };
  const capturedLatestCrawl = {
    ...snapshotFixture(2),
    id: "00000000-0000-4000-8000-000000000912",
    capturedAt: "2026-07-20T00:00:00.000Z",
  };
  const capturedLatestGa4 = {
    ...snapshotFixture(3),
    id: "00000000-0000-4000-8000-000000000913",
    provider: "ga4",
    capturedAt: "2026-07-19T00:00:00.000Z",
  };

  await page.route(`**${API_BASE}/snapshots**`, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("limit")).toBe("100");
    await json(
      route,
      url.searchParams.get("cursor") === null
        ? listEnvelope(
            [persistedLaterButCapturedOlder],
            "diagnosis-snapshots-2",
          )
        : listEnvelope([capturedLatestCrawl, capturedLatestGa4], null),
    );
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);
  await page.getByRole("button", { name: "Re-run diagnosis" }).click();
  await expect.poll(() => api.diagnosticRequests.length).toBe(1);
  expect(api.diagnosticRequests[0]).toMatchObject({
    snapshotIds: [capturedLatestCrawl.id, capturedLatestGa4.id],
  });
});

test("Plan exposes actions on the next cursor page", async ({ page }) => {
  const first = actionFixture(1, "First page plan action");
  const second = actionFixture(2, "Second page plan action");
  await page.route(`**${API_BASE}/actions**`, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    await json(
      route,
      cursor === null
        ? listEnvelope([first], "plan-page-2")
        : listEnvelope([second], null),
    );
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);
  await expect(page.getByText(first.title, { exact: true })).toBeVisible();
  await expect(page.getByText(second.title, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText(second.title, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
});

test("Studio exposes artifact and action next pages", async ({ page }) => {
  const firstAction = actionFixture(1, "First page studio action");
  const secondAction = actionFixture(2, "Second page studio action");
  const firstArtifact = artifactFixture(1, firstAction.id, "technical_ticket");
  const secondArtifact = artifactFixture(2, secondAction.id, "content_brief");

  await page.route(`**${API_BASE}/actions**`, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    await json(
      route,
      cursor === null
        ? listEnvelope([firstAction], "studio-actions-2")
        : listEnvelope([secondAction], null),
    );
  });
  await page.route(`**${API_BASE}/artifacts**`, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    await json(
      route,
      cursor === null
        ? listEnvelope([firstArtifact], "studio-artifacts-2")
        : listEnvelope([secondArtifact], null),
    );
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  await expect(page.getByText(firstAction.title, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Content brief", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Generate artifact" }).click();
  await expect(page.getByRole("heading", { name: "Pick an action" })).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText(secondAction.title, { exact: true })).toHaveCount(2);
});

test("Studio protects unsaved content and notes from editor transitions", async ({
  page,
}) => {
  const firstAction = actionFixture(1, "First guarded artifact");
  const secondAction = actionFixture(2, "Second guarded artifact");
  const firstArtifact = artifactFixture(1, firstAction.id, "technical_ticket");
  const secondArtifact = artifactFixture(2, secondAction.id, "content_brief");

  await page.route(`**${API_BASE}/actions**`, (route) =>
    json(route, listEnvelope([firstAction, secondAction], null)),
  );
  await page.route(`**${API_BASE}/artifacts**`, (route) =>
    json(route, listEnvelope([firstArtifact, secondArtifact], null)),
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/plan`);
  await page.getByRole("link", { name: "Studio" }).click();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/studio`);

  const firstOpen = page
    .getByText(firstAction.title, { exact: true })
    .locator("..")
    .getByRole("button", { name: "Open", exact: true });
  const secondOpen = page
    .getByText(secondAction.title, { exact: true })
    .locator("..")
    .getByRole("button", { name: "Open", exact: true });
  await firstOpen.click();
  const content = page.getByRole("textbox", { name: "Content" });
  const note = page.getByRole("textbox", { name: "Revision note" });
  await content.fill("Locally edited first artifact");
  await note.fill("Keep this operator note");

  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark ready" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Archive" })).toBeDisabled();
  await expect(
    page.getByText(
      "Save or discard your edits before changing this artifact's status.",
      { exact: true },
    ),
  ).toBeVisible();

  let dialogPromise = page.waitForEvent("dialog");
  await page.evaluate(() => window.setTimeout(() => location.reload(), 0));
  let dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(content).toHaveValue("Locally edited first artifact");

  dialogPromise = page.waitForEvent("dialog");
  let transitionPromise = page.getByRole("button", { name: "Close" }).click();
  dialog = await dialogPromise;
  expect(dialog.message()).toBe(
    "You have unsaved artifact edits. Leave and discard them?",
  );
  await dialog.dismiss();
  await transitionPromise;
  await expect(content).toHaveValue("Locally edited first artifact");
  await expect(note).toHaveValue("Keep this operator note");

  dialogPromise = page.waitForEvent("dialog");
  transitionPromise = secondOpen.click();
  dialog = await dialogPromise;
  await dialog.dismiss();
  await transitionPromise;
  await expect(content).toHaveValue("Locally edited first artifact");

  dialogPromise = page.waitForEvent("dialog");
  transitionPromise = secondOpen.click();
  dialog = await dialogPromise;
  await dialog.accept();
  await transitionPromise;
  await expect(content).toHaveValue("Artifact page 2");
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();

  await content.fill("Dirty before link navigation");
  dialogPromise = page.waitForEvent("dialog");
  transitionPromise = page.getByRole("link", { name: "Plan" }).click();
  dialog = await dialogPromise;
  await dialog.dismiss();
  await transitionPromise;
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/studio`);
  await expect(content).toHaveValue("Dirty before link navigation");

  dialogPromise = page.waitForEvent("dialog");
  transitionPromise = page.getByRole("link", { name: "Plan" }).click();
  dialog = await dialogPromise;
  await dialog.accept();
  await transitionPromise;
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/plan`);

  await page.getByRole("link", { name: "Studio" }).click();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/studio`);
  const studioPosition = await page.evaluate(
    () => history.state?.__sfProjectHistoryPosition as unknown,
  );
  expect(typeof studioPosition).toBe("number");
  await page.goBack();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/plan`);
  const planPosition = await page.evaluate(
    () => history.state?.__sfProjectHistoryPosition as unknown,
  );
  expect(typeof planPosition).toBe("number");
  expect(planPosition as number).toBeLessThan(studioPosition as number);
  await page.goForward();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/studio`);
  await firstOpen.click();
  await content.fill("Dirty before browser back");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  dialogPromise = page.waitForEvent("dialog");
  await page.evaluate(() => window.setTimeout(() => history.back(), 0));
  dialog = await dialogPromise;
  await dialog.dismiss();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/studio`);
  await expect(content).toHaveValue("Dirty before browser back");

  dialogPromise = page.waitForEvent("dialog");
  await page.evaluate(() => window.setTimeout(() => history.back(), 0));
  dialog = await dialogPromise;
  await dialog.accept();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/plan`);

  await page.goForward();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/studio`);
  await firstOpen.click();
  await expect(content).toHaveValue("Artifact page 1");
  await page.getByRole("link", { name: "Report" }).click();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/report`);
  await page.goBack();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/studio`);
  await firstOpen.click();

  await content.fill("Dirty before browser forward");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  dialogPromise = page.waitForEvent("dialog");
  await page.evaluate(() => window.setTimeout(() => history.forward(), 0));
  dialog = await dialogPromise;
  await dialog.dismiss();
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/studio`);
  await expect(content).toHaveValue("Dirty before browser forward");
});

test("Sources keeps partial counts visible while a failed next page is retried", async ({
  page,
}) => {
  let nextPageAttempts = 0;
  await page.route(`**${API_BASE}/snapshots**`, async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor === null) {
      await json(
        route,
        listEnvelope([snapshotFixture(1)], "source-snapshots-2"),
      );
      return;
    }
    nextPageAttempts += 1;
    if (nextPageAttempts <= 2) {
      await json(
        route,
        {
          type: "about:blank",
          title: "Service unavailable",
          status: 503,
          code: "DEPENDENCY_UNAVAILABLE",
          detail: "Temporary snapshot-history pagination failure.",
          requestId: "snapshot-pagination-e2e",
        },
        503,
      );
      return;
    }
    await json(route, listEnvelope([snapshotFixture(2)], null));
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  const crawl = page.getByRole("region", { name: "Site crawl" });
  await expect(crawl).toContainText("At least 1 snapshot loaded");
  await page
    .getByRole("button", { name: "Load more snapshot history" })
    .click();
  await expect(
    page.getByText(
      "We couldn't load the next page. Items already loaded are still shown.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(crawl).toContainText("At least 1 snapshot loaded");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(crawl).toContainText("2 snapshots collected");
  await expect(
    page.getByRole("button", { name: "Load more snapshot history" }),
  ).toHaveCount(0);
  expect(nextPageAttempts).toBe(3);
});

test("Sources refetches page one when a cached history refresh fails", async ({
  page,
}) => {
  let snapshotReads = 0;
  await page.route(`**${API_BASE}/snapshots**`, async (route) => {
    snapshotReads += 1;
    if (snapshotReads === 1 || snapshotReads >= 4) {
      await json(route, listEnvelope([snapshotFixture(1)], null));
      return;
    }
    await json(
      route,
      {
        type: "about:blank",
        title: "Service unavailable",
        status: 503,
        code: "DEPENDENCY_UNAVAILABLE",
        detail: "Temporary cached-history refresh failure.",
        requestId: "snapshot-refetch-e2e",
      },
      503,
    );
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  const crawl = page.getByRole("region", { name: "Site crawl" });
  await expect(crawl).toContainText("1 snapshots collected");
  await crawl.getByRole("button", { name: "Collect now" }).click();

  await expect(
    page.getByText(
      "We couldn't load the next page. Items already loaded are still shown.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(crawl).toContainText("At least 1 snapshot loaded");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => snapshotReads).toBe(4);
  await expect(crawl).toContainText("1 snapshots collected");
});
