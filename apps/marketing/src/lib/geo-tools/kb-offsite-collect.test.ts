import { describe, expect, it } from "vitest";

import { geoSourceCatalogueItemSchema } from "./kb-knowledge-shape.ts";
import type { GeoKnowledgeEvidenceReadResource, GeoKnowledgeResourceResult } from "./kb-knowledge-evidence.ts";
import { collectGeoOffsiteEvidence, GEO_OFFSITE_BUDGET, type GeoOffsiteBudget } from "./kb-offsite-collect.ts";
import type { GeoOffsiteSerpFetch, GeoOffsiteSerpResultRow } from "./kb-offsite-serp.ts";

const words = (prefix: string, count: number) =>
  Array.from({ length: count }, (_value, index) => `${prefix}${index}`).join(" ");

const WIKIPEDIA = "https://en.wikipedia.org/wiki/Acme_Analytics";
const G2 = "https://www.g2.com/products/acme/reviews";
const PRESS = "https://techcrunch.com/2026/acme";
const BLOG = "https://blog.unknown.example/acme";

const offsiteHtml = (options: {
  readonly names?: boolean;
  readonly linksBack?: boolean;
  readonly byline?: string;
  readonly marker?: string;
  readonly filler?: string;
}) => `<html><head>${options.byline === undefined ? "" : `<meta name="author" content="${options.byline}">`}</head>`
  + `<body><p>${options.marker ?? ""} ${options.names === false ? "A page about charts." : "Acme Analytics is a chart tool."}`
  + ` ${options.filler ?? words("story", 60)}</p>`
  + `${options.linksBack === false ? "" : `<a href="https://acme.example/pricing">site</a>`}</body></html>`;

const OWN_HTML = `<html><head><script type="application/ld+json">`
  + `{"@type":"Article","author":{"name":"Jane Doe"},"datePublished":"2026-08-01"}</script></head><body></body></html>`;

const row = (rankGroup: number, url: string): GeoOffsiteSerpResultRow =>
  ({ rankGroup, domain: new URL(url).hostname.replace(/^www\./u, ""), title: "A title", url });

const QUERIES = ['"Acme Analytics"', "Acme Analytics reviews", "Acme Analytics alternatives"];

const serpReader = (rows: readonly GeoOffsiteSerpResultRow[] | "throw"): GeoOffsiteSerpFetch =>
  async (request) => {
    if (rows === "throw") throw new Error("provider unavailable");
    return { rows: request.keyword === QUERIES[0] ? rows : [], costUsd: 0.002 };
  };

const OBSERVED_AT = "2026-09-07T00:00:00.000Z";

/** What a page in these tests needs to answer at all, in milliseconds. */
const PAGE_RESPONSE_MS = 50;

/** The reader's own failure vocabulary, which is narrower than the payload's. */
type ReadFailure = Extract<GeoKnowledgeResourceResult, { kind: "unavailable" }>["reason"];

type PageEntry =
  | string
  | { readonly contentType: string; readonly body: string }
  /** Fails with this exact reason, so a run can produce several distinct ones. */
  | { readonly unavailable: ReadFailure }
  | "unavailable";

const pageReader = (bodies: Readonly<Record<string, PageEntry>>): GeoKnowledgeEvidenceReadResource =>
  async ({ url }) => {
    const entry = bodies[url];
    if (entry === undefined || entry === "unavailable") return { kind: "unavailable", url, reason: "fetch_failed" };
    if (typeof entry === "string") return { kind: "ok", url, body: entry, contentType: "text/html; charset=utf-8", observedAt: OBSERVED_AT };
    if ("unavailable" in entry) return { kind: "unavailable", url, reason: entry.unavailable };
    return { kind: "ok", url, body: entry.body, contentType: entry.contentType, observedAt: OBSERVED_AT };
  };

const input = {
  brandNames: ["Acme Analytics", "Acme"],
  officialHosts: ["acme.example"],
  competitorHosts: ["rival.example"],
  market: "US",
  language: "en",
  ownTexts: [{ url: "https://acme.example/", text: words("own", 100) }],
  ownPages: [{ url: "https://acme.example/guide", sourceRef: "own_page-abc123", html: OWN_HTML }],
};

const dependencies = (
  serpOrganic: GeoOffsiteSerpFetch,
  readResource: GeoKnowledgeEvidenceReadResource,
  overrides: { readonly nowMs?: () => number; readonly budget?: Partial<GeoOffsiteBudget> } = {},
) => ({
  serp: { serpOrganic, onCost: () => undefined },
  readResource,
  now: () => new Date("2026-09-07T00:00:05.000Z"),
  ...overrides,
});

const fullRun = () => collectGeoOffsiteEvidence(input, dependencies(
  serpReader([row(1, WIKIPEDIA), row(2, G2), row(3, PRESS), row(4, BLOG)]),
  pageReader({
    [WIKIPEDIA]: offsiteHtml({ byline: "Wikipedia contributors" }),
    [G2]: offsiteHtml({ byline: "G2 Crowd", marker: "Profile claimed by the vendor." }),
    [PRESS]: offsiteHtml({ byline: "Nora Editor" }),
    [BLOG]: offsiteHtml({ byline: "Sam Blogger", linksBack: false }),
  }),
));

describe("a complete offsite collection", () => {
  it("fills the two offsite groups from what each domain publishes", async () => {
    const collection = await fullRun();
    expect(collection.evidence.thirdPartyProfiles.map((item) => item.label)).toEqual(["en.wikipedia.org", "www.g2.com"]);
    expect(collection.evidence.press.map((item) => item.label)).toEqual(["techcrunch.com"]);
    // An unrecognized domain is fetched and catalogued, but not filed under a
    // group whose name would assert something the table cannot support.
    expect(collection.sources.map((source) => source.label)).toContain("blog.unknown.example");
    expect([...collection.evidence.press, ...collection.evidence.thirdPartyProfiles]
      .some((item) => item.label === "blog.unknown.example")).toBe(false);
    expect(collection.evidence.collected).toEqual(["press", "thirdPartyProfiles", "firstPartyProof"]);
    expect(collection.spent).toMatchObject({ serpQueries: 3, pagesFetched: 4, pagesUnreadable: 0 });
  });

  it("emits source rows the knowledge contract accepts", async () => {
    const collection = await fullRun();
    for (const source of collection.sources) {
      expect(() => geoSourceCatalogueItemSchema.parse(source)).not.toThrow();
      expect(source.kind).toBe("third_party_page");
      expect(source.independence).not.toBeNull();
    }
  });

  it("carries each page's independence onto its source row", async () => {
    const collection = await fullRun();
    const byHost = new Map(collection.sources.map((source) => [source.label, source.independence]));
    expect(byHost.get("techcrunch.com")).toBe("independent");
    // A claimed vendor profile says so in its own words.
    expect(byHost.get("www.g2.com")).toBe("self_submitted");
  });

  it("promotes only cross-referenced identity records to sameAs", async () => {
    const collection = await fullRun();
    expect(collection.sameAsCandidates.map((candidate) => candidate.host)).toEqual(["en.wikipedia.org", "www.g2.com"]);
    // The press page cross-referenced too, but coverage is not identity.
    expect(collection.identityCandidates.map((candidate) => candidate.host))
      .toEqual(["techcrunch.com", "blog.unknown.example"]);
    expect(collection.identityCandidates.map((candidate) => candidate.verdict)).toEqual(["passed", "suspected"]);
    expect(collection.sameAsCandidates.every((candidate) => candidate.sameAsEligible)).toBe(true);
  });

  it("records the first-party observations from the site's own pages", async () => {
    const collection = await fullRun();
    expect(collection.evidence.firstPartyProof.map((item) => item.id)).toEqual([
      "evidence:first-party:structured_author:own_page-abc123",
      "evidence:first-party:structured_date_published:own_page-abc123",
    ]);
    expect(collection.evidence.firstPartyProof.every((item) => item.independence === "first_party")).toBe(true);
  });
});

describe("what a run refuses to claim", () => {
  it("does not mark the offsite groups collected when no query answered", async () => {
    const collection = await collectGeoOffsiteEvidence(input, dependencies(serpReader("throw"), pageReader({})));
    // The v1 bug in one assertion: an uncollected group must not read as an
    // empty one.
    expect(collection.evidence.collected).toEqual(["firstPartyProof"]);
    expect(collection.evidence.press).toEqual([]);
    expect(collection.incomplete).toContainEqual({ stage: "serp", reason: "fetch_failed", pending: 3 });
    expect(collection.sources).toEqual([]);
  });

  it("does not mark the first-party group collected when no own page was supplied", async () => {
    const collection = await collectGeoOffsiteEvidence(
      { ...input, ownPages: [] },
      dependencies(serpReader([row(1, WIKIPEDIA)]), pageReader({ [WIKIPEDIA]: offsiteHtml({ byline: "Wikipedia contributors" }) })),
    );
    // Only a profile page was read, so only the profile group is collected:
    // press is decided by press candidates, not by the run having happened.
    expect(collection.evidence.collected).toEqual(["thirdPartyProfiles"]);
    expect(collection.evidence.firstPartyProof).toEqual([]);
  });

  it("does not mark a group collected when it found candidates but read none of them", async () => {
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2)]),
      pageReader({}),
      { budget: { landingPages: 0 } },
    ));
    // The index answered; the evidence was never read. Saying "collected" here
    // would put the v1 lie back in a new place.
    expect(collection.evidence.collected).toEqual(["firstPartyProof"]);
    expect(collection.incomplete).toContainEqual({ stage: "landing_pages", reason: "not_collected", pending: 2 });
  });

  it("reports the candidates it never had budget to fetch", async () => {
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2), row(3, PRESS), row(4, BLOG)]),
      pageReader({ [WIKIPEDIA]: offsiteHtml({}), [G2]: offsiteHtml({}) }),
      { budget: { landingPages: 2 } },
    ));
    expect(collection.sources).toHaveLength(2);
    expect(collection.incomplete).toContainEqual({ stage: "landing_pages", reason: "not_collected", pending: 2 });
    expect(GEO_OFFSITE_BUDGET.landingPages).toBe(8);
  });

  it("stops at the wall clock and says how many pages were left", async () => {
    let clock = 0;
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2), row(3, PRESS)]),
      async ({ url }) => {
        clock += 20_000;
        return { kind: "ok", url, body: offsiteHtml({}), contentType: "text/html", observedAt: "2026-09-07T00:00:00.000Z" };
      },
      { nowMs: () => clock },
    ));
    expect(collection.sources).toHaveLength(2);
    expect(collection.incomplete).toContainEqual({ stage: "landing_pages", reason: "timeout", pending: 1 });
    // The two pages it did read are still returned; a partial collection is not
    // thrown away for being partial.
    expect(collection.evidence.thirdPartyProfiles).toHaveLength(2);
  });

  it("does not dispatch a landing-page fetch it has no time to complete", async () => {
    // The candidate that arrives with 5 ms left is the one this guards. Sending
    // it produces an `unavailable` source row and a `landing_page_reads` entry
    // -- the same record a page that was reached and refused to answer leaves
    // -- for a page nobody ever gave a chance to answer.
    let clock = 0;
    const dispatched: number[] = [];
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2), row(3, PRESS)]),
      async ({ url, timeoutMs }) => {
        dispatched.push(timeoutMs ?? 0);
        // Honest about its own latency: a page needs longer than a sliver of a
        // millisecond to answer, so a fetch dispatched with 5 ms times out.
        if ((timeoutMs ?? 0) < PAGE_RESPONSE_MS) return { kind: "unavailable", url, reason: "timeout" };
        clock = 29_995;
        return { kind: "ok", url, body: offsiteHtml({}), contentType: "text/html", observedAt: OBSERVED_AT };
      },
      { nowMs: () => clock },
    ));
    expect(dispatched).toEqual([GEO_OFFSITE_BUDGET.pageTimeoutMs]);
    expect(collection.sources).toHaveLength(1);
    expect(collection.incomplete).toContainEqual({ stage: "landing_pages", reason: "timeout", pending: 2 });
    // Nothing was fetched and failed, so nothing may be reported as such.
    expect(collection.incomplete.some((entry) => entry.stage === "landing_page_reads")).toBe(false);
    expect(collection.spent).toMatchObject({ pagesFetched: 1, pagesUnreadable: 0 });
  });

  it("still dispatches a candidate that has exactly the minimum budget left", async () => {
    // The floor stops a hopeless dispatch, not a tight one.
    let clock = 0;
    const dispatched: number[] = [];
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2)]),
      async ({ url, timeoutMs }) => {
        dispatched.push(timeoutMs ?? 0);
        clock = GEO_OFFSITE_BUDGET.totalMs - GEO_OFFSITE_BUDGET.minPageMs;
        return { kind: "ok", url, body: offsiteHtml({}), contentType: "text/html", observedAt: OBSERVED_AT };
      },
      { nowMs: () => clock },
    ));
    expect(dispatched).toEqual([GEO_OFFSITE_BUDGET.pageTimeoutMs, GEO_OFFSITE_BUDGET.minPageMs]);
    expect(collection.sources).toHaveLength(2);
    expect(collection.incomplete).toEqual([]);
  });

  it("refuses a hopeless dispatch even when the caller lowers the floor", async () => {
    // Lowering the floor is not permission to send a fetch that cannot finish.
    // 500 ms is the case a `Math.max(1, floor)` clamp let through: it is not
    // zero, so the clamp said yes, and it is under the floor, so the page could
    // not answer -- leaving the "fetched but could not be read" record for a
    // page nobody gave a chance to answer.
    expect(GEO_OFFSITE_BUDGET.minPageMs).toBeGreaterThan(500);
    let clock = 0;
    const dispatched: number[] = [];
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2)]),
      async ({ url, timeoutMs }) => {
        dispatched.push(timeoutMs ?? 0);
        // Honest about its own latency: this reader answers only inside the
        // window the floor says such a fetch needs.
        if ((timeoutMs ?? 0) < GEO_OFFSITE_BUDGET.minPageMs) return { kind: "unavailable", url, reason: "timeout" };
        clock = GEO_OFFSITE_BUDGET.totalMs - 500;
        return { kind: "ok", url, body: offsiteHtml({}), contentType: "text/html", observedAt: OBSERVED_AT };
      },
      { nowMs: () => clock, budget: { minPageMs: 0 } },
    ));
    expect(dispatched).toEqual([GEO_OFFSITE_BUDGET.pageTimeoutMs]);
    expect(collection.incomplete).toContainEqual({ stage: "landing_pages", reason: "timeout", pending: 1 });
    // The candidate is reported as never attempted, never as fetched and
    // unreadable, and it leaves no source row claiming a page refused to answer.
    expect(collection.incomplete.some((entry) => entry.stage === "landing_page_reads")).toBe(false);
    expect(collection.sources).toHaveLength(1);
    expect(collection.spent).toMatchObject({ pagesFetched: 1, pagesUnreadable: 0 });
  });

  it("honours a floor the caller raises", async () => {
    // The clamp is a floor, not a constant: a caller fetching a slow target may
    // demand a wider window than the shipped one, and 3 000 ms left is then not
    // enough. Pinning this is what keeps the fix above from being written as
    // "ignore the caller".
    let clock = 0;
    const dispatched: number[] = [];
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2)]),
      async ({ url, timeoutMs }) => {
        dispatched.push(timeoutMs ?? 0);
        clock = GEO_OFFSITE_BUDGET.totalMs - 3_000;
        return { kind: "ok", url, body: offsiteHtml({}), contentType: "text/html", observedAt: OBSERVED_AT };
      },
      { nowMs: () => clock, budget: { minPageMs: 4_000 } },
    ));
    expect(dispatched).toEqual([GEO_OFFSITE_BUDGET.pageTimeoutMs]);
    expect(collection.incomplete).toContainEqual({ stage: "landing_pages", reason: "timeout", pending: 1 });
  });

  it("lists a page it could not read, with no independence claim attached", async () => {
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2)]),
      pageReader({ [WIKIPEDIA]: "unavailable", [G2]: { contentType: "application/pdf", body: "%PDF" } }),
    ));
    expect(collection.sources.map((source) => [source.availability, source.reason, source.independence])).toEqual([
      ["unavailable", "fetch_failed", "undetermined"],
      ["unavailable", "invalid_response", "undetermined"],
    ]);
    // An unreadable page is not evidence, so it fills no group -- but it is
    // still catalogued, and counted.
    expect(collection.evidence.thirdPartyProfiles).toEqual([]);
    expect(collection.spent).toMatchObject({ pagesFetched: 0, pagesUnreadable: 2 });
  });

  it("marks no group collected when every page it fetched was unreadable", async () => {
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, PRESS)]),
      pageReader({}),
    ));
    // The SERP answered and both fetches ran; nothing came back that could be
    // read. "Collected, nothing found" here would tell the customer their brand
    // has no press coverage on the strength of zero pages read.
    expect(collection.evidence.collected).toEqual(["firstPartyProof"]);
    expect(collection.evidence.press).toEqual([]);
    expect(collection.evidence.thirdPartyProfiles).toEqual([]);
    expect(collection.incomplete).toContainEqual({ stage: "landing_page_reads", reason: "fetch_failed", pending: 2 });
    // Which pages failed, and why, is on the record with their URLs.
    expect(collection.sources.map((source) => [source.url, source.availability, source.reason])).toEqual([
      [WIKIPEDIA, "unavailable", "fetch_failed"],
      [PRESS, "unavailable", "fetch_failed"],
    ]);
    expect(collection.spent).toMatchObject({ pagesFetched: 0, pagesUnreadable: 2 });
  });

  it("collects the group whose own category was read, and not the group whose was not", async () => {
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, PRESS)]),
      // The one media candidate is the one that fails.
      pageReader({ [WIKIPEDIA]: offsiteHtml({ byline: "Wikipedia contributors" }) }),
    ));
    expect(collection.evidence.collected).toEqual(["thirdPartyProfiles", "firstPartyProof"]);
    expect(collection.evidence.thirdPartyProfiles).toHaveLength(1);
    expect(collection.evidence.press).toEqual([]);
    expect(collection.incomplete).toContainEqual({ stage: "landing_page_reads", reason: "fetch_failed", pending: 1 });
  });

  it("bounds the read failures it reports, keeping the most frequent reasons", async () => {
    const failing = Array.from({ length: 6 }, (_value, index) => `https://n${index}.unknown.example/acme`);
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader(failing.map((url, index) => row(index + 1, url))),
      pageReader({
        [failing[0] ?? ""]: "unavailable",
        [failing[1] ?? ""]: "unavailable",
        [failing[2] ?? ""]: { unavailable: "timeout" },
        [failing[3] ?? ""]: { unavailable: "blocked" },
        [failing[4] ?? ""]: { unavailable: "rate_limited" },
        [failing[5] ?? ""]: { unavailable: "not_found" },
      }),
    ));
    // Five distinct reasons, four reported: one limitation sentence per failed
    // page would crowd out the sentences before it. The count nobody may lose
    // is the total, and it is exact.
    expect(collection.incomplete.filter((entry) => entry.stage === "landing_page_reads")).toEqual([
      { stage: "landing_page_reads", reason: "fetch_failed", pending: 2 },
      { stage: "landing_page_reads", reason: "blocked", pending: 1 },
      { stage: "landing_page_reads", reason: "not_found", pending: 1 },
      { stage: "landing_page_reads", reason: "rate_limited", pending: 1 },
    ]);
    expect(collection.spent).toMatchObject({ pagesFetched: 0, pagesUnreadable: 6 });
    expect(collection.evidence.collected).toEqual(["firstPartyProof"]);
  });
});

describe("what a run may claim to have collected", () => {
  it("treats a search that surfaced nothing as a finding about both groups", async () => {
    const collection = await collectGeoOffsiteEvidence(input, dependencies(serpReader([]), pageReader({})));
    // Three queries ran and no third-party page came back. There was nothing to
    // read, so both groups are collected and empty -- that is the finding.
    expect(collection.evidence.collected).toEqual(["press", "thirdPartyProfiles", "firstPartyProof"]);
    expect(collection.sources).toEqual([]);
    expect(collection.incomplete).toEqual([]);
  });

  it("still discloses the reads that failed when the group was collected anyway", async () => {
    const collection = await collectGeoOffsiteEvidence(input, dependencies(
      serpReader([row(1, WIKIPEDIA), row(2, G2), row(3, PRESS)]),
      pageReader({
        [WIKIPEDIA]: offsiteHtml({ byline: "Wikipedia contributors" }),
        [PRESS]: offsiteHtml({ byline: "Nora Editor" }),
      }),
    ));
    expect(collection.evidence.collected).toEqual(["press", "thirdPartyProfiles", "firstPartyProof"]);
    expect(collection.evidence.press).toHaveLength(1);
    expect(collection.evidence.thirdPartyProfiles).toHaveLength(1);
    // Collected is not complete: the profile that could not be read is still
    // reported, so the group is never read as the whole picture.
    expect(collection.incomplete).toContainEqual({ stage: "landing_page_reads", reason: "fetch_failed", pending: 1 });
  });
});
