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

// Not part of the baseline sampling above (which reads elements *inside* <main>):
// the old AppShell's `.main` gave every project page `max-width: 1480px` and a
// `clamp(24px, 3.3vw, 56px)` gutter; ShellChrome's <main> is bare `flex-1`, and
// workbench.css restores the gutter only when <main> has no `.wb-reset` direct
// child. At 1280px the clamp resolves to 42.24px; a new placeholder view must stay
// at 0 because it carries its own `p-6 md:p-10 max-w-5xl` root.
test("legacy pages keep the old .main gutter and new views do not", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const mainBox = () =>
    page.evaluate(() => {
      const main = document.querySelector("#main-content");
      if (!main) return null;
      const cs = getComputedStyle(main);
      return { paddingLeft: cs.paddingLeft, maxWidth: cs.maxWidth };
    });

  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);
  await expect(page.locator("#main-content [data-app-page-title]").first()).toBeVisible();
  const legacy = await mainBox();
  expect(legacy, "growth-map: #main-content missing").not.toBeNull();
  expect(Number.parseFloat(legacy?.paddingLeft ?? "0")).toBeGreaterThanOrEqual(24);
  expect(legacy?.maxWidth).toBe("1480px");

  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await expect(page.locator("#main-content h1[data-wb-page-title]")).toBeVisible();
  const fresh = await mainBox();
  expect(fresh, "overview: #main-content missing").not.toBeNull();
  expect(fresh?.paddingLeft).toBe("0px");
});

// ---------------------------------------------------------------------------
// Task 12: workbench.css and the Plus Jakarta Sans face are mounted by
// app/p/[projectId]/layout.tsx, not the root layout. Three things can go wrong
// without any error, and each test below is the only thing that sees one.

/** Every stylesheet the document applies, as text, in document order. */
async function stylesheetText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [];
    for (const node of document.querySelectorAll("link[rel='stylesheet'], style")) {
      if (node instanceof HTMLLinkElement) {
        parts.push(await (await fetch(node.href)).text());
      } else {
        parts.push(node.textContent ?? "");
      }
    }
    return parts.join("\n");
  });
}

/** Paths of the files the `@font-face` rules for the workbench face load. */
function workbenchFaceFiles(css: string): string[] {
  const faces = css.match(/@font-face\s*\{[^}]*\}/gu) ?? [];
  return faces
    .filter((face) => /font-family:\s*['"]?[^;]*Plus Jakarta Sans/u.test(face))
    .flatMap((face) => [...face.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gu)].map((m) => m[1]!))
    .map((url) => new URL(url, "http://localhost").pathname);
}

async function preloadedFonts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>("link[rel='preload'][as='font']")].map(
      (link) => new URL(link.href).pathname,
    ),
  );
}

// Markers, each present in exactly one of the two stylesheets. The workbench one
// is a selector, not a theme variable: under `@theme inline` Tailwind emits a
// `:root` variable only while something still reads it through var(), so
// `--color-wb-rail` is not in the served CSS at all.
const WORKBENCH_MARKER = /\.wb-reset\s+:where\(/u;
const GLOBALS_MARKER = "--sf-ink-950:";

test("the workbench face reaches every font-sans element in the shell", async ({ page }) => {
  // `@theme` (not `inline`) would compile `.font-sans` to `var(--font-sans)`,
  // resolved at :root — where `--font-wb` no longer exists — so every element
  // below would compute to the system stack while the page looks fine.
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await expect(page.locator("#main-content h1[data-wb-page-title]")).toBeVisible();

  const probe = await page.evaluate(() => ({
    onHtml: getComputedStyle(document.documentElement).getPropertyValue("--font-wb").trim(),
    onRoot: (() => {
      const root = document.getElementById("wb-root");
      return root ? getComputedStyle(root).getPropertyValue("--font-wb").trim() : null;
    })(),
    families: [...document.querySelectorAll("#wb-root .font-sans")].map(
      (node) => getComputedStyle(node).fontFamily,
    ),
  }));
  // The scenario this test exists for: the variable is scoped below <html>.
  expect(probe.onHtml, "--font-wb must not be defined on <html>").toBe("");
  expect(probe.onRoot, "#wb-root carries the next/font variable").toMatch(/Plus Jakarta Sans/u);
  // Sidebar, topbar and the view root at least; a sweep, not a list.
  expect(probe.families.length).toBeGreaterThanOrEqual(3);
  for (const family of probe.families) {
    expect(family).toMatch(/Plus Jakarta Sans/u);
  }
});

// ConfirmDialog portals into #wb-root instead of <body> so that it inherits
// --font-wb. Two things jsdom cannot see follow from that. (1) `position: fixed`
// is relative to the viewport only while no ancestor establishes a containing
// block for it: transform, and the standalone translate / rotate / scale that
// Tailwind v4 compiles translate-* / rotate-* / scale-* to, perspective, filter,
// backdrop-filter, contain, will-change and container-type all do, and <body>
// never had such ancestors.
// (2) The face has to actually reach the portalled root. No view opens a
// ConfirmDialog yet (T7 wires the first; the real-dialog check belongs in T17),
// so this puts an element carrying the Dialog root classes, read from
// Dialog.tsx rather than copied so the two cannot drift, exactly where the
// portal puts it.
const DIALOG_ROOT_CLASS = (() => {
  const source = readFileSync(
    new URL("../apps/web/src/components/workbench/ui/Dialog.tsx", import.meta.url),
    "utf8",
  );
  const match = /if \(!open\) return null;\s*return \(\s*<div className="([^"]+)"/u.exec(source);
  if (!match) throw new Error("Dialog.tsx: root className not found; update this probe with the component");
  return match[1]!;
})();

test("a dialog root placed where ConfirmDialog portals covers the viewport in the workbench face", async ({ page }) => {
  expect(DIALOG_ROOT_CLASS).toMatch(/(?:^|\s)fixed(?:\s|$)/u);
  expect(DIALOG_ROOT_CLASS).toMatch(/(?:^|\s)inset-0(?:\s|$)/u);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await expect(page.locator("#main-content h1[data-wb-page-title]")).toBeVisible();

  const result = await page.evaluate((className) => {
    const root = document.getElementById("wb-root");
    if (!root) return null;
    const chain: { el: string; offending: Record<string, string> }[] = [];
    for (let node: Element | null = root; node; node = node.parentElement) {
      const cs = getComputedStyle(node);
      const props: Record<string, string> = {
        transform: cs.transform,
        translate: cs.translate,
        rotate: cs.rotate,
        scale: cs.scale,
        perspective: cs.perspective,
        filter: cs.filter,
        backdropFilter: cs.backdropFilter,
        contain: cs.contain,
        willChange: cs.willChange,
        containerType: cs.containerType,
      };
      chain.push({
        el: node.tagName.toLowerCase() + (node.id ? "#" + node.id : ""),
        offending: Object.fromEntries(
          Object.entries(props).filter(([, value]) => !["none", "normal", "auto", ""].includes(value)),
        ),
      });
    }
    const probe = document.createElement("div");
    probe.className = className;
    root.append(probe);
    const box = probe.getBoundingClientRect();
    const fontFamily = getComputedStyle(probe).fontFamily;
    probe.remove();
    return {
      chain,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      fontFamily,
    };
  }, DIALOG_ROOT_CLASS);

  expect(result, "#wb-root").not.toBeNull();
  expect(result!.chain[0]!.el).toBe("div#wb-root");
  expect(result!.chain.at(-1)!.el).toBe("html");
  for (const { el, offending } of result!.chain) {
    expect(offending, el + " establishes a containing block for fixed descendants").toEqual({});
  }
  expect(result!.box).toEqual({ x: 0, y: 0, ...result!.viewport });
  expect(result!.fontFamily).toMatch(/Plus Jakarta Sans/u);
});

test("/login loads neither the workbench stylesheet nor the workbench face", async ({ page }) => {
  // Positive control first, on a project page: without it every negative below
  // could pass because the probes simply cannot see stylesheets or preloads.
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await expect(page.locator("#main-content h1[data-wb-page-title]")).toBeVisible();
  const projectCss = await stylesheetText(page);
  const faceFiles = workbenchFaceFiles(projectCss);
  expect(faceFiles.length, "@font-face files for Plus Jakarta Sans on a project page").toBeGreaterThan(0);
  expect(projectCss).toMatch(WORKBENCH_MARKER);
  // globals.css used to precede workbench.css by line order in one layout; it is
  // now root layout before project layout. Same cascade, pinned where it is served.
  const globalsAt = projectCss.indexOf(GLOBALS_MARKER);
  expect(globalsAt).toBeGreaterThan(-1);
  expect(projectCss.search(WORKBENCH_MARKER)).toBeGreaterThan(globalsAt);
  const projectPreloads = await preloadedFonts(page);
  expect(
    projectPreloads.filter((file) => faceFiles.includes(file)).length,
    `a project page preloads the face (preloads: ${projectPreloads.join(", ")})`,
  ).toBeGreaterThan(0);

  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login(?:\?|$)/u);
  await expect(page.locator("h1")).toBeVisible();
  await page.waitForLoadState("networkidle");

  const loginCss = await stylesheetText(page);
  expect(loginCss).toContain(GLOBALS_MARKER);
  expect(loginCss).not.toMatch(WORKBENCH_MARKER);
  expect(loginCss).not.toContain("Plus Jakarta Sans");
  expect(await preloadedFonts(page)).toEqual(
    expect.not.arrayContaining(faceFiles),
  );
  expect(requested.filter((file) => faceFiles.includes(file))).toEqual([]);
});

// Not part of the baseline JSON on purpose: this pins a box property of <main>
// itself, on the one route whose <main> is the old AppShell's `.main`. Before
// Task 12 the workbench `#main-content:not(:has(> .wb-reset))` rule also matched
// here (in `@layer components`, so the unlayered module rule won, with the same
// values at every breakpoint); now workbench.css is not loaded at all and `.main`
// is the only source. The values are the old rule's, resolved per width.
test("/new-project keeps the .main gutter with workbench.css absent", async ({ page }) => {
  const widths = [
    { width: 1280, paddingLeft: "42.24px" }, // clamp(24px, 3.3vw, 56px) at 1280px
    { width: 900, paddingLeft: "20px" }, // (max-width: 960px)
    { width: 500, paddingLeft: "14px" }, // (max-width: 560px)
  ] as const;
  await page.setViewportSize({ width: widths[0].width, height: 800 });
  await page.goto("/new-project");
  await expect(page.locator("#main-content [data-app-page-title]").first()).toBeVisible();
  expect(await stylesheetText(page), "workbench.css must not be loaded on /new-project").not.toMatch(
    WORKBENCH_MARKER,
  );

  for (const { width, paddingLeft } of widths) {
    await page.setViewportSize({ width, height: 800 });
    const box = await page.evaluate(() => {
      const main = document.querySelector("#main-content");
      if (!main) return null;
      const cs = getComputedStyle(main);
      return { paddingLeft: cs.paddingLeft, maxWidth: cs.maxWidth };
    });
    expect(box, `${width}px: #main-content`).toEqual({ paddingLeft, maxWidth: "1480px" });
  }
});
