import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
 * unit suite would otherwise never see. The converse also matters: a route that
 * exists but no entry in the table names is a page nothing can reach. Resolved
 * from this file so the assertions hold whatever the working directory is.
 */
const PROJECT_ROUTES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../app/p/[projectId]",
);

/**
 * Redirect-only segments. They keep pre-migration deep links working but appear
 * neither in the sidebar nor in any "legacy page →" link, so no entry in
 * `routes.ts` can name them; `app/p/[projectId]/_canonical-routes.test.ts` pins
 * where each one lands. Listed here so the sweep below still fails on a route
 * that is reachable by nobody.
 */
const COMPATIBILITY_ONLY = ["diagnosis", "plan", "report"] as const;

/**
 * Every directory under `p/[projectId]` holding a `page.tsx`, sorted. One level
 * of nesting is walked because `legacy/overview` is nested; the App Router tree
 * here goes no deeper.
 */
function routeDirectories(): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(PROJECT_ROUTES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = resolve(PROJECT_ROUTES, entry.name);
    if (existsSync(resolve(directory, "page.tsx"))) found.push(entry.name);
    for (const nested of readdirSync(directory, { withFileTypes: true })) {
      if (!nested.isDirectory()) continue;
      if (existsSync(resolve(directory, nested.name, "page.tsx"))) {
        found.push(`${entry.name}/${nested.name}`);
      }
    }
  }
  return found.sort();
}

describe("workbench route table matches the App Router tree", () => {
  it.each(WORKBENCH_PAGE_IDS)("serves a page for %s", (id) => {
    const page = resolve(PROJECT_ROUTES, WORKBENCH_SEGMENTS[id], "page.tsx");
    expect(existsSync(page), page).toBe(true);

    // Which id the route hands to the view IS the content of a placeholder
    // page. A file copied from a sibling segment that kept the sibling's id
    // renders that sibling's title, badge and "legacy page →" links under this
    // URL; every other test here reads the table rather than the tree, so
    // nothing else would notice.
    const source = readFileSync(page, "utf8");
    const wired = [...source.matchAll(/page="([A-Za-z]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    // A page with its own view (Settings) passes no id — and must not claim
    // another page's id either.
    expect(wired, page).toEqual(source.includes("PlaceholderView") ? [id] : []);
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

  it("has no project route the table does not name", () => {
    const named = [
      ...Object.values(WORKBENCH_SEGMENTS),
      ...new Set(Object.values(LEGACY_LINKS).flat()),
      ...COMPATIBILITY_ONLY,
    ].sort();
    expect(routeDirectories()).toEqual(named);
  });
});
