import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PROJECT_ID, installGrowthVerticalApi } from "./mock-api.ts";
import { PR3_VIEWS } from "./workbench-e2e.ts";

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
// child. At 1280px the clamp resolves to 42.24px; a view must stay at 0 because it
// carries its own padded root (Q26). All five PR-3 views are pinned, not just the
// overview: the gutter rule keys on the root's position and class, and a view
// whose root is wrapped (or lacks `.wb-reset`) would get the legacy gutter on top
// of its own padding.
test("legacy pages keep the old .main gutter and new views do not", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const mainBox = () =>
    page.evaluate(() => {
      const main = document.querySelector("#main-content");
      if (!main) return null;
      const cs = getComputedStyle(main);
      const root = main.querySelector(":scope > .wb-reset");
      return {
        paddingLeft: cs.paddingLeft,
        maxWidth: cs.maxWidth,
        viewRoots: main.querySelectorAll(":scope > .wb-reset").length,
        viewRootPaddingLeft: root ? getComputedStyle(root).paddingLeft : null,
      };
    });

  await page.goto(`/p/${E2E_PROJECT_ID}/growth-map`);
  await expect(page.locator("#main-content [data-app-page-title]").first()).toBeVisible();
  const legacy = await mainBox();
  expect(legacy, "growth-map: #main-content missing").not.toBeNull();
  expect(Number.parseFloat(legacy?.paddingLeft ?? "0")).toBeGreaterThanOrEqual(24);
  expect(legacy?.maxWidth).toBe("1480px");
  expect(legacy?.viewRoots, "growth-map: no workbench view root").toBe(0);

  for (const segment of PR3_VIEWS) {
    await page.goto(`/p/${E2E_PROJECT_ID}/${segment}`);
    await expect(page.locator("#main-content h1[data-wb-page-title]")).toBeVisible();
    const fresh = await mainBox();
    expect(fresh, `${segment}: #main-content missing`).not.toBeNull();
    expect(fresh?.paddingLeft, `${segment}: legacy gutter on a view`).toBe("0px");
    // The root that makes the gutter step aside: one `.wb-reset` directly under
    // <main>, carrying its own padding (md:p-10 at this width).
    expect(fresh?.viewRoots, `${segment}: .wb-reset view roots under <main>`).toBe(1);
    expect(fresh?.viewRootPaddingLeft, `${segment}: view root padding`).toBe("40px");
  }
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

/**
 * Computed font-family of every `.font-sans` element in the document. Not
 * scoped to #wb-root: anything that ends up outside it (a portal into <body>)
 * is exactly the element that would fall back, and a scoped query skips it.
 */
async function fontSansSweep(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".font-sans")].map((node) => getComputedStyle(node).fontFamily),
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
    // Untrimmed on purpose: "" is exactly "declared nowhere from :root down".
    fontSansOnHtml: getComputedStyle(document.documentElement).getPropertyValue("--font-sans"),
    onRoot: (() => {
      const root = document.getElementById("wb-root");
      return root ? getComputedStyle(root).getPropertyValue("--font-wb").trim() : null;
    })(),
  }));
  // The scenario this test exists for: the variable is scoped below <html>.
  expect(probe.onHtml, "--font-wb must not be defined on <html>").toBe("");
  expect(probe.onRoot, "#wb-root carries the next/font variable").toMatch(/Plus Jakarta Sans/u);
  // `.font-sans` carries its value inline under `@theme inline`, but any other
  // reader of var(--font-sans) that Tailwind finds in a scanned file (say an
  // arbitrary `[font-family:var(--font-sans)]` on a heading) makes it declare
  // `--font-sans` on :root, where `--font-wb` is undefined. That element falls
  // back while every `.font-sans` element swept below stays right, so this reads
  // the declaration itself: which element uses it, and whether it carries
  // `.font-sans`, does not matter. Needs a fresh dev server and dist directory to
  // mean anything after a change: the dev build keeps the candidates it has seen.
  expect(probe.fontSansOnHtml, "--font-sans must not be declared on :root").toBe("");
  // Sidebar, topbar and the view root at least; a sweep, not a list.
  const closed = await fontSansSweep(page);
  expect(closed.length).toBeGreaterThanOrEqual(3);
  for (const family of closed) {
    expect(family).toMatch(/Plus Jakarta Sans/u);
  }

  // A real overlay, opened the way a user opens it: the command palette is a
  // Dialog (its root carries font-sans) that ShellChrome renders beside #wb-app.
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  const open = await fontSansSweep(page);
  expect(open.length, "the open palette adds font-sans elements").toBeGreaterThan(closed.length);
  for (const family of open) {
    expect(family).toMatch(/Plus Jakarta Sans/u);
  }
});

// ConfirmDialog portals into #wb-root instead of <body> so that it inherits
// --font-wb. Two things jsdom cannot see follow from that. (1) `position: fixed`
// is relative to the viewport only while no ancestor establishes a containing
// block for it, and <body> never had such ancestors. Many properties establish
// one: transform, the standalone translate / rotate / scale that Tailwind v4
// compiles translate-* / rotate-* / scale-* to, perspective, transform-style:
// preserve-3d, filter, backdrop-filter, contain, content-visibility (any value
// but `visible` turns on containment without changing the computed `contain`),
// will-change, container-type, and whatever comes next. Three hard checks, each
// covering what the others cannot:
// - Geometry on #wb-root. #wb-root already fills the viewport from (0, 0), so a
//   probe positioned against it and one positioned against the viewport land in
//   the same box; the test moves #wb-root down first, and a probe that stays at
//   y = 0 is not positioned against #wb-root itself, whatever the property. That
//   says nothing about an ancestor that was not moved and has the viewport's box
//   (a wrapper at (0, 0), 100vh tall): the probe sits in the same place.
// - The property list, from #wb-root up to <html>: a listed property on any of
//   them fails. It once lacked transform-style and stayed green while a fixed
//   probe sat 53px off, so it is not enough on its own.
// - Document scroll, for the unmoved ancestor. The fixture appends a spacer so
//   the document really scrolls, then scrolls it by DOCUMENT_SCROLL. A containing
//   block on an ancestor in normal flow scrolls with the document and takes the
//   probe with it; against the viewport the probe stays at y = 0.
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

/** How far the test moves #wb-root down: any non-zero offset; 53px is the miss above. */
const WB_ROOT_SHIFT = 53;
/** How far the test scrolls the document: any non-zero offset. */
const DOCUMENT_SCROLL = 100;

test("a dialog root placed where ConfirmDialog portals covers the viewport in the workbench face", async ({ page }) => {
  expect(DIALOG_ROOT_CLASS).toMatch(/(?:^|\s)fixed(?:\s|$)/u);
  expect(DIALOG_ROOT_CLASS).toMatch(/(?:^|\s)inset-0(?:\s|$)/u);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/p/${E2E_PROJECT_ID}/overview`);
  await expect(page.locator("#main-content h1[data-wb-page-title]")).toBeVisible();

  const result = await page.evaluate(({ className, shift, scroll }) => {
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
        transformStyle: cs.transformStyle,
        filter: cs.filter,
        backdropFilter: cs.backdropFilter,
        contain: cs.contain,
        willChange: cs.willChange,
        containerType: cs.containerType,
      };
      const offending = Object.fromEntries(
        Object.entries(props).filter(([, value]) => !["none", "normal", "auto", "flat", ""].includes(value)),
      );
      // Not in `props`: `auto` is a default above but not here, where the initial
      // value is `visible` and anything else, `auto` included, turns on containment.
      const contentVisibility = cs.getPropertyValue("content-visibility");
      chain.push({
        el: node.tagName.toLowerCase() + (node.id ? "#" + node.id : ""),
        offending: contentVisibility === "visible" ? offending : { ...offending, contentVisibility },
      });
    }
    const probe = document.createElement("div");
    probe.className = className;
    // Exactly where the portal puts ConfirmDialog's root.
    root.append(probe);
    const box = () => {
      const rect = probe.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    window.scrollTo(0, 0);
    // margin-top moves #wb-root without making it a containing block for fixed
    // descendants (position: relative + top would not either; transform would).
    // Set through CSSOM rather than a style attribute, which CSP would govern.
    root.style.marginTop = `${shift}px`;
    const rootY = root.getBoundingClientRect().y;
    const shifted = box();
    const viewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
    // Control: a containing block that is really on #wb-root must carry the probe
    // down with it, or y === 0 above would prove nothing about this page.
    root.style.transform = "translateZ(0)";
    const contained = box();
    root.style.removeProperty("transform");
    root.style.removeProperty("margin-top");
    // Document scroll, #wb-root back in place. The spacer goes after everything,
    // so the document scrolls whatever the page's own height; both are undone.
    const spacer = document.createElement("div");
    spacer.style.height = `${3 * window.innerHeight}px`;
    document.body.append(spacer);
    window.scrollTo({ top: scroll, behavior: "instant" });
    const scrollY = window.scrollY;
    const scrolled = box();
    const scrolledViewport = {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    };
    // Control: a containing block on an element in normal flow scrolls away.
    root.style.transform = "translateZ(0)";
    const scrolledContained = box();
    root.style.removeProperty("transform");
    window.scrollTo({ top: 0, behavior: "instant" });
    spacer.remove();
    const fontFamily = getComputedStyle(probe).fontFamily;
    probe.remove();
    return { chain, rootY, shifted, viewport, contained, scrollY, scrolled, scrolledViewport, scrolledContained, fontFamily };
  }, { className: DIALOG_ROOT_CLASS, shift: WB_ROOT_SHIFT, scroll: DOCUMENT_SCROLL });

  expect(result, "#wb-root").not.toBeNull();
  expect(result!.chain[0]!.el).toBe("div#wb-root");
  expect(result!.chain.at(-1)!.el).toBe("html");
  expect(result!.rootY, "#wb-root moved down").toBe(WB_ROOT_SHIFT);
  expect(result!.contained.y, "control: a containing block on #wb-root carries the probe").toBe(WB_ROOT_SHIFT);
  // Geometry before the property list, so a property the list lacks fails here
  // when it is on #wb-root.
  expect(result!.shifted, "fixed probe under the portal target, #wb-root moved down").toEqual({
    x: 0,
    y: 0,
    ...result!.viewport,
  });
  expect(result!.scrollY, "fixture: the document scrolled").toBe(DOCUMENT_SCROLL);
  expect(result!.scrolledContained.y, "control: a containing block on #wb-root scrolls away").toBe(-DOCUMENT_SCROLL);
  // Also before the list: an unmoved ancestor in normal flow with a property the
  // list lacks fails here.
  expect(result!.scrolled, "fixed probe under the portal target, document scrolled").toEqual({
    x: 0,
    y: 0,
    ...result!.scrolledViewport,
  });
  for (const { el, offending } of result!.chain) {
    expect(offending, el + " establishes a containing block for fixed descendants").toEqual({});
  }
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
  // Empty intersection: `expect.not.arrayContaining(faceFiles)` only says "not
  // every one of them", and would accept a leaked preload of a single subset.
  expect((await preloadedFonts(page)).filter((file) => faceFiles.includes(file))).toEqual([]);
  expect(requested.filter((file) => faceFiles.includes(file))).toEqual([]);
});

// Not part of the baseline JSON on purpose: this pins a box property of <main>
// itself, on the one route whose <main> is the old AppShell's `.main`. Before
// Task 12 the workbench `#main-content:not(:has(> .wb-reset))` rule also matched
// here (in `@layer components`, so the unlayered module rule won, with the same
// values at every breakpoint); now workbench.css is not loaded at all and `.main`
// is the only source. The values are the old rule's, resolved per width.
test("/new-project keeps the .main gutter with workbench.css absent", async ({ page }) => {
  // All four sides plus the box properties the removed rule also declared, at
  // both inclusive boundaries (960 and 560) and inside each range.
  const box = (padding: string) => {
    const [top, right, bottom, left] = padding.split(" ");
    return { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left, maxWidth: "1480px", minWidth: "0px" };
  };
  const widths = [
    { width: 1280, expected: box("40px 42.24px 30px 42.24px") }, // clamp(24px, 3.3vw, 56px) at 1280px
    { width: 960, expected: box("28px 20px 36px 20px") }, // (max-width: 960px), boundary
    { width: 900, expected: box("28px 20px 36px 20px") },
    { width: 560, expected: box("24px 14px 32px 14px") }, // (max-width: 560px), boundary
    { width: 500, expected: box("24px 14px 32px 14px") },
  ] as const;
  await page.setViewportSize({ width: widths[0].width, height: 800 });
  await page.goto("/new-project");
  await expect(page.locator("#main-content [data-app-page-title]").first()).toBeVisible();
  expect(await stylesheetText(page), "workbench.css must not be loaded on /new-project").not.toMatch(
    WORKBENCH_MARKER,
  );

  for (const { width, expected } of widths) {
    await page.setViewportSize({ width, height: 800 });
    const measured = await page.evaluate(() => {
      const main = document.querySelector("#main-content");
      if (!main) return null;
      const cs = getComputedStyle(main);
      return {
        box: {
          paddingTop: cs.paddingTop,
          paddingRight: cs.paddingRight,
          paddingBottom: cs.paddingBottom,
          paddingLeft: cs.paddingLeft,
          maxWidth: cs.maxWidth,
          minWidth: cs.minWidth,
        },
        centred: cs.marginLeft === cs.marginRight,
      };
    });
    expect(measured?.box, `${width}px: #main-content box`).toEqual(expected);
    expect(measured?.centred, `${width}px: #main-content margin-inline auto`).toBe(true);
  }
});
