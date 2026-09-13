/**
 * The store modules ship to the browser: `hooks.ts` and `WorkbenchProvider.tsx`
 * are client modules and `selectors.ts` is imported by both. Everything they
 * reach through value imports is bundled, and tree-shaking is not a boundary:
 * `mock/find-lib.ts` reads `FIND_LIB.length` at module top level, so importing
 * any helper from a module that imports it drags the whole audit rule library
 * in. This walks the relative import graph the way the bundler sees it (type-only
 * clauses are erased) and pins what must stay out of the client.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STORE_DIR = dirname(fileURLToPath(import.meta.url));
const WORKBENCH_DIR = resolve(STORE_DIR, "..");
/** `@/` in apps/web resolves to apps/web/src. */
const SRC_DIR = resolve(WORKBENCH_DIR, "../..");
const CLIENT_ENTRIES = ["selectors.ts", "WorkbenchProvider.tsx", "hooks.ts"].map((file) => resolve(STORE_DIR, file));

/** An `import`/`export ... from` clause. Group 1 is `type ` on a type-only clause; group 2 is the specifier. */
const FROM_CLAUSE =
  /^[ \t]*(?:import|export)[ \t]+(type[ \t]+)?(?:[\w$]+[ \t]*,?[ \t]*)?(?:\{[^}]*\}|\*(?:[ \t]+as[ \t]+[\w$]+)?)?[ \t]*from[ \t]*["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import[ \t]*["']([^"']+)["']/gm;

/** Local specifiers (relative or `@/`) of the value imports and re-exports in `source`. */
function valueSpecifiers(source: string): readonly string[] {
  const fromClauses = [...source.matchAll(FROM_CLAUSE)]
    .filter((match) => match[1] === undefined)
    .map((match) => match[2] ?? "");
  const sideEffects = [...source.matchAll(SIDE_EFFECT_IMPORT)].map((match) => match[1] ?? "");
  return [...fromClauses, ...sideEffects].filter((spec) => spec.startsWith(".") || spec.startsWith("@/"));
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Throws on a local specifier it cannot resolve: a walker that skips those would report a clean graph. */
function resolveSpecifier(fromFile: string, spec: string): string {
  const base = spec.startsWith("@/") ? resolve(SRC_DIR, spec.slice(2)) : resolve(dirname(fromFile), spec);
  const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(isFile);
  if (found === undefined) throw new Error(`cannot resolve "${spec}" imported by ${fromFile}`);
  return found;
}

/** Every file reachable by value imports, mapped to the file that first imported it (`null` for entries). */
function reachableFrom(entries: readonly string[]): ReadonlyMap<string, string | null> {
  const parents = new Map<string, string | null>(entries.map((entry) => [entry, null]));
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

/** `store/selectors.ts -> mock/kb.ts -> ...`, for a readable failure. */
function chainTo(parents: ReadonlyMap<string, string | null>, file: string): string {
  const up = parents.get(file);
  return up === null || up === undefined ? workbenchPath(file) : `${chainTo(parents, up)} -> ${workbenchPath(file)}`;
}

function isClientForbidden(file: string): boolean {
  const path = workbenchPath(file);
  return (
    path === "mock/find-lib.ts" ||
    path === "mock/demo-ai-leak-phrases.ts" ||
    path === "mock/demo.ts" ||
    path.startsWith("mock/builders/")
  );
}

describe("client import graph of the workbench store", () => {
  it("reads value imports and re-exports, and skips type-only clauses", () => {
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
      'import { x } from "@/lib/alias";',
    ].join("\n");
    expect(new Set(valueSpecifiers(source))).toEqual(
      new Set(["./value.ts", "./multi-line.ts", "./default-and-named.ts", "./re-export.ts", "./star.ts", "./side-effect.ts", "@/lib/alias"]),
    );
  });

  it("walks from the client entries into the mock layer", () => {
    const reachable = [...reachableFrom(CLIENT_ENTRIES).keys()].map(workbenchPath);
    expect(reachable.length).toBeGreaterThan(CLIENT_ENTRIES.length);
    expect(reachable).toContain("mock/keywords.ts");
    expect(reachable).toContain("mock/kb.ts");
  });

  it("sees the audit rule library behind mock/profile.ts (positive control)", () => {
    const parents = reachableFrom([resolve(WORKBENCH_DIR, "mock/profile.ts")]);
    expect([...parents.keys()].filter(isClientForbidden).map((file) => chainTo(parents, file))).toContain(
      "mock/profile.ts -> mock/audit.ts -> mock/find-lib.ts",
    );
  });

  it("never reaches the audit rule library, the leak-phrase table, the artifact builders, or the demo site", () => {
    const parents = reachableFrom(CLIENT_ENTRIES);
    const offenders = [...parents.keys()].filter(isClientForbidden).map((file) => chainTo(parents, file));
    expect(offenders).toEqual([]);
  });

  it("offers the demo constants without the demo site: demo-constants.ts imports nothing", () => {
    const source = readFileSync(resolve(WORKBENCH_DIR, "mock/demo-constants.ts"), "utf8");
    expect(source).not.toMatch(/^[ \t]*import\b/m);
    expect(source).not.toMatch(/\bfrom[ \t]*["']/);
    expect(isClientForbidden(resolve(WORKBENCH_DIR, "mock/demo.ts"))).toBe(true);
  });
});
