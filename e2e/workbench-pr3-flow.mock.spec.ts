import { expect, test, type Locator, type Page } from "@playwright/test";
import { installCriticalFlowApi } from "./mock-api.ts";
import {
  clearSampleButton,
  loadSample,
  openView,
  prepareEnglishPage,
  PR3_VIEWS,
  readStored,
} from "./workbench-e2e.ts";
import { overlaps, sweep } from "./workbench-targets.ts";

/**
 * The PR-3 module flow and the page-wide gates only a served page can check
 * (T17 Steps 1, 2, 3, 4, 4c), plus the topbar geometry the sample state broke.
 */

const TOPBAR = "[data-app-shell-topbar]";
const TOPBAR_TARGETS = `${TOPBAR} :is(button, a[href], select)`;
const DIALOG_ROOT = ".wb-reset.fixed.inset-0.z-50";

async function settled(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
}

/* ------------------------------------------------------------------ *
 * Step 1: load the sample, see it, clear it, see the empty project.
 * ------------------------------------------------------------------ */

const EMPTY_TITLE = "Nothing to show on the overview yet";
const SAMPLE_GSC_FOOT = "These GSC rows come from sample data";

test("the sample loads into the overview's four cards and clearing it returns the empty project", async ({
  page,
}) => {
  await prepareEnglishPage(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openView(page, "overview");
  const values = page.locator("#main-content [data-wb-frame] .text-4xl");
  await expect(page.getByText(EMPTY_TITLE, { exact: true })).toBeVisible();

  await loadSample(page);
  await expect(values).toHaveCount(4);
  // Score, share and two counts: each starts with a digit, none is the dash.
  for (const index of [0, 1, 2, 3]) {
    await expect(values.nth(index)).toHaveText(/^\d/u);
  }
  await expect(page.getByText(SAMPLE_GSC_FOOT, { exact: true })).toBeVisible();
  await expect(page.getByText(EMPTY_TITLE, { exact: true })).toHaveCount(0);

  await clearSampleButton(page).click();
  const box = page.getByRole("dialog", { name: "Clear the sample data?" });
  await expect(box).toBeVisible();
  // Step 4: one Dialog root, with no inline style for a strict CSP.
  await expect(page.locator(DIALOG_ROOT)).toHaveCount(1);
  await expect(page.locator(DIALOG_ROOT).locator("[style], style")).toHaveCount(0);
  await box.getByRole("button", { name: "Clear sample", exact: true }).click();
  await expect(box).toHaveCount(0);

  await expect(page.getByText(EMPTY_TITLE, { exact: true })).toBeVisible();
  await expect(clearSampleButton(page)).toHaveCount(0);
  await expect(page.getByText(SAMPLE_GSC_FOOT, { exact: true })).toHaveCount(0);
  await expect(values.nth(0)).toHaveText("—");
  await expect(values.nth(1)).toHaveText("—");
  await expect.poll(async () => (await readStored(page))?.state.demo ?? null).toBe(false);
});

/* ------------------------------------------------------------------ *
 * Step 2: a failing /sources read degrades one row, not the page.
 * ------------------------------------------------------------------ */

const GSC_UNKNOWN_HINT =
  "The connection status could not be read. Unknown is not the same as not connected.";

function siteCardGscRow(page: Page): Locator {
  return page
    .locator("[data-wb-site-card] dt", { hasText: /^GSC$/u })
    .locator("xpath=following-sibling::dd[1]");
}

test("a 500 from /sources shows the site card's GSC row as unknown, with no error boundary", async ({
  page,
}) => {
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));
  await prepareEnglishPage(page);
  await page.setViewportSize({ width: 1280, height: 800 });

  // Control: the mock's gsc slot is disconnected, so the row normally says so.
  await openView(page, "overview");
  await expect(siteCardGscRow(page)).toHaveText("Not connected");
  await expect(siteCardGscRow(page)).not.toHaveAttribute("title", /./u);

  // Registered after the mock API, so it answers first.
  let failed = 0;
  await page.route(
    (url) => url.pathname.endsWith("/sources"),
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      failed += 1;
      await route.fulfill({
        status: 500,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Internal Server Error",
          status: 500,
          code: "INTERNAL_ERROR",
          detail: "e2e",
          requestId: "e2e",
        }),
      });
    },
  );
  await page.reload();
  await expect(page.locator("h1[data-wb-page-title]")).toHaveText("Overview");
  await expect(siteCardGscRow(page)).toHaveText("—");
  await expect(siteCardGscRow(page)).toHaveAttribute("title", GSC_UNKNOWN_HINT);
  expect(failed, "the failing route answered").toBeGreaterThan(0);
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  expect(uncaught).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * Steps 3, 4, 4c on each view with the sample loaded.
 * ------------------------------------------------------------------ */

/** Q30: frame copy is chrome, so on the English page it is English and never a key path. */
async function frameProblems(page: Page): Promise<{ readonly frames: number; readonly problems: readonly string[] }> {
  return page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll<HTMLElement>("#main-content [data-wb-frame]"));
    const problems = frames.flatMap((frame, index) => {
      const text = frame.innerText.trim();
      return [
        ...(text === "" ? [`${index}: empty`] : []),
        ...(/[㐀-鿿豈-﫿]/u.test(text) ? [`${index}: chinese`] : []),
        ...(/\bworkbench\.[a-z]/u.test(text) ? [`${index}: key path`] : []),
      ];
    });
    return { frames: frames.length, problems };
  });
}

/** Q34: every `aria-controls` names an element on the page. */
async function danglingControls(page: Page): Promise<{ readonly total: number; readonly missing: readonly string[] }> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("[aria-controls]"));
    const missing = nodes.flatMap((node) =>
      (node.getAttribute("aria-controls") ?? "")
        .split(/\s+/u)
        .filter((id) => id !== "" && document.getElementById(id) === null),
    );
    return { total: nodes.length, missing };
  });
}

test("each view's frame copy is English, its aria-controls resolve, and it carries no inline style", async ({
  page,
}) => {
  test.slow();
  await prepareEnglishPage(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadSample(page);
  let controls = 0;
  for (const view of PR3_VIEWS) {
    await openView(page, view);
    await page.waitForLoadState("networkidle");
    const { frames, problems } = await frameProblems(page);
    expect(frames, `${view}: frames`).toBeGreaterThan(0);
    expect(problems, `${view}: frame copy`).toEqual([]);
    const { total, missing } = await danglingControls(page);
    controls += total;
    expect(missing, `${view}: aria-controls without a target`).toEqual([]);
    await expect(page.locator("[data-app-shell] [style]"), `${view}: inline style`).toHaveCount(0);
    // /week has its own status in the report's artifact row; the topbar's is the one.
    await expect(page.locator(`${TOPBAR} [role="status"]`), `${view}: topbar status`).toHaveCount(1);
  }
  expect(controls, "aria-controls seen across the five views").toBeGreaterThan(0);

  // Control: the checker reports what it exists to catch.
  await page.evaluate(() => {
    const [first, second] = Array.from(document.querySelectorAll("#main-content [data-wb-frame]"));
    first?.append("中文");
    (second ?? first)?.append(" workbench.settings.title");
  });
  const injected = await frameProblems(page);
  expect(injected.problems.some((problem) => problem.endsWith("chinese"))).toBe(true);
  expect(injected.problems.some((problem) => problem.endsWith("key path"))).toBe(true);
});

/* ------------------------------------------------------------------ *
 * The topbar at every layout band, in both languages and both states.
 * ------------------------------------------------------------------ */

const COPY = {
  en: { load: "Load sample site", clear: "Clear sample", sampleChip: "Sample site", emptyChip: "Sample data" },
  "zh-CN": { load: "载入示例站点", clear: "清除示例", sampleChip: "示例站点", emptyChip: "示例数据" },
} as const;
type Locale = keyof typeof COPY;

const GEOMETRY_WIDTHS = [360, 390, 414, 639, 640, 767, 768, 900, 1023, 1024, 1279, 1280, 1440] as const;
const MD = 768;
const SM = 640;
const XL = 1280;
/** The topbar's first row (`h-14`), and the whole one-row header from `xl` up. */
const ROW_PX = 56;

async function prepareIn(page: Page, locale: Locale, sample: boolean): Promise<void> {
  await page.context().addCookies([{ name: "sf_ui_locale", value: locale, domain: "localhost", path: "/" }]);
  await installCriticalFlowApi(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await openView(page, "overview");
  if (!sample) return;
  await page.getByRole("button", { name: COPY[locale].load, exact: true }).click();
  await expect(page.locator(TOPBAR).getByRole("button", { name: COPY[locale].clear, exact: true })).toHaveCount(1);
}

/** Visible with a positive box, so "not rendered" can never pass a geometry check. */
async function boxOf(locator: Locator, what: string): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator, `${what} is visible`).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${what} has no box`);
  expect(box.width > 0 && box.height > 0, `${what} has a positive box (${box.width}x${box.height})`).toBe(true);
  return box;
}

async function expectTopbarFits(page: Page, locale: Locale, sample: boolean, width: number): Promise<void> {
  const at = `${locale} ${sample ? "sample" : "empty"} ${width}px`;
  await page.setViewportSize({ width, height: 844 });
  await settled(page);
  const topbar = page.locator(TOPBAR);
  const header = await boxOf(topbar, `${at}: topbar`);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    `${at}: horizontal overflow`,
  ).toBeLessThanOrEqual(0);

  const menu = topbar.locator('button[aria-controls="wb-sidebar"]');
  if (width < MD) {
    const box = await boxOf(menu, `${at}: menu button`);
    expect([box.width, box.height], `${at}: menu button size`).toEqual([44, 44]);
  } else {
    await expect(menu).toBeHidden();
  }
  const clear = topbar.getByRole("button", { name: COPY[locale].clear, exact: true });
  if (sample) {
    const box = await boxOf(clear, `${at}: clear sample`);
    if (width < MD) expect([box.width, box.height], `${at}: clear sample size`).toEqual([44, 44]);
  } else {
    await expect(clear).toHaveCount(0);
  }
  await boxOf(topbar.locator("select"), `${at}: project switcher`);
  await boxOf(topbar.locator("[data-wb-drawer-button]"), `${at}: artifacts`);
  if (width >= SM) await boxOf(topbar.locator('a[href="/new-project"]'), `${at}: new site`);
  if (width >= MD) await boxOf(topbar.locator("button:has(kbd)"), `${at}: search`);

  const chip = topbar.locator('[data-wb-topbar-row="1"] span[title]:not([data-wb-storage-compact])');
  await boxOf(chip, `${at}: sample chip`);
  await expect(chip).toHaveText(sample ? COPY[locale].sampleChip : COPY[locale].emptyChip);
  expect(
    await chip.evaluate((node) => node.scrollHeight <= node.clientHeight && node.scrollWidth <= node.clientWidth),
    `${at}: chip text on one line and unclipped`,
  ).toBe(true);

  const targets = (await sweep(page, TOPBAR_TARGETS)).filter((target) => target.box !== null && !target.underHidden);
  for (const target of targets) {
    const box = target.box;
    if (box === null) continue;
    expect(box.width > 0 && box.height > 0, `${at}: ${target.name} box`).toBe(true);
    expect(box.x >= 0 && box.x + box.width <= width + 0.5, `${at}: ${target.name} inside the viewport`).toBe(true);
  }
  expect(overlaps(targets), `${at}: topbar targets sharing area`).toEqual([]);

  if (width < XL) {
    expect(header.height, `${at}: two rows`).toBeGreaterThan(ROW_PX);
  } else {
    expect(header.height, `${at}: one row`).toBe(ROW_PX);
  }
  const mainTop = await page.locator("#main-content").evaluate((node) => node.getBoundingClientRect().top);
  expect(mainTop, `${at}: main starts below the topbar`).toBeGreaterThanOrEqual(header.y + header.height - 0.5);

  // Real clicks, not trial ones: the 390px defect was a click landing on the neighbour.
  if (width < MD) {
    const sidebar = page.locator("#wb-sidebar");
    await menu.click();
    await expect(sidebar, `${at}: the menu opens the rail`).not.toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveAttribute("inert", "");
  }
  await topbar.locator("[data-wb-drawer-button]").click();
  await expect(page.getByRole("dialog"), `${at}: artifacts opens the drawer`).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

for (const locale of ["en", "zh-CN"] as const) {
  for (const sample of [false, true]) {
    test(`topbar fits every layout band (${locale}, ${sample ? "sample loaded" : "empty project"})`, async ({
      page,
    }) => {
      test.slow();
      await prepareIn(page, locale, sample);
      for (const width of GEOMETRY_WIDTHS) {
        await expectTopbarFits(page, locale, sample, width);
      }
    });
  }
}

/**
 * Tab order through the topbar, from its first control until focus leaves it.
 * Two rows below `xl` are cut from the DOM in order, so the order is the same
 * as the one-row header's, minus what a band does not show.
 */
async function topbarTabOrder(page: Page, width: number): Promise<readonly string[]> {
  await page.setViewportSize({ width, height: 844 });
  await settled(page);
  const first = width < MD ? page.locator(`${TOPBAR} button[aria-controls="wb-sidebar"]`) : page.locator(`${TOPBAR} select`);
  await first.focus();
  const order: string[] = [];
  for (let step = 0; step < 20; step += 1) {
    const name = await page.evaluate((scope) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active.closest(scope) === null) return null;
      if (active.hasAttribute("data-wb-drawer-button")) return "artifacts";
      const label = active.getAttribute("aria-label");
      if (label !== null) return label;
      const clone = active.cloneNode(true) as HTMLElement;
      for (const kbd of clone.querySelectorAll("kbd")) kbd.remove();
      return (clone.textContent ?? "").replace(/\s+/gu, " ").trim();
    }, TOPBAR);
    if (name === null) break;
    order.push(name);
    await page.keyboard.press("Tab");
  }
  return order;
}

test("the topbar's Tab order is the same with two rows and with one", async ({ page }) => {
  await prepareIn(page, "en", true);
  const oneRow = await topbarTabOrder(page, 1280);
  expect(oneRow).toEqual([
    "Switch project",
    "+ New site",
    "Search / jump",
    "Clear sample",
    "artifacts",
    "English",
    "简体中文",
    "Log out",
  ]);
  expect(await topbarTabOrder(page, 1024), "two rows, rail and search shown").toEqual(oneRow);
  expect(await topbarTabOrder(page, 390), "two rows on a phone").toEqual([
    "Open navigation",
    ...oneRow.filter((name) => name !== "+ New site" && name !== "Search / jump"),
  ]);
});
