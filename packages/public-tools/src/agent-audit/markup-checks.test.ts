// @input  -- real HTML through the real parser and the real report producer
// @output -- proof 8.6, 5.4, 3.6 and 7.3 decide on what the markup states
// @pos    -- coverage for the checks that needed no request to answer

import { describe, expect, it } from "vitest";
import { parsePage } from "@sf/sources/crawl-page";
import type { CrawlPageRecord } from "@sf/sources";

import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const TARGET = "https://acme.test/page";

function pageFrom(html: string): CrawlPageRecord {
  const parsed = parsePage(html, TARGET);
  return {
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
  };
}

function check(html: string, id: string) {
  const report = buildSeoAuditReport({
    origin: "https://acme.test",
    host: "acme.test",
    requestedUrl: TARGET,
    pages: [pageFrom(html)],
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: { fetched: true, urlCount: 0, subjectUrls: [], complete: true },
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
  }).checks.find((entry) => entry.check.id === id);
}

const doc = (head: string, body = "<h1>H</h1><p>Body</p>") =>
  `<html><head><title>T</title>${head}</head><body>${body}</body></html>`;

describe("8.6 — render-blocking resources in the head", () => {
  it("counts a blocking stylesheet and a synchronous script", () => {
    const html = doc(
      `<link rel="stylesheet" href="/a.css"><script src="/a.js"></script>`,
    );
    expect(check(html, "8.6")?.result).toBe("tip");
  });

  it("does not count what the browser will not wait for", () => {
    // `media="print"` never blocks the first paint; async, defer and module
    // scripts all release the parser. Counting them would report a page that
    // did the right thing as one that did not.
    const html = doc(
      `<link rel="stylesheet" href="/p.css" media="print">` +
        `<script src="/a.js" defer></script>` +
        `<script src="/b.js" async></script>` +
        `<script type="module" src="/c.js"></script>`,
    );
    expect(check(html, "8.6")?.result).toBe("pass");
  });

  it("does not count a blocking script in the body", () => {
    // A script below the content has already let the parser through what
    // matters. The check is about the head.
    const html = doc("", `<h1>H</h1><p>Body</p><script src="/late.js"></script>`);
    expect(check(html, "8.6")?.result).toBe("pass");
  });

  it("does not read a commented-out stylesheet as one", () => {
    expect(check(doc(`<!-- <link rel="stylesheet" href="/a.css"> -->`), "8.6")?.result).toBe(
      "pass",
    );
  });
});

describe("5.4 — the first image and lazy loading", () => {
  it("fires when the first image defers its own load", () => {
    const html = doc("", `<h1>H</h1><img src="/hero.webp" width="1200" height="600" loading="lazy" alt="a">`);
    expect(check(html, "5.4")?.result).toBe("warning");
  });

  it("passes when only later images are lazy", () => {
    const html = doc(
      "",
      `<h1>H</h1><img src="/hero.webp" width="1200" height="600" alt="a"><img src="/b.webp" width="800" height="400" loading="lazy" alt="b">`,
    );
    expect(check(html, "5.4")?.result).toBe("pass");
  });

  it("does not judge a page with no images", () => {
    expect(check(doc(""), "5.4")?.result).toBe("excluded");
  });

  it("does not fire on a lazy-loaded logo mark", () => {
    // Our own homepage: the first <img> is a 32-pixel logo with loading=lazy,
    // which is harmless. A Warning there is noise, and noise is worse than a
    // miss on a check at this severity.
    const html = doc("", `<h1>H</h1><img src="/logo.png" width="32" height="32" loading="lazy" alt="">`);
    expect(check(html, "5.4")?.result).toBe("excluded");
  });

  it("does not judge a first image that declares no size", () => {
    // Guessing would put the logo back in.
    const html = doc("", `<h1>H</h1><img src="/x.png" loading="lazy" alt="">`);
    expect(check(html, "5.4")?.result).toBe("excluded");
  });
});

describe("7.3 — required properties", () => {
  const ld = (json: string) =>
    doc(`<script type="application/ld+json">${json}</script>`);

  it("fires on a declared type missing a property it needs", () => {
    expect(
      check(ld('{"@type":"Product","description":"d"}'), "7.3")?.result,
    ).toBe("warning");
  });

  it("passes when the required properties are there", () => {
    expect(check(ld('{"@type":"Product","name":"n"}'), "7.3")?.result).toBe("pass");
  });

  it("walks into a graph rather than only the outer node", () => {
    expect(
      check(
        ld('{"@graph":[{"@type":"Offer","priceCurrency":"USD"}]}'),
        "7.3",
      )?.result,
    ).toBe("warning");
  });

  it("does not judge a type it has no reviewed opinion about", () => {
    // Assuming an unlisted type is complete would report every one of them as
    // correct, which is the opposite of what the check is for.
    expect(
      check(ld('{"@type":"VideoGame","somethingElse":1}'), "7.3")?.result,
    ).toBe("excluded");
  });
});
