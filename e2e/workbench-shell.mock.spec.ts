import { expect, test } from "@playwright/test";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

/**
 * The workbench shell (design §4.1–§4.3). Everything here is chrome the shell
 * itself owns: the fifteen pages and their one `<h1 data-wb-page-title>`, the
 * legacy-page affordance, the command palette, the artifact drawer, the mobile
 * rail, and the single real action (project deletion) that clears the store.
 */

const PAGES: readonly (readonly [string, string])[] = [
  ["overview", "Overview"],
  ["week", "This week"],
  ["keywords", "Keyword research"],
  ["keyword-library", "Keyword library"],
  ["competitors", "Competitor overview"],
  ["audit", "Technical audit"],
  ["visibility", "AI visibility"],
  ["profile", "Site profile"],
  ["data-sources", "Data sources"],
  ["links", "Backlinks"],
  ["content", "Content generation"],
  ["kb", "Fact knowledge base"],
  ["answers", "Answer pages / reports"],
  ["artifacts", "Artifact center"],
  ["settings", "Settings"],
];

/** URL segment → `data-wb-nav` page id (`WORKBENCH_SEGMENTS` inverted). */
const NAV_ID: Readonly<Record<string, string>> = {
  "keyword-library": "keywordLibrary",
  "data-sources": "dataSources",
};

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
  await installCriticalFlowApi(page);
});

test("every workbench page renders one data-wb-page-title h1 and its legacy links", async ({
  page,
}) => {
  test.slow(); // 15 navigations under dev on-demand compilation; the 45 s mock timeout is too tight
  for (const [segment, title] of PAGES) {
    await page.goto(`/p/${E2E_PROJECT_ID}/${segment}`);
    await expect(page.locator("h1[data-wb-page-title]")).toHaveCount(1);
    await expect(page.locator("h1[data-wb-page-title]")).toHaveText(title);
    await expect(
      page.locator(`[data-wb-nav="${NAV_ID[segment] ?? segment}"]`),
    ).toHaveAttribute("aria-current", "page");
  }
  await page.goto(`/p/${E2E_PROJECT_ID}/audit`);
  await page.locator('[data-wb-legacy-link="growth-map"]').click();
  // A client-side hop into a legacy route can sit behind an on-demand compile
  // under dev; wait on the navigation (test-timeout bound), not the 10 s expect.
  await page.waitForURL(new RegExp(`/p/${E2E_PROJECT_ID}/growth-map`));
});

test("english chrome carries no chinese and no untranslated key paths", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/audit`);
  // Workbench-owned chrome only: LocaleSwitch shows "简体中文" by design and the
  // project switcher echoes fixture names, so both are excluded.
  const chrome = await page
    .locator(
      "#wb-sidebar nav, [data-wb-site-card], [data-wb-drawer-button], [data-app-shell-topbar] kbd, h1[data-wb-page-title], [data-wb-legacy-link]",
    )
    .allInnerTexts();
  const text = chrome.join("\n");
  expect(text).not.toMatch(/[一-鿿]/);
  expect(text).not.toMatch(/workbench\./);
});

test("shell markup carries no inline styles (production CSP has no unsafe-inline)", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/audit`);
  await expect(page.locator("[data-app-shell] [style]")).toHaveCount(0);
  await expect(page.locator("[data-app-shell] style")).toHaveCount(0);
});

test("command palette: ⌘K opens, filter + enter navigate, focus returns to the opener", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  const opener = page.getByRole("button", { name: /Search \/ jump/ });
  await opener.focus();
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Search and jump" });
  await expect(dialog).toBeVisible();
  // The palette input is a combobox (aria-activedescendant drives the list), not
  // a plain textbox.
  await expect(dialog.getByRole("combobox")).toBeFocused();
  await dialog.getByRole("combobox").fill("audit");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp("/audit$"));
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog", { name: "Search and jump" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("artifact drawer traps focus and closes on Escape", async ({ page }) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await page.locator("[data-wb-drawer-button]").click();
  const dialog = page.getByRole("dialog", { name: /Artifacts/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused(); // only focusable → wraps to itself
  await expect(page.locator("#wb-app")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#wb-app")).not.toHaveAttribute("inert", "");
});

test("mobile sidebar is inert while closed and opens from the menu button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  const sidebar = page.locator("#wb-sidebar");
  await expect(sidebar).toHaveAttribute("inert", "");
  // Locate the toggle by its aria-controls: once open, the backdrop button carries
  // the same "Close navigation" name and a role query would hit strict mode.
  const menu = page.locator('button[aria-controls="wb-sidebar"]');
  await expect(menu).toHaveAccessibleName("Open navigation");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toHaveAccessibleName("Close navigation");
});

test("topbar project switcher is readable on the light chrome", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  // Regression guard: the switcher's CSS module was written for the dark sidebar.
  // `data-project-identity` is the stable hook; the class name is hashed.
  const name = page
    .locator("[data-app-shell-topbar] [data-project-identity] strong")
    .first();
  await expect(name).toBeVisible();
  const luminance = await name.evaluate((el) => {
    const [r, g, b] = getComputedStyle(el)
      .color.match(/\d+(\.\d+)?/g)!
      .map(Number);
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  });
  expect(luminance).toBeLessThan(0.3); // dark text on the cream topbar, not the old white-on-dark value
});

test("sidebar badge slots render nothing on an empty project and the storage hint stays hidden", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await expect(page.locator("[data-wb-badge]")).toHaveCount(0);
  // The topbar live region is always in the tree so an announcement is not lost;
  // on a healthy browser it says nothing.
  await expect(
    page.locator('[data-app-shell-topbar] [role="status"]'),
  ).toHaveText("");
});

test("deleting the project clears its workbench storage key", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/settings`);
  const key = `gg.workbench.v1.${E2E_PROJECT_ID}`;
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k) !== null, key))
    .toBe(true);
  // The only real action on the page; nothing else consumes this attribute, so
  // this spec is what pins it.
  const realAction = page.locator("[data-wb-real-action]");
  await expect(realAction).toHaveCount(1);
  await realAction.getByRole("button", { name: "Delete product" }).click();
  await realAction.getByRole("button", { name: "Confirm deletion" }).click();
  // `router.replace("/")` lands on whatever "/" resolves to under the mock
  // harness (login or an error page); neither mounts a WorkbenchProvider, so
  // the key must stay gone. Same dev-compile tolerance as above.
  await page.waitForURL((url) => !/\/settings$/.test(url.pathname));
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
});
