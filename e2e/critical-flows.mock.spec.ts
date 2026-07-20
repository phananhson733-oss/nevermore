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
    page.getByRole("heading", {
      name: "Turn evidence into the next 90 days of action.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Preview report" })).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/report`,
  );
  await expect(
    page.getByRole("link", { name: "Review diagnosis" }).first(),
  ).toHaveAttribute("href", `/p/${E2E_PROJECT_ID}/diagnosis`);
  const mainContent = page.locator("#main-content");
  await expect(
    mainContent.getByText("Planning", { exact: true }),
  ).toBeVisible();

  const urlBeforeLocaleSwitch = page.url();
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    mainContent.getByText("规划中", { exact: true }),
  ).toBeVisible();
  await expect(
    mainContent.getByText("Planning", { exact: true }),
  ).toHaveCount(0);
  expect(page.url()).toBe(urlBeforeLocaleSwitch);

  await page.getByRole("link", { name: "数据源", exact: true }).click();
  await expect(page.getByRole("heading", { name: "数据来源" })).toBeVisible();
  const dataForSeo = page.getByRole("region", { name: "DataForSEO" });
  await expect(dataForSeo).toContainText("本 MVP 暂不提供。");
  await expect(dataForSeo.getByRole("button")).toHaveCount(0);
});

test("Sources chrome localizes to zh-CN while server-supplied provider content remains intact", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(page.getByRole("heading", { name: "数据来源" })).toBeVisible();
  await expect(page.getByText("最近采集", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("可用性", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Static HTML only; JavaScript-rendered content may be absent.", {
      exact: true,
    }),
  ).toBeVisible();
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

test("Studio chrome localizes to zh-CN without translating action content", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  await page.getByRole("button", { name: "简体中文" }).click();

  const hero = page.locator("[data-studio-page-hero]");
  const queue = page.locator("[data-studio-queue]");
  const canvas = page.locator("[data-studio-editor-column]");
  await expect(hero.getByRole("button", { name: "生成执行物" })).toBeVisible();
  await expect(page.getByText("可交付", { exact: true })).toBeVisible();
  await expect(
    queue.getByText("Fix the failing product page", { exact: true }),
  ).toBeVisible();

  await hero.getByRole("button", { name: "生成执行物" }).click();
  await expect(canvas.getByRole("heading", { name: "选择一个行动" })).toBeVisible();
  await canvas
    .getByRole("listitem")
    .filter({ hasText: "Fix the failing product page" })
    .getByRole("button", { name: /生成|重新生成/ })
    .click();
  await expect(page.getByLabel("输出语言")).toHaveValue("en");
  await expect(
    canvas.getByRole("heading", { name: "Fix the failing product page" }),
  ).toBeVisible();
});

test("Studio requires structured LLM for template-unsupported output locales", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  const hero = page.locator("[data-studio-page-hero]");
  const canvas = page.locator("[data-studio-editor-column]");
  await hero.getByRole("button", { name: "Generate artifact" }).click();
  await canvas
    .getByRole("listitem")
    .filter({ hasText: "Fix the failing product page" })
    .getByRole("button", { name: /Generate|Regenerate/ })
    .click();

  const locale = page.getByLabel("Output language");
  const generate = page.getByRole("button", { name: "Generate", exact: true });
  await expect(generate).toBeEnabled();
  await locale.fill("zh-CN");
  await expect(generate).toBeEnabled();
  await locale.fill("fr-FR");

  await expect(
    page.getByText(
      "Template generation supports only en and zh-CN. Select Structured LLM for other languages.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(generate).toBeDisabled();
  expect(api.artifactCreateRequests).toHaveLength(0);

  await page
    .getByLabel("Generation mode")
    .selectOption("structured_llm");
  await expect(generate).toBeEnabled();
  await generate.click();

  await expect.poll(() => api.artifactCreateRequests.length).toBe(1);
  expect(api.artifactCreateRequests[0]).toMatchObject({
    artifactType: "technical_ticket",
    generationMode: "structured_llm",
    outputLocale: "fr-FR",
  });
});

test("report output locale deep-links on first load, survives refresh, and drives export", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/report?outputLocale=fr-FR`);
  await expect(page.getByText("GSC unavailable", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("Requested methodology locale")).toHaveValue(
    "fr-FR",
  );
  await expect(
    page.getByText("Summary language: en", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Action language: en", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Deliverable language: en", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    `/p/${E2E_PROJECT_ID}/report?outputLocale=fr-FR`,
  );

  await page.reload();
  await expect(page.getByLabel("Requested methodology locale")).toHaveValue(
    "fr-FR",
  );
  await expect(page).toHaveURL(
    `/p/${E2E_PROJECT_ID}/report?outputLocale=fr-FR`,
  );

  const localePicker = page.getByLabel("Requested methodology locale");
  await localePicker.fill("not_a_locale");
  await localePicker.press("Enter");
  await expect(localePicker).toHaveValue("fr-FR");
  await expect(page).toHaveURL(
    `/p/${E2E_PROJECT_ID}/report?outputLocale=fr-FR`,
  );

  let releaseReport = () => {};
  const reportGate = new Promise<void>((resolve) => {
    releaseReport = resolve;
  });
  await page.route(
    new RegExp(
      `/api/mvp/projects/${E2E_PROJECT_ID}/report\\?outputLocale=de-DE$`,
    ),
    async (route) => {
      await reportGate;
      await route.fallback();
    },
  );

  try {
    await localePicker.fill("de-DE");
    // Clicking Export is the commit gesture: blur fires first, but the export
    // must use this valid draft immediately instead of racing router.replace.
    await page.getByRole("button", { name: "Client bundle", exact: true }).click();
    await expect(localePicker).toHaveValue("de-DE");
    await expect(page).toHaveURL(
      `/p/${E2E_PROJECT_ID}/report?outputLocale=de-DE`,
    );

    // The previous fr-FR report remains visible while the de-DE read is gated.
    // Export must follow the newly committed deep-link locale, not stale data.
    await expect.poll(() => api.exportRequests.length).toBe(1);
    expect(api.exportRequests[0]).toMatchObject({
      kind: "client_bundle",
      outputLocale: "de-DE",
    });
  } finally {
    releaseReport();
  }

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByText(/报告日期/)).toBeVisible();
  await expect(page.getByLabel("请求的方法论语言")).toHaveValue("de-DE");
  await expect(page.getByText("摘要语言：en", { exact: true })).toBeVisible();
  await expect(page.getByText("行动语言：en", { exact: true })).toBeVisible();
  await expect(page.getByText("交付物语言：en", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(
    `/p/${E2E_PROJECT_ID}/report?outputLocale=de-DE`,
  );
  await expect(page.getByRole("heading", { name: "E2E Critical Flow" })).toBeVisible();

  const downloadLink = page.getByRole("link", { name: "下载客户包" });
  await expect(downloadLink).toHaveAttribute("href", "/mock-download/client.zip");
  await expect(
    page.getByRole("heading", { name: "导出清单" }),
  ).toBeVisible();
  await expect(page.getByText("1.0.0", { exact: true })).toBeVisible();
  await expect(
    page.getByText("sha256:e2e-export", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("可安全交付客户的报告数据与已就绪交付物", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("内部观测、批注与未定稿内容", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "导出清单" })
      .getByText("de-DE", { exact: true }),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("client.zip");
});

test("clearing report locale restores the project default for the same-click export", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/report?outputLocale=fr-FR`);
  const localePicker = page.getByLabel("Requested methodology locale");
  await expect(localePicker).toHaveValue("fr-FR");

  await localePicker.fill("");
  await page
    .getByRole("button", { name: "Service bundle", exact: true })
    .click();

  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/report`);
  await expect(localePicker).toHaveValue("en");
  await expect.poll(() => api.exportRequests.length).toBe(1);
  expect(api.exportRequests[0]).toMatchObject({
    kind: "service_bundle",
    outputLocale: "en",
  });
});
