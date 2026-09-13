/**
 * The sample site's level and seed queries. This module imports nothing, so the
 * client store may read these without pulling in `demo.ts`, which reaches the
 * artifact builders and the audit rule library (store/client-import-graph.test.ts).
 */
export const DEMO_LEVEL = "full" as const;
/** Non-empty tuple: `DEMO_SEEDS[0]` stays a `string` under `noUncheckedIndexedAccess`. */
export const DEMO_SEEDS = ["ai visibility", "geo optimization", "content brief", "llm seo"] as const satisfies readonly [
  string,
  ...string[],
];
export type DemoLevel = "full" | "basic";
