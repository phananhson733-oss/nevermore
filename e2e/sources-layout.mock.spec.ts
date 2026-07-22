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
  });
}

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
});

test("Sources preserves the artifact grid at desktop and collapses without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.goto(`/p/${E2E_PROJECT_ID}/sources`);
  await page.waitForLoadState("networkidle");

  const cards = page.locator("[data-source-card]");
  await expect(cards).toHaveCount(5);
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
    page.locator('[data-source-card][data-provider="dataforseo"]'),
  ).toHaveCSS("border-top-style", "dashed");

  const badgeFontSize = await cards
    .first()
    .getByText("CR", { exact: true })
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(badgeFontSize).toBeGreaterThanOrEqual(12);

  const footline = page.locator("[data-source-footline]");
  await expect(footline).toHaveAttribute("data-readiness-state", "not-ready");
  await expect(
    footline.getByText("Evidence is ready for diagnosis", { exact: true }),
  ).toHaveCount(0);
  const reviewGaps = footline.getByRole("link", { name: "Review source gaps" });
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
          usableSource("crawl", 1),
          usableSource("gsc", 2),
          usableSource("ga4", 3),
          usableSource("csv", 4),
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
    page.locator("[data-source-readiness-lead]").getByText("4 / 4", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator("[data-source-readiness] progress").nth(1),
  ).toHaveAttribute("max", "4");
  const footline = page.locator("[data-source-footline]");
  await expect(footline).toHaveAttribute("data-readiness-state", "ready");
  await expect(
    footline.getByText("Evidence is ready for diagnosis", { exact: true }),
  ).toBeVisible();
  await expect(
    footline.getByRole("link", { name: "Review diagnostic coverage" }),
  ).toHaveAttribute("href", `/p/${E2E_PROJECT_ID}/diagnosis`);
});
