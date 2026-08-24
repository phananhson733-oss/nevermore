// @input  -- the sitemap's tool list, the tool route directory, and the shared content table
// @output -- a failing test when a tool page is renamed, added, or removed in one place only
// @pos    -- the guard against a slug living in five files and drifting in four
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * Read as text, not imported.
 *
 * `app/sitemap.ts` imports through `@/`, which the shared Vitest config maps
 * to apps/web, so it cannot be loaded here. Checking the constant alone would
 * pass with the generator no longer using it, which is the one way the new
 * route silently leaves `/sitemap.xml`.
 */
const SITEMAP_MODULE = fileURLToPath(
  new URL("../app/sitemap.ts", import.meta.url),
);

/**
 * Routes that exist only as compatibility redirects.
 *
 * These are `permanentRedirect` shims kept so old links still land somewhere.
 * A sitemap entry for a 301 spends the crawl twice, so they are named here
 * rather than filtered by a heuristic — adding a route without deciding fails
 * this test instead of silently joining the exclusions.
 */
const REDIRECT_ONLY = new Set([
  "ab-test-calculator",
  "growth-roi-calculator",
  "internal-link-audit",
  "seo-audit",
]);

/**
 * Directories that actually hold a page.
 *
 * A directory alone proves nothing: deleting `page.tsx` and leaving anything
 * else behind would keep every route-existence check green while the sitemap,
 * the canonical, the OAuth return, the menu and the hub all point at a 404.
 */
function routedToolSlugs(): string[] {
  return readdirSync(TOOLS_ROUTE_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(`${TOOLS_ROUTE_DIR}/${entry.name}/page.tsx`),
    )
    .map((entry) => entry.name)
    .sort();
}

describe("sitemap tool list", () => {
  it("keeps every compatibility redirect out of the sitemap", () => {
    const listed = new Set<string>(SITEMAP_TOOLS);
    for (const slug of REDIRECT_ONLY) {
      expect(listed, `/tools/${slug} is redirect-only`).not.toContain(slug);
    }
  });

  it("names only tools that have a route", () => {
    const routed = new Set(routedToolSlugs());
    for (const slug of SITEMAP_TOOLS) {
      expect(routed, `/tools/${slug} has no route directory`).toContain(slug);
    }
  });

  it("is the list the generator actually loops", () => {
    const source = readFileSync(SITEMAP_MODULE, "utf8");
    expect(source).toContain("SITEMAP_TOOLS");
    expect(source).toMatch(/for \(const tool of SITEMAP_TOOLS\)/);
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

describe("sitemap Agent routes", () => {
  it("includes the directory and both Agents in the locale loop", () => {
    const source = readFileSync(SITEMAP_MODULE, "utf8");
    expect(source).toContain('const locales = ["en", "zh"]');
    expect(source).toContain('"/agents"');
    expect(source).toContain('"/agents/seo"');
    // GEO is its own Agent on its own evidence, so it is listed. The technical
    // route is a focus of the SEO Agent and is deliberately not — see below.
    expect(source).toContain('"/agents/geo"');
    expect(source).toMatch(/for \(const locale of locales\)/);
    expect(source).toMatch(/for \(const page of staticPages\)/);
  });

  /**
   * `/agents/tech` is neither listed nor redirected.
   *
   * It renders the same workbench as `/agents/seo` over the same engine and
   * differs only in which checks open first, so it hands its search authority
   * to that page while keeping its own URL alive for existing links. Both
   * halves are asserted here: dropping it from the sitemap without the
   * cross-canonical, or the reverse, leaves a near-duplicate competing with
   * the page it was supposed to defer to.
   */
  it("consolidates the Tech Agent instead of listing or redirecting it", () => {
    const sitemapSource = readFileSync(SITEMAP_MODULE, "utf8");
    expect(sitemapSource).not.toContain('"/agents/tech"');

    const techPage = readFileSync(
      fileURLToPath(
        new URL("../app/[locale]/agents/tech/page.tsx", import.meta.url),
      ),
      "utf8",
    );
    expect(techPage).toContain('const CANONICAL_PATH = "/agents/seo"');
    expect(techPage).toContain("canonicalPath: CANONICAL_PATH");
    // Still a page, not a shim: the URL has to keep answering.
    expect(techPage).not.toContain("permanentRedirect");
  });
});

describe("connected tool paths", () => {
  // Both locales: the table holds a separate object per language, and a stale
  // path in only one of them sends exactly that language's visitors to the
  // wrong canonical and the wrong OAuth return.
  it.each(
    ["en", "zh"].flatMap((locale) =>
      CONNECTED_TOOLS.map((tool) => [locale, tool] as const),
    ),
  )("points %s/%s at a route that exists", (locale, tool) => {
    const routed = new Set(routedToolSlugs());
    const path = getConnectedToolContent(locale, tool).path;
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
      expect(
        routed,
        `the hub links /tools/${slug}, which has no route`,
      ).toContain(slug);
    }
    // And in the other direction. Checking only that present cards resolve
    // would pass with the card deleted outright — the tool would simply be
    // absent from the page whose job is listing the tools.
    const listed = new Set(slugs);
    for (const tool of CONNECTED_TOOLS) {
      expect(listed, `the hub has no card for /tools/${tool}`).toContain(tool);
    }
  });

  it("keeps the Daily Search Briefing first in the diagnosis hub", () => {
    const source = readFileSync(HUB_PAGE, "utf8");
    const slugs = [...source.matchAll(/slug: "([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(slugs[0]).toBe("daily-search-briefing");
  });
});
