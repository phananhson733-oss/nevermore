import { access, lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ARTIFACT_PATH = "/GenGrowth-Interactive-Artifact.html";
const ARTIFACT_FILE = path.join(
  REPOSITORY_ROOT,
  "docs",
  "artifacts",
  "GenGrowth-Interactive-Artifact.html",
);
const ARTIFACT_SOURCE_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "docs",
  "artifact-src",
);
const ARTIFACT_SOURCE_FILES = [
  "README.md",
  "styles.css",
  "workspace-data.js",
  "client-app.js",
] as const;
const PRIMARY_ROUTES = [
  { route: "overview", label: "概览", title: /今天先做|概览/ },
  { route: "growth-map", label: "增长地图", title: /增长机会|增长地图/ },
  { route: "execution", label: "执行中心", title: /交付物|执行中心/ },
  { route: "results", label: "效果追踪", title: /改前|效果追踪|结果/ },
] as const;

async function gotoArtifact(
  page: Page,
  route: (typeof PRIMARY_ROUTES)[number]["route"] = "overview",
): Promise<void> {
  await page.goto(`${ARTIFACT_PATH}#/${route}`);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator("#route-content")).toBeVisible();
  await expect(page.locator("#route-content h1").first()).toBeVisible();
}

async function closeDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("the executable Artifact source is complete and physically owned by the repository", async () => {
  const missing: string[] = [];
  for (const fileName of ARTIFACT_SOURCE_FILES) {
    const file = path.join(ARTIFACT_SOURCE_DIRECTORY, fileName);
    try {
      await access(file);
    } catch {
      missing.push(path.relative(REPOSITORY_ROOT, file));
    }
  }

  expect(
    missing,
    "The standalone Artifact must build from the four canonical docs/artifact-src files in this checkout",
  ).toEqual([]);

  const repositoryRealPath = await realpath(REPOSITORY_ROOT);
  const sourceRealPath = await realpath(ARTIFACT_SOURCE_DIRECTORY);
  expect(
    sourceRealPath.startsWith(`${repositoryRealPath}${path.sep}`),
    "docs/artifact-src must not be a symlink to a workstation visualization directory",
  ).toBe(true);

  for (const fileName of ARTIFACT_SOURCE_FILES) {
    const file = path.join(ARTIFACT_SOURCE_DIRECTORY, fileName);
    expect((await lstat(file)).isFile(), `${fileName} must be a regular file`).toBe(
      true,
    );
    expect(
      (await realpath(file)).startsWith(`${repositoryRealPath}${path.sep}`),
      `${fileName} must resolve inside the repository`,
    ).toBe(true);
  }

  const [readme, styles, workspaceData, clientApp] = await Promise.all(
    ARTIFACT_SOURCE_FILES.map((fileName) =>
      readFile(path.join(ARTIFACT_SOURCE_DIRECTORY, fileName), "utf8"),
    ),
  );
  expect(readme).toMatch(/来源|历史|provenance|reference[- ]only/i);
  expect(styles.trim().length).toBeGreaterThan(1_000);
  expect(workspaceData).toMatch(/\bGenGrowthWorkspace\b/);
  expect(clientApp).toContain("function startClientWorkspace");

  const executableSource = [styles, workspaceData, clientApp].join("\n");
  expect(executableSource).not.toMatch(
    /(?:\/Users\/|\/home\/[^/]+\/|\.codex\/visualizations|\/tmp\/gengrowth-artifact-jsdom-|signalframe-mvp-app)/i,
  );
});

test("the generated file is GenGrowth-only, offline, and free of workstation leakage", async ({
  page,
  baseURL,
}) => {
  const externalRequests = new Set<string>();
  const expectedOrigin = new URL(baseURL ?? "http://127.0.0.1:4174").origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== expectedOrigin) {
      externalRequests.add(request.url());
    }
  });

  await gotoArtifact(page);
  const [html, visibleText, rawHtml] = await Promise.all([
    readFile(ARTIFACT_FILE, "utf8"),
    page.locator("body").innerText(),
    page.content(),
  ]);

  expect(await page.locator("html").getAttribute("lang")).toBe("zh-CN");
  await expect(page.getByText("GenGrowth", { exact: false }).first()).toBeVisible();
  expect(visibleText).not.toMatch(
    /\b(?:Nevermore|SignalFrame|signalframe-mvp-app|@sf\/)\b/i,
  );
  expect(html).not.toMatch(
    /(?:\/Users\/|\/home\/[^/]+\/|\.codex\/visualizations|\/tmp\/gengrowth-artifact-jsdom-|signalframe-mvp-app)/i,
  );
  expect(rawHtml).not.toMatch(
    /(?:<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel=["']stylesheet["']|@import\s+|url\(\s*["']?https?:|(?:fetch|WebSocket)\s*\(|new\s+Worker\s*\()/i,
  );

  const remoteDomAssets = await page
    .locator(
      "script[src], link[rel='stylesheet'][href], img[src], source[src], iframe[src], object[data]",
    )
    .evaluateAll((elements) =>
      elements
        .map(
          (element) =>
            element.getAttribute("src") ??
            element.getAttribute("href") ??
            element.getAttribute("data") ??
            "",
        )
        .filter((value) => /^https?:\/\//i.test(value)),
    );
  expect(remoteDomAssets).toEqual([]);
  expect([...externalRequests]).toEqual([]);

  for (const { route } of PRIMARY_ROUTES) {
    await gotoArtifact(page, route);
    const heroText = await page
      .locator("#route-content > .client-page-header")
      .innerText();
    expect(heroText).not.toMatch(
      /\b(?:slide|phase|queue|rule instruction|architecture)\b|阶段队列|规则指令|架构叙事/i,
    );
  }
});

test("all four Chinese-first primary hash routes render and primary history works", async ({
  page,
}) => {
  await gotoArtifact(page);
  const primaryNav = page.locator(
    '.primary-nav [data-action="nav"][data-route]',
  );
  await expect(primaryNav).toHaveCount(4);
  expect(
    await primaryNav.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-route")),
    ),
  ).toEqual(PRIMARY_ROUTES.map(({ route }) => route));
  for (const [index, { label }] of PRIMARY_ROUTES.entries()) {
    await expect(primaryNav.nth(index)).toContainText(label);
  }

  for (const { route, title } of PRIMARY_ROUTES) {
    await page
      .locator(`.primary-nav [data-action="nav"][data-route="${route}"]`)
      .click();
    await expect(page).toHaveURL(new RegExp(`#/${route}(?:\\?|$)`));
    await expect(page.locator("#route-content h1").first()).toHaveText(title);
  }

  await page
    .locator('.primary-nav [data-action="nav"][data-route="growth-map"]')
    .click();
  await page
    .locator('.primary-nav [data-action="nav"][data-route="execution"]')
    .click();
  await page.goBack();
  await expect(page).toHaveURL(/#\/growth-map(?:\?|$)/);
  await expect(
    page.locator(
      '.primary-nav [data-action="nav"][data-route="growth-map"]',
    ),
  ).toHaveAttribute("class", /is-active/);
  await page.goForward();
  await expect(page).toHaveURL(/#\/execution(?:\?|$)/);
});

test("product profile and the exact three customer-managed connections are real secondary flows", async ({
  page,
}) => {
  await gotoArtifact(page);

  await page
    .getByRole("button", { name: /产品画像/ })
    .first()
    .click();
  const profileDialog = page.getByRole("dialog");
  await expect(profileDialog).toBeVisible();
  await expect(profileDialog).toContainText(/产品与客户画像|产品画像/);
  await expect(profileDialog).toContainText(/ICP/);
  await expect(profileDialog).toContainText(/JTBD|待完成任务/);
  await expect(
    profileDialog.locator('[data-action="open-profile-evidence"]'),
  ).toBeVisible();
  await profileDialog
    .locator('[data-action="open-profile-evidence"]')
    .click();
  await expect(page.getByRole("dialog")).toContainText(/字段证据|来源|证据/);
  await closeDialog(page);

  await page.locator('[data-action="open-connections"]').first().click();
  const connectionDialog = page.getByRole("dialog");
  await expect(connectionDialog).toContainText(/数据连接|连接/);
  const connectionRows = connectionDialog.locator(
    '[data-action="open-source"]',
  );
  await expect(connectionRows).toHaveCount(3);
  const connectionText = (await connectionRows.allTextContents()).join("\n");
  expect(connectionText).toMatch(/Google Search Console/);
  expect(connectionText).toMatch(/Google Analytics 4/);
  expect(connectionText).toMatch(/GitHub/);
  expect(connectionText).not.toMatch(
    /\b(?:Crawl|Sitemap|CSV|DataForSEO|SERP|Suggest|PAA)\b|竞品语料|AI 引用观察/i,
  );

  const firstConnection = connectionRows.first();
  const firstConnectionName = (
    await firstConnection.locator("strong").first().innerText()
  ).trim();
  await firstConnection.click();
  await expect(page.getByRole("dialog")).toContainText(
    new RegExp(firstConnectionName ?? "Google"),
  );
  await closeDialog(page);
});

test("Growth Map exposes at least eight selectable URLs, distinct details, and working pagination", async ({
  page,
}) => {
  await gotoArtifact(page, "growth-map");
  const pageTab = page.locator(
    '[data-action="map-tab"][data-tab="pages"]',
  );
  await expect(pageTab).toHaveAttribute("aria-selected", "true");

  const rowButtons = page.locator(
    'button.v14-page-row-button[data-action="select-map-page"]',
  );
  await expect(rowButtons.first()).toBeVisible();
  const firstPageIds = await rowButtons.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-id") ?? ""),
  );
  expect(firstPageIds.length).toBeGreaterThanOrEqual(2);

  const firstPath = (await rowButtons.nth(0).locator("strong").innerText()).trim();
  const secondPath = (await rowButtons.nth(1).locator("strong").innerText()).trim();
  expect(secondPath).not.toBe(firstPath);

  await rowButtons.nth(0).click();
  const firstDetail = page.locator(
    `.v13-detail-panel[data-selected-page-id="${firstPageIds[0]}"]`,
  );
  await expect(firstDetail).toContainText(firstPath);
  const firstDetailText = await firstDetail.innerText();

  await page
    .locator(
      `button.v14-page-row-button[data-action="select-map-page"][data-id="${firstPageIds[1]}"]`,
    )
    .click();
  const secondDetail = page.locator(
    `.v13-detail-panel[data-selected-page-id="${firstPageIds[1]}"]`,
  );
  await expect(secondDetail).toContainText(secondPath);
  expect(await secondDetail.innerText()).not.toBe(firstDetailText);

  const next = page.locator(
    '[data-action="page-change"][data-kind="pages"][data-delta="1"]',
  );
  await expect(next).toBeEnabled();
  await next.click();
  const secondPageIds = await rowButtons.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-id") ?? ""),
  );
  expect(new Set([...firstPageIds, ...secondPageIds]).size).toBeGreaterThanOrEqual(
    8,
  );
  expect(secondPageIds).not.toEqual(firstPageIds);

  const previous = page.locator(
    '[data-action="page-change"][data-kind="pages"][data-delta="-1"]',
  );
  await expect(previous).toBeEnabled();
  await previous.click();
  expect(
    await rowButtons.evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-id") ?? ""),
    ),
  ).toEqual(firstPageIds);
});

test("Keyword and Competitor libraries expose operable tabs, rows, and provenance", async ({
  page,
}) => {
  await gotoArtifact(page, "growth-map");
  const mapTabs = page.locator(".v14-map-tabs [role='tab']");
  await expect(mapTabs).toHaveCount(3);

  await mapTabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.locator('[data-action="map-tab"][data-tab="keywords"]'),
  ).toHaveAttribute("aria-selected", "true");

  const keywordPanel = page.locator("#panel-map-keywords");
  await expect(keywordPanel).toContainText(/入库路径/);
  await expect(keywordPanel).toContainText(/数据新鲜度/);
  const keywordRows = keywordPanel.locator(
    '[data-action="select-map-keyword"]',
  );
  await expect(keywordRows.first()).toBeVisible();
  const keywordName = (
    await keywordRows.first().locator("strong").innerText()
  ).trim();
  await keywordRows.first().click();
  const keywordDetail = keywordPanel.locator(".v13-detail-panel");
  await expect(keywordDetail).toContainText(keywordName);
  await expect(keywordDetail).toContainText(/入库路径/);
  await expect(keywordDetail).toContainText(/已关联|系统内置信号|来源/);

  await page
    .locator('[data-action="map-tab"][data-tab="competitors"]')
    .click();
  const competitorPanel = page.locator("#panel-map-competitors");
  await expect(competitorPanel).toContainText(/发现路径/);
  const competitorRows = competitorPanel.locator(
    '[data-action="select-map-competitor"]',
  );
  await expect(competitorRows.first()).toBeVisible();
  const competitorName = (
    await competitorRows.first().locator("strong").innerText()
  ).trim();
  await competitorRows.first().click();
  const competitorDetail = competitorPanel.locator(".v13-detail-panel");
  await expect(competitorDetail).toContainText(competitorName);
  await expect(competitorDetail).toContainText(/证据/);
  await expect(competitorDetail).toContainText(
    /为什么进入竞品池|发现路径|系统证据/,
  );
  expect(await competitorPanel.innerText()).not.toMatch(/\bnull%|\bundefined\b/);
});

test("secondary selections, pagination, Results windows, and dialogs survive URL history", async ({
  page,
}) => {
  await gotoArtifact(page, "growth-map");
  const pagesUrl = page.url();

  await page
    .locator('[data-action="map-tab"][data-tab="keywords"]')
    .click();
  const keywordsUrl = page.url();
  expect(
    keywordsUrl,
    "Growth Map object mode must be represented in URL state",
  ).not.toBe(pagesUrl);

  await page
    .locator('[data-action="map-tab"][data-tab="competitors"]')
    .click();
  const competitorsUrl = page.url();
  expect(competitorsUrl).not.toBe(keywordsUrl);
  await page.goBack();
  await expect(
    page.locator('[data-action="map-tab"][data-tab="keywords"]'),
  ).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(
    page.locator('[data-action="map-tab"][data-tab="competitors"]'),
  ).toHaveAttribute("aria-selected", "true");

  await page
    .locator('[data-action="map-tab"][data-tab="pages"]')
    .click();
  await page
    .locator(
      '[data-action="page-change"][data-kind="pages"][data-delta="1"]',
    )
    .click();
  const paginatedUrl = page.url();
  await page.reload();
  await expect(
    page.locator(
      '[data-action="page-change"][data-kind="pages"][data-delta="-1"]',
    ),
  ).toBeEnabled();
  expect(page.url()).toBe(paginatedUrl);

  await gotoArtifact(page, "results");
  await page
    .locator('[data-action="result-tab"][data-tab="campaigns"]')
    .click();
  const campaignWindowUrl = page.url();
  await page.reload();
  await expect(
    page.locator('[data-action="result-tab"][data-tab="campaigns"]'),
  ).toHaveAttribute("aria-selected", "true");
  expect(page.url()).toBe(campaignWindowUrl);

  await gotoArtifact(page);
  const beforeDialogUrl = page.url();
  await page
    .getByRole("button", { name: /产品画像/ })
    .first()
    .click();
  const profileUrl = page.url();
  expect(profileUrl, "dialog state must be represented in URL history").not.toBe(
    beforeDialogUrl,
  );
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Execution renders every required deliverable as readable customer content", async ({
  page,
}) => {
  await gotoArtifact(page, "execution");
  const filters = page.locator(
    '.v13-execution-toolbar [role="tab"][data-action="artifact-filter"]',
  );
  await expect(filters).toHaveCount(7);

  const items = page.locator(
    '.client-work-item[data-action="select-artifact"]',
  );
  expect(await items.count()).toBeGreaterThanOrEqual(9);
  const itemIds = await items.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-id") ?? ""),
  );
  const readableFailures: string[] = [];
  const renderedDocuments: string[] = [];

  for (const id of itemIds) {
    await page
      .locator(`.client-work-item[data-action="select-artifact"][data-id="${id}"]`)
      .click();
    const document = page.locator(".client-artifact-document");
    const body = (await document.locator(".client-document-body").innerText()).trim();
    const title = (await document.locator("h2").first().innerText()).trim();
    if (body.length < 160) {
      readableFailures.push(`${id} (${title}) has only ${body.length} characters`);
    }
    renderedDocuments.push(await document.innerText());
  }
  expect(readableFailures, "Every Execution item needs readable content").toEqual(
    [],
  );

  const executionCorpus = renderedDocuments.join("\n");
  const requiredDeliverables: Array<[string, RegExp]> = [
    ["Technical Ticket", /Technical Ticket|技术工单/i],
    ["Metadata Rewrite", /Metadata (?:Rewrite|重写)|元数据重写/i],
    ["Content Brief", /Content Brief|内容 Brief|内容简报/i],
    ["English Blog Draft", /English Blog Draft|English draft/i],
    ["QA", /\bQA\b|质量检查|验收检查/i],
    ["Revision Review", /Revision (?:Review|审核)|版本历史|只读快照/i],
    [
      "Publish / Change Receipt",
      /Publish Receipt|Change Receipt|发布回执|变更回执|模拟发布回执/i,
    ],
    ["UTM plan", /UTM.{0,20}(?:plan|方案|计划|追踪)|追踪方案.{0,80}utm_/i],
    ["Results", /Results|效果结果|发布与结果|最新观察/i],
  ];
  const missingDeliverables = requiredDeliverables
    .filter(([, pattern]) => !pattern.test(executionCorpus))
    .map(([name]) => name);
  expect(
    missingDeliverables,
    "Execution must expose every customer-readable deliverable named in Task 5",
  ).toEqual([]);

  await page.locator('[data-action="artifact-filter"][data-filter="blog"]').click();
  await page
    .locator('.client-work-item[data-action="select-artifact"]')
    .first()
    .click();
  const article = page.locator(".client-blog-draft");
  await expect(article).toBeVisible();
  const articleTitle = (await article.locator("h1").innerText()).trim();
  expect(articleTitle).toMatch(/^[\x20-\x7E]+$/);
  expect((await article.innerText()).split(/\s+/).length).toBeGreaterThan(180);
});

test("Results distinguishes before/after observations, UTM attribution, and action receipts honestly", async ({
  page,
}) => {
  await gotoArtifact(page, "results");
  const results = page.locator("#route-content");
  await expect(results.locator("h1").first()).toContainText(/改前|改后|归因/);
  await expect(results).toContainText(/固定\s*28\s*天|固定窗口/);
  await expect(results).toContainText(/回执不等于效果/);
  await expect(results).toContainText(/不归因|归因边界|数据不足/);
  await expect(results).toContainText(/旧值/);
  await expect(results).toContainText(/新值/);
  await expect(results).toContainText(/验收值/);

  const resultTabs = page.locator(".client-results-tabs [role='tab']");
  await expect(resultTabs).toHaveCount(3);
  await page.locator('[data-action="result-tab"][data-tab="pages"]').click();
  const pageRows = page.locator(".client-result-page-table tbody tr");
  await expect(pageRows.first()).toBeVisible();
  await expect(pageRows.first()).toContainText(/→/);
  await expect(pageRows.first()).toContainText(/来源/);
  await pageRows
    .first()
    .locator('[data-action="open-result-page"]')
    .first()
    .click();
  await expect(page.getByRole("dialog")).toContainText(/基线窗口/);
  await expect(page.getByRole("dialog")).toContainText(/当前窗口/);
  await expect(page.getByRole("dialog")).toContainText(/归因限制/);
  await closeDialog(page);

  await page
    .locator('[data-action="result-tab"][data-tab="campaigns"]')
    .click();
  const campaignPanel = page.locator("#panel-results-campaigns");
  await expect(campaignPanel).toContainText(/UTM/);
  await expect(campaignPanel).toContainText(/→/);
  const campaign = campaignPanel
    .locator('[data-action="open-campaign"]')
    .first();
  await expect(campaign).toBeVisible();
  await campaign.click();
  await expect(page.getByRole("dialog")).toContainText(
    /UTM|utm_source|utm_medium|utm_campaign|归因/,
  );
  await closeDialog(page);

  await expect(page.locator(".client-scenario-notice")).toContainText(
    /离线演示场景|场景数据/,
  );
  await expect(page.locator(".client-scenario-notice")).toContainText(
    /不代表已连接真实 GSC、GA4|不会.*真实/,
  );
});

test("dialogs trap keyboard focus, close with Escape, and restore the invoker", async ({
  page,
}) => {
  await gotoArtifact(page);
  const trigger = page
    .getByRole("button", { name: /产品画像/ })
    .first();
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active?.closest('[role="dialog"]'));
    }),
  ).toBe(true);

  const focusable = dialog.locator(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
  );
  expect(await focusable.count()).toBeGreaterThanOrEqual(2);
  await focusable.last().focus();
  await page.keyboard.press("Tab");
  await expect(focusable.first()).toBeFocused();
  await focusable.first().focus();
  await page.keyboard.press("Shift+Tab");
  await expect(focusable.last()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

for (const route of PRIMARY_ROUTES) {
  test(`${route.route} has no critical or serious axe violations`, async ({
    page,
  }) => {
    await gotoArtifact(page, route.route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map(
        (violation) =>
          `${violation.id} (${violation.impact}) at ${violation.nodes
            .flatMap((node) => node.target)
            .join(", ")}`,
      );
    expect(blocking, `axe violations on #/${route.route}`).toEqual([]);
  });
}

test("an open customer dialog has no critical or serious axe violations", async ({
  page,
}) => {
  await gotoArtifact(page);
  await page
    .getByRole("button", { name: /产品画像/ })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".client-overlay")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations
      .filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      )
      .map((violation) => `${violation.id} (${violation.impact})`),
  ).toEqual([]);
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
] as const) {
  test(`${viewport.width}px has no root overflow and keeps primary reading text at 16px`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize(viewport);

    for (const { route } of PRIMARY_ROUTES) {
      await gotoArtifact(page, route);
      const layout = await page.evaluate(() => {
        const rootOverflow =
          Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ) - window.innerWidth;
        const selectors = [
          "#route-content > .client-page-header p",
          "#route-content .client-document-body p:not(.client-doc-label)",
          "#route-content .client-document-body li",
          "#route-content .client-boundary p",
          "#route-content .v13-source-strip__intro p",
          "#route-content .v14-query-list li",
          "#route-content .v13-quality-note",
        ];
        const readingNodes = [
          ...new Set(
            selectors.flatMap((selector) => [
              ...document.querySelectorAll<HTMLElement>(selector),
            ]),
          ),
        ].filter((element) => {
          const style = getComputedStyle(element);
          return (
            element.innerText.trim().length >= 20 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        });
        return {
          rootOverflow,
          readingNodeCount: readingNodes.length,
          undersized: readingNodes
            .filter(
              (element) => parseFloat(getComputedStyle(element).fontSize) < 16,
            )
            .map((element) => ({
              text: element.innerText.trim().slice(0, 80),
              fontSize: getComputedStyle(element).fontSize,
            })),
        };
      });

      expect(
        layout.rootOverflow,
        `${route} root overflow at ${viewport.width}px`,
      ).toBeLessThanOrEqual(1);
      expect(
        layout.readingNodeCount,
        `${route} must expose primary reading text at ${viewport.width}px`,
      ).toBeGreaterThan(0);
      expect(
        layout.undersized,
        `${route} primary reading text below 16px at ${viewport.width}px`,
      ).toEqual([]);
    }
  });
}
