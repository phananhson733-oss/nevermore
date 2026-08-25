// @input  -- every module reachable from a "use client" entry point
// @output -- a failing test when one of them reaches a package barrel
// @pos    -- the one guard for a bundling break that typecheck and the suite both pass
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
 * How an import is recognised, and why it is not just `\bimport\b`.
 *
 * A regex cannot tell code from prose. A JSDoc line reading "must not import
 * `@sf/sources`" matched the side-effect pattern, and this guard reported the
 * file that DOCUMENTS the rule as the file that breaks it. A guard that cries
 * wolf about its own comment is one people learn to mute.
 *
 * Three rules, each answering a way the naive version was wrong:
 *
 * 1. STATEMENT_START -- a real `import`/`export` statement begins a line;
 *    a comment line that mentions one does not (` * ...`, `// ...`).
 *
 * 2. IMPORT_CLAUSE -- what may sit between the keyword and `from` is an
 *    import clause and nothing else: bindings, at most one braced group, no
 *    `;`, no `=`, no stray brace. The old `[\s\S]*?` crossed statement
 *    boundaries, so `export type Local = {...}` on the line above a real
 *    value import swallowed it and reported it as TYPE-ONLY -- a false
 *    NEGATIVE in the one direction that matters, since the offender check
 *    then skips it and the forbidden barrel ships.
 *
 * 3. The keyword may be followed by punctuation instead of whitespace.
 *    `import{a}from"x"`, `import"x"`, `export{a}from"x"` and `export*from"x"`
 *    are all legal and all used to be invisible here.
 *
 * Stripping comments and strings instead of anchoring would mean tracking
 * templates and regex literals, and this app parses text: a regex holding an
 * unbalanced quote would desynchronise a stripper and hide a real import.
 *
 * Known gap, accepted: a static import that shares a line with an earlier
 * statement (`const a = 1; import "@sf/sources";`) is not seen. It is legal
 * but the repository's formatter never emits it, and admitting a `;` boundary
 * to catch it made every string and comment containing "; import ... from"
 * a false positive -- including the code examples this marketing app ships.
 * The production build still fails on a missed barrel; this guard is the
 * earlier of two nets, not the only one.
 */
const STATEMENT_START = "^[ \\t]*";
/** Bindings and at most one braced group -- never a `;`, `=`, or stray brace. */
const IMPORT_CLAUSE = "[^;={}]*(?:\\{[^{}]*\\})?[^;={}]*";
const STATIC_IMPORT = new RegExp(
  `${STATEMENT_START}(?:import|export)(?:\\s+(type\\s+)?|(?=[{*]))${IMPORT_CLAUSE}from\\s*['"\`]([^'"\`]+)['"\`]`,
  "gm",
);
const SIDE_EFFECT_IMPORT = new RegExp(
  `${STATEMENT_START}import(?:\\s+|(?=['"\`]))['"\`]([^'"\`]+)['"\`]`,
  "gm",
);
/**
 * Unanchored on purpose: `await import("x")` is legitimately mid-expression,
 * and missing one is worse than the rare false positive from a comment that
 * spells a call.
 */
const DYNAMIC_IMPORT = /(?:require|import)\s*\(\s*['"`]([^'"`]+)['"`]/g;

function referencesIn(source: string): readonly Reference[] {
  const found: Reference[] = [];
  // `import type { A } from "x"` and `import { type A } from "x"` differ: only
  // the first erases the whole statement. The second still emits the import.
  for (const match of source.matchAll(STATIC_IMPORT)) {
    if (match[2] !== undefined) {
      found.push({ specifier: match[2], typeOnly: match[1] !== undefined });
    }
  }
  // A side-effect import has no `from` and is never erased: `import "x"` runs
  // the whole module. The `from`-only pattern above walked straight past it.
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT)) {
    if (match[1] !== undefined) {
      found.push({ specifier: match[1], typeOnly: false });
    }
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT)) {
    if (match[1] !== undefined) {
      found.push({ specifier: match[1], typeOnly: false });
    }
  }
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
    const references = referencesIn(readFileSync(file, "utf8"));
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
