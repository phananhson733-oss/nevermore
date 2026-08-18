// @input  -- real HTML through the real parser, then the real report producer
// @output -- proof D4, 5.1, 5.3, 2.6 and 3.3 decide from what a page contains
// @pos    -- end-to-end coverage for the checks Batch 3 wired

import { describe, expect, it } from "vitest";
import { parsePage } from "@sf/sources/crawl-page";
import type { CrawlPageRecord } from "@sf/sources";

import { buildSeoAuditReport } from "../seo-audit/model.ts";
import type { SeoAuditRaw } from "../seo-audit/scan.ts";
import { evaluateAgentAuditScope } from "./evaluate.ts";

const TARGET = "https://acme.test/page";

/**
 * Built from HTML rather than from a literal projection.
 *
 * A hand-written `assets` block would let a test pass while the parser emitted
 * something else entirely, which is the failure mode this whole batch exists
 * downstream of.
 */
function pageFrom(html: string, url = TARGET, depth = 1): CrawlPageRecord {
  const parsed = parsePage(html, url);
  return {
    subjectUrl: url,
    depth,
    assets: parsed.assets,
    projection: {
      fetchUrl: url,
      status: 200,
      finalStatus: 200,
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
    sitemap: { fetched: true, urlCount: 0, subjectUrls: [] },
    availability: "available",
    capturedAt: "2026-08-18T00:00:00.000Z",
    sourceWindow: { start: null, end: null },
    stopReason: null,
    providerUsage: {},
    limitation: "",
  } as unknown as SeoAuditRaw;
}

function check(html: string, scope: "site" | "page", id: string) {
  const report = buildSeoAuditReport(raw([pageFrom(html)]));
  return evaluateAgentAuditScope(scope, {
    availability: "available",
    records: report.records,
    ...(scope === "page"
      ? {
          targetUrl: TARGET,
          targetInspected: true,
          inspectedTargetUrl: TARGET,
        }
      : {}),
  }).checks.find((entry) => entry.check.id === id);
}

const doc = (body: string, head = "") =>
  `<html><head><title>T</title>${head}</head><body><h1>H</h1>${body}</body></html>`;

describe("5.1 / D4 — image alt", () => {
  it("flags an image with no alt attribute", () => {
    const html = doc(`<img src="/a.png">`);
    expect(check(html, "page", "5.1")?.result).toBe("warning");
    expect(check(html, "site", "D4")?.result).toBe("warning");
  });

  it("accepts an empty alt as covered", () => {
    // `alt=""` is how correct markup marks a decorative image. Counting it as
    // a defect would push every accessible site below the bar.
    const html = doc(`<img src="/a.png" alt="">`);
    expect(check(html, "page", "5.1")?.result).toBe("pass");
    expect(check(html, "site", "D4")?.result).toBe("pass");
  });

  it("passes a page with no images, and leaves it out of the site share", () => {
    // At page scope "0 images with no alt attribute" is literally true, and a
    // pass is the only verdict the page projection can express for a clean
    // page: for a conditional subset it cannot tell clean from never-qualified
    // and answers "excluded" for both.
    expect(check(doc("<p>Text</p>"), "page", "5.1")?.result).toBe("pass");

    // The site share is a different question and keeps the narrower
    // denominator, so a mostly-text site cannot dilute its way past the bar
    // with five percent image pages that are all broken.
    const report = buildSeoAuditReport(raw([pageFrom(doc("<p>Text</p>"))]));
    expect(
      report.records.find((entry) => entry.id === "image_alt_coverage")?.state,
    ).toBe("unverified");
  });
});

describe("5.3 — modern image format", () => {
  it("passes a page already on modern formats", () => {
    expect(
      check(doc(`<img src="/a.webp" alt="a"><img src="/b.avif" alt="b">`), "page", "5.3")
        ?.result,
    ).toBe("pass");
  });

  it("flags a page mostly on legacy formats", () => {
    expect(
      check(
        doc(`<img src="/a.png" alt="a"><img src="/b.jpg" alt="b">`),
        "page",
        "5.3",
      )?.result,
    ).toBe("tip");
  });

  it("passes at exactly the published 80% mark", () => {
    const html = doc(
      Array.from({ length: 4 }, (_, i) => `<img src="/${i}.webp" alt="x">`).join("") +
        `<img src="/legacy.png" alt="x">`,
    );
    expect(check(html, "page", "5.3")?.result).toBe("pass");
  });

  it("leaves an unreadable extension out of the ratio entirely", () => {
    // A data URI or an extensionless CDN path is not an old format, and
    // counting it as one would report a modern site as legacy.
    const html = doc(
      `<img src="/a.webp" alt="a"><img src="data:image/png;base64,AAA" alt="b"><img src="/cdn/image?id=7" alt="c">`,
    );
    expect(check(html, "page", "5.3")?.result).toBe("pass");
  });
});

describe("2.6 — Open Graph", () => {
  const og = (props: readonly string[]) =>
    doc(
      "<p>Body</p>",
      props.map((p) => `<meta property="og:${p}" content="v">`).join(""),
    );

  it("passes only when all three are present", () => {
    expect(check(og(["title", "description", "image"]), "page", "2.6")?.result).toBe(
      "pass",
    );
  });

  it("flags a partial set", () => {
    expect(check(og(["title", "description"]), "page", "2.6")?.result).toBe("tip");
  });

  it("does not accept a property declared with no content", () => {
    const html = doc(
      "<p>Body</p>",
      `<meta property="og:title" content="v"><meta property="og:description" content="v"><meta property="og:image" content="">`,
    );
    expect(check(html, "page", "2.6")?.result).toBe("tip");
  });
});

describe("3.3 — heading hierarchy", () => {
  it("flags a jump past a level", () => {
    expect(
      check(doc("<h2>A</h2><h4>B</h4>"), "page", "3.3")?.result,
    ).toBe("tip");
  });

  it("accepts coming back up to a shallower level", () => {
    expect(
      check(doc("<h2>A</h2><h3>B</h3><h2>C</h2>"), "page", "3.3")?.result,
    ).toBe("pass");
  });

  it("counts an icon-only heading as occupying its level", () => {
    // `collectHeadings` drops a heading with no text, and a level dropped
    // between h2 and h3 fabricates a skip the document does not contain.
    // This is why the levels have their own scan.
    expect(
      check(doc(`<h2><svg></svg></h2><h3>B</h3>`), "page", "3.3")?.result,
    ).toBe("pass");
  });

  it("does not report a skip when the first heading is deep", () => {
    // A nav heading above the title is ordinary. Counting from a notional
    // level zero would report every such page as skipping.
    expect(check(doc("<h2>Nav</h2><h3>Body</h3>"), "page", "3.3")?.result).toBe(
      "pass",
    );
  });

  it("passes a page with no headings", () => {
    // An outline with no headings skips no levels. The alternative — a
    // conditional subset — makes every correctly-structured page read as
    // untested, which is what this record was changed away from.
    expect(
      check("<html><body><p>Text</p></body></html>", "page", "3.3")?.result,
    ).toBe("pass");
  });
});
