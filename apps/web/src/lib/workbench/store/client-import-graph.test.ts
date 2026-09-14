/**
 * Everything a client module reaches through value imports is bundled, and
 * tree-shaking is not a boundary: `mock/find-lib.ts` reads `FIND_LIB.length` at
 * module top level, so importing any helper from a module that imports it drags
 * the whole audit rule library in. tsc and the unit tests are indifferent to how
 * a module is imported; only a build notices. This parses every module it walks
 * with the TypeScript parser and reads its import edges the way the bundler sees
 * them. Type-only clauses are erased. `import`/`export ... from` and
 * `import x = require()` are static edges. `import("...")` and `require("...")`
 * with a literal argument are dynamic edges: a separate chunk, still shipped to
 * the browser.
 *
 * Entry groups, what each keeps out, and over which edges:
 * - The store (`hooks.ts`, `WorkbenchProvider.tsx`, and `selectors.ts`, imported
 *   by both) keeps out the rule library, the leak-phrase table, the artifact
 *   builders and the sample site. Static edges only.
 * - The five view roots and `ShellChrome` keep out only the sample site and the
 *   two modules nothing but it imports. The week and profile views reach the
 *   rule library and the builders on purpose today (`week-summary.ts ->
 *   mock/audit.ts`, `ui/ArtifactActions.tsx -> mock/builders/agent-task.ts`), so
 *   the store list would be red from the start. Static edges only, on purpose:
 *   `mock/demo.ts` must arrive through the `await import` in
 *   `LoadDemoButton.tsx` (T6 handover, Q13), so a walk over dynamic edges reaches
 *   it by design. The last test pins that `LoadDemoButton.tsx` holds an
 *   `import()` call whose argument is exactly `@/lib/workbench/mock/demo.ts`. It
 *   proves the call is in the code rather than in a comment; it does not prove
 *   the call runs only on click.
 * - Every entry keeps out Node-only bare specifiers (below), over static and
 *   dynamic edges, following dynamic edges into local modules as well: a lazily
 *   loaded chunk that reaches `node:fs` breaks the client build all the same.
 * - An `import()` or `require()` whose argument is not a literal cannot be
 *   followed. The walk does not skip it: every one reachable over static and
 *   dynamic edges is listed by a test that fails while the list is not empty
 *   (none today, 2026-09-14).
 * - `components/workbench/ui/` imports nothing from `components/workbench/shell/`
 *   (Q35): pinned in `ui-shell-import-gate.test.ts`, with its own blind spots.
 *
 * The reader and the walk are `import-graph-walker.ts`, shared with that file.
 *
 * Blind spots:
 * - the walk stops at package boundaries, so a workspace package that newly
 *   reaches Node through its own imports is not seen (`@sf/contracts` and
 *   `@sf/i18n` are reached today and are not followed);
 * - the sample-site gate ignores dynamic edges, so a second `import()` of the
 *   sample site from any other client module, even one that runs at module top
 *   level, is not seen;
 * - loaders that are neither `import()` nor `require()`, such as
 *   `new Worker(new URL("./x.ts", import.meta.url))`, are not read.
 */
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  chainTo,
  type Follow,
  importsOf,
  isLocal,
  nonLiteralLoads,
  type Parents,
  reachableFrom,
  readImports,
  SRC_DIR,
  srcPath,
  WORKBENCH_DIR,
  workbenchPath,
} from "./import-graph-walker.ts";

const STORE_DIR = dirname(fileURLToPath(import.meta.url));
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
const DEMO_SITE_SPECIFIER = "@/lib/workbench/mock/demo.ts";
const FIXTURE = resolve(
  STORE_DIR,
  "__fixtures__/view-with-static-demo-import.tsx",
);
const DYNAMIC_FIXTURE = resolve(
  STORE_DIR,
  "__fixtures__/view-with-dynamic-imports.tsx",
);

const STORE_GATE_EDGES: Follow = "static";
const SAMPLE_GATE_EDGES: Follow = "static";
const NODE_GATE_EDGES: Follow = "static-and-dynamic";

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

function staticSpecifiers(source: string): readonly string[] {
  return readImports(source, "reader-input.ts")
    .edges.filter((found) => found.kind === "static")
    .map((found) => found.spec);
}

/** Local specifiers (relative or `@/`) of the static value imports and re-exports in `source`. */
function valueSpecifiers(source: string): readonly string[] {
  return staticSpecifiers(source).filter(isLocal);
}

function bareValueSpecifiers(source: string): readonly string[] {
  return staticSpecifiers(source).filter((spec) => !isLocal(spec));
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

/** `chain imports "spec"` for every Node-only bare specifier, static or dynamic, in the graph's files. */
function nodeOnlyImports(parents: Parents): readonly string[] {
  return [...parents.keys()].flatMap((file) =>
    importsOf(file)
      .edges.filter((found) => !isLocal(found.spec) && isNodeOnly(found.spec))
      .map((found) => {
        const verb =
          found.kind === "static" ? "imports" : "dynamically imports";
        return `${chainTo(parents, file)} ${verb} "${found.spec}"`;
      }),
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

  it("reads clauses with no spaces, `from` on the next line, a directive before them, or a comment inside", () => {
    const sources = [
      'import{readFileSync}from"node:fs";',
      'import {readFileSync}\nfrom "node:fs";',
      '"use client"; import {readFileSync} from "node:fs";',
      'import /* runtime */ {readFileSync} from "node:fs";',
    ];
    expect(sources.map(bareValueSpecifiers)).toEqual(
      sources.map(() => ["node:fs"]),
    );
  });

  it("reads nothing from import text inside comments or a template literal", () => {
    const source = [
      "/*",
      'import { x } from "./in-block-comment.ts";',
      "*/",
      "const text = `",
      'import { y } from "./in-template.ts";',
      'import "node:fs";',
      "`;",
      '// import { z } from "./in-line-comment.ts";',
    ].join("\n");
    expect(readImports(source, "reader-input.ts")).toEqual({
      edges: [],
      nonLiteral: [],
    });
  });

  it("reads import() and require() as dynamic edges and import = require() as a static one, skipping type positions", () => {
    const source = [
      'export const load = () => import("node:fs");',
      'export const lazy = () => import("./lazy.ts");',
      "export const tpl = () => import(`./template-literal.ts`);",
      'const cjs = require("node:fs");',
      'import path = require("node:path");',
      'import type T = require("./type-only-equals.ts");',
      'type Mod = typeof import("./type-position.ts");',
    ].join("\n");
    expect(readImports(source, "reader-input.ts")).toEqual({
      edges: [
        { spec: "node:fs", kind: "dynamic", syntax: "import()" },
        { spec: "./lazy.ts", kind: "dynamic", syntax: "import()" },
        { spec: "./template-literal.ts", kind: "dynamic", syntax: "import()" },
        { spec: "node:fs", kind: "dynamic", syntax: "require()" },
        { spec: "node:path", kind: "static", syntax: "import-equals" },
      ],
      nonLiteral: [],
    });
  });

  it("lists an import() or require() whose argument is not a literal, with its position", () => {
    const source = [
      'const name = "node:fs";',
      "export const byName = () => import(name);",
      "export const byLang = (lang: string) => import(`./messages/${lang}.ts`);",
      "export const cjs = require(name);",
    ].join("\n");
    expect(readImports(source, "reader-input.ts")).toEqual({
      edges: [],
      nonLiteral: [
        "2:29 import(name)",
        "3:41 import(`./messages/${lang}.ts`)",
        "4:20 require(name)",
      ],
    });
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
    const reachable = [
      ...reachableFrom(STORE_ENTRIES, STORE_GATE_EDGES).keys(),
    ].map(workbenchPath);
    expect(reachable.length).toBeGreaterThan(STORE_ENTRIES.length);
    expect(reachable).toContain("mock/keywords.ts");
    expect(reachable).toContain("mock/kb.ts");
  });

  it("sees the audit rule library behind mock/profile.ts (positive control)", () => {
    const parents = reachableFrom(
      [resolve(WORKBENCH_DIR, "mock/profile.ts")],
      STORE_GATE_EDGES,
    );
    expect(
      [...parents.keys()]
        .filter(isClientForbidden)
        .map((file) => chainTo(parents, file)),
    ).toContain(
      "lib/workbench/mock/profile.ts -> lib/workbench/mock/audit.ts -> lib/workbench/mock/find-lib.ts",
    );
  });

  it("never reaches the audit rule library, the leak-phrase table, the artifact builders, or the demo site", () => {
    const parents = reachableFrom(STORE_ENTRIES, STORE_GATE_EDGES);
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
  const walked = reachableFrom(CLIENT_ENTRIES, SAMPLE_GATE_EDGES);
  const walkedWithDynamic = reachableFrom(CLIENT_ENTRIES, NODE_GATE_EDGES);
  const dynamicView = srcPath(DYNAMIC_FIXTURE);

  it.each(DEEP_REACH)("walks %s down to %s", (entry, deep) => {
    // A root of the walk the gates below use, not just a file on disk.
    expect(walked.get(resolve(SRC_DIR, entry))).toBeNull();
    const own = [
      ...reachableFrom([resolve(SRC_DIR, entry)], SAMPLE_GATE_EDGES).keys(),
    ].map(srcPath);
    expect(own).toContain(deep);
    expect(walked.has(resolve(SRC_DIR, deep))).toBe(true);
  });

  it("names a deep file for every view entry", () => {
    expect(DEEP_REACH.map(([entry]) => entry)).toEqual(
      VIEW_ENTRIES.map(srcPath),
    );
  });

  it("catches a view-shaped module that imports the sample site statically (control)", () => {
    const parents = reachableFrom([FIXTURE], SAMPLE_GATE_EDGES);
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

  it("keeps dynamic edges out of the walk the sample-site gate uses (control)", () => {
    const parents = reachableFrom([DYNAMIC_FIXTURE], SAMPLE_GATE_EDGES);
    expect([...parents.keys()].map(srcPath)).toEqual([dynamicView]);
  });

  it("never reaches the sample site statically", () => {
    const offenders = [...walked.keys()]
      .filter(isSampleSite)
      .map((file) => chainTo(walked, file));
    expect(offenders).toEqual([]);
  });

  it("catches a Node-only import in a view-shaped module (control)", () => {
    expect(
      nodeOnlyImports(reachableFrom([FIXTURE], NODE_GATE_EDGES)),
    ).toContain(
      'lib/workbench/store/__fixtures__/view-with-static-demo-import.tsx imports "node:assert"',
    );
  });

  it("catches a Node-only module loaded dynamically, directly or through a local module (control)", () => {
    const parents = reachableFrom([DYNAMIC_FIXTURE], NODE_GATE_EDGES);
    expect(nodeOnlyImports(parents).toSorted()).toEqual([
      `${dynamicView} dynamically imports "node:fs"`,
      `${dynamicView} ~> lib/workbench/store/__fixtures__/lazy-node-import.tsx imports "node:fs"`,
    ]);
  });

  it("follows the loader's dynamic import into the sample site in the Node-only walk (control)", () => {
    const demo = resolve(SRC_DIR, "lib/workbench/mock/demo.ts");
    expect(chainTo(walkedWithDynamic, demo)).toMatch(
      /components\/workbench\/views\/overview\/LoadDemoButton\.tsx ~> lib\/workbench\/mock\/demo\.ts$/,
    );
  });

  it("never reaches a Node builtin or a Node-only package from any client entry, over static or dynamic edges", () => {
    expect(nodeOnlyImports(walkedWithDynamic)).toEqual([]);
  });

  it("lists a loader call whose argument is not a literal (control)", () => {
    expect(
      nonLiteralLoads(reachableFrom([DYNAMIC_FIXTURE], NODE_GATE_EDGES)),
    ).toEqual([`${dynamicView}:20:45 import(name)`]);
  });

  it("finds a literal argument in every import() and require() reachable from a client entry", () => {
    expect(nonLiteralLoads(walkedWithDynamic)).toEqual([]);
  });

  it("loads the sample site through an import() call in the loader", () => {
    expect(walked.has(DEMO_LOADER)).toBe(true);
    expect(importsOf(DEMO_LOADER).edges).toContainEqual({
      spec: DEMO_SITE_SPECIFIER,
      kind: "dynamic",
      syntax: "import()",
    });
  });
});
