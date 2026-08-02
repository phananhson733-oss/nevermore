import { expect, test } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  E2E_SITE_ID,
  E2E_SNAPSHOT_PROVENANCE,
  installCriticalFlowApi,
  sourceSlot,
  type MockDataSnapshot,
} from "./mock-api.ts";

const BASE = `/api/mvp/projects/${E2E_PROJECT_ID}`;
const CAPTURE_DIR = process.env["SF_CAPTURE_DIR"];

type SourceProvider = Parameters<typeof sourceSlot>[0];

function usableSource(provider: SourceProvider, ordinal: number) {
  const suffix = String(ordinal).padStart(12, "0");
  const provenance = E2E_SNAPSHOT_PROVENANCE[provider];
  const latestSnapshot = {
    id: `10000000-0000-4000-8000-${suffix}`,
    siteId: E2E_SITE_ID,
    provider,
    datasetKey: provenance.datasetKey,
    schemaVersion: "0.2.0",
    methodVersion: provenance.methodVersion,
    capturedAt: "2026-07-18T12:00:00.000Z",
    sourceWindow: { start: null, end: null },
    availability: "available",
    limitation: "No known limitation.",
    rowCount: 12,
    checksum: ordinal.toString(16).padStart(2, "0").repeat(32),
  } satisfies MockDataSnapshot;

  return sourceSlot(provider, {
    id: `00000000-0000-4000-8000-${suffix}`,
    state: "available",
    connectedAt: "2026-07-18T12:00:00.000Z",
    latestSnapshot,
    latestMetricSummary:
      provider === "gsc"
        ? {
            provider: "gsc",
            landingPageCount: 12,
            clicks: 8,
            impressions: 1_240,
          }
        : provider === "ga4"
          ? {
              provider: "ga4",
              landingPageCount: 12,
              sessions: 96,
              keyEvents: null,
            }
          : null,
  });
}

/** The English anchor below needs an explicit locale: the app's default UI
 *  locale is zh-CN (`packages/i18n/src/config.ts:6`). */
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
  await installCriticalFlowApi(page);
});

test("Sources lays out only the three customer connectors without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  await page.waitForLoadState("networkidle");

  const cards = page.locator("[data-customer-connector-card]");
  await expect(cards).toHaveCount(3);
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
  const desktopGap = second!.x - (first!.x + first!.width);
  expect(desktopGap).toBeGreaterThanOrEqual(13);
  expect(desktopGap).toBeLessThanOrEqual(15);

  const readinessLead = await page
    .locator("[data-source-readiness-lead]")
    .boundingBox();
  const readinessGap = await page
    .locator("[data-source-readiness-gap]")
    .boundingBox();
  expect(readinessLead).not.toBeNull();
  expect(readinessGap).not.toBeNull();
  expect(Math.abs(readinessLead!.y - readinessGap!.y)).toBeLessThan(1);

  await expect(
    page.locator(
      '[data-customer-connector-card][data-connector-state="planned"]',
    ),
  ).toHaveCSS("border-top-style", "dashed");
  await expect(
    page.locator(
      '[data-customer-connector-card][data-provider="dataforseo"]',
    ),
  ).toHaveCount(0);

  await expect(page.getByRole("main")).not.toContainText("Site crawl");
  await expect(page.getByRole("main")).not.toContainText("CSV upload");
  await expect(page.getByRole("main")).not.toContainText("DataForSEO");

  const badgeFontSize = await cards
    .first()
    .getByText("GS", { exact: true })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(badgeFontSize).toBeGreaterThanOrEqual(12);

  const footline = page.locator("[data-source-footline]");
  await expect(footline).toHaveAttribute("data-readiness-state", "not-ready");
  await expect(
    footline.getByText("Customer analysis connections are ready", {
      exact: true,
    }),
  ).toHaveCount(0);
  const reviewGaps = footline.getByRole("link", {
    name: "Review connection gaps",
  });
  await expect(reviewGaps).toHaveAttribute("href", "#source-readiness");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  if (CAPTURE_DIR !== undefined) {
    await page.screenshot({
      path: `${CAPTURE_DIR}/sources-page-1920.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const mobileFirst = await cards.nth(0).boundingBox();
  const mobileSecond = await cards.nth(1).boundingBox();
  expect(mobileFirst).not.toBeNull();
  expect(mobileSecond).not.toBeNull();
  expect(Math.abs(mobileFirst!.x - mobileSecond!.x)).toBeLessThan(1);
  expect(mobileSecond!.y).toBeGreaterThan(
    mobileFirst!.y + mobileFirst!.height,
  );

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  if (CAPTURE_DIR !== undefined) {
    await page.screenshot({
      path: `${CAPTURE_DIR}/sources-page-390.png`,
      fullPage: true,
    });
  }

  await reviewGaps.click();
  await expect(page).toHaveURL(/#source-readiness$/);
  await expect(page.locator("#source-readiness")).toBeVisible();
});

test("Sources exposes the diagnosis CTA only when every enabled family is usable", async ({
  page,
}) => {
  await page.route(`**${BASE}/sources`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          sourceSlot("crawl"),
          usableSource("gsc", 2),
          usableSource("ga4", 3),
          sourceSlot("csv"),
          sourceSlot("dataforseo"),
        ],
      }),
    });
  });

  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);

  const coverage = page.locator("[data-source-readiness] [role='meter']");
  await expect(coverage).toHaveAttribute("aria-valuenow", "100");
  await expect(coverage).toContainText("100%");
  await expect(
    page.locator("[data-source-readiness-lead]").getByText("2 / 2", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator("[data-source-readiness] progress").nth(1),
  ).toHaveAttribute("max", "2");
  const footline = page.locator("[data-source-footline]");
  await expect(footline).toHaveAttribute("data-readiness-state", "ready");
  await expect(
    footline.getByText("Customer analysis connections are ready", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    footline.getByRole("link", { name: "Review analysis workspace" }),
  ).toHaveAttribute("href", `/p/${E2E_PROJECT_ID}/growth-map?object=pages`);
});
