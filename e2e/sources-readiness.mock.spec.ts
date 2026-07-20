import { expect, test, type Page, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installCriticalFlowApi,
  sourceSlot,
} from "./mock-api.ts";

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const CAPTURED_AT = "2026-07-20T08:30:00.000Z";
const LONG_CHECKSUM = "0123456789abcdef".repeat(4);

function snapshot(
  provider: "crawl" | "gsc" | "csv",
  availability: "available" | "partial",
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    id: `snapshot-${provider}`,
    provider,
    datasetKey: `${provider}.canonical.v1`,
    schemaVersion: "0.2.0",
    methodVersion: `${provider}.method.v1`,
    capturedAt: CAPTURED_AT,
    sourceWindow: { start: "2026-06-01", end: "2026-06-30" },
    availability,
    limitation: "Canonical fixture limitation.",
    rowCount: provider === "crawl" ? 12_345 : 42,
    checksum: LONG_CHECKSUM,
    ...overrides,
  };
}

async function json(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installSourcesProjection(page: Page): Promise<void> {
  const crawl = snapshot("crawl", "available", {
    datasetKey: "crawl.site_graph.v1",
    methodVersion: "crawl.fetch.v3",
  });
  const gsc = snapshot("gsc", "partial");
  const csv = snapshot("csv", "available");
  const sources = [
    sourceSlot("crawl", { latestSnapshot: crawl }),
    sourceSlot("gsc", {
      id: "source-gsc",
      state: "partial",
      connectedAt: CAPTURED_AT,
      latestSnapshot: gsc,
      externalRef: "sc-domain:example.test",
      credential: "credential-must-never-render",
    }),
    sourceSlot("ga4", {
      id: "source-ga4",
      state: "connected",
      connectedAt: CAPTURED_AT,
      latestSnapshot: null,
    }),
    sourceSlot("csv", {
      id: "source-csv",
      state: "available",
      connectedAt: CAPTURED_AT,
      latestSnapshot: csv,
    }),
    sourceSlot("dataforseo"),
  ];
  const history = [
    crawl,
    gsc,
    csv,
    snapshot("crawl", "available", {
      id: "snapshot-crawl-previous",
      capturedAt: "2026-07-19T08:30:00.000Z",
    }),
  ];

  await page.route(`**${API_BASE}/sources`, (route) =>
    json(route, { data: sources }),
  );
  await page.route(`**${API_BASE}/snapshots**`, (route) =>
    json(route, {
      data: history,
      meta: { nextCursor: null, hasNext: false, limit: 100 },
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
  await installSourcesProjection(page);
});

test("Sources derives readiness and exposes canonical immutable provenance", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  const readiness = page.getByRole("region", { name: "Source readiness" });
  // Readiness is intentionally scoped to enabled evidence families. The
  // disabled DataForSEO slot remains visible on the page, but it must not
  // dilute the actionable coverage denominator.
  await expect(readiness).toContainText("2 / 4");
  await expect(readiness).toContainText("50%");
  await expect(readiness).toContainText("Connected");
  await expect(readiness).toContainText("4");
  await expect(readiness).toContainText("Usable");
  await expect(readiness).toContainText("2");
  await expect(readiness).toContainText("Partial");
  await expect(readiness).toContainText("1");
  await expect(readiness).toContainText("Unavailable");
  await expect(readiness).toContainText("1");
  await expect(readiness).not.toContainText("83%");

  const gap = page.getByRole("note", { name: "Coverage gap" });
  await expect(gap).toContainText("Search Console");
  await expect(gap).toContainText("Google Analytics 4");
  await expect(gap).not.toContainText("DataForSEO");

  const crawl = page.getByRole("region", { name: "Site crawl" });
  await expect(crawl).toContainText("Live");
  await expect(crawl).toContainText("Latest immutable snapshot");
  await expect(crawl).toContainText("crawl.site_graph.v1");
  await expect(crawl).toContainText("0.2.0");
  await expect(crawl).toContainText("crawl.fetch.v3");
  await expect(crawl).toContainText("Jun 1, 2026 – Jun 30, 2026");
  await expect(crawl).toContainText("12,345");
  await expect(crawl).toContainText("0123456789ab…89abcdef");
  await expect(crawl).not.toContainText(LONG_CHECKSUM);

  const csv = page.getByRole("region", { name: "CSV upload" });
  await expect(csv).toContainText("Manual");

  const ga4 = page.getByRole("region", { name: "Google Analytics 4" });
  await expect(ga4).toContainText("No snapshot yet");
  await expect(ga4).toContainText("Provenance is unavailable until a snapshot is captured.");
  await expect(ga4).not.toContainText("Dataset");
  await expect(ga4).not.toContainText("Checksum");

  const footline = page.getByRole("contentinfo", {
    name: "Snapshot provenance policy",
  });
  await expect(footline).toContainText("4 immutable snapshots");
  await expect(footline).toContainText("Credentials are never rendered");
  await expect(page.getByText("credential-must-never-render")).toHaveCount(0);

  await expect(
    crawl.locator('[data-testid="source-provenance-dynamic"]'),
  ).toHaveCount(7);
});

test("Sources never fabricates provenance when every enabled source lacks a snapshot", async ({
  page,
}) => {
  await page.route(`**${API_BASE}/sources`, (route) =>
    json(route, {
      data: [
        sourceSlot("crawl", {
          state: "connected",
          latestSnapshot: null,
        }),
        sourceSlot("gsc"),
        sourceSlot("ga4"),
        sourceSlot("csv"),
        sourceSlot("dataforseo"),
      ],
    }),
  );
  await page.route(`**${API_BASE}/snapshots**`, (route) =>
    json(route, {
      data: [],
      meta: { nextCursor: null, hasNext: false, limit: 100 },
    }),
  );

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  const readiness = page.getByRole("region", { name: "Source readiness" });
  await expect(readiness).toContainText("Usable");
  await expect(readiness).toContainText("No usable snapshots yet");
  await expect(page.getByText("Latest immutable snapshot")).toHaveCount(0);
  await expect(page.getByText("Dataset", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Checksum", { exact: true })).toHaveCount(0);

  const footline = page.getByRole("contentinfo", {
    name: "Snapshot provenance policy",
  });
  await expect(footline).toContainText("0 immutable snapshots");
});
