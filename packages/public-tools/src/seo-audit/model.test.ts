import { describe, expect, it } from "vitest";
import { buildSeoAuditPayload, buildSeoAuditReport } from "./model.ts";
import type { SeoAuditPageProbe, SeoAuditProbe } from "./types.ts";

function healthyPage(
  overrides: Partial<SeoAuditPageProbe> = {},
): SeoAuditPageProbe {
  return {
    requestedUrl: "https://acme.com/",
    finalUrl: "https://acme.com/",
    firstStatus: 200,
    statusCode: 200,
    redirectChain: [],
    contentType: "text/html; charset=utf-8",
    bodyComplete: true,
    robotsNoindex: false,
    title: "Acme builds evidence-led growth systems",
    metaDescription:
      "See how Acme turns reliable market evidence into clear growth priorities, measurable experiments, and repeatable execution.",
    canonical: "https://acme.com/",
    htmlLang: "en",
    h1Count: 1,
    headingOutline: ["h1", "h2", "h2"],
    wordCount: 650,
    internalLinkCount: 8,
    socialMetaTagsPresent: 4,
    jsonLdBlockCount: 1,
    jsonLdErrorCount: 0,
    ...overrides,
  };
}

function probe(overrides: Partial<SeoAuditProbe> = {}): SeoAuditProbe {
  return {
    requestedUrl: "https://acme.com/",
    scannedAt: "2026-07-30T08:00:00.000Z",
    page: healthyPage(),
    robots: {
      url: "https://acme.com/robots.txt",
      state: "parsed",
      statusCode: 200,
      bodyComplete: true,
    },
    robotsPageAllowed: true,
    sitemap: {
      url: "https://acme.com/sitemap.xml",
      state: "parsed",
      statusCode: 200,
      bodyComplete: true,
    },
    ...overrides,
  };
}

describe("SEO audit evidence and scoring", () => {
  it("builds a versioned stateless Public Tools envelope", () => {
    const payload = buildSeoAuditPayload(probe());

    expect(payload.run).toEqual({
      tool: "seo_audit",
      schemaVersion: "1.0.0",
      mode: "public_preview",
      scope: "single_raw_page_and_standard_support_files",
      persistence: "none",
      completedAt: "2026-07-30T08:00:00.000Z",
    });
    expect(payload.result).toMatchObject({
      score: 100,
      measuredChecks: 17,
      totalChecks: 17,
      measuredWeight: 39,
      totalWeight: 39,
      coveragePercent: 100,
    });
  });

  it("does not turn missing static JSON-LD into a failure or score penalty", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          jsonLdBlockCount: 0,
          jsonLdErrorCount: 0,
        }),
      }),
    );
    const jsonLd = report.modules
      .flatMap((module) => module.checks)
      .find((check) => check.id === "json_ld");

    expect(jsonLd).toMatchObject({
      status: "unverified",
      limitation: "static_html_cannot_prove_rendered_absence",
    });
    expect(report.score).toBe(100);
    expect(report.measuredChecks).toBe(16);
    expect(report.totalChecks).toBe(17);
    expect(report.coveragePercent).toBeLessThan(100);
  });

  it("treats a missing standard sitemap path as a warning, not no sitemap", () => {
    const report = buildSeoAuditReport(
      probe({
        sitemap: {
          url: "https://acme.com/sitemap.xml",
          state: "missing",
          statusCode: 404,
          bodyComplete: true,
        },
      }),
    );
    const sitemap = report.modules
      .flatMap((module) => module.checks)
      .find((check) => check.id === "sitemap");

    expect(sitemap).toMatchObject({
      status: "warning",
      limitation: "standard_path_only",
    });
    expect(report.score).toBeLessThan(100);
  });

  it("marks absence/count rules unverified when the HTML body was truncated", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          bodyComplete: false,
          robotsNoindex: null,
          title: null,
          metaDescription: null,
          canonical: null,
          htmlLang: null,
          h1Count: 0,
          headingOutline: [],
          wordCount: 120,
          internalLinkCount: 1,
          socialMetaTagsPresent: 0,
          jsonLdBlockCount: 0,
        }),
      }),
    );
    const byId = new Map(
      report.modules
        .flatMap((module) => module.checks)
        .map((check) => [check.id, check]),
    );

    for (const id of [
      "indexability",
      "canonical",
      "html_lang",
      "title",
      "meta_description",
      "h1",
      "heading_order",
      "text_depth",
      "internal_links",
      "social_meta",
      "json_ld",
    ]) {
      expect(byId.get(id)?.status, id).toBe("unverified");
    }
    expect(byId.get("homepage_status")?.status).toBe("pass");
    expect(byId.get("https")?.status).toBe("pass");
    expect(byId.get("html_content_type")?.status).toBe("pass");
  });

  it("keeps definitive header noindex and malformed JSON-LD failures on a prefix", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          bodyComplete: false,
          robotsNoindex: true,
          jsonLdBlockCount: 1,
          jsonLdErrorCount: 1,
        }),
      }),
    );
    const byId = new Map(
      report.modules
        .flatMap((module) => module.checks)
        .map((check) => [check.id, check]),
    );

    expect(byId.get("indexability")?.status).toBe("fail");
    expect(byId.get("json_ld")?.status).toBe("fail");
  });

  it("returns a report for an HTTP error response instead of a transport error", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          firstStatus: 404,
          statusCode: 404,
        }),
      }),
    );
    const status = report.modules
      .flatMap((module) => module.checks)
      .find((check) => check.id === "homepage_status");

    expect(status?.status).toBe("fail");
    expect(report.finalUrl).toBe("https://acme.com/");
    expect(
      report.modules
        .flatMap((module) => module.checks)
        .find((check) => check.id === "title")?.status,
    ).toBe("unverified");
  });

  it("does not turn support-file server errors into false SEO failures", () => {
    const report = buildSeoAuditReport(
      probe({
        robots: {
          url: "https://acme.com/robots.txt",
          state: "server_error",
          statusCode: 500,
          bodyComplete: true,
        },
        robotsPageAllowed: null,
        sitemap: {
          url: "https://acme.com/sitemap.xml",
          state: "server_error",
          statusCode: 503,
          bodyComplete: true,
        },
      }),
    );
    const byId = new Map(
      report.modules
        .flatMap((module) => module.checks)
        .map((check) => [check.id, check.status]),
    );

    expect(byId.get("robots_access")).toBe("unverified");
    expect(byId.get("sitemap")).toBe("unverified");
  });
});
