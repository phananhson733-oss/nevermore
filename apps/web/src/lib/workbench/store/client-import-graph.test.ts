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
 * - Apart from the entries: no non-test module under `components/workbench/ui/`
 *   makes a static or dynamic edge into `components/workbench/shell/` (Q35).
 *   The shell composes the shared ui pieces, never the reverse. Direct edges
 *   only.
 *
 * Blind spots:
 * - the walk stops at package boundaries, so a workspace package that newly
 *   reaches Node through its own imports is not seen (`@sf/contracts` and
 *   `@sf/i18n` are reached today and are not followed);
 * - the sample-site gate ignores dynamic edges, so a second `import()` of the
 *   sample site from any other client module, even one that runs at module top
 *   level, is not seen;
 * - loaders that are neither `import()` nor `require()`, such as
 *   `new Worker(new URL("./x.ts", import.meta.url))`, are not read;
 * - the `ui/` gate reads direct edges only, so a `ui/` module that reaches the
 *   shell through a module outside both directories is not seen.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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
const DEMO_SITE_SPECIFIER = "@/lib/workbench/mock/demo.ts";
const FIXTURE = resolve(
  STORE_DIR,
  "__fixtures__/view-with-static-demo-import.tsx",
);
const DYNAMIC_FIXTURE = resolve(
  STORE_DIR,
  "__fixtures__/view-with-dynamic-imports.tsx",
);
const UI_DIR = resolve(SRC_DIR, "components/workbench/ui");
const SHELL_DIR = resolve(SRC_DIR, "components/workbench/shell");
const UI_FIXTURE = resolve(STORE_DIR, "__fixtures__/ui-with-shell-import.tsx");
/**
 * 22 non-test modules under ui/ on 2026-09-14. The floor sits below that, so a
 * moved directory fails here instead of passing on an empty walk.
 */
const MIN_UI_MODULES = 18;

/** Which edges a walk follows into local modules. */
type Follow = "static" | "static-and-dynamic";

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

const SCRIPT = /\.[cm]?[jt]sx?$/;

type EdgeKind = "static" | "dynamic";

interface ImportEdge {
  readonly spec: string;
  readonly kind: EdgeKind;
  readonly syntax:
    | "import"
    | "export"
    | "import-equals"
    | "import()"
    | "require()";
}

interface ModuleImports {
  readonly edges: readonly ImportEdge[];
  /** `line:column text` of each `import()` / `require()` whose argument is not a literal. */
  readonly nonLiteral: readonly string[];
}

function isLocal(spec: string): boolean {
  return spec.startsWith(".") || spec.startsWith("@/");
}

/** A string literal or a template literal without substitutions. */
function literalText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  const literal =
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
  return literal ? node.text : null;
}

function edge(
  node: ts.Expression | undefined,
  syntax: ImportEdge["syntax"],
): ImportEdge | null {
  const spec = literalText(node);
  const kind =
    syntax === "import()" || syntax === "require()" ? "dynamic" : "static";
  return spec === null ? null : { spec, kind, syntax };
}

/**
 * The static edge a declaration makes, or null. `import { type A } from` still
 * counts: with `verbatimModuleSyntax` only a clause-level `type` is erased.
 */
function staticEdge(node: ts.Node): ImportEdge | null {
  if (ts.isImportDeclaration(node)) {
    const typeOnly =
      node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    return typeOnly ? null : edge(node.moduleSpecifier, "import");
  }
  if (ts.isExportDeclaration(node)) {
    return node.isTypeOnly ? null : edge(node.moduleSpecifier, "export");
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    !node.isTypeOnly &&
    ts.isExternalModuleReference(node.moduleReference)
  ) {
    return edge(node.moduleReference.expression, "import-equals");
  }
  return null;
}

/** `import()` or `require()` for a call that loads a module, null for any other call. */
function loaderSyntax(node: ts.CallExpression): ImportEdge["syntax"] | null {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return "import()";
  const callee = node.expression;
  return ts.isIdentifier(callee) && callee.text === "require"
    ? "require()"
    : null;
}

/** Every import edge in `text`, and every loader call it cannot follow. */
function readImports(text: string, fileName: string): ModuleImports {
  const scriptKind = /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const edges: ImportEdge[] = [];
  const nonLiteral: string[] = [];
  const visit = (node: ts.Node): void => {
    const declared = staticEdge(node);
    if (declared !== null) edges.push(declared);
    const syntax = ts.isCallExpression(node) ? loaderSyntax(node) : null;
    if (ts.isCallExpression(node) && syntax !== null) {
      const loaded = edge(node.arguments[0], syntax);
      if (loaded !== null) edges.push(loaded);
      else nonLiteral.push(where(source, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { edges, nonLiteral };
}

function where(source: ts.SourceFile, node: ts.Node): string {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${start.line + 1}:${start.character + 1} ${node.getText(source)}`;
}

/** Parsed once per file per run; the files do not change while the tests read them. */
const parsed = new Map<string, ModuleImports>();

/** Throws on a file that is not a script: its imports would otherwise read as none. */
function importsOf(file: string): ModuleImports {
  const cached = parsed.get(file);
  if (cached !== undefined) return cached;
  if (!SCRIPT.test(file)) throw new Error(`not a script module: ${file}`);
  const read = readImports(readFileSync(file, "utf8"), file);
  parsed.set(file, read);
  return read;
}

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

interface Parent {
  readonly file: string;
  readonly kind: EdgeKind;
}

type Parents = ReadonlyMap<string, Parent | null>;

/** Every file reachable over `follow` edges, mapped to the file (and edge) that first reached it; `null` for entries. */
function reachableFrom(entries: readonly string[], follow: Follow): Parents {
  const parents = new Map<string, Parent | null>(
    entries.map((entry) => [entry, null]),
  );
  const queue = [...entries];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const found of importsOf(file).edges) {
      if (!isLocal(found.spec)) continue;
      if (follow === "static" && found.kind === "dynamic") continue;
      const target = resolveSpecifier(file, found.spec);
      if (parents.has(target)) continue;
      parents.set(target, { file, kind: found.kind });
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

/**
 * `lib/workbench/store/selectors.ts -> lib/workbench/mock/kb.ts -> ...`, for a
 * readable failure. `->` is a static edge, `~>` a dynamic one.
 */
function chainTo(parents: Parents, file: string): string {
  const up = parents.get(file);
  if (up === null || up === undefined) return srcPath(file);
  const arrow = up.kind === "static" ? "->" : "~>";
  return `${chainTo(parents, up.file)} ${arrow} ${srcPath(file)}`;
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

/** `path:line:column text` for every loader call in the graph's files whose argument is not a literal. */
function nonLiteralLoads(parents: Parents): readonly string[] {
  return [...parents.keys()].flatMap((file) =>
    importsOf(file).nonLiteral.map((at) => `${srcPath(file)}:${at}`),
  );
}

/** Every non-test script module under `directory`, nested directories included. */
function scriptModulesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return scriptModulesUnder(path);
    return SCRIPT.test(entry.name) && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

function isInside(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

interface DirectEdge {
  readonly target: string;
  /** `file -> target`, or `file ~> target` for a dynamic edge. */
  readonly line: string;
}

/** Every local edge, static or dynamic, out of `files`, resolved; no walk past them. */
function directLocalEdges(files: readonly string[]): readonly DirectEdge[] {
  return files.flatMap((file) =>
    importsOf(file)
      .edges.filter((found) => isLocal(found.spec))
      .map((found) => {
        const target = resolveSpecifier(file, found.spec);
        const arrow = found.kind === "static" ? "->" : "~>";
        return { target, line: `${srcPath(file)} ${arrow} ${srcPath(target)}` };
      }),
  );
}

/** The direct edges out of `files` whose target sits under `components/workbench/shell/` (Q35). */
function edgesIntoShell(files: readonly string[]): readonly string[] {
  return directLocalEdges(files)
    .filter(({ target }) => isInside(SHELL_DIR, target))
    .map(({ line }) => line);
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

// Q35: the shell composes the shared ui pieces; a ui piece importing the shell
// turns that dependency around.
describe("components/workbench/ui imports nothing from shell (Q35)", () => {
  const uiModules = scriptModulesUnder(UI_DIR);

  it("reads every non-test module under ui/ and the edges out of them", () => {
    expect(uiModules.length).toBeGreaterThanOrEqual(MIN_UI_MODULES);
    expect(uiModules.map(srcPath)).toContain(
      "components/workbench/ui/ConfirmDialog.tsx",
    );
    // A real edge between two ui modules, so an empty edge list cannot pass the gate below.
    expect(directLocalEdges(uiModules).map(({ line }) => line)).toContain(
      "components/workbench/ui/ConfirmDialog.tsx -> components/workbench/ui/Dialog.tsx",
    );
  });

  it("catches a ui-shaped module that imports the shell, statically or dynamically (control)", () => {
    const fixture = srcPath(UI_FIXTURE);
    expect(edgesIntoShell([UI_FIXTURE])).toEqual([
      `${fixture} -> components/workbench/shell/workbench-nav.ts`,
      `${fixture} ~> components/workbench/shell/CommandPalette.tsx`,
    ]);
  });

  it("has no static or dynamic edge from a ui/ module into shell/", () => {
    expect(edgesIntoShell(uiModules)).toEqual([]);
  });
});
