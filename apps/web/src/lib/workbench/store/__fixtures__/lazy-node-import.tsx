/**
 * Control fixture for `store/client-import-graph.test.ts`, reached only through
 * the dynamic `import()` in `view-with-dynamic-imports.tsx`. Its static import
 * of `node:fs` is what the Node-only gate must find behind that dynamic edge.
 *
 * Lives under `lib/workbench`, outside the Tailwind `@source` roots, and is a
 * `.tsx`, outside the coverage universe (`apps/** /*.ts`).
 */
import { readFileSync } from "node:fs";

export function LazyNodeImport() {
  return <p>{readFileSync.name}</p>;
}
