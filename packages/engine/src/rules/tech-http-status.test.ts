import { METRIC_CRAWL_PAGE } from "@sf/sources";
import type { CrawlPageProjection } from "@sf/sources";
import { describe, expect, it } from "vitest";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { testObservationLineage } from "../test-observation-lineage.ts";
import { techHttpStatusRule } from "./tech-http-status.ts";

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
  crawl: CoverageInput["crawl"] = "available",
): DiagnosticContext {
  return DiagnosticContext.build({
    icp: parseIcp({ productName: "Acme", priorityUrls: [] }),
    deliveryLocale: "en",
    observations,
    coverage: { crawl, gsc: "unavailable", ga4: "unavailable", csv: "unavailable" },
    capturedAt: { crawl: OBSERVED_AT },
  });
}

describe("TECH-HTTP-001 tech-http-status", () => {
  it("reports the exact failing slash fetch URL with order-invariant evidence", () => {
    const subjectUrl = "https://x.com/product";
    const observations = [
      pageObs(
        subjectUrl,
        makePage({ fetchUrl: `${subjectUrl}/`, finalStatus: 503 }),
      ),
      pageObs(
        subjectUrl,
        makePage({ fetchUrl: subjectUrl, finalStatus: 200 }),
      ),
    ];

    const forward = techHttpStatusRule.evaluate(buildCtx(observations));
    const reversed = techHttpStatusRule.evaluate(
      buildCtx([...observations].reverse()),
    );

    expect(forward).toEqual(reversed);
    if (forward.status !== "candidate") throw new Error("expected candidate");
    expect(forward.candidates).toEqual([
      expect.objectContaining({
        subjectRefs: ["http_status:503"],
        metrics: { count: 1, statusCode: 503 },
        evidence: [
          expect.objectContaining({ subjectRefs: [`${subjectUrl}/`] }),
        ],
        target: expect.objectContaining({
          version: 1,
          relation: "affected_by_http_status",
          targetKind: "http_status",
          targetRef: "503",
          members: [
            expect.objectContaining({
              resolutionState: "resolved",
              basisKind: "crawl_exact_fetch",
              memberRef: `${subjectUrl}/`,
              sitePageUrl: `${subjectUrl}/`,
            }),
          ],
        }),
      }),
    ]);
  });

  it("fails closed when an exact crawl member lacks its frozen PageSnapshot", () => {
    const observation = pageObs(
      "https://x.com/down",
      makePage({ fetchUrl: "https://x.com/down", finalStatus: 503 }),
    );
    const result = techHttpStatusRule.evaluate(
      buildCtx([{ ...observation, pageSnapshotId: null }]),
    );

    expect(result).toEqual({
      status: "inconclusive",
      reason: "missing_observation_lineage",
    });
  });

  it("counts one aggregation subject once when both exact variants share a broken status", () => {
    const subjectUrl = "https://x.com/duplicate";
    const result = techHttpStatusRule.evaluate(
      buildCtx([
        pageObs(
          subjectUrl,
          makePage({ fetchUrl: subjectUrl, finalStatus: 404 }),
        ),
        pageObs(
          subjectUrl,
          makePage({ fetchUrl: `${subjectUrl}/`, finalStatus: 404 }),
        ),
      ]),
    );

    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.metrics).toEqual({
      count: 1,
      statusCode: 404,
    });
    expect(result.candidates[0]?.evidence[0]?.subjectRefs).toEqual([
      subjectUrl,
      `${subjectUrl}/`,
    ]);
  });

  it("emits one candidate per broken status code (5xx and commercial 4xx are high)", () => {
    const ctx = buildCtx([
      pageObs("https://x.com/pricing", makePage({ finalStatus: 404 })),
      pageObs("https://x.com/about", makePage({ finalStatus: 500 })),
      pageObs("https://x.com/", makePage({ finalStatus: 200 })),
      pageObs("https://x.com/down", makePage({ status: null, finalStatus: null })),
    ]);

    const result = techHttpStatusRule.evaluate(ctx);
    expect(result.status).toBe("candidate");
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(2);

    const byRef = new Map(result.candidates.map((c) => [c.subjectRefs[0], c]));
    const c404 = byRef.get("http_status:404");
    const c500 = byRef.get("http_status:500");
    expect(c404?.severity).toBe("high"); // /pricing is commercial
    expect(c404?.metrics).toEqual({ count: 1, statusCode: 404 });
    expect(c404?.evidence[0]?.subjectRefs).toEqual(["https://x.com/pricing"]);
    expect(c404?.evidence[0]?.origin).toBe("direct_public");
    expect(c500?.severity).toBe("high"); // any 5xx is high
  });

  it("rates a non-commercial 4xx as medium", () => {
    const ctx = buildCtx([
      pageObs("https://x.com/blog/old-post", makePage({ finalStatus: 404 })),
    ]);
    const result = techHttpStatusRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates[0]?.severity).toBe("medium");
  });

  it("passes when no page is 4xx/5xx (status 0/null is unavailable, not broken)", () => {
    const ctx = buildCtx([
      pageObs("https://x.com/", makePage({ finalStatus: 200 })),
      pageObs("https://x.com/down", makePage({ status: 0, finalStatus: 0 })),
    ]);
    const result = techHttpStatusRule.evaluate(ctx);
    expect(result).toEqual({ status: "pass", metrics: { brokenCount: 0 } });
  });

  it("skips when crawl is unavailable", () => {
    const ctx = buildCtx([], "unavailable");
    expect(techHttpStatusRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });
});
