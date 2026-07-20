import { METRIC_CRAWL_PAGE, type CrawlPageProjection } from "@sf/sources";
import { describe, expect, it } from "vitest";
import {
  DiagnosticContext,
  type CoverageInput,
  type ObservationView,
} from "../context.ts";
import { parseIcp, type EngineIcp } from "../icp.ts";
import { contentCoverageRule } from "./content-coverage.ts";

const OBSERVED_AT = "2026-07-18T00:00:00.000Z";

function icpOf(overrides: Record<string, unknown>): EngineIcp {
  return parseIcp({
    productName: "Acme",
    oneLineDescription: "A collaboration workspace",
    siteLanguageCodes: ["en"],
    offers: [],
    useCases: [],
    ...overrides,
  });
}

function makePage(
  overrides: Partial<CrawlPageProjection> & { readonly fetchUrl: string },
): CrawlPageProjection {
  return {
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
    contentType: "text/html",
    ...overrides,
  };
}

function crawlObs(subjectUrl: string, page: CrawlPageProjection): ObservationView {
  return {
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef: subjectUrl,
    provider: "crawl",
    availability: "available",
    valueJson: page,
    observedAt: OBSERVED_AT,
  };
}

function buildContext(input: {
  readonly icp: EngineIcp;
  readonly observations: readonly ObservationView[];
  readonly coverage?: Partial<CoverageInput>;
}): DiagnosticContext {
  return DiagnosticContext.build({
    icp: input.icp,
    deliveryLocale: "en",
    observations: input.observations,
    coverage: {
      crawl: "available",
      gsc: "unavailable",
      ga4: "unavailable",
      csv: "unavailable",
      ...input.coverage,
    },
    capturedAt: { crawl: OBSERVED_AT },
  });
}

describe("contentCoverageRule (CONTENT-COVERAGE-001)", () => {
  it("emits one candidate per uncovered offer / use case", () => {
    const ctx = buildContext({
      icp: icpOf({ offers: ["team collaboration"], useCases: ["remote onboarding"] }),
      observations: [
        crawlObs(
          "https://example.com/pricing",
          makePage({ fetchUrl: "https://example.com/pricing", title: "Pricing Plans", h1: ["Our Pricing"] }),
        ),
      ],
    });

    const result = contentCoverageRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error(`expected candidate, got ${result.status}`);
    expect(result.candidates).toHaveLength(2);

    const [offerCandidate, useCaseCandidate] = result.candidates;
    expect(offerCandidate!.subjectRefs).toEqual(["page_set:offer:team-collaboration"]);
    expect(offerCandidate!.severity).toBe("high");
    expect(offerCandidate!.metrics).toEqual({ target: "team collaboration", kind: "offer" });
    expect(useCaseCandidate!.subjectRefs).toEqual(["page_set:use_case:remote-onboarding"]);
    expect(useCaseCandidate!.metrics.kind).toBe("use_case");

    const evidence = offerCandidate!.evidence[0]!;
    expect(evidence).toMatchObject({
      sourceProvider: "crawl",
      origin: "derived",
      method: "inferred",
      grade: "C",
      availability: "available",
      observedAt: OBSERVED_AT,
    });
    expect(evidence.subjectRefs).toEqual(["page_set:offer:team-collaboration"]);
  });

  it("passes when a page covers the offer's core tokens", () => {
    const ctx = buildContext({
      icp: icpOf({ offers: ["team collaboration"] }),
      observations: [
        crawlObs(
          "https://example.com/collaboration",
          makePage({
            fetchUrl: "https://example.com/collaboration",
            title: "Team Collaboration Software",
            h1: ["Team Collaboration"],
          }),
        ),
      ],
    });

    const result = contentCoverageRule.evaluate(ctx);
    expect(result.status).toBe("pass");
    if (result.status !== "pass") throw new Error("unreachable");
    expect(result.metrics).toEqual({ coveredCount: 1 });
  });

  it("is inconclusive when no page has a title or H1", () => {
    const ctx = buildContext({
      icp: icpOf({ offers: ["team collaboration"] }),
      observations: [
        crawlObs(
          "https://example.com/pricing",
          makePage({ fetchUrl: "https://example.com/pricing", title: null, h1: [] }),
        ),
      ],
    });

    expect(contentCoverageRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "intent_match_unavailable",
    });
  });

  it("is inconclusive when an intent contains no matchable tokens", () => {
    const ctx = buildContext({
      icp: icpOf({ offers: ["the and"] }),
      observations: [
        crawlObs(
          "https://example.com/pricing",
          makePage({
            fetchUrl: "https://example.com/pricing",
            title: "Pricing",
            h1: ["Pricing"],
          }),
        ),
      ],
    });

    expect(contentCoverageRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "intent_match_unavailable",
    });
  });

  it("is inconclusive for non-English projects", () => {
    const ctx = buildContext({
      icp: icpOf({ offers: ["team collaboration"], siteLanguageCodes: ["zh-CN"] }),
      observations: [
        crawlObs(
          "https://example.com/pricing",
          makePage({ fetchUrl: "https://example.com/pricing", title: "Pricing", h1: ["Pricing"] }),
        ),
      ],
    });

    expect(contentCoverageRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "unsupported_language",
    });
  });

  it("skips with missing_dataset when crawl is unavailable", () => {
    const ctx = buildContext({
      icp: icpOf({ offers: ["team collaboration"] }),
      observations: [],
      coverage: { crawl: "unavailable" },
    });

    expect(contentCoverageRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });
});
