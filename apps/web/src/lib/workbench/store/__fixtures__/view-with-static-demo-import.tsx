"use client";

/**
 * Control fixture for `store/client-import-graph.test.ts`. Nothing in the app
 * imports it; the test reads it as text and walks it like a view root.
 *
 * It holds the two imports the view gate exists to catch: a static import of
 * the sample site (which must only arrive through `await import` in
 * `LoadDemoButton.tsx`) and a Node-only module. If the gate stops seeing either
 * one here, it would not see it in a real view either.
 *
 * Lives under `lib/workbench`, outside the Tailwind `@source` roots, and is a
 * `.tsx`, outside the coverage universe (`apps/** /*.ts`).
 */
import { strict as assert } from "node:assert";
import { makeDemoSite } from "@/lib/workbench/mock/demo.ts";

export function ViewWithStaticDemoImport() {
  assert.equal(typeof makeDemoSite, "function");
  return <p>{makeDemoSite.name}</p>;
}
