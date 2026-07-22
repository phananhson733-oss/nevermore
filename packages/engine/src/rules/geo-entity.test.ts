import { describe, expect, it } from "vitest";
import type { CrawlPageProjection } from "@sf/sources";
import { METRIC_CRAWL_PAGE } from "@sf/sources";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import type { FindingCandidate, RuleResult } from "../rule.ts";
import { geoEntityRule } from "./geo-entity.ts";

const OBSERVED_AT = "2026-07-01T00:00:00.000Z";

/** A proof block: named proper-noun cue ("Acme Corp") + numeric cue ("40%"). */
const PROOF_PARAGRAPH = "Acme Corp reduced onboarding time by 40% within 90 days.";
/** No named + numeric cue → not a proof block. */
const PLAIN_PARAGRAPH = "We help teams move faster every single day.";

function page(overrides: Partial<CrawlPageProjection>): CrawlPageProjection {
  return {
    fetchUrl: "https://example.com/",
    status: 200,
    finalStatus: 200,
    redirectChain: [],
    canonicalTarget: null,
    robotsIndexable: true,
    robotsDirectives: [],
    title: "Title",
    metaDescription: null,
    h1: [],
    headings: [],
    wordCount: 100,
    internalOutlinks: [],
    jsonLd: { types: [], errorCount: 0 },
    sitemapMember: false,
    bodyExcerpt: null,
    paragraphs: [],
    responseMs: 100,
    contentType: "text/html",
    ...overrides,
  };
}

interface BuildOpts {
  readonly pages: readonly (readonly [string, CrawlPageProjection])[];
  readonly priorityUrls?: readonly string[];
  readonly siteLanguageCodes?: readonly string[];
  readonly crawl?: CoverageInput["crawl"];
}

function buildContext(opts: BuildOpts): DiagnosticContext {
  const observations: ObservationView[] = opts.pages.map(([url, projection]) => ({
    metricKey: METRIC_CRAWL_PAGE,
    subjectType: "url",
    subjectRef: url,
    provider: "crawl",
    availability: "available",
    valueJson: projection,
    observedAt: OBSERVED_AT,
  }));
  const coverage: CoverageInput = {
    crawl: opts.crawl ?? "available",
    gsc: "unavailable",
    ga4: "unavailable",
    csv: "unavailable",
  };
  return DiagnosticContext.build({
    icp: parseIcp({
      siteLanguageCodes: opts.siteLanguageCodes ?? ["en"],
      priorityUrls: opts.priorityUrls ?? [],
    }),
    deliveryLocale: "en",
    observations,
    coverage,
    capturedAt: { crawl: OBSERVED_AT },
  });
}

function candidates(result: RuleResult): readonly FindingCandidate[] {
  if (result.status !== "candidate") {
    throw new Error(`expected candidate, got ${result.status}`);
  }
  return result.candidates;
}

describe("GEO-ENTITY-001", () => {
  it("flags high when entity + proof gaps coincide with a priority page", () => {
    const ctx = buildContext({
      priorityUrls: ["https://example.com/pricing"],
      pages: [
        [
          "https://example.com/pricing",
          page({ jsonLd: { types: [], errorCount: 0 }, paragraphs: [PLAIN_PARAGRAPH] }),
        ],
        [
          "https://example.com/product",
          page({ jsonLd: { types: [], errorCount: 0 }, paragraphs: [PLAIN_PARAGRAPH] }),
        ],
      ],
    });

    const cs = candidates(geoEntityRule.evaluate(ctx));
    expect(cs).toHaveLength(1);
    const candidate = cs[0]!;
    expect(candidate.severity).toBe("high");
    expect(candidate.subjectRefs).toEqual(["page_set:priority_commercial"]);
    expect(candidate.metrics).toMatchObject({
      selectedCount: 2,
      entityMissingCount: 2,
      proofCoverageRatio: 0,
    });
    const evidence = candidate.evidence[0]!;
    expect(evidence.method).toBe("inferred");
    expect(evidence.grade).toBe("C");
    expect(evidence.origin).toBe("derived");
    expect(evidence.observedAt).toBe(OBSERVED_AT);
    expect(evidence.subjectRefs).toEqual([
      "https://example.com/pricing",
      "https://example.com/product",
    ]);
  });

  it("flags medium when only proof coverage is thin (entities present, no priority)", () => {
    const ctx = buildContext({
      pages: [
        [
          "https://example.com/pricing",
          page({ jsonLd: { types: ["Product"], errorCount: 0 }, paragraphs: [PLAIN_PARAGRAPH] }),
        ],
        [
          "https://example.com/product",
          page({ jsonLd: { types: ["Product"], errorCount: 0 }, paragraphs: [PLAIN_PARAGRAPH] }),
        ],
      ],
    });

    const cs = candidates(geoEntityRule.evaluate(ctx));
    expect(cs).toHaveLength(1);
    expect(cs[0]!.severity).toBe("medium");
    expect(cs[0]!.metrics).toMatchObject({ entityMissingCount: 0, proofCoverageRatio: 0 });
  });

  it("passes when entities are present and proof coverage is at least 50%", () => {
    const ctx = buildContext({
      pages: [
        [
          "https://example.com/pricing",
          page({ jsonLd: { types: ["Product"], errorCount: 0 }, paragraphs: [PROOF_PARAGRAPH] }),
        ],
        [
          "https://example.com/product",
          page({
            jsonLd: { types: ["Organization"], errorCount: 0 },
            paragraphs: [PROOF_PARAGRAPH],
          }),
        ],
      ],
    });

    const result = geoEntityRule.evaluate(ctx);
    expect(result.status).toBe("pass");
    if (result.status !== "pass") throw new Error("unreachable");
    expect(result.metrics).toMatchObject({ selectedCount: 2, proofCoverageRatio: 1 });
  });

  it("does not fabricate entity or proof gaps when healthy exact variants disagree", () => {
    const subjectUrl = "https://example.com/pricing";
    const pages = [
      [
        subjectUrl,
        page({
          fetchUrl: subjectUrl,
          jsonLd: { types: ["Product"], errorCount: 0 },
          paragraphs: [PLAIN_PARAGRAPH],
        }),
      ],
      [
        subjectUrl,
        page({
          fetchUrl: `${subjectUrl}/`,
          jsonLd: { types: [], errorCount: 0 },
          paragraphs: [PROOF_PARAGRAPH],
        }),
      ],
    ] as const;

    const forward = geoEntityRule.evaluate(buildContext({ pages }));
    const reversed = geoEntityRule.evaluate(
      buildContext({ pages: [...pages].reverse() }),
    );

    expect(forward).toEqual(reversed);
    expect(forward).toEqual({
      status: "pass",
      metrics: {
        selectedCount: 1,
        entityMissingCount: 0,
        proofCoverageRatio: 1,
      },
    });
  });

  it("skips as not_applicable when there are no priority/commercial pages", () => {
    const ctx = buildContext({
      pages: [["https://example.com/blog/post", page({ paragraphs: [PLAIN_PARAGRAPH] })]],
    });
    expect(geoEntityRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "not_applicable",
    });
  });

  it("skips as missing_dataset when crawl is unavailable", () => {
    const ctx = buildContext({ pages: [], crawl: "unavailable" });
    expect(geoEntityRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });

  it("is inconclusive on non-English sites (proof detector is English-only)", () => {
    const ctx = buildContext({
      siteLanguageCodes: ["de"],
      pages: [["https://example.com/pricing", page({ paragraphs: [PLAIN_PARAGRAPH] })]],
    });
    expect(geoEntityRule.evaluate(ctx)).toEqual({
      status: "inconclusive",
      reason: "proof_detector_english_only",
    });
  });
});
