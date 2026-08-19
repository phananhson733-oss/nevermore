// @input  -- robots projections as the crawl records them
// @output -- proof the allowance is read for the search crawler, not for us
// @pos    -- unit coverage for the shim behind A5 and 1.2

import { describe, expect, it } from "vitest";

import {
  SEARCH_CRAWLER_USER_AGENT,
  searchCrawlerMayFetch,
} from "./robots-allowance.ts";

const url = "https://acme.test/blog/post";

function robots(
  groups: readonly {
    userAgent: string;
    disallow: readonly string[];
    allow: readonly string[];
  }[],
  fetched = true,
) {
  return { fetched, groups };
}

describe("searchCrawlerMayFetch", () => {
  it("reads an unfetched robots.txt as unknown, never as permission", () => {
    // The whole point of these checks is that a file can forbid something. A
    // file we never read forbidding nothing would make both of them pass on
    // exactly the sites where they cannot be evaluated.
    expect(searchCrawlerMayFetch(robots([], false), url)).toBeNull();
  });

  it("returns null for a URL it cannot parse", () => {
    expect(searchCrawlerMayFetch(robots([]), "not a url")).toBeNull();
  });

  it("allows everything when the file names no rules", () => {
    expect(searchCrawlerMayFetch(robots([]), url)).toBe(true);
  });

  it("applies a group written for the search crawler, not the wildcard", () => {
    const result = searchCrawlerMayFetch(
      robots([
        { userAgent: "*", disallow: [], allow: ["/"] },
        { userAgent: SEARCH_CRAWLER_USER_AGENT, disallow: ["/blog"], allow: [] },
      ]),
      url,
    );

    // This is the case the whole check exists for: the file lets this run
    // through under the wildcard and stops the crawler that decides indexing.
    // Asking about our own token would answer "allowed" and report nothing.
    expect(result).toBe(false);
  });

  it("does not apply a group written for some other crawler", () => {
    expect(
      searchCrawlerMayFetch(
        robots([{ userAgent: "AhrefsBot", disallow: ["/blog"], allow: [] }]),
        url,
      ),
    ).toBe(true);
  });

  it("lets a more specific Allow beat a broader Disallow", () => {
    expect(
      searchCrawlerMayFetch(
        robots([
          {
            userAgent: SEARCH_CRAWLER_USER_AGENT,
            disallow: ["/blog"],
            allow: ["/blog/post"],
          },
        ]),
        url,
      ),
    ).toBe(true);
  });

  it("matches the query string, which a Disallow may name", () => {
    expect(
      searchCrawlerMayFetch(
        robots([
          { userAgent: SEARCH_CRAWLER_USER_AGENT, disallow: ["/*?"], allow: [] },
        ]),
        "https://acme.test/search?q=1",
      ),
    ).toBe(false);
  });
});
