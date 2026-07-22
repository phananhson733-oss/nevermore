import { METRIC_CRAWL_PAGE } from "@sf/sources";
import type { CrawlPageProjection } from "@sf/sources";
import { describe, expect, it } from "vitest";
import { DiagnosticContext } from "../context.ts";
import type { CoverageInput, ObservationView } from "../context.ts";
import { parseIcp } from "../icp.ts";
import { techCanonicalRule } from "./tech-canonical.ts";

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

function refOf(result: ReturnType<typeof techCanonicalRule.evaluate>, subtype: string) {
  if (result.status !== "candidate") throw new Error("expected candidate");
  return result.candidates.find((c) => c.subjectRefs[0] === `canonical_issue:${subtype}`);
}

describe("TECH-CANONICAL-002 tech-canonical", () => {
  it("detects reciprocal relationships declared only by slash variants and cites their exact fetch URLs", () => {
    const a = "https://x.com/a";
    const b = "https://x.com/b";
    const observations = [
      pageObs(
        a,
        makePage({ fetchUrl: a, canonicalTarget: a }),
      ),
      pageObs(
        a,
        makePage({ fetchUrl: `${a}/`, canonicalTarget: b }),
      ),
      pageObs(
        b,
        makePage({ fetchUrl: b, canonicalTarget: b }),
      ),
      pageObs(
        b,
        makePage({ fetchUrl: `${b}/`, canonicalTarget: a }),
      ),
    ];

    const forward = techCanonicalRule.evaluate(buildCtx(observations));
    const reversed = techCanonicalRule.evaluate(
      buildCtx([...observations].reverse()),
    );

    expect(forward).toEqual(reversed);
    if (forward.status !== "candidate") throw new Error("expected candidate");
    expect(forward.candidates).toHaveLength(1);
    expect(refOf(forward, "reciprocal")?.evidence[0]?.subjectRefs).toEqual([
      `${a}/`,
      `${b}/`,
    ]);
  });

  it("does not call a canonical target broken when any exact target variant is 2xx", () => {
    const source = "https://x.com/source";
    const target = "https://x.com/target";
    const observations = [
      pageObs(
        source,
        makePage({ fetchUrl: source, canonicalTarget: target }),
      ),
      pageObs(
        target,
        makePage({ fetchUrl: target, status: 404, finalStatus: 404 }),
      ),
      pageObs(
        target,
        makePage({ fetchUrl: `${target}/`, status: 200, finalStatus: 200 }),
      ),
    ];

    expect(techCanonicalRule.evaluate(buildCtx(observations))).toEqual({
      status: "pass",
      metrics: { canonicalIssues: 0 },
    });
    expect(
      techCanonicalRule.evaluate(buildCtx([...observations].reverse())),
    ).toEqual({
      status: "pass",
      metrics: { canonicalIssues: 0 },
    });
  });

  it("ignores terminal HTML canonical facts attached to a non-2xx redirect source", () => {
    const old = "https://x.com/old";
    const target = "https://x.com/target";
    const result = techCanonicalRule.evaluate(
      buildCtx([
        pageObs(
          old,
          makePage({
            fetchUrl: old,
            status: 301,
            finalStatus: 200,
            redirectChain: [target],
            canonicalTarget: target,
            sitemapMember: true,
          }),
        ),
        pageObs(
          target,
          makePage({
            fetchUrl: target,
            status: 200,
            finalStatus: 200,
            canonicalTarget: target,
          }),
        ),
      ]),
    );

    expect(result).toEqual({
      status: "pass",
      metrics: { canonicalIssues: 0 },
    });
  });

  it("detects reciprocal canonical loops", () => {
    const ctx = buildCtx([
      pageObs("https://x.com/a", makePage({ canonicalTarget: "https://x.com/b" })),
      pageObs("https://x.com/b", makePage({ canonicalTarget: "https://x.com/a" })),
    ]);
    const result = techCanonicalRule.evaluate(ctx);
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
    const c = refOf(result, "reciprocal");
    expect(c?.severity).toBe("medium"); // neither /a nor /b is commercial
    expect(c?.evidence[0]?.subjectRefs).toEqual(["https://x.com/a", "https://x.com/b"]);
  });

  it("detects a same-origin broken canonical target and ignores external ones", () => {
    const ctx = buildCtx([
      // /pricing canonicalizes to an uncrawled same-origin URL -> broken (commercial -> high).
      pageObs("https://x.com/pricing", makePage({ canonicalTarget: "https://x.com/gone" })),
      // external canonical must never be flagged.
      pageObs("https://x.com/ext", makePage({ canonicalTarget: "https://other.com/home" })),
    ]);
    const result = techCanonicalRule.evaluate(ctx);
    const c = refOf(result, "broken_target");
    expect(c?.severity).toBe("high");
    expect(c?.evidence[0]?.subjectRefs).toEqual(["https://x.com/pricing"]);
    // no other subtype fired
    if (result.status !== "candidate") throw new Error("expected candidate");
    expect(result.candidates).toHaveLength(1);
  });

  it("cites the exact slash variant that declares a broken canonical target", () => {
    const source = "https://x.com/pricing";
    const observations = [
      pageObs(
        source,
        makePage({ fetchUrl: source, canonicalTarget: source }),
      ),
      pageObs(
        source,
        makePage({
          fetchUrl: `${source}/`,
          canonicalTarget: "https://x.com/gone/",
        }),
      ),
    ];

    const forward = techCanonicalRule.evaluate(buildCtx(observations));
    const reversed = techCanonicalRule.evaluate(
      buildCtx([...observations].reverse()),
    );

    expect(forward).toEqual(reversed);
    expect(refOf(forward, "broken_target")?.metrics).toEqual({ count: 1 });
    expect(refOf(forward, "broken_target")?.evidence[0]?.subjectRefs).toEqual([
      `${source}/`,
    ]);
  });

  it("detects a sitemap page canonicalizing to a different page", () => {
    const ctx = buildCtx([
      pageObs(
        "https://x.com/dup",
        makePage({ sitemapMember: true, canonicalTarget: "https://x.com/home" }),
      ),
      pageObs("https://x.com/home", makePage({ canonicalTarget: "https://x.com/home" })),
    ]);
    const result = techCanonicalRule.evaluate(ctx);
    const c = refOf(result, "sitemap_contradiction");
    expect(c?.evidence[0]?.subjectRefs).toEqual(["https://x.com/dup"]);
  });

  it("detects a slash-only sitemap canonical contradiction and cites the declaring variant", () => {
    const duplicate = "https://x.com/dup";
    const observations = [
      pageObs(
        duplicate,
        makePage({
          fetchUrl: duplicate,
          sitemapMember: false,
          canonicalTarget: duplicate,
        }),
      ),
      pageObs(
        duplicate,
        makePage({
          fetchUrl: `${duplicate}/`,
          sitemapMember: true,
          canonicalTarget: duplicate,
        }),
      ),
    ];

    const forward = techCanonicalRule.evaluate(buildCtx(observations));
    const reversed = techCanonicalRule.evaluate(
      buildCtx([...observations].reverse()),
    );

    expect(forward).toEqual(reversed);
    expect(
      refOf(forward, "sitemap_contradiction")?.evidence[0]?.subjectRefs,
    ).toEqual([`${duplicate}/`]);
  });

  it("passes when every page self-canonicalizes with no conflicts", () => {
    const ctx = buildCtx([
      pageObs("https://x.com/a", makePage({ canonicalTarget: "https://x.com/a" })),
      pageObs("https://x.com/b", makePage({ sitemapMember: true, canonicalTarget: "https://x.com/b" })),
    ]);
    expect(techCanonicalRule.evaluate(ctx)).toEqual({
      status: "pass",
      metrics: { canonicalIssues: 0 },
    });
  });

  it("skips when crawl is unavailable", () => {
    const ctx = buildCtx([], "unavailable");
    expect(techCanonicalRule.evaluate(ctx)).toEqual({
      status: "skipped",
      reason: "missing_dataset",
    });
  });
});
