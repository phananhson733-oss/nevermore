// @input  -- synthetic crawl page rows covering shape, order and bound
// @output -- proof the shortlist stays neutral, deduplicated and matchable
// @pos    -- unit guard for the server-side key-page projection

import { describe, expect, it } from "vitest";
import type { SeoAuditReport } from "@sf/public-tools/seo-audit/types";

import {
  AGENT_KEY_PAGE_CANDIDATE_LIMIT,
  selectAgentKeyPageCandidates,
} from "./key-page-candidates.ts";

type Page = SeoAuditReport["pages"][number];

function page(overrides: Partial<Page> & { readonly url: string }): Page {
  return {
    subjectUrl: overrides.url,
    finalUrl: overrides.url,
    depth: 1,
    initialStatus: 200,
    finalStatus: 200,
    redirectHops: 0,
    contentType: "text/html; charset=utf-8",
    robotsDirectiveState: null,
    canonicalTarget: null,
    title: "Title",
    metaDescription: "Description",
    h1Count: 1,
    headingsCount: 3,
    wordCount: 400,
    inboundLinks: 1,
    outboundLinks: 5,
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
    ...overrides,
  } as unknown as Page;
}

const ORIGIN = "https://example.com";

function urls(
  candidates: ReturnType<typeof selectAgentKeyPageCandidates>,
): readonly string[] {
  return candidates.map((entry) => entry.url);
}

describe("selectAgentKeyPageCandidates", () => {
  it("drops pages the crawl could not read as HTML", () => {
    const candidates = selectAgentKeyPageCandidates({
      pages: [
        page({ url: `${ORIGIN}/ok` }),
        page({ url: `${ORIGIN}/gone`, finalStatus: 404 }),
        page({ url: `${ORIGIN}/redirect`, finalStatus: 301 }),
        page({ url: `${ORIGIN}/never`, finalStatus: null }),
        page({ url: `${ORIGIN}/feed.xml`, contentType: "application/xml" }),
      ],
      siteOrigin: ORIGIN,
      inspectedTargetUrl: null,
    });

    expect(urls(candidates)).toEqual([`${ORIGIN}/ok`]);
  });

  it("keeps one row per subject when a page was reached twice", () => {
    const candidates = selectAgentKeyPageCandidates({
      pages: [
        page({ url: `${ORIGIN}/pricing`, subjectUrl: `${ORIGIN}/pricing` }),
        page({
          url: `${ORIGIN}/pricing?ref=nav`,
          subjectUrl: `${ORIGIN}/pricing`,
        }),
      ],
      siteOrigin: ORIGIN,
      inspectedTargetUrl: null,
    });

    expect(urls(candidates)).toEqual([`${ORIGIN}/pricing`]);
  });

  it("puts the home page first and the submitted page second", () => {
    const candidates = selectAgentKeyPageCandidates({
      pages: [
        page({ url: `${ORIGIN}/blog`, inboundLinks: 40 }),
        page({ url: `${ORIGIN}/pricing`, inboundLinks: 2 }),
        page({ url: `${ORIGIN}/`, inboundLinks: 1 }),
      ],
      siteOrigin: ORIGIN,
      inspectedTargetUrl: `${ORIGIN}/pricing`,
    });

    expect(urls(candidates).slice(0, 2)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/pricing`,
    ]);
  });

  it("does not list the home page twice when it is also the submitted page", () => {
    const candidates = selectAgentKeyPageCandidates({
      pages: [page({ url: `${ORIGIN}/` }), page({ url: `${ORIGIN}/about` })],
      siteOrigin: ORIGIN,
      inspectedTargetUrl: `${ORIGIN}/`,
    });

    expect(urls(candidates)).toEqual([`${ORIGIN}/`, `${ORIGIN}/about`]);
  });

  it("ranks the rest by inbound links, then by URL, before going deeper", () => {
    const candidates = selectAgentKeyPageCandidates({
      pages: [
        page({ url: `${ORIGIN}/deep`, depth: 2, inboundLinks: 99 }),
        page({ url: `${ORIGIN}/b`, inboundLinks: 5 }),
        page({ url: `${ORIGIN}/a`, inboundLinks: 5 }),
        page({ url: `${ORIGIN}/c`, inboundLinks: 9 }),
      ],
      siteOrigin: ORIGIN,
      inspectedTargetUrl: null,
    });

    // Depth 1 exhausts before depth 2 is considered, however well linked the
    // deeper page is: distance from the entry point is the structural claim
    // this projection can actually support.
    expect(urls(candidates)).toEqual([
      `${ORIGIN}/c`,
      `${ORIGIN}/a`,
      `${ORIGIN}/b`,
      `${ORIGIN}/deep`,
    ]);
  });

  it("stops at the published bound", () => {
    const candidates = selectAgentKeyPageCandidates({
      pages: Array.from({ length: 60 }, (_, index) =>
        page({ url: `${ORIGIN}/p${String(index).padStart(2, "0")}` }),
      ),
      siteOrigin: ORIGIN,
      inspectedTargetUrl: null,
    });

    expect(candidates).toHaveLength(AGENT_KEY_PAGE_CANDIDATE_LIMIT);
  });

  it("publishes nothing when the crawl collected nothing", () => {
    expect(
      selectAgentKeyPageCandidates({
        pages: [],
        siteOrigin: ORIGIN,
        inspectedTargetUrl: null,
      }),
    ).toEqual([]);
  });

  it("publishes the fetch URL, which is the form observations carry", () => {
    // The evaluator compares an observation's URL to the key page's with only
    // the fragment stripped. Publishing `subjectUrl` instead would silently
    // match nothing, and every key page would read as "no observation".
    const candidates = selectAgentKeyPageCandidates({
      pages: [
        page({
          url: `${ORIGIN}/pricing?ref=nav`,
          subjectUrl: `${ORIGIN}/pricing`,
        }),
      ],
      siteOrigin: ORIGIN,
      inspectedTargetUrl: null,
    });

    expect(urls(candidates)).toEqual([`${ORIGIN}/pricing?ref=nav`]);
  });

  it("carries only the five fields the wire guard admits", () => {
    const [first] = selectAgentKeyPageCandidates({
      pages: [page({ url: `${ORIGIN}/a`, depth: 2, inboundLinks: 7 })],
      siteOrigin: ORIGIN,
      inspectedTargetUrl: null,
    });

    expect(Object.keys(first ?? {}).toSorted()).toEqual([
      "depth",
      "inboundLinks",
      "metaDescription",
      "title",
      "url",
    ]);
  });
});
