// @input  -- adversarial-but-legal HTML, taken through the real crawl parser
// @output -- proof the payload this code builds satisfies the guard it checks
// @pos    -- the seam every previous silent cache failure has lived in
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";
import { parsePage } from "@sf/sources/crawl-public-preview";
import { buildSeoAuditPayload } from "./model.ts";
import { isSeoAuditPayload } from "./contract.ts";
import type { SeoAuditRaw } from "./scan.ts";

/**
 * Why this file exists.
 *
 * Every other test here builds the extract from hand-written fixtures whose
 * strings are ASCII, so the whole suite was blind to the producer and the
 * validator disagreeing about what a character is. The payload is validated
 * only on the READ side: `writeCrawlCache` checks size and nothing else, so an
 * invalid payload writes fine, reads back fine, and is refused by the reuse
 * predicate — a permanent miss with no error and no log. The same guard also
 * gates the Agent response, where the failure is a 502 instead.
 *
 * So: real HTML, through the real parser, into the real payload, past the real
 * guard. If a collector can emit something the contract refuses, it fails here.
 */
function rawFromHtml(html: string, url = "https://acme.test/"): SeoAuditRaw {
  const parsed = parsePage(html, url);
  return {
    origin: "https://acme.test",
    host: "acme.test",
    requestedUrl: url,
    availability: "available",
    capturedAt: "2026-08-18T09:00:00.000Z",
    sourceWindow: { from: "2026-08-18", to: "2026-08-18" },
    stopReason: null,
    providerUsage: {},
    limitation: "discoverable_same_origin_static_html_audit",
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: { fetched: true, urlCount: 1, subjectUrls: [url], declaredUrls: [url], complete: true },
    pages: [
      {
        // canonical_url.v1 keeps the root slash and drops it elsewhere. Getting
        // this wrong makes the target unmatched, `targetPageExtract` null, and
        // every assertion below vacuous — which is how the first draft of this
        // file passed while checking nothing.
        subjectUrl: url === "https://acme.test/" ? url : url.replace(/\/$/, ""),
        depth: 0,
        onPage: parsed.onPage,
        projection: {
          fetchUrl: url,
          status: 200,
          finalStatus: 200,
          redirectChain: [],
          canonicalTarget: parsed.canonicalTarget,
          robotsIndexable: parsed.robotsIndexable,
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
          responseMs: 42,
          contentType: "text/html; charset=utf-8",
        },
      },
    ],
  } as unknown as SeoAuditRaw;
}

function page(head: string, body: string): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
}

describe("payload round trip through the real parser", () => {
  it.each([
    [
      "an emoji-dense body, the case that 502'd the tool",
      page("<title>Launch</title>", `<p>${"🚀".repeat(900)}</p>`),
    ],
    [
      "an emoji title and description",
      page(
        `<title>${"🚀".repeat(300)}launch day</title><meta name="description" content="${"🎉".repeat(300)}">`,
        "<p>Body copy.</p>",
      ),
    ],
    [
      "astral characters in every declared field",
      page(
        `<title>t</title><meta property="og:title" content="${"𝕏".repeat(1_500)}">` +
          `<meta property="og:image" content="${"𝕏".repeat(1_500)}">` +
          `<meta name="viewport" content="${"𝕏".repeat(1_500)}">` +
          `<link rel="alternate" hreflang="${"𝕏".repeat(120)}" href="/x">` +
          `<meta name="robots" content="${"𝕏".repeat(120)}">`,
        "<p>Body.</p>",
      ),
    ],
    [
      "an unbounded charset declaration",
      page(`<meta charset="${"a".repeat(3_000)}"><title>t</title>`, "<p>Body.</p>"),
    ],
    [
      "CJK throughout, where bytes and characters diverge",
      page(
        `<title>${"标题".repeat(200)}</title><meta name="description" content="${"描述".repeat(200)}">`,
        `<p>${"正文内容".repeat(500)}</p>`,
      ),
    ],
    [
      "a page declaring far more than the caps allow",
      page(
        Array.from({ length: 60 }, (_, i) => `<link rel="alternate" hreflang="l${i}" href="/${i}">`).join("") +
          "<title>t</title>",
        "<p>Body.</p>",
      ),
    ],
    ["a page declaring nothing at all", page("<title>t</title>", "<p>Body.</p>")],
  ])("stays valid for %s", (_label, html) => {
    const payload = buildSeoAuditPayload(rawFromHtml(html));

    // Guard the guard: an unmatched target yields a null extract, and then
    // "the payload is valid" says nothing about the fields under test.
    expect(payload.result.targetInspected).toBe(true);
    expect(payload.result.targetPageExtract).not.toBeNull();
    expect(payload.result.targetPageExtract?.declared).not.toBeNull();

    expect(isSeoAuditPayload(payload)).toBe(true);
  });

  it("stays valid when the crawl carried no markup side-car", () => {
    const base = rawFromHtml(page("<title>t</title>", "<p>Body.</p>"));
    const withoutSideCar = {
      ...base,
      pages: base.pages.map(({ ...rest }) => {
        const copy = { ...rest } as Record<string, unknown>;
        delete copy["onPage"];
        return copy;
      }),
    } as unknown as SeoAuditRaw;

    const payload = buildSeoAuditPayload(withoutSideCar);
    expect(isSeoAuditPayload(payload)).toBe(true);
    expect(payload.result.targetPageExtract?.declared).toBeNull();
  });
});
