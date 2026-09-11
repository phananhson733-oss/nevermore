import { expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

/** The mock chrome assertions in this file are written in English; the app's
 *  default UI locale is zh-CN, so the locale cookie has to be set explicitly. */
test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
});

test.beforeEach(async ({ page }) => {
  await installCriticalFlowApi(page);
});

/**
 * The workbench rail is off-canvas below `md` instead of the retired compact
 * horizontal strip, so this file no longer measures a 60px sticky nav. What it
 * keeps is the property that mattered: on a phone the shell must stay reachable
 * and must not push the document sideways, and the background navigation must
 * be unreachable by keyboard and AT while it is off screen.
 */
test("mobile project shell keeps the rail off-canvas, inert, and reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);

  const sidebar = page.locator("#wb-sidebar");
  const topbar = page.locator("[data-app-shell-topbar]");
  const projectSwitcher = page.getByRole("combobox", {
    name: "Switch project",
  });
  // `aria-controls` rather than the role+name: once the rail is open the
  // backdrop button carries the same "Close navigation" name.
  const menu = page.locator('button[aria-controls="wb-sidebar"]');

  await expect(page.getByText("signalframe", { exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: /New site/ })).toBeHidden();
  await expect(projectSwitcher).toBeVisible();
  await expect(projectSwitcher).toHaveValue(E2E_PROJECT_ID);
  await expect(projectSwitcher.locator("option")).toHaveCount(2);
  await expect(topbar).toHaveCSS("position", "sticky");

  // Closed: off canvas and out of the accessibility tree.
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  const closedBox = await sidebar.boundingBox();
  expect(closedBox?.x ?? 0).toBeLessThan(0);

  await menu.click();
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(
    sidebar.getByRole("navigation", { name: "Workbench sections" }),
  ).toBeVisible();
  await expect(sidebar.locator('[data-wb-nav="settings"]')).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/settings`,
  );

  const hasHorizontalOverflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const scrolledTopbarBox = await topbar.boundingBox();
  expect(scrolledTopbarBox?.y).toBe(0);
});

test("desktop project cockpit exposes the rail and the account chrome", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);

  // The 90-day program progress bar and the Help button left the chrome with
  // the legacy shell; the rail and its section links replaced them.
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.locator("#wb-sidebar")).toBeVisible();
  await expect(
    page.locator('button[aria-controls="wb-sidebar"]'),
  ).toBeHidden();
  await expect(page.locator('[data-wb-nav="settings"]')).toHaveAttribute(
    "href",
    `/p/${E2E_PROJECT_ID}/settings`,
  );
  await expect(
    page.getByRole("group", { name: "Switch language" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search \/ jump/ })).toBeVisible();
});
