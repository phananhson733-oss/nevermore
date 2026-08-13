import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CANONICAL_SITEMAP_SOURCE = fileURLToPath(
  new URL("../sitemap.ts", import.meta.url),
);

describe("legacy English migration sitemap", () => {
  it("serves the expanded old-URL inventory with per-entry lastmod", async () => {
    const { GET } = await import("./route.ts");
    const response = GET();
    const body = await response.text();
    const urlBlocks = [...body.matchAll(/<url>(.*?)<\/url>/gsu)].map(
      (match) => match[1] ?? "",
    );
    const locations = urlBlocks.map(
      (block) => block.match(/<loc>([^<]+)<\/loc>/u)?.[1] ?? "",
    );
    const lastmods = urlBlocks.map(
      (block) => block.match(/<lastmod>([^<]+)<\/lastmod>/u)?.[1] ?? "",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(response.headers.get("cache-control")).toBeTruthy();
    expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(
      true,
    );
    expect(body).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(locations).toHaveLength(162);
    expect(new Set(locations).size).toBe(162);
    expect(
      locations.every((location) =>
        location.startsWith("https://gengrowth.ai/en"),
      ),
    ).toBe(true);
    expect(new Set(lastmods)).toEqual(new Set(["2026-07-31", "2026-08-13"]));
    expect(body).toContain(
      "<loc>https://gengrowth.ai/en/glossary/backlink-profile</loc><lastmod>2026-08-13</lastmod>",
    );
    expect(body).toContain(
      "<loc>https://gengrowth.ai/en/blog/gengrowth-vs-improvado</loc><lastmod>2026-08-13</lastmod>",
    );
  });

  it("stays separate from the canonical sitemap and keeps /en crawlable", async () => {
    const [{ default: robots }, canonicalSitemapSource] = await Promise.all([
      import("../robots.ts"),
      Promise.resolve(readFileSync(CANONICAL_SITEMAP_SOURCE, "utf8")),
    ]);
    const robotsPolicy = robots();

    expect(canonicalSitemapSource).not.toContain("LEGACY_EN_MIGRATION_ENTRIES");
    expect(canonicalSitemapSource).not.toContain("sitemap-legacy-en.xml");
    expect(robotsPolicy.sitemap).toBe("https://gengrowth.ai/sitemap.xml");

    const rules = Array.isArray(robotsPolicy.rules)
      ? robotsPolicy.rules
      : [robotsPolicy.rules];
    for (const rule of rules) {
      const disallow = Array.isArray(rule.disallow)
        ? rule.disallow
        : rule.disallow
          ? [rule.disallow]
          : [];
      expect(disallow).not.toContain("/en/");
    }
  });
});
