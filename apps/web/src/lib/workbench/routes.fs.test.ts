import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEGACY_LINKS,
  WORKBENCH_PAGE_IDS,
  WORKBENCH_SEGMENTS,
} from "./routes.ts";

/**
 * The route table is plain data; nothing in it type-checks against the App
 * Router tree. A sidebar entry whose segment has no `page.tsx`, or a "legacy
 * page →" link pointing at a directory that was moved or retired, is a 404 the
 * unit suite would otherwise never see. Resolved from this file so the assertion
 * holds whatever the working directory is.
 */
const PROJECT_ROUTES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/p/[projectId]",
);

describe("workbench route table matches the App Router tree", () => {
  it.each(WORKBENCH_PAGE_IDS)("serves a page for %s", (id) => {
    const page = resolve(PROJECT_ROUTES, WORKBENCH_SEGMENTS[id], "page.tsx");
    expect(existsSync(page), page).toBe(true);
  });

  it("keeps every legacy destination reachable", () => {
    const segments = [...new Set(Object.values(LEGACY_LINKS).flat())].sort();
    expect(segments).toContain("legacy/overview");
    for (const segment of segments) {
      const directory = resolve(PROJECT_ROUTES, segment);
      expect(existsSync(directory), directory).toBe(true);
      expect(statSync(directory).isDirectory(), directory).toBe(true);
      // A directory alone is not a route: a segment left with only `_*.tsx`
      // helpers after a move would still pass the check above and 404 in the UI.
      const page = resolve(directory, "page.tsx");
      expect(existsSync(page), page).toBe(true);
    }
  });
});
