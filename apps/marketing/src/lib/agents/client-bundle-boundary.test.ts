// @input  -- modules that a client component imports for their values
// @output -- a failing test when one of them reaches the package barrel
// @pos    -- the one guard for a bundling break that typecheck and the suite both pass
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Modules pulled into the browser bundle for something other than a type.
 *
 * `@sf/public-tools` re-exports the crawl scanner, so a single value import
 * from the barrel puts `node:net` in a client chunk and fails the production
 * build with a chunking error that names the component rather than the import.
 * Typecheck passes. Ten thousand unit tests pass. Only `next build` says no,
 * and only after everything else looked green — which is why the rule is
 * checked here, next to the modules it applies to.
 *
 * Type-only imports are erased and therefore safe, but they are not exempted
 * below: the difference between `import type` and `import` in one of these
 * files is one keyword, and it is not worth relying on nobody dropping it.
 */
const CLIENT_REACHABLE = [
  "./audit-contract.ts",
  "../on-page-checker/copy-report.ts",
  "../on-page-checker/storage.ts",
  "../../components/tools/on-page-checker.tsx",
  "../../components/agents/agent-intent.ts",
  "../../components/agents/agent-profile.ts",
];

/** Barrels whose transitive graph contains a Node-only module. */
const FORBIDDEN_SPECIFIERS = ["@sf/public-tools", "@sf/sources", "@sf/engine"];

describe("client-reachable modules stay off the package barrels", () => {
  it.each(CLIENT_REACHABLE)("%s imports no barrel", (relative) => {
    const source = readFileSync(
      fileURLToPath(new URL(relative, import.meta.url)),
      "utf8",
    );

    for (const barrel of FORBIDDEN_SPECIFIERS) {
      expect(
        source.includes(`from "${barrel}"`),
        `${relative} imports the ${barrel} barrel; use a subpath export instead`,
      ).toBe(false);
    }
  });
});
