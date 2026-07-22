import { expect, test, type Page, type Route } from "@playwright/test";
import type { components } from "../packages/contracts/src/generated/openapi.ts";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

const NOW = "2026-07-20T09:00:00.000Z";
const REPORT_ROUTE = `**/api/mvp/projects/${E2E_PROJECT_ID}/report**`;

type ReportEvidenceFixture = components["schemas"]["Evidence"];

/**
 * Keep report mock evidence aligned with the OpenAPI contract even though the
 * current hooks-report client reads only a subset of these fields.
 */
function reportEvidenceFixture(
  index: number,
  claim: string,
  subjectValue: string,
): ReportEvidenceFixture {
  const uuidSuffix = String(index).padStart(12, "0");
  return {
    id: `30000000-0000-4000-8000-${uuidSuffix}`,
    sourceProvider: "crawl",
    origin: "direct_public",
    method: "observed",
    grade: "B",
    availability: "available",
    support: "supports",
    claim,
    subjectRefs: [{ type: "url", value: subjectValue }],
    observedAt: NOW,
    limitation: "This observation is bounded to the captured source window.",
    snapshotId: `10000000-0000-4000-8000-${uuidSuffix}`,
    collectionRunId: `20000000-0000-4000-8000-${uuidSuffix}`,
    analysisInvocationId: null,
  };
}

function finding(index: number) {
  return {
    id: `finding-${index}`,
    ruleId: `RULE-${index}`,
    domain: index % 2 === 0 ? "technical_seo" : "content_intent",
    titleKey: "finding.tech.http_status",
    summary: `Evidence-backed finding ${index} keeps its canonical client summary.`,
    summaryLocale: "en",
    severity: index === 1 ? "high" : "medium",
    confidence: "high",
    reviewState: "confirmed",
    active: true,
    subjectRefs: [
      {
        type: "url",
        value: `https://example.test/priority-${index}`,
      },
    ],
    evidence: [
      reportEvidenceFixture(
        index,
        `Observed signal ${index} from the canonical snapshot.`,
        `https://example.test/priority-${index}`,
      ),
    ],
  };
}

function action(index: number, roadmapLane: "now" | "next" | "later") {
  return {
    id: `action-${index}`,
    findingId: `finding-${Math.min(index, 5)}`,
    title: `Canonical roadmap action ${index}`,
    description: `Action ${index} preserves the server-authored delivery detail.`,
    contentLocale: "en",
    priorityBand: index === 1 ? "high" : "medium",
    roadmapLane,
    status: "planned",
    effort: "small",
    risk: "low",
    expectedOutcome: `Bounded expected outcome ${index}.`,
  };
}

function reportFixture(options?: {
  readonly empty?: boolean;
  readonly singleLane?: boolean;
  readonly longContent?: boolean;
}) {
  const empty = options?.empty === true;
  const longContent = options?.longContent === true;
  const roadmapLanes: readonly ("now" | "next" | "later")[] =
    options?.singleLane === true
      ? ["later", "later", "later", "later", "later", "later", "later"]
      : ["later", "now", "next", "later", "now", "later", "next"];
  return {
    project: {
      id: E2E_PROJECT_ID,
      clientName: "RelayOps",
      projectName: "Organic growth decision brief",
      stage: "planning",
      site: {
        id: "00000000-0000-4000-8000-000000000043",
        origin: "https://example.test",
        host: "example.test",
        marketCodes: ["US"],
        languageCodes: ["en"],
      },
      contextStatus: "complete",
      currentIcpProfileVersion: 1,
      defaultDeliveryLocale: "en",
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    },
    outputLocale: "en",
    generatedAt: NOW,
    coverage: {
      overall: empty ? "unavailable" : "partial",
      domains: {
        technical_seo: empty ? "missing" : "complete",
        search_performance: empty ? "missing" : "partial",
        content_intent: empty ? "missing" : "complete",
        conversion_journey: empty ? "missing" : "partial",
        geo_ai: empty ? "missing" : "qualitative",
      },
      limitations: [
        empty
          ? "No source snapshot is available yet."
          : "Coverage is bounded to the available source window.",
      ],
    },
    findings: empty
      ? []
      : [1, 2, 3, 4, 5].map((index) => {
          const canonicalFinding = finding(index);
          if (!longContent) return canonicalFinding;
          return {
            ...canonicalFinding,
            summary: `${canonicalFinding.summary} It also explains the affected journey and the bounded operator decision without replacing canonical evidence.`,
            evidence: [1, 2, 3].map((evidenceIndex) =>
              reportEvidenceFixture(
                index * 10 + evidenceIndex,
                `Canonical signal ${evidenceIndex} for finding ${index} remains traceable to its captured URL set.`,
                `https://example.test/priority-${index}-${evidenceIndex}`,
              ),
            ),
          };
        }),
    // The deliberately mixed order proves that visual lane placement does not
    // mutate the canonical server order in the DOM/export projection.
    actions: empty
      ? []
      : roadmapLanes.map((roadmapLane, index) =>
          action(index + 1, roadmapLane),
        ),
    artifacts: empty
      ? []
      : [
          {
            id: "artifact-ready",
            actionId: "action-2",
            artifactType: "metadata_rewrite",
            status: "ready",
            outputLocale: "en",
            currentRevision: 2,
            validationState: "valid",
            updatedAt: NOW,
          },
        ],
    methodology: "Frozen methodology based only on canonical observations.",
    limitations: empty ? ["No diagnosis has been completed."] : [],
  };
}

async function serveReport(
  page: Page,
  fixture: ReturnType<typeof reportFixture>,
): Promise<void> {
  await page.route(REPORT_ROUTE, async (route: Route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: fixture }),
    });
  });
}

async function openReport(page: Page): Promise<void> {
  await page.goto(`/p/${E2E_PROJECT_ID}/report`);
  await expect(
    page.getByRole("heading", { name: "Organic growth decision brief" }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
});

test("desktop uses a delivery-document cover, editorial findings, and a compact three-lane roadmap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await serveReport(page, reportFixture({ longContent: true }));
  await openReport(page);

  const workspace = page.locator("[data-report-workspace]");
  const reportDocument = page.locator("[data-report-document]");
  const cover = reportDocument.locator("[data-report-cover]");
  const coverSummary = reportDocument.locator("[data-report-cover-summary]");
  const sections = reportDocument.locator("[data-report-document-sections]");
  const coverBox = await cover.boundingBox();
  const summaryBox = await coverSummary.boundingBox();
  const sectionsBox = await sections.boundingBox();

  expect(coverBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  expect(sectionsBox).not.toBeNull();
  expect(coverBox!.height).toBeGreaterThanOrEqual(410);
  expect(summaryBox!.y).toBeGreaterThanOrEqual(coverBox!.y + coverBox!.height - 1);
  expect(sectionsBox!.y).toBeGreaterThanOrEqual(
    summaryBox!.y + summaryBox!.height - 1,
  );

  const findingRows = reportDocument.locator(
    "[data-report-findings-list] > article",
  );
  await expect(findingRows).toHaveCount(5);

  const layout = await workspace.evaluate((node) => {
    const documentNode = node.querySelector<HTMLElement>(
      "[data-report-document]",
    );
    const railNode = node.querySelector<HTMLElement>(
      "[data-report-manifest-rail]",
    );
    const findingsNode = node.querySelector<HTMLElement>(
      "[data-report-findings-list]",
    );
    if (documentNode === null || railNode === null || findingsNode === null) {
      throw new Error("Report layout landmarks are missing");
    }
    const workspaceBox = node.getBoundingClientRect();
    const documentBox = documentNode.getBoundingClientRect();
    const railBox = railNode.getBoundingClientRect();
    const findingsBox = findingsNode.getBoundingClientRect();
    return {
      documentShare: documentBox.width / workspaceBox.width,
      railShare: railBox.width / workspaceBox.width,
      findingsAspect: findingsBox.height / findingsBox.width,
      documentFits: documentNode.scrollWidth <= documentNode.clientWidth,
      railFits: railNode.scrollWidth <= railNode.clientWidth,
    };
  });
  // Keep a generous cross-platform cushion around the intended ~74/24 split;
  // Linux font metrics and scrollbar gutters must not turn this into a pixel test.
  expect(layout.documentShare).toBeGreaterThan(0.68);
  expect(layout.railShare).toBeLessThan(0.3);
  expect(layout.findingsAspect).toBeLessThan(2.75);
  expect(layout.documentFits).toBe(true);
  expect(layout.railFits).toBe(true);

  const firstEvidenceRows = findingRows
    .first()
    .locator("[data-report-evidence-row]");
  await expect(firstEvidenceRows).toHaveCount(3);
  const evidenceList = firstEvidenceRows.first().locator("xpath=..");
  const evidenceColumns = await evidenceList.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns,
  );
  const occupiedEvidenceColumns = evidenceColumns
    .trim()
    .split(/\s+/)
    .filter((track) => Number.parseFloat(track) > 1);
  expect(occupiedEvidenceColumns).toHaveLength(3);
  const evidenceRows = await firstEvidenceRows.evaluateAll((nodes) =>
    nodes.map((node) => ({
      fits: node.scrollWidth <= node.clientWidth,
    })),
  );
  expect(evidenceRows.every((row) => row.fits)).toBe(true);

  const roadmap = reportDocument.locator("[data-report-roadmap]");
  const roadmapColumns = await roadmap.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns,
  );
  expect(roadmapColumns.trim().split(/\s+/)).toHaveLength(3);

  const firstLaneBox = async (lane: "now" | "next" | "later") =>
    reportDocument
      .locator(`[data-report-roadmap-lane="${lane}"]`)
      .first()
      .boundingBox();
  const nowBox = await firstLaneBox("now");
  const nextBox = await firstLaneBox("next");
  const laterBox = await firstLaneBox("later");
  expect(nowBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(laterBox).not.toBeNull();
  expect(nowBox!.x).toBeLessThan(nextBox!.x);
  expect(nextBox!.x).toBeLessThan(laterBox!.x);

  const actionIds = await reportDocument
    .locator("[data-report-action-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-report-action-id")),
    );
  expect(actionIds).toEqual([
    "action-1",
    "action-2",
    "action-3",
    "action-4",
    "action-5",
    "action-6",
    "action-7",
  ]);

  const documentBox = await reportDocument.boundingBox();
  expect(documentBox).not.toBeNull();
  expect(documentBox!.height / documentBox!.width).toBeLessThan(5.5);
});

test("390px stacks the roadmap and export rail without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveReport(page, reportFixture());
  await openReport(page);

  const reportDocument = page.locator("[data-report-document]");
  const rail = page.locator("[data-report-manifest-rail]");
  const roadmap = reportDocument.locator("[data-report-roadmap]");
  const documentBox = await reportDocument.boundingBox();
  const railBox = await rail.boundingBox();
  const roadmapColumns = await roadmap.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns,
  );

  expect(documentBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(roadmapColumns.trim().split(/\s+/)).toHaveLength(1);
  expect(railBox!.y).toBeGreaterThan(documentBox!.y + documentBox!.height);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("one populated lane uses the report canvas without relabeling its actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await serveReport(page, reportFixture({ singleLane: true }));
  await openReport(page);

  const reportDocument = page.locator("[data-report-document]");
  const roadmap = reportDocument.locator("[data-report-roadmap]");
  await expect(roadmap).toHaveAttribute("data-report-active-lanes", "1");
  await expect(
    reportDocument.locator('[data-report-roadmap-legend-item="later"]'),
  ).toHaveCount(1);
  await expect(
    reportDocument.locator('[data-report-roadmap-lane="later"]'),
  ).toHaveCount(7);
  await expect(
    reportDocument.locator('[data-report-roadmap-lane="later"]').first(),
  ).toHaveAttribute("aria-label", "Later · Days 61–90");

  const roadmapColumns = await roadmap.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns,
  );
  expect(roadmapColumns.trim().split(/\s+/)).toHaveLength(2);

  const actionXs = await reportDocument
    .locator("[data-report-action-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().x)),
    );
  expect(new Set(actionXs).size).toBe(2);
  const laneValues = await reportDocument
    .locator("[data-report-roadmap-lane]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-report-roadmap-lane")),
    );
  expect(new Set(laneValues)).toEqual(new Set(["later"]));
});

test("390px overrides the compact single-lane desktop grid to one column", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveReport(page, reportFixture({ singleLane: true }));
  await openReport(page);

  const reportDocument = page.locator("[data-report-document]");
  const roadmap = reportDocument.locator("[data-report-roadmap]");
  await expect(roadmap).toHaveAttribute("data-report-active-lanes", "1");
  const roadmapColumns = await roadmap.evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns,
  );
  expect(roadmapColumns.trim().split(/\s+/)).toHaveLength(1);

  const actionXs = await reportDocument
    .locator("[data-report-action-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().x)),
    );
  expect(new Set(actionXs).size).toBe(1);

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
});

test("an empty canonical projection stays explicit and never invents report totals", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await serveReport(page, reportFixture({ empty: true }));
  await openReport(page);

  const reportDocument = page.locator("[data-report-document]");
  await expect(
    reportDocument.locator("[data-report-cover-summary]"),
  ).toHaveCount(0);
  await expect(reportDocument.locator("[data-report-finding-id]")).toHaveCount(0);
  await expect(reportDocument.locator("[data-report-action-id]")).toHaveCount(0);
  await expect(
    reportDocument.getByText("No report yet", { exact: true }),
  ).toBeVisible();
  await expect(
    reportDocument.getByText("No source snapshot is available yet.", {
      exact: true,
    }),
  ).toBeVisible();
});
