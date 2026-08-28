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
  DAILY_BRIEFING_PAGE_DESTINATIONS,
  FIRST_OBSERVED_MAX_POSITION,
  FIRST_OBSERVED_MIN_POSITION,
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

/**
 * Thousands separator, the way the copy writes it.
 *
 * Both locales use the English grouping here because the numbers are quoted
 * from an English-language product surface in both.
 */
function grouped(value: number): string {
  return value.toLocaleString("en-US");
}

const EN_NUMERALS: Readonly<Record<number, string>> = {
  1: "one",
  2: "two",
  3: "three",
  5: "five",
};
const ZH_NUMERALS: Readonly<Record<number, string>> = {
  1: "一",
  2: "两",
  3: "三",
  5: "五",
};

/**
 * Assert the copy states a threshold, in the sentence that carries it.
 *
 * NOT a bare substring of the digits. `expect(prose).toContain("30")` is
 * satisfied by "300+", "top 30" and "30% or more", all of which appear in this
 * same prose — a mutation run against the real page-collapse floor changed it
 * from thirty to eighty and the whole suite stayed green. The needle is built
 * from the constant and embedded in the phrase, so the assertion fails when
 * either half moves.
 */
function statesThreshold(
  prose: string,
  phrase: string,
  label: string,
): void {
  expect(prose.includes(phrase), `${label}: expected the copy to state "${phrase}"`).toBe(
    true,
  );
}

/**
 * Every place the copy uses one phrase shape must state the same number.
 *
 * `statesThreshold` alone is satisfied by a single surviving occurrence: the
 * row floor appears in four table rows, and editing one of them to a different
 * number left the assertion green because the other three still matched. This
 * reads the value out of every occurrence and requires them all to be the
 * constant, so a drifted row fails on its own.
 */
function everyStatedValue(
  prose: string,
  pattern: RegExp,
  expected: number,
  label: string,
): void {
  const found = [...prose.matchAll(pattern)].map((match) => Number(match[1]));
  expect(found.length, `${label}: ${String(pattern)} matched nothing`).toBeGreaterThan(0);
  expect(new Set(found), `${label}: ${String(pattern)}`).toEqual(
    new Set([expected]),
  );
}

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
      // Shapes rather than a spot list of literals: an outcome promise that
      // happened to use a verb nobody thought of passed the literal version.
      const prose = allProse(tool, get, locale);
      for (const forbidden of [
        /\b(?:will|you'll|you will)\s+\w+(?:\s+\w+)?\s+(?:rank|rankings?|traffic|clicks|positions?)\b/i,
        /\b(?:improve|boost|increase|grow|lift|raise)s?\s+(?:your\s+)?(?:rankings?|traffic|clicks|positions?)\b/i,
        /\brank\s+higher\b/i,
        /\bguarantee\w*/i,
        /提升(?:排名|流量|点击)/,
        /带来更多(?:流量|点击|排名)/,
        /(?:保证|一定能|必然)(?:排|上|提升|带来)/,
        /轻松(?:拿下|排上)/,
      ]) {
        expect(prose, String(forbidden)).not.toMatch(forbidden);
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

  it("declares invention for the tables this article is supposed to have", () => {
    // The self-consistency check below cannot demand a disclosure: an author
    // who sets `invented: false` and writes no disclaimer satisfies it. This
    // one pins what each article actually carries, so an illustrative table
    // that quietly declares itself factual fails here.
    const expected: Readonly<Record<string, readonly boolean[]>> = {
      // One table, and it is the engine's own thresholds.
      "daily-search-briefing": [false],
      // One table, and its rows are made up.
      "competitor-keyword-gap": [true],
    };
    for (const locale of LOCALES) {
      const declared = get(locale)
        .sections.flatMap((section) =>
          section.table === undefined ? [] : [section.table.invented],
        );
      expect(declared, locale).toEqual(expected[tool]);
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
      const phrases =
        locale === "en"
          ? [
              `${grouped(DAILY_CADENCE_MIN_IMPRESSIONS)} impressions in the complete week`,
              `${String(BRIEFING_MIN_ROW_IMPRESSIONS)}+ impressions in each window`,
              `by both ${String(BRIEFING_MATERIAL_CHANGE_RATIO * 100)}% and ${String(BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE)}`,
              `no more than ${String(BRIEFING_STABLE_POSITION_DELTA)}`,
              `at least ${String(BRIEFING_TOP_BAND_MIN_IMPROVEMENT)} places better`,
              `falls by ${String(BRIEFING_POSITION_DECLINE_MIN_DELTA)} or more`,
              `with ${String(BRIEFING_CTR_ANOMALY_MIN_IMPRESSIONS)}+ impressions this window`,
              `holding ${grouped(BRIEFING_CTR_ANOMALY_MIN_BAND_IMPRESSIONS)}+ impressions`,
              `${String(BRIEFING_PAGE_COLLAPSE_MIN_PREVIOUS_IMPRESSIONS)}+ impressions on that page`,
              `by ${String(BRIEFING_PAGE_COLLAPSE_RATIO * 100)}% or more`,
              `from ${String(FIRST_OBSERVED_MIN_POSITION)} up to but not including ${String(FIRST_OBSERVED_MAX_POSITION)}`,
              `At most ${EN_NUMERALS[DAILY_BRIEFING_ACTION_LIMIT] ?? ""} query records`,
              `at most ${EN_NUMERALS[DAILY_BRIEFING_PAGE_LIMIT] ?? ""} page records`,
            ]
          : [
              `完整一周 ${grouped(DAILY_CADENCE_MIN_IMPRESSIONS)} 次曝光`,
              `≥${String(BRIEFING_MIN_ROW_IMPRESSIONS)} 次曝光`,
              `下降 ${String(BRIEFING_MATERIAL_CHANGE_RATIO * 100)}% 和 ${String(BRIEFING_MIN_ABSOLUTE_CLICK_CHANGE)} 次`,
              `不超过 ${String(BRIEFING_STABLE_POSITION_DELTA)}`,
              `至少好了 ${String(BRIEFING_TOP_BAND_MIN_IMPROVEMENT)} 位`,
              `下降 ≥${String(BRIEFING_POSITION_DECLINE_MIN_DELTA)} 位`,
              `本窗口 ≥${String(BRIEFING_CTR_ANOMALY_MIN_IMPRESSIONS)} 次曝光`,
              `仍持有 ≥${grouped(BRIEFING_CTR_ANOMALY_MIN_BAND_IMPRESSIONS)} 次曝光`,
              `上一窗口 ≥${String(BRIEFING_PAGE_COLLAPSE_MIN_PREVIOUS_IMPRESSIONS)} 次曝光`,
              `曝光下降 ≥${String(BRIEFING_PAGE_COLLAPSE_RATIO * 100)}%`,
              `从 ${String(FIRST_OBSERVED_MIN_POSITION)} 起、不含 ${String(FIRST_OBSERVED_MAX_POSITION)}`,
              `最多${ZH_NUMERALS[DAILY_BRIEFING_ACTION_LIMIT] ?? ""}条查询词记录`,
              `最多${ZH_NUMERALS[DAILY_BRIEFING_PAGE_LIMIT] ?? ""}条页面记录`,
            ];
      for (const phrase of phrases) statesThreshold(prose, phrase, locale);

      // Phrase families that recur across table rows: one drifted row must
      // fail even while its siblings still state the right number.
      everyStatedValue(
        prose,
        locale === "en"
          ? /(\d+)\+ impressions in each window/g
          : /两个窗口各 ≥(\d+) 次曝光/g,
        BRIEFING_MIN_ROW_IMPRESSIONS,
        locale,
      );
      everyStatedValue(
        prose,
        locale === "en"
          ? /up to but not including (\d+)/g
          : /不含 (\d+)/g,
        FIRST_OBSERVED_MAX_POSITION,
        locale,
      );
      everyStatedValue(
        prose,
        locale === "en" ? /from (\d+) up to but not/g : /从 (\d+) 起、不含/g,
        FIRST_OBSERVED_MIN_POSITION,
        locale,
      );
    }
  });

  it("names the destination each page lane actually carries", () => {
    // The first draft of this copy sent all three page lanes to the On-Page
    // Checker. Two of them go to Traffic Drop Diagnosis, because the checker
    // needs a target query and an anonymized page lane has none to give it.
    expect(DAILY_BRIEFING_PAGE_DESTINATIONS).toEqual({
      page_impression_collapse: "traffic-drop-diagnosis",
      page_click_decline: "traffic-drop-diagnosis",
      page_first_observed: "on-page-seo-check",
    });

    for (const locale of LOCALES) {
      const prose = articleProse(getDailyBriefingArticle(locale));
      expect(prose, locale).toMatch(
        locale === "en"
          ? /both declining page lanes|page whose impressions collapsed/
          : /两条下降型页面路径|曝光几乎消失/,
      );
      expect(prose, locale).toMatch(
        locale === "en"
          ? /only the first-appearance one lands here/
          : /只有「首次出现」落在这里/,
      );
    }
  });

  it("names both paths that need a confirmed brand list, not just one", () => {
    for (const locale of LOCALES) {
      const prose = articleProse(getDailyBriefingArticle(locale));
      expect(prose, locale).toMatch(
        locale === "en"
          ? /two of them need a confirmed brand list/
          : /有两条路径需要已确认的品牌词清单/,
      );
      expect(prose, locale).not.toMatch(
        locale === "en"
          ? /the only one that needs a confirmed brand list/
          : /唯一需要已确认品牌词清单的路径/,
      );
    }
  });

  it("does not claim the trend read stops where the comparison does", () => {
    // `dailyBriefingTrendWindow` ends on the CURRENT Pacific date, three days
    // ahead of the comparison windows. "Nothing newer is read" was false of it.
    for (const locale of LOCALES) {
      const prose = articleProse(getDailyBriefingArticle(locale));
      expect(prose, locale).toMatch(
        locale === "en"
          ? /ending on the current Pacific date/
          : /截止到当前太平洋日期/,
      );
      expect(prose, locale).not.toMatch(
        locale === "en" ? /Nothing newer is read/ : /更新的数据不读/,
      );
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
      const phrases =
        locale === "en"
          ? [
              `position ${String(COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK)} or better`,
              `at most ${String(COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT)} rows are taken per competitor`,
              `up to ${String(COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS)} rows`,
              `at or below ${String(COMPETITOR_KEYWORD_GAP_KD_LOW_MAX)}`,
              `above ${String(COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN - 1)} is a head term`,
              `Up to ${EN_NUMERALS[COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS] ?? ""} competitors`,
            ]
          : [
              `排在第 ${String(COMPETITOR_KEYWORD_GAP_MAX_COMPETITOR_RANK)} 位或更好`,
              `最多取 ${String(COMPETITOR_KEYWORD_GAP_PROVIDER_LIMIT)} 行`,
              `最多 ${String(COMPETITOR_KEYWORD_GAP_CSV_MAX_ROWS)} 行`,
              `难度 ≤ ${String(COMPETITOR_KEYWORD_GAP_KD_LOW_MAX)}`,
              `高于 ${String(COMPETITOR_KEYWORD_GAP_KD_HEAD_MIN - 1)} 是要暂缓的头部词`,
              `最多${ZH_NUMERALS[COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS] ?? ""}个竞品`,
            ];
      for (const phrase of phrases) statesThreshold(prose, phrase, locale);
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
      // The disclaimer being present proves nothing about the rest of the
      // page: the first draft carried "free of a credit meter" a hundred lines
      // above this very sentence, and the presence check passed.
      expect(prose, locale).toMatch(
        /does not display or promise a fixed credit|不展示、也不承诺固定的积分/,
      );
      for (const forbidden of [
        /free of a credit/i,
        /\bno credit charge\b/i,
        /\bcosts? nothing\b/i,
        /\bfree to run\b/i,
        /不需要挂?一?个?积分/,
        /不扣(?:积分|费)/,
        /免费(?:运行|使用|跑)/,
      ]) {
        expect(prose, `${locale} ${String(forbidden)}`).not.toMatch(forbidden);
      }
    }
  });

  it("demonstrates only status-to-action pairs the engine can produce", () => {
    // `observed_strong` is hard-wired to `review_existing_query`; the optimize
    // lane requires `observed_weak`. An example table pairing "Already
    // ranking" with "Optimize" teaches the mapping backwards, inside the one
    // section whose whole subject is that mapping.
    for (const locale of LOCALES) {
      const strong = locale === "en" ? "Already ranking" : "已在排";
      const optimize = locale === "en" ? "Optimize existing page" : "优化现有页";
      for (const section of getCompetitorKeywordGapArticle(locale).sections) {
        for (const row of section.table?.rows ?? []) {
          const line = row.join(" | ");
          expect(
            line.includes(strong) && line.includes(optimize),
            `${locale} ${line}`,
          ).toBe(false);
        }
      }
    }
  });

  it("describes the all-competitors-failed case as the refusal it is", () => {
    // The handler returns `keyword_source_unavailable` when
    // `completedCompetitors === 0`, so the "nothing was read" result screen is
    // never delivered as a report.
    for (const locale of LOCALES) {
      const prose = articleProse(getCompetitorKeywordGapArticle(locale));
      expect(prose, locale).toMatch(
        locale === "en"
          ? /refused as a keyword-source failure/
          : /作为数据源读取失败被拒绝/,
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
