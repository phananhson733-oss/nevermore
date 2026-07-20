import { describe, expect, it } from "vitest";
import { METRIC_CRAWL_PAGE, type CrawlPageProjection } from "@sf/sources";
import { DiagnosticContext, type CoverageInput, type ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { croPathRule } from "./cro-path.ts";

const CAPTURED_AT = "2026-07-17T00:00:00.000Z";
const DEST = "https://x.com/demo";

function page(fetchUrl: string, links: readonly string[]): CrawlPageProjection {
  return {
    fetchUrl,
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
    internalOutlinks: links.map((targetSubjectUrl) => ({
      targetSubjectUrl,
      rel: null,
      anchorText: null,
    })),
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: null,
    contentType: "text/html",
  };
}

function crawlObs(subjectUrl: string, projection: CrawlPageProjection): ObservationView {
  return {
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef: subjectUrl,
    provider: "crawl",
    availability: "available",
    valueJson: projection,
    observedAt: CAPTURED_AT,
  };
}

function buildCtx(options: {
  readonly observations: readonly ObservationView[];
  readonly icp: unknown;
  readonly coverage?: Partial<CoverageInput>;
}): DiagnosticContext {
  const coverage: CoverageInput = {
    crawl: options.coverage?.crawl ?? "available",
    gsc: options.coverage?.gsc ?? "unavailable",
    ga4: options.coverage?.ga4 ?? "unavailable",
    csv: options.coverage?.csv ?? "unavailable",
  };
  return DiagnosticContext.build({
    icp: parseIcp(options.icp),
    deliveryLocale: "en",
    observations: options.observations,
    coverage,
    capturedAt: { crawl: CAPTURED_AT },
  });
}

const ICP_WITH_DEMO = {
  productName: "Widget",
  oneLineDescription: "A widget",
  siteLanguageCodes: ["en"],
  primaryConversion: { label: "Demo", type: "demo", targetUrl: DEST },
  priorityUrls: ["https://x.com/product"],
};

describe("croPathRule (CRO-PATH-001)", () => {
  it("emits one candidate for commercial pages missing a direct link to a destination", () => {
    const ctx = buildCtx({
      icp: ICP_WITH_DEMO,
      observations: [
        crawlObs(DEST, page(DEST, [])), // destination page itself — exempt
        crawlObs("https://x.com/pricing", page("https://x.com/pricing", [DEST])), // linked — ok
        crawlObs("https://x.com/product", page("https://x.com/product", [])), // priority + unlinked
        crawlObs("https://x.com/blog/post", page("https://x.com/blog/post", [])), // not commercial — ignored
      ],
    });

    const result = croPathRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0];
    if (!candidate) throw new Error("missing candidate");
    expect(candidate.subjectRefs).toEqual(["page_set:missing_conversion_path"]);
    expect(candidate.severity).toBe("high"); // /product is a priorityUrl
    expect(candidate.metrics.affectedCount).toBe(1);
    expect(candidate.metrics.destinationCount).toBe(1);
    const evidence = candidate.evidence[0];
    if (!evidence) throw new Error("missing evidence");
    expect(evidence.sourceProvider).toBe("crawl");
    expect(evidence.grade).toBe("B");
    expect(evidence.origin).toBe("direct_public");
    expect(evidence.subjectRefs).toEqual(["https://x.com/product"]);
    expect(evidence.observedAt).toBe(CAPTURED_AT);
    expect(evidence.limitation.length).toBeGreaterThan(0);
  });

  it("uses medium severity when no affected page is a priority url", () => {
    const ctx = buildCtx({
      icp: { ...ICP_WITH_DEMO, priorityUrls: [] },
      observations: [
        crawlObs(DEST, page(DEST, [])),
        crawlObs("https://x.com/pricing", page("https://x.com/pricing", [])), // commercial, unlinked, not priority
      ],
    });

    const result = croPathRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.severity).toBe("medium");
  });

  it("passes when every commercial page links to a destination", () => {
    const ctx = buildCtx({
      icp: ICP_WITH_DEMO,
      observations: [
        crawlObs(DEST, page(DEST, [])),
        crawlObs("https://x.com/pricing", page("https://x.com/pricing", [DEST])),
        crawlObs("https://x.com/product", page("https://x.com/product", [DEST])),
      ],
    });

    const result = croPathRule.evaluate(ctx);
    expect(result.status).toBe("pass");
    if (result.status !== "pass") throw new Error("expected pass");
    expect(result.metrics.affectedCount).toBe(0);
    expect(result.metrics.destinationCount).toBe(1);
  });

  it("skips not_applicable when no conversion destination resolves", () => {
    const ctx = buildCtx({
      icp: {
        productName: "Widget",
        siteLanguageCodes: ["en"],
        primaryConversion: { label: "Other", type: "other", targetUrl: null },
      },
      observations: [crawlObs("https://x.com/pricing", page("https://x.com/pricing", []))],
    });

    const result = croPathRule.evaluate(ctx);
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toBe("not_applicable");
  });

  it("skips missing_dataset when crawl is unavailable", () => {
    const ctx = buildCtx({
      icp: ICP_WITH_DEMO,
      observations: [],
      coverage: { crawl: "unavailable" },
    });

    const result = croPathRule.evaluate(ctx);
    expect(result.status).toBe("skipped");
    if (result.status !== "skipped") throw new Error("expected skipped");
    expect(result.reason).toBe("missing_dataset");
  });

  it.each([
    { label: "an apparent missing link", links: [] as readonly string[] },
    { label: "an apparent complete path", links: [DEST] as readonly string[] },
  ])("is inconclusive for partial crawl link graphs with $label", ({ links }) => {
    const ctx = buildCtx({
      icp: ICP_WITH_DEMO,
      observations: [
        crawlObs(DEST, page(DEST, [])),
        crawlObs("https://x.com/product", page("https://x.com/product", links)),
      ],
      coverage: { crawl: "partial" },
    });

    expect(croPathRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "partial_crawl_link_graph",
    });
  });
});
