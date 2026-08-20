// @input  -- real HTML, through the real crawl parser and the real audit model
// @output -- a failing test when the browser's allow-list falls behind the model
// @pos    -- the seam where a rename upstream silently breaks the whole Agent
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";
import { parsePage } from "@sf/sources/crawl-public-preview";
import { buildSeoAuditReport } from "@sf/public-tools";
import type { SeoAuditRaw } from "@sf/public-tools";

import {
  AGENT_EVIDENCE_LABELS,
  AGENT_LIMITATION_CODES,
  AGENT_RECORD_IDS,
} from "./agent-display-contract";

/**
 * Why this drives the real model instead of comparing two lists.
 *
 * `supportsAgentDisplayVocabulary` fails CLOSED: one evidence label the browser
 * has never heard of and the Agent answers `audit_response_invalid` for the
 * whole run — after the crawl finished and the credit was spent. The allow-list
 * it checks against is maintained by hand in this app while the labels are
 * produced in `@sf/public-tools`, and nothing connected the two.
 *
 * It broke exactly that way: `title_characters` was renamed to
 * `title_display_width` upstream, and every site whose title sits outside the
 * reviewed range — most sites — started failing. Typecheck passed. The suite
 * passed. Comparing the allow-list against a second hand-written list would
 * have passed too.
 *
 * So the fixture is HTML chosen to make the model emit as much of its ledger as
 * it can, and the assertion is against what the model actually produced.
 */
function rawFromPages(
  pages: readonly { readonly url: string; readonly html: string }[],
): SeoAuditRaw {
  return {
    origin: "https://acme.test",
    host: "acme.test",
    requestedUrl: pages[0]?.url ?? "https://acme.test/",
    availability: "available",
    capturedAt: "2026-08-18T09:00:00.000Z",
    sourceWindow: { from: "2026-08-18", to: "2026-08-18" },
    stopReason: null,
    providerUsage: {},
    limitation: "discoverable_same_origin_static_html_audit",
    robots: { fetched: true, groups: [], sitemaps: [] },
    sitemap: {
      fetched: true,
      urlCount: pages.length,
      subjectUrls: pages.map((page) => page.url),
      declaredUrls: pages.map((page) => page.url),
    },
    pages: pages.map((page, index) => {
      const parsed = parsePage(page.html, page.url);
      return {
        subjectUrl:
          page.url === "https://acme.test/" ? page.url : page.url.replace(/\/$/, ""),
        depth: index,
        onPage: parsed.onPage,
        projection: {
          fetchUrl: page.url,
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
          responseMs: 90,
          contentType: "text/html; charset=utf-8",
        },
      };
    }),
  } as unknown as SeoAuditRaw;
}

/** A title and description far outside the reviewed range, plus a duplicate. */
const PAGES = [
  {
    url: "https://acme.test/",
    html: `<!doctype html><html lang="en"><head>
      <title>${"An extremely long page title that runs well past the reviewed range ".repeat(2)}</title>
      <meta name="description" content="short">
      <link rel="canonical" href="https://acme.test/">
    </head><body><h1>Home</h1><p>Body copy.</p>
      <a href="/pricing">Pricing</a></body></html>`,
  },
  {
    url: "https://acme.test/pricing",
    html: `<!doctype html><html lang="en"><head>
      <title>Hi</title>
      <meta name="description" content="${"A description far past the reviewed upper bound. ".repeat(6)}">
      <link rel="canonical" href="https://acme.test/pricing">
    </head><body><h1>Pricing</h1><h1>Second</h1><p>Plans.</p></body></html>`,
  },
];

describe("the browser's display vocabulary covers what the model emits", () => {
  const report = buildSeoAuditReport(rawFromPages(PAGES));

  it("produced the records this test exists to check", () => {
    // Without this the assertions below pass on an empty ledger.
    const ids = report.records.map((record) => record.id);
    expect(ids).toContain("title_length_outside_range");
    expect(ids).toContain("meta_description_length_outside_range");
    const flagged = report.records.filter((record) => record.affected > 0);
    expect(flagged.length).toBeGreaterThan(2);
  });

  it("emits no record id the browser would refuse", () => {
    const unknown = report.records
      .map((record) => record.id)
      .filter((id) => !AGENT_RECORD_IDS.seo.has(id));
    expect(unknown).toEqual([]);
  });

  it("emits no evidence label the browser would refuse", () => {
    const unknown = [
      ...new Set(
        report.records.flatMap((record) =>
          record.observations.flatMap((observation) =>
            observation.values.map((entry) => entry.label),
          ),
        ),
      ),
    ].filter((label) => !AGENT_EVIDENCE_LABELS.has(label));
    expect(unknown).toEqual([]);
  });

  it("emits no limitation code the browser would refuse", () => {
    const unknown = [
      ...new Set(
        report.records
          .map((record) => record.limitation)
          .filter((code): code is string => code !== null),
      ),
    ].filter((code) => !AGENT_LIMITATION_CODES.has(code));
    expect(unknown).toEqual([]);
  });
});
