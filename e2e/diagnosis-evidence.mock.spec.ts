import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  E2E_PROJECT_ID,
  diagnosisFindingFixture,
  diagnosisFindingsEnvelopeFixture,
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
  await expect(page.getByRole("heading", { name: "Diagnosis", exact: true })).toBeVisible();
  await expect(
    page.getByRole("article", { name: "HTTP status errors" }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
});

test("each evidence trace exposes canonical provenance and Escape restores focus", async ({
  page,
}) => {
  await openDiagnosis(page);
  const finding = page.getByRole("article", { name: "HTTP status errors" });
  const trace = finding.getByRole("group", {
    name: "Evidence: The URL returned HTTP 500.",
  });

  await expect(trace.getByText("Site crawl", { exact: true })).toBeVisible();
  await expect(trace.getByText("Available", { exact: true })).toBeVisible();
  await expect(trace.getByText("Supports", { exact: true })).toBeVisible();
  await expect(trace.getByText("Grade A", { exact: true })).toBeVisible();
  await expect(trace).toContainText("Jul 18, 2026");
  await expect(trace).toContainText("The URL returned HTTP 500.");

  const toggle = trace.getByRole("button", { name: "Show evidence details" });
  await toggle.click();
  const details = trace.getByRole("region", {
    name: "Evidence details: The URL returned HTTP 500.",
  });
  await expect(details).toContainText("crawl_pages");
  await expect(details).toContainText("HTTP response inspection");
  await expect(details).toContainText("One captured response.");
  await expect(details).toContainText("https://example.test/product");

  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
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

  const partial = page.getByRole("group", { name: `Evidence: ${partialClaim}` });
  await expect(partial.getByText("Partial", { exact: true })).toBeVisible();
  await expect(partial.getByText("Context", { exact: true })).toBeVisible();

  const unavailable = page.getByRole("group", {
    name: `Evidence: ${unavailableClaim}`,
  });
  await expect(
    unavailable.getByText("Unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    unavailable.getByText("Contradicts", { exact: true }),
  ).toBeVisible();
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
    .getByRole("button", { name: "Show evidence details" })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-controls")),
    );
  expect(evidenceControls).not.toContain(null);
  expect(new Set(evidenceControls).size).toBe(evidenceControls.length);

  await expect(page.getByText("2 of 2 findings", { exact: true })).toBeVisible();
  await page.getByLabel("Domain").selectOption("content_intent");
  await expect(
    page.getByRole("article", { name: "Thin topic coverage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "HTTP status errors" }),
  ).toHaveCount(0);

  await page.getByLabel("Severity").selectOption("high");
  await expect(
    page.getByText("No findings match these filters.", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Severity").selectOption("low");
  await expect(
    page.getByRole("article", { name: "Thin topic coverage" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("2 of 2 findings", { exact: true })).toBeVisible();
});

test("Diagnosis evidence and filter chrome localize to zh-CN", async ({ page }) => {
  await openDiagnosis(page);
  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(page.getByLabel("诊断域")).toBeVisible();
  await expect(page.getByLabel("严重度筛选")).toBeVisible();
  const finding = page.getByRole("article", { name: "HTTP 状态错误" });
  const trace = finding.getByRole("group", {
    name: "证据：The URL returned HTTP 500.",
  });
  await expect(trace.getByText("站点抓取", { exact: true })).toBeVisible();
  await expect(trace.getByText("可用", { exact: true })).toBeVisible();
  await expect(trace.getByText("支持", { exact: true })).toBeVisible();
  await expect(trace.getByRole("button", { name: "展开证据详情" })).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
] as const) {
  test(`Diagnosis evidence is accessible and rendered at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openDiagnosis(page);
    await page
      .getByRole("button", { name: "Show evidence details" })
      .first()
      .click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const results = await new AxeBuilder({ page })
      .include("#main-content")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    );
    expect(blocking).toEqual([]);
    await page.evaluate(() => {
      document.querySelector("nextjs-portal")?.remove();
      window.scrollTo(0, 0);
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.screenshot({
      path: `/tmp/signalframe-diagnosis-${viewport.width}.png`,
      fullPage: true,
    });
  });
}
