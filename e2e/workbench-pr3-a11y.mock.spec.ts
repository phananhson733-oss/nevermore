import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  clearSampleButton,
  loadSample,
  openView,
  prepareEnglishPage,
  PR3_VIEWS,
  readStored,
  writeStored,
  type Pr3View,
} from "./workbench-e2e.ts";
import {
  MIN_TARGET_PX,
  absent,
  names,
  operableFailures,
  overlaps,
  sweep,
  under,
} from "./workbench-targets.ts";

/**
 * Accessibility and CSS of the five PR-3 views as rendered (T17 Steps 1c, 1d,
 * 4b, 4e). The unit gates for these are static — a contrast pairing read from
 * class strings, a Tailwind scan read from source, a hit-area sweep over
 * panel.ts exports — and each has named blind spots only a real page shows.
 *
 * - Contrast (1d) is the workbench's main gate (codex S8): axe `color-contrast`
 *   on every view with the sample loaded, and on the states the ui primitives
 *   only reach at run time: the confirmation, the open mobile rail, and the
 *   artifact row's two refusal notices. No node is excluded. (a11y.spec.ts
 *   drops sidebar nodes because axe cannot composite the legacy sticky dark
 *   sidebar; the workbench rail measured 0 violations open, so nothing here
 *   copies that exclusion.) A pass count proves the rule saw text.
 * - Target size: axe's `target-size` is tagged `wcag22aa` and every other run
 *   in the repository stops at `wcag21aa`; the run below includes the tag and
 *   checks the rule actually ran. The sweep (4b) measures every view control
 *   at 390 and 1280 and asks Playwright whether it is clickable.
 * - Tailwind (1c): every class token on the page must have a rule in the
 *   stylesheets the page loaded. Under `next dev` the stylesheet also keeps
 *   candidates it has seen, so this catches classes built at run time or from
 *   outside the scan roots, not a production-only miss.
 * - Soft navigation (4e): workbench.css stays in the document after a client
 *   hop to /new-project, so that page's key elements are pinned to their
 *   hard-load computed style.
 */

test.beforeEach(async ({ page }) => {
  await prepareEnglishPage(page);
});

/** Nothing on the view is still loading: no skeleton, no busy region. */
async function viewSettled(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(
    page.locator("#main-content :is([data-wb-skeleton], [aria-busy='true'])"),
  ).toHaveCount(0);
}

/**
 * `minChecked` proves the rule saw text. A page checks dozens of nodes; with a
 * modal box open the rest of the page is hidden from assistive tech and axe
 * checks only the box (3 nodes measured with the clear-sample confirmation).
 */
async function contrastViolations(
  page: Page,
  minChecked = 10,
): Promise<readonly string[]> {
  const results = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    .analyze();
  const checked = results.passes.find((rule) => rule.id === "color-contrast");
  expect(
    checked?.nodes.length ?? 0,
    "color-contrast checked text nodes",
  ).toBeGreaterThanOrEqual(minChecked);
  return results.violations.flatMap((rule) =>
    rule.nodes.map(
      (node) => `${node.target.join(" ")}: ${node.failureSummary ?? ""}`,
    ),
  );
}

async function targetSizeViolations(page: Page): Promise<readonly string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag22aa"])
    .analyze();
  const ran = [
    ...results.passes,
    ...results.violations,
    ...results.incomplete,
  ].map((rule) => rule.id);
  expect(ran, "axe ran target-size (wcag22aa) and it applied").toContain(
    "target-size",
  );
  return [...results.violations, ...results.incomplete].flatMap((rule) =>
    rule.nodes.map((node) => `${rule.id} ${node.target.join(" ")}`),
  );
}

/** A primitive the view must show for the scan to cover it (Step 1d). */
const PRIMITIVE_ON: Readonly<Record<Pr3View, string>> = {
  overview: "[data-wb-frame] a[href], [data-wb-frame] .text-4xl", // StatCard values
  week: '[data-wb-week-card] a[href], [data-wb-week-report] button:has-text("Copy for AI")',
  profile: 'input[role="switch"]', // Toggle
  "data-sources": "[data-wb-source]",
  settings: 'input[role="switch"]', // Toggle
};

for (const view of PR3_VIEWS) {
  test(`${view} with the sample loaded has no contrast or target-size violations`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadSample(page);
    await openView(page, view);
    await viewSettled(page);
    await expect(
      page.locator(`#main-content :is(${PRIMITIVE_ON[view]})`).first(),
    ).toBeVisible();
    expect(await contrastViolations(page), `${view}: color-contrast`).toEqual(
      [],
    );
    expect(await targetSizeViolations(page), `${view}: target-size`).toEqual(
      [],
    );
  });
}

test("the confirmation and the open mobile rail have no contrast violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadSample(page);
  await clearSampleButton(page).click();
  await expect(
    page.getByRole("dialog", { name: "Clear the sample data?" }),
  ).toBeVisible();
  expect(await contrastViolations(page, 3), "confirmation open").toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const sidebar = page.locator("#wb-sidebar");
  await page.locator('button[aria-controls="wb-sidebar"]').click();
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await expect
    .poll(() => sidebar.evaluate((node) => node.getAnimations().length))
    .toBe(0);
  expect(await contrastViolations(page), "mobile rail open").toEqual([]);
});

const BASKET_FULL =
  "Could not save: Artifacts is full. Remove a few there, then save again. You can still copy or export this.";
const TOO_LARGE =
  "Too large to save to artifacts. You can still export it or copy it.";

test("the artifact row's refusal notices are readable (basket full, too large)", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadSample(page);
  const stored = await readStored(page);
  const seed = stored?.state.artifacts[0];
  expect(seed, "the sample stores artifacts").toBeDefined();
  if (stored === null || seed === undefined) return;
  // ARTIFACT_LIMIT copies of a real sample artifact, each its own id.
  const artifacts = Array.from({ length: 50 }, (_, index) => ({
    ...seed,
    id: `e2e-full-${index}`,
  }));
  await writeStored(page, { ...stored, state: { ...stored.state, artifacts } });

  await openView(page, "week");
  await viewSettled(page);
  await page
    .getByRole("button", { name: "Save the weekly report", exact: true })
    .click();
  await expect(page.locator('[data-wb-week-report] [role="alert"]')).toHaveText(
    BASKET_FULL,
  );
  expect(await contrastViolations(page), "basket full notice").toEqual([]);

  // Over ARTIFACT_CONTENT_MAX (200 000 UTF-16 units) through the one field
  // that reaches the profile text verbatim.
  await openView(page, "profile");
  await viewSettled(page);
  await page.getByLabel("Positioning in one line").fill("a".repeat(201_000));
  const run = page.getByRole("button", {
    name: "Regenerate the profile",
    exact: true,
  });
  await run.click();
  await expect(run).toBeEnabled();
  await page
    .getByRole("button", { name: "Save to artifacts", exact: true })
    .click();
  await expect(page.locator('[data-wb-pane-foot] [role="alert"]')).toHaveText(
    TOO_LARGE,
  );
  expect(await contrastViolations(page), "too large notice").toEqual([]);
});

/* ------------------------------------------------------------------ *
 * Step 4b: the views' own controls, swept the way the shell's are.
 * ------------------------------------------------------------------ */

const VIEW_TARGETS = [
  "#main-content :is(button, a[href], input, select, textarea)",
  '#main-content label:has(> input[type="file"])',
].join(", ");

/**
 * WCAG 2.5.8 exceptions in the views, by name, 1 in all:
 * - "input:Upload a CSV" (data-sources): the file input is `sr-only`, 1x1, and
 *   its wrapping label is the visible control; that label is swept as
 *   "label:Upload a CSV". It is left out of the click check for the same
 *   reason: the label, its ancestor, receives the pointer.
 * Field labels of text inputs and switches are not swept: each control itself
 * is (the "equivalent" exception).
 */
const VIEW_EXCEPTIONS: Readonly<Record<Pr3View, readonly string[]>> = {
  overview: [],
  week: [],
  profile: [],
  "data-sources": ["input:Upload a CSV"],
  settings: [],
};

/** The name `workbench-targets.ts` gives a control named by its text (first 32 characters). */
function byText(tag: string, text: string): string {
  return `${tag}:${text.slice(0, 32)}`;
}

function repeat(name: string, count: number): readonly string[] {
  return Array.from({ length: count }, () => name);
}

/** Every control each view shows with the sample loaded; repeated rows are counted from their row hooks. */
async function expectedViewTargets(
  page: Page,
  view: Pr3View,
): Promise<readonly string[]> {
  switch (view) {
    case "overview":
      return [
        "legacy:legacy/overview",
        ...repeat("a:Go", await page.locator("[data-wb-next-step]").count()),
      ];
    case "week":
      return [
        "card:health",
        "card:mention",
        "card:borderline",
        ...repeat("a:View", await page.locator("[data-wb-event]").count()),
        ...repeat(
          "a:Go",
          await page.locator("[data-wb-week-next] [data-wb-step]").count(),
        ),
        "button:Copy",
        "button:Copy for AI",
        "button:Export .md",
        "button:Save the weekly report",
      ];
    case "profile":
      return [
        "legacy:context",
        "legacy:setup-sources",
        "input:Site URL",
        "input:Brand name",
        "input:Target market",
        "input:Positioning in one line",
        "input:Core features",
        "input:Main competitors",
        "input:Site crawl",
        "input:GSC signals",
        "input:Third-party metrics",
        "button:Regenerate the profile",
        "a:Edit the real product profile",
        "button:Profile",
        "button:JSON",
        "button:AI context block",
        "button:Copy",
        "button:Copy for AI",
        "button:Export",
        "button:Save to artifacts",
      ];
    case "data-sources":
      return [
        "legacy:sources",
        byText("a", "Connect or disconnect on the legacy page"),
        "textarea:Paste a GSC export",
        "label:Upload a CSV",
        "input:Upload a CSV",
        "button:Parse",
        "button:Clear",
        "a:Open the keyword matrix",
      ];
    case "settings":
      return [
        "input:Weekly report",
        "input:Health score or mention rate drops",
        "input:Brand appears in an AI answer for the first time",
        "input:GSC import fails",
        "a:Open Data sources",
        byText("a", "Connect sources on the legacy page"),
        "button:Delete product",
      ];
  }
}

for (const view of PR3_VIEWS) {
  test(`${view} controls clear 24px and are clickable at 390 and 1280 (sample loaded)`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadSample(page);
    await openView(page, view);
    await viewSettled(page);
    // Repeated rows must exist, or the counted names below prove nothing.
    if (view === "week")
      await expect(page.locator("[data-wb-event]").first()).toBeVisible();
    if (view === "overview")
      await expect(page.locator("[data-wb-next-step]").first()).toBeVisible();

    for (const width of [1280, 390]) {
      const at = `${view} ${width}px`;
      await page.setViewportSize({ width, height: 844 });
      await viewSettled(page);
      const swept = await sweep(page, VIEW_TARGETS);
      expect(names(swept), `${at}: target set`).toEqual(
        [...(await expectedViewTargets(page, view))].sort(),
      );
      expect(absent(swept), `${at}: targets with no box`).toEqual([]);
      expect(
        under(swept, MIN_TARGET_PX).map((entry) =>
          entry.replace(/ [\d.]+x[\d.]+$/u, ""),
        ),
        `${at}: targets under ${MIN_TARGET_PX}px`,
      ).toEqual(VIEW_EXCEPTIONS[view]);
      const operable = swept.filter(
        (target) => !VIEW_EXCEPTIONS[view].includes(target.name),
      );
      expect(overlaps(operable), `${at}: targets sharing area`).toEqual([]);
      expect(
        await operableFailures(page, VIEW_TARGETS, operable),
        `${at}: targets Playwright could not click`,
      ).toEqual([]);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Step 1c: class tokens without a rule.
 * ------------------------------------------------------------------ */

/**
 * Class tokens on the page that no loaded stylesheet has a rule for. Rules are
 * collected recursively (layers, media, nested rules), so a variant written as
 * nested CSS is found through its outer selector.
 */
async function ruleless(
  page: Page,
): Promise<{ readonly tokens: number; readonly missing: readonly string[] }> {
  return page.evaluate(() => {
    const selectors: string[] = [];
    const walk = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) selectors.push(rule.selectorText);
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
    const all = selectors.join("\n");
    const hasRule = (token: string): boolean => {
      const needle = `.${CSS.escape(token)}`;
      for (
        let at = all.indexOf(needle);
        at !== -1;
        at = all.indexOf(needle, at + 1)
      ) {
        const next = all.charAt(at + needle.length);
        if (next === "" || !/[\w\-\\]/u.test(next)) return true;
      }
      return false;
    };
    const tokens = new Set<string>();
    for (const node of Array.from(document.querySelectorAll("[class]"))) {
      for (const token of Array.from(node.classList)) tokens.add(token);
    }
    return {
      tokens: tokens.size,
      missing: [...tokens].filter((token) => !hasRule(token)).sort(),
    };
  });
}

/**
 * lucide-react stamps `lucide` and `lucide-<icon>` on every icon for callers to
 * target; nothing in this app does, so they have no rule by design. That is
 * the one exemption, matched by pattern because the set follows whichever
 * icons a page renders. CSS-module and next/font names are generated with
 * their rules, so they need none.
 */
const LUCIDE_ICON_CLASS = /^lucide(?:-[a-z0-9-]+)?$/u;

async function expectEveryClassHasARule(
  page: Page,
  where: string,
): Promise<void> {
  // Control first: a token no stylesheet defines must be reported, or an empty
  // list below would only mean the checker cannot see anything.
  await page.evaluate(() =>
    document.body.classList.add("wb-e2e-no-such-utility"),
  );
  const { tokens, missing } = await ruleless(page);
  await page.evaluate(() =>
    document.body.classList.remove("wb-e2e-no-such-utility"),
  );
  expect(missing, `${where}: control token reported`).toContain(
    "wb-e2e-no-such-utility",
  );
  expect(tokens, `${where}: class tokens seen`).toBeGreaterThan(20);
  expect(
    missing.filter(
      (token) =>
        token !== "wb-e2e-no-such-utility" && !LUCIDE_ICON_CLASS.test(token),
    ),
    `${where}: class tokens with no rule`,
  ).toEqual([]);
}

test("every class token on the workbench views, /new-project and /login has a rule", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await loadSample(page);
  for (const view of PR3_VIEWS) {
    await openView(page, view);
    await viewSettled(page);
    await expectEveryClassHasARule(page, view);
  }
  await page.goto("/new-project");
  await expect(
    page.locator('#main-content button[type="submit"]'),
  ).toBeEnabled();
  await expectEveryClassHasARule(page, "/new-project");
  await page.goto("/login");
  await expect(page.locator("h1")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectEveryClassHasARule(page, "/login");
});

/* ------------------------------------------------------------------ *
 * Step 4e: /new-project after a client-side hop from a workbench page.
 * ------------------------------------------------------------------ */

const NEW_PROJECT_KEY_ELEMENTS = {
  main: "#main-content",
  heading: "#main-content h1",
  submit: '#main-content button[type="submit"]',
} as const;

/**
 * Every standard computed property of the key elements, once no transition or
 * animation is running on the page. Custom properties (`--*`) are left out:
 * workbench.css's theme variables stay on :root after the hop by design (T12),
 * and whatever reads one of them shows up in a standard property here.
 */
async function keyElementStyles(
  page: Page,
): Promise<Record<string, Record<string, string> | null>> {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().length))
    .toBe(0);
  return page.evaluate((selectors) => {
    const read = (selector: string): Record<string, string> | null => {
      const node = document.querySelector(selector);
      if (node === null) return null;
      const style = getComputedStyle(node);
      const out: Record<string, string> = {};
      for (let index = 0; index < style.length; index += 1) {
        const property = style.item(index);
        if (!property.startsWith("--"))
          out[property] = style.getPropertyValue(property);
      }
      return out;
    };
    return Object.fromEntries(
      Object.entries(selectors).map(([key, selector]) => [key, read(selector)]),
    );
  }, NEW_PROJECT_KEY_ELEMENTS);
}

/**
 * workbench.css's own reset (`.wb-reset :where(...)`), the marker
 * legacy-style-parity.mock.spec.ts uses. A bare `.wb-reset` is not enough:
 * app-shell.module.css carries `:global(.wb-reset) .projectSwitcher` overrides
 * and is on /new-project on a hard load.
 */
const WORKBENCH_MARKER = /\.wb-reset\s+:where\(/u;

async function workbenchCssLoaded(page: Page): Promise<boolean> {
  const css = await page.evaluate(async () => {
    const parts: string[] = [];
    for (const node of document.querySelectorAll(
      "link[rel='stylesheet'], style",
    )) {
      parts.push(
        node instanceof HTMLLinkElement
          ? await (await fetch(node.href)).text()
          : (node.textContent ?? ""),
      );
    }
    return parts.join("\n");
  });
  return WORKBENCH_MARKER.test(css);
}

test("/new-project reached by a client-side hop computes the same key styles as a hard load", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/new-project");
  const submit = page.locator(NEW_PROJECT_KEY_ELEMENTS.submit);
  await expect(submit).toBeEnabled();
  expect(
    await workbenchCssLoaded(page),
    "hard load: workbench.css absent",
  ).toBe(false);
  const hard = await keyElementStyles(page);
  for (const [key, style] of Object.entries(hard)) {
    expect(
      Object.keys(style ?? {}).length,
      `hard load: ${key} computed properties`,
    ).toBeGreaterThan(300);
  }

  await openView(page, "overview");
  await page.locator("[data-app-shell-topbar] a[href='/new-project']").click();
  await page.waitForURL(/\/new-project$/u);
  await expect(submit).toBeEnabled();
  // The scenario this pin exists for: the workbench stylesheet is still here.
  expect(
    await workbenchCssLoaded(page),
    "soft navigation: workbench.css still loaded",
  ).toBe(true);
  expect(await keyElementStyles(page)).toEqual(hard);
});
