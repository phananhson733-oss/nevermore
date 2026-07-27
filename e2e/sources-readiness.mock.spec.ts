import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  E2E_SNAPSHOT_PROVENANCE,
  installCriticalFlowApi,
  sourceSlot,
  type MockDataSnapshot,
} from "./mock-api.ts";

const API_BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const CAPTURED_AT = "2026-07-20T08:30:00.000Z";
const LONG_CHECKSUM = "0123456789abcdef".repeat(4);
const SNAPSHOT_IDS = {
  crawl: "00000000-0000-4000-8000-000000000101",
  gsc: "00000000-0000-4000-8000-000000000102",
  csv: "00000000-0000-4000-8000-000000000104",
} as const;

function snapshot(
  provider: "crawl" | "gsc" | "csv",
  availability: "available" | "partial",
  overrides: Partial<MockDataSnapshot> = {},
): MockDataSnapshot {
  const provenance = E2E_SNAPSHOT_PROVENANCE[provider];
  return {
    id: SNAPSHOT_IDS[provider],
    siteId: E2E_SITE_ID,
    provider,
    datasetKey: provenance.datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: provenance.methodVersion,
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
  const crawl = snapshot("crawl", "available");
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
      id: "00000000-0000-4000-8000-000000000111",
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

/** Every anchor below is English chrome, and the app's default UI locale is
 *  zh-CN (`packages/i18n/src/config.ts:6`), so the locale has to be selected
 *  rather than inherited — the same `sf_ui_locale` cookie `studio-first-paint`,
 *  `growth-map`, `audit-technical-vertical` and `sources-layout` already set.
 *  This is a test-side change only: the Sources surface is untouched. */
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
  await installCriticalFlowApi(page);
  await installSourcesProjection(page);
});

test("Sources derives customer readiness and exposes connector provenance", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  const readiness = page.getByRole("region", { name: "Source readiness" });
  // Customer readiness is explainable from the visible analysis connectors:
  // GSC is partial, GA4 has no snapshot, and hidden internal evidence cannot
  // inflate either the numerator or denominator.
  await expect(readiness).toContainText("0 / 2");
  await expect(readiness).toContainText("0%");
  await expect(readiness).toContainText("Connected");
  await expect(readiness).toContainText("2");
  await expect(readiness).toContainText("Usable");
  await expect(readiness).toContainText("0");
  await expect(readiness).toContainText("Partial");
  await expect(readiness).toContainText("1");
  await expect(readiness).toContainText("Unavailable");
  await expect(readiness).toContainText("1");
  await expect(readiness).not.toContainText("50%");

  const gap = page.getByRole("note", { name: "Coverage gap" });
  await expect(gap).toContainText("Search Console");
  await expect(gap).toContainText("Google Analytics 4");
  await expect(gap).not.toContainText("DataForSEO");

  const customerConnections = page.locator("[data-customer-connector-grid]");
  await expect(
    customerConnections.locator("[data-customer-connector-card]"),
  ).toHaveCount(3);
  const gsc = customerConnections.getByRole("region", {
    name: "Search Console",
  });
  await expect(gsc).toContainText("Live");
  await expect(gsc).toContainText("Latest immutable snapshot");
  await expect(gsc).toContainText("gsc.page_query_daily.v1");
  await expect(gsc).toContainText("0.2.0");
  await expect(gsc).toContainText("gsc.search_analytics.v1");
  await expect(gsc).toContainText("Jun 1, 2026 – Jun 30, 2026");
  await expect(gsc).toContainText("42");
  await expect(gsc).toContainText("0123456789ab…89abcdef");
  await expect(gsc).not.toContainText(LONG_CHECKSUM);

  const ga4 = page.getByRole("region", { name: "Google Analytics 4" });
  await expect(ga4).toContainText("No snapshot yet");
  await expect(ga4).toContainText("Provenance is unavailable until a snapshot is captured.");
  await expect(ga4).not.toContainText("Dataset");
  await expect(ga4).not.toContainText("Checksum");

  await expect(page.getByRole("main")).not.toContainText("Site crawl");
  await expect(page.getByRole("main")).not.toContainText("CSV upload");
  await expect(page.getByRole("main")).not.toContainText("DataForSEO");

  const footline = page.getByRole("contentinfo", {
    name: "Snapshot provenance policy",
  });
  await expect(footline).toContainText("1 immutable snapshot");
  await expect(footline).toContainText("Credentials are never rendered");
  await expect(page.getByText("credential-must-never-render")).toHaveCount(0);

  await expect(
    gsc.locator('[data-testid="source-provenance-dynamic"]'),
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

/**
 * The readiness block is a `<dl>`, and until `a538fe3` each of its `<div>`
 * wrappers held a `<progress>` alongside the `<dt>`/`<dd>` pair — an axe
 * `definition-list` violation at serious impact.
 *
 * Nothing in the mock suite looked: this spec had no axe scan at all, and the
 * block only renders once source data exists, so the defect needed the full
 * serial `test:e2e:real` run to surface (stop gate §17.2). The scan is scoped
 * to the region so it fails for this block's own structure and not for
 * unrelated drift elsewhere on Sources.
 */
test("Sources readiness exposes no blocking axe violations in its definition list", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  await expect(
    page.getByRole("region", { name: "Source readiness" }),
  ).toContainText("0 / 2");
  // Exactly one `main` landmark — the shell's (`layout.tsx:187`). No axe scan
  // here can report a duplicate: the scans select WCAG tags and keep only
  // critical/serious, while `landmark-no-duplicate-main` is best-practice at
  // moderate (measured — stop gate §17.6c). Asserted in this spec because it
  // is one of the few with a fixture that renders the screen for real.
  await expect(page.getByRole("main")).toHaveCount(1);

  const results = await new AxeBuilder({ page })
    .include('[aria-label="Source readiness"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map(
      (v) =>
        `${v.id} (${v.impact}) @ ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
  expect(blocking).toEqual([]);
});
