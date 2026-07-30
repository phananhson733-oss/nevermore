import { expect, test } from "@playwright/test";
import {
  E2E_ARTIFACT_ID,
  E2E_CANONICAL_ACTION_ID,
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  recheckResultsFixture,
  type CriticalFlowApiState,
} from "./mock-api.ts";

let api: CriticalFlowApiState;

/** This spec asserts BOTH locales. The default UI locale is zh-CN
 *  (`packages/i18n/src/config.ts:6`), so its English assertions would otherwise
 *  be reading a Chinese page. The base locale is selected explicitly here, and
 *  the Studio localization case overrides it before navigation so neither half
 *  rides on the default. The locale switch interaction itself is covered by the
 *  project-navigation case below. */
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
  api = await installCriticalFlowApi(page);
});

test("execution-state mock accepts only the canonical Action and Artifact stream", async ({
  page,
}) => {
  await page.goto("/login");

  const responses = await page.evaluate(
    async ({ projectId, actionId, artifactId }) => {
      const base = `/api/mvp/projects/${projectId}`;
      const get = async (path: string) => {
        const response = await fetch(path);
        return {
          status: response.status,
          body: (await response.json()) as unknown,
        };
      };

      return {
        canonical: await get(
          `${base}/actions/${actionId}/execution-state?artifactId=${artifactId}`,
        ),
        missingArtifact: await get(
          `${base}/actions/${actionId}/execution-state`,
        ),
        wrongAction: await get(
          `${base}/actions/00000000-0000-4000-8000-000000000399/execution-state?artifactId=${artifactId}`,
        ),
        wrongArtifact: await get(
          `${base}/actions/${actionId}/execution-state?artifactId=00000000-0000-4000-8000-000000000499`,
        ),
      };
    },
    {
      projectId: E2E_PROJECT_ID,
      actionId: E2E_CANONICAL_ACTION_ID,
      artifactId: E2E_ARTIFACT_ID,
    },
  );

  expect(responses.canonical).toEqual({
    status: 200,
    body: {
      data: {
        actionId: E2E_CANONICAL_ACTION_ID,
        artifactId: E2E_ARTIFACT_ID,
        current: null,
        history: [],
      },
    },
  });
  for (const response of [
    responses.missingArtifact,
    responses.wrongAction,
    responses.wrongArtifact,
  ]) {
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      status: 404,
      code: "EXECUTION_STATE_STREAM_NOT_FOUND",
    });
  }
});

test("customer surfaces render GenGrowth and the default first paint remains zh-CN", async ({
  page,
}) => {
  await page.context().clearCookies();

  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveTitle("GenGrowth");
  await expect(page.getByText("GenGrowth", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "操作员登录" })).toBeVisible();
  await expect(page.getByText("登录你的 GenGrowth 工作区。")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("SignalFrame");

  await page.goto("/new-project");
  await expect(page.getByText("GenGrowth", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "添加产品" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("SignalFrame");

  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  const shellBrand = page.locator('[data-app-shell-sidebar] [aria-label="GenGrowth"]');
  await expect(shellBrand).toContainText("GenGrowth");
  await expect(page.locator("[data-app-shell-sidebar]")).not.toContainText(
    "SignalFrame",
  );
});

test("project navigation exposes live destinations and localizes stage chrome", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);

  await expect(
    page.getByRole("heading", {
      name: "Where growth should move next",
      level: 1,
    }),
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
  await expect(
    page.getByRole("region", { name: "数据源就绪度" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("站点抓取");
  await expect(page.getByRole("main")).not.toContainText("CSV 上传");
  await expect(page.getByRole("main")).not.toContainText("DataForSEO");
});

test("Sources exposes only GSC, GA4, and an honest planned GitHub customer card", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  const customerConnections = page.locator("[data-customer-connector-grid]");
  const customerCards = customerConnections.locator(
    "[data-customer-connector-card]",
  );
  await expect(customerCards).toHaveCount(3);

  const gsc = customerConnections.getByRole("region", {
    name: "Search Console",
  });
  const ga4 = customerConnections.getByRole("region", {
    name: "Google Analytics 4",
  });
  const github = customerConnections.getByRole("region", { name: "GitHub" });
  await expect(gsc.getByRole("button", { name: "Connect" })).toBeVisible();
  await expect(ga4.getByRole("button", { name: "Connect" })).toBeVisible();
  await expect(github).toContainText("Planned");
  await expect(github.getByRole("button")).toHaveCount(0);
  await expect(github.getByRole("link")).toHaveCount(0);
  await expect(customerConnections).not.toContainText("Site crawl");
  await expect(customerConnections).not.toContainText("CSV upload");
  await expect(customerConnections).not.toContainText("DataForSEO");

  await expect(
    page.getByRole("region", { name: "Source readiness" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("Site crawl");
  await expect(page.getByRole("main")).not.toContainText("CSV upload");
  await expect(page.getByRole("main")).not.toContainText("DataForSEO");

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(page.getByRole("heading", { name: "数据来源" })).toBeVisible();
  await expect(github).toContainText("待接入");
  await expect(github).not.toContainText("已连接");
});

test("each visible Google connector action starts the real authorization route", async ({
  page,
}) => {
  for (const [provider, label] of [
    ["gsc", "Search Console"],
    ["ga4", "Google Analytics 4"],
  ] as const) {
    await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
    const card = page
      .locator("[data-customer-connector-grid]")
      .getByRole("region", { name: label });
    await card.getByRole("button", { name: "Connect" }).click();
    await expect(page).toHaveURL(`/mock-google-oauth?provider=${provider}`);
  }

  expect(api.sourceConnectRequests).toEqual([
    {
      provider: "gsc",
      body: {
        phase: "authorize",
        returnPath: `/p/${E2E_PROJECT_ID}/sources`,
      },
    },
    {
      provider: "ga4",
      body: {
        phase: "authorize",
        returnPath: `/p/${E2E_PROJECT_ID}/sources`,
      },
    },
  ]);
});

test("internal crawl service remains available without distorting customer readiness", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  const readiness = page.getByRole("region", { name: "Source readiness" });
  await expect(readiness).toContainText("0 / 2");
  await expect(page.getByRole("main")).not.toContainText("Site crawl");
  await expect(
    page.getByRole("button", { name: "Collect now" }),
  ).toHaveCount(0);

  const response = await page.evaluate(async (projectId) => {
    const result = await fetch(
      `/api/mvp/projects/${projectId}/collection-runs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "critical-flow-internal-crawl",
        },
        body: JSON.stringify({ provider: "crawl" }),
      },
    );
    return { status: result.status, body: await result.json() };
  }, E2E_PROJECT_ID);

  expect(response.status).toBe(202);
  expect(response.body.data.run.kind).toBe("collection");
  await expect.poll(() => api.collectionRequests).toEqual([
    { provider: "crawl" },
  ]);
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
  // Select the locale before the request so the server-rendered first paint is
  // already Chinese. Clicking the SSR locale switch immediately after `goto`
  // can beat React hydration on a cold CI runner; that click has no handler and
  // is silently lost. This case owns Studio's localized chrome/content claim,
  // while the project-navigation case above owns the live switch interaction.
  await page.context().addCookies([
    {
      name: "sf_ui_locale",
      value: "zh-CN",
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.goto(`/p/${E2E_PROJECT_ID}/studio`);
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  const hero = page.locator("[data-studio-page-hero]");
  const queue = page.locator("[data-studio-queue]");
  const canvas = page.locator("[data-studio-editor-column]");
  await expect(hero.getByRole("button", { name: "生成执行物" })).toBeVisible();
  await expect(page.getByText("可交付", { exact: true })).toBeVisible();
  await expect(
    queue.getByText("Fix the failing product page", { exact: true }),
  ).toBeVisible();

  await hero.getByRole("button", { name: "生成执行物" }).click();
  await expect(
    canvas.getByRole("heading", { name: "选择一个行动" }),
  ).toBeVisible();
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

  await page.getByLabel("Generation mode").selectOption("structured_llm");
  await expect(generate).toBeEnabled();
  await generate.click();

  await expect.poll(() => api.artifactCreateRequests.length).toBe(1);
  expect(api.artifactCreateRequests[0]).toMatchObject({
    artifactType: "technical_ticket",
    generationMode: "structured_llm",
    outputLocale: "fr-FR",
  });
});

// Revived (R3 blueprint D8): the two cases the 2026-07 hardening round
// REMOVED when ReportClient died. The client report now lives on the
// canonical Results screen (results/_report-section.tsx), so the same
// guarantees are asserted there — including that a legacy /report deep link
// still carries its outputLocale through the redirect without flashing back
// to the default (D4).
test("report output locale deep-links on first load, survives refresh, and drives export", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/report?outputLocale=fr-FR`);
  // The compatibility redirect keeps the deep-linked locale (D4).
  await expect(page).toHaveURL(
    `/p/${E2E_PROJECT_ID}/results?outputLocale=fr-FR`,
  );
  await expect(page.getByText("GSC unavailable", { exact: true })).toHaveCount(
    1,
  );
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

  // D4: the very first report read already carries the deep-linked locale,
  // and no queryless read happened during first load — a default-language
  // report never flashed underneath the fr-FR one.
  expect(api.reportReads[0]).toBe(
    `/api/mvp/projects/${E2E_PROJECT_ID}/report?outputLocale=fr-FR`,
  );
  expect(
    api.reportReads.filter((read) => !read.includes("outputLocale=")),
  ).toEqual([]);

  await page.reload();
  await expect(page.getByLabel("Requested methodology locale")).toHaveValue(
    "fr-FR",
  );
  await expect(page).toHaveURL(
    `/p/${E2E_PROJECT_ID}/results?outputLocale=fr-FR`,
  );

  const localePicker = page.getByLabel("Requested methodology locale");
  await localePicker.fill("not_a_locale");
  await localePicker.press("Enter");
  await expect(localePicker).toHaveValue("fr-FR");
  await expect(page).toHaveURL(
    `/p/${E2E_PROJECT_ID}/results?outputLocale=fr-FR`,
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
    await page
      .getByRole("button", { name: "Client bundle", exact: true })
      .click();
    await expect(localePicker).toHaveValue("de-DE");
    await expect(page).toHaveURL(
      `/p/${E2E_PROJECT_ID}/results?outputLocale=de-DE`,
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
    `/p/${E2E_PROJECT_ID}/results?outputLocale=de-DE`,
  );
  await expect(
    page.getByRole("heading", { name: "E2E Critical Flow" }),
  ).toBeVisible();

  const downloadLink = page.getByRole("link", { name: "下载客户包" });
  await expect(downloadLink).toHaveAttribute(
    "href",
    "/mock-download/client.zip",
  );
  await expect(page.getByRole("heading", { name: "导出清单" })).toBeVisible();
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
  // Scoped to the rail: the manifest must carry the bundle's de-DE locale
  // (the report cover independently shows the same requested locale).
  await expect(
    page
      .locator("[data-report-manifest-rail]")
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
  await page.goto(`/p/${E2E_PROJECT_ID}/results?outputLocale=fr-FR`);
  const localePicker = page.getByLabel("Requested methodology locale");
  await expect(localePicker).toHaveValue("fr-FR");

  await localePicker.fill("");
  await page
    .getByRole("button", { name: "Service bundle", exact: true })
    .click();

  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/results`);
  await expect(localePicker).toHaveValue("en");
  await expect.poll(() => api.exportRequests.length).toBe(1);
  expect(api.exportRequests[0]).toMatchObject({
    kind: "service_bundle",
    outputLocale: "en",
  });
});

/**
 * D4 (adversarial P2): an initially malformed outputLocale self-heals — the
 * URL drops only the bad parameter (unrelated params survive), the locale
 * input falls back to the project default, the report is read in the default
 * language from the very first request, and the heal is a single replace, not
 * a loop.
 */
test("Results self-heals a malformed outputLocale deep link without dropping unrelated params", async ({
  page,
}) => {
  await page.goto(
    `/p/${E2E_PROJECT_ID}/results?outputLocale=not_a_locale&focus=campaign`,
  );

  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/results?focus=campaign`);
  await expect(page.locator("[data-report-document]")).toBeVisible();
  await expect(page.getByLabel("Requested methodology locale")).toHaveValue(
    "en",
  );

  // The malformed locale never reached the API: the first (and only) report
  // read is queryless, i.e. the server's default-language report.
  await expect.poll(() => api.reportReads.length).toBeGreaterThanOrEqual(1);
  expect(api.reportReads[0]).toBe(`/api/mvp/projects/${E2E_PROJECT_ID}/report`);
  expect(
    api.reportReads.filter((read) => read.includes("outputLocale")),
  ).toEqual([]);

  // A replace loop would keep re-reading the report and churning the URL.
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(`/p/${E2E_PROJECT_ID}/results?focus=campaign`);
  expect(api.reportReads).toHaveLength(1);
});

/**
 * D4 (adversarial P2): repeated outputLocale params take the FIRST value —
 * asserted at the browser level so the whole page.tsx -> client controller ->
 * query chain is covered, not just the unit-tested helper.
 */
test("Results uses the first repeated outputLocale query for the first report read", async ({
  page,
}) => {
  await page.goto(
    `/p/${E2E_PROJECT_ID}/results?outputLocale=zh-CN&outputLocale=en`,
  );

  await expect(page.getByLabel("Requested methodology locale")).toHaveValue(
    "zh-CN",
  );
  await expect.poll(() => api.reportReads.length).toBeGreaterThanOrEqual(1);
  expect(api.reportReads[0]).toBe(
    `/api/mvp/projects/${E2E_PROJECT_ID}/report?outputLocale=zh-CN`,
  );
  // Both params are valid, so nothing is healed away.
  await expect(page).toHaveURL(
    `/p/${E2E_PROJECT_ID}/results?outputLocale=zh-CN&outputLocale=en`,
  );
});

/**
 * R3 blueprint D3: the Results heading tree is fixed and asserted by
 * role/name, not by counting h1 elements. The screen owns the only h1; the
 * technical recheck record and the report document projectName are h2
 * siblings; the numbered report sections are h3 under the document; action
 * cards are h4.
 */
test("Results owns one h1 and the report document nests under it (D3)", async ({
  page,
}) => {
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/results`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: recheckResultsFixture() }),
      });
    },
  );
  await page.goto(`/p/${E2E_PROJECT_ID}/results`);

  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Results", level: 1 }),
  ).toBeVisible();
  await expect(page.locator("[data-report-page]")).toHaveCount(1);
  const document = page.locator("[data-report-document]");
  // The uniqueness counts below are only meaningful once every block that
  // could contribute a heading has mounted — count too early and a second
  // h1 inside the still-loading report block would slip through.
  await expect(document).toBeVisible();
  // h1 uniqueness is asserted on the accessibility tree (role=heading,
  // aria-level 1), so an ARIA-only second heading fails too; the native
  // element count stays as a cheap additional tripwire.
  const levelOneHeadings = main.getByRole("heading", { level: 1 });
  await expect(levelOneHeadings).toHaveCount(1);
  await expect(levelOneHeadings).toHaveText("Results");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(
    main.getByRole("heading", {
      name: "Technical recheck record",
      level: 2,
    }),
  ).toBeVisible();
  await expect(
    document.getByRole("heading", { name: "E2E Critical Flow", level: 2 }),
  ).toBeVisible();
  await expect(
    document.getByRole("heading", { name: "Findings", level: 3 }),
  ).toBeVisible();
  // Finding cards title with an h4, exactly like action cards (D3).
  await expect(
    document.getByRole("heading", {
      name: "A product page returned a server error.",
      level: 4,
    }),
  ).toBeVisible();
  await expect(
    document.getByRole("heading", {
      name: "Fix the failing product page",
      level: 4,
    }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "Export", level: 2 }),
  ).toBeVisible();
});

/**
 * R3 blueprint D6: print keeps only the client report document. The screen
 * header, the recheck comparison, the export rail, and every interactive
 * control are screen chrome; the shell sidebar/topbar are hidden globally.
 * The page is loaded and settled in screen media first, so each hidden
 * assertion below observes a real element being removed by print CSS rather
 * than one that never rendered.
 */
test("print media keeps the report document and hides the Results screen chrome (D6)", async ({
  page,
}) => {
  await page.route(
    `**/api/mvp/projects/${E2E_PROJECT_ID}/results`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: recheckResultsFixture() }),
      });
    },
  );
  await page.goto(`/p/${E2E_PROJECT_ID}/results`);

  const screenHeading = page.getByRole("heading", {
    name: "Results",
    level: 1,
  });
  const recheckHeading = page.getByText("Technical recheck record", {
    exact: true,
  });
  const observedLabel = page.getByText("Prior run observed", { exact: true });
  const rail = page.locator("[data-report-manifest-rail]");
  await expect(screenHeading).toBeVisible();
  await expect(recheckHeading).toBeVisible();
  await expect(observedLabel).toBeVisible();
  await expect(rail).toBeVisible();

  await page.emulateMedia({ media: "print" });

  await expect(page.locator("[data-app-shell-sidebar]")).toBeHidden();
  await expect(page.locator("[data-app-shell-topbar]")).toBeHidden();
  await expect(page.locator("h1")).toBeHidden();
  await expect(recheckHeading).toBeHidden();
  await expect(observedLabel).toBeHidden();
  await expect(rail).toBeHidden();
  await expect(page.locator("button:visible")).toHaveCount(0);
  await expect(page.locator("input:visible")).toHaveCount(0);

  const document = page.locator("[data-report-document]");
  await expect(document).toBeVisible();
  await expect(
    document.getByRole("heading", { name: "E2E Critical Flow" }),
  ).toBeVisible();
  await expect(
    document.getByRole("heading", { name: "Findings" }),
  ).toBeVisible();
  await expect(
    document.getByRole("heading", { name: "30 / 60 / 90 plan" }),
  ).toBeVisible();
  await expect(
    document.getByRole("heading", { name: "Methodology" }),
  ).toBeVisible();
});
