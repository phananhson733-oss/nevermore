import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  E2E_PROJECT_ID,
  diagnosisFindingFixture,
  diagnosisFindingsEnvelopeFixture,
  diagnosisNotRunFindingsEnvelopeFixture,
  installCriticalFlowApi,
} from "./mock-api.ts";

const FINDINGS_ROUTE = `**/api/mvp/projects/${E2E_PROJECT_ID}/findings**`;
const PROJECT_ROUTE = `**/api/mvp/projects/${E2E_PROJECT_ID}`;
const SNAPSHOTS_ROUTE = `**/api/mvp/projects/${E2E_PROJECT_ID}/snapshots**`;
const RUN_STATUS_ROUTE = `**/api/mvp/projects/${E2E_PROJECT_ID}/runs/diagnostic-run`;

async function failRequiredRead(route: Route): Promise<void> {
  await route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Temporarily unavailable.",
      },
    }),
  });
}

async function serveFindings(page: Page, envelope: unknown): Promise<void> {
  await page.route(FINDINGS_ROUTE, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(envelope),
    });
  });
}

async function openDiagnosis(page: Page): Promise<void> {
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
}

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
});

test("a fresh project presents coverage as not run instead of five missing domains", async ({
  page,
}) => {
  await serveFindings(page, diagnosisNotRunFindingsEnvelopeFixture());
  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);
  await expect(
    page.getByRole("heading", {
      name: "Every finding should stand up to scrutiny.",
      exact: true,
    }),
  ).toBeVisible();

  const band = page.locator("[data-coverage-band]");
  const rail = page.locator("[data-audit-rail]");
  await expect(band).toHaveAttribute("data-coverage-availability", "not-run");
  await expect(rail).toHaveAttribute("data-coverage-availability", "not-run");
  await expect(
    band.getByText("Coverage not evaluated", { exact: true }),
  ).toBeVisible();
  await expect(
    rail.getByText("Diagnosis has not run yet", { exact: true }),
  ).toBeVisible();
  await expect(band.locator("li")).toHaveCount(0);
  await expect(band.locator("[data-coverage-state-bar]")).toHaveCount(0);
  await expect(rail.locator("[data-audit-domain-segment]")).toHaveCount(0);
  await expect(band.getByRole("progressbar")).toHaveCount(0);
  await expect(rail.getByRole("progressbar")).toHaveCount(0);
  await expect(band.getByText("Missing", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("No coverage limitation was reported.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    rail.getByText(
      "Coverage limitations are unavailable until diagnosis runs.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page
      .getByText("Complete domains", { exact: true })
      .locator(".."),
  ).toContainText("Not run");
  await expect(
    page.getByText("Not diagnosed yet", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run diagnosis", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("Last run", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "简体中文" }).click();
  await expect(
    band.getByText("覆盖尚未评估", { exact: true }),
  ).toBeVisible();
  await expect(
    rail.getByText("诊断尚未运行", { exact: true }),
  ).toBeVisible();
  await expect(
    rail.getByText("诊断运行前，覆盖限制信息不可用。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("本次未报告覆盖限制。", { exact: true }),
  ).toHaveCount(0);
});

test("coverage states remain qualitative without fabricated percentage values", async ({
  page,
}) => {
  await openDiagnosis(page);
  const band = page.locator("[data-coverage-band]");
  const rail = page.locator("[data-audit-rail]");
  const stateBars = band.locator("[data-coverage-state-bar]");

  await expect(band).toHaveAttribute("data-coverage-availability", "available");
  await expect(stateBars).toHaveCount(5);
  await expect(stateBars.first()).toHaveAttribute("aria-hidden", "true");
  await expect(band.locator("progress")).toHaveCount(0);
  await expect(rail.locator("progress")).toHaveCount(0);
  await expect(band.getByRole("progressbar")).toHaveCount(0);
  await expect(rail.getByRole("progressbar")).toHaveCount(0);
  await expect(
    band.locator("[value], [aria-valuenow], [aria-valuemin], [aria-valuemax]"),
  ).toHaveCount(0);
  await expect(
    rail.locator("[value], [aria-valuenow], [aria-valuemin], [aria-valuemax]"),
  ).toHaveCount(0);
  await expect(rail.locator("[data-audit-domain-segment]")).toHaveCount(5);
  await expect(band).not.toContainText(/(?:100|64|42|8)%/);
});

test("each evidence trace exposes canonical provenance and Escape restores focus", async ({
  page,
}) => {
  await openDiagnosis(page);
  const finding = page.getByRole("article", { name: "HTTP status errors" });
  await expect(finding).toContainText("The URL returned HTTP 500.");

  const toggle = finding.getByRole("button", { name: "View evidence (1)" });
  await toggle.click();
  const drawer = page.getByRole("dialog", {
    name: "Trace the finding back to its source",
  });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByText("Site crawl", { exact: true }).first(),
  ).toBeVisible();
  await expect(drawer.getByText("Available", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Supports", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Grade B", { exact: true })).toBeVisible();
  await expect(drawer).toContainText("Jul 18, 2026");
  await expect(drawer).toContainText("The URL returned HTTP 500.");
  await expect(drawer).toContainText("direct_public");
  await expect(drawer).toContainText("observed");
  await expect(drawer).toContainText("One captured response.");
  await expect(drawer).toContainText("https://example.test/product");
  await expect(drawer).toContainText("00000000-0000-4000-8000-000000000101");

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("partial and unavailable evidence are explicit text states, not color-only", async ({
  page,
}) => {
  const base = diagnosisFindingFixture({ reviewState: "needs_more_data" });
  const canonical = base.evidence[0]!;
  const partialClaim = "The crawl response was incomplete.";
  const unavailableClaim = "The response body could not be observed.";
  await serveFindings(
    page,
    diagnosisFindingsEnvelopeFixture([
      {
        ...base,
        evidence: [
          {
            ...canonical,
            id: "00000000-0000-4000-8000-000000000211",
            availability: "partial",
            support: "context",
            claim: partialClaim,
          },
          {
            ...canonical,
            id: "00000000-0000-4000-8000-000000000212",
            availability: "unavailable",
            support: "contradicts",
            claim: unavailableClaim,
          },
        ],
      },
    ]),
  );
  await openDiagnosis(page);

  await page.getByRole("button", { name: "View evidence (2)" }).click();
  const drawer = page.getByRole("dialog", {
    name: "Trace the finding back to its source",
  });
  await expect(drawer.getByText("Partial", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Context", { exact: true })).toBeVisible();

  await drawer.getByRole("tab", { name: "02 Site crawl" }).click();
  await expect(
    drawer.getByText("Unavailable", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    drawer.getByText("Contradicts", { exact: true }),
  ).toBeVisible();
  await expect(drawer).toContainText(unavailableClaim);
  await expect(
    page.getByText(
      "Flagged as needs more data automatically because confidence is low.",
      { exact: true },
    ),
  ).toHaveCount(0);
});

test("required Diagnosis reads fail honestly with a retry instead of a false gate", async ({
  page,
}) => {
  await page.route(SNAPSHOTS_ROUTE, failRequiredRead);
  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);
  await expect(
    page.getByText("Something went wrong", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByText(/A completed site crawl is required/),
  ).toHaveCount(0);

  await page.unroute(SNAPSHOTS_ROUTE, failRequiredRead);
  await page.route(PROJECT_ROUTE, failRequiredRead);
  await page.goto(`/p/${E2E_PROJECT_ID}/diagnosis`);
  await expect(
    page.getByText("Something went wrong", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(
    page.getByText(/A complete ICP context is required/),
  ).toHaveCount(0);
});

test("a status-poll outage keeps the active run fenced until retry succeeds", async ({
  page,
}) => {
  const envelope = diagnosisFindingsEnvelopeFixture();
  const completedRun = envelope.meta.latestRun;
  if (completedRun === null) throw new Error("Diagnosis run fixture is missing");
  const runningRun = {
    ...completedRun,
    status: "running" as const,
    resultRef: null,
    completedAt: null,
  };
  let completed = false;
  let pollRequests = 0;

  await page.route(FINDINGS_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...envelope,
        meta: {
          ...envelope.meta,
          latestRun: completed ? completedRun : runningRun,
        },
      }),
    });
  });
  await page.route(RUN_STATUS_ROUTE, async (route) => {
    pollRequests += 1;
    if (pollRequests <= 2) {
      await failRequiredRead(route);
      return;
    }
    completed = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: completedRun }),
    });
  });

  await openDiagnosis(page);
  await expect(
    page.getByText(
      "Run status is temporarily unavailable. This run stays locked until its status can be checked.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: /Diagnosis running/ }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("button", { name: "Re-run diagnosis" }),
  ).toBeEnabled();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Run status is temporarily unavailable. This run stays locked until its status can be checked.",
      { exact: true },
    ),
  ).toHaveCount(0);
});

test("domain and severity filters intersect over the loaded canonical findings", async ({
  page,
}) => {
  const technical = diagnosisFindingFixture();
  const content = diagnosisFindingFixture({
    id: "00000000-0000-4000-8000-000000000222",
    ruleId: "CONTENT-COVERAGE-001",
    domain: "content_intent",
    severity: "low",
    summary: "A priority topic has thin coverage.",
  });
  await serveFindings(
    page,
    diagnosisFindingsEnvelopeFixture([technical, content]),
  );
  await openDiagnosis(page);

  const evidenceControls = await page
    .getByRole("button", { name: "View evidence (1)" })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-controls")),
    );
  expect(evidenceControls).not.toContain(null);
  expect(new Set(evidenceControls).size).toBe(evidenceControls.length);

  await expect(page.getByText("2 of 2 findings", { exact: true })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Domain", exact: true })
    .selectOption("content_intent");
  await expect(
    page.getByRole("article", { name: "Thin topic coverage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "HTTP status errors" }),
  ).toHaveCount(0);

  await page
    .getByRole("combobox", { name: "Severity", exact: true })
    .selectOption("high");
  await expect(
    page.getByText("No findings match these filters.", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "Severity", exact: true })
    .selectOption("low");
  await expect(
    page.getByRole("article", { name: "Thin topic coverage" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("2 of 2 findings", { exact: true })).toBeVisible();
});

test("Diagnosis evidence and filter chrome localize to zh-CN", async ({ page }) => {
  await openDiagnosis(page);
  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(
    page.getByRole("combobox", { name: "诊断域", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "严重度筛选", exact: true }),
  ).toBeVisible();
  const finding = page.getByRole("article", { name: "HTTP 状态错误" });
  await finding.getByRole("button", { name: "查看证据（1）" }).click();
  const drawer = page.getByRole("dialog", {
    name: "从诊断发现追溯到原始来源",
  });
  await expect(
    drawer.getByText("站点抓取", { exact: true }).first(),
  ).toBeVisible();
  await expect(drawer.getByText("可用", { exact: true })).toBeVisible();
  await expect(drawer.getByText("支持", { exact: true })).toBeVisible();
  await expect(
    drawer.getByRole("heading", { name: "我们确切知道什么" }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 1920, height: 1080 },
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
] as const) {
  test(`Diagnosis evidence is accessible and rendered at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openDiagnosis(page);
    const layoutColumns = await page
      .locator("[data-diagnosis-layout]")
      .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    const findingColumns = await page
      .locator("[data-finding-row]")
      .first()
      .evaluate((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns,
        minHeight: Number.parseFloat(getComputedStyle(element).minHeight),
      }));
    if (viewport.width > 960) {
      expect(layoutColumns.trim().split(/\s+/)).toHaveLength(2);
      expect(findingColumns.columns.trim().split(/\s+/)).toHaveLength(3);
      expect(findingColumns.minHeight).toBeGreaterThanOrEqual(158);
    } else {
      expect(layoutColumns.trim().split(/\s+/)).toHaveLength(1);
      expect(findingColumns.columns.trim().split(/\s+/)).toHaveLength(1);
    }

    const pageA11y = await new AxeBuilder({ page })
      .include("#main-content")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      pageA11y.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      ),
    ).toEqual([]);

    await page.evaluate(() => {
      document.querySelector("nextjs-portal")?.remove();
      window.scrollTo(0, 0);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.screenshot({
      path: `/tmp/signalframe-diagnosis-${viewport.width}-page.png`,
      fullPage: true,
    });

    await page.getByRole("button", { name: "View evidence (1)" }).click();
    const drawer = page.locator("[data-evidence-drawer]");
    await expect(drawer).toBeVisible();
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox?.width).toBeCloseTo(
      viewport.width <= 480 ? viewport.width : 570,
      2,
    );
    const drawerA11y = await new AxeBuilder({ page })
      .include("[data-evidence-drawer]")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      drawerA11y.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious",
      ),
    ).toEqual([]);
    await page.evaluate(() => {
      document.querySelector("nextjs-portal")?.remove();
      window.scrollTo(0, 0);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.screenshot({
      path: `/tmp/signalframe-diagnosis-${viewport.width}-drawer.png`,
      fullPage: false,
    });
  });
}
