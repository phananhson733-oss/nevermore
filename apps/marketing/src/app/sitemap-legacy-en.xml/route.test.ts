import { describe, expect, it } from "vitest";

describe("legacy English migration sitemap", () => {
  it("serves the frozen old-URL inventory as standalone XML", async () => {
    const { GET } = await import("./route.ts");
    const response = GET();
    const body = await response.text();
    const locations = [...body.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(
      (match) => match[1],
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
    expect(locations).toHaveLength(95);
    expect(new Set(locations).size).toBe(95);
    expect(
      locations.every((location) =>
        location.startsWith("https://gengrowth.ai/en"),
      ),
    ).toBe(true);
    expect(body).not.toContain("<lastmod>");
  });
});
