// @input  -- grant resolutions and Search Console rows
// @output -- proof the audit degrades to the gated state instead of failing
// @pos    -- unit coverage for the only place the Agent audit touches Search Console

import { describe, expect, it, vi } from "vitest";
import type { SeoAuditReport } from "@sf/public-tools";
import type { SearchPerformanceRaw } from "@sf/public-tools/seo-audit/search-performance";

import type { GrantResolution } from "../auth/grant-cookie.ts";
import { readAgentSearchPerformance } from "./search-performance.ts";

function page(url: string): SeoAuditReport["pages"][number] {
  return {
    url,
    subjectUrl: url,
    finalUrl: url,
    depth: 1,
    initialStatus: 200,
    finalStatus: 200,
    redirectHops: 0,
    contentType: "text/html",
    robotsDirectiveState: "noindex_not_observed",
    canonicalTarget: url,
    title: "T",
    metaDescription: "D",
    h1Count: 1,
    headingsCount: 1,
    wordCount: 100,
    inboundLinks: 1,
    outboundLinks: 1,
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
  };
}

const GRANT: GrantResolution = {
  kind: "grant",
  accessToken: "token-abc",
  properties: ["sc-domain:acme.test"],
  propertyTotal: 1,
};

function rawRows(): SearchPerformanceRaw {
  return {
    property: "sc-domain:acme.test",
    startDate: "2026-07-19",
    endDate: "2026-08-15",
    pages: [
      { key: "https://acme.test/", clicks: 3, impressions: 90, position: 4 },
    ],
    queries: [{ key: "acme", clicks: 3, impressions: 90, position: 4 }],
    pagesTruncated: false,
    queriesTruncated: false,
  };
}

const pages = [page("https://acme.test/"), page("https://acme.test/about")];

describe("readAgentSearchPerformance", () => {
  it("reads the visitor's own property and returns its window", async () => {
    const read = vi.fn(async () => rawRows());
    const result = await readAgentSearchPerformance(
      { targetUrl: "https://acme.test/", pages },
      { resolveGrant: async () => GRANT, read },
    );

    expect(read).toHaveBeenCalledWith({
      property: "sc-domain:acme.test",
      accessToken: "token-abc",
    });
    expect(result?.property).toBe("sc-domain:acme.test");
    expect(result?.startDate).toBe("2026-07-19");
    expect(result?.records.map((record) => record.id)).toEqual([
      "page_without_search_impressions",
      "impression_share_top_positions",
      "impression_share_low_click_positions",
    ]);
  });

  it.each([
    ["no cookie", { kind: "none" } as const],
    ["a revoked grant", { kind: "revoked" } as const],
  ])("returns nothing and reads nothing for %s", async (_label, grant) => {
    const read = vi.fn(async () => rawRows());
    const result = await readAgentSearchPerformance(
      { targetUrl: "https://acme.test/", pages },
      { resolveGrant: async () => grant as GrantResolution, read },
    );

    expect(result).toBeNull();
    // A missing grant must not spend a Search Console request to find that out.
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read a property that does not cover the audited host", async () => {
    const read = vi.fn(async () => rawRows());
    const result = await readAgentSearchPerformance(
      { targetUrl: "https://other.test/", pages },
      {
        resolveGrant: async () => GRANT,
        read,
      },
    );

    // The grant is real, it just covers a different site. Reading it anyway
    // would attribute one site's numbers to another.
    expect(result).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("picks the narrowest property covering the host", async () => {
    const read = vi.fn(async () => rawRows());
    await readAgentSearchPerformance(
      { targetUrl: "https://acme.test/blog/post", pages },
      {
        resolveGrant: async () => ({
          ...GRANT,
          properties: ["sc-domain:acme.test", "https://acme.test/blog/"],
          propertyTotal: 2,
        }),
        read,
      },
    );

    // A domain property covers every subdomain and both schemes, so reading it
    // to answer a question about one section reports the whole site's numbers.
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ property: "https://acme.test/blog/" }),
    );
  });

  it("lets a failing read reject, so the caller degrades rather than guesses", async () => {
    await expect(
      readAgentSearchPerformance(
        { targetUrl: "https://acme.test/", pages },
        {
          resolveGrant: async () => GRANT,
          read: async () => {
            throw new Error("429");
          },
        },
      ),
    ).rejects.toThrow();
  });
});
