// @input  -- isolated local server, sealed fixture identity and synthetic v10 API envelope
// @output -- browser evidence for latest windows, provisional data and exact-filter links
// @pos    -- local mock E2E only; does not verify Google provider responses or visit GSC

import { expect, test, type Page } from "@playwright/test";

import { seal } from "../src/lib/auth/sealed-cookie";
import {
  CURRENT_END,
  CURRENT_START,
  PREVIOUS_END,
  PREVIOUS_START,
  SYNTHETIC_PAGE,
  SYNTHETIC_PAIR_QUERY,
  SYNTHETIC_PROPERTY,
  SYNTHETIC_QUERY,
  syntheticDailyBriefing,
} from "./fixtures/daily-briefing";

const TEST_COOKIE_KEY = "cd".repeat(32);
process.env.TOKEN_ENCRYPTION_KEY = TEST_COOKIE_KEY;
const LOCAL_ORIGIN = `http://127.0.0.1:${process.env.MARKETING_E2E_PORT ?? "3001"}`;
const KNOWN_SHELL_REQUESTS = new Set([
  "GET /api/auth/profile", "GET /api/auth/session",
  "GET /api/credits/balance", "GET /api/credits/ledger",
  "POST /api/consent",
]);

test.use({ timezoneId: "Asia/Shanghai", locale: "en-US", viewport: { width: 1440, height: 1100 } });

async function openSyntheticBriefing(page: Page, partial = false) {
  test.info().annotations.push({ type: "evidence-tier", description: "Local synthetic API fixture; no real provider or GSC website verification." });
  const envelope = await syntheticDailyBriefing(partial);
  expect(envelope.run.schemaVersion).toBe("daily_search_briefing.v10");
  expect(envelope.result.verification?.websiteChecked).toBe(false);
  expect(envelope.result.verification?.withheldCount).toBe(0);
  const calls = { briefing: 0, properties: 0, unexpected: [] as string[], external: [] as string[], pageErrors: [] as string[] };
  page.on("pageerror", (error) => calls.pageErrors.push(error.message));
  await page.context().addCookies([
    { name: "gg_id", value: seal("gg_id", { sub: "synthetic-briefing-e2e" }, 3_600), domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
    { name: "gg_sites", value: seal("gg_sites", { properties: [SYNTHETIC_PROPERTY], total: 1 }, 3_600), domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  // The standalone server also starts under env -i in playwright.config.ts.
  // This browser guard denies external traffic and any unhandled local API.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== LOCAL_ORIGIN) {
      calls.external.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (!url.pathname.startsWith("/api/")) {
      await route.fallback();
      return;
    }
    const id = `${request.method()} ${url.pathname}`;
    if (id === "POST /api/tools/gsc-properties") {
      calls.properties += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {
        properties: [SYNTHETIC_PROPERTY], propertyTotal: 1,
        brandCandidates: { [SYNTHETIC_PROPERTY]: ["synthetic-brand"] },
      } }) });
      return;
    }
    if (id === "POST /api/tools/daily-search-briefing") {
      calls.briefing += 1;
      expect(request.postDataJSON()).toEqual({ property: SYNTHETIC_PROPERTY, brandTerms: ["synthetic-brand"], brandTermsConfirmed: true });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: envelope }) });
      return;
    }
    if (!KNOWN_SHELL_REQUESTS.has(id)) calls.unexpected.push(id);
    await route.abort("blockedbyclient");
  });
  await page.goto("/tools/daily-search-briefing");
  await page.getByRole("button", { name: "Necessary Only", exact: true }).click();
  await page.locator("#daily-briefing-brand-terms").fill("synthetic-brand");
  await page.locator('input[name="brandTermsConfirmed"]').check();
  await page.getByRole("button", { name: "Build today's briefing", exact: true }).click();
  await expect(page.locator("[data-reading-facts]")).toBeVisible();
  return { envelope, calls };
}

function expectIsolated(calls: Awaited<ReturnType<typeof openSyntheticBriefing>>["calls"]) {
  expect(calls.briefing).toBe(1);
  expect(calls.properties).toBeGreaterThanOrEqual(1);
  expect(calls.unexpected).toEqual([]);
  expect(calls.external).toEqual([]);
  expect(calls.pageErrors).toEqual([]);
}

test("synthetic latest 24 hours retain the eight delayed hours and display local times", async ({ page }) => {
  const { calls } = await openSyntheticBriefing(page, true);
  await expect(page.locator('[data-trend-period="24h"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-trend-metric="clicks"] strong')).toHaveText("1,634");
  await expect(page.locator('[data-trend-metric="impressions"] strong')).toHaveText("8,213");
  await expect(page.locator('[data-trend-metric="ctr"] strong')).toHaveText("19.9%");
  await expect(page.locator("[data-trend-window]")).toContainText("08/30/2026, 07:00 GMT+8");
  await expect(page.locator("[data-trend-window]")).toContainText("08/31/2026, 07:00 GMT+8");
  await expect(page.locator("[data-trend-window]")).toContainText("Asia/Shanghai");
  await expect(page.locator("[data-trend-chart] text").first()).toHaveText("08/30, 07:00");
  await page.locator("[data-trend-table] summary").click();
  const rows = page.locator("[data-trend-table] tbody tr");
  await expect(rows).toHaveCount(24);
  await expect(rows.first()).toContainText("08/30/2026, 07:00 GMT+8");
  await expect(rows.last()).toContainText("08/31/2026, 06:00 GMT+8");
  await expect(page.locator("[data-trend-table]")).not.toContainText("Unavailable");
  await page.locator("[data-trend-table] summary").click();
  await page.locator('[data-result-section="trend"]').evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.locator('[data-result-section="trend"]').screenshot({ path: test.info().outputPath("synthetic-latest-24h.png") });
  expectIsolated(calls);
});

test("synthetic newest partial PT date stays visible without change-based actions or prior comparisons", async ({ page }) => {
  const { envelope, calls } = await openSyntheticBriefing(page, true);
  expect(envelope.result.freshness).toMatchObject({ latestAvailableDate: CURRENT_END, status: "partial", comparisonEligible: false });
  expect(envelope.result.changes).toEqual([]);
  expect(envelope.result.actions).toEqual([]);
  expect(envelope.result.queryWatchlist.items.length).toBeGreaterThan(0);
  await expect(page.locator("[data-reading-facts]")).toContainText(`Latest available GSC date: ${CURRENT_END}`);
  await expect(page.locator("[data-comparison-withheld]")).toContainText("newest available GSC dates are still updating");
  await expect(page.locator("[data-action-link]")).toHaveCount(0);
  await expect(page.locator("[data-change]")).toHaveCount(0);
  await expect(page.locator("[data-observation-row]")).toHaveCount(envelope.result.queryWatchlist.items.length);
  await page.locator('[data-trend-period="7d"]').click();
  await expect(page.locator("[data-trend-window]")).toContainText(`${CURRENT_START} – ${CURRENT_END} (Pacific Time / PT)`);
  await page.locator("[data-trend-table] summary").click();
  await expect(page.locator("[data-trend-table] tbody tr")).toHaveCount(7);
  await expect(page.locator("[data-trend-table] tbody tr").last()).toContainText(`${CURRENT_END} (PT)`);
  const observation = page.locator("[data-observation-row]").filter({ hasText: SYNTHETIC_QUERY }).first();
  await observation.locator("[data-gsc-evidence] summary").click();
  await expect(observation.locator("[data-gsc-evidence]")).toContainText("Not compared");
  await expect(observation.locator("[data-gsc-evidence]")).not.toContainText("Clicks 48;");
  await page.locator("[data-reading-facts]").evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.locator("[data-reading-facts]").screenshot({ path: test.info().outputPath("synthetic-partial-reporting-dates.png") });
  expectIsolated(calls);
});

test("synthetic verified records preserve exact query versus query-page scope and actual GSC dates", async ({ page }) => {
  const { envelope, calls } = await openSyntheticBriefing(page);
  expect(envelope.result.verification?.verifiedCount).toBe(2);
  expect(envelope.result.changes.find((change) => change.query === SYNTHETIC_PAIR_QUERY)?.current.position).toBe(1.9);
  const cases = [
    { scope: "query", query: SYNTHETIC_QUERY, page: null, position: "4.0" },
    { scope: "query_page", query: SYNTHETIC_PAIR_QUERY, page: SYNTHETIC_PAGE, position: "1.9" },
  ] as const;
  for (const expected of cases) {
    const row = page.locator("[data-change]").filter({ hasText: expected.query }).first();
    await expect(row).toBeVisible();
    const evidence = row.locator(`[data-gsc-evidence][data-metric-scope="${expected.scope}"]`);
    await evidence.locator("summary").click();
    await expect(evidence.locator('[data-api-evidence="verified"]')).toBeVisible();
    await expect(evidence).toContainText(`average position ${expected.position}`);
    await expect(evidence).toContainText("API verification is not a completed website check.");
    for (const period of ["current", "previous"] as const) {
      const link = evidence.locator(`[data-gsc-period="${period}"]`);
      await expect(link).toBeVisible();
      const url = new URL((await link.getAttribute("href"))!);
      expect(url.origin).toBe("https://search.google.com");
      expect(url.pathname).toBe("/search-console/performance/search-analytics");
      expect(url.searchParams.get("resource_id")).toBe(SYNTHETIC_PROPERTY);
      expect(url.searchParams.get("query")).toBe(`!${expected.query}`);
      expect(url.searchParams.get("page")).toBe(expected.page === null ? null : `!${expected.page}`);
      expect(url.searchParams.get("start_date")).toBe((period === "current" ? CURRENT_START : PREVIOUS_START).replaceAll("-", ""));
      expect(url.searchParams.get("end_date")).toBe((period === "current" ? CURRENT_END : PREVIOUS_END).replaceAll("-", ""));
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    await row.screenshot({ path: test.info().outputPath(`synthetic-${expected.scope}-evidence.png`) });
  }
  expectIsolated(calls);
});
