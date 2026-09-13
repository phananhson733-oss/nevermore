import { globSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isCovered, scanTailwindSources, type Scan } from "./tailwind-source-scan.ts";

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
 * stylesheet under apps/web/src (app/** included) and packages/*\/src, and asks
 * the installed Tailwind, compiled from the shipped stylesheet, what they need.
 * The roots are read back from the compiler (`root` / `sources`), the two fields
 * @tailwindcss/postcss hands its file scanner. A class value it cannot follow
 * (a parameter, a call, an import defined outside the roots, `top-${n}`) fails
 * instead of counting as empty. The reader itself is pinned on fixtures in
 * tailwind-source-extract.test.ts.
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

/**
 * Deliberately not walked, 2 files: generated from the OpenAPI contract and from
 * a DataForSEO location dump. Data, no markup; parsing them costs more than the
 * rest of packages/ together.
 */
const SKIPPED_GENERATED = [
  join("packages", "contracts", "src", "generated", "openapi.ts"),
  join("packages", "sources", "src", "dataforseo", "generated", "labs-locations.ts"),
];

// Floors, not counts: a walk that silently returns nothing (a wrong root, an
// extension filter that stopped matching, a glob that skips `[projectId]`) would
// otherwise pass every check below with zero files. Measured 2026-09-14: 108
// production .tsx under src/ (66 under app/), 421 walked files under packages/,
// 306 distinct utilities inside the roots, 11 theme-variable reads, 37 imports
// read by class values (all defined inside the roots).
const MIN_TSX = 100;
const MIN_APP_TSX = 60;
const MIN_PACKAGE_FILES = 380;
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
  cached ??= scanTailwindSources({ srcDir: SRC_DIR, packagesDir: PACKAGES_DIR, cssPath: CSS_PATH });
  return cached;
}

const SLOW = { timeout: 90_000 };
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

function stringsIn(value: unknown): readonly string[] {
  if (typeof value === "string") return [value];
  return value !== null && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];
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

  it("walks every production module under src (app/** included) and packages/*/src", SLOW, async () => {
    const { files, roots, skipped } = await scan();
    const tsx = files.filter((path) => path.endsWith(".tsx") && !path.startsWith(`packages${sep}`));
    expect(tsx.length, "production .tsx under src/").toBeGreaterThanOrEqual(MIN_TSX);
    const appTsx = tsx.filter((path) => path.startsWith(`app${sep}`));
    expect(appTsx.length, "production .tsx under src/app/").toBeGreaterThanOrEqual(MIN_APP_TSX);
    const packageFiles = files.filter((path) => path.startsWith(`packages${sep}`));
    expect(packageFiles.length, "walked files under packages/").toBeGreaterThanOrEqual(MIN_PACKAGE_FILES);
    expect([...skipped].sort()).toEqual([...SKIPPED_GENERATED].sort());
    // The file the plan names: the project layout is walked, outside the roots.
    expect(files).toContain(join("app", "p", "[projectId]", "layout.tsx"));
    expect(isCovered(roots, join(APP_DIR, "p", "[projectId]", "layout.tsx"))).toBe(false);
  });

  it("recognises what the roots feed it (the checker is not blind)", SLOW, async () => {
    const { coveredUtilities, importedValueCount } = await scan();
    expect(coveredUtilities.size).toBeGreaterThanOrEqual(MIN_COVERED_UTILITIES);
    expect(coveredUtilities.has("flex")).toBe(true);
    expect(importedValueCount, "imports read by class values").toBeGreaterThanOrEqual(MIN_IMPORTED_VALUES);
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

  it("puts every theme variable read anywhere it walks into :root", SLOW, async () => {
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

  it("has no source the walk does not read: no JS or MDX, and no package code outside its src/", () => {
    const unread = "**/*.{js,jsx,mjs,cjs,mts,cts,mdx}";
    expect(globSync(unread, { cwd: SRC_DIR })).toEqual([]);
    expect(globSync(`*/src/${unread}`, { cwd: PACKAGES_DIR })).toEqual([]);
    const manifests = globSync("*/package.json", { cwd: PACKAGES_DIR });
    expect(manifests.length, "workspace packages found").toBeGreaterThanOrEqual(MIN_PACKAGES);
    const outsideSrc = manifests.flatMap((manifest) => {
      const json: unknown = JSON.parse(readFileSync(join(PACKAGES_DIR, manifest), "utf8"));
      const fields = json !== null && typeof json === "object" ? json : {};
      const targets = ["exports", "main", "module", "browser"].flatMap((key) => stringsIn(Reflect.get(fields, key)));
      return targets
        .filter((target) => !target.startsWith("./src/") && target !== "./package.json")
        .map((target) => `${manifest}: ${target}`);
    });
    expect(outsideSrc, "package entry points the walk does not read").toEqual([]);
  });
});
