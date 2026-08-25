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
 * Why the statement patterns are anchored to the start of a line.
 *
 * They scan raw text, so prose describing a module reads exactly like an
 * import of it: the sentence "must not import `@sf/sources`" in a doc comment
 * matched the side-effect pattern and reported the file that documents the
 * rule as the file that breaks it. Anchoring is what a comment cannot satisfy
 * — block-comment lines carry a leading `*`, line comments a leading `//` —
 * and unlike stripping comments first it needs no lexer, so a `/*` inside a
 * regex literal cannot swallow a real import and make this guard pass.
 */
function referencesIn(source: string): readonly Reference[] {
  const found: Reference[] = [];
  // `import type { A } from "x"` and `import { type A } from "x"` differ: only
  // the first erases the whole statement. The second still emits the import.
  for (const match of source.matchAll(
    /^[ \t]*(?:import|export)\s+(type\s+)?[\s\S]*?from\s*['"`]([^'"`]+)['"`]/gm,
  )) {
    if (match[2] !== undefined) {
      found.push({ specifier: match[2], typeOnly: match[1] !== undefined });
    }
  }
  // A side-effect import has no `from` and is never erased: `import "x"` runs
  // the whole module. The `from`-only pattern above walked straight past it.
  for (const match of source.matchAll(/^[ \t]*import\s+['"]([^'"]+)['"]/gm)) {
    if (match[1] !== undefined) {
      found.push({ specifier: match[1], typeOnly: false });
    }
  }
  for (const match of source.matchAll(
    /(?:require|import)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  )) {
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
