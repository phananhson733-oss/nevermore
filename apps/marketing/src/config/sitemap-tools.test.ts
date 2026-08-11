// @input  -- the sitemap's tool list, the tool route directory, and the shared content table
// @output -- a failing test when a tool page is renamed, added, or removed in one place only
// @pos    -- the guard against a slug living in five files and drifting in four
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SITEMAP_TOOLS } from "./sitemap-tools.ts";
import {
  CONNECTED_TOOLS,
  getConnectedToolContent,
} from "../components/tools/connected-tool-content.ts";

/**
 * A tool slug is written down in five places: the route directory, the header
 * menu, the hub card, the sitemap, and the shared content table that supplies
 * the canonical URL and the OAuth return path. `navigation.test.ts` already
 * holds the menu to the directory; this file does the same for the other two,
 * because the ones a rename is most likely to miss are the ones no page
 * renders side by side.
 */

const TOOLS_ROUTE_DIR = fileURLToPath(
  new URL("../app/[locale]/tools", import.meta.url),
);
const HUB_PAGE = fileURLToPath(
  new URL("../app/[locale]/tools/page.tsx", import.meta.url),
);

/**
 * Routes that exist but are not pages.
 *
 * Both are `permanentRedirect` shims kept so old links to retired calculators
 * still land somewhere. A sitemap entry for a 301 spends the crawl twice, so
 * they are named here rather than filtered by a heuristic — adding a tool
 * without deciding fails this test instead of joining the exclusions.
 */
const REDIRECT_ONLY = new Set(["ab-test-calculator", "growth-roi-calculator"]);

function routedToolSlugs(): string[] {
  return readdirSync(TOOLS_ROUTE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("sitemap tool list", () => {
  it("names only tools that have a route", () => {
    const routed = new Set(routedToolSlugs());
    for (const slug of SITEMAP_TOOLS) {
      expect(routed, `/tools/${slug} has no route directory`).toContain(slug);
    }
  });

  it("names every routed page except the redirect shims", () => {
    const listed = new Set<string>(SITEMAP_TOOLS);
    const missing = routedToolSlugs().filter(
      (slug) => !listed.has(slug) && !REDIRECT_ONLY.has(slug),
    );
    expect(
      missing,
      "a tool page exists but crawlers are never told about it",
    ).toEqual([]);
  });
});

describe("connected tool paths", () => {
  it.each([...CONNECTED_TOOLS])("points %s at a route that exists", (tool) => {
    // The content table's `path` is the canonical URL, the OAuth return
    // address, and the key `ConnectedToolPage` matches to decide whether the
    // hero CTA starts a Google grant. A stale one 404s the visitor after they
    // have already granted access.
    const routed = new Set(routedToolSlugs());
    const path = getConnectedToolContent("en", tool).path;
    expect(path).toBe(`/tools/${tool}`);
    expect(routed, `${path} has no route directory`).toContain(tool);
  });

  it("gives the hub card the same slug the route uses", () => {
    // The hub links by slug, so a stale one is a 404 from the page whose whole
    // job is sending people to the tools.
    const source = readFileSync(HUB_PAGE, "utf8");
    const slugs = [...source.matchAll(/slug: "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(slugs.length).toBeGreaterThan(0);
    const routed = new Set(routedToolSlugs());
    for (const slug of slugs) {
      expect(routed, `the hub links /tools/${slug}, which has no route`).toContain(
        slug,
      );
    }
  });
});
