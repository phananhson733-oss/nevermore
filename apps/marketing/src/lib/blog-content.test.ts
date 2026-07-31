import { describe, expect, it } from "vitest";
import {
  getLocalBlogPostBySlug,
  getLocalBlogPosts,
  parseBlogMarkdown,
  renderBlogMarkdown,
} from "./blog-content";

const validArticle = `---
title: A valid article
excerpt: A useful summary.
author: GenGrowth Team
category: methodology
pillar: experiment_driven
status: published
publishedAt: 2026-07-30
heroImage: /images/blog/example/hero.webp
heroImageAlt: A descriptive hero image.
---

## A safe heading

| Name | Value |
| --- | --- |
| One | Two |

![A diagram](/images/blog/example/diagram.svg)
`;

describe("repository-backed blog content", () => {
  it("parses strict, scalar frontmatter and preserves Markdown body", () => {
    const parsed = parseBlogMarkdown(validArticle, "en/example.md");

    expect(parsed.frontmatter.category).toBe("methodology");
    expect(parsed.frontmatter.pillar).toBe("experiment_driven");
    expect(parsed.body).toContain("## A safe heading");
  });

  it("rejects unknown frontmatter instead of publishing a malformed article", () => {
    expect(() =>
      parseBlogMarkdown(
        validArticle.replace(
          "status: published",
          "status: published\nunknown: nope",
        ),
        "en/example.md",
      ),
    ).toThrow("invalid frontmatter");
  });

  it("rejects impossible dates and protocol-relative image URLs", () => {
    expect(() =>
      parseBlogMarkdown(
        validArticle
          .replace("publishedAt: 2026-07-30", "publishedAt: 2026-02-30")
          .replace(
            "/images/blog/example/hero.webp",
            "//untrusted.example/hero.webp",
          ),
        "en/example.md",
      ),
    ).toThrow("invalid frontmatter");
  });

  it("sanitizes raw HTML and unsafe links while retaining approved Markdown output", () => {
    const html = renderBlogMarkdown(
      "[unsafe](javascript:alert(1))\n\n<script>alert(1)</script>\n\n![safe](/images/blog/example.svg)",
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("script");
    expect(html).toContain('<img src="/images/blog/example.svg" alt="safe" />');
  });

  it("loads separately published English and Chinese articles with stable URLs", async () => {
    const [english, chinese] = await Promise.all([
      getLocalBlogPostBySlug("evidence-first-growth-experiments", "en"),
      getLocalBlogPostBySlug("evidence-first-growth-experiments", "zh"),
    ]);

    // The two locales carry their own hero image, which is the point of them
    // being separately published rather than one translated pair. Asserting a
    // shared image made the test fail the moment the English article got its
    // own — a change the test exists to allow, not to catch.
    expect(english).toMatchObject({
      locale: "en",
      content_source: "local",
      hero_image: "/images/blog/evidence-first-growth-experiments.jpg",
      locale_exclusive: false,
    });
    expect(chinese).toMatchObject({
      locale: "zh",
      content_source: "local",
      hero_image: "/images/blog/best-ai-seo-tools.jpg",
    });
    expect(english?.title).not.toBe(chinese?.title);
  });

  it("loads the complete migrated legacy URL set alongside authored Markdown", async () => {
    const posts = await getLocalBlogPosts();

    const urls = new Set(
      posts.map((post) => `/${post.locale}/blog/${post.slug}`),
    );
    const migratedLegacyUrls = [
      "/en/blog/astrologywiki-case-study",
      "/en/blog/growth-experiment-playbook",
      "/en/blog/marketing-attribution-models",
      "/en/blog/organic-traffic-growth-case-study",
      "/en/blog/programmatic-seo-at-scale",
      "/en/blog/social-first-probe-week-1",
      "/en/blog/social-first-week-1",
      "/en/blog/what-is-growth-automation",
      "/en/blog/white-label-keyword-research",
      "/en/blog/bounded-internal-link-crawl",
      "/en/blog/public-seo-audit-boundaries",
      "/zh/blog/astrologywiki-case-study",
      "/zh/blog/growth-experiment-playbook",
      "/zh/blog/marketing-attribution-models",
      "/zh/blog/programmatic-seo-at-scale",
      "/zh/blog/social-first-week-1",
      "/zh/blog/what-is-growth-automation",
      "/zh/blog/bounded-internal-link-crawl",
      "/zh/blog/public-seo-audit-boundaries",
    ];

    // 63 English posts = the 12 originally authored here, plus the 49 restored
    // from the legacy corpus the Supabase publish path never shipped, plus the
    // 2 that had no staging source. Chinese stays at 9: the backfill was
    // English-only. Keep both counts exact so an accidental content deletion or
    // an unreviewed bulk import fails this gate instead of shipping silently.
    expect(posts.filter((post) => post.locale === "en")).toHaveLength(63);
    expect(posts.filter((post) => post.locale === "zh")).toHaveLength(9);
    expect(migratedLegacyUrls.every((url) => urls.has(url))).toBe(true);
    expect(posts.every((post) => post.status === "published")).toBe(true);
    expect(urls.has("/en/blog/seo-content-clusters-draft")).toBe(false);
    expect(urls.has("/zh/blog/keyword-gap-analysis-guide-draft")).toBe(false);
    // Newest-first ordering: the most recent backfilled article dates to 07-31.
    expect(posts[0]?.published_at).toBe("2026-07-31T00:00:00.000Z");
  });
});
