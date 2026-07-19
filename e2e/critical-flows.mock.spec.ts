import { expect, test } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  type CriticalFlowApiState,
} from "./mock-api.ts";

let api: CriticalFlowApiState;

test.beforeEach(async ({ page }) => {
  api = await installCriticalFlowApi(page);
});

test("project navigation exposes live destinations and localizes stage chrome", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);

  await expect(
    page.getByRole("heading", { name: "E2E Critical Flow" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Preview report" })).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/report`,
  );
  await expect(page.getByRole("link", { name: "Review diagnosis" })).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/diagnosis`,
  );
  await expect(page.getByText("Planning", { exact: true })).toBeVisible();

  const urlBeforeLocaleSwitch = page.url();
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByText("规划中", { exact: true })).toBeVisible();
  await expect(page.getByText("Planning", { exact: true })).toHaveCount(0);
  expect(page.url()).toBe(urlBeforeLocaleSwitch);

  await page.getByRole("link", { name: "数据源" }).click();
  await expect(page.getByRole("heading", { name: "数据来源" })).toBeVisible();
  const dataForSeo = page.getByRole("region", { name: "DataForSEO" });
  await expect(dataForSeo).toContainText("本 MVP 暂不提供。");
  await expect(dataForSeo.getByRole("button")).toHaveCount(0);
});

test("collection trigger polls status and refreshes the captured snapshot", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  const crawl = page.getByRole("region", { name: "Site crawl" });

  await expect(crawl).toContainText(
    "Static HTML only; JavaScript-rendered content may be absent.",
  );
  await expect(crawl).not.toContainText("no snapshot has been collected yet");

  await crawl.getByRole("button", { name: "Collect now" }).click();
  await expect.poll(() => api.collectionRequests.length).toBe(1);
  expect(api.collectionRequests[0]).toMatchObject({ provider: "crawl" });
  await expect(crawl).toContainText("Progress: 1/2");
  await expect(crawl).not.toContainText("worker.collection.raw_key");

  await expect
    .poll(() => api.collectionRunPolls, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(3);
  await expect.poll(() => api.sourceReads).toBeGreaterThan(2);
});

test("diagnosis review creates an action and renders each evidence id once", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);
  await page.getByRole("button", { name: "Re-run diagnosis" }).click();
  await expect.poll(() => api.diagnosticRequests.length).toBe(1);
  expect(api.diagnosticRequests[0]).toEqual({
    snapshotIds: ["00000000-0000-4000-8000-000000000101"],
    outputLocale: "en",
  });
  await expect
    .poll(() => api.diagnosticRunPolls, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);

  const finding = page.getByRole("article", { name: "HTTP status errors" });

  await expect(finding.getByText("The URL returned HTTP 500.")).toHaveCount(1);
  await expect(finding.getByText("Duplicate projection row.")).toHaveCount(0);
  await finding.getByRole("button", { name: "Confirm" }).click();

  await expect(finding).toContainText(
    "Action created: Fix the failing product page",
  );
  await expect.poll(() => api.findingReviewRequests.length).toBe(1);
  expect(api.findingReviewRequests[0]).toEqual({
    reviewState: "confirmed",
    baseRevision: 3,
  });
});

test("artifact edit surfaces a stale-revision conflict without overwriting", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await page.getByLabel("Content").fill("Edited operator draft");
  await page.getByRole("button", { name: "Save revision" }).click();

  await expect(
    page.getByText("This artifact was updated elsewhere", { exact: false }),
  ).toBeVisible();
  await expect.poll(() => api.artifactPatchRequests.length).toBe(1);
  expect(api.artifactPatchRequests[0]).toMatchObject({
    baseRevision: 2,
    contentFormat: "markdown",
    content: "Edited operator draft",
  });
});

test("completed client export exposes and downloads the ready bundle", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/report`);
  await expect(page.getByText("GSC unavailable", { exact: true })).toHaveCount(1);

  await page.getByRole("button", { name: "Client bundle", exact: true }).click();
  const downloadLink = page.getByRole("link", { name: "Download client bundle" });
  await expect(downloadLink).toHaveAttribute("href", "/mock-download/client.zip");
  await expect.poll(() => api.exportRequests.length).toBe(1);
  expect(api.exportRequests[0]).toMatchObject({
    kind: "client_bundle",
    outputLocale: "en",
  });

  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("client.zip");
});
