import { expect, test, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  type CriticalFlowApiState,
} from "./mock-api.ts";

const SNAPSHOTS_ROUTE =
  `**/api/mvp/projects/${E2E_PROJECT_ID}/snapshots**`;

const crawlSnapshot = {
  id: "00000000-0000-4000-8000-000000000101",
  provider: "crawl",
  datasetKey: "crawl_pages",
  schemaVersion: "1.0.0",
  methodVersion: "crawl-v1",
  capturedAt: "2026-07-18T12:00:00.000Z",
  sourceWindow: { start: null, end: null },
  availability: "available",
  limitation: "Static HTML only.",
  rowCount: 12,
  checksum: "sha256:e2e-crawl",
};

async function serveSnapshots(route: Route): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      data: [crawlSnapshot],
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
    page.getByRole("heading", { name: "Diagnosis", exact: true }),
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
