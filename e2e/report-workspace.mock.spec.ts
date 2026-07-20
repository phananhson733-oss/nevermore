import { expect, test, type Page, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  type CriticalFlowApiState,
} from "./mock-api.ts";

const NOW = "2026-07-18T12:00:00.000Z";
const REPORT_ROUTE = `**/api/mvp/projects/${E2E_PROJECT_ID}/report**`;

let api: CriticalFlowApiState;

function canonicalReportFixture() {
  const finding = (
    id: string,
    summary: string,
    severity: "critical" | "high" | "medium" | "low",
  ) => ({
    id,
    ruleId: `RULE-${id}`,
    domain: "technical_seo",
    titleKey: "finding.tech.http_status",
    summary,
    summaryLocale: "en",
    severity,
    confidence: "high",
    reviewState: "confirmed",
    active: true,
    subjectRefs: [],
    evidence: [],
  });
  const action = (
    id: string,
    title: string,
    priorityBand: "critical" | "high" | "medium" | "low",
    roadmapLane: "now" | "next" | "later",
  ) => ({
    id,
    findingId: id === "action-later-first" ? "finding-first" : "finding-second",
    title,
    description: `${title} canonical description.`,
    contentLocale: "en",
    priorityBand,
    roadmapLane,
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: `${title} canonical outcome.`,
  });

  return {
    project: {
      id: E2E_PROJECT_ID,
      clientName: "Canonical Client",
      projectName: "Canonical customer report",
      stage: "planning",
      site: {
        id: "00000000-0000-4000-8000-000000000043",
        origin: "https://example.test",
        host: "example.test",
        marketCodes: ["US"],
        languageCodes: ["en", "zh-CN"],
      },
      contextStatus: "complete",
      currentIcpProfileVersion: 1,
      defaultDeliveryLocale: "en",
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    },
    outputLocale: "fr-FR",
    generatedAt: NOW,
    coverage: {
      overall: "partial",
      domains: {
        technical_seo: "complete",
        search_performance: "partial",
        content_intent: "complete",
        conversion_journey: "partial",
        geo_ai: "complete",
      },
      limitations: ["Canonical coverage limitation."],
    },
    // This order deliberately disagrees with severity and lane order. The UI
    // must render the server projection verbatim instead of re-prioritizing it.
    findings: [
      finding("finding-first", "Canonical low finding first.", "low"),
      finding("finding-second", "Canonical critical finding second.", "critical"),
    ],
    actions: [
      action("action-later-first", "Canonical later action first", "low", "later"),
      action("action-now-second", "Canonical now action second", "high", "now"),
    ],
    artifacts: [
      {
        id: "artifact-ready",
        actionId: "action-later-first",
        artifactType: "technical_ticket",
        status: "ready",
        outputLocale: "zh-CN",
        currentRevision: 7,
        validationState: "valid",
        updatedAt: NOW,
      },
    ],
    methodology: "Frozen canonical methodology delivery copy.",
    limitations: ["Canonical report limitation."],
  };
}

async function serveCanonicalReport(page: Page): Promise<void> {
  await page.route(REPORT_ROUTE, async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: canonicalReportFixture() }),
    });
  });
}

async function openReport(page: Page): Promise<void> {
  await page.goto(`/p/${E2E_PROJECT_ID}/report?outputLocale=fr-FR`);
  await expect(
    page.getByRole("heading", { name: "Canonical customer report" }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  api = await installCriticalFlowApi(page);
  await serveCanonicalReport(page);
});

for (const width of [1440, 1920] as const) {
  test(`desktop ${width}px renders an editorial report beside a sticky manifest rail`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openReport(page);

    const workspace = page.locator("[data-report-workspace]");
    const reportDocument = page.locator("[data-report-document]");
    const rail = page.locator("[data-report-manifest-rail]");
    const documentBox = await reportDocument.boundingBox();
    const railBox = await rail.boundingBox();

    expect(documentBox).not.toBeNull();
    expect(railBox).not.toBeNull();
    expect(documentBox!.x + documentBox!.width).toBeLessThanOrEqual(railBox!.x);
    await expect(workspace).toHaveCSS("display", "grid");
    await expect(rail).toHaveCSS("position", "sticky");

    await expect(
      reportDocument.locator("[data-report-section-number]"),
    ).toHaveText(["01", "02", "03", "04", "05"]);

    const findings = await reportDocument
      .locator("[data-report-finding-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-report-finding-id")));
    expect(findings).toEqual(["finding-first", "finding-second"]);

    const actions = await reportDocument
      .locator("[data-report-action-id]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-report-action-id")));
    expect(actions).toEqual(["action-later-first", "action-now-second"]);
    await expect(
      reportDocument.getByText("Action language: en", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      reportDocument.getByText("Deliverable language: zh-CN", { exact: true }),
    ).toBeVisible();
    await expect(
      reportDocument.getByText("Frozen canonical methodology delivery copy.", {
        exact: true,
      }),
    ).toBeVisible();

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
}

test("the manifest rail collapses below the complete report on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReport(page);

  const workspace = page.locator("[data-report-workspace]");
  const reportDocument = page.locator("[data-report-document]");
  const rail = page.locator("[data-report-manifest-rail]");
  const documentBox = await reportDocument.boundingBox();
  const railBox = await rail.boundingBox();

  await expect(workspace).toHaveCSS("display", "grid");
  await expect(rail).toHaveCSS("position", "static");
  expect(documentBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(Math.abs(documentBox!.x - railBox!.x)).toBeLessThanOrEqual(1);
  expect(railBox!.y).toBeGreaterThan(documentBox!.y + documentBox!.height);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("export polling populates the rail, while print removes all chrome and keeps canonical sections linear", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openReport(page);

  const rail = page.locator("[data-report-manifest-rail]");
  await rail.getByRole("button", { name: "Client bundle", exact: true }).click();
  await expect.poll(() => api.exportRequests.length).toBe(1);
  expect(api.exportRequests[0]).toEqual({
    kind: "client_bundle",
    outputLocale: "fr-FR",
  });
  await expect(
    rail.getByRole("heading", { name: "Export manifest" }),
  ).toBeVisible();
  await expect(rail.getByText("sha256:e2e-export", { exact: true })).toBeVisible();
  await expect(
    rail.getByRole("link", { name: "Download client bundle" }),
  ).toHaveAttribute("href", "/mock-download/client.zip");

  await page.emulateMedia({ media: "print" });

  await expect(page.locator("[data-app-shell-sidebar]")).toBeHidden();
  await expect(page.locator("[data-app-shell-topbar]")).toBeHidden();
  await expect(page.locator("[data-report-controls]")).toBeHidden();
  await expect(rail).toBeHidden();

  const workspace = page.locator("[data-report-workspace]");
  const reportDocument = page.locator("[data-report-document]");
  await expect(workspace).toHaveCSS("display", "block");
  await expect(reportDocument).toBeVisible();
  for (const heading of [
    "Data coverage",
    "Findings",
    "30 / 60 / 90 plan",
    "Deliverables",
    "Methodology",
  ]) {
    await expect(
      reportDocument.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }

  const sectionTops = await reportDocument
    .locator("[data-report-section]")
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
  expect(sectionTops).toEqual([...sectionTops].sort((left, right) => left - right));
});
