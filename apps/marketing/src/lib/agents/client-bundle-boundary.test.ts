// @input  -- every module reachable from a "use client" entry point
// @output -- a failing test when one of them reaches a package barrel
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
  // Parsed as what it is. A `.ts` file read as TSX loses angle-bracket casts,
  // and a file that fails to parse yields no references at all — which is the
  // shape of a guard passing because it went blind.
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
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
  const manifest = join(REPO_ROOT, "packages", pkg, "package.json");
  try {
    const exports = (
      JSON.parse(readFileSync(manifest, "utf8")) as {
        exports?: Record<string, string>;
      }
    ).exports;
    const target = exports?.[`./${subpath}`];
    if (target !== undefined) {
      return resolve(join(REPO_ROOT, "packages", pkg), target);
    }
  } catch {
    // Not a workspace package we can follow; the barrel check still applies.
  }
  // Not in the exports map, but the source layout is uniform enough to try.
  return join(REPO_ROOT, "packages", pkg, "src", subpath);
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

describe("modules the browser bundle reaches stay off the package barrels", () => {
  const closure = clientClosure();

  it("found the client entry points at all", () => {
    // A walk that resolved nothing would pass every assertion below it.
    expect(closure.size).toBeGreaterThan(40);
    expect([...closure.keys()].some((file) => file.includes("on-page-checker")))
      .toBe(true);
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
    const unparsed: string[] = [];
    for (const file of closure.keys()) {
      const parsed = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ) as ts.SourceFile & {
        readonly parseDiagnostics?: readonly ts.Diagnostic[];
      };
      if ((parsed.parseDiagnostics?.length ?? 0) > 0) {
        unparsed.push(file.slice(SOURCE_ROOT.length));
      }
    }
    expect(
      unparsed,
      `the scanner could not parse these, so it saw no imports in them:\n${unparsed.join("\n")}`,
    ).toEqual([]);
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
