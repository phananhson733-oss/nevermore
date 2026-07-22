import { expect, test, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  E2E_SECONDARY_SITE_ID,
  E2E_SITE_ID,
  E2E_SNAPSHOT_PROVENANCE,
  installCriticalFlowApi,
  type MockDataSnapshot,
  type CriticalFlowApiState,
} from "./mock-api.ts";

const SNAPSHOTS_ROUTE =
  `**/api/mvp/projects/${E2E_PROJECT_ID}/snapshots**`;

const crawlSnapshot = {
  id: "00000000-0000-4000-8000-000000000101",
  siteId: E2E_SITE_ID,
  provider: "crawl",
  datasetKey: E2E_SNAPSHOT_PROVENANCE.crawl.datasetKey,
  schemaVersion: "0.2.0",
  methodVersion: E2E_SNAPSHOT_PROVENANCE.crawl.methodVersion,
  capturedAt: "2026-07-18T12:00:00.000Z",
  sourceWindow: { start: null, end: null },
  availability: "available",
  limitation: "Static HTML only.",
  rowCount: 12,
  checksum: "c".repeat(64),
} satisfies MockDataSnapshot;

async function serveSnapshots(
  route: Route,
  snapshots: readonly MockDataSnapshot[] = [crawlSnapshot],
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: snapshots,
      meta: { nextCursor: null, hasNext: false, limit: 100 },
    }),
  });
}

let api: CriticalFlowApiState;

test.beforeEach(async ({ page }) => {
  api = await installCriticalFlowApi(page);
});

test("Diagnosis renders its read model while the complete snapshot chain is still loading", async ({
  page,
}) => {
  let releaseSnapshots: (() => void) | undefined;
  const snapshotsReleased = new Promise<void>((resolve) => {
    releaseSnapshots = resolve;
  });

  await page.route(SNAPSHOTS_ROUTE, async (route) => {
    await snapshotsReleased;
    await serveSnapshots(route);
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);

  await expect(
    page.getByRole("heading", {
      name: "Every finding should stand up to scrutiny.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "HTTP status errors" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Re-run diagnosis" }),
  ).toBeDisabled();
  await expect(page.getByText("Sources: Loading…", { exact: true })).toBeVisible();
  expect(api.diagnosticRequests).toHaveLength(0);

  releaseSnapshots?.();

  await expect(
    page.getByRole("button", { name: "Re-run diagnosis" }),
  ).toBeEnabled();
  await expect(page.getByText("Sources: Loading…", { exact: true })).toHaveCount(0);
});

test("a snapshot-chain error leaves findings visible and keeps diagnosis fenced until retry", async ({
  page,
}) => {
  let attempts = 0;
  let allowSuccess = false;
  await page.route(SNAPSHOTS_ROUTE, async (route) => {
    attempts += 1;
    if (!allowSuccess) {
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Temporarily unavailable.",
          },
        }),
      });
      return;
    }
    await serveSnapshots(route);
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);

  await expect(
    page.getByRole("article", { name: "HTTP status errors" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Re-run diagnosis" }),
  ).toBeDisabled();
  await expect(page.getByText("Sources: Something went wrong", { exact: true })).toBeVisible();
  await expect(page.getByText("Something went wrong", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/A completed site crawl is required/),
  ).toHaveCount(0);
  expect(api.diagnosticRequests).toHaveLength(0);

  allowSuccess = true;
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(
    page.getByRole("button", { name: "Re-run diagnosis" }),
  ).toBeEnabled();
  await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
  expect(attempts).toBeGreaterThanOrEqual(2);
});

test("legacy crawl and a wrong-site optional snapshot never enable diagnosis", async ({
  page,
}) => {
  const legacyCrawl = {
    ...crawlSnapshot,
    id: "00000000-0000-4000-8000-000000000102",
    methodVersion: "crawl.site_graph.v1",
  } satisfies MockDataSnapshot;
  const wrongSiteGa4 = {
    ...crawlSnapshot,
    id: "00000000-0000-4000-8000-000000000103",
    siteId: E2E_SECONDARY_SITE_ID,
    provider: "ga4",
    datasetKey: E2E_SNAPSHOT_PROVENANCE.ga4.datasetKey,
    methodVersion: E2E_SNAPSHOT_PROVENANCE.ga4.methodVersion,
    limitation: "GA4 snapshot belongs to another Site.",
    checksum: "a".repeat(64),
  } satisfies MockDataSnapshot;

  await page.route(SNAPSHOTS_ROUTE, (route) =>
    serveSnapshots(route, [legacyCrawl, wrongSiteGa4]),
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);

  await expect(
    page.getByRole("button", { name: "Re-run diagnosis" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/A completed site crawl is required before diagnosis/),
  ).toBeVisible();
  expect(api.diagnosticRequests).toHaveLength(0);
});
