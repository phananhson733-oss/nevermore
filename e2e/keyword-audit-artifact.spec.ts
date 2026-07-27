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
const VIEW_IDS = ["requirements", "modules", "stages", "acceptance"] as const;
const VIEW_LABELS = {
  requirements: "需求审核",
  modules: "模块影响",
  stages: "分阶段落地",
  acceptance: "验收证据",
} as const;
const VIEW_EXPECTED_COPY = {
  requirements: /需求|审核/,
  modules: /概览|增长地图|执行中心|效果追踪/,
  stages: /Canonical|结构与持续监控|外部证据/,
  acceptance: /数据|契约|服务|界面|测试|Provider/,
} as const;

type ViewId = (typeof VIEW_IDS)[number];

function viewButton(page: Page, view: ViewId): Locator {
  return page.locator(
    `[data-action="set-view"][data-view="${view}"]`,
  );
}

function requirementButton(page: Page, requirementId: number): Locator {
  return page.locator(
    `[data-action="select-requirement"][data-requirement-id="${requirementId}"]`,
  );
}

function visibleRequirementButtons(page: Page): Locator {
  return page.locator(
    '[data-action="select-requirement"][data-requirement-id]:visible',
  );
}

async function gotoAudit(
  page: Page,
  hash = "#/requirements?item=1&decision=all&module=all&stage=all",
): Promise<void> {
  await page.goto(`${ARTIFACT_PATH}${hash}`);
  await expect(page.locator("#app")).toHaveAttribute("data-ready", "true");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "关键词库与 SEO/GEO 能力需求审计",
      exact: true,
    }),
  ).toBeVisible();
}

async function expectCurrentView(page: Page, view: ViewId): Promise<void> {
  await expect(page.locator("#app")).toHaveAttribute("data-active-view", view);
  await expect(viewButton(page, view)).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(
    new RegExp(
      `#/${view}(?:\\?|$)`,
    ),
  );
  await expect(page.getByRole("main")).toContainText(VIEW_EXPECTED_COPY[view]);
}

async function selectFilter(
  page: Page,
  filter: "decision" | "module" | "stage",
  value: string,
): Promise<void> {
  const control = page.locator(`select[data-filter="${filter}"]`);
  await expect(control).toBeVisible();
  await control.selectOption(value);
  await expect(control).toHaveValue(value);
  await expect
    .poll(() => {
      const [, query = ""] = new URL(page.url()).hash.split("?");
      return new URLSearchParams(query).get(filter);
    })
    .toBe(value);
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

test("the audit source and generated output are regular repository-owned files", async () => {
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
    "The audit must be generated from repository-owned source and committed as a standalone output",
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
  expect(readme).toMatch(/需求来源|provenance|来源/i);
  expect(readme).toMatch(/不等于.*上线|不是.*完成证据/);
  expect(auditData).toContain("NevermoreKeywordAudit");
  expect(styles.trim().length).toBeGreaterThan(1_000);
  expect(application).toContain("addEventListener");
  expect(html).toMatch(/data-keyword-audit-build="1\.0-static"/);

  const executableSource = [auditData, styles, application, html].join("\n");
  expect(executableSource).not.toMatch(
    /(?:\/Users\/|\/home\/[^/]+\/|\.codex\/visualizations|\/tmp\/|signalframe-mvp-app|@sf\/)/i,
  );
});

test("the standalone audit is Chinese-first, self-contained, and makes no remote request", async ({
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

  await gotoAudit(page);
  const [html, visibleText, renderedHtml] = await Promise.all([
    readFile(ARTIFACT_FILE, "utf8"),
    page.locator("body").innerText(),
    page.content(),
  ]);

  expect(await page.locator("html").getAttribute("lang")).toBe("zh-CN");
  await expect(page.getByText("审核通过不等于已上线", { exact: false })).toBeVisible();
  expect(visibleText).toMatch(/中文|需求审计|审核/);
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
  expect([...remoteRequests]).toEqual([]);
});

test("all 13 audited requirements render once with stable identities", async ({
  page,
}) => {
  await gotoAudit(page);
  const requirements = visibleRequirementButtons(page);
  await expect(requirements).toHaveCount(13);
  expect(
    await requirements.evaluateAll((elements) =>
      elements.map((element) =>
        Number(element.getAttribute("data-requirement-id")),
      ),
    ),
  ).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));

  await expect(requirementButton(page, 2)).toContainText(
    "同意图词的重复与蚕食治理",
  );
  await expect(requirementButton(page, 9)).toContainText(
    "90 天关键词排名趋势与变更事件",
  );
});

test("views, filters, and requirement details can be switched repeatedly", async ({
  page,
}) => {
  await gotoAudit(page);

  for (const view of [
    "modules",
    "stages",
    "acceptance",
    "requirements",
    "modules",
    "requirements",
  ] as const) {
    await viewButton(page, view).click();
    await expectCurrentView(page, view);
  }

  await selectFilter(page, "decision", "rewrite");
  await expect(requirementButton(page, 2)).toBeVisible();
  await expect(requirementButton(page, 4)).toBeHidden();
  expect(await visibleRequirementButtons(page).count()).toBeGreaterThan(0);

  await selectFilter(page, "decision", "adopt");
  await expect(requirementButton(page, 4)).toBeVisible();
  await expect(requirementButton(page, 2)).toBeHidden();

  await selectFilter(page, "decision", "defer");
  await expect(requirementButton(page, 11)).toBeVisible();
  await expect(requirementButton(page, 4)).toBeHidden();

  await selectFilter(page, "decision", "all");
  await expect(visibleRequirementButtons(page)).toHaveCount(13);

  await selectFilter(page, "module", "growth-map");
  const growthMapRows = visibleRequirementButtons(page);
  expect(await growthMapRows.count()).toBeGreaterThan(0);
  expect(
    await growthMapRows.evaluateAll((elements) =>
      elements.every((element) =>
        (element.getAttribute("data-modules") ?? "")
          .split(/\s*,\s*|\s+/)
          .includes("growth-map"),
      ),
    ),
  ).toBe(true);

  await selectFilter(page, "module", "execution");
  const executionRows = visibleRequirementButtons(page);
  expect(await executionRows.count()).toBeGreaterThan(0);
  expect(
    await executionRows.evaluateAll((elements) =>
      elements.every((element) =>
        (element.getAttribute("data-modules") ?? "")
          .split(/\s*,\s*|\s+/)
          .includes("execution"),
      ),
    ),
  ).toBe(true);

  await selectFilter(page, "module", "all");
  await selectFilter(page, "stage", "stage-1");
  const stageOneRows = visibleRequirementButtons(page);
  expect(await stageOneRows.count()).toBeGreaterThan(0);
  expect(
    await stageOneRows.evaluateAll((elements) =>
      elements.every((element) =>
        (element.getAttribute("data-stages") ?? "")
          .split(/\s*,\s*|\s+/)
          .includes("stage-1"),
      ),
    ),
  ).toBe(true);

  await selectFilter(page, "stage", "stage-3");
  await expect(requirementButton(page, 11)).toBeVisible();
  await selectFilter(page, "stage", "all");
  await expect(visibleRequirementButtons(page)).toHaveCount(13);

  await requirementButton(page, 2).click();
  await expect(page.locator("#detail-title")).toHaveText(
    "同意图词的重复与蚕食治理",
  );
  await expect(page.locator("[data-requirement-detail]")).toContainText(
    /主词|支持词|保持独立|暂缓/,
  );

  await requirementButton(page, 9).click();
  await expect(page.locator("#detail-title")).toHaveText(
    "90 天关键词排名趋势与变更事件",
  );
  const completionFlags = page.locator("[data-completion-flag]");
  await expect(completionFlags).toHaveCount(2);
  expect(
    await completionFlags.evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute("data-completion-flag"),
      ),
    ),
  ).toEqual([
    "rank_history_complete",
    "receipt_backed_results_complete",
  ]);
  await expect(completionFlags.nth(0)).toContainText(/计划中|未完成/);
  await expect(completionFlags.nth(1)).toContainText(/计划中|未完成/);
});

test("direct hashes, reload, back, and forward restore the complete audit state", async ({
  page,
}) => {
  await gotoAudit(
    page,
    "#/requirements?item=2&decision=rewrite&module=growth-map&stage=stage-1",
  );
  await expect(page.locator("#detail-title")).toHaveText(
    "同意图词的重复与蚕食治理",
  );
  await expect(page.locator('select[data-filter="decision"]')).toHaveValue(
    "rewrite",
  );
  await expect(page.locator('select[data-filter="module"]')).toHaveValue(
    "growth-map",
  );
  await expect(page.locator('select[data-filter="stage"]')).toHaveValue(
    "stage-1",
  );

  const restoredUrl = page.url();
  await page.reload();
  await expect(page.locator("#detail-title")).toHaveText(
    "同意图词的重复与蚕食治理",
  );
  expect(page.url()).toBe(restoredUrl);

  await selectFilter(page, "decision", "all");
  await selectFilter(page, "module", "all");
  await selectFilter(page, "stage", "all");
  await requirementButton(page, 1).click();
  const itemOneUrl = page.url();
  await requirementButton(page, 2).click();
  const itemTwoUrl = page.url();
  await requirementButton(page, 9).click();
  const itemNineUrl = page.url();

  expect(new Set([itemOneUrl, itemTwoUrl, itemNineUrl]).size).toBe(3);
  await page.goBack();
  await expect(page.locator("#detail-title")).toHaveText(
    "同意图词的重复与蚕食治理",
  );
  expect(page.url()).toBe(itemTwoUrl);

  await page.goBack();
  expect(page.url()).toBe(itemOneUrl);
  await page.goForward();
  await expect(page.locator("#detail-title")).toHaveText(
    "同意图词的重复与蚕食治理",
  );
  expect(page.url()).toBe(itemTwoUrl);
  await page.goForward();
  await expect(page.locator("#detail-title")).toHaveText(
    "90 天关键词排名趋势与变更事件",
  );
  expect(page.url()).toBe(itemNineUrl);
});

test("navigation and requirement selection work from the keyboard", async ({
  page,
}) => {
  await gotoAudit(page);

  await viewButton(page, "modules").focus();
  await page.keyboard.press("Enter");
  await expectCurrentView(page, "modules");

  await viewButton(page, "requirements").focus();
  await page.keyboard.press("Space");
  await expectCurrentView(page, "requirements");

  const requirementTwo = requirementButton(page, 2);
  await requirementTwo.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#detail-title")).toHaveText(
    "同意图词的重复与蚕食治理",
  );
});

test("visible module, stage, and evidence actions reach their governed destinations", async ({
  page,
}) => {
  await gotoAudit(page);

  await viewButton(page, "modules").click();
  const growthMapModule = page.locator(
    '[data-action="select-module"][data-module-id="growth-map"]',
  );
  await expect(growthMapModule).toBeVisible();
  await growthMapModule.click();
  await expectCurrentView(page, "modules");
  await expect(growthMapModule).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => {
      const [, query = ""] = new URL(page.url()).hash.split("?");
      return new URLSearchParams(query).get("module");
    })
    .toBe("growth-map");
  await expect(page.locator("#review-detail")).toContainText(
    /增长地图.*客户界面变化|客户界面变化.*增长地图/s,
  );

  await viewButton(page, "stages").click();
  const stageTwo = page.locator(
    '[data-action="select-stage"][data-stage-id="stage-2"]',
  );
  await expect(stageTwo).toBeVisible();
  await stageTwo.click();
  await expectCurrentView(page, "stages");
  await expect(stageTwo).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => {
      const [, query = ""] = new URL(page.url()).hash.split("?");
      return new URLSearchParams(query).get("stage");
    })
    .toBe("stage-2");
  await expect(page.locator("#review-detail")).toContainText(
    /结构与持续监控/,
  );

  await viewButton(page, "requirements").click();
  await requirementButton(page, 9).click();
  const evidenceTrigger = page.locator('[data-action="open-evidence"]').first();
  await evidenceTrigger.click();
  const dialog = page.locator("dialog[data-evidence-dialog]");
  await expect(dialog).toBeVisible();
  const goToAcceptance = dialog.locator(
    '[data-action="go-to-acceptance"]',
  );
  await expect(goToAcceptance).toBeVisible();
  await goToAcceptance.click();
  await expect(dialog).toBeHidden();
  await expectCurrentView(page, "acceptance");
  await expect(page.getByRole("main")).toContainText(
    /rank_history_complete|排名历史/,
  );
});

test("the evidence dialog traps focus, closes with Escape, and restores its invoker", async ({
  page,
}) => {
  await gotoAudit(page);
  const trigger = page.locator('[data-action="open-evidence"]').first();
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.locator("dialog[data-evidence-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active?.closest("dialog[data-evidence-dialog]"));
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
});

test("prefers-reduced-motion disables visible interface motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoAudit(page);
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

for (const view of VIEW_IDS) {
  test(`${VIEW_LABELS[view]} has no serious or critical Axe violation`, async ({
    page,
  }) => {
    await gotoAudit(
      page,
      `#/${view}?item=1&decision=all&module=all&stage=all`,
    );
    await expectCurrentView(page, view);
    expect(
      await getBlockingAxeViolations(page),
      `blocking accessibility violations in ${VIEW_LABELS[view]}`,
    ).toEqual([]);
  });
}

test("the open evidence dialog has no serious or critical Axe violation", async ({
  page,
}) => {
  await gotoAudit(page);
  await page.locator('[data-action="open-evidence"]').first().click();
  await expect(page.locator("dialog[data-evidence-dialog]")).toBeVisible();
  expect(await getBlockingAxeViolations(page)).toEqual([]);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 1_000 },
  { name: "tablet", width: 1_024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`${viewport.name} ${viewport.width}×${viewport.height} has no horizontal overflow and keeps main reading text at 16px`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize(viewport);

    for (const view of VIEW_IDS) {
      await gotoAudit(
        page,
        `#/${view}?item=1&decision=all&module=all&stage=all`,
      );
      await expectCurrentView(page, view);
      await expectNoHorizontalOverflow(page);

      const readingText = page.locator("[data-reading-text]:visible");
      expect(
        await readingText.count(),
        `${VIEW_LABELS[view]} must expose primary reading text`,
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
        `${VIEW_LABELS[view]} has main reading text below 16px at ${viewport.width}px`,
      ).toEqual([]);
    }
  });
}
