import { METRIC_CRAWL_PAGE } from "@sf/sources";
import type { CrawlLinkProjection, CrawlPageProjection } from "@sf/sources";
import { describe, expect, it } from "vitest";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { testObservationLineage } from "../test-observation-lineage.ts";
import {
  createLegacyTechLinkgraphExecutor,
  techLinkgraphRule,
} from "./tech-linkgraph.ts";

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

function pageObs(
  subjectUrl: string,
  page: CrawlPageProjection,
  depth = 1,
): ObservationView {
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
    crawlDepth: depth,
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

function candidatesByKind(ctx: DiagnosticContext) {
  const result = techLinkgraphRule.evaluate(ctx);
  if (result.status !== "candidate") throw new Error("expected candidates");
  return new Map(
    result.candidates.map((candidate) => [candidate.titleArgs["kind"], candidate]),
  );
}

describe("TECH-LINKGRAPH-005@3", () => {
  it("projects low-inbound, deep-page, and unresolved-target sets deterministically", () => {
    const home = "https://x.com/";
    const source = "https://x.com/guides/source";
    const low = "https://x.com/guides/low";
    const deep = "https://x.com/guides/deep";
    const missing = "https://x.com/guides/not-collected";
    const observations = [
      pageObs(home, makePage({ fetchUrl: home, internalOutlinks: [link(low), link(deep)] }), 0),
      pageObs(
        source,
        makePage({ fetchUrl: source, internalOutlinks: [link(low), link(missing)] }),
        2,
      ),
      pageObs(low, makePage({ fetchUrl: low }), 2),
      pageObs(deep, makePage({ fetchUrl: deep }), 4),
    ];

    const forward = techLinkgraphRule.evaluate(buildCtx(observations));
    const reversed = techLinkgraphRule.evaluate(buildCtx([...observations].reverse()));
    expect(reversed).toEqual(forward);

    const candidates = candidatesByKind(buildCtx(observations));
    expect(candidates.get("low_inbound")?.metrics).toMatchObject({
      affectedCount: 2,
      maximumObservedInlinks: 1,
    });
    expect(candidates.get("deep_page")?.metrics).toEqual({
      affectedCount: 1,
      minimumDepth: 3,
      maximumDepth: 4,
    });
    const unresolved = candidates.get("unresolved_target");
    expect(unresolved?.metrics).toEqual({
      affectedCount: 1,
      unresolvedTargetCount: 1,
    });
    expect(unresolved?.evidence[0]?.subjectRefs).toEqual([missing, source]);
    expect(unresolved?.target.members.map((member) => member.memberRef)).toEqual([
      source,
    ]);
  });

  it("uses the minimum frozen depth across exact variants", () => {
    const subject = "https://x.com/article";
    const ctx = buildCtx([
      pageObs(subject, makePage({ fetchUrl: subject }), 4),
      pageObs(subject, makePage({ fetchUrl: `${subject}/` }), 2),
    ]);
    expect(ctx.crawlDepths.get(subject)).toBe(2);
    expect(candidatesByKind(ctx).has("deep_page")).toBe(false);
  });

  it("retains candidates on partial crawl while marking evidence partial", () => {
    const subject = "https://x.com/article";
    const candidates = candidatesByKind(
      buildCtx([pageObs(subject, makePage({ fetchUrl: subject }), 4)], {
        crawl: "partial",
      }),
    );
    expect(candidates.get("low_inbound")?.evidence[0]?.availability).toBe("partial");
    expect(candidates.get("deep_page")?.evidence[0]?.availability).toBe("partial");
  });

  it("does not classify an unresolved target as broken", () => {
    const source = "https://x.com/source";
    const missing = "https://x.com/not-collected";
    const candidate = candidatesByKind(
      buildCtx([
        pageObs(source, makePage({ fetchUrl: source, internalOutlinks: [link(missing)] })),
      ]),
    ).get("unresolved_target");
    expect(candidate?.evidence[0]?.claim).toContain("not resolved");
    expect(candidate?.evidence[0]?.limitation).toContain("not proven broken");
  });

  it("skips when crawl is unavailable", () => {
    expect(techLinkgraphRule.evaluate(buildCtx([], { crawl: "unavailable" }))).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });
});

describe("TECH-LINKGRAPH-005@2 historical replay", () => {
  const legacy = createLegacyTechLinkgraphExecutor();

  it("keeps the commercial-only complete-crawl behavior", () => {
    const ctx = buildCtx([
      pageObs("https://x.com/pricing", makePage({})),
      pageObs("https://x.com/blog", makePage({})),
    ]);
    const result = legacy.evaluate(ctx);
    if (result instanceof Promise) throw new Error("unexpected async rule");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.metrics).toEqual({ affectedCount: 1 });
    expect(result.candidates[0]?.titleArgs).not.toHaveProperty("kind");
  });

  it("remains inconclusive on a partial crawl", () => {
    const result = legacy.evaluate(
      buildCtx([pageObs("https://x.com/pricing", makePage({}))], {
        crawl: "partial",
      }),
    );
    expect(result).toEqual({
      status: "inconclusive",
      reason: "partial_crawl_incomplete_link_graph",
    });
  });
});
