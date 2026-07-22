import { METRIC_CRAWL_PAGE } from "@sf/sources";
import type { CrawlLinkProjection, CrawlPageProjection } from "@sf/sources";
import { describe, expect, it } from "vitest";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { testObservationLineage } from "../test-observation-lineage.ts";
import { techLinkgraphRule } from "./tech-linkgraph.ts";

const OBSERVED_AT = "2026-07-18T00:00:00Z";

function makePage(overrides: Partial<CrawlPageProjection>): CrawlPageProjection {
  return {
    fetchUrl: "https://x.com/",
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    title: null,
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: null,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: null,
    contentType: null,
    ...overrides,
  };
}

function link(targetSubjectUrl: string): CrawlLinkProjection {
  return { targetSubjectUrl, rel: null, anchorText: null };
}

function pageObs(subjectUrl: string, page: CrawlPageProjection): ObservationView {
  const pageWithSubjectFetch =
    page.fetchUrl === "https://x.com/" && subjectUrl !== "https://x.com/"
      ? { ...page, fetchUrl: subjectUrl }
      : page;
  return {
    ...testObservationLineage(`crawl:${pageWithSubjectFetch.fetchUrl}`, {
      sitePageUrl: pageWithSubjectFetch.fetchUrl,
      pageSnapshot: true,
    }),
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef: subjectUrl,
    provider: "crawl",
    availability: "available",
    valueJson: pageWithSubjectFetch,
    observedAt: OBSERVED_AT,
  };
}

function buildCtx(
  observations: readonly ObservationView[],
  opts: { crawl?: CoverageInput["crawl"]; priorityUrls?: readonly string[] } = {},
): DiagnosticContext {
  return DiagnosticContext.build({
    icp: parseIcp({ productName: "Acme", priorityUrls: opts.priorityUrls ?? [] }),
    deliveryLocale: "en",
    observations,
    coverage: {
      crawl: opts.crawl ?? "available",
      gsc: "unavailable",
      ga4: "unavailable",
      csv: "unavailable",
    },
    capturedAt: { crawl: OBSERVED_AT },
  });
}

describe("TECH-LINKGRAPH-005 tech-linkgraph", () => {
  it("uses links unique to exact source variants and remains observation-order invariant", () => {
    const sourceA = "https://x.com/source-a";
    const sourceB = "https://x.com/source-b";
    const target = "https://x.com/pricing";
    const observations = [
      pageObs(sourceA, makePage({ fetchUrl: sourceA, internalOutlinks: [] })),
      pageObs(
        sourceA,
        makePage({
          fetchUrl: `${sourceA}/`,
          internalOutlinks: [link(target)],
        }),
      ),
      pageObs(
        sourceB,
        makePage({ fetchUrl: sourceB, internalOutlinks: [link(target)] }),
      ),
      pageObs(target, makePage({ fetchUrl: target })),
    ];

    const forwardCtx = buildCtx(observations);
    const reversedCtx = buildCtx([...observations].reverse());

    expect(forwardCtx.internalInlinks.get(target)).toBe(2);
    expect(reversedCtx.internalInlinks.get(target)).toBe(2);
    expect(techLinkgraphRule.evaluate(forwardCtx)).toEqual({
      status: "pass",
      metrics: { affectedCount: 0 },
    });
    expect(techLinkgraphRule.evaluate(reversedCtx)).toEqual(
      techLinkgraphRule.evaluate(forwardCtx),
    );
  });

  it("counts slash variants of one source subject only once for the same target", () => {
    const source = "https://x.com/source";
    const target = "https://x.com/pricing";
    const ctx = buildCtx([
      pageObs(
        source,
        makePage({ fetchUrl: source, internalOutlinks: [link(target)] }),
      ),
      pageObs(
        source,
        makePage({
          fetchUrl: `${source}/`,
          internalOutlinks: [link(target)],
        }),
      ),
      pageObs(target, makePage({ fetchUrl: target })),
    ]);

    expect(ctx.internalInlinks.get(target)).toBe(1);
    const result = techLinkgraphRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.evidence[0]?.subjectRefs).toEqual([target]);
  });

  it("cites every exact indexable target variant without duplicating the finding subject", () => {
    const target = "https://x.com/pricing";
    const observations = [
      pageObs(
        target,
        makePage({
          fetchUrl: target,
          status: 200,
          finalStatus: 200,
          robotsIndexable: true,
        }),
      ),
      pageObs(
        target,
        makePage({
          fetchUrl: `${target}/`,
          status: 204,
          finalStatus: 204,
          robotsIndexable: true,
        }),
      ),
    ];

    const forward = techLinkgraphRule.evaluate(buildCtx(observations));
    const reversed = techLinkgraphRule.evaluate(
      buildCtx([...observations].reverse()),
    );

    expect(forward).toEqual(reversed);
    if (forward.status !== "candidate") throw new Error("expected candidate");
    expect(forward.candidates[0]?.metrics).toEqual({ affectedCount: 1 });
    expect(forward.candidates[0]?.evidence[0]?.subjectRefs).toEqual([
      target,
      `${target}/`,
    ]);
  });

  it("evaluates a commercial subject when only its slash variant is indexable 2xx", () => {
    const target = "https://x.com/pricing";
    const observations = [
      pageObs(
        target,
        makePage({
          fetchUrl: target,
          status: 404,
          finalStatus: 404,
          robotsIndexable: false,
        }),
      ),
      pageObs(
        target,
        makePage({
          fetchUrl: `${target}/`,
          status: 200,
          finalStatus: 200,
          robotsIndexable: true,
        }),
      ),
    ];

    const forward = techLinkgraphRule.evaluate(buildCtx(observations));
    const reversed = techLinkgraphRule.evaluate(
      buildCtx([...observations].reverse()),
    );

    expect(forward).toEqual(reversed);
    if (forward.status !== "candidate") throw new Error("expected candidate");
    expect(forward.candidates[0]?.evidence[0]?.subjectRefs).toEqual([
      `${target}/`,
    ]);
  });

  it("flags commercial pages with fewer than 2 internal inlinks (priority -> high)", () => {
    const ctx = buildCtx(
      [
        // /home links to /pricing once -> /pricing has 1 inlink (< 2).
        pageObs("https://x.com/home", makePage({ internalOutlinks: [link("https://x.com/pricing")] })),
        pageObs("https://x.com/pricing", makePage({})),
        // non-commercial page with 0 inlinks is not flagged.
        pageObs("https://x.com/blog", makePage({})),
      ],
      { priorityUrls: ["https://x.com/pricing"] },
    );
    const result = techLinkgraphRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    expect(c?.subjectRefs).toEqual(["page_set:low_internal_inlinks"]);
    expect(c?.severity).toBe("high"); // /pricing is a priority URL
    expect(c?.metrics).toEqual({ affectedCount: 1 });
    expect(c?.evidence[0]?.subjectRefs).toEqual(["https://x.com/pricing"]);
    expect(c?.evidence[0]?.method).toBe("computed");
    expect(c?.evidence[0]?.origin).toBe("derived");
  });

  it("rates non-priority commercial pages as medium", () => {
    const ctx = buildCtx([pageObs("https://x.com/pricing", makePage({}))]);
    const result = techLinkgraphRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.severity).toBe("medium");
  });

  it("passes when commercial pages have >= 2 internal inlinks", () => {
    const ctx = buildCtx([
      pageObs("https://x.com/a", makePage({ internalOutlinks: [link("https://x.com/pricing")] })),
      pageObs("https://x.com/b", makePage({ internalOutlinks: [link("https://x.com/pricing")] })),
      pageObs("https://x.com/pricing", makePage({})),
    ]);
    expect(techLinkgraphRule.evaluate(ctx)).toEqual({
      status: "pass",
      metrics: { affectedCount: 0 },
    });
  });

  it("is inconclusive on a partial crawl (link graph incomplete)", () => {
    const ctx = buildCtx([pageObs("https://x.com/pricing", makePage({}))], { crawl: "partial" });
    expect(techLinkgraphRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "partial_crawl_incomplete_link_graph",
    });
  });

  it("skips when crawl is unavailable", () => {
    const ctx = buildCtx([], { crawl: "unavailable" });
    expect(techLinkgraphRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });
});
