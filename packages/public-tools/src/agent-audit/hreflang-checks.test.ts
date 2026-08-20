// @input  -- crawl fixtures with hreflang alternates, resolved and broken
// @output -- proof D6 and 1.7 decide, and refuse to on what they did not fetch
// @pos    -- coverage for the checks the merge with main unlocked

import { describe, expect, it } from "vitest";
import { CRAWL_PROJECTION_LIMITS } from "@sf/sources";
import { parsePage } from "@sf/sources/crawl-page";
import type { CrawlPageRecord } from "@sf/sources";

import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const TARGET = "https://acme.test/en/guide";

function page(
  url: string,
  html: string,
  finalStatus = 200,
): CrawlPageRecord {
  const parsed = parsePage(html, url);
  return {
    subjectUrl: url,
    depth: 1,
    onPage: parsed.onPage,
    projection: {
      fetchUrl: url,
      status: finalStatus,
      finalStatus,
      redirectChain: [],
      canonicalTarget: url,
      robotsIndexable: true,
      robotsDirectives: parsed.robotsDirectives,
      title: parsed.title,
      metaDescription: parsed.metaDescription,
      h1: parsed.h1,
      headings: parsed.headings,
      wordCount: parsed.wordCount,
      internalOutlinks: parsed.internalOutlinks,
      jsonLd: parsed.jsonLd,
      sitemapMember: true,
      bodyExcerpt: parsed.bodyExcerpt,
      paragraphs: parsed.paragraphs,
      responseMs: 40,
      contentType: "text/html; charset=utf-8",
    },
  };
}

function raw(pages: readonly CrawlPageRecord[]): SeoAuditRaw {
  return {
    origin: "https://acme.test",
    host: "acme.test",
    requestedUrl: TARGET,
    pages,
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: { fetched: true, urlCount: 0, subjectUrls: [], declaredUrls: [], complete: true },
    availability: "available",
    capturedAt: "2026-08-19T00:00:00.000Z",
    sourceWindow: { start: null, end: null },
    stopReason: null,
    providerUsage: {},
    limitation: "",
  } as unknown as SeoAuditRaw;
}

function check(pages: readonly CrawlPageRecord[], scope: "site" | "page", id: string) {
  const report = buildSeoAuditReport(raw(pages));
  return evaluateAgentAuditScope(scope, {
    availability: "available",
    records: report.records,
    ...(scope === "page"
      ? { targetUrl: TARGET, targetInspected: true, inspectedTargetUrl: TARGET }
      : {}),
  }).checks.find((entry) => entry.check.id === id);
}

const withAlternates = (alternates: readonly [string, string][]) =>
  `<html><head><title>T</title>${alternates
    .map(([lang, href]) => `<link rel="alternate" hreflang="${lang}" href="${href}">`)
    .join("")}</head><body><h1>H</h1><p>Body</p></body></html>`;

const PLAIN = "<html><head><title>T</title></head><body><h1>H</h1><p>B</p></body></html>";

describe("D6 / 1.7 — hreflang alternates", () => {
  it("fails on an alternate this run fetched and found broken", () => {
    const pages = [
      page(TARGET, withAlternates([["zh", "https://acme.test/zh/guide"]])),
      page("https://acme.test/zh/guide", PLAIN, 404),
    ];

    expect(check(pages, "page", "1.7")?.result).toBe("blocker");
    expect(check(pages, "site", "D6")?.result).toBe("blocker");
  });

  it("passes when every fetched alternate resolves", () => {
    const pages = [
      page(TARGET, withAlternates([["zh", "https://acme.test/zh/guide"]])),
      page("https://acme.test/zh/guide", PLAIN),
    ];

    expect(check(pages, "page", "1.7")?.result).toBe("pass");
    expect(check(pages, "site", "D6")?.result).toBe("pass");
  });

  it("does not call an alternate outside the crawl broken", () => {
    // An international cluster routinely points at another domain. A target we
    // never requested is not a target we can call broken — and reporting it as
    // one would fail every correctly-built cross-domain cluster at Blocker.
    const pages = [
      page(TARGET, withAlternates([["de", "https://acme.de/de/guide"]])),
    ];

    expect(check(pages, "page", "1.7")?.result).toBe("pass");
  });

  it("does not judge a page that declares no alternates", () => {
    expect(check([page(TARGET, PLAIN)], "page", "1.7")?.result).toBe("excluded");
  });

  it("resolves a relative alternate against the page", () => {
    const pages = [
      page(TARGET, withAlternates([["zh", "/zh/guide"]])),
      page("https://acme.test/zh/guide", PLAIN, 410),
    ];

    // A relative href that was not resolved would never match a collected page,
    // so the broken target would read as one outside the crawl.
    expect(check(pages, "page", "1.7")?.result).toBe("blocker");
  });
});

describe("4.4 / 6.5 — the display-only metrics", () => {
  it("publishes a text share rather than reporting no detector", () => {
    const report = buildSeoAuditReport(raw([page(TARGET, PLAIN)]));
    const record = report.records.find(
      (entry) => entry.id === "content_to_code_ratio",
    );

    expect(record?.state).toBe("observed");
    const ratio = record?.observations[0]?.values.find(
      (entry) => entry.label === "content_to_code_ratio",
    )?.value;
    expect(typeof ratio).toBe("number");
    expect(ratio as number).toBeGreaterThan(0);
  });

  it("counts an external link once however often it is linked", () => {
    const html = `<html><head><title>T</title></head><body><h1>H</h1>
      <a href="https://partner.test/x">a</a>
      <a href="https://partner.test/x">b</a>
      <a href="https://other.test/y" rel="nofollow">c</a></body></html>`;
    const report = buildSeoAuditReport(raw([page(TARGET, html)]));
    const values = report.records
      .find((entry) => entry.id === "external_link_follow_mix")
      ?.observations[0]?.values;
    const read = (label: string) =>
      values?.find((entry) => entry.label === label)?.value;

    expect(read("external_links")).toBe(2);
    expect(read("external_links_nofollow")).toBe(1);
  });
});

describe("a truncated alternates list cannot yield a clean verdict", () => {
  const overCap = CRAWL_PROJECTION_LIMITS.maxHreflangAlternates + 5;
  const many = Array.from(
    { length: overCap },
    (_, i) => [`l${i}`, `${TARGET}?v=${i}`] as [string, string],
  );

  it("leaves the tested population rather than passing with a caveat", () => {
    // D6 and 1.7 publish "no alternate returns 4xx or 5xx", which is a claim
    // about all of them. A clean retained prefix used to make the record
    // not_observed — a full-score PASS — with the truncation note sitting
    // beside the pass rather than preventing it.
    const result = check([page(TARGET, withAlternates(many))], "page", "1.7");

    expect(result?.result).not.toBe("pass");
  });

  it("still fails on a broken alternate inside the prefix", () => {
    // Positive evidence needs no full population: one broken target that was
    // actually fetched is decisive whatever was dropped after it.
    const broken: [string, string][] = [
      ["fr", "https://acme.test/fr/guide"],
      ...many,
    ];
    const result = check(
      [
        page(TARGET, withAlternates(broken)),
        page("https://acme.test/fr/guide", PLAIN, 404),
      ],
      "page",
      "1.7",
    );

    expect(result?.result).toBe("blocker");
  });
});
