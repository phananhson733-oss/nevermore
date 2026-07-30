import { expect, test, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  E2E_SNAPSHOT_PROVENANCE,
  installCriticalFlowApi,
  type MockDataSnapshot,
} from "./mock-api.ts";

/** The mock chrome assertions in this file are written in English; the app's
 *  default UI locale is zh-CN, so the locale cookie has to be set explicitly. */
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
});

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

function snapshotFixture(
  index: number,
  provider: MockDataSnapshot["provider"] = "crawl",
  overrides: Partial<MockDataSnapshot> = {},
): MockDataSnapshot {
  const suffix = String(900 + index).padStart(12, "0");
  const provenance = E2E_SNAPSHOT_PROVENANCE[provider];
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    siteId: E2E_SITE_ID,
    provider,
    datasetKey: provenance.datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: provenance.methodVersion,
    capturedAt: `2026-07-${String(20 - index).padStart(2, "0")}T00:00:00.000Z`,
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation:
      provider === "crawl" ? "Static HTML only." : "No known limitation.",
    rowCount: index,
    checksum: (index % 16).toString(16).repeat(64),
    ...overrides,
  };
}

/**
 * Assert which screen we are on without asserting the screen's own query
 * state. The canonical Execution route round-trips the open action and
 * artifact through `?actionId=&artifactId=`
 * (execution/page.tsx:24 + _execution-deep-link.ts); the retired /studio route
 * it replaced had no query, so the exact-string form these navigation
 * assertions used would now be asserting that deep linking is switched OFF.
 * The pathname is still compared exactly: a wrong route, or a typo in one,
 * fails exactly as before.
 */
function onProjectScreen(segment: string) {
  return (url: URL) => url.pathname === `/p/${E2E_PROJECT_ID}/${segment}`;
}

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
});

// REMOVED: "Diagnosis keeps the first sidecar canonical and retries a
// de-duplicated next page" and "Diagnosis exhausts pages, ignores legacy crawl,
// and freezes only same-site providers".
//
// Both drove the Diagnosis screen. /diagnosis is now a redirect to /growth-map
// (apps/web/src/app/p/[projectId]/diagnosis/page.tsx:19) and DiagnosisClient
// (diagnosis/_diagnosis.tsx:722) is imported by nothing, so the findings list,
// its coverage sidecar and the "Re-run diagnosis" trigger are unreachable and
// have no successor control on Growth Map. Deleted rather than re-aimed because
// there is nothing to re-aim at.
//
// The domain guarantees they carried keep their own coverage over the same
// functions in apps/web/src/lib/api/hooks-diagnosis-pagination.test.ts:
// "de-duplicates findings but preserves the first page sidecar" (:95),
// "anchors the selection to the latest usable current crawl and never mixes
// sites" (:123) and "ignores a newer unavailable current crawl when choosing
// the diagnostic site" (:166).

// REMOVED: "Plan exposes actions on the next cursor page". /plan is now a
// redirect to /execution (plan/page.tsx:16) and PlanClient (plan/_plan.tsx:1042)
// is imported by nothing, so the Plan action list it paged through is gone.
// Action cursor pagination itself is still proven on the canonical Execution
// surface by "Studio exposes artifact and action next pages" below, which pages
// the action picker and asserts the second page's action becomes selectable.

test("Studio exposes artifact and action next pages", async ({ page }) => {
  const firstAction = actionFixture(1, "First page studio action");
  const secondAction = actionFixture(2, "Second page studio action");
  const firstArtifact = artifactFixture(1, firstAction.id, "technical_ticket");
  const secondArtifact = artifactFixture(2, secondAction.id, "content_brief");

  await page.route(`**${API_BASE}/actions**`, async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() !== "GET" ||
      url.pathname !== `${API_BASE}/actions`
    ) {
      await route.fallback();
      return;
    }
    const cursor = url.searchParams.get("cursor");
    await json(
      route,
      cursor === null
        ? listEnvelope([firstAction], "studio-actions-2")
        : listEnvelope([secondAction], null),
    );
  });
  await page.route(`**${API_BASE}/artifacts**`, async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() !== "GET" ||
      url.pathname !== `${API_BASE}/artifacts`
    ) {
      await route.fallback();
      return;
    }
    const cursor = url.searchParams.get("cursor");
    await json(
      route,
      cursor === null
        ? listEnvelope([firstArtifact], "studio-artifacts-2")
        : listEnvelope([secondArtifact], null),
    );
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  const queue = page.locator("[data-studio-queue]");
  const hero = page.locator("[data-studio-page-hero]");
  const canvas = page.locator("[data-studio-editor-column]");
  await expect(queue.getByText(firstAction.title, { exact: true })).toBeVisible();
  await queue.getByRole("button", { name: "Load more" }).click();
  // Re-aimed for the unified queue, not loosened. The next page's artifact used
  // to be proven present by the per-type section heading that appeared with it;
  // the queue no longer has per-type sections. The proof now reads the ROW the
  // second page brought in, by its type — which is what the heading stood in
  // for, and it fails the same way if the second page never lands.
  await expect(
    queue.locator(
      '[data-studio-artifact-id][data-studio-artifact-type="content_brief"]',
    ),
  ).toHaveCount(1);

  await hero.getByRole("button", { name: "Generate artifact" }).click();
  await expect(canvas.getByRole("heading", { name: "Pick an action" })).toBeVisible();
  await canvas.getByRole("button", { name: "Load more" }).click();
  await expect(
    queue.getByText(secondAction.title, { exact: true }),
  ).toBeVisible();
  await expect(
    canvas.getByText(secondAction.title, { exact: true }),
  ).toBeVisible();
});

test("Studio guards hero generation and card regeneration while the editor is dirty", async ({
  page,
}) => {
  const action = actionFixture(1, "Guarded generation action");
  const artifact = artifactFixture(1, action.id, "technical_ticket");

  await page.route(`**${API_BASE}/actions**`, async (route) => {
    if (
      route.request().method() !== "GET" ||
      new URL(route.request().url()).pathname !== `${API_BASE}/actions`
    ) {
      await route.fallback();
      return;
    }
    await json(route, listEnvelope([action], null));
  });
  await page.route(`**${API_BASE}/artifacts**`, async (route) => {
    if (
      route.request().method() !== "GET" ||
      new URL(route.request().url()).pathname !== `${API_BASE}/artifacts`
    ) {
      await route.fallback();
      return;
    }
    await json(route, listEnvelope([artifact], null));
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  const content = page.getByRole("textbox", { name: "Content" });
  const note = page.getByRole("textbox", { name: "Revision note" });
  const heroGenerate = page
    .locator("[data-studio-page-hero]")
    .getByRole("button", { name: "Generate artifact" });
  const regenerate = page
    .locator(`[data-studio-artifact-id="${artifact.id}"]`)
    .getByRole("button", { name: "Regenerate" });

  await content.fill("Unsaved content survives a rejected transition");
  await note.fill("Unsaved note survives too");

  let dialogPromise = page.waitForEvent("dialog");
  let transitionPromise = heroGenerate.click();
  let dialog = await dialogPromise;
  expect(dialog.message()).toBe(
    "You have unsaved artifact edits. Leave and discard them?",
  );
  await dialog.dismiss();
  await transitionPromise;
  await expect(content).toHaveValue(
    "Unsaved content survives a rejected transition",
  );
  await expect(note).toHaveValue("Unsaved note survives too");
  await expect(page.getByRole("heading", { name: "Pick an action" })).toHaveCount(
    0,
  );

  dialogPromise = page.waitForEvent("dialog");
  transitionPromise = regenerate.click();
  dialog = await dialogPromise;
  await dialog.dismiss();
  await transitionPromise;
  await expect(content).toHaveValue(
    "Unsaved content survives a rejected transition",
  );
  await expect(note).toHaveValue("Unsaved note survives too");
  await expect(page.getByLabel("Generation mode")).toHaveCount(0);

  dialogPromise = page.waitForEvent("dialog");
  transitionPromise = heroGenerate.click();
  dialog = await dialogPromise;
  await dialog.accept();
  await transitionPromise;
  await expect(page.getByRole("heading", { name: "Pick an action" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(content).toHaveValue("Artifact page 1");
  await expect(note).toHaveValue("");

  await content.fill("A second explicitly discardable draft");
  await note.fill("Second note");
  dialogPromise = page.waitForEvent("dialog");
  transitionPromise = regenerate.click();
  dialog = await dialogPromise;
  await dialog.accept();
  await transitionPromise;
  await expect(page.getByLabel("Generation mode")).toBeVisible();
});

test("Studio protects unsaved content and notes from editor transitions", async ({
  page,
}) => {
  const firstAction = actionFixture(1, "First guarded artifact");
  const secondAction = actionFixture(2, "Second guarded artifact");
  const firstArtifact = artifactFixture(1, firstAction.id, "technical_ticket");
  const secondArtifact = artifactFixture(2, secondAction.id, "content_brief");

  await page.route(`**${API_BASE}/actions**`, async (route) => {
    if (
      route.request().method() !== "GET" ||
      new URL(route.request().url()).pathname !== `${API_BASE}/actions`
    ) {
      await route.fallback();
      return;
    }
    await json(route, listEnvelope([firstAction, secondAction], null));
  });
  await page.route(`**${API_BASE}/artifacts**`, async (route) => {
    if (
      route.request().method() !== "GET" ||
      new URL(route.request().url()).pathname !== `${API_BASE}/artifacts`
    ) {
      await route.fallback();
      return;
    }
    await json(route, listEnvelope([firstArtifact, secondArtifact], null));
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await page.getByRole("link", { name: "Execution", exact: true }).click();
  await expect(page).toHaveURL(onProjectScreen("execution"));

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
  transitionPromise = page.getByRole("link", { name: "Results" }).click();
  dialog = await dialogPromise;
  await dialog.dismiss();
  await transitionPromise;
  await expect(page).toHaveURL(onProjectScreen("execution"));
  await expect(content).toHaveValue("Dirty before link navigation");

  dialogPromise = page.waitForEvent("dialog");
  transitionPromise = page.getByRole("link", { name: "Results" }).click();
  dialog = await dialogPromise;
  await dialog.accept();
  await transitionPromise;
  await expect(page).toHaveURL(onProjectScreen("results"));

  await page.getByRole("link", { name: "Execution", exact: true }).click();
  await expect(page).toHaveURL(onProjectScreen("execution"));
  const executionPosition = await page.evaluate(
    () => history.state?.__sfProjectHistoryPosition as unknown,
  );
  expect(typeof executionPosition).toBe("number");
  await page.goBack();
  await expect(page).toHaveURL(onProjectScreen("results"));
  const resultsPosition = await page.evaluate(
    () => history.state?.__sfProjectHistoryPosition as unknown,
  );
  expect(typeof resultsPosition).toBe("number");
  expect(resultsPosition as number).toBeLessThan(executionPosition as number);
  await page.goForward();
  await expect(page).toHaveURL(onProjectScreen("execution"));
  await firstOpen.click();
  await content.fill("Dirty before browser back");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  dialogPromise = page.waitForEvent("dialog");
  await page.evaluate(() => window.setTimeout(() => history.back(), 0));
  dialog = await dialogPromise;
  await dialog.dismiss();
  await expect(page).toHaveURL(onProjectScreen("execution"));
  await expect(content).toHaveValue("Dirty before browser back");

  dialogPromise = page.waitForEvent("dialog");
  await page.evaluate(() => window.setTimeout(() => history.back(), 0));
  dialog = await dialogPromise;
  await dialog.accept();
  await expect(page).toHaveURL(onProjectScreen("results"));

  await page.goForward();
  await expect(page).toHaveURL(onProjectScreen("execution"));
  await firstOpen.click();
  await expect(content).toHaveValue("Artifact page 1");
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(onProjectScreen("overview"));
  await page.goBack();
  await expect(page).toHaveURL(onProjectScreen("execution"));
  await firstOpen.click();

  await content.fill("Dirty before browser forward");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  dialogPromise = page.waitForEvent("dialog");
  await page.evaluate(() => window.setTimeout(() => history.forward(), 0));
  dialog = await dialogPromise;
  await dialog.dismiss();
  await expect(page).toHaveURL(onProjectScreen("execution"));
  await expect(content).toHaveValue("Dirty before browser forward");
});

test("Sources keeps partial counts visible while a failed next page is retried", async ({
  page,
}) => {
  let nextPageAttempts = 0;
  await page.route(`**${API_BASE}/snapshots**`, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const provider = params.get("provider");
    const cursor = params.get("cursor");
    if (provider === "ga4") {
      await json(route, listEnvelope([], null));
      return;
    }
    if (cursor === null) {
      await json(
        route,
        listEnvelope([snapshotFixture(1, "gsc")], "source-snapshots-2"),
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
    await json(route, listEnvelope([snapshotFixture(2, "gsc")], null));
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  const gsc = page.getByRole("region", { name: "Search Console" });
  await expect(gsc).toContainText("At least 1 immutable snapshot loaded");
  await page
    .getByRole("button", { name: "Load more snapshot history" })
    .click();
  await expect(
    page.getByText(
      "We couldn't load the next page. Items already loaded are still shown.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(gsc).toContainText("At least 1 immutable snapshot loaded");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(gsc).toContainText("2 immutable snapshots");
  await expect(
    page.getByRole("button", { name: "Load more snapshot history" }),
  ).toHaveCount(0);
  expect(nextPageAttempts).toBe(3);
});

test("Sources pages GSC and GA4 independently of hidden-provider history", async ({
  page,
}) => {
  const cursorsByProvider = new Map<string, (string | null)[]>([
    ["gsc", []],
    ["ga4", []],
    ["unfiltered", []],
  ]);
  await page.route(`**${API_BASE}/snapshots**`, async (route) => {
    const url = new URL(route.request().url());
    const provider = url.searchParams.get("provider") ?? "unfiltered";
    const cursor = url.searchParams.get("cursor");
    cursorsByProvider.get(provider)?.push(cursor);

    if (provider === "gsc") {
      await json(
        route,
        cursor === null
          ? listEnvelope(
              [snapshotFixture(11, "gsc")],
              "gsc-snapshots-page-2",
            )
          : listEnvelope([snapshotFixture(12, "gsc")], null),
      );
      return;
    }
    if (provider === "ga4") {
      await json(
        route,
        listEnvelope([snapshotFixture(13, "ga4")], null),
      );
      return;
    }

    // This is the legacy global history window: hidden providers occupy its
    // first page and cursor. The customer page must never request or page it.
    await json(
      route,
      cursor === null
        ? listEnvelope(
            [
              snapshotFixture(14, "crawl"),
              snapshotFixture(15, "csv"),
              snapshotFixture(16, "dataforseo"),
            ],
            "hidden-snapshots-page-2",
          )
        : listEnvelope([snapshotFixture(17, "crawl")], null),
    );
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  const gsc = page.getByRole("region", { name: "Search Console" });
  const ga4 = page.getByRole("region", { name: "Google Analytics 4" });
  const footline = page.getByRole("contentinfo", {
    name: "Snapshot provenance policy",
  });
  await expect(gsc).toContainText("At least 1 immutable snapshot loaded");
  await expect(ga4).toContainText("1 immutable snapshot");
  await expect(footline).toContainText("At least 2 immutable snapshots");
  await expect(
    page.getByRole("button", { name: "Load more snapshot history" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: "Load more snapshot history" })
    .click();

  await expect(gsc).toContainText("2 immutable snapshots");
  await expect(ga4).toContainText("1 immutable snapshot");
  await expect(footline).toContainText("3 immutable snapshots");
  await expect(
    page.getByRole("button", { name: "Load more snapshot history" }),
  ).toHaveCount(0);
  expect(cursorsByProvider.get("gsc")).toEqual([
    null,
    "gsc-snapshots-page-2",
  ]);
  expect(cursorsByProvider.get("ga4")).toEqual([null]);
  expect(cursorsByProvider.get("unfiltered")).toEqual([]);
});

test("Sources refetches page one when a cached history refresh fails", async ({
  page,
}) => {
  let gscSnapshotReads = 0;
  await page.route(`**${API_BASE}/snapshots**`, async (route) => {
    const provider = new URL(route.request().url()).searchParams.get(
      "provider",
    );
    if (provider === "ga4") {
      await json(route, listEnvelope([], null));
      return;
    }
    gscSnapshotReads += 1;
    if (gscSnapshotReads === 1 || gscSnapshotReads >= 4) {
      await json(route, listEnvelope([snapshotFixture(1, "gsc")], null));
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
  const gsc = page.getByRole("region", { name: "Search Console" });
  await expect(gsc).toContainText("1 immutable snapshot");
  // Analysis Refresh is now the primary collection command. This regression
  // exercises the deliberately separate status-only refresh, which refetches
  // the cached GSC/GA4 history without starting provider collection work.
  await page.getByRole("button", { name: "Refresh status" }).click();

  await expect(
    page.getByText(
      "We couldn't load the next page. Items already loaded are still shown.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(gsc).toContainText("At least 1 immutable snapshot loaded");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => gscSnapshotReads).toBe(4);
  await expect(gsc).toContainText("1 immutable snapshot");
});
