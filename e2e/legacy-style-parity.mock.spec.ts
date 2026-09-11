import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PROJECT_ID, installGrowthVerticalApi } from "./mock-api.ts";

/**
 * Guards the promise in docs/plans/2026-09-11-workbench-ui-port-design.md §5
 * that the workbench reset (`.wb-reset`) never reaches legacy pages rendered
 * inside `#main-content`. Width-dependent properties are excluded on purpose:
 * the new shell legitimately changes the content column. Sampling is smoke
 * level: the first match of each selector (document order, no semantic role
 * implied), light colour scheme only. The page title's font-size and
 * letter-spacing come from a `3vw` clamp resolved at the harness's fixed
 * 1280px viewport (38.4px / -1.344px): changing the viewport is legitimate
 * drift, not a reset leak.
 *
 * Regenerating the baseline is a deliberate local act:
 *   LEGACY_STYLE_BASELINE=write pnpm test:e2e:mock e2e/legacy-style-parity.mock.spec.ts
 * Write mode refuses to run in CI and refuses any page that already carries
 * `.wb-reset`. If a legitimate drift (font subset or next/font upgrade) forces
 * a regeneration after the shell landed, do it from a commit without the shell,
 * or attribute every differing property in the PR description.
 */
const BASELINE = new URL("./legacy-style-parity.baseline.json", import.meta.url);
const PROPS = [
  "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color",
  "background-color", "box-sizing", "margin-top", "margin-bottom", "padding-top",
  "padding-left", "border-top-width", "border-top-style", "border-radius",
] as const;
// Both screens are fully served by installGrowthVerticalApi (which installs the
// critical-flow routes too); an unmocked screen would snapshot a loading/error
// panel whose element set depends on timing.
const SCREENS = ["growth-map", "sources"] as const;
// `sources` renders no form control on first paint (its <select>s appear only
// after an interaction), so it deterministically samples 5 selectors, not 6.
const SELECTORS = ["[data-app-page-title]", "h1", "button", "p", "input, select, textarea", "a"] as const;
const MIN_SAMPLED = 5;

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

function readBaseline(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

test.beforeEach(async ({ page }) => {
  // Load-bearing: zh-CN swaps --sf-font-display for the CJK face (globals.css),
  // which would change the recorded font-family. The baseline is the en chrome.
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
    expect(Object.keys(current).length, `${screen}: too few sampled elements`).toBeGreaterThanOrEqual(MIN_SAMPLED);
    if (process.env["LEGACY_STYLE_BASELINE"] === "write") {
      expect(process.env["CI"], "baseline regeneration is a local, deliberate act").toBeFalsy();
      const shellPresent = await page.evaluate(() => document.querySelector(".wb-reset") !== null);
      expect(shellPresent, "refusing to bless a post-shell baseline: .wb-reset is on the page").toBe(false);
      const kept = Object.fromEntries(
        Object.entries(readBaseline() ?? {}).filter(([key]) => (SCREENS as readonly string[]).includes(key)),
      );
      writeFileSync(BASELINE, JSON.stringify({ ...kept, [screen]: current }, null, 2) + "\n");
      return;
    }
    const baseline = readBaseline();
    expect(baseline, `missing ${BASELINE.pathname}; regenerate only from a pre-shell commit (see file header)`).not.toBeNull();
    const entry = baseline?.[screen];
    expect(entry, `no baseline entry for "${screen}"`).toBeDefined();
    expect(current).toEqual(entry);
  });
}
