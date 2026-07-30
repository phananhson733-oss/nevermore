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
    decodeReliable: true,
    robotsNoindex: false,
    title: "Acme builds evidence-led growth systems",
    metaDescription:
      "See how Acme turns reliable market evidence into clear growth priorities, measurable experiments, and repeatable execution.",
    canonical: "https://acme.com/",
    htmlLang: "en",
    h1Count: 1,
    headingOutline: ["h1", "h2", "h2"],
    wordCount: 650,
    viewportConfigured: true,
    hasMetaRefresh: false,
    securityHeadersPresent: 4,
    socialMetaTagsPresent: 4,
    jsonLdBlockCount: 1,
    jsonLdErrorCount: 0,
    jsonLdScanComplete: true,
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
      schemaVersion: "1.1.0",
      mode: "public_preview",
      scope: "single_raw_page_and_standard_support_files",
      persistence: "none",
      completedAt: "2026-07-30T08:00:00.000Z",
    });
    expect(payload.result).toMatchObject({
      score: 100,
      measuredChecks: 19,
      totalChecks: 19,
      measuredWeight: 43,
      totalWeight: 43,
      coveragePercent: 100,
    });
  });

  it("keeps P02 link topology out of the page-health audit", () => {
    const checks = buildSeoAuditReport(probe()).modules.flatMap(
      (module) => module.checks,
    );
    const byId = new Map(checks.map((check) => [check.id, check]));

    expect(byId.has("internal_links")).toBe(false);
    expect(byId.get("viewport")).toMatchObject({
      status: "pass",
      evidence: [{ label: "viewport_configured", value: true }],
    });
    expect(byId.get("meta_refresh")).toMatchObject({
      status: "pass",
      evidence: [{ label: "meta_refresh_present", value: false }],
    });
    expect(byId.get("security_headers")).toMatchObject({
      status: "pass",
      evidence: [{ label: "security_headers_present", value: 4 }],
    });
  });

  it("reports missing security headers as a limited presence warning", () => {
    const report = buildSeoAuditReport(
      probe({ page: healthyPage({ securityHeadersPresent: 2 }) }),
    );
    const securityHeaders = report.modules
      .flatMap((module) => module.checks)
      .find((check) => check.id === "security_headers");

    expect(securityHeaders).toMatchObject({
      status: "warning",
      evidence: [{ label: "security_headers_present", value: 2 }],
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
    expect(report.measuredChecks).toBe(18);
    expect(report.totalChecks).toBe(19);
    expect(report.coveragePercent).toBeLessThan(100);
  });

  it("keeps JSON-LD unverified when its bounded projection is incomplete", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          jsonLdBlockCount: 100,
          jsonLdErrorCount: 0,
          jsonLdScanComplete: false,
        }),
      }),
    );
    const jsonLd = report.modules
      .flatMap((module) => module.checks)
      .find((check) => check.id === "json_ld");

    expect(jsonLd).toMatchObject({
      status: "unverified",
      limitation: "projection_limit_reached",
    });
  });

  it("compares canonical URLs by stable subject identity", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          finalUrl: "https://acme.com/pricing/?utm_source=campaign",
          canonical: "https://acme.com/pricing",
        }),
      }),
    );
    const canonical = report.modules
      .flatMap((module) => module.checks)
      .find((check) => check.id === "canonical");

    expect(canonical?.status).toBe("pass");
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
          viewportConfigured: null,
          hasMetaRefresh: null,
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
      "viewport",
      "meta_refresh",
      "social_meta",
      "json_ld",
    ]) {
      expect(byId.get(id)?.status, id).toBe("unverified");
    }
    expect(byId.get("page_status")?.status).toBe("pass");
    expect(byId.get("https")?.status).toBe("pass");
    expect(byId.get("html_content_type")?.status).toBe("pass");
  });

  it("does not upgrade multiple observed H1s or a closed JSON-LD prefix to pass/fail when truncated", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          bodyComplete: false,
          h1Count: 2,
          jsonLdBlockCount: 1,
          jsonLdErrorCount: 0,
        }),
      }),
    );
    const byId = new Map(
      report.modules
        .flatMap((module) => module.checks)
        .map((check) => [check.id, check]),
    );

    expect(byId.get("h1")).toMatchObject({
      status: "warning",
      limitation: null,
    });
    expect(byId.get("json_ld")).toMatchObject({
      status: "unverified",
      limitation: "response_body_truncated",
    });
  });

  it("does not derive document failures when Content-Type is missing", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          contentType: null,
          robotsNoindex: null,
          title: null,
          metaDescription: null,
          canonical: null,
          htmlLang: null,
          h1Count: 0,
          headingOutline: [],
          wordCount: 0,
          viewportConfigured: null,
          hasMetaRefresh: null,
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
      "viewport",
      "meta_refresh",
      "social_meta",
      "json_ld",
    ]) {
      expect(byId.get(id)?.status, id).toBe("unverified");
    }
    expect(byId.get("html_content_type")?.status).toBe("unverified");
  });

  it("keeps document checks unverified when response decoding is unreliable", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          decodeReliable: false,
          title: null,
          metaDescription: null,
          canonical: null,
          htmlLang: null,
          h1Count: 0,
          headingOutline: [],
          wordCount: 0,
          viewportConfigured: null,
          hasMetaRefresh: null,
          socialMetaTagsPresent: 0,
          jsonLdBlockCount: 0,
          jsonLdErrorCount: 0,
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
      "viewport",
      "meta_refresh",
      "social_meta",
      "json_ld",
    ]) {
      expect(byId.get(id)?.status, id).toBe("unverified");
      expect(byId.get(id)?.limitation, id).toBe(
        "response_decode_unreliable",
      );
    }
    expect(byId.get("html_content_type")?.limitation).toBeNull();
  });

  it("attributes support-resource decode failures only to their own checks", () => {
    const report = buildSeoAuditReport(
      probe({
        robots: {
          url: "https://acme.com/robots.txt",
          state: "decode_error",
          statusCode: 200,
          bodyComplete: true,
        },
        robotsPageAllowed: null,
      }),
    );
    const byId = new Map(
      report.modules
        .flatMap((module) => module.checks)
        .map((check) => [check.id, check]),
    );

    expect(byId.get("robots_access")).toMatchObject({
      status: "unverified",
      limitation: "resource_decode_unreliable",
    });
    expect(byId.get("sitemap")?.status).toBe("pass");
    expect(byId.get("sitemap")?.limitation).toBeNull();
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
      .find((check) => check.id === "page_status");

    expect(status?.status).toBe("fail");
    expect(report.finalUrl).toBe("https://acme.com/");
    expect(
      report.modules
        .flatMap((module) => module.checks)
        .find((check) => check.id === "title")?.status,
    ).toBe("unverified");
  });

  it("keeps indexability unverified on a non-2xx page even when noindex is observed", () => {
    const report = buildSeoAuditReport(
      probe({
        page: healthyPage({
          firstStatus: 404,
          statusCode: 404,
          robotsNoindex: true,
        }),
      }),
    );
    const byId = new Map(
      report.modules
        .flatMap((module) => module.checks)
        .map((check) => [check.id, check]),
    );

    expect(byId.get("page_status")?.status).toBe("fail");
    expect(byId.get("indexability")?.status).toBe("unverified");
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
