// @input  -- the rule sentence the audit catalogue prints for 2.1 and 2.4
// @output -- a failing test when that sentence stops matching the evaluator
// @pos    -- the guard for the one number a reader is told their result came from
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";
import { parsePage } from "@sf/sources/crawl-public-preview";
import { buildSeoAuditReport, PAGE_AUDIT_GROUPS } from "@sf/public-tools";
// The subpath, not the barrel: the width function is not on the package root.
import { displayWidth } from "@sf/public-tools/seo-audit/text-width";
import type { SeoAuditRaw } from "@sf/public-tools";

/**
 * Why this reads the printed sentence and then runs the real evaluator.
 *
 * The catalogue said "15–70 characters" and "50–165 characters" long after the
 * evaluator had moved to display width at 15–60 and 50–160, so a reader was
 * shown one rule and judged by another — on the single measure the catalogue
 * exists to state. The sentence now interpolates the constants, which stops it
 * drifting by hand; asserting that it interpolates them would only prove it
 * reads the same table it was built from.
 *
 * So the numbers are parsed back out of the rendered sentence and used to build
 * pages at exactly that boundary. The assertion is that the evaluator flips
 * where the sentence says it does.
 */
/** The one catalogue row a check id names, from the shipped page groups. */
function catalogueCheck(id: string) {
  const found = PAGE_AUDIT_GROUPS.flatMap((group) => group.checks).find(
    (entry) => entry.id === id,
  );
  if (!found) throw new Error(`no catalogue check ${id}`);
  return found;
}

function statedRange(id: string): { readonly min: number; readonly max: number } {
  const check = catalogueCheck(id);
  const ranges = [check.threshold.en, check.threshold.zh].map((text) => {
    const match = /(\d+)[–-](\d+)/.exec(text);
    if (!match?.[1] || !match[2]) {
      throw new Error(`no range in the rule text for ${id}: ${text}`);
    }
    return { min: Number(match[1]), max: Number(match[2]) };
  });
  const [en, zh] = ranges;
  if (!en || !zh) throw new Error(`missing a localisation for ${id}`);
  // Both catalogues interpolate the same constants today. Reading only English
  // would let a future hand-edit move the Chinese numbers on their own, and the
  // audience most affected by a width-versus-characters mix-up reads that one.
  expect(zh, `${id} zh range differs from en`).toEqual(en);
  // Stated in display width, not characters: the distinction is the whole bug.
  expect(check.threshold.en, id).toMatch(/display width/i);
  expect(check.threshold.zh, id).toContain("显示宽度");
  return en;
}

function rawFromPages(
  pages: readonly { readonly url: string; readonly html: string }[],
): SeoAuditRaw {
  return {
    origin: "https://acme.test",
    host: "acme.test",
    requestedUrl: pages[0]?.url ?? "https://acme.test/",
    availability: "available",
    capturedAt: "2026-08-19T09:00:00.000Z",
    sourceWindow: { from: "2026-08-19", to: "2026-08-19" },
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
        subjectUrl: page.url,
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

function pageWith(title: string, description: string) {
  return {
    url: "https://acme.test/",
    html: `<!doctype html><html lang="en"><head>
      <title>${title}</title>
      <meta name="description" content="${description}">
      <link rel="canonical" href="https://acme.test/">
    </head><body><h1>Home</h1><p>Body copy.</p></body></html>`,
  };
}

/** Which subject URLs the record flagged. */
function flagged(
  report: ReturnType<typeof buildSeoAuditReport>,
  id: string,
): number {
  const record = report.records.find((entry) => entry.id === id);
  if (!record) throw new Error(`no record ${id}`);
  return record.observations.length;
}

const FILLER = "The reviewed working range for a page title. ";

describe("the rule the catalogue prints is the rule the evaluator applies", () => {
  it("flags a title exactly one unit past the stated maximum, and not at it", () => {
    const { max } = statedRange("2.1");
    const atMax = "a".repeat(max);
    const overMax = "a".repeat(max + 1);

    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(atMax, FILLER.repeat(2))])), "title_length_outside_range"),
    ).toBe(0);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(overMax, FILLER.repeat(2))])), "title_length_outside_range"),
    ).toBe(1);
  });

  it("flags a title exactly one unit below the stated minimum, and not at it", () => {
    const { min } = statedRange("2.1");
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith("a".repeat(min), FILLER.repeat(2))])), "title_length_outside_range"),
    ).toBe(0);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith("a".repeat(min - 1), FILLER.repeat(2))])), "title_length_outside_range"),
    ).toBe(1);
  });

  it("flags a description exactly one unit past the stated maximum, and not at it", () => {
    const { max } = statedRange("2.4");
    const title = "a".repeat(30);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(title, "d".repeat(max))])), "meta_description_length_outside_range"),
    ).toBe(0);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(title, "d".repeat(max + 1))])), "meta_description_length_outside_range"),
    ).toBe(1);
  });

  it("flags a description exactly one unit below the stated minimum, and not at it", () => {
    const { min } = statedRange("2.4");
    const title = "a".repeat(30);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(title, "d".repeat(min))])), "meta_description_length_outside_range"),
    ).toBe(0);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(title, "d".repeat(min - 1))])), "meta_description_length_outside_range"),
    ).toBe(1);
  });

  it("measures the description bound in display width too", () => {
    // Title and description are separate call sites. One of them returning to
    // a character count while the other stays on width is a real shape for
    // this bug to come back in, and the title case alone would not see it.
    const { max } = statedRange("2.4");
    const title = "a".repeat(30);
    const atMax = "字".repeat(max / 2);
    expect(displayWidth(atMax)).toBe(max);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(title, atMax)])), "meta_description_length_outside_range"),
    ).toBe(0);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(title, `${atMax}字`)])), "meta_description_length_outside_range"),
    ).toBe(1);
  });

  it("measures the stated bound in display width, so CJK counts double", () => {
    // The distinction the old sentence lost. Half as many CJK characters reach
    // the same bound, and a catalogue that says "characters" sends a Chinese
    // author to exactly the wrong length.
    const { max } = statedRange("2.1");
    // Built to the bound by measured width rather than by a halved count, so an
    // odd bound fails here loudly instead of silently testing one unit short:
    // `repeat` truncates a fractional count without complaining.
    const perCjkChar = displayWidth("字");
    expect(perCjkChar).toBe(2);
    expect(max % perCjkChar, "bound not reachable in whole CJK characters").toBe(
      0,
    );
    const cjkAtMax = "字".repeat(max / perCjkChar);
    const cjkOverMax = `${cjkAtMax}字`;
    expect(displayWidth(cjkAtMax)).toBe(max);
    expect(displayWidth(cjkOverMax)).toBe(max + perCjkChar);

    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(cjkAtMax, FILLER.repeat(2))])), "title_length_outside_range"),
    ).toBe(0);
    expect(
      flagged(buildSeoAuditReport(rawFromPages([pageWith(cjkOverMax, FILLER.repeat(2))])), "title_length_outside_range"),
    ).toBe(1);
  });

  it("never states the bound as a character count again", () => {
    for (const id of ["2.1", "2.4"]) {
      const check = catalogueCheck(id);
      expect(check.threshold.en, id).not.toMatch(/range \d+[–-]\d+ characters/i);
      expect(check.threshold.zh, id).not.toMatch(/工作区间 \d+[–-]\d+ 个字符/);
    }
  });
});
