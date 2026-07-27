import { access, lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const ARTIFACT_PATH = "/Nevermore-Keyword-Growth-Audit.html";
const ARTIFACT_FILE = path.join(
  REPOSITORY_ROOT,
  "docs",
  "artifacts",
  "Nevermore-Keyword-Growth-Audit.html",
);
const SOURCE_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "docs",
  "keyword-audit-artifact-src",
);
const SOURCE_FILES = [
  "README.md",
  "audit-data.js",
  "styles.css",
  "audit-app.js",
] as const;
const PRODUCT_VIEWS = [
  { id: "overview", label: "概览" },
  { id: "growth-map", label: "增长地图" },
  { id: "execution", label: "执行中心" },
  { id: "results", label: "效果追踪" },
] as const;
const GROWTH_OBJECT_IDS = [
  "page-portfolio",
  "keyword-library",
  "topic-governance",
  "competitor-corpus",
  "internal-link-graph",
  "keyword-history",
  "external-evidence",
] as const;
const DELIVERABLE_TYPES = [
  { id: "english-blog", minimumCharacters: 500 },
  { id: "content-brief", minimumCharacters: 300 },
  { id: "metadata", minimumCharacters: 120 },
  { id: "technical-ticket-code-patch", minimumCharacters: 300 },
] as const;

type ProductView = (typeof PRODUCT_VIEWS)[number]["id"];
type Destination = {
  kind: string;
  target: string;
};
type Capability = {
  id: string;
  requirementId: number;
  primaryModule: ProductView;
  primaryAction: {
    id: string;
    label: string;
    destination: Destination;
  };
};
type ProductContract = {
  requirementsEvidenceRole: string;
  modules: Array<{
    id: ProductView;
    name: string;
    mainSections: Array<{
      id: string;
      capabilityIds: string[];
    }>;
  }>;
  capabilities: Capability[];
  connectorPolicy: {
    customerVisible: string[];
    mockBoundary: string;
    unavailableRule: string;
  };
};

function productNav(page: Page): Locator {
  return page.locator(
    'nav[aria-label="客户工作区"] [data-product-view]',
  );
}

function productViewButton(page: Page, view: ProductView): Locator {
  return page.locator(
    `nav[aria-label="客户工作区"] [data-product-view="${view}"]`,
  );
}

function auditEvidenceTrigger(page: Page): Locator {
  return page
    .locator('[data-product-action="open-audit-evidence"]')
    .first();
}

function connectionsTrigger(page: Page): Locator {
  return page.locator('[data-product-action="open-connections"]').first();
}

function hashParameter(page: Page, parameter: string): string | null {
  const [, query = ""] = new URL(page.url()).hash.split("?");
  return new URLSearchParams(query).get(parameter);
}

function destinationKey(destination: Destination): string {
  return `${destination.kind}:${destination.target}`;
}

async function readProductContract(page: Page): Promise<ProductContract> {
  return page.evaluate(() => {
    const audit = (
      window as typeof window & {
        NevermoreKeywordAudit?: {
          integratedProduct?: ProductContract;
        };
      }
    ).NevermoreKeywordAudit;
    if (!audit?.integratedProduct) {
      throw new Error("integratedProduct contract is missing");
    }
    return audit.integratedProduct;
  });
}

async function gotoWorkspace(
  page: Page,
  view?: ProductView,
  query = "",
): Promise<void> {
  const hash = view ? `#/${view}${query}` : "";
  await page.goto(`${ARTIFACT_PATH}${hash}`);
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page).toHaveTitle("Nevermore · SEO/GEO 增长工作台");
}

async function expectCurrentProductView(
  page: Page,
  view: ProductView,
): Promise<void> {
  await expect(page.locator("#app")).toHaveAttribute(
    "data-active-view",
    view,
  );
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-product-surface",
    view,
  );
  await expect(productViewButton(page, view)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page).toHaveURL(new RegExp(`#/${view}(?:\\?|$)`));
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ) - window.innerWidth,
  );
  expect(overflow, `root overflow at ${page.url()}`).toBeLessThanOrEqual(1);
}

async function expectNativePrimarySurface(page: Page): Promise<void> {
  const main = page.getByRole("main");
  await expect(
    main.locator(
      [
        "[data-capability-entry]",
        "[data-capability-detail]",
        "[data-capability-next]",
        "[data-capability-id]",
        "[data-audit-requirement-id]",
        "[data-audit-requirement]",
        "[data-requirement-id]",
        "[data-product-node-id]",
      ].join(", "),
    ),
  ).toHaveCount(0);
  expect(await main.innerText()).not.toMatch(
    /最终客户页面结构|实施条件|Canonical 对象|Capability entry|方案证据来源/i,
  );
  expect(hashParameter(page, "capability")).toBeNull();
}

async function openNativeEntryForAction(
  page: Page,
  actionId: string,
): Promise<{ action: Locator; detail: Locator; entryId: string }> {
  const main = page.getByRole("main");
  const entries = main.locator(
    "[data-native-entry][data-entry-id]:visible",
  );
  const entryCount = await entries.count();
  expect(
    entryCount,
    `Native product action ${actionId} needs at least one customer entry`,
  ).toBeGreaterThan(0);

  for (let index = 0; index < entryCount; index += 1) {
    const entry = entries.nth(index);
    const entryId = await entry.getAttribute("data-entry-id");
    expect(
      entryId,
      "Every native entry needs a stable customer object id",
    ).toBeTruthy();
    await entry.click();
    await expect.poll(() => hashParameter(page, "entry")).toBe(entryId);

    const detail = main.locator(
      `[data-native-detail][data-entry-id="${entryId}"]:visible`,
    );
    await expect(detail).toBeVisible();
    const action = detail.locator(
      `[data-product-action="${actionId}"]:visible`,
    );
    if ((await action.count()) === 1) {
      return { action, detail, entryId: entryId ?? "" };
    }
  }

  throw new Error(
    `No native customer entry exposes governed product action ${actionId}`,
  );
}

async function expectNativeEntryOrHonestEmpty(
  page: Page,
  panel: Locator,
): Promise<void> {
  const entries = panel.locator(
    "[data-native-entry][data-entry-id]:visible",
  );
  const emptyState = panel.locator("[data-honest-empty-state]:visible");
  expect(
    (await entries.count()) + (await emptyState.count()),
    "A customer surface needs a native object entry or an honest empty state",
  ).toBeGreaterThan(0);

  if ((await entries.count()) > 0) {
    const entry = entries.first();
    const entryId = await entry.getAttribute("data-entry-id");
    expect(entryId).toBeTruthy();
    await entry.click();
    await expect.poll(() => hashParameter(page, "entry")).toBe(entryId);
    const detail = panel.locator(
      `[data-native-detail][data-entry-id="${entryId}"]:visible`,
    );
    await expect(detail).toBeVisible();
    await expect(
      detail.locator(
        "[data-product-action][data-governed-destination]:visible",
      ),
    ).not.toHaveCount(0);
    return;
  }

  await expect(emptyState.first()).toHaveAttribute(
    "data-evidence-status",
    "unavailable",
  );
  expect((await emptyState.first().innerText()).trim().length).toBeGreaterThan(
    24,
  );
  await expect(
    emptyState
      .first()
      .locator(
        "[data-product-action][data-governed-destination]:visible",
      ),
  ).toBeVisible();
}

async function getBlockingAxeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  return results.violations
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
}

async function expectDialogFocusTrapAndEscape(
  page: Page,
  trigger: Locator,
  dialog: Locator,
): Promise<void> {
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active?.closest("dialog[open], [role='dialog']"));
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
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

test("the integrated Artifact source and generated output are regular repository-owned files", async () => {
  const repositoryRealPath = await realpath(REPOSITORY_ROOT);
  const expectedFiles = [
    ...SOURCE_FILES.map((fileName) => path.join(SOURCE_DIRECTORY, fileName)),
    ARTIFACT_FILE,
  ];
  const missing: string[] = [];

  for (const file of expectedFiles) {
    try {
      await access(file);
    } catch {
      missing.push(path.relative(REPOSITORY_ROOT, file));
    }
  }

  expect(
    missing,
    "The product Artifact must build from repository-owned source and output",
  ).toEqual([]);

  for (const file of expectedFiles) {
    expect(
      (await lstat(file)).isFile(),
      `${path.relative(REPOSITORY_ROOT, file)} must be a regular file`,
    ).toBe(true);
    expect(
      (await realpath(file)).startsWith(`${repositoryRealPath}${path.sep}`),
      `${path.relative(REPOSITORY_ROOT, file)} must resolve inside this checkout`,
    ).toBe(true);
  }

  expect(
    (await realpath(SOURCE_DIRECTORY)).startsWith(
      `${repositoryRealPath}${path.sep}`,
    ),
    "The canonical source directory must not be a workstation symlink",
  ).toBe(true);

  const [readme, auditData, styles, application, html] = (await Promise.all(
    expectedFiles.map((file) => readFile(file, "utf8")),
  )) as [string, string, string, string, string];
  expect(readme).toMatch(/产品工作区|四(?:个)?模块|统一增长/i);
  expect(auditData).toContain("integratedProduct");
  expect(styles.trim().length).toBeGreaterThan(1_000);
  expect(application).toContain("addEventListener");
  expect(html).toMatch(/data-keyword-audit-build="2\.0-static"/);
  expect(html).toMatch(/data-primary-experience="growth-workspace"/);

  const executableSource = [auditData, styles, application, html].join("\n");
  expect(executableSource).not.toMatch(
    /(?:\/Users\/|\/home\/[^/]+\/|\.codex\/visualizations|\/tmp\/|signalframe-mvp-app|@sf\/)/i,
  );
});

test("the default screen is the four-module product workspace, not the audit register", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await expectCurrentProductView(page, "overview");

  const nav = productNav(page);
  await expect(nav).toHaveCount(4);
  expect(
    await nav.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-product-view")),
    ),
  ).toEqual(PRODUCT_VIEWS.map(({ id }) => id));
  for (const { id, label } of PRODUCT_VIEWS) {
    await expect(productViewButton(page, id)).toHaveAccessibleName(label);
  }
  expect((await nav.allTextContents()).join("\n")).not.toMatch(
    /需求审核|模块影响|分阶段落地|验收证据/,
  );

  const contract = await readProductContract(page);
  expect(contract.requirementsEvidenceRole).toBe("secondary-evidence");
  expect(contract.modules.map(({ id }) => id)).toEqual(
    PRODUCT_VIEWS.map(({ id }) => id),
  );
  await expect(
    page.getByRole("main").locator("[data-audit-requirement-id]"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("main").locator("[data-audit-register]"),
  ).toHaveCount(0);
  await expectNativePrimarySurface(page);
  await expect(
    page.getByRole("main").locator("[data-overview-workspace]"),
  ).toBeVisible();
  await expect(auditEvidenceTrigger(page)).toBeVisible();
});

test("the standalone product workspace is Chinese-first, offline, and free of workstation leakage", async ({
  page,
  baseURL,
}) => {
  const expectedOrigin = new URL(baseURL ?? "http://127.0.0.1:4175").origin;
  const remoteRequests = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== expectedOrigin) {
      remoteRequests.add(request.url());
    }
  });

  await gotoWorkspace(page);
  const [html, renderedHtml] = await Promise.all([
    readFile(ARTIFACT_FILE, "utf8"),
    page.content(),
  ]);

  expect(await page.locator("html").getAttribute("lang")).toBe("zh-CN");
  expect(html).not.toMatch(
    /(?:\/Users\/|\/home\/[^/]+\/|\.codex\/visualizations|\/tmp\/|signalframe-mvp-app|@sf\/)/i,
  );
  expect(renderedHtml).not.toMatch(
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

  for (const { id } of PRODUCT_VIEWS) {
    await productViewButton(page, id).click();
    await expectCurrentProductView(page, id);
  }
  expect([...remoteRequests]).toEqual([]);
});

test("all four product modules can be switched repeatedly and restore through browser history", async ({
  page,
}) => {
  await gotoWorkspace(page);

  for (const view of [
    "growth-map",
    "execution",
    "results",
    "overview",
    "growth-map",
    "overview",
  ] as const) {
    await productViewButton(page, view).click();
    await expectCurrentProductView(page, view);
  }

  await productViewButton(page, "growth-map").click();
  const growthMapUrl = page.url();
  await productViewButton(page, "execution").click();
  const executionUrl = page.url();
  await productViewButton(page, "results").click();
  const resultsUrl = page.url();
  expect(new Set([growthMapUrl, executionUrl, resultsUrl]).size).toBe(3);

  await page.goBack();
  await expectCurrentProductView(page, "execution");
  expect(page.url()).toBe(executionUrl);
  await page.goBack();
  await expectCurrentProductView(page, "growth-map");
  expect(page.url()).toBe(growthMapUrl);
  await page.goForward();
  await expectCurrentProductView(page, "execution");
  await page.goForward();
  await expectCurrentProductView(page, "results");
  expect(page.url()).toBe(resultsUrl);

  await page.reload();
  await expectCurrentProductView(page, "results");
  expect(page.url()).toBe(resultsUrl);
});

test("Growth Map exposes all seven governed object views and switches them repeatedly", async ({
  page,
}) => {
  await gotoWorkspace(page, "growth-map");
  await expectCurrentProductView(page, "growth-map");

  const contract = await readProductContract(page);
  const growthMapModule = contract.modules.find(
    (module) => module.id === "growth-map",
  );
  expect(growthMapModule, "Growth Map product contract is required").toBeTruthy();
  expect(growthMapModule?.mainSections.map(({ id }) => id)).toEqual(
    GROWTH_OBJECT_IDS,
  );
  const objects = page.locator("[data-growth-object]");
  await expect(objects).toHaveCount(7);
  expect(
    await objects.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-growth-object")),
    ),
  ).toEqual(GROWTH_OBJECT_IDS);

  for (const objectId of [
    ...GROWTH_OBJECT_IDS,
    "keyword-library",
    "topic-governance",
    "page-portfolio",
  ] as const) {
    const object = page.locator(
      `[data-growth-object="${objectId}"]`,
    );
    await object.click();
    await expect(object).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => hashParameter(page, "object")).toBe(objectId);
    const controlledPanel = await object.getAttribute("aria-controls");
    expect(controlledPanel, `${objectId} must control a real panel`).toBeTruthy();
    const panel = page.locator(`#${controlledPanel}`);
    await expect(panel).toBeVisible();
    await expectNativePrimarySurface(page);
    await expectNativeEntryOrHonestEmpty(page, panel);

    const section = growthMapModule?.mainSections.find(
      ({ id }) => id === objectId,
    );
    const expectedActionIds = contract.capabilities
      .filter(({ id }) => section?.capabilityIds.includes(id))
      .map(({ primaryAction }) => primaryAction.id);
    expect(
      expectedActionIds,
      `${objectId} must map to at least one governed workflow`,
    ).not.toHaveLength(0);
    const visibleActionId = await panel
      .locator(
        "[data-native-detail]:visible [data-product-action][data-governed-destination]:visible",
      )
      .getAttribute("data-product-action");
    expect(
      expectedActionIds,
      `${objectId} must open a work item owned by the active Growth Map object`,
    ).toContain(visibleActionId);
  }

  const pagePortfolio = page.locator(
    '[data-growth-object="page-portfolio"]',
  );
  const keywordLibrary = page.locator(
    '[data-growth-object="keyword-library"]',
  );
  await pagePortfolio.click();
  const pagePortfolioUrl = page.url();
  await keywordLibrary.click();
  const keywordLibraryUrl = page.url();
  await page.goBack();
  await expect(pagePortfolio).toHaveAttribute("aria-selected", "true");
  expect(page.url()).toBe(pagePortfolioUrl);
  await page.goForward();
  await expect(keywordLibrary).toHaveAttribute("aria-selected", "true");
  expect(page.url()).toBe(keywordLibraryUrl);
});

test("Overview is a native customer decision workspace, not a product blueprint", async ({
  page,
}) => {
  await gotoWorkspace(page, "overview");
  await expectCurrentProductView(page, "overview");
  await expectNativePrimarySurface(page);
  const workspace = page
    .getByRole("main")
    .locator("[data-overview-workspace]");
  await expect(workspace).toBeVisible();

  const contract = await readProductContract(page);
  const overview = contract.modules.find((module) => module.id === "overview");
  expect(overview).toBeTruthy();
  for (const section of overview?.mainSections ?? []) {
    const control = page.locator(`[data-section-id="${section.id}"]`);
    await control.click();
    await expect(control).toHaveAttribute("aria-selected", "true");
    const panelId = await control.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toBeVisible();
    await expectNativeEntryOrHonestEmpty(page, panel);
    await expectNativePrimarySurface(page);
  }
});

test("Execution switches among four substantive pending deliverables", async ({
  page,
}) => {
  await gotoWorkspace(page, "execution");
  await expectCurrentProductView(page, "execution");
  await expectNativePrimarySurface(page);
  await expect(
    page.getByRole("main").locator("[data-execution-workspace]"),
  ).toBeVisible();
  const artifactBodySection = page.locator(
    '[data-section-id="artifact-body"]',
  );
  await expect(artifactBodySection).toBeVisible();
  await artifactBodySection.click();
  await expect(artifactBodySection).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const controls = page.locator("[data-deliverable-select]");
  await expect(controls).toHaveCount(DELIVERABLE_TYPES.length);
  expect(
    await controls.evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute("data-deliverable-select"),
      ),
    ),
  ).toEqual(DELIVERABLE_TYPES.map(({ id }) => id));

  for (const deliverable of DELIVERABLE_TYPES) {
    const control = page.locator(
      `[data-deliverable-select="${deliverable.id}"]`,
    );
    await control.click();
    await expect(control).toHaveAttribute("aria-selected", "true");
    const body = page.locator(
      `[data-deliverable-body][data-deliverable-type="${deliverable.id}"]:visible`,
    );
    await expect(body).toBeVisible();
    await expect(body).toHaveAttribute(
      "data-deliverable-status",
      /^(?:pending-review|pending-action)$/,
    );
    expect(
      (await body.innerText()).trim().length,
      `${deliverable.id} must render substantive customer-reviewable content`,
    ).toBeGreaterThanOrEqual(deliverable.minimumCharacters);
    if (deliverable.id === "english-blog") {
      await expect(body).toHaveAttribute("lang", /^en(?:-|$)/);
    }

    const checks = page.locator(
      "[data-delivery-check][data-evidence-status]:visible",
    );
    expect(
      await checks.count(),
      `${deliverable.id} must disclose source, QA, approval, and receipt truth`,
    ).toBeGreaterThanOrEqual(4);
    expect(
      new Set(
        await checks.evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute("data-delivery-check"),
          ),
        ),
      ),
    ).toEqual(
      new Set(["sources", "qa", "approval", "publication-receipt"]),
    );
    for (let index = 0; index < (await checks.count()); index += 1) {
      await expect(checks.nth(index)).toHaveAttribute(
        "data-evidence-status",
        /^(?:pending|unavailable)$/,
      );
    }
  }

  await expect(
    page
      .getByRole("main")
      .locator(
        '[data-deliverable-status="published"], [data-deliverable-status="completed"]',
      ),
  ).toHaveCount(0);
  expect(await page.getByRole("main").innerText()).not.toMatch(
    /已产生客户结果|发布成功/,
  );
});

test("Results shows evidence-backed before/after or an honest unavailable state for every view", async ({
  page,
}) => {
  await gotoWorkspace(page, "results");
  await expectCurrentProductView(page, "results");
  await expectNativePrimarySurface(page);
  await expect(
    page.getByRole("main").locator("[data-results-workspace]"),
  ).toBeVisible();

  const contract = await readProductContract(page);
  const results = contract.modules.find((module) => module.id === "results");
  expect(results).toBeTruthy();

  for (const section of results?.mainSections ?? []) {
    const control = page.locator(`[data-section-id="${section.id}"]`);
    await control.click();
    await expect(control).toHaveAttribute("aria-selected", "true");
    const panelId = await control.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = page.locator(`#${panelId}`);
    await expect(panel).toBeVisible();

    const comparison = panel.locator("[data-results-comparison]:visible");
    const emptyState = panel.locator("[data-honest-empty-state]:visible");
    expect(
      (await comparison.count()) + (await emptyState.count()),
      `${section.id} must expose exactly one truthful results state`,
    ).toBe(1);

    if ((await comparison.count()) === 1) {
      await expect(comparison).toHaveAttribute(
        "data-evidence-status",
        /^(?:verified|observation)$/,
      );
      await expect(comparison).toHaveAttribute("data-evidence-source", /.+/);
      await expect(comparison.locator("[data-before]")).toBeVisible();
      await expect(comparison.locator("[data-after]")).toBeVisible();
    } else {
      await expect(emptyState).toHaveAttribute(
        "data-evidence-status",
        "unavailable",
      );
      expect((await emptyState.innerText()).trim().length).toBeGreaterThan(24);
      await expect(
        emptyState.locator(
          "[data-product-action][data-governed-destination]:visible",
        ),
      ).toBeVisible();
    }
    await expectNativePrimarySurface(page);
  }
});

test("all 13 reviewed needs emerge through native customer entries and governed actions", async ({
  page,
}) => {
  test.slow();
  await gotoWorkspace(page);
  const contract = await readProductContract(page);
  expect(contract.capabilities).toHaveLength(13);
  expect(
    contract.capabilities.map(({ requirementId }) => requirementId),
  ).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));

  const coveredRequirementIds: number[] = [];
  for (const capability of contract.capabilities) {
    const primaryModule = contract.modules.find(
      (module) => module.id === capability.primaryModule,
    );
    const capabilitySection = primaryModule?.mainSections.find((section) =>
      section.capabilityIds.includes(capability.id),
    );
    expect(
      capabilitySection,
      `Capability ${capability.requirementId} needs a governed section in ${capability.primaryModule}`,
    ).toBeTruthy();

    await productViewButton(page, capability.primaryModule).click();
    await expectCurrentProductView(page, capability.primaryModule);
    const sectionControl = page.locator(
      `[data-section-id="${capabilitySection?.id}"]`,
    );
    await expect(sectionControl).toBeVisible();
    await sectionControl.click();
    await expect(sectionControl).toHaveAttribute("aria-selected", "true");
    await expectNativePrimarySurface(page);

    const { action, detail, entryId } = await openNativeEntryForAction(
      page,
      capability.primaryAction.id,
    );
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("data-entry-id", entryId);
    await expect(action).toBeVisible();
    await expect(action).toHaveAttribute(
      "data-product-action",
      capability.primaryAction.id,
    );
    const governedDestination = await action.getAttribute(
      "data-governed-destination",
    );
    expect(governedDestination).toBe(
      destinationKey(capability.primaryAction.destination),
    );
    await action.click();

    expect(hashParameter(page, "capability")).toBeNull();
    await expect.poll(() => hashParameter(page, "target")).toBe(
      governedDestination,
    );
    await expect
      .poll(async () =>
        page
          .locator("[data-governed-target]:visible")
          .evaluateAll((elements, expected) =>
            elements.some(
              (element) =>
                element.getAttribute("data-governed-target") === expected,
            ),
            governedDestination,
          ),
      )
      .toBe(true);
    await expect(page.locator(".toast, [data-toast]")).toHaveCount(0);
    const governedDialog = page.locator(
      `dialog[data-governed-target="${governedDestination}"][open]`,
    );
    if ((await governedDialog.count()) > 0) {
      await page.keyboard.press("Escape");
      await expect(governedDialog).toBeHidden();
    }
    await expectNativePrimarySurface(page);
    coveredRequirementIds.push(capability.requirementId);
  }

  expect(coveredRequirementIds).toEqual(
    Array.from({ length: 13 }, (_, index) => index + 1),
  );
});

test("audit conclusions exist only as secondary evidence and preserve all 13 decisions", async ({
  page,
}) => {
  await gotoWorkspace(page);
  const trigger = auditEvidenceTrigger(page);
  await expect(trigger).toHaveAttribute(
    "data-governed-destination",
    /.+/,
  );
  await trigger.click();

  const dialog = page.locator("dialog[data-audit-evidence-dialog]");
  await expect(dialog).toBeVisible();
  expect(await dialog.getAttribute("data-secondary-evidence")).not.toBeNull();
  await expect(dialog).toContainText(/需求审计|审核结论/);
  const requirements = dialog.locator("[data-audit-requirement-id]");
  await expect(requirements).toHaveCount(13);
  expect(
    await requirements.evaluateAll((elements) =>
      elements.map((element) =>
        Number(element.getAttribute("data-audit-requirement-id")),
      ),
    ),
  ).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
  await expect(dialog).toContainText(/直接纳入/);
  await expect(dialog).toContainText(/改写后纳入/);
  await expect(dialog).toContainText(/后置/);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("main").locator("[data-audit-requirement-id]"),
  ).toHaveCount(0);
});

test("customer-visible connections are exactly GSC, GA4, and GitHub", async ({
  page,
}) => {
  await gotoWorkspace(page);
  const contract = await readProductContract(page);
  expect(contract.connectorPolicy.customerVisible).toEqual([
    "GSC",
    "GA4",
    "GitHub",
  ]);

  const trigger = connectionsTrigger(page);
  await trigger.click();
  const dialog = page.locator("dialog[data-connections-dialog]");
  await expect(dialog).toBeVisible();
  const connections = dialog.locator(
    "[data-connection-id][data-customer-connector]",
  );
  await expect(connections).toHaveCount(3);
  expect(
    await connections.evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute("data-customer-connector"),
      ),
    ),
  ).toEqual(["GSC", "GA4", "GitHub"]);
  const connectionText = (await connections.allTextContents())
    .join("\n")
    .replace(/Google Search Console/g, "GSC")
    .replace(/Google Analytics 4/g, "GA4");
  expect(connectionText).toMatch(/\bGSC\b/);
  expect(connectionText).toMatch(/\bGA4\b/);
  expect(connectionText).toMatch(/\bGitHub\b/);
  expect(connectionText).not.toMatch(
    /DataForSEO|Ahrefs|Moz|G2|Capterra|App Store|SERP|AI Citation/i,
  );
});

test("no customer action resolves to mock metrics, remote work, or a generic toast", async ({
  page,
}) => {
  await gotoWorkspace(page);
  const contract = await readProductContract(page);
  expect(contract.connectorPolicy.mockBoundary).toMatch(
    /不使用|不得|禁止|不展示|unavailable/i,
  );
  expect(contract.connectorPolicy.unavailableRule).toMatch(
    /unavailable|不可用|缺少|未接入/i,
  );

  for (const { id } of PRODUCT_VIEWS) {
    await productViewButton(page, id).click();
    await expectNativePrimarySurface(page);
    const visibleMetrics = page.locator("[data-business-metric]:visible");
    for (let index = 0; index < (await visibleMetrics.count()); index += 1) {
      const metric = visibleMetrics.nth(index);
      await expect(metric).toHaveAttribute(
        "data-evidence-status",
        /^(?:verified|observation|unavailable)$/,
      );
      await expect(metric).toHaveAttribute("data-evidence-source", /.+/);
      expect(
        await metric.getAttribute("data-evidence-status"),
      ).not.toMatch(/mock|scenario/i);
    }

    const actions = page.locator("[data-product-action]:visible");
    for (let index = 0; index < (await actions.count()); index += 1) {
      await expect(actions.nth(index)).toHaveAttribute(
        "data-governed-destination",
        /.+/,
      );
    }
    await expect(page.locator(".toast, [data-toast]")).toHaveCount(0);
  }

  const [html, visibleText] = await Promise.all([
    readFile(ARTIFACT_FILE, "utf8"),
    page.locator("body").innerText(),
  ]);
  expect(html).not.toMatch(/\b(?:showToast|createToast|toast\s*\()/i);
  expect(visibleText).not.toMatch(
    /DEMO DATA|场景数据\s*[·•]|模拟指标|RelayOps|1,240\s+clicks|Position\s+12\.8/i,
  );
});

test("product navigation and Growth Map objects work from the keyboard", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await productViewButton(page, "growth-map").focus();
  await page.keyboard.press("Enter");
  await expectCurrentProductView(page, "growth-map");

  const objects = page.locator("[data-growth-object]");
  await objects.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(objects.nth(1)).toHaveAttribute("aria-selected", "true");
  const secondObjectId = await objects.nth(1).getAttribute(
    "data-growth-object",
  );
  await expect.poll(() => hashParameter(page, "object")).toBe(secondObjectId);

  await productViewButton(page, "execution").focus();
  await page.keyboard.press("Space");
  await expectCurrentProductView(page, "execution");
  const entry = page
    .locator("[data-native-entry][data-entry-id]:visible")
    .first();
  const entryId = await entry.getAttribute("data-entry-id");
  expect(entryId).toBeTruthy();
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => hashParameter(page, "entry")).toBe(entryId);
  await expect(
    page.locator(
      `[data-native-detail][data-entry-id="${entryId}"]:visible`,
    ),
  ).toBeVisible();
});

test("secondary audit and connection dialogs trap focus, close with Escape, and restore their invokers", async ({
  page,
}) => {
  await gotoWorkspace(page);
  await expectDialogFocusTrapAndEscape(
    page,
    auditEvidenceTrigger(page),
    page.locator("dialog[data-audit-evidence-dialog]"),
  );
  await expectDialogFocusTrapAndEscape(
    page,
    connectionsTrigger(page),
    page.locator("dialog[data-connections-dialog]"),
  );
});

test("prefers-reduced-motion disables visible workspace motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoWorkspace(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    )
    .toBe(true);

  const motion = await page.evaluate(() => {
    const parseDurations = (value: string): number[] =>
      value.split(",").map((duration) => {
        const normalized = duration.trim();
        if (normalized.endsWith("ms")) {
          return Number.parseFloat(normalized);
        }
        return Number.parseFloat(normalized) * 1_000;
      });

    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .flatMap((element) => {
        const style = getComputedStyle(element);
        const longestAnimation = Math.max(
          0,
          ...parseDurations(style.animationDuration),
        );
        const longestTransition = Math.max(
          0,
          ...parseDurations(style.transitionDuration),
        );
        return longestAnimation > 1 || longestTransition > 1
          ? [
              {
                tag: element.tagName,
                className: element.className,
                animationMs: longestAnimation,
                transitionMs: longestTransition,
              },
            ]
          : [];
      });
  });

  expect(motion, "Reduced-motion mode must remove decorative motion").toEqual(
    [],
  );
});

for (const { id, label } of PRODUCT_VIEWS) {
  test(`${label} has no serious or critical Axe violation`, async ({
    page,
  }) => {
    await gotoWorkspace(page, id);
    await expectCurrentProductView(page, id);
    expect(
      await getBlockingAxeViolations(page),
      `blocking accessibility violations in ${label}`,
    ).toEqual([]);
  });
}

for (const dialogContract of [
  {
    label: "审计证据",
    trigger: '[data-product-action="open-audit-evidence"]',
    dialog: "dialog[data-audit-evidence-dialog]",
  },
  {
    label: "数据连接",
    trigger: '[data-product-action="open-connections"]',
    dialog: "dialog[data-connections-dialog]",
  },
] as const) {
  test(`${dialogContract.label} Dialog has no serious or critical Axe violation`, async ({
    page,
  }) => {
    await gotoWorkspace(page);
    await page.locator(dialogContract.trigger).first().click();
    await expect(page.locator(dialogContract.dialog)).toBeVisible();
    expect(await getBlockingAxeViolations(page)).toEqual([]);
  });
}

for (const viewport of [
  { name: "desktop", width: 1_440, height: 1_000 },
  { name: "tablet", width: 1_024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`${viewport.name} ${viewport.width}×${viewport.height} has no horizontal overflow and keeps main reading text at 16px`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize(viewport);

    for (const { id, label } of PRODUCT_VIEWS) {
      await gotoWorkspace(page, id);
      await expectCurrentProductView(page, id);
      await expectNoHorizontalOverflow(page);

      const readingText = page.locator("[data-reading-text]:visible");
      expect(
        await readingText.count(),
        `${label} must expose primary reading text`,
      ).toBeGreaterThan(0);
      const undersized = await readingText.evaluateAll((elements) =>
        elements
          .filter(
            (element) =>
              element.textContent !== null &&
              element.textContent.trim().length >= 12 &&
              Number.parseFloat(getComputedStyle(element).fontSize) < 16,
          )
          .map((element) => ({
            text: element.textContent?.trim().slice(0, 80),
            fontSize: getComputedStyle(element).fontSize,
          })),
      );
      expect(
        undersized,
        `${label} has main reading text below 16px at ${viewport.width}px`,
      ).toEqual([]);
    }
  });
}
