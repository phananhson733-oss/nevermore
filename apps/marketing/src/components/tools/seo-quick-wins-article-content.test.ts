// @input  -- both locales of the SEO Quick Wins long-form copy
// @output -- copy, capability, and related-route contract assertions
// @pos    -- the guard between "reads well" and "is true"
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getConnectedToolContent } from "./connected-tool-content.ts";
import { getQuickWinsArticle } from "./seo-quick-wins-article-content.ts";

const LOCALES = ["en", "zh"] as const;

/** apps/marketing, from this file. */
const APP_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function allProse(locale: string, draftsEnabled = true): string {
  const article = getQuickWinsArticle(locale, { draftsEnabled });
  const content = getConnectedToolContent(locale, "seo-quick-wins", {
    draftsEnabled,
  });
  return [
    article.exampleHeading,
    ...article.example.flatMap((i) => [i.heading, i.body]),
    ...article.sections.flatMap((s) => [
      s.heading,
      s.intro ?? "",
      ...(s.paragraphs ?? []),
      ...(s.items ?? []).flatMap((i) => [i.heading, i.body]),
    ]),
    content.title,
    content.description,
    ...content.steps.flatMap((s) => [s.name, s.text]),
    ...content.outputs.flatMap((o) => [o.label, o.body]),
    ...content.faq.flatMap((f) => [f.question, f.answer]),
  ].join("\n");
}

describe("SEO Quick Wins page copy", () => {
  it("carries the decided H1 and supporting line, both locales", () => {
    // Three-layer naming decided 2026-08-06: the SEO title lives in page.tsx,
    // the H1 names the task surface, the line under it names the output. Not
    // copy to be improved in passing.
    const en = getConnectedToolContent("en", "seo-quick-wins");
    expect(en.title).toBe("Find SEO Opportunities in Google Search Console");
    expect(en.description).toBe(
      "Turn high-impression, low-click queries and positions 8–20 into a prioritized action list.",
    );

    const zh = getConnectedToolContent("zh", "seo-quick-wins");
    expect(zh.title).toBe("在 Google Search Console 中找出 SEO 机会");
    expect(zh.description).toBe(
      "把高曝光、低点击的查询词和位置 8–20 的排名，变成一份按优先级排序的行动清单。",
    );
  });

  for (const locale of LOCALES) {
    it(`promises no outcome (${locale})`, () => {
      // The engine refuses to emit a draft that promises a result. The page
      // selling the engine is held to the same line, because a visitor forms
      // their expectation here and not in a code comment.
      const prose = allProse(locale).toLowerCase();
      for (const forbidden of [
        "will increase",
        "guaranteed",
        "guarantee ",
        "rank higher",
        "you will recover",
        "提升排名",
        "保证",
        "一定能",
      ]) {
        expect(prose, forbidden).not.toContain(forbidden);
      }
    });

    it(`does not advertise the pattern that was never built (${locale})`, () => {
      // "Almost on page one" was a second headline pattern in the copy draft.
      // The engine has no such pattern, and the real-data evaluation found
      // zero candidates for it on the site it was designed against.
      const prose = allProse(locale).toLowerCase();
      expect(prose).not.toContain("almost on page one");
      expect(prose).not.toContain("接近首页");
      expect(prose).not.toContain("trending up");
    });

    it(`describes rows as queries, not as pages (${locale})`, () => {
      // The engine reads `dimensions: ["query"]`. A reader promised a list of
      // pages gets a list of search terms and concludes the tool is broken.
      const content = getConnectedToolContent(locale, "seo-quick-wins");
      const observation = content.outputs[0]?.body ?? "";
      expect(observation.toLowerCase()).toMatch(/quer|查询词/);
    });

    it(`states the impression floor as the absolute number it is (${locale})`, () => {
      // An earlier draft called it "above your site's median". The engine has
      // a flat 100, and the difference decides whether a small site sees any
      // rows at all.
      expect(allProse(locale)).toContain("100");
      expect(allProse(locale).toLowerCase()).not.toContain("median");
    });

    it(`keeps the full FAQ and every how-to step (${locale})`, () => {
      const content = getConnectedToolContent(locale, "seo-quick-wins");
      expect(content.faq).toHaveLength(11);
      expect(content.steps).toHaveLength(5);
      for (const step of content.steps) {
        expect(step.name.length).toBeGreaterThan(0);
        expect(step.text.length).toBeGreaterThan(0);
      }
    });

    it(`links only to routes that exist (${locale})`, () => {
      // Structured data and internal links both point at these. A related-tool
      // link to a page nobody built is a 404 with a schema entry vouching for
      // it.
      const article = getQuickWinsArticle(locale);
      for (const link of article.relatedTools) {
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
      for (const link of article.relatedReading) {
        const slug = link.href.replace("/blog/", "");
        expect(
          existsSync(`${APP_ROOT}/content/blog/en/${slug}.md`),
          link.href,
        ).toBe(true);
      }
    });
  }

  it("keeps the two locales structurally identical", () => {
    const shape = (locale: string) => {
      const article = getQuickWinsArticle(locale);
      return {
        example: article.example.length,
        sections: article.sections.map((s) => ({
          items: s.items?.length ?? 0,
          paragraphs: s.paragraphs?.length ?? 0,
        })),
        relatedTools: article.relatedTools.map((l) => l.href),
        relatedReading: article.relatedReading.map((l) => l.href),
      };
    };

    expect(shape("zh")).toEqual(shape("en"));
  });

  for (const locale of LOCALES) {
    it(`says nothing about drafts when this deployment cannot make one (${locale})`, () => {
      // Drafts need a model key. Production had none on the day this page
      // shipped, and the page still carried a how-to step, a feature heading
      // and an FAQ entry about them — three promises no visitor could have
      // collected on, two of them also written into structured data.
      const prose = allProse(locale, false).toLowerCase();
      for (const forbidden of ["draft", "草稿", "对照页", "comparable page"]) {
        expect(prose, forbidden).not.toContain(forbidden);
      }
    });

    it(`says all of it again once a key is configured (${locale})`, () => {
      // The gate is not a deletion. Setting the key has to bring the copy back
      // on the next render, or someone pays for a model and quietly advertises
      // nothing.
      const prose = allProse(locale, true).toLowerCase();
      expect(prose).toMatch(/draft|草稿/);
    });

    it(`drops the draft entries from the structured data too (${locale})`, () => {
      // The HowTo and FAQPage blocks are generated from this same object. Copy
      // hidden on the page but left in the schema is the version a search
      // engine quotes back.
      const off = getConnectedToolContent(locale, "seo-quick-wins", {
        draftsEnabled: false,
      });
      const on = getConnectedToolContent(locale, "seo-quick-wins");

      expect(off.steps).toHaveLength(on.steps.length - 1);
      expect(off.faq).toHaveLength(on.faq.length - 1);
      expect(off.steps.every((step) => step.requiresDrafts !== true)).toBe(
        true,
      );
      expect(off.faq.every((entry) => entry.requiresDrafts !== true)).toBe(
        true,
      );
    });
  }

  it("leaves the other connected tools alone when drafts are off", () => {
    // Only this page has copy that depends on a model key. The flag defaults
    // to on so no other caller has to know the word "draft" exists.
    const on = getConnectedToolContent("en", "traffic-drop-diagnosis");
    const off = getConnectedToolContent("en", "traffic-drop-diagnosis", {
      draftsEnabled: false,
    });

    expect(off.steps).toHaveLength(on.steps.length);
    expect(off.faq).toHaveLength(on.faq.length);
  });

  it("carries the case-study figures the evaluation actually measured", () => {
    // These are real numbers from `sc-domain:astrologywiki.com`, recomputed
    // leave-one-out so the page states the comparison the engine makes rather
    // than the raw band average. If they are ever edited for rhythm, this
    // fails and sends the editor back to the evaluation report.
    const en = getQuickWinsArticle("en");
    const comparison = en.example[1]?.body ?? "";
    expect(comparison).toContain("451 queries");
    expect(comparison).toContain("16,885 impressions");
    expect(comparison).toContain("0.51%");
    // 83 clicks over 13,446 impressions once the subject query is removed.
    expect(comparison).toContain("0.62%");
    // 3,439 x 0.0062 is about 21; 3 arrived.
    expect(comparison).toContain("21 clicks");
    expect(comparison).toContain("18 clicks");
  });
});
