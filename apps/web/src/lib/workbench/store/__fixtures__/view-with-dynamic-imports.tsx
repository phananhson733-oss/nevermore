"use client";

/**
 * Control fixture for `store/client-import-graph.test.ts`. Nothing in the app
 * imports it; the test parses it and walks it like a view root.
 *
 * It holds the loads the Node-only gate must see past a dynamic edge: `node:fs`
 * imported dynamically, a local module imported dynamically that imports
 * `node:fs` statically, and an `import()` whose argument is not a literal. The
 * sample-site gate follows static edges only, so from here it must reach
 * nothing but this file.
 *
 * Lives under `lib/workbench`, outside the Tailwind `@source` roots, and is a
 * `.tsx`, outside the coverage universe (`apps/** /*.ts`).
 */
export const loadFs = () => import("node:fs");

export const loadLazy = () => import("./lazy-node-import.tsx");

export const loadByName = (name: string) => import(name);

export function ViewWithDynamicImports() {
  return <p>{[loadFs, loadLazy, loadByName].length}</p>;
}
