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

const DUPLICATE_BODY = `
  The calculator explains planetary positions through a carefully reviewed
  sequence of houses signs aspects transits patterns relationships timings and
  interpretations. Readers can compare the same evidence, understand each
  placement, and explore a consistent narrative without hidden predictions or
  unsupported claims. Every section connects the chart details to practical
  reflection, repeatable observation, and clearly bounded educational context.
`;

/**
 * Length findings plus real near-duplicate and FAQ promise violations.
 *
 * Four pages are required before the model can separate duplicated body text
 * from site chrome. Only the first two share the long body, so it remains
 * distinctive rather than being stripped as furniture.
 */
const PAGES = [
  {
    url: "https://acme.test/",
    html: `<!doctype html><html lang="en"><head>
      <title>${"An extremely long page title that runs well past the reviewed range ".repeat(2)}</title>
      <meta name="description" content="short">
      <link rel="canonical" href="https://acme.test/">
    </head><body><h1>Home</h1><p>${DUPLICATE_BODY}</p>
      <a href="/pricing">Pricing</a></body></html>`,
  },
  {
    url: "https://acme.test/pricing",
    html: `<!doctype html><html lang="en"><head>
      <title>Hi</title>
      <meta name="description" content="${"A description far past the reviewed upper bound. ".repeat(6)}">
      <link rel="canonical" href="https://acme.test/pricing">
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Which planets are included in the calculation?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "The calculation includes every major planet.",
            },
          },
        ],
      })}</script>
    </head><body><h1>Pricing</h1><h1>Second</h1><p>${DUPLICATE_BODY}</p></body></html>`,
  },
  {
    url: "https://acme.test/about",
    html: `<!doctype html><html lang="en"><head>
      <title>About Acme</title>
      <meta name="description" content="How the Acme team reviews its educational material.">
      <link rel="canonical" href="https://acme.test/about">
    </head><body><h1>About</h1><p>Our researchers document sources, compare interpretations, review terminology, and publish clear educational notes for readers who want transparent context.</p></body></html>`,
  },
  {
    url: "https://acme.test/contact",
    html: `<!doctype html><html lang="en"><head>
      <title>Contact Acme</title>
      <meta name="description" content="Contact the Acme editorial and research team.">
      <link rel="canonical" href="https://acme.test/contact">
    </head><body><h1>Contact</h1><p>Send the editorial team a detailed question about methodology, accessibility, corrections, partnerships, or the provenance of a published explanation.</p></body></html>`,
  },
];

describe("the browser's display vocabulary covers what the model emits", () => {
  const report = buildSeoAuditReport(rawFromPages(PAGES));

  it("produced the records this test exists to check", () => {
    // Without this the assertions below pass on an empty ledger.
    const ids = report.records.map((record) => record.id);
    expect(ids).toContain("title_length_outside_range");
    expect(ids).toContain("meta_description_length_outside_range");
    expect(
      report.records.find(
        (record) => record.id === "page_near_duplicate_of_another_page",
      )?.affected,
    ).toBeGreaterThan(0);
    expect(
      report.records.find(
        (record) => record.id === "faq_schema_question_not_on_page",
      )?.affected,
    ).toBeGreaterThan(0);
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
