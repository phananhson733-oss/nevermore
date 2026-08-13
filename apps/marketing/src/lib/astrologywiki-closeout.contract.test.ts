import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getMarketingRedirects } from "../../next.config";

const MARKETING_ROOT = join(process.cwd(), "apps", "marketing");
const BLOG_ROOT = join(MARKETING_ROOT, "content", "blog");

function readArticle(locale: "en" | "zh", slug: string): string {
  return readFileSync(join(BLOG_ROOT, locale, `${slug}.md`), "utf8");
}

describe("AstrologyWiki closeout contract", () => {
  it("restores the legacy English slug as a real article instead of redirecting it away", () => {
    const redirects = getMarketingRedirects();

    expect(
      existsSync(
        join(BLOG_ROOT, "en", "astrologywiki-zero-to-5000-users.md"),
      ),
    ).toBe(true);

    expect(redirects).toContainEqual({
      source: "/blog/astrologywiki-case-study",
      destination: "/blog/astrologywiki-zero-to-5000-users",
      statusCode: 301,
    });

    expect(redirects).not.toContainEqual({
      source: "/blog/astrologywiki-zero-to-5000-users",
      destination: "/blog/astrologywiki-case-study",
      statusCode: 301,
    });
  });

  it("removes unverifiable 5,000-user growth claims from the current English and Chinese case-study URLs", () => {
    const enCaseStudy = readArticle("en", "astrologywiki-case-study");
    const zhCaseStudy = readArticle("zh", "astrologywiki-case-study");

    for (const article of [enCaseStudy, zhCaseStudy]) {
      expect(article).not.toMatch(/5,000|5247|14 weeks|90 days|12,400|DR 18/u);
      expect(article).not.toMatch(
        /real numbers|真实数据|自动化归因|automated attribution|indexed pages, 847 ranking keywords/u,
      );
    }
  });

  it("retains only evidence-bounded public-audit facts in the restored English correction article", () => {
    const restored = readArticle("en", "astrologywiki-zero-to-5000-users");

    expect(restored).toMatch(/630/);
    expect(restored).toMatch(/static pages/);
    expect(restored).not.toMatch(/indexed pages/u);
    expect(restored).toMatch(/cannot verify|not verified|cannot prove/u);
  });

  it("updates the English internal links to cite the restored correction article", () => {
    const growthAutomation = readArticle("en", "what-is-growth-automation");
    const programmaticSeo = readArticle("en", "programmatic-seo-at-scale");

    for (const article of [growthAutomation, programmaticSeo]) {
      expect(article).toContain("/blog/astrologywiki-zero-to-5000-users");
      expect(article).not.toContain("/blog/astrologywiki-case-study");
    }
  });
});
