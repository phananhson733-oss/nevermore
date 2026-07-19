import { describe, expect, it } from "vitest";
import type { CollectionContext, NormalizedObservation } from "../adapter.ts";
import {
  createCrawlAdapter,
  DEFAULT_CRAWL_USER_AGENT,
} from "./adapter.ts";
import { CRAWL_BUDGET, type CrawlFetcher } from "./types.ts";

const ORIGIN = "https://adapter.example";
const CTX: CollectionContext = {
  workspaceId: "workspace",
  projectId: "project",
  siteId: "site",
  runId: "run",
};
const FAST_BUDGET = {
  ...CRAWL_BUDGET,
  maxUrls: 1,
  perHostConcurrency: 1,
  minHostDelayMs: 0,
} as const;

async function drain(
  values: AsyncIterable<NormalizedObservation>,
): Promise<NormalizedObservation[]> {
  const rows: NormalizedObservation[] = [];
  for await (const value of values) rows.push(value);
  return rows;
}

describe("createCrawlAdapter", () => {
  it("uses the injected offline fetcher and maps a budget-cut graph to canonical observations", async () => {
    const calls: string[] = [];
    const routes = new Map<string, () => Response>([
      [
        `${ORIGIN}/robots.txt`,
        () =>
          new Response(
            `User-agent: *\nDisallow: /private\nSitemap: ${ORIGIN}/sitemap.xml`,
            { headers: { "content-type": "text/plain" } },
          ),
      ],
      [
        `${ORIGIN}/sitemap.xml`,
        () =>
          new Response(
            `<?xml version="1.0"?><urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/about</loc></url></urlset>`,
            { headers: { "content-type": "application/xml" } },
          ),
      ],
      [
        `${ORIGIN}/`,
        () =>
          new Response(
            `<html><head><title>Adapter fixture</title></head><body><h1>Home</h1><a href="/about">About</a></body></html>`,
            { headers: { "content-type": "text/html" } },
          ),
      ],
    ]);
    const fetcher: CrawlFetcher = {
      async fetch(url) {
        calls.push(url);
        return routes.get(url)?.() ?? new Response("missing", { status: 404 });
      },
    };
    const adapter = createCrawlAdapter({
      fetcher,
      engineOptions: {
        guard: async (url) => ({
          safe: true,
          normalizedUrl: new URL(url).href,
          pinnedIp: "93.184.216.34",
          reason: null,
        }),
        budget: FAST_BUDGET,
      },
    });

    await expect(adapter.validateConfig(null)).resolves.toEqual({
      userAgent: DEFAULT_CRAWL_USER_AGENT,
    });
    await expect(
      adapter.validateConfig({ userAgent: "  FixtureBot/1.0  " }),
    ).resolves.toEqual({ userAgent: "FixtureBot/1.0" });
    await expect(
      adapter.capabilities({ userAgent: DEFAULT_CRAWL_USER_AGENT }),
    ).resolves.toEqual([
      expect.objectContaining({
        datasetKey: "crawl.site_graph.v1",
        operation: "site_graph",
        available: true,
        limitation: expect.stringContaining("2000 URLs"),
      }),
    ]);

    const result = await adapter.collect(
      { origin: ORIGIN, host: "adapter.example" },
      CTX,
    );
    expect(calls).toEqual([
      `${ORIGIN}/robots.txt`,
      `${ORIGIN}/sitemap.xml`,
      `${ORIGIN}/`,
    ]);
    expect(result).toMatchObject({
      availability: "partial",
      rowCount: 1,
      stopReason: "max_urls",
    });
    expect(result.limitation.trim()).not.toBe("");

    const observations = await drain(
      adapter.normalize(result.raw, {
        workspaceId: CTX.workspaceId,
        projectId: CTX.projectId,
        siteId: CTX.siteId,
        capturedAt: result.capturedAt,
      }),
    );
    expect(observations.map((row) => row.metricKey).sort()).toEqual([
      "crawl.page.v1",
      "crawl.robots.v1",
      "crawl.sitemap.v1",
    ]);
    expect(observations.every((row) => row.limitation.trim() !== "")).toBe(
      true,
    );
    expect(
      observations.find((row) => row.metricKey === "crawl.page.v1")
        ?.valueJson,
    ).toMatchObject({
      internalOutlinks: [{ targetSubjectUrl: `${ORIGIN}/about` }],
    });
  });

  it("keeps the production fetcher as the default while a rejecting guard prevents network IO", async () => {
    const adapter = createCrawlAdapter({
      engineOptions: {
        guard: async () => ({
          safe: false,
          normalizedUrl: null,
          pinnedIp: null,
          reason: "fixture blocked before transport",
        }),
        budget: FAST_BUDGET,
      },
    });

    const result = await adapter.collect(
      { origin: ORIGIN, host: "adapter.example" },
      CTX,
    );

    expect(result).toMatchObject({
      availability: "unavailable",
      rowCount: 0,
      stopReason: null,
    });
    expect(result.raw.providerUsage).toMatchObject({ urlsBlocked: 3 });
  });
});
