/**
 * The overview's own import-graph gate, until T16 extends
 * `store/client-import-graph.test.ts` to components (Q13).
 *
 * `LoadDemoButton` must reach `mock/demo.ts` only through
 * `await import(...)` in its click handler: `demo.ts` pulls in every artifact
 * builder and the audit rule library, and a static import from a client
 * component bundles all of it into the overview's first load. Nothing else in
 * W3 notices that: the store gate walks from the store entries only, tsc and
 * the unit tests are indifferent to how a module is imported, and the page
 * works either way.
 *
 * The walker is the store gate's, restated here rather than imported, because a
 * test file is not a module other tests can share without becoming a fixture.
 * T16 replaces this file.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
/** `apps/web/src`: overview -> views -> workbench -> components -> src. */
const SRC_DIR = resolve(HERE, "../../../..");
const WORKBENCH_LIB = resolve(SRC_DIR, "lib/workbench");
const LOADER = resolve(HERE, "LoadDemoButton.tsx");
const ENTRIES = [
  LOADER,
  resolve(HERE, "OverviewView.tsx"),
  resolve(SRC_DIR, "app/p/[projectId]/overview/page.tsx"),
];

const FROM_CLAUSE =
  /^[ \t]*(?:import|export)[ \t]+(type[ \t]+)?(?:[\w$]+[ \t]*,?[ \t]*)?(?:\{[^}]*\}|\*(?:[ \t]+as[ \t]+[\w$]+)?)?[ \t]*from[ \t]*["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT = /^[ \t]*import[ \t]*["']([^"']+)["']/gm;
const DYNAMIC_DEMO_IMPORT = /await import\(\s*["']@\/lib\/workbench\/mock\/demo\.ts["']\s*\)/;

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

/** Throws on a local specifier it cannot resolve: skipping one would report a clean graph. */
function resolveSpecifier(fromFile: string, spec: string): string {
  const base = spec.startsWith("@/") ? resolve(SRC_DIR, spec.slice(2)) : resolve(dirname(fromFile), spec);
  const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(isFile);
  if (found === undefined) throw new Error(`cannot resolve "${spec}" imported by ${fromFile}`);
  return found;
}

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

function srcPath(file: string): string {
  return relative(SRC_DIR, file);
}

function chainTo(parents: ReadonlyMap<string, string | null>, file: string): string {
  const up = parents.get(file);
  return up === null || up === undefined ? srcPath(file) : `${chainTo(parents, up)} -> ${srcPath(file)}`;
}

/** The store gate's list: the sample site, its artifacts, the builders and the rule library. */
function isClientForbidden(file: string): boolean {
  const path = relative(WORKBENCH_LIB, file);
  return (
    path === "mock/demo.ts" ||
    path === "mock/demo-artifacts.ts" ||
    path === "mock/find-lib.ts" ||
    path === "mock/demo-ai-leak-phrases.ts" ||
    path.startsWith("mock/builders/")
  );
}

describe("overview client import graph", () => {
  it("counts a static import of the sample site and ignores the dynamic one", () => {
    const staticForm = 'import { makeDemoSite } from "@/lib/workbench/mock/demo.ts";';
    const dynamicForm = 'const { makeDemoSite } = await import("@/lib/workbench/mock/demo.ts");';
    expect(valueSpecifiers(staticForm)).toEqual(["@/lib/workbench/mock/demo.ts"]);
    expect(valueSpecifiers(dynamicForm)).toEqual([]);
  });

  it("flags what the sample site drags in when it is reachable (positive control)", () => {
    const demo = resolve(WORKBENCH_LIB, "mock/demo.ts");
    const parents = reachableFrom([demo]);
    const flagged = [...parents.keys()].filter(isClientForbidden).map(srcPath);
    expect(flagged).toContain("lib/workbench/mock/demo.ts");
    expect(flagged).toContain("lib/workbench/mock/demo-artifacts.ts");
    expect(flagged.some((path) => path.startsWith("lib/workbench/mock/builders/"))).toBe(true);
  });

  it("walks from the overview into the store and the demo constants", () => {
    const reachable = [...reachableFrom(ENTRIES).keys()].map(srcPath);
    expect(reachable).toContain("components/workbench/views/overview/LoadDemoButton.tsx");
    expect(reachable).toContain("lib/workbench/mock/demo-constants.ts");
    expect(reachable).toContain("lib/workbench/store/selectors.ts");
  });

  it("never reaches the sample site, its artifacts, the builders or the rule library statically", () => {
    const parents = reachableFrom(ENTRIES);
    const offenders = [...parents.keys()].filter(isClientForbidden).map((file) => chainTo(parents, file));
    expect(offenders).toEqual([]);
  });

  it("loads the sample site through a dynamic import in the loader", () => {
    expect(readFileSync(LOADER, "utf8")).toMatch(DYNAMIC_DEMO_IMPORT);
  });
});
