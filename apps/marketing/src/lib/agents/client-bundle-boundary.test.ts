// @input  -- every module reachable from a "use client" entry point, with CSS as static leaves
// @output -- a failing test for package barrels, unexported subpaths, or unparseable non-CSS modules
// @pos    -- the one guard for a bundling break that typecheck and the suite both pass
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Why the closure is walked instead of listed.
 *
 * `@sf/public-tools` re-exports the crawl scanner, so a single value import
 * from the barrel puts `node:net` in a client chunk and fails the production
 * build with a chunking error that names the component rather than the import.
 * Typecheck passes. Ten thousand unit tests pass. Only `next build` says no.
 *
 * This used to be a hand-kept list of six files, which is a guard that protects
 * exactly the files someone remembered to add — five modules written since then
 * were client-reachable and unlisted. Walking out from every `"use client"`
 * entry point covers whatever exists, including files that do not exist yet.
 *
 * A type-only import is erased before bundling and is genuinely safe, so it is
 * allowed — but only spelled `import type`. That keyword is the whole
 * difference, so the check is stated as "every barrel reference in this closure
 * is a type import", and dropping it fails here rather than in `next build`.
 */
const SOURCE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
/** Repository root, so the walk can follow a workspace subpath into its source. */
const REPO_ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));

/** Barrels whose transitive graph contains a Node-only module. */
const FORBIDDEN_SPECIFIERS = ["@sf/public-tools", "@sf/sources", "@sf/engine"];

function sourceFiles(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

interface Reference {
  readonly specifier: string;
  /** True only for `import type ... from "x"`, which the bundler erases. */
  readonly typeOnly: boolean;
}

/**
 * Read module references with the compiler's own parser.
 *
 * Two hand-rolled versions failed in opposite directions. Scanning raw text
 * matched prose: the sentence "must not import `@sf/sources`" in a doc comment
 * reported the file documenting the rule as the file breaking it. Anchoring
 * the patterns to a line start silenced that and quietly failed OPEN instead —
 * `from /* server-only *\/ "@sf/sources"`, a comment inside a multi-line
 * import, and `"use client"; import ...` on one line all stopped being seen,
 * and a guard that stops seeing imports passes everything.
 *
 * Line position cannot decide lexical context. TypeScript already ships the
 * scanner that can, so this asks it.
 */
function referencesIn(source: string, fileName = "module.tsx"): readonly Reference[] {
  // Stylesheets are static assets, not executable modules. Keep this explicit:
  // unknown extensions must still be parsed rather than silently hiding imports.
  if (fileName.endsWith(".css")) return [];

  // Parsed as what it is. A `.ts` file read as TSX loses angle-bracket casts,
  // and a file that fails to parse yields no references at all — which is the
  // shape of a guard passing because it went blind.
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  ) as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[];
  };
  if ((file.parseDiagnostics?.length ?? 0) > 0) {
    throw new Error(`the scanner could not parse ${fileName}`);
  }
  const found: Reference[] = [];

  const literal = (node: ts.Node | undefined): string | null =>
    node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier !== null) {
        // `import type { A } from "x"` erases the whole statement.
        // `import { type A } from "x"` does not: the import still emits.
        found.push({
          specifier,
          typeOnly: node.importClause?.isTypeOnly === true,
        });
      }
    } else if (ts.isExportDeclaration(node)) {
      const specifier = literal(node.moduleSpecifier);
      if (specifier !== null) {
        found.push({ specifier, typeOnly: node.isTypeOnly });
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      // `import x = require("y")`. Rare in this codebase and never erased.
      const specifier = literal(node.moduleReference.expression);
      if (specifier !== null) {
        found.push({ specifier, typeOnly: node.isTypeOnly });
      }
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        const specifier = literal(node.arguments[0]);
        // Neither form is ever erased: both run the module.
        if (specifier !== null) found.push({ specifier, typeOnly: false });
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
  return found;
}

/**
 * Resolve a specifier the way the bundler does, as far as this walk needs to.
 *
 * Relative paths, the `@/` alias this app uses, an `index.ts` inside a
 * directory, and the extension-less spellings TypeScript allows. A walk that
 * only understood `./x.ts` stopped at the first `@/lib/...` import and called
 * the remaining graph unreachable.
 */
function resolveRelative(from: string, specifier: string): string | null {
  const base = specifier.startsWith(".")
    ? resolve(dirname(from), specifier)
    : specifier.startsWith("@/")
      ? resolve(SOURCE_ROOT, specifier.slice(2))
      : workspaceSubpath(specifier);
  if (base === null) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this spelling; try the next.
    }
  }
  return null;
}

/** A subpath maps either straight to a file or to a set of conditions. */
type ExportsEntry = string | { readonly [condition: string]: string | null };

/** `pnpm-workspace.yaml` declares both roots; a package lives under one. */
function workspacePackageDir(pkg: string): string | null {
  for (const root of ["packages", "apps"]) {
    const dir = join(REPO_ROOT, root, pkg);
    try {
      if (statSync(join(dir, "package.json")).isFile()) return dir;
    } catch {
      // Not this root; try the next.
    }
  }
  return null;
}

/**
 * The file `exports` maps this subpath to, or null when it maps none.
 *
 * Both spellings are in use here: a plain string, and the conditional
 * `{ types, browser, default }` object `@sf/db` writes for two of its modules.
 * Read only as a string the conditional form comes back `undefined`, which
 * reads exactly like a subpath the package never exported.
 *
 * `browser` is deliberately not preferred over `default`. The two `@sf/db`
 * entries set it to `null`, meaning "no browser build of this module" — a real
 * client-bundle problem, but a different one from the rule here, and one no
 * import in this closure has today. Resolving through `default` walks the
 * module the server build uses rather than silently treating the entry as
 * missing.
 */
function exportsTarget(pkg: string, subpath: string): string | null {
  const dir = workspacePackageDir(pkg);
  if (dir === null) return null;
  let entry: ExportsEntry | undefined;
  try {
    entry = (
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        exports?: Record<string, ExportsEntry>;
      }
    ).exports?.[`./${subpath}`];
  } catch {
    return null;
  }
  if (entry === undefined) return null;
  const target = typeof entry === "string" ? entry : (entry.default ?? entry.types);
  return typeof target === "string" ? resolve(dir, target) : null;
}

/**
 * Why the bundler could not have resolved this specifier, or null when it could.
 *
 * Turbopack reads `exports`. This walk used to read the directory layout, and
 * guessed `packages/<pkg>/src/<subpath>` for anything the map did not answer
 * for — so `@sf/public-tools/seo-audit/scan`, which is a real file and not an
 * export, resolved here and failed there. A guard that invents a resolution
 * the bundler does not have is green for the same reason the build is red.
 *
 * A bare barrel is not this rule's business: it resolves fine and is wrong for
 * another reason, which the barrel check states in its own words.
 *
 * Unlike that check there is no `import type` exemption, and the difference is
 * not an oversight. A type-only import is erased from the bundle but still has
 * to RESOLVE, under `exports` like every other specifier, or typecheck fails
 * too. Erasure saves an import from the barrel rule; it saves nothing here.
 *
 * Known limit: an entry nesting conditions further (`{ browser: { import } }`)
 * yields no string and reads as unexported. Nothing writes one today, and the
 * failure still points at the exports map, which is where such an entry would
 * need looking at anyway.
 */
function unexportedSubpath(specifier: string): string | null {
  const match = /^@sf\/([^/]+)\/(.+)$/.exec(specifier);
  if (match === null) return null;
  const [, pkg, subpath] = match;
  if (pkg === undefined || subpath === undefined) return null;
  if (workspacePackageDir(pkg) === null) {
    return `@sf/${pkg} is not a workspace package`;
  }
  if (exportsTarget(pkg, subpath) === null) {
    return `@sf/${pkg} does not export ./${subpath}`;
  }
  return null;
}

/**
 * Resolve `@sf/<pkg>/<subpath>` into the workspace file it names.
 *
 * Without this the walk stopped dead at the package boundary: a client
 * component may legitimately import a narrow subpath like
 * `@sf/public-tools/seo-audit/contract`, and whatever THAT file imports was
 * simply never visited. A bare `@sf/sources` barrel import sitting one level
 * inside a package was therefore invisible here and only surfaced as a
 * Turbopack chunking error in `next build` — which is how this guard stayed
 * green through the exact break it exists to prevent, twice.
 *
 * A bare barrel specifier (`@sf/sources` with no subpath) resolves to null on
 * purpose: it is the thing being reported, not a file to walk into.
 */
function workspaceSubpath(specifier: string): string | null {
  const match = /^@sf\/([^/]+)\/(.+)$/.exec(specifier);
  if (match === null) return null;
  const [, pkg, subpath] = match;
  if (pkg === undefined || subpath === undefined) return null;
  const exported = exportsTarget(pkg, subpath);
  if (exported !== null) return exported;
  const dir = workspacePackageDir(pkg);
  if (dir === null) return null;
  // Unexported — and reported as such by `unexportedSubpath`, so this no
  // longer hides anything. Following the uniform layout anyway keeps the walk
  // moving: one unresolvable specifier should not blind the barrel check to
  // every file underneath it.
  return join(dir, "src", subpath);
}

/** Every module a client entry point pulls in, transitively. */
function clientClosure(): ReadonlyMap<string, readonly Reference[]> {
  const all = sourceFiles(SOURCE_ROOT);
  const entries = all.filter((file) =>
    /^\s*["']use client["']/m.test(readFileSync(file, "utf8")),
  );

  const seen = new Map<string, readonly Reference[]>();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    const references = referencesIn(readFileSync(file, "utf8"), file);
    seen.set(file, references);
    for (const reference of references) {
      const resolved = resolveRelative(file, reference.specifier);
      if (resolved !== null && !seen.has(resolved)) pending.push(resolved);
    }
  }
  return seen;
}

describe("the reference scanner reads code, not prose", () => {
  it("treats CSS modules and stylesheets as static leaves", () => {
    const source = [
      '@import "./tokens.css";',
      ".panel {",
      "  color: var(--foreground);",
      '  content: "import \\"@sf/sources\\"";',
      "}",
    ].join("\n");

    for (const fileName of ["presentation.module.css", "globals.css"]) {
      expect(referencesIn(source, fileName)).toEqual([]);
    }
  });

  it.each(["ts", "tsx", "js", "jsx", "unknown"])(
    "fails closed when a reachable .%s file cannot be parsed",
    (extension) => {
      expect(() =>
        referencesIn('const value = ; import "@sf/sources";', `broken.${extension}`),
      ).toThrow(/could not parse.*broken\./);
    },
  );

  it("still sees forbidden imports beside a static CSS import", () => {
    const source = [
      'import styles from "./presentation.module.css";',
      'import "./globals.css";',
      'import { runtime } from "@sf/public-tools";',
      'export * from "@sf/engine";',
      'const late = import("@sf/sources");',
    ].join("\n");

    expect(referencesIn(source)).toEqual([
      { specifier: "./presentation.module.css", typeOnly: false },
      { specifier: "./globals.css", typeOnly: false },
      { specifier: "@sf/public-tools", typeOnly: false },
      { specifier: "@sf/engine", typeOnly: false },
      { specifier: "@sf/sources", typeOnly: false },
    ]);
  });

  it.each(["presentation.css.ts", "presentation.css.js", "presentation.unknown"])(
    "does not mistake %s for static CSS",
    (fileName) => {
      expect(referencesIn('export * from "@sf/sources";', fileName)).toEqual([
        { specifier: "@sf/sources", typeOnly: false },
      ]);
    },
  );

  it("ignores a barrel named inside a comment", () => {
    const source = [
      "/**",
      " * This module must not import `@sf/sources`, so the shape is restated.",
      " */",
      "// import \"@sf/engine\";",
      "export const shape = 1;",
    ].join("\n");

    expect(referencesIn(source)).toEqual([]);
  });

  it("does not let a preceding type declaration swallow the import below it", () => {
    // The failure this exists to prevent is a false NEGATIVE: the old pattern
    // matched from `export type`, ran across the line break to the next
    // statement's `from`, and reported a real VALUE import as type-only --
    // which the offender check then skips, shipping the forbidden barrel.
    for (const preceding of [
      "export type Local = { id: string };",
      "export type Local = { id: string }",
      "export interface Local { id: string }",
      "export function noop() {}",
      "export const ready = { id: 1 };",
    ]) {
      expect(
        referencesIn(`${preceding}\nimport { runtime } from "@sf/engine";`),
      ).toContainEqual({ specifier: "@sf/engine", typeOnly: false });
    }
  });

  it("does not report a type-only import as a value one after any of those", () => {
    expect(
      referencesIn(
        'export function noop() {}\nimport type { Shape } from "@sf/engine";',
      ),
    ).toEqual([{ specifier: "@sf/engine", typeOnly: true }]);
  });

  it("sees the compact forms that omit whitespace after the keyword", () => {
    // All legal: JavaScript does not require a space before punctuation.
    expect(referencesIn('import{runtime}from"@sf/engine";')).toEqual([
      { specifier: "@sf/engine", typeOnly: false },
    ]);
    expect(referencesIn('import"@sf/sources";')).toEqual([
      { specifier: "@sf/sources", typeOnly: false },
    ]);
    expect(referencesIn('export{runtime}from"@sf/engine";')).toEqual([
      { specifier: "@sf/engine", typeOnly: false },
    ]);
    expect(referencesIn('export*from"@sf/public-tools";')).toEqual([
      { specifier: "@sf/public-tools", typeOnly: false },
    ]);
  });

  it("reads a multi-line import clause as one reference", () => {
    expect(
      referencesIn('import {\n  a,\n  b,\n} from "@sf/public-tools";'),
    ).toEqual([{ specifier: "@sf/public-tools", typeOnly: false }]);
  });

  it("still reports the real thing on the line below one", () => {
    const source = [
      "// we deliberately do not import \"@sf/engine\" here",
      'import "@sf/sources";',
      'import { thing } from "@sf/public-tools";',
      'import type { Shape } from "@sf/engine";',
      'const late = await import("@sf/sources");',
    ].join("\n");

    expect(referencesIn(source)).toEqual(
      expect.arrayContaining([
        { specifier: "@sf/sources", typeOnly: false },
        { specifier: "@sf/public-tools", typeOnly: false },
        { specifier: "@sf/engine", typeOnly: true },
      ]),
    );
    expect(
      referencesIn(source).filter((reference) => !reference.typeOnly).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("workspace subpaths resolve the way the bundler resolves them", () => {
  it("resolves a subpath its package exports", () => {
    expect(workspaceSubpath("@sf/public-tools/crawl-completion")).toBe(
      join(REPO_ROOT, "packages/public-tools/src/crawl-completion.ts"),
    );
    expect(unexportedSubpath("@sf/public-tools/crawl-completion")).toBeNull();
  });

  it("reports a subpath the package does not export, even when the file is there", () => {
    // The whole shape of the false green: `seo-audit/scan.ts` exists on disk at
    // the guessed path, so the walk resolved it and every assertion downstream
    // passed -- while Turbopack, which reads `exports` and not the directory
    // layout, could not resolve the specifier at all.
    expect(unexportedSubpath("@sf/public-tools/seo-audit/scan")).toMatch(
      /does not export/,
    );
    // Still walked into, so one unresolvable specifier cannot blind the guard
    // to the barrel imports in the files below it. Asserted through the
    // resolver the walk actually calls, extension guessing included.
    expect(
      resolveRelative(
        join(SOURCE_ROOT, "lib/tools/crawl-cache.ts"),
        "@sf/public-tools/seo-audit/scan",
      ),
    ).toBe(join(REPO_ROOT, "packages/public-tools/src/seo-audit/scan.ts"));
  });

  it("reports a subpath that names no file at all", () => {
    expect(unexportedSubpath("@sf/public-tools/no-such-module")).toMatch(
      /does not export/,
    );
  });

  it("reports a package outside the workspace", () => {
    expect(unexportedSubpath("@sf/not-a-package/anything")).toMatch(
      /not a workspace package/,
    );
  });

  it("follows an exports entry written in conditional form", () => {
    // `@sf/db` spells two of its entries as `{ types, browser, default }`. Read
    // as a string that is `undefined`, and the subpath reads as unexported.
    expect(
      workspaceSubpath("@sf/db/keyword-governance-suggestion-scheduler"),
    ).toBe(
      join(REPO_ROOT, "packages/db/src/keyword-governance-suggestion-scheduler.ts"),
    );
    expect(
      unexportedSubpath("@sf/db/keyword-governance-suggestion-scheduler"),
    ).toBeNull();
  });

  it("leaves bare barrels to the barrel check", () => {
    // Not "resolves fine" -- a different rule owns it, and reporting it twice
    // under two names would read as two problems.
    expect(unexportedSubpath("@sf/public-tools")).toBeNull();
    expect(workspaceSubpath("@sf/public-tools")).toBeNull();
  });
});

describe("modules the browser bundle reaches stay off the package barrels", () => {
  const closure = clientClosure();

  it("found the client entry points at all", () => {
    // A walk that resolved nothing would pass every assertion below it.
    expect(closure.size).toBeGreaterThan(40);
    expect([...closure.keys()].some((file) => file.includes("on-page-checker")))
      .toBe(true);
  });

  it("imports no subpath its package does not export", () => {
    // A subpath missing from `exports` fails the build exactly like a barrel
    // import does, and for longer: the walk used to guess
    // `packages/<pkg>/src/<subpath>` and, whenever that guess happened to be a
    // real file, call the specifier resolved. Green guard, red `next build`.
    const offenders: string[] = [];
    for (const [file, references] of closure) {
      for (const reference of references) {
        const reason = unexportedSubpath(reference.specifier);
        if (reason !== null) {
          offenders.push(
            `${file.slice(SOURCE_ROOT.length)} → ${reference.specifier}: ${reason}`,
          );
        }
      }
    }
    expect(
      offenders,
      `add these to the owning package's exports map:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("takes no value out of a barrel anywhere in that closure", () => {
    const offenders: string[] = [];
    for (const [file, references] of closure) {
      for (const reference of references) {
        if (
          FORBIDDEN_SPECIFIERS.includes(reference.specifier) &&
          !reference.typeOnly
        ) {
          offenders.push(
            `${file.slice(SOURCE_ROOT.length)} → ${reference.specifier}`,
          );
        }
      }
    }
    expect(
      offenders,
      `use a subpath export instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("reads every import spelling this codebase writes, and no prose", () => {
    // Both hand-rolled scanners failed here: the first matched prose, the
    // second stopped seeing real imports. Every line below is a case one of
    // them got wrong.
    const source = [
      'import { a } from "@sf/public-tools";',
      'import type { B } from "@sf/engine";',
      "import {",
      '  c, // re-exported from "./decoy"',
      '} from "@sf/sources";',
      'export { d } from "@sf/public-tools";',
      'export * from "@sf/engine";',
      'import "@sf/sources";',
      'import { e } from /* server-only */ "@sf/sources";',
      '"use client"; import { f } from "@sf/public-tools";',
      "async function lazy() {",
      '  return (await import("@sf/sources")).x;',
      "}",
      "const re = /[/*]/;",
      '// import "@sf/engine";',
      "/*",
      '  import "@sf/engine";',
      "*/",
      "/**",
      " * must not import `@sf/engine`, so the shape is restated here.",
      " */",
    ].join("\n");

    const references = referencesIn(source);
    const runtime = references
      .filter((reference) => !reference.typeOnly)
      .map((reference) => reference.specifier);

    // Three barrels named in code; every `@sf/engine` mention in a comment is
    // not a reference, and the decoy specifier inside a comment is not either.
    expect(runtime.filter((v) => v === "@sf/public-tools")).toHaveLength(3);
    expect(runtime.filter((v) => v === "@sf/sources")).toHaveLength(4);
    expect(runtime).not.toContain("./decoy");
    // The only `@sf/engine` references are the type-only import and the
    // re-export; none of the three commented mentions count.
    expect(references.filter((r) => r.specifier === "@sf/engine")).toEqual([
      { specifier: "@sf/engine", typeOnly: true },
      { specifier: "@sf/engine", typeOnly: false },
    ]);
  });

  it("parses every file it walks, instead of going blind on one", () => {
    // `createSourceFile` does not throw. A file it cannot parse comes back as
    // a tree with no imports, which reads exactly like a file that has none —
    // so the guard would go blind one file at a time and still pass. The
    // condition to detect is the parse failure itself, not a guess from the
    // text about which files "should" have imports.
    for (const file of closure.keys()) {
      expect(() => referencesIn(readFileSync(file, "utf8"), file)).not.toThrow();
    }
  });

  it("follows the aliased imports this app actually writes", () => {
    // `@/lib/...` is the spelling half this codebase uses. A walk that resolved
    // only `./x.ts` stopped at the first one and called the rest unreachable.
    const aliased = [...closure.values()]
      .flat()
      .filter((reference) => reference.specifier.startsWith("@/"));
    expect(aliased.length).toBeGreaterThan(0);
    for (const reference of aliased) {
      const resolvedSomewhere = [...closure.keys()].some((file) =>
        file.includes(reference.specifier.slice(2).split("/").join("/")),
      );
      expect(
        resolvedSomewhere,
        `alias ${reference.specifier} resolved to nothing in the closure`,
      ).toBe(true);
    }
  });

  it("sees the type-only barrel imports it is allowing", () => {
    // Not decoration: if the reference parser stopped recognising imports, the
    // check above would pass by finding nothing at all.
    const typeOnly = [...closure.values()]
      .flat()
      .filter(
        (reference) =>
          FORBIDDEN_SPECIFIERS.includes(reference.specifier) &&
          reference.typeOnly,
      );
    expect(typeOnly.length).toBeGreaterThan(0);
  });
});
