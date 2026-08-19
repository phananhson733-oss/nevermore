// @input  -- real HTML with FAQPage markup through the real parser
// @output -- proof 7.4 decides on the promise, and refuses past the crawl cap
// @pos    -- coverage for the one JSON-LD value this run collects

import { describe, expect, it } from "vitest";
import { parsePage } from "@sf/sources/crawl-page";
import type { CrawlPageRecord } from "@sf/sources";

import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const TARGET = "https://acme.test/faq";

function check(html: string) {
  const parsed = parsePage(html, TARGET);
  const page = {
    subjectUrl: TARGET,
    depth: 1,
    onPage: parsed.onPage,
    projection: {
      fetchUrl: TARGET,
      status: 200,
      finalStatus: 200,
      redirectChain: [],
      canonicalTarget: TARGET,
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
  } as unknown as CrawlPageRecord;

  const report = buildSeoAuditReport({
    origin: "https://acme.test",
    host: "acme.test",
    requestedUrl: TARGET,
    pages: [page],
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: { fetched: true, urlCount: 0, subjectUrls: [] },
    availability: "available",
    capturedAt: "2026-08-19T00:00:00.000Z",
    sourceWindow: { start: null, end: null },
    stopReason: null,
    providerUsage: {},
    limitation: "",
  } as unknown as SeoAuditRaw);

  return evaluateAgentAuditScope("page", {
    availability: "available",
    records: report.records,
    targetUrl: TARGET,
    targetInspected: true,
    inspectedTargetUrl: TARGET,
  }).checks.find((entry) => entry.check.id === "7.4");
}

const faq = (questions: readonly string[], body: string) =>
  `<html><head><title>FAQ</title><script type="application/ld+json">${JSON.stringify(
    {
      "@type": "FAQPage",
      mainEntity: questions.map((name) => ({ "@type": "Question", name })),
    },
  )}</script></head><body><h1>FAQ</h1>${body}</body></html>`;

describe("7.4 — the FAQ the markup promises", () => {
  it("fires when a declared question is nowhere on the page", () => {
    const html = faq(
      ["How do I cancel?", "Is there a free plan?"],
      "<h2>How do I cancel?</h2><p>From account settings.</p>",
    );
    expect(check(html)?.result).toBe("warning");
  });

  it("passes when every declared question is visible", () => {
    const html = faq(
      ["How do I cancel?"],
      "<h2>How do I cancel?</h2><p>From account settings.</p>",
    );
    expect(check(html)?.result).toBe("pass");
  });

  it("matches across a different apostrophe and a stray question mark", () => {
    // The markup and the heading rarely agree on punctuation. Comparing the
    // raw strings would report a page whose FAQ is right there on screen.
    const html = faq(
      ["What’s included?"],
      "<h2>What's included</h2><p>Everything in the plan.</p>",
    );
    expect(check(html)?.result).toBe("pass");
  });

  it("does not judge a page that declares no FAQ", () => {
    const html = `<html><head><title>T</title></head><body><h1>H</h1><p>B</p></body></html>`;
    expect(check(html)?.result).toBe("excluded");
  });

  it("does not judge a page whose content runs past what the crawl keeps", () => {
    // Fifty paragraphs is the cap. The fifty-first answer is on the page and
    // not in our hands, so a question we cannot find is not a broken promise.
    const long = Array.from({ length: 60 }, (_, i) => `<p>Paragraph ${i}</p>`).join("");
    expect(check(faq(["Question nobody sees"], long))?.result).toBe("excluded");
  });
});
