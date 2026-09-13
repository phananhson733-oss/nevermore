/**
 * Everything a client module reaches through value imports is bundled, and
 * tree-shaking is not a boundary: `mock/find-lib.ts` reads `FIND_LIB.length` at
 * module top level, so importing any helper from a module that imports it drags
 * the whole audit rule library in. tsc and the unit tests are indifferent to how
 * a module is imported; only a build notices. This walks the static import graph
 * the way the bundler sees it (type-only clauses are erased, `await import(...)`
 * is a separate chunk) and pins what must stay out of the client.
 *
 * Two entry groups, two lists:
 * - The store (`hooks.ts`, `WorkbenchProvider.tsx`, and `selectors.ts`, imported
 *   by both) keeps out the rule library, the leak-phrase table, the artifact
 *   builders and the sample site.
 * - The five view roots and `ShellChrome` keep out only the sample site and the
 *   two modules nothing but it imports. The week and profile views reach the
 *   rule library and the builders on purpose today (`week-summary.ts ->
 *   mock/audit.ts`, `ui/ArtifactActions.tsx -> mock/builders/agent-task.ts`), so
 *   the store list would be red from the start. `mock/demo.ts` must arrive only
 *   through the `await import` in `LoadDemoButton.tsx`; the last test pins that
 *   the dynamic import is really there (T6 handover, Q13).
 * - Every entry keeps out Node-only bare specifiers (below).
 *
 * Blind spots: the walk stops at package boundaries, so a workspace package that
 * newly reaches Node through its own imports is not seen (`@sf/contracts` and
 * `@sf/i18n` are reached today and are not followed); `require()` and
 * `import x = require()` are not read.
 */
import { readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STORE_DIR = dirname(fileURLToPath(import.meta.url));
const WORKBENCH_DIR = resolve(STORE_DIR, "..");
/** `@/` in apps/web resolves to apps/web/src. */
const SRC_DIR = resolve(WORKBENCH_DIR, "../..");
const STORE_ENTRIES = ["selectors.ts", "WorkbenchProvider.tsx", "hooks.ts"].map(
  (file) => resolve(STORE_DIR, file),
);
const VIEW_ENTRIES = [
  "components/workbench/views/overview/OverviewView.tsx",
  "components/workbench/views/week/WeekView.tsx",
  "components/workbench/views/profile/ProfileView.tsx",
  "components/workbench/views/data-sources/DataSourcesView.tsx",
  "components/workbench/views/settings/SettingsView.tsx",
  "components/workbench/shell/ShellChrome.tsx",
].map((file) => resolve(SRC_DIR, file));
const CLIENT_ENTRIES = [...STORE_ENTRIES, ...VIEW_ENTRIES];
const DEMO_LOADER = resolve(
  SRC_DIR,
  "components/workbench/views/overview/LoadDemoButton.tsx",
);
const FIXTURE = resolve(
  STORE_DIR,
  "__fixtures__/view-with-static-demo-import.tsx",
);

/**
 * For each view entry, a file at least two imports below it (checked
 * 2026-09-14). Finding it proves the walk went through the entry's own subtree,
 * not just the entry file.
 */
const DEEP_REACH: readonly (readonly [entry: string, deep: string])[] = [
  // OverviewView -> LoadDemoButton -> demo-constants
  [
    "components/workbench/views/overview/OverviewView.tsx",
    "lib/workbench/mock/demo-constants.ts",
  ],
  // WeekView -> week-summary -> week-feed
  [
    "components/workbench/views/week/WeekView.tsx",
    "components/workbench/views/week/week-feed.ts",
  ],
  // ProfileView -> useProfileRun -> build-profile-doc
  [
    "components/workbench/views/profile/ProfileView.tsx",
    "components/workbench/views/profile/build-profile-doc.ts",
  ],
  // DataSourcesView -> DataSourcesPanel -> real-connections
  [
    "components/workbench/views/data-sources/DataSourcesView.tsx",
    "components/workbench/views/data-sources/real-connections.ts",
  ],
  // SettingsView -> SourcesSummaryBlock -> DataSourcesPanel -> real-connections
  [
    "components/workbench/views/settings/SettingsView.tsx",
    "components/workbench/views/data-sources/real-connections.ts",
  ],
  // ShellChrome -> CommandPalette -> workbench-nav
  [
    "components/workbench/shell/ShellChrome.tsx",
    "components/workbench/shell/workbench-nav.ts",
  ],
];

/**
 * Bare specifiers that cannot be bundled for the browser: Node builtins, and the
 * workspace packages whose entry reaches one (`@sf/engine -> @sf/sources ->
 * undici -> node:assert`; `@sf/db` is Postgres).
 */
const NODE_ONLY_PACKAGES = [
  "@sf/engine",
  "@sf/sources",
  "@sf/db",
  "undici",
] as const;

/** An `import`/`export ... from` clause. Group 1 is `type ` on a type-only clause; group 2 is the specifier. */
const FROM_CLAUSE =
  /^[ \t]*(?:import|export)[ \t]+(type[ \t]+)?(?:[\w$]+[ \t]*,?[ \t]*)?(?:\{[^}]*\}|\*(?:[ \t]+as[ \t]+[\w$]+)?)?[ \t]*from[ \t]*["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import[ \t]*["']([^"']+)["']/gm;
const DYNAMIC_DEMO_IMPORT =
  /await import\(\s*["']@\/lib\/workbench\/mock\/demo\.ts["']\s*\)/;

function isLocal(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("@/");
}

/** Every specifier of the value imports and re-exports in `source`, local or bare. */
function allValueSpecifiers(source: string): readonly string[] {
  const fromClauses = [...source.matchAll(FROM_CLAUSE)]
    .filter((match) => match[1] === undefined)
    .map((match) => match[2] ?? "");
  const sideEffects = [...source.matchAll(SIDE_EFFECT_IMPORT)].map(
    (match) => match[1] ?? "",
  );
  return [...fromClauses, ...sideEffects];
}

/** Local specifiers (relative or `@/`) of the value imports and re-exports in `source`. */
function valueSpecifiers(source: string): readonly string[] {
  return allValueSpecifiers(source).filter(isLocal);
}

function bareValueSpecifiers(source: string): readonly string[] {
  return allValueSpecifiers(source).filter((spec) => !isLocal(spec));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Throws on a local specifier it cannot resolve: a walker that skips those would
 * report a clean graph. Extensionless specifiers are tried as `.ts`, `.tsx` and
 * `index.*`, the bundler resolution tsconfig uses; 76 reachable imports rely on
 * it today (mostly `@/lib/workbench/...`, and `./client` inside `lib/api`).
 */
function resolveSpecifier(fromFile: string, spec: string): string {
  const base = spec.startsWith("@/")
    ? resolve(SRC_DIR, spec.slice(2))
    : resolve(dirname(fromFile), spec);
  const found = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ].find(isFile);
  if (found === undefined)
    throw new Error(`cannot resolve "${spec}" imported by ${fromFile}`);
  return found;
}

/** Every file reachable by value imports, mapped to the file that first imported it (`null` for entries). */
function reachableFrom(
  entries: readonly string[],
): ReadonlyMap<string, string | null> {
  const parents = new Map<string, string | null>(
    entries.map((entry) => [entry, null]),
  );
  const queue = [...entries];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const spec of valueSpecifiers(readFileSync(file, "utf8"))) {
      const target = resolveSpecifier(file, spec);
      if (parents.has(target)) continue;
      parents.set(target, file);
      queue.push(target);
    }
  }
  return parents;
}

function workbenchPath(file: string): string {
  return relative(WORKBENCH_DIR, file);
}

function srcPath(file: string): string {
  return relative(SRC_DIR, file);
}

/** `lib/workbench/store/selectors.ts -> lib/workbench/mock/kb.ts -> ...`, for a readable failure. */
function chainTo(
  parents: ReadonlyMap<string, string | null>,
  file: string,
): string {
  const up = parents.get(file);
  return up === null || up === undefined
    ? srcPath(file)
    : `${chainTo(parents, up)} -> ${srcPath(file)}`;
}

/** The store list. */
function isClientForbidden(file: string): boolean {
  const path = workbenchPath(file);
  return (
    path === "mock/find-lib.ts" ||
    path === "mock/demo-ai-leak-phrases.ts" ||
    path === "mock/demo.ts" ||
    path.startsWith("mock/builders/")
  );
}

/** The view list: the sample site and the two modules only it imports (grep, 2026-09-14). */
function isSampleSite(file: string): boolean {
  const path = workbenchPath(file);
  return (
    path === "mock/demo.ts" ||
    path === "mock/demo-artifacts.ts" ||
    path === "mock/demo-gsc.ts"
  );
}

function isNodeOnly(spec: string): boolean {
  return (
    spec.startsWith("node:") ||
    builtinModules.includes(spec) ||
    NODE_ONLY_PACKAGES.some(
      (name) => spec === name || spec.startsWith(`${name}/`),
    )
  );
}

/** `chain imports "spec"` for every Node-only bare import in the graph. */
function nodeOnlyImports(
  parents: ReadonlyMap<string, string | null>,
): readonly string[] {
  return [...parents.keys()].flatMap((file) =>
    bareValueSpecifiers(readFileSync(file, "utf8"))
      .filter(isNodeOnly)
      .map((spec) => `${chainTo(parents, file)} imports "${spec}"`),
  );
}

describe("import clause reader", () => {
  it("reads value imports and re-exports, and skips type-only clauses and dynamic imports", () => {
    const source = [
      'import type { A } from "./type-only.ts";',
      'import { b, type C } from "./value.ts";',
      'import {\n  d,\n  e,\n} from "./multi-line.ts";',
      'import Default, { f } from "./default-and-named.ts";',
      'export { g } from "./re-export.ts";',
      'export type { H } from "./type-re-export.ts";',
      'export * from "./star.ts";',
      'import "./side-effect.ts";',
      'import { useMemo } from "react";',
      'import type { Readable } from "node:stream";',
      'import { strict } from "node:assert";',
      'import { x } from "@/lib/alias";',
      'const { makeDemoSite } = await import("@/lib/workbench/mock/demo.ts");',
    ].join("\n");
    expect(new Set(valueSpecifiers(source))).toEqual(
      new Set([
        "./value.ts",
        "./multi-line.ts",
        "./default-and-named.ts",
        "./re-export.ts",
        "./star.ts",
        "./side-effect.ts",
        "@/lib/alias",
      ]),
    );
    expect(new Set(bareValueSpecifiers(source))).toEqual(
      new Set(["react", "node:assert"]),
    );
  });

  it("classifies Node builtins and Node-only packages, and leaves client packages alone", () => {
    expect(
      ["node:assert", "fs", "@sf/engine", "@sf/sources/crawl", "undici"].filter(
        isNodeOnly,
      ),
    ).toHaveLength(5);
    expect(
      [
        "react",
        "next-intl",
        "@sf/contracts",
        "@sf/i18n/config",
        "@sf/engineering",
      ].filter(isNodeOnly),
    ).toEqual([]);
  });
});

describe("client import graph of the workbench store", () => {
  it("walks from the store entries into the mock layer", () => {
    const reachable = [...reachableFrom(STORE_ENTRIES).keys()].map(
      workbenchPath,
    );
    expect(reachable.length).toBeGreaterThan(STORE_ENTRIES.length);
    expect(reachable).toContain("mock/keywords.ts");
    expect(reachable).toContain("mock/kb.ts");
  });

  it("sees the audit rule library behind mock/profile.ts (positive control)", () => {
    const parents = reachableFrom([resolve(WORKBENCH_DIR, "mock/profile.ts")]);
    expect(
      [...parents.keys()]
        .filter(isClientForbidden)
        .map((file) => chainTo(parents, file)),
    ).toContain(
      "lib/workbench/mock/profile.ts -> lib/workbench/mock/audit.ts -> lib/workbench/mock/find-lib.ts",
    );
  });

  it("never reaches the audit rule library, the leak-phrase table, the artifact builders, or the demo site", () => {
    const parents = reachableFrom(STORE_ENTRIES);
    const offenders = [...parents.keys()]
      .filter(isClientForbidden)
      .map((file) => chainTo(parents, file));
    expect(offenders).toEqual([]);
  });

  it("offers the demo constants without the demo site: demo-constants.ts imports nothing", () => {
    const source = readFileSync(
      resolve(WORKBENCH_DIR, "mock/demo-constants.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^[ \t]*import\b/m);
    expect(source).not.toMatch(/\bfrom[ \t]*["']/);
    expect(isClientForbidden(resolve(WORKBENCH_DIR, "mock/demo.ts"))).toBe(
      true,
    );
  });
});

describe("client import graph of the workbench views and shell", () => {
  const walked = reachableFrom(CLIENT_ENTRIES);

  it.each(DEEP_REACH)("walks %s down to %s", (entry, deep) => {
    // A root of the walk the gates below use, not just a file on disk.
    expect(walked.get(resolve(SRC_DIR, entry))).toBeNull();
    const own = [...reachableFrom([resolve(SRC_DIR, entry)]).keys()].map(
      srcPath,
    );
    expect(own).toContain(deep);
    expect(walked.has(resolve(SRC_DIR, deep))).toBe(true);
  });

  it("names a deep file for every view entry", () => {
    expect(DEEP_REACH.map(([entry]) => entry)).toEqual(
      VIEW_ENTRIES.map(srcPath),
    );
  });

  it("catches a view-shaped module that imports the sample site statically (control)", () => {
    const parents = reachableFrom([FIXTURE]);
    const offenders = [...parents.keys()]
      .filter(isSampleSite)
      .map((file) => chainTo(parents, file));
    const demo =
      "lib/workbench/store/__fixtures__/view-with-static-demo-import.tsx -> lib/workbench/mock/demo.ts";
    expect(offenders.toSorted()).toEqual([
      demo,
      `${demo} -> lib/workbench/mock/demo-artifacts.ts`,
      `${demo} -> lib/workbench/mock/demo-gsc.ts`,
    ]);
  });

  it("never reaches the sample site statically", () => {
    const offenders = [...walked.keys()]
      .filter(isSampleSite)
      .map((file) => chainTo(walked, file));
    expect(offenders).toEqual([]);
  });

  it("catches a Node-only import in a view-shaped module (control)", () => {
    expect(nodeOnlyImports(reachableFrom([FIXTURE]))).toContain(
      'lib/workbench/store/__fixtures__/view-with-static-demo-import.tsx imports "node:assert"',
    );
  });

  it("never reaches a Node builtin or a Node-only package from any client entry", () => {
    expect(nodeOnlyImports(walked)).toEqual([]);
  });

  it("loads the sample site through a dynamic import in the loader", () => {
    expect(walked.has(DEMO_LOADER)).toBe(true);
    expect(readFileSync(DEMO_LOADER, "utf8")).toMatch(DYNAMIC_DEMO_IMPORT);
  });
});
