import { expect, test, type Page } from "@playwright/test";

import { seal } from "../src/lib/auth/sealed-cookie";

const TEST_COOKIE_KEY = "cd".repeat(32);
process.env.TOKEN_ENCRYPTION_KEY = TEST_COOKIE_KEY;
const LOCAL_ORIGIN = `http://127.0.0.1:${process.env.MARKETING_E2E_PORT ?? "3001"}`;
const PROPERTIES_API = "POST /api/tools/gsc-properties";
const EXISTING_SITE = "sc-domain:acme.test";
const ADDED_SITE = "https://new-site.test/blog/";
const THIRD_SITE = "sc-domain:third.test";
const BRAND_CANDIDATES: Record<string, string[]> = {
  [EXISTING_SITE]: ["acme"],
  [ADDED_SITE]: ["new site"],
  [THIRD_SITE]: ["third"],
};
const KNOWN_SHELL_REQUESTS = new Set([
  "GET /api/auth/profile",
  "GET /api/auth/session",
  "GET /api/credits/balance",
  "GET /api/credits/ledger",
]);

function freshSites(properties: string[]) {
  return {
    data: {
      properties,
      propertyTotal: properties.length,
      brandCandidates: Object.fromEntries(
        properties.map((property) => [property, BRAND_CANDIDATES[property]]),
      ),
    },
  };
}

async function connect(page: Page, properties: string[]): Promise<void> {
  // These sealed fixtures contain only a fictional identity and property list.
  // No Google token is installed, and the standalone server has no provider keys.
  await page.context().addCookies([
    {
      name: "gg_id",
      value: seal("gg_id", { sub: "gsc-refresh-e2e-user" }, 3_600),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "gg_sites",
      value: seal("gg_sites", { properties, total: properties.length }, 3_600),
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function installGuard(
  page: Page,
  responses: { status: number; body: unknown }[],
) {
  const evidence = {
    refreshPosts: 0,
    consentPosts: 0,
    unexpected: [] as string[],
    externalRequests: [] as string[],
  };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === LOCAL_ORIGIN) {
      await route.fallback();
      return;
    }
    evidence.externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
    await route.abort("blockedbyclient");
  });
  // Every API is intercepted: only site-list and local consent fixtures are fulfilled.
  // Logout, OAuth, report generation and unknown APIs never reach the server.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== LOCAL_ORIGIN) {
      evidence.externalRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    const id = `${request.method()} ${url.pathname}`;
    if (id === "POST /api/consent") {
      evidence.consentPosts += 1;
      expect(request.postDataJSON().categories).toEqual([
        { category: "necessary", status: "accepted" },
        { category: "analytics", status: "rejected" },
        { category: "marketing", status: "rejected" },
      ]);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ data: { recorded: false, reason: "persistence_not_configured" } }),
      });
      return;
    }
    if (id === PROPERTIES_API) {
      const response = responses[evidence.refreshPosts++];
      if (response) {
        await route.fulfill({
          status: response.status,
          contentType: "application/json",
          body: JSON.stringify(response.body),
        });
        return;
      }
    }
    if (!KNOWN_SHELL_REQUESTS.has(id)) evidence.unexpected.push(id);
    await route.abort("blockedbyclient");
  });
  return evidence;
}

test("中文页面无需重新登录即可获取新增站点，刷新失败后可重试且保留当前输入", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1280 });
  await connect(page, [EXISTING_SITE]);
  const evidence = await installGuard(page, [
    { status: 200, body: freshSites([EXISTING_SITE, ADDED_SITE]) },
    { status: 503, body: { error: { code: "gsc_temporarily_unavailable" } } },
    { status: 200, body: freshSites([EXISTING_SITE, ADDED_SITE, THIRD_SITE]) },
  ]);
  await page.goto("/zh/tools/daily-search-briefing");
  const panel = page.locator("#daily-briefing-tool");
  const property = panel.getByRole("combobox", { name: "Search Console 站点" });
  const brands = panel.getByLabel("品牌词（CTR 机会所需）");
  const confirmed = panel.getByRole("checkbox");
  const refresh = panel.getByRole("button", { name: "刷新站点", exact: true });

  await expect(property.locator("option")).toHaveText(["acme.test", "new-site.test/blog"]);
  await expect(property).toHaveValue(EXISTING_SITE);
  await expect(refresh).toBeEnabled();
  await property.selectOption(ADDED_SITE);
  await expect(brands).toHaveValue("new site");
  await brands.fill("edited brand, second brand");
  await confirmed.check();

  await refresh.click();
  await expect(panel.getByRole("alert")).toHaveText(
    "暂时无法刷新站点列表，仍显示上次的列表，请稍后重试。",
  );
  await expect(property).toHaveValue(ADDED_SITE);
  await expect(brands).toHaveValue("edited brand, second brand");
  await expect(confirmed).toBeChecked();
  await expect(property.locator("option")).toHaveCount(2);

  await refresh.click();
  await expect(property.locator("option")).toHaveText([
    "acme.test", "new-site.test/blog", "third.test",
  ]);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(property).toHaveValue(ADDED_SITE);
  await expect(brands).toHaveValue("edited brand, second brand");
  await expect(confirmed).toBeChecked();
  await expect(panel.getByRole("button", { name: "生成今日简报", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(`${LOCAL_ORIGIN}/zh/tools/daily-search-briefing`);
  await page.getByRole("button", { name: "仅必要", exact: true }).click();
  await panel.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -100));
  await panel.screenshot({ path: testInfo.outputPath("zh-gsc-properties-refreshed.png") });
  expect(evidence.refreshPosts).toBe(3);
  expect(evidence.consentPosts).toBe(1);
  expect(evidence.unexpected).toEqual([]);
  expect(evidence.externalRequests).toEqual([]);
});

test("an authorized empty account can refresh and select its first site without reconnecting", async ({ page }) => {
  await connect(page, []);
  const evidence = await installGuard(page, [
    { status: 200, body: freshSites([]) },
    { status: 200, body: freshSites([ADDED_SITE]) },
  ]);
  await page.goto("/tools/daily-search-briefing");
  const panel = page.locator("#daily-briefing-tool");
  const refresh = panel.getByRole("button", { name: "Refresh sites", exact: true });
  await expect(panel.getByRole("heading", { name: "No verified property in this grant" })).toBeVisible();
  await expect(refresh).toBeEnabled();
  await expect.poll(() => evidence.refreshPosts).toBe(1);

  await refresh.click();
  await expect(panel.getByRole("combobox", { name: "Search Console property" })).toHaveValue(ADDED_SITE);
  await expect(panel.getByLabel("Brand terms (required for CTR opportunities)")).toHaveValue("new site");
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await expect(panel.getByRole("heading", { name: "No verified property in this grant" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Build today's briefing", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(`${LOCAL_ORIGIN}/tools/daily-search-briefing`);
  expect(evidence.refreshPosts).toBe(2);
  expect(evidence.unexpected).toEqual([]);
  expect(evidence.externalRequests).toEqual([]);
});

test("returning to the page refreshes after the throttle and clears a removed selection", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-31T00:00:00Z"));
  await connect(page, [EXISTING_SITE]);
  const evidence = await installGuard(page, [
    { status: 200, body: freshSites([EXISTING_SITE]) },
    { status: 200, body: freshSites([EXISTING_SITE, ADDED_SITE]) },
    { status: 200, body: freshSites([ADDED_SITE]) },
  ]);
  await page.goto("/tools/daily-search-briefing");
  const panel = page.locator("#daily-briefing-tool");
  const property = panel.getByRole("combobox", { name: "Search Console property" });
  const brands = panel.getByLabel("Brand terms (required for CTR opportunities)");
  const confirmed = panel.getByRole("checkbox");
  const refresh = panel.getByRole("button", { name: "Refresh sites", exact: true });
  await expect.poll(() => evidence.refreshPosts).toBe(1);
  await expect(refresh).toBeEnabled();
  await brands.fill("my edited brand");
  await confirmed.check();

  await page.clock.setFixedTime(new Date("2026-08-31T00:00:10Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(property.locator("option")).toHaveCount(1);
  expect(evidence.refreshPosts).toBe(1);

  await page.clock.setFixedTime(new Date("2026-08-31T00:00:31Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(property.locator("option")).toHaveText(["acme.test", "new-site.test/blog"]);
  await expect(property).toHaveValue(EXISTING_SITE);
  await expect(brands).toHaveValue("my edited brand");
  await expect(confirmed).toBeChecked();
  expect(evidence.refreshPosts).toBe(2);

  await refresh.click();
  await expect(property).toHaveValue("");
  await expect(property.locator("option")).toHaveText([
    "Choose a Search Console property", "new-site.test/blog",
  ]);
  await expect(brands).toHaveValue("");
  await expect(confirmed).not.toBeChecked();
  await expect(panel.getByRole("button", { name: "Build today's briefing", exact: true })).toBeDisabled();
  await property.selectOption(ADDED_SITE);
  await expect(brands).toHaveValue("new site");
  await expect(panel.getByRole("button", { name: "Build today's briefing", exact: true })).toBeEnabled();
  expect(evidence.refreshPosts).toBe(3);
  expect(evidence.unexpected).toEqual([]);
  expect(evidence.externalRequests).toEqual([]);
});
