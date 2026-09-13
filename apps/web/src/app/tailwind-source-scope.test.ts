import { globSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { moduleFacts } from "./tailwind-source-extract.ts";
import {
  emittedVariables,
  isCovered,
  scanTailwindSources,
  unresolvedInputs,
  utilitiesInText,
  type Scan,
} from "./tailwind-source-scan.ts";

/**
 * Tailwind scan scope (PR-3 plan, Task 14). workbench.css imports the utilities
 * with `source(none)` and names what to scan with `@source`. Anything a file
 * outside those roots needs from Tailwind is then simply not generated: no build
 * error, no warning. Two things are needed, and both fail silently:
 *   - a utility class in a class string: the element renders unstyled;
 *   - a theme variable read through var() (a CSS Module doing
 *     `var(--color-slate-400, #94a3b8)`): under `@theme inline` the variable
 *     reaches :root only while a scanned file mentions it, so the rule drops to
 *     its fallback. The first cut of this change did exactly that to the topbar
 *     project switcher chevron, and only a computed-style diff showed it.
 * So this does not trust a file list. It walks every production module and
 * stylesheet under src/ (app/** included) and asks the installed Tailwind,
 * compiled from the shipped stylesheet, what they need. The roots are read back
 * from the compiler (`root` / `sources`), the two fields @tailwindcss/postcss
 * hands its file scanner, not re-parsed from text. Class inputs it cannot read
 * (an imported value from outside the roots, `top-${n}`) fail instead of
 * counting as empty.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(APP_DIR, "..");
const CSS_PATH = join(APP_DIR, "workbench.css");
const PACKAGES_DIR = resolve(SRC_DIR, "..", "..", "..", "packages");

/**
 * The scan roots, written out independently of workbench.css. The roots also
 * decide which files escape the outside-the-roots checks, so a wider `@source`
 * ("../components") would shrink what those checks look at and still pass,
 * while quietly undoing the point of this change (a smaller scan).
 */
const APPROVED_ROOTS = [
  join(SRC_DIR, "components", "workbench"),
  join(SRC_DIR, "components", "app-shell", "app-shell.module.css"),
];

// Floors, not counts: a walk that silently returns nothing (a wrong root, an
// extension filter that stopped matching, a glob that skips `[projectId]`) would
// otherwise pass every check below with zero files. Measured 2026-09-13: 106
// production .tsx under src/ (66 under app/), 291 distinct utilities inside the
// roots, 11 theme-variable reads across src/, 25 imported values read by class
// sinks (all resolving inside the roots).
const MIN_TSX = 100;
const MIN_APP_TSX = 60;
const MIN_COVERED_UTILITIES = 150;
const MIN_THEME_READS = 8;
const MIN_IMPORTED_VALUES = 15;
const MIN_PACKAGES = 5;

/**
 * Files outside the scan roots allowed to carry utilities, each entry with a
 * comment on why Tailwind does not need to generate them.
 * Deliberate exemptions: 0.
 */
const EXEMPT: Readonly<Record<string, readonly string[]>> = {};

let cached: Promise<Scan> | undefined;
function scan(): Promise<Scan> {
  cached ??= scanTailwindSources(SRC_DIR, CSS_PATH);
  return cached;
}

const SLOW = { timeout: 60_000 };
const FIX_HINT =
  "not generated: move it into components/workbench, or add an @source root for the file in workbench.css";

function nonEmpty(
  record: Readonly<Record<string, readonly string[]>>,
  keep: (file: string, value: string) => boolean,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(record)
      .map(([file, values]) => [file, values.filter((value) => keep(file, value))] as const)
      .filter(([, values]) => values.length > 0),
  );
}

describe("Tailwind scans only its @source roots, and nothing outside them needs more", () => {
  it("turns automatic source detection off and scans exactly the approved roots", SLOW, async () => {
    const { compilerRoot, roots } = await scan();
    // `null` here means automatic detection: every class-shaped word in apps/web.
    expect(compilerRoot).toBe("none");
    expect([...roots].sort()).toEqual([...APPROVED_ROOTS].sort());
    for (const root of roots) {
      expect(statSync(root, { throwIfNoEntry: false }), root).toBeDefined();
    }
  });

  it("walks every production module under src, app/** included", SLOW, async () => {
    const { files, roots } = await scan();
    const tsx = files
      .map((file) => relative(SRC_DIR, file))
      .filter((path) => path.endsWith(".tsx"));
    expect(tsx.length, "production .tsx under src/").toBeGreaterThanOrEqual(MIN_TSX);
    const appTsx = tsx.filter((path) => path.startsWith(`app${sep}`));
    expect(appTsx.length, "production .tsx under src/app/").toBeGreaterThanOrEqual(MIN_APP_TSX);
    // The file the plan names: the project layout is walked, outside the roots.
    const projectLayout = join(APP_DIR, "p", "[projectId]", "layout.tsx");
    expect(files).toContain(projectLayout);
    expect(isCovered(roots, projectLayout)).toBe(false);
  });

  it("recognises what the roots feed it (the checker is not blind)", SLOW, async () => {
    const { coveredUtilities, importedValueCount } = await scan();
    expect(coveredUtilities.size).toBeGreaterThanOrEqual(MIN_COVERED_UTILITIES);
    expect(coveredUtilities.has("flex")).toBe(true);
    expect(importedValueCount, "imported values read by class sinks").toBeGreaterThanOrEqual(MIN_IMPORTED_VALUES);
  });

  it("finds no Tailwind utility in any file outside the @source roots", SLOW, async () => {
    const { outsideUtilities } = await scan();
    const unexpected = nonEmpty(outsideUtilities, (file, token) => !(EXEMPT[file] ?? []).includes(token));
    expect(unexpected, `utilities ${FIX_HINT}`).toEqual({});
  });

  it("keeps no exemption that no longer matches anything", SLOW, async () => {
    const { outsideUtilities } = await scan();
    for (const [file, allowed] of Object.entries(EXEMPT)) {
      expect(outsideUtilities[file] ?? [], file).toEqual(expect.arrayContaining([...allowed]));
    }
  });

  it("leaves no class input it cannot see through", SLOW, async () => {
    const { unresolved } = await scan();
    expect(unresolved, "spell classes out in full, inside the roots").toEqual({});
  });

  it("puts every theme variable read anywhere in src into :root", SLOW, async () => {
    const { themeReads, emitted } = await scan();
    const reads = Object.values(themeReads).flat();
    expect(reads.length, "theme-variable reads found").toBeGreaterThanOrEqual(MIN_THEME_READS);
    const missing = nonEmpty(themeReads, (_file, name) => !emitted.has(name));
    expect(missing, `theme variables ${FIX_HINT}`).toEqual({});
  });

  it("imports Tailwind from workbench.css and no other stylesheet", () => {
    // A second entry would be scanned under its own rules, which nothing here reads.
    const importers = globSync("**/*.css", { cwd: SRC_DIR }).filter((path) =>
      /@import\s+["']tailwindcss/u.test(readFileSync(join(SRC_DIR, path), "utf8")),
    );
    expect(importers).toEqual([join("app", "workbench.css")]);
  });

  it("has no source kind the walk does not read: no JS or MDX in src, no components in workspace packages", () => {
    // The walk reads .ts / .tsx / .css under src/. A page could also render a
    // .jsx / .mdx module, or a component from a transpiled workspace package.
    expect(globSync("**/*.{js,jsx,mjs,cjs,mts,cts,mdx}", { cwd: SRC_DIR })).toEqual([]);
    const packages = globSync("*/package.json", { cwd: PACKAGES_DIR });
    expect(packages.length, "workspace packages found").toBeGreaterThanOrEqual(MIN_PACKAGES);
    expect(globSync("*/src/**/*.{tsx,jsx,mdx}", { cwd: PACKAGES_DIR })).toEqual([]);
  });
});

describe("the extractors on fixtures", () => {
  it("follows class attributes through conditionals, clsx keys and same-file constants", SLOW, async () => {
    const { isUtility } = await scan();
    const tsx = [
      'const tone = "hidden";',
      "export const A = ({ on }: { on: boolean }) => (",
      '  <div className={on ? "flex gap-2" : styles.card}>',
      '    <p className={tone} /><i className={clsx({ italic: on })} /><b className="sf-eyebrow" />',
      "  </div>",
      ");",
    ].join("\n");
    expect(utilitiesInText("fixture.tsx", tsx, isUtility)).toEqual(["flex", "gap-2", "hidden", "italic"]);
  });

  it("resolves the constant a sink reads by scope, so a shadowing local elsewhere cannot hide it", SLOW, async () => {
    const { isUtility } = await scan();
    const tsx = [
      'const tone = "collapse";',
      "export const A = () => <div className={tone} />;",
      'export function B() { const tone = "local-label"; return <span>{tone}</span>; }',
    ].join("\n");
    expect(utilitiesInText("fixture.tsx", tsx, isUtility)).toContain("collapse");
  });

  it("resolves names by scope, so an unrelated same-name local is not read as a class", SLOW, async () => {
    // Regression: following every declaration spelled `value` in
    // growth-map/_growth-map.tsx reported `${formatNumber(…)}%` from another
    // function as a glued class piece.
    const { roots } = await scan();
    const file = join(APP_DIR, "p", "fixture.tsx");
    const tsx = [
      'export function A({ value }: { value: string }) { return <div className={cx(styles.a, value === "x" && styles.b)} />; }',
      "export function B({ n }: { n: number }) { const value = `${n}%`; return <span>{value}</span>; }",
    ].join("\n");
    expect(unresolvedInputs(SRC_DIR, roots, file, moduleFacts(file, tsx))).toEqual([]);
  });

  it("reads classList and setAttribute(\"class\") as class sinks", SLOW, async () => {
    const { isUtility } = await scan();
    const module = 'export function f(el: Element) { el.classList.add("collapse"); el.setAttribute("class", "grow"); }';
    expect(utilitiesInText("fixture.ts", module, isUtility)).toEqual(["collapse", "grow"]);
  });

  it("flags class lists kept in constants, mixed with custom classes too, but not prose or CSS Module keys", SLOW, async () => {
    const { isUtility } = await scan();
    const constants = [
      'export const CARD = "rounded-lg border px-3";',
      'export const LEGACY = "legacy-card top-100";',
      'export const LABEL = "Open the table";',
      'export const VAR = "--color-slate-400";',
    ].join("\n");
    expect(utilitiesInText("fixture.ts", constants, isUtility)).toEqual(["border", "px-3", "rounded-lg", "top-100"]);
    expect(utilitiesInText("fixture.tsx", "<p className={styles.hidden} />", isUtility)).toEqual([]);
  });

  it("reports class inputs it cannot see through instead of reading them as empty", SLOW, async () => {
    const { roots } = await scan();
    const file = join(APP_DIR, "p", "fixture.tsx");
    const tsx = [
      'import styles from "./fixture.module.css";',
      'import { CARD } from "@/lib/legacy/classes";',
      'import { PANEL_SHELL } from "@/components/workbench/ui/panel.ts";',
      "export const A = ({ n }: { n: number }) => (",
      '  <div className={CARD}><p className={`top-${n}`} /><b className={"top-" + n} />',
      "  <i className={styles[`status${n}`]} /><u className={`${PANEL_SHELL} flex`} /></div>",
      ");",
      'export const read = (el: Element) => getComputedStyle(el).getPropertyValue("--color-wb-" + "rail");',
    ].join("\n");
    expect(unresolvedInputs(SRC_DIR, roots, file, moduleFacts(file, tsx))).toEqual([
      'imported class value CARD from "@/lib/legacy/classes"',
      "glued class piece `top-${n}`",
      'glued class piece "top-" + n',
      'computed property name getComputedStyle(el).getPropertyValue("--color-wb-" + "rail")',
    ]);
  });

  it("tells theme variables from other custom properties, and sees one go missing unscanned", SLOW, async () => {
    const { isThemeVariable } = await scan();
    const css = "/* var(--color-wb-rail) */ .a { color: var(--color-slate-400, #94a3b8); font: var( --font-wb, serif); }";
    expect(moduleFacts("fixture.css", css).propertyReads).toEqual(["--color-slate-400", "--font-wb"]);
    const script = 'export const c = (el: Element) => getComputedStyle(el).getPropertyValue("--color-slate-300");';
    expect(moduleFacts("fixture.ts", script).propertyReads).toEqual(["--color-slate-300"]);
    expect(["--color-slate-400", "--font-wb"].filter(isThemeVariable)).toEqual(["--color-slate-400"]);
    // The failure mode itself: nothing scanned mentions it, so :root lacks it.
    expect((await emittedVariables(CSS_PATH, [])).has("--color-slate-400")).toBe(false);
    expect((await emittedVariables(CSS_PATH, ["--color-slate-400"])).has("--color-slate-400")).toBe(true);
  });
});
