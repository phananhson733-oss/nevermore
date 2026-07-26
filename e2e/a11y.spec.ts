import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { seedProject, type SeededProject } from "./fixtures.ts";

/**
 * AC-043 — accessibility. Each key screen must pass an axe scan (no critical or
 * serious violations), expose a keyboard-reachable focus path into the primary
 * navigation, and honour prefers-reduced-motion. axe covers colour contrast,
 * landmark/heading structure, name-role-value, and form labelling; the keyboard
 * and reduced-motion checks cover what static scanning cannot.
 */

// A representative cross-section of the app: shell + data-heavy + delivery views.
/**
 * The destinations the product actually ships, named as themselves.
 *
 * This list read `diagnosis, plan, studio, report` until 2026-07-26, and all
 * four of those are `redirect()` pages (`plan` and `studio` both to
 * `execution`, `diagnosis` to `growth-map`, `report` to `results`). Coverage
 * was therefore accidental and the test names were false — "diagnosis has no
 * critical/serious axe violations" was scanning Growth Map — while `execution`
 * was scanned twice under two names and no name in the list matched a route
 * that renders. Same six screens are covered, one scan fewer, and a screen can
 * no longer be lost silently by a redirect being deleted.
 */
const SCREENS = [
  "overview",
  "context",
  "sources",
  "growth-map",
  "execution",
  "results",
] as const;

let project: SeededProject;

test.beforeAll(async ({ request }) => {
  project = await seedProject(request);
  // Warm the dev compiler for every screen so no axe test hits a cold
  // on-demand compile — the first paint of an uncompiled route in `next dev`
  // can briefly serve a shell without the root layout's <html lang>/<title>,
  // which axe would then false-flag (both are present once compiled).
  for (const screen of SCREENS) {
    await request.get(`/p/${project.projectId}/${screen}`);
  }
});

async function gotoScreen(page: Page, screen: string): Promise<void> {
  await page.goto(`/p/${project.projectId}/${screen}`);
  await expect(page.getByRole("main")).toBeVisible();
  // The root layout emits <html lang> and <title> in SSR; wait for the settled
  // document so a dev-mode first-compile paint cannot race the axe scan (both
  // attributes are present in the served HTML — this waits, it does not mask).
  await page.waitForFunction(
    () =>
      document.title.trim().length > 0 &&
      document.documentElement.lang.trim().length > 0,
  );
}

/** Is this axe node inside the project sidebar? (DOM check, not selector text.) */
async function nodeInSidebar(
  page: Page,
  target: readonly string[],
): Promise<boolean> {
  const selector = target.join(" ");
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && !!el.closest('[class*="sidebar"]');
  }, selector);
}

for (const screen of SCREENS) {
  test(`${screen} has no critical/serious axe violations`, async ({ page }) => {
    await gotoScreen(page, screen);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // axe cannot composite a background through the `position: sticky` dark
    // sidebar, so it reports the page paper (#f8f6f1) instead of --sf-ink-950
    // (#111923) and false-flags color-contrast on the white sidebar text
    // (verified: static-position sidebar -> 0 violations; real ratio ~15:1).
    // Drop ONLY color-contrast nodes inside the sidebar; the sidebar's real
    // contrast is asserted deterministically below, and every other rule (and
    // all main-content contrast) is still enforced.
    const blocking: string[] = [];
    for (const v of results.violations) {
      if (v.impact !== "critical" && v.impact !== "serious") continue;
      if (v.id === "color-contrast") {
        for (const n of v.nodes) {
          if (!(await nodeInSidebar(page, n.target as string[]))) {
            blocking.push(`${v.id} @ ${n.target.join(" ")}`);
          }
        }
      } else {
        blocking.push(`${v.id} (${v.impact})`);
      }
    }
    expect(blocking, `axe violations on ${screen}`).toEqual([]);
  });
}

/**
 * The dark sidebar's contrast is proven directly (axe can't, see above): every
 * visible sidebar text node's rendered foreground vs its effective background
 * must meet the WCAG AA ratio for its size (4.5:1 normal, 3:1 large/bold).
 */
test("sidebar text meets the WCAG AA contrast ratio", async ({ page }) => {
  await gotoScreen(page, "overview");
  const failures = await page.evaluate(() => {
    const srgb = (c: number): number => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (r: number, g: number, b: number): number =>
      0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
    const parse = (v: string): [number, number, number, number] => {
      const m = v.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
      return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 1];
    };
    const effectiveBg = (el: Element): [number, number, number] => {
      const layers: [number, number, number, number][] = [];
      let node: Element | null = el;
      while (node) {
        layers.push(parse(getComputedStyle(node).backgroundColor));
        node = node.parentElement;
      }

      // CSS backgrounds may be translucent (the active sidebar row is white at
      // low alpha over the opaque ink sidebar). Composite every layer from the
      // root inward; treating the first non-transparent layer as opaque turns
      // rgba(255 255 255 / 0.1) into pure white and produces a false 1:1 ratio.
      let out: [number, number, number] = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse()) {
        out = [
          r * a + out[0] * (1 - a),
          g * a + out[1] * (1 - a),
          b * a + out[2] * (1 - a),
        ];
      }
      return out;
    };
    const sidebar = document.querySelector('[class*="sidebar"]');
    if (!sidebar) return ["no sidebar"];
    const out: string[] = [];
    for (const el of sidebar.querySelectorAll("a, span, p, h1, h2, button")) {
      const text = (el.textContent ?? "").trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      const [fr, fg, fb, fa] = parse(cs.color);
      if (fa === 0) continue;
      const [br, bg, bb] = effectiveBg(el);
      // Blend the (possibly opacity-reduced) foreground over the background.
      const op = parseFloat(cs.opacity || "1") * fa;
      const cr = fr * op + br * (1 - op);
      const cg = fg * op + bg * (1 - op);
      const cb = fb * op + bb * (1 - op);
      const l1 = lum(cr, cg, cb);
      const l2 = lum(br, bg, bb);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = px >= 24 || (px >= 18.66 && bold);
      const min = large ? 3 : 4.5;
      if (ratio < min) {
        out.push(`"${text.slice(0, 20)}" ratio ${ratio.toFixed(2)} < ${min}`);
      }
    }
    return out;
  });
  expect(failures, "sidebar contrast failures").toEqual([]);
});

test("keyboard focus reaches an interactive control from the top of the page", async ({
  page,
}) => {
  await gotoScreen(page, "overview");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  // Tab a bounded number of times; a reachable interactive control (link/button/
  // input) must gain focus — a keyboard-only operator must not be trapped.
  let reached = false;
  for (let i = 0; i < 20 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return false;
      const tag = el.tagName.toLowerCase();
      return (
        tag === "a" ||
        tag === "button" ||
        tag === "input" ||
        tag === "select" ||
        tag === "textarea" ||
        el.getAttribute("tabindex") === "0"
      );
    });
  }
  expect(reached, "keyboard Tab should reach an interactive control").toBe(
    true,
  );
});

test("prefers-reduced-motion is honoured by the render context", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoScreen(page, "overview");
  const reduced = await page.evaluate(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  expect(reduced).toBe(true);
  // No element may declare a long-running (>0.1s) infinite animation under the
  // reduced-motion preference — that is the concrete regression the media query
  // is meant to prevent.
  const hasInfiniteAnimation = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("*")).some((el) => {
      const s = getComputedStyle(el);
      return (
        s.animationIterationCount === "infinite" &&
        parseFloat(s.animationDuration) > 0.1
      );
    });
  });
  expect(hasInfiniteAnimation).toBe(false);
});

test("report print media hides only the application shell chrome", async ({
  page,
}) => {
  await page.emulateMedia({ media: "print" });
  await gotoScreen(page, "report");

  await expect(page.locator("[data-app-shell-sidebar]")).toBeHidden();
  await expect(page.locator("[data-app-shell-topbar]")).toBeHidden();
  await expect(page.locator("[data-report-page]")).toBeVisible();
  await expect(page.locator("[data-report-page] h1")).toBeVisible();
});
