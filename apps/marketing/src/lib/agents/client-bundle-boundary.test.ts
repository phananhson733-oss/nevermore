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

function referencesIn(source: string): readonly Reference[] {
  const found: Reference[] = [];
  // `import type { A } from "x"` and `import { type A } from "x"` differ: only
  // the first erases the whole statement. The second still emits the import.
  for (const match of source.matchAll(
    /import\s+(type\s+)?[\s\S]*?from\s*['"`]([^'"`]+)['"`]/g,
  )) {
    if (match[2] !== undefined) {
      found.push({ specifier: match[2], typeOnly: match[1] !== undefined });
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

function resolveRelative(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this spelling; try the next.
    }
  }
  return null;
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
