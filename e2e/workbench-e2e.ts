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
