import { expect, test, type Page } from "@playwright/test";
import { initialProjectState } from "../apps/web/src/lib/workbench/store/reducer.ts";
import { storageKey } from "../apps/web/src/lib/workbench/store/persistence.ts";
import { PERSISTED_VERSION } from "../apps/web/src/lib/workbench/store/schema.ts";
import { E2E_PROJECT_ID, installCriticalFlowApi } from "./mock-api.ts";
import {
  MIN_TARGET_PX,
  TOUCH_TARGET_PX,
  absent,
  names,
  operableFailures,
  overlaps,
  sweep,
  under,
  type SweptTarget,
} from "./workbench-targets.ts";

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

/* ------------------------------------------------------------------ *
 * WCAG 2.5.8 Target Size (Minimum): 24 x 24 CSS px.
 *
 * Every axe run in this repository stops at `wcag21aa`, and axe tags
 * `target-size` `wcag22aa` — so no scan here has ever evaluated this rule and
 * the "touch targets are covered by axe" belief was empty (裁决 Q29). This
 * sweep is the check (the views' own sweep and a `wcag22aa` axe run live in
 * workbench-pr3-a11y.mock.spec.ts).
 *
 * Scope is the shell's own chrome (rail + topbar + the artifact drawer) plus
 * `[data-wb-legacy-link]`, the one shared affordance the shell owns that
 * renders inside a view. `<main>` is deliberately NOT swept here.
 *
 * A box that clears 24px is not yet a target (T17 Step 4d, codex S4): each
 * sample also asks Playwright whether the target is really clickable
 * (`pointer-events: none`, a clip, a neighbour on top all fail it) and holds
 * every pair of reachable targets to no shared area. The helpers are in
 * workbench-targets.ts.
 * ------------------------------------------------------------------ */

/**
 * One selector, not a hand-written element list: the sweep has to find a button
 * somebody adds tomorrow by itself. Nothing is filtered out here, `[hidden]`
 * included; what may be skipped is decided per element below and then checked.
 */
const SHELL_TARGETS = [
  "#wb-sidebar :is(button, a[href])",
  "[data-app-shell-topbar] :is(button, a[href])",
  "a[href][data-wb-legacy-link]",
].join(", ");

const RAIL_TARGETS = "#wb-sidebar :is(button, a[href])";

/**
 * The one kind of element the sweep skips. `ProjectSwitcher` keeps a `<Link>`
 * per other project beside its `<select>` and clicks it from the select's
 * onChange, so the unsaved-editor guards see a real navigation. It is found by
 * that structure (an anchor sharing its parent with the select), not by the
 * attributes that make it skippable, and then every one found must carry all
 * of them: `hidden`, `aria-hidden="true"`, `tabIndex -1`, and no box. One per
 * non-current project; the mock fixture ships two projects. Every other
 * `[hidden]` target in scope is asserted to be an empty list.
 *
 * The plan asked for a `data-wb-nav-proxy` marker on the component; finding the
 * proxy by structure needs no production hook, and a stray `class="block"` on
 * it still fails the no-box check.
 */
const SWITCHER_PROXIES = 1;

const DRAWER_TARGETS = '[role="dialog"] :is(button, a[href])';

async function shellSweep(page: Page): Promise<readonly SweptTarget[]> {
  const all = await sweep(page, SHELL_TARGETS);
  const proxies = all.filter((target) => target.switcherProxy);
  expect(
    proxies.map(({ underHidden, ariaHidden, tabIndex, box }) => ({
      underHidden,
      ariaHidden,
      tabIndex,
      box,
    })),
    "project switcher navigation proxies",
  ).toEqual(
    Array.from({ length: SWITCHER_PROXIES }, () => ({
      underHidden: true,
      ariaHidden: "true",
      tabIndex: -1,
      box: null,
    })),
  );
  const targets = all.filter((target) => !target.switcherProxy);
  expect(
    targets.filter((target) => target.underHidden).map((target) => target.name),
    "[hidden] targets other than the switcher proxy",
  ).toEqual([]);
  return targets;
}

/** Waits for the rail's slide transition, which a viewport change can start. */
async function railSettled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page
        .locator("#wb-sidebar")
        .evaluate((node) => node.getAnimations().length),
    )
    .toBe(0);
}

/**
 * The shell chrome on `/profile`, named in full. Asserted as an exact set, not
 * just measured: without it a renamed or deleted control drops out of the
 * sweep and leaves it green on nothing at all — the failure mode this
 * repository keeps paying for (enumerated-guards / partial-measurement).
 *
 * 15 rail links (WORKBENCH_NAV), 7 topbar controls, 2 legacy links
 * (LEGACY_LINKS.profile) = 24.
 */
const SHELL_TARGET_NAMES: readonly string[] = [
  "rail:overview",
  "rail:week",
  "rail:keywords",
  "rail:keywordLibrary",
  "rail:competitors",
  "rail:audit",
  "rail:visibility",
  "rail:profile",
  "rail:dataSources",
  "rail:links",
  "rail:content",
  "rail:kb",
  "rail:answers",
  "rail:artifacts",
  "rail:settings",
  "button:Open navigation",
  "a:+ New site",
  "button:Search / jump",
  "topbar:artifacts",
  "button:English",
  "button:简体中文",
  "button:Log out",
  "legacy:context",
  "legacy:setup-sources",
].sort();

const RAIL_TARGET_NAMES = SHELL_TARGET_NAMES.filter((name) =>
  name.startsWith("rail:"),
);

/**
 * WCAG 2.5.8 "inline" exception holders in scope (a target inside a sentence,
 * sized by the line height). Deliberately none: every link here is a
 * standalone control in a flex row, so the first one somebody adds has to be
 * argued for here rather than slipping through. "equivalent", "user agent
 * control", "essential": 0 in scope.
 */
const INLINE_EXCEPTIONS: readonly string[] = [];

/**
 * The two controls a phone user reaches for first are held to 44px rather than
 * the 24px floor, at every width below `md` where they exist.
 */
const TOUCH_44_BELOW_MD: readonly string[] = [
  "button:Open navigation",
  "topbar:artifacts",
];

/**
 * One sample on each side of both breakpoints the topbar changes at, plus the
 * phone and desktop widths the sweep started with. 640–767 is its own band:
 * "+ New site" is shown (`sm:inline`) while the menu button still is too.
 * Each band names what its display utilities remove (box `null`).
 */
const SAMPLES: readonly {
  readonly width: number;
  readonly absent: readonly string[];
  readonly belowMd: boolean;
}[] = [
  // `md:hidden`: from `md` up the rail is permanent, so its toggle is gone.
  { width: 1280, absent: ["button:Open navigation"], belowMd: false },
  { width: 768, absent: ["button:Open navigation"], belowMd: false },
  // `hidden md:flex`.
  { width: 767, absent: ["button:Search / jump"], belowMd: true },
  { width: 640, absent: ["button:Search / jump"], belowMd: true },
  // ... and `hidden sm:inline`.
  { width: 639, absent: ["a:+ New site", "button:Search / jump"], belowMd: true },
  { width: 390, absent: ["a:+ New site", "button:Search / jump"], belowMd: true },
];

test("shell chrome targets clear 24px, stay clickable and apart at every layout band", async ({
  page,
}) => {
  test.slow(); // six widths, each with a trial click per target
  // `/profile` is the page with two legacy links (LEGACY_LINKS.profile), so one
  // navigation covers the shared affordance as well as the shell's own chrome.
  await page.goto(`/p/${E2E_PROJECT_ID}/profile`);
  await expect(page.locator("h1[data-wb-page-title]")).toHaveCount(1);

  for (const sample of SAMPLES) {
    const at = `${sample.width}px`;
    await page.setViewportSize({ width: sample.width, height: 844 });
    await railSettled(page);
    const swept = await shellSweep(page);
    expect(names(swept), `${at}: swept target set`).toEqual(SHELL_TARGET_NAMES);
    expect(absent(swept), `${at}: targets with no box`).toEqual(
      [...sample.absent].sort(),
    );
    expect(under(swept, MIN_TARGET_PX), `${at}: targets under ${MIN_TARGET_PX}px`).toEqual(
      INLINE_EXCEPTIONS,
    );
    if (sample.belowMd) {
      expect(
        under(swept, TOUCH_TARGET_PX, TOUCH_44_BELOW_MD),
        `${at}: controls held to ${TOUCH_TARGET_PX}px`,
      ).toEqual([]);
    }
    // Below `md` the closed rail is inert and off canvas: its links have a box
    // but no user can reach them, so they are not "reachable" here; the open
    // rail is measured in its own test below.
    const rail = swept.filter((target) => target.name.startsWith("rail:"));
    expect(
      rail.filter((target) => target.underInert !== sample.belowMd).map((t) => t.name),
      `${at}: rail links whose inert state does not match the band`,
    ).toEqual([]);
    const reachable = swept.filter(
      (target) => target.box !== null && !target.underInert,
    );
    expect(overlaps(reachable), `${at}: reachable targets sharing area`).toEqual([]);
    expect(
      await operableFailures(page, SHELL_TARGETS, reachable),
      `${at}: targets Playwright could not click`,
    ).toEqual([]);
    if (sample.width === 390) {
      // The closed rail really is out of reach, not just marked inert.
      const overview = rail.filter((target) => target.name === "rail:overview");
      expect(
        await operableFailures(page, SHELL_TARGETS, overview, 1_000),
        "390px: a closed rail link is not clickable",
      ).toEqual(["rail:overview"]);
    }
  }
});

test("the mobile rail's links are measured open, where a finger reaches them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${E2E_PROJECT_ID}/profile`);
  const sidebar = page.locator("#wb-sidebar");
  await expect(sidebar).toHaveAttribute("inert", "");
  await page.locator('button[aria-controls="wb-sidebar"]').click();
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await railSettled(page);
  await expect
    .poll(() => sidebar.evaluate((node) => node.getBoundingClientRect().x))
    .toBe(0);

  const rail = await sweep(page, RAIL_TARGETS);
  expect(names(rail), "open rail target set").toEqual(RAIL_TARGET_NAMES);
  expect(absent(rail), "open rail targets with no box").toEqual([]);
  expect(
    rail.filter((target) => target.underInert).map((target) => target.name),
    "open rail targets still under [inert]",
  ).toEqual([]);
  expect(under(rail, MIN_TARGET_PX), `open rail targets under ${MIN_TARGET_PX}px`).toEqual([]);
  expect(overlaps(rail), "open rail targets sharing area").toEqual([]);
  expect(
    await operableFailures(page, RAIL_TARGETS, rail),
    "open rail targets Playwright could not click",
  ).toEqual([]);
});

for (const [viewport, size] of [
  ["desktop", { width: 1280, height: 800 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  test(`artifact drawer rows clear the 24px target minimum (${viewport})`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.addInitScript(
      ([key, value]) => {
        window.localStorage.setItem(key, value);
      },
      [
        storageKey(E2E_PROJECT_ID),
        JSON.stringify({
          v: PERSISTED_VERSION,
          state: {
            ...initialProjectState({
              url: "example.test",
              brand: "Example",
              market: "US",
            }),
            artifacts: [
              {
                id: "seeded",
                at: "2026-09-13 10:00",
                module: "audit",
                type: "md",
                engine: "seo",
                title: "Seeded report",
                content: "# Seeded\n",
              },
            ],
          },
        }),
      ] as const,
    );
    await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
    await page.locator("[data-wb-drawer-button]").click();
    const dialog = page.getByRole("dialog", { name: /Artifacts/ });
    await expect(dialog).toBeVisible();
    // The seed has to have survived hydration, or the three row buttons below
    // would not exist and the sweep would measure an empty drawer.
    await expect(dialog.locator("[data-wb-artifact]")).toHaveCount(1);

    const swept = await sweep(page, DRAWER_TARGETS);
    expect(names(swept), "drawer target set").toEqual(
      [
        "button:Clear all",
        "button:Close",
        "button:Copy",
        "button:Download",
        "button:Remove",
      ].sort(),
    );
    expect(absent(swept), "drawer targets with no box").toEqual([]);
    expect(
      under(swept, MIN_TARGET_PX),
      `drawer targets under ${MIN_TARGET_PX}px`,
    ).toEqual([]);
    expect(overlaps(swept), "drawer targets sharing area").toEqual([]);
    expect(
      await operableFailures(page, DRAWER_TARGETS, swept),
      "drawer targets Playwright could not click",
    ).toEqual([]);
  });
}

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
  // The palette and the drawer render as siblings OUTSIDE #wb-app and return
  // null while closed, so the root-scoped scan above never sees their markup.
  // Scope to the Dialog root (`.wb-reset.fixed.inset-0.z-50`, the parent of the
  // backdrop + panel; the rail is `fixed` too but not `inset-0`): <body> also
  // carries Next's own elements (route announcer, dev portal) that set `style`
  // from script, which CSP does not block.
  const dialogRoot = page.locator(".wb-reset.fixed.inset-0.z-50");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog", { name: "Search and jump" }),
  ).toBeVisible();
  await expect(dialogRoot).toHaveCount(1);
  await expect(dialogRoot.locator("[style], style")).toHaveCount(0);
  await expect(dialogRoot).not.toHaveAttribute("style", /./);
  await page.keyboard.press("Escape");
  await page.locator("[data-wb-drawer-button]").click();
  await expect(page.getByRole("dialog", { name: /Artifacts/ })).toBeVisible();
  await expect(dialogRoot).toHaveCount(1);
  await expect(dialogRoot.locator("[style], style")).toHaveCount(0);
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
  // The only real action on the page. SettingsView.test.tsx pins the same count
  // in jsdom; this pins it on the page as served, with the notification and
  // data-sources blocks (T11) mounted beside it.
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

test("the project switcher stays inside its topbar row and shows a keyboard focus ring", async ({
  page,
}) => {
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  const topbar = page.locator("[data-app-shell-topbar]");
  const select = topbar.locator("select");
  // Above 960px the base switcher rule asked for 58px in a 56px row (1px out at
  // each edge). Below `xl` the row is the first row container; from `xl` up that
  // container is `display: contents` and the header itself is the row.
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(select).toBeVisible();
    const edges = await select.evaluate((node) => {
      const box = node.parentElement?.getBoundingClientRect();
      const row = node.closest('[data-wb-topbar-row="1"]');
      const container =
        row !== null && row.getClientRects().length > 0
          ? row
          : node.closest("[data-app-shell-topbar]");
      const outer = container?.getBoundingClientRect();
      return box && outer
        ? { top: box.top, bottom: box.bottom, height: box.height, rowTop: outer.top, rowBottom: outer.bottom }
        : null;
    });
    expect(edges, `${width}px: switcher and row boxes`).not.toBeNull();
    if (edges === null) continue;
    expect(edges.height, `${width}px: switcher height`).toBeGreaterThan(0);
    expect(edges.top, `${width}px: switcher top inside the row`).toBeGreaterThanOrEqual(edges.rowTop - 0.5);
    expect(edges.bottom, `${width}px: switcher bottom inside the row`).toBeLessThanOrEqual(edges.rowBottom + 0.5);
  }

  // The select is the control but sits at opacity 0.001, so the ring is drawn
  // on the switcher box; with no rule for it, keyboard focus showed nothing.
  await page.setViewportSize({ width: 1280, height: 800 });
  const ring = () => select.evaluate((node) => getComputedStyle(node.parentElement ?? node).boxShadow);
  expect(await ring(), "no ring before focus").toBe("none");
  await topbar.locator('a[href="/new-project"]').focus();
  await page.keyboard.press("Shift+Tab");
  await expect(select).toBeFocused();
  expect(await select.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
  await expect.poll(ring, "ring on keyboard focus").not.toBe("none");
});
