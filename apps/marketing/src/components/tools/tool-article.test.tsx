// @input  -- both shipped articles, rendered through the shared renderer
// @output -- markup assertions the copy-level guards cannot make
// @pos    -- the only test that executes ToolArticleSections itself
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCompetitorKeywordGapArticle } from "./competitor-keyword-gap-article-content.ts";
import { getDailyBriefingArticle } from "./daily-briefing-article-content.ts";
import { ToolArticleSections } from "./tool-article.tsx";
import type { ToolArticle } from "./tool-article-shape.ts";

const ARTICLES: readonly {
  readonly tool: string;
  readonly get: (locale: string) => ToolArticle;
}[] = [
  { tool: "daily-search-briefing", get: getDailyBriefingArticle },
  { tool: "competitor-keyword-gap", get: getCompetitorKeywordGapArticle },
];

const LOCALES = ["en", "zh"] as const;

/** React's text escaping, so an assertion can quote the copy verbatim. */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function render(article: ToolArticle, locale: string): string {
  return renderToStaticMarkup(
    <ToolArticleSections locale={locale} article={article} />,
  );
}

describe.each(ARTICLES)("$tool rendered", ({ get }) => {
  for (const locale of LOCALES) {
    it(`emits every heading and every link (${locale})`, () => {
      const article = get(locale);
      const markup = render(article, locale);

      for (const section of article.sections) {
        expect(markup, section.heading).toContain(esc(section.heading));
      }
      for (const item of article.example) {
        expect(markup, item.heading).toContain(esc(item.heading));
      }
      // Copy passes through untouched apart from HTML entity escaping, so a
      // heading that is missing here was dropped by the renderer, not by the
      // copy — which is the half the content guards cannot see.
      expect(markup).toContain(esc(article.relatedToolsHeading));
      expect(markup).toContain(esc(article.relatedReadingHeading));
    });

    it(`prefixes in-site links with the locale (${locale})`, () => {
      const article = get(locale);
      const markup = render(article, locale);
      const prefix = locale === "en" ? "" : "/zh";

      for (const link of [...article.relatedTools, ...article.relatedReading]) {
        expect(markup, link.href).toContain(`href="${prefix}${link.href}"`);
      }
    });

    it(`gives each table a caption and a reachable scroller (${locale})`, () => {
      const article = get(locale);
      const markup = render(article, locale);
      const tables = article.sections.filter(
        (section) => section.table !== undefined,
      );
      expect(tables.length).toBeGreaterThan(0);

      for (const section of tables) {
        const table = section.table;
        if (table === undefined) continue;
        // The disclosure must survive for a reader who never sees the label
        // sitting above the table.
        expect(markup, table.label).toContain(
          `<caption class="sr-only">${esc(table.label)}</caption>`,
        );
        expect(markup).toContain(`aria-label="${esc(table.label)}"`);
        expect(markup).toContain('tabindex="0"');
        for (const row of table.rows) {
          for (const cell of row) {
            expect(markup, cell).toContain(esc(cell));
          }
        }
      }
    });
  }

  it("widens the last example card only when the count is odd", () => {
    // The grid is two columns. With an even count there is no leftover cell,
    // and spanning the last card just makes one card double-width for no
    // reason — a bug that only appears the day someone adds a sixth item.
    for (const locale of LOCALES) {
      const article = get(locale);
      const markup = render(article, locale);
      const spans = markup.split("md:col-span-2").length - 1;
      expect(spans, `${locale} ${String(article.example.length)}`).toBe(
        article.example.length % 2 === 1 ? 1 : 0,
      );
    }
  });
});
