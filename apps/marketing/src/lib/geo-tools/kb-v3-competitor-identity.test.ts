import { describe, expect, it, vi } from "vitest";

import type { GeoKnowledgeResourceResult } from "./kb-knowledge-evidence.ts";
import {
  GEO_KB_V3_COMPETITOR_PAGE_TIMEOUT_MS,
  identifyGeoKbV3Competitor,
  type GeoKbV3CompetitorIdentityDependencies,
} from "./kb-v3-competitor-identity.ts";

const NOW = new Date("2026-09-11T08:00:00.000Z");
const HOME = "https://astro.example/";
const HTML = `<html><head><title>Astro Charts | Home</title><meta property="og:site_name" content="Astro"><script type="application/ld+json">{"@type":"Organization","name":"Astro Charts","alternateName":["Astro"]}</script></head><body></body></html>`;

function page(overrides: Partial<Extract<GeoKnowledgeResourceResult, { kind: "ok" }>> = {}): GeoKnowledgeResourceResult {
  return { kind: "ok", url: HOME, body: HTML, contentType: "text/html; charset=utf-8", observedAt: "2026-09-11T07:59:00.000Z", ...overrides };
}

function harness(overrides: Partial<GeoKbV3CompetitorIdentityDependencies> = {}) {
  const read = vi.fn(async (): Promise<GeoKnowledgeResourceResult> => page());
  const readCache = vi.fn(async () => null);
  const writeCache = vi.fn(async () => undefined);
  const dependencies: GeoKbV3CompetitorIdentityDependencies = { read, readCache, writeCache, now: () => NOW, ...overrides };
  return { dependencies, read, readCache, writeCache };
}

describe("identifyGeoKbV3Competitor", () => {
  it("reads the rival's own homepage through the gated reader and names it from what the page declares", async () => {
    const { dependencies, read, writeCache } = harness();
    const identity = await identifyGeoKbV3Competitor("astro.example", dependencies);
    expect(read).toHaveBeenCalledWith({ url: HOME, expected: "html", timeoutMs: GEO_KB_V3_COMPETITOR_PAGE_TIMEOUT_MS });
    expect(identity).toEqual({
      status: "available", domain: "astro.example", brandName: "Astro Charts", aliases: ["Astro"],
      method: "json_ld", sourceUrl: HOME, observedAt: "2026-09-11T07:59:00.000Z", cached: false,
    });
    // A successful read is shared for a day, across every account that names this rival.
    expect(writeCache).toHaveBeenCalledWith({ domain: "astro.example", brandName: "Astro Charts", aliases: ["Astro"], observedAt: "2026-09-11T07:59:00.000Z" });
  });

  it("answers from the shared cache without opening a request", async () => {
    const { dependencies, read, writeCache } = harness({
      readCache: async () => ({ domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"], observedAt: "2026-09-11T01:00:00.000Z" }),
    });
    const identity = await identifyGeoKbV3Competitor("astro.example", dependencies);
    expect(read).not.toHaveBeenCalled();
    expect(writeCache).not.toHaveBeenCalled();
    expect(identity).toEqual({
      status: "available", domain: "astro.example", brandName: "Astro", aliases: ["Astro Charts"],
      method: null, sourceUrl: HOME, observedAt: "2026-09-11T01:00:00.000Z", cached: true,
    });
  });

  /** A cached row with no name is a miss, not an answer: the page is read again. */
  it("treats a cached row without a name as a miss", async () => {
    const { dependencies, read } = harness({
      readCache: async () => ({ domain: "astro.example", brandName: null, aliases: [], observedAt: "2026-09-11T01:00:00.000Z" }),
    });
    const identity = await identifyGeoKbV3Competitor("astro.example", dependencies);
    expect(read).toHaveBeenCalledOnce();
    expect(identity.status).toBe("available");
  });

  it("asks the cache under the exact lowercased host and reads that host", async () => {
    const { dependencies, read, readCache } = harness();
    await identifyGeoKbV3Competitor("WWW.Astro.Example", dependencies);
    expect(readCache).toHaveBeenCalledWith("www.astro.example");
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ url: "https://www.astro.example/" }));
  });

  it("refuses a value that is not a host without reading anything", async () => {
    const { dependencies, read } = harness();
    await expect(identifyGeoKbV3Competitor("not a host", dependencies)).resolves.toEqual({ status: "unavailable", domain: "not a host", reason: "missing_url" });
    expect(read).not.toHaveBeenCalled();
  });

  it("says when our own gate refused, and caches nothing", async () => {
    const { dependencies, writeCache } = harness({ read: async () => ({ kind: "unavailable", url: HOME, reason: "fetch_failed" }) });
    await expect(identifyGeoKbV3Competitor("astro.example", dependencies)).resolves.toEqual({ status: "unavailable", domain: "astro.example", reason: "rate_limited" });
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("carries the site's own refusal through by its reason", async () => {
    const { dependencies } = harness({ read: async () => ({ kind: "unavailable", url: HOME, reason: "blocked", reached: true }) });
    await expect(identifyGeoKbV3Competitor("astro.example", dependencies)).resolves.toMatchObject({ status: "unavailable", reason: "blocked" });
  });

  it("refuses a page that is not HTML", async () => {
    const { dependencies, writeCache } = harness({ read: async () => page({ contentType: "application/json" }) });
    await expect(identifyGeoKbV3Competitor("astro.example", dependencies)).resolves.toMatchObject({ status: "unavailable", reason: "not_html" });
    expect(writeCache).not.toHaveBeenCalled();
  });

  /** The page that answered belongs to a different site, so its name is not this rival's. */
  it("refuses a homepage that landed on another host", async () => {
    const { dependencies, writeCache } = harness({ read: async () => page({ url: "https://elsewhere.example/" }) });
    await expect(identifyGeoKbV3Competitor("astro.example", dependencies)).resolves.toMatchObject({ status: "unavailable", reason: "target_redirected" });
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("reports a page that declares no name, and caches nothing for it", async () => {
    const { dependencies, writeCache } = harness({ read: async () => page({ body: "<html><head></head><body>hello</body></html>" }) });
    await expect(identifyGeoKbV3Competitor("astro.example", dependencies)).resolves.toMatchObject({ status: "unavailable", reason: "not_found" });
    expect(writeCache).not.toHaveBeenCalled();
  });

  it("falls back to og:site_name, then to the title", async () => {
    const og = harness({ read: async () => page({ body: `<html><head><title>Astro Charts | Home</title><meta property="og:site_name" content="Astro"></head></html>` }) });
    await expect(identifyGeoKbV3Competitor("astro.example", og.dependencies)).resolves.toMatchObject({ brandName: "Astro", method: "og_site_name", aliases: [] });
    const title = harness({ read: async () => page({ body: `<html><head><title>Astro Charts | Home</title></head></html>` }) });
    await expect(identifyGeoKbV3Competitor("astro.example", title.dependencies)).resolves.toMatchObject({ brandName: "Astro Charts | Home", method: "title" });
  });

  it("survives a cache that throws on either side", async () => {
    const { dependencies } = harness({ readCache: async () => { throw new Error("down"); }, writeCache: async () => { throw new Error("down"); } });
    await expect(identifyGeoKbV3Competitor("astro.example", dependencies)).resolves.toMatchObject({ status: "available", brandName: "Astro Charts" });
  });

  it("reports a reader that throws as a failed fetch rather than as an outage of the route", async () => {
    const { dependencies } = harness({ read: async () => { throw new Error("socket"); } });
    await expect(identifyGeoKbV3Competitor("astro.example", dependencies)).resolves.toMatchObject({ status: "unavailable", reason: "fetch_failed" });
  });
});
