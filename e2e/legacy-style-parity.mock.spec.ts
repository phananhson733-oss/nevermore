import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PROJECT_ID, installGrowthVerticalApi } from "./mock-api.ts";

/**
 * Guards the design-doc promise that the workbench reset never reaches legacy
 * pages. Width-dependent properties are excluded on purpose: the new shell
 * legitimately changes the content column. Regenerate the baseline ONLY from a
 * commit before the workbench shell landed:
 *   LEGACY_STYLE_BASELINE=write pnpm test:e2e:mock -- e2e/legacy-style-parity.mock.spec.ts
 */
const BASELINE = new URL("./legacy-style-parity.baseline.json", import.meta.url);
const PROPS = [
  "font-family", "font-size", "font-weight", "line-height", "color",
  "background-color", "margin-top", "margin-bottom", "padding-top",
  "padding-left", "border-top-width", "border-top-style", "border-radius",
] as const;
// Both screens are fully served by installGrowthVerticalApi (which installs the
// critical-flow routes too); an unmocked screen would snapshot a loading/error
// panel whose element set depends on timing.
const SCREENS = ["growth-map", "sources"] as const;
const SELECTORS = ["[data-app-page-title]", "h1", "button", "p", "input, select, textarea", "a"] as const;

async function snapshot(page: Page): Promise<Record<string, Record<string, string>>> {
  return page.evaluate(({ props, selectors }) => {
    const out: Record<string, Record<string, string>> = {};
    const main = document.querySelector("#main-content");
    if (!main) return out;
    for (const sel of selectors) {
      const el = main.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out[sel] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    }
    return out;
  }, { props: PROPS, selectors: SELECTORS });
}

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([
    { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
  ]);
  await installGrowthVerticalApi(page);
});

for (const screen of SCREENS) {
  test(`legacy ${screen} keeps its computed styles`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/p/${E2E_PROJECT_ID}/${screen}`);
    // The hero (page title) renders before the queries settle, but the first
    // <a> / <input> matches live in query-driven regions; wait for the mock
    // routes (millisecond responses) to finish so the element set is stable.
    await expect(page.locator("#main-content [data-app-page-title]").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const current = await snapshot(page);
    if (process.env["LEGACY_STYLE_BASELINE"] === "write") {
      const existing = (() => {
        try { return JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, unknown>; }
        catch { return {}; }
      })();
      writeFileSync(BASELINE, JSON.stringify({ ...existing, [screen]: current }, null, 2) + "\n");
      return;
    }
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, unknown>;
    expect(current).toEqual(baseline[screen]);
  });
}
