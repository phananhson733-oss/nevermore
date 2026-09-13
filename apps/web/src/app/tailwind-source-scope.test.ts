import { globSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  emittedVariables,
  isCovered,
  scanTailwindSources,
  utilitiesInText,
  variablesReadIn,
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
 * hands its file scanner, not re-parsed from text.
 */

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(APP_DIR, "..");
const CSS_PATH = join(APP_DIR, "workbench.css");

// Floors, not counts: a walk that silently returns nothing (a wrong root, an
// extension filter that stopped matching, a glob that skips `[projectId]`) would
// otherwise pass every check below with zero files. Measured 2026-09-13: 106
// production .tsx under src/ (66 under app/), 291 distinct utilities inside the
// roots, 11 theme-variable reads across src/.
const MIN_TSX = 100;
const MIN_APP_TSX = 60;
const MIN_COVERED_UTILITIES = 150;
const MIN_THEME_READS = 8;

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

describe("Tailwind scans only its @source roots, and nothing outside them needs more", () => {
  it("turns automatic source detection off and scans only roots that exist", SLOW, async () => {
    const { compilerRoot, roots } = await scan();
    // `null` here means automatic detection: every class-shaped word in apps/web.
    expect(compilerRoot).toBe("none");
    expect(roots.length).toBeGreaterThan(0);
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

  it("recognises the utilities inside the roots (the checker is not blind)", SLOW, async () => {
    const { coveredUtilities } = await scan();
    expect(coveredUtilities.size).toBeGreaterThanOrEqual(MIN_COVERED_UTILITIES);
    expect(coveredUtilities.has("flex")).toBe(true);
  });

  it("finds no Tailwind utility in any file outside the @source roots", SLOW, async () => {
    const { outsideUtilities } = await scan();
    const unexpected = Object.fromEntries(
      Object.entries(outsideUtilities)
        .map(([file, found]) => {
          const allowed = EXEMPT[file] ?? [];
          return [file, found.filter((token) => !allowed.includes(token))] as const;
        })
        .filter(([, found]) => found.length > 0),
    );
    expect(unexpected, `utilities ${FIX_HINT}`).toEqual({});
  });

  it("keeps no exemption that no longer matches anything", SLOW, async () => {
    const { outsideUtilities } = await scan();
    for (const [file, allowed] of Object.entries(EXEMPT)) {
      expect(outsideUtilities[file] ?? [], file).toEqual(expect.arrayContaining([...allowed]));
    }
  });

  it("puts every theme variable read anywhere in src into :root", SLOW, async () => {
    const { themeReads, emitted } = await scan();
    const reads = Object.values(themeReads).flat();
    expect(reads.length, "theme-variable reads found").toBeGreaterThanOrEqual(MIN_THEME_READS);
    const missing = Object.fromEntries(
      Object.entries(themeReads)
        .map(([file, names]) => [file, names.filter((name) => !emitted.has(name))] as const)
        .filter(([, names]) => names.length > 0),
    );
    expect(missing, `theme variables ${FIX_HINT}`).toEqual({});
  });

  it("imports Tailwind from workbench.css and no other stylesheet", () => {
    // A second entry would be scanned under its own rules, which nothing here reads.
    const importers = globSync("**/*.css", { cwd: SRC_DIR }).filter((path) =>
      /@import\s+["']tailwindcss/u.test(readFileSync(join(SRC_DIR, path), "utf8")),
    );
    expect(importers).toEqual([join("app", "workbench.css")]);
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

  it("flags a class list kept in a .ts constant but not prose or CSS Module keys", SLOW, async () => {
    const { isUtility } = await scan();
    const constants = 'export const CARD = "rounded-lg border px-3";\nexport const LABEL = "Open the table";';
    expect(utilitiesInText("fixture.ts", constants, isUtility)).toEqual(["border", "px-3", "rounded-lg"]);
    expect(utilitiesInText("fixture.tsx", "<p className={styles.hidden} />", isUtility)).toEqual([]);
  });

  it("tells theme variables from other custom properties, and sees one go missing unscanned", SLOW, async () => {
    const { isThemeVariable } = await scan();
    const css = ".a { color: var(--color-slate-400, #94a3b8); font: var( --font-wb, serif); }";
    expect(variablesReadIn(css)).toEqual(["--color-slate-400", "--font-wb"]);
    expect(variablesReadIn(css).filter(isThemeVariable)).toEqual(["--color-slate-400"]);
    // The failure mode itself: nothing scanned mentions it, so :root lacks it.
    expect((await emittedVariables(CSS_PATH, [])).has("--color-slate-400")).toBe(false);
    expect((await emittedVariables(CSS_PATH, ["--color-slate-400"])).has("--color-slate-400")).toBe(true);
  });
});
