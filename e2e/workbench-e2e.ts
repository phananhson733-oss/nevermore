import { expect, type Locator, type Page } from "@playwright/test";
import { storageKey } from "../apps/web/src/lib/workbench/store/persistence.ts";
import type { WorkbenchProjectState } from "../apps/web/src/lib/workbench/types.ts";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";

/**
 * Shared set-up for the workbench mock e2e specs: the English chrome, the mock
 * API, the five PR-3 views, and the one way the sample site is loaded (the
 * overview's own button, never a hand-written storage seed, so a test on the
 * sample sees what an operator sees).
 */

export const PROJECT_PATH = `/p/${E2E_PROJECT_ID}`;
export const WORKBENCH_KEY = storageKey(E2E_PROJECT_ID);

/** The five views PR-3 ships, by URL segment. */
export const PR3_VIEWS = [
  "overview",
  "week",
  "profile",
  "data-sources",
  "settings",
] as const;
export type Pr3View = (typeof PR3_VIEWS)[number];

export async function prepareEnglishPage(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
  await installCriticalFlowApi(page);
}

export async function openView(page: Page, segment: string): Promise<void> {
  await page.goto(`${PROJECT_PATH}/${segment}`);
  await expect(page.locator("h1[data-wb-page-title]")).toHaveCount(1);
}

export function clearSampleButton(page: Page): Locator {
  return page
    .locator("[data-app-shell-topbar]")
    .getByRole("button", { name: "Clear sample", exact: true });
}

export interface StoredEnvelope {
  readonly v: number;
  readonly state: WorkbenchProjectState;
}

export async function readStored(page: Page): Promise<StoredEnvelope | null> {
  const raw = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    WORKBENCH_KEY,
  );
  return raw === null ? null : (JSON.parse(raw) as StoredEnvelope);
}

export async function writeStored(
  page: Page,
  envelope: StoredEnvelope,
): Promise<void> {
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key, value),
    [WORKBENCH_KEY, JSON.stringify(envelope)] as const,
  );
}

/**
 * Loads the sample from an empty project the way an operator does and waits
 * until it is in storage, so a reload or a second tab reads the sample too.
 */
export async function loadSample(page: Page): Promise<void> {
  await openView(page, "overview");
  await page
    .getByRole("button", { name: "Load sample site", exact: true })
    .click();
  await expect(clearSampleButton(page)).toHaveCount(1);
  await expect
    .poll(async () => (await readStored(page))?.state.demo ?? null)
    .toBe(true);
}

/** A GSC export with a header naming every metric, and `rows` distinct queries. */
export function gscExport(rows: number): string {
  const lines = Array.from(
    { length: rows },
    (_, index) => `e2e query ${index + 1}\t${10 + index}\t${200 + index}\t5%\t${12 + index}`,
  );
  return ["Top queries\tClicks\tImpressions\tCTR\tPosition", ...lines].join("\n");
}

export type UiLocale = "en" | "zh-CN";
export type StorageFailure = "quota" | "volatile";

/** The topbar's status sentence for each storage failure, as served. */
export const STORAGE_SENTENCE: Readonly<Record<StorageFailure, Readonly<Record<UiLocale, string>>>> = {
  quota: { en: "Browser storage is full; new results are not being saved", "zh-CN": "浏览器存储已满，新结果不再保存" },
  volatile: { en: "Results will not be saved in this browser", "zh-CN": "本次结果不会保存在此浏览器" },
};

/** The compact label shown below `xl` (words outside 768-1023px). */
export const NOT_SAVED_SHORT: Readonly<Record<UiLocale, string>> = { en: "Not saved", "zh-CN": "未保存" };

const SAMPLE_BUTTON: Readonly<Record<UiLocale, string>> = { en: "Load sample site", "zh-CN": "载入示例站点" };
const CLEAR_BUTTON: Readonly<Record<UiLocale, string>> = { en: "Clear sample", "zh-CN": "清除示例" };

/**
 * The sample loaded in `locale` with browser storage failing, confirmed by the
 * topbar's status sentence before returning, so a caller never measures the
 * normal topbar by mistake.
 * - `volatile`: localStorage throws from the first script; the sample lives in
 *   memory and the page stays on the overview.
 * - `quota`: the sample is stored first, then every write to a workbench key
 *   throws QuotaExceededError, and a notification switch on /settings makes
 *   the write that latches quota mode.
 */
export async function openWithFailingStorage(page: Page, locale: UiLocale, failure: StorageFailure): Promise<void> {
  await page.context().addCookies([{ name: "sf_ui_locale", value: locale, domain: "localhost", path: "/" }]);
  await installCriticalFlowApi(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  if (failure === "volatile") {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("e2e storage denied", "SecurityError");
        },
      });
    });
  }
  await openView(page, "overview");
  await page.getByRole("button", { name: SAMPLE_BUTTON[locale], exact: true }).click();
  const topbar = page.locator("[data-app-shell-topbar]");
  await expect(topbar.getByRole("button", { name: CLEAR_BUTTON[locale], exact: true })).toHaveCount(1);
  if (failure === "quota") {
    await expect
      .poll(() => page.evaluate(() => Object.keys(window.localStorage).some((key) => key.startsWith("gg.workbench."))))
      .toBe(true);
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function quotaFull(key: string, value: string): void {
        if (key.startsWith("gg.workbench.")) throw new DOMException("e2e quota", "QuotaExceededError");
        setItem.call(this, key, value);
      };
    });
    await openView(page, "settings");
    await page.locator('[data-wb-notify] input[role="switch"]').first().click();
  }
  await expect(topbar.locator('[role="status"]')).toHaveText(STORAGE_SENTENCE[failure][locale]);
}
