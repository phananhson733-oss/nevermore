import { expect, test } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  type CriticalFlowApiState,
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

test("project navigation exposes live destinations and localizes stage chrome", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);

  await expect(
    page.getByRole("heading", { name: "Where growth should move next", level: 1 }),
  ).toBeVisible();

  // Re-aimed, not loosened. This used to read two Overview call-to-action
  // links, "Preview report" and "Review diagnosis". The customer Overview
  // rewrite dropped both — `overview.previewReport` and
  // `overview.reviewDiagnosis` survive in the message catalogue but are
  // referenced by no component — and the shell's section nav became the
  // canonical list of live destinations (_nav-model.ts:25). Reading all four
  // of them, and that there are exactly four, proves strictly more than the
  // two links did: a retired destination reappearing in the nav fails here.
  const sections = page.getByRole("navigation", { name: "Project sections" });
  const destinations = [
    ["Overview", "overview"],
    ["Growth Map", "growth-map"],
    ["Execution", "execution"],
    ["Results", "results"],
  ] as const;
  for (const [label, segment] of destinations) {
    await expect(
      sections.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("href", `/p/${E2E_PROJECT_ID}/${segment}`);
  }
  await expect(sections.getByRole("link")).toHaveCount(destinations.length);

  // The stage chrome moved from the page body to the topbar pill in the same
  // rewrite. Same string, same localization guarantee, current element.
  const topbar = page.locator("[data-app-shell-topbar]");
  await expect(topbar.getByText("Planning", { exact: true })).toBeVisible();

  const urlBeforeLocaleSwitch = page.url();
  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(topbar.getByText("规划中", { exact: true })).toBeVisible();
  await expect(topbar.getByText("Planning", { exact: true })).toHaveCount(0);
  expect(page.url()).toBe(urlBeforeLocaleSwitch);

  // Sources left the primary nav; it is now reached from the Overview itself.
  await page.getByRole("link", { name: "管理数据连接" }).click();
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

// REMOVED: "diagnosis review creates an action and renders each evidence id
// once". Its first half clicked "Re-run diagnosis", the only UI that ever
// posted a diagnostic run — useCreateDiagnosticRun is referenced solely by
// diagnosis/_diagnosis.tsx:730, and that file is mounted by nothing since
// /diagnosis became a redirect (diagnosis/page.tsx:19). Its second half moved
// with the surface: growth-map.mock.spec.ts:181 confirms the canonical Finding
// on the successor screen and asserts the same api.findingReviewRequests
// body.

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

// REMOVED: "report output locale deep-links on first load, survives refresh,
// and drives export" and "clearing report locale restores the project default
// for the same-click export".
//
// /report is now a redirect to /results (report/page.tsx:16) and ReportClient
// (report/_report.tsx:1244) is imported by nothing. ReportClient owned the
// whole delivery document these tests drove: the outputLocale picker, the
// export rail, the manifest and the download link — hooks-report.ts is now
// imported only by that dead file. The Results screen that replaced the route
// (results/_results.tsx) is a read-only recheck comparison with no locale,
// export or manifest affordance, so there is no successor to re-aim at.
