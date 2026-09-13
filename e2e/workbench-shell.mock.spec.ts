import { expect, test, type Locator, type Page } from "@playwright/test";
import { initialProjectState } from "../apps/web/src/lib/workbench/store/reducer.ts";
import { storageKey } from "../apps/web/src/lib/workbench/store/persistence.ts";
import { PERSISTED_VERSION } from "../apps/web/src/lib/workbench/store/schema.ts";
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

/* ------------------------------------------------------------------ *
 * WCAG 2.5.8 Target Size (Minimum): 24 x 24 CSS px.
 *
 * Every axe run in this repository stops at `wcag21aa`, and axe tags
 * `target-size` `wcag22aa` — so no scan here has ever evaluated this rule and
 * the "touch targets are covered by axe" belief was empty (裁决 Q29). This
 * sweep is the check.
 *
 * Scope is the shell's own chrome (rail + topbar + the artifact drawer) plus
 * `[data-wb-legacy-link]`, the one shared affordance the shell owns that
 * renders inside a view. `<main>` is deliberately NOT swept: view bodies are
 * each view task's own gate, and a sweep reaching into them would police work
 * this file does not own.
 * ------------------------------------------------------------------ */

const MIN_TARGET_PX = 24;

/** Comfortable touch size (iOS HIG / Material). Held only where noted below. */
const TOUCH_TARGET_PX = 44;

/**
 * One selector, not a hand-written element list: the sweep has to find a button
 * somebody adds tomorrow by itself. The counted assertions below are what stops
 * it from silently matching nothing.
 */
const SHELL_TARGETS = [
  "#wb-sidebar :is(button, a[href]):not([hidden])",
  "[data-app-shell-topbar] :is(button, a[href]):not([hidden])",
  "a[href][data-wb-legacy-link]",
].join(", ");

/**
 * `:not([hidden])` above drops exactly one kind of element, and this is it:
 * `ProjectSwitcher` keeps a `hidden aria-hidden tabIndex={-1}` <Link> per other
 * project and clicks it from the <select>'s onChange so the unsaved-editor
 * guards still see a real navigation. Not perceivable, not focusable, not in
 * the accessibility tree — WCAG 2.5.8 has nothing to say about it. Counted, not
 * quietly filtered: one proxy per non-current project, and the mock fixture
 * ships two projects.
 */
const HIDDEN_PROXY_LINKS = 1;

const DRAWER_TARGETS = '[role="dialog"] :is(button, a[href])';

interface SweptTarget {
  readonly name: string;
  /** `null` when the element has no box at this viewport (`display:none`). */
  readonly box: { readonly width: number; readonly height: number } | null;
}

/**
 * A stable name for one target. Data hooks first, then the accessible name,
 * then the text. A `<kbd>` shortcut hint is stripped: it is not part of the
 * control's name, and after the ⌘K work it reads differently per platform, so
 * leaving it in would make this sweep's expectations host-dependent.
 */
async function targetName(target: Locator): Promise<string> {
  return target.evaluate((node) => {
    const rail = node.getAttribute("data-wb-nav");
    if (rail !== null) return `rail:${rail}`;
    const legacy = node.getAttribute("data-wb-legacy-link");
    if (legacy !== null) return `legacy:${legacy}`;
    if (node.hasAttribute("data-wb-drawer-button")) return "topbar:artifacts";
    const ariaLabel = node.getAttribute("aria-label");
    if (ariaLabel !== null) return `${node.tagName.toLowerCase()}:${ariaLabel}`;
    const clone = node.cloneNode(true) as Element;
    for (const kbd of clone.querySelectorAll("kbd")) kbd.remove();
    const text = (clone.textContent ?? "").replace(/\s+/gu, " ").trim();
    return `${node.tagName.toLowerCase()}:${text.slice(0, 32)}`;
  });
}

async function sweep(
  page: Page,
  selector: string,
): Promise<readonly SweptTarget[]> {
  const found = await page.locator(selector).all();
  const swept: SweptTarget[] = [];
  for (const target of found) {
    const [name, box] = await Promise.all([
      targetName(target),
      target.boundingBox(),
    ]);
    swept.push({
      name,
      box: box === null ? null : { width: box.width, height: box.height },
    });
  }
  return swept;
}

/** `name WxH` for every target that has a box smaller than `min` on either axis. */
function under(
  swept: readonly SweptTarget[],
  min: number,
  only?: readonly string[],
): readonly string[] {
  return swept
    .filter((t) => only === undefined || only.includes(t.name))
    .flatMap((t) =>
      t.box !== null && (t.box.width < min || t.box.height < min)
        ? [`${t.name} ${t.box.width}x${t.box.height}`]
        : [],
    );
}

function absent(swept: readonly SweptTarget[]): readonly string[] {
  return swept.flatMap((t) => (t.box === null ? [t.name] : [])).sort();
}

function names(swept: readonly SweptTarget[]): readonly string[] {
  return swept.map((t) => t.name).sort();
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

/**
 * Targets whose display utility removes them entirely at one viewport, so
 * `boundingBox()` is `null` and there is nothing to measure. The WCAG 2.5.8
 * exceptions are listed with them, each with its reason:
 *
 * - "inline" (a target inside a sentence, sized by the line height): 0 in
 *   scope. Every link here is a standalone control in a flex row, so none of
 *   them earns that exception; the empty list is asserted, so the first one
 *   somebody adds has to be argued for here rather than slipping through.
 * - "equivalent", "user agent control", "essential": 0 in scope.
 */
const ABSENT_AT: Readonly<Record<"desktop" | "mobile", readonly string[]>> = {
  // `md:hidden`: from `md` up the rail is permanent, so its toggle is gone.
  desktop: ["button:Open navigation"],
  // `hidden sm:inline` and `hidden md:flex`.
  mobile: ["a:+ New site", "button:Search / jump"],
};

/** WCAG 2.5.8 "inline" exception holders in scope. Deliberately none. */
const INLINE_EXCEPTIONS: readonly string[] = [];

/**
 * The two controls a phone user reaches for first are held to 44px rather than
 * the 24px floor. Both are topbar controls that are only ever touched below
 * `md`; the desktop rendering keeps its original density.
 */
const TOUCH_44_AT_MOBILE: readonly string[] = [
  "button:Open navigation",
  "topbar:artifacts",
];

test("shell chrome clears WCAG 2.5.8's 24px target minimum on desktop and mobile", async ({
  page,
}) => {
  // `/profile` is the page with two legacy links (LEGACY_LINKS.profile), so one
  // navigation covers the shared affordance as well as the shell's own chrome.
  await page.goto(`/p/${E2E_PROJECT_ID}/profile`);
  await expect(page.locator("h1[data-wb-page-title]")).toHaveCount(1);
  await expect(
    page.locator("[data-app-shell-topbar] a[href][hidden]"),
  ).toHaveCount(HIDDEN_PROXY_LINKS);

  for (const [viewport, size] of [
    ["desktop", { width: 1280, height: 800 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    await page.setViewportSize(size);
    const swept = await sweep(page, SHELL_TARGETS);
    expect(names(swept), `${viewport}: swept target set`).toEqual(
      SHELL_TARGET_NAMES,
    );
    expect(absent(swept), `${viewport}: targets with no box`).toEqual(
      [...ABSENT_AT[viewport]].sort(),
    );
    expect(
      under(swept, MIN_TARGET_PX),
      `${viewport}: targets under ${MIN_TARGET_PX}px`,
    ).toEqual(INLINE_EXCEPTIONS);
  }

  expect(
    under(
      await sweep(page, SHELL_TARGETS),
      TOUCH_TARGET_PX,
      TOUCH_44_AT_MOBILE,
    ),
    `mobile: controls held to ${TOUCH_TARGET_PX}px`,
  ).toEqual([]);
});

test("artifact drawer rows clear the 24px target minimum", async ({ page }) => {
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
