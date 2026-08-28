// @input  -- both locales of the two new connected-tool articles and their shared shell copy
// @output -- copy, capability, threshold, and internal-link contract assertions
// @pos    -- the guard between "reads well" and "is true" for these two pages
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BRIEFING_CTR_ANOMALY_MIN_BAND_IMPRESSIONS,
  BRIEFING_CTR_ANOMALY_MIN_IMPRESSIONS,
  BRIEFING_MATERIAL_CHANGE_RATIO,
  BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE,
  BRIEFING_MIN_ROW_IMPRESSIONS,
  BRIEFING_PAGE_COLLAPSE_MIN_PREVIOUS_IMPRESSIONS,
  BRIEFING_PAGE_COLLAPSE_RATIO,
  BRIEFING_POSITION_DECLINE_MIN_DELTA,
  BRIEFING_STABLE_POSITION_DELTA,
  BRIEFING_TOP_BAND_MIN_IMPROVEMENT,
  COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS,
  COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN,
  COMPETITOR_KEYWORD_GAP_KD_LOW_MAX,
  COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS,
  COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK,
  COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT,
  DAILY_BRIEFING_ACTION_LIMIT,
  DAILY_BRIEFING_PAGE_LIMIT,
  DAILY_CADENCE_MIN_IMPRESSIONS,
} from "@sf/public-tools";

import { getConnectedToolContent } from "./connected-tool-content.ts";
import { getCompetitorKeywordGapArticle } from "./competitor-keyword-gap-article-content.ts";
import { getDailyBriefingArticle } from "./daily-briefing-article-content.ts";
import { RELATED_READING } from "./keyword-map-article.tsx";
import type { ToolArticle } from "./tool-article-shape.ts";

const LOCALES = ["en", "zh"] as const;

/** apps/marketing, from this file. */
const APP_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const ARTICLES = [
  {
    tool: "daily-search-briefing",
    get: getDailyBriefingArticle,
  },
  {
    tool: "competitor-keyword-gap",
    get: getCompetitorKeywordGapArticle,
  },
] as const;

function articleProse(article: ToolArticle): string {
  return [
    article.exampleHeading,
    ...article.example.flatMap((item) => [item.heading, item.body]),
    ...article.sections.flatMap((section) => [
      section.heading,
      section.intro ?? "",
      ...(section.paragraphs ?? []),
      ...(section.items ?? []).flatMap((item) => [item.heading, item.body]),
      section.table?.label ?? "",
      ...(section.table?.columns ?? []),
      ...(section.table?.rows ?? []).flat(),
    ]),
    article.relatedToolsHeading,
    ...article.relatedTools.flatMap((link) => [link.label, link.description]),
    article.relatedReadingHeading,
    ...article.relatedReading.flatMap((link) => [link.label, link.description]),
  ].join("\n");
}

/** Article prose plus the shared shell copy the same page renders around it. */
function allProse(
  tool: (typeof ARTICLES)[number]["tool"],
  get: (locale: string) => ToolArticle,
  locale: string,
): string {
  const content = getConnectedToolContent(locale, tool);
  return [
    articleProse(get(locale)),
    content.title,
    content.description,
    content.trust,
    ...content.steps.flatMap((step) => [step.name, step.text]),
    ...content.outputs.flatMap((output) => [output.label, output.body]),
    ...content.faq.flatMap((entry) => [entry.question, entry.answer]),
  ].join("\n");
}

/**
 * Whether a blog slug is a page this locale actually serves.
 *
 * Existence of the file is not enough: `getLocalBlogPosts` publishes only
 * `status: published`, so a draft is a 404 with a friendly label on it — which
 * is exactly the failure this whole check exists to catch.
 */
function blogPostIsPublished(locale: string, slug: string): boolean {
  const path = `${APP_ROOT}/content/blog/${locale}/${slug}.md`;
  if (!existsSync(path)) return false;
  return /^status: published$/m.test(readFileSync(path, "utf8"));
}

describe.each(ARTICLES)("$tool long-form article", ({ tool, get }) => {
  for (const locale of LOCALES) {
    it(`promises no outcome (${locale})`, () => {
      // Both engines are barred from emitting copy that promises a result.
      // The page selling them forms the reader's expectation first, so it is
      // held to the same line.
      const prose = allProse(tool, get, locale).toLowerCase();
      for (const forbidden of [
        "will increase",
        "guaranteed",
        "guarantee ",
        "rank higher",
        "will rank",
        "will outrank",
        "提升排名",
        "保证",
        "一定能",
        "轻松拿下",
      ]) {
        expect(prose, forbidden).not.toContain(forbidden);
      }
    });

    it(`links only to tool routes that exist (${locale})`, () => {
      // These links are internal navigation on a page that also emits
      // structured data. A related-tool link to a page nobody built is a 404
      // with a schema entry vouching for it.
      for (const link of get(locale).relatedTools) {
        const [section, slug] = link.href.split("/").filter(Boolean);
        expect(["agents", "tools"], link.href).toContain(section);
        expect(slug, link.href).toBeTruthy();
        expect(
          existsSync(
            `${APP_ROOT}/src/app/[locale]/${section}/${slug}/page.tsx`,
          ),
          link.href,
        ).toBe(true);
      }
    });

    it(`links only to articles published in this locale (${locale})`, () => {
      // The blog is not translated post-for-post: 80 English articles against
      // 8 Chinese ones. A single shared list with translated labels therefore
      // sends every Chinese reader to a 404, which is what the keyword map
      // page did until this guard existed.
      for (const link of get(locale).relatedReading) {
        expect(link.href.startsWith("/blog/"), link.href).toBe(true);
        const slug = link.href.slice("/blog/".length);
        expect(blogPostIsPublished(locale, slug), `${locale} ${link.href}`).toBe(
          true,
        );
      }
    });

    it(`does not point the page at itself (${locale})`, () => {
      const hrefs = get(locale).relatedTools.map((link) => link.href);
      expect(hrefs).not.toContain(`/tools/${tool}`);
    });
  }

  it("keeps the two locales structurally identical", () => {
    const shape = (locale: string) => {
      const article = get(locale);
      return {
        example: article.example.length,
        sections: article.sections.map((section) => ({
          paragraphs: section.paragraphs?.length ?? 0,
          items: section.items?.length ?? 0,
          tableRows: section.table?.rows.length ?? 0,
          tableColumns: section.table?.columns.length ?? 0,
        })),
        relatedTools: article.relatedTools.map((link) => link.href),
        relatedReading: article.relatedReading.length,
      };
    };

    expect(shape("zh")).toEqual(shape("en"));
  });

  it("gives every table row a cell for every column", () => {
    for (const locale of LOCALES) {
      for (const section of get(locale).sections) {
        if (section.table === undefined) continue;
        for (const row of section.table.rows) {
          expect(row, `${locale} ${section.heading}`).toHaveLength(
            section.table.columns.length,
          );
        }
      }
    }
  });

  it("says so on the face of any table whose rows are invented", () => {
    // An illustrative table exists to show the shape of a result. A reader who
    // takes it for a live run has been misled by the page rather than by the
    // tool — so the declaration and the label have to agree, in both
    // directions: a table of the engine's own thresholds must not claim to be
    // made up either.
    for (const locale of LOCALES) {
      for (const section of get(locale).sections) {
        if (section.table === undefined) continue;
        const claimsInvention = /invented|made-up|虚构/.test(
          section.table.label.toLowerCase(),
        );
        expect(claimsInvention, `${locale} ${section.heading}`).toBe(
          section.table.invented,
        );
      }
    }
  });
});

describe("Daily Search Briefing article thresholds", () => {
  /**
   * The prose quotes the engine's own numbers. These assertions pin BOTH
   * sides: the constant still holds the value, and the copy still states it.
   * Changing a constant without the copy leaves a page describing a tool that
   * no longer exists, which is the single failure this whole page is written
   * against.
   */
  it("still describes the constants the engine runs on", () => {
    expect(DAILY_CADENCE_MIN_IMPRESSIONS).toBe(1_000);
    expect(BRIEFING_MIN_ROW_IMPRESSIONS).toBe(100);
    expect(BRIEFING_MATERIAL_CHANGE_RATIO).toBe(0.15);
    expect(BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE).toBe(3);
    expect(BRIEFING_STABLE_POSITION_DELTA).toBe(0.5);
    expect(BRIEFING_TOP_BAND_MIN_IMPROVEMENT).toBe(1.5);
    expect(BRIEFING_POSITION_DECLINE_MIN_DELTA).toBe(3);
    expect(BRIEFING_CTR_ANOMALY_MIN_IMPRESSIONS).toBe(300);
    expect(BRIEFING_CTR_ANOMALY_MIN_BAND_IMPRESSIONS).toBe(2_000);
    expect(BRIEFING_PAGE_COLLAPSE_MIN_PREVIOUS_IMPRESSIONS).toBe(30);
    expect(BRIEFING_PAGE_COLLAPSE_RATIO).toBe(0.8);
    expect(DAILY_BRIEFING_ACTION_LIMIT).toBe(3);
    expect(DAILY_BRIEFING_PAGE_LIMIT).toBe(2);

    for (const locale of LOCALES) {
      const prose = articleProse(getDailyBriefingArticle(locale));
      // Digits only: the two languages decorate them differently ("100+" vs
      // "≥100"), and asserting the decoration tests the prose style rather
      // than the number the engine runs on.
      for (const quoted of [
        "1,000",
        "100",
        "15%",
        "0.5",
        "1.5",
        "300",
        "2,000",
        "30",
        "80%",
        "8–21",
      ]) {
        expect(prose, `${locale} ${quoted}`).toContain(quoted);
      }
    }
  });

  it("states the three-day lag rather than implying live data", () => {
    for (const locale of LOCALES) {
      const prose = articleProse(getDailyBriefingArticle(locale));
      expect(prose, locale).toMatch(/three days behind|三天/);
      expect(prose.toLowerCase(), locale).toMatch(/pacific|太平洋/);
    }
  });

  it("never renders an absent Search Console row as zero", () => {
    for (const locale of LOCALES) {
      const prose = articleProse(getDailyBriefingArticle(locale));
      expect(prose, locale).toMatch(/not observed|未观测到/);
      expect(prose.toLowerCase(), locale).toMatch(/anonymi|匿名/);
    }
  });

  it("keeps the no-persistence boundary on the page", () => {
    for (const locale of LOCALES) {
      const prose = articleProse(getDailyBriefingArticle(locale)).toLowerCase();
      expect(prose, locale).toMatch(
        /no saved history|no scheduled job|没有保存的历史|没有定时任务/,
      );
    }
  });
});

describe("Competitor Keyword Gap article boundaries", () => {
  it("still describes the sample rule the handler asks for", () => {
    expect(COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK).toBe(20);
    expect(COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT).toBe(300);
    expect(COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS).toBe(5);
    expect(COMPETITOR_KEYWORD_GAP_KD_LOW_MAX).toBe(30);
    expect(COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN).toBe(61);
    expect(COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS).toBe(150);

    for (const locale of LOCALES) {
      const prose = articleProse(getCompetitorKeywordGapArticle(locale));
      for (const quoted of ["20", "300", "150", "30", "60"]) {
        expect(prose, `${locale} ${quoted}`).toContain(quoted);
      }
    }
  });

  it("names no provider", () => {
    // The result surface is swept for vendor names. A marketing page that
    // names the vendor teaches a vocabulary the product deliberately does not
    // use, and the two then disagree about what the reader is looking at.
    for (const locale of LOCALES) {
      const prose = articleProse(getCompetitorKeywordGapArticle(locale));
      expect(prose, locale).not.toMatch(
        /dataforseo|\bdfs\b|ahrefs|semrush|moz\b|similarweb/i,
      );
    }
  });

  it("keeps the pre-screen labelled as an estimate that removes nothing", () => {
    for (const locale of LOCALES) {
      const prose = articleProse(getCompetitorKeywordGapArticle(locale));
      expect(prose.toLowerCase(), locale).toMatch(/pre-screen|预筛/);
      expect(prose, locale).toMatch(
        /never removes a row|does not order the table|不排序|永远不会删掉/,
      );
    }
  });

  it("says a missing Search Console row is not zero exposure", () => {
    for (const locale of LOCALES) {
      const prose = articleProse(getCompetitorKeywordGapArticle(locale));
      expect(prose, locale).toMatch(
        /not observed in this sample|not observed in this run|样本未观测到/,
      );
      expect(prose, locale).toMatch(/exact query|精确查询/);
    }
  });

  it("makes no credit claim", () => {
    for (const locale of LOCALES) {
      const prose = articleProse(getCompetitorKeywordGapArticle(locale));
      expect(prose, locale).toMatch(
        /does not display or promise a fixed credit|不展示、也不承诺固定的积分/,
      );
    }
  });
});

describe("Keyword Opportunity Map related reading", () => {
  // Regression guard for the bug this change fixed: the Chinese article linked
  // three English-only slugs, so every link in that column 404'd.
  it("links only to articles published in the locale that renders them", () => {
    for (const locale of LOCALES) {
      for (const link of RELATED_READING[locale]) {
        const slug = link.href.replace("/blog/", "");
        expect(blogPostIsPublished(locale, slug), `${locale} ${link.href}`).toBe(
          true,
        );
      }
    }
  });

  it("gives each locale as many articles as the other", () => {
    expect(RELATED_READING.zh).toHaveLength(RELATED_READING.en.length);
  });
});
