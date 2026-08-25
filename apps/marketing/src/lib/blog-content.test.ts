import { access } from "node:fs/promises";
import { join } from "node:path";
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

    // What this test is for is that the two locales load separately and keep
    // stable URLs. The hero image is editorial: it has been changed twice while
    // this assertion existed, and each edit turned a green suite red without
    // anything being wrong. Assert its shape, not which picture is current.
    expect(english).toMatchObject({
      locale: "en",
      content_source: "local",
      locale_exclusive: false,
    });
    expect(chinese).toMatchObject({
      locale: "zh",
      content_source: "local",
    });
    for (const post of [english, chinese]) {
      expect(post?.hero_image).toMatch(
        /^\/images\/blog\/.+\.(jpg|png|svg|webp)$/,
      );
    }
    expect(english?.title).not.toBe(chinese?.title);
  });

  it("loads the complete migrated legacy URL set alongside authored Markdown", async () => {
    const posts = await getLocalBlogPosts();

    const urls = new Set(
      posts.map((post) => `/${post.locale}/blog/${post.slug}`),
    );
    const migratedLegacyUrls = [
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
      "/zh/blog/growth-experiment-playbook",
      "/zh/blog/marketing-attribution-models",
      "/zh/blog/programmatic-seo-at-scale",
      "/zh/blog/social-first-week-1",
      "/zh/blog/what-is-growth-automation",
      "/zh/blog/bounded-internal-link-crawl",
      "/zh/blog/public-seo-audit-boundaries",
    ];

    // 62 English posts = the 12 originally authored here, plus the 49 restored
    // from the legacy corpus the Supabase publish path never shipped, plus the
    // 2 that had no staging source, minus whitelabel-seo-tool. That one was a
    // second write-up of the same Level 1/2/3 resale framework already covered
    // by best-white-label-seo-tool, for the same queries; over 90 days Google
    // gave one page 723 impressions and the other none, so it now 301s into
    // the page that ranks. Chinese stays at 9: the backfill was English-only.
    // Keep both counts exact so an accidental content deletion or an
    // unreviewed bulk import fails this gate instead of shipping silently.
    //
    // 62 → 66 on 2026-08-07: the keyword-opportunity batch (377a4b9) added
    // four English posts — low-hanging-fruit / pagerank-sculpting /
    // striking-distance-keywords / zero-search-volume-keywords — and left this
    // count behind, so the gate fired exactly as intended. Reviewed and
    // accepted; Chinese is untouched.
    // 66 → 70 on 2026-08-13: four B2 URLs keep evidence-reviewed content,
    // three retired comparison URLs are archived behind a truthful 410, and
    // the unsupported AstrologyWiki case study is replaced by a correction on
    // the historically ranked slug.
    // 70 → 72 on 2026-08-13: main added the reviewed Ahrefs and Semrush
    // alternative comparison articles before this closeout landed.
    // 72 → 73 on 2026-08-17: dcece74e added the August algorithm-update post
    // and did not move this number with it.
    // 73 → 74 on 2026-08-18: main added another post in the GEO Agent series
    // and again did not move this number, so the count was red on main before
    // this branch merged it. Bumped here rather than left red.
    // 75 → 76 on 2026-08-20: 641107fa added the babylovegrowth alternatives
    // post, same pattern again. A count nobody updates with the content it
    // counts is red on main until the next unrelated branch notices.
    // 82 → 80 en / 9 → 8 zh on 2026-08-25: the AstrologyWiki correction is
    // retired. Rewriting the unverifiable case study into a correction left a
    // meta-article about our own publishing standard sitting in the blog feed,
    // where it read as a fault rather than a story. Both English slugs and the
    // Chinese one 301 onto programmatic-seo-at-scale. The number this line
    // replaced said 76 while main actually carried 82: six posts landed since
    // 2026-08-20 without moving it, so the gate was already red on main before
    // this branch touched it. Same pattern the notes above keep recording.
    expect(posts.filter((post) => post.locale === "en")).toHaveLength(80);
    expect(posts.filter((post) => post.locale === "zh")).toHaveLength(8);
    expect(migratedLegacyUrls.every((url) => urls.has(url))).toBe(true);
    expect(posts.every((post) => post.status === "published")).toBe(true);
    expect(urls.has("/en/blog/seo-content-clusters-draft")).toBe(false);
    expect(urls.has("/zh/blog/keyword-gap-analysis-guide-draft")).toBe(false);
    // Newest-first ordering, asserted as ordering rather than as a date.
    //
    // This used to pin the newest article's timestamp, so every published post
    // broke it — and by its own comment it had already been left behind once.
    // Comparing the head against the maximum tests the same property and
    // survives the next article.
    const newest = posts
      .map((post) => post.published_at)
      .reduce((latest, current) => (current > latest ? current : latest));
    expect(posts[0]?.published_at).toBe(newest);
    expect(posts).toEqual(
      [...posts].sort((a, b) => b.published_at.localeCompare(a.published_at)),
    );
  });

  it("publishes the evidence-reviewed English recovery articles", async () => {
    const restoredSlugs = [
      "9-best-marketing-attribution-tools-for-saas-in-2026",
      "ai-marketing-automation-for-saas",
      "best-ai-marketing-and-cmo-tools-for-saas-in-2026",
      "gengrowth-vs-improvado",
    ];

    const posts = await Promise.all(
      restoredSlugs.map((slug) => getLocalBlogPostBySlug(slug, "en")),
    );
    const marketingRoot = process.cwd().endsWith(join("apps", "marketing"))
      ? process.cwd()
      : join(process.cwd(), "apps", "marketing");

    for (const [index, post] of posts.entries()) {
      expect(post, restoredSlugs[index]).not.toBeNull();
      if (!post) continue;
      expect(post?.status, restoredSlugs[index]).toBe("published");
      expect(post?.reading_time, restoredSlugs[index]).toBeGreaterThanOrEqual(3);
      expect(post?.content, restoredSlugs[index]).toContain("<h2>");
      expect(post?.content, restoredSlugs[index]).not.toContain("Coming soon");
      const heroImage = post.hero_image;
      expect(heroImage, restoredSlugs[index]).toMatch(/^\/images\//);
      if (!heroImage) continue;
      await expect(
        access(join(marketingRoot, "public", heroImage.slice(1))),
        restoredSlugs[index],
      ).resolves.toBeUndefined();
    }
  });

  it("gives each B2 URL an explicit recovered or gone outcome", async () => {
    const recoveredSlugs = [
      "9-best-marketing-attribution-tools-for-saas-in-2026",
      "ai-marketing-automation-for-saas",
      "gengrowth-vs-improvado",
    ];
    const goneSlugs = [
      "gengrowth-vs-blaze",
      "gengrowth-vs-cometly",
      "gengrowth-vs-okara",
    ];

    const posts = await Promise.all(
      recoveredSlugs.map((slug) => getLocalBlogPostBySlug(slug, "en")),
    );

    for (const [index, post] of posts.entries()) {
      expect(post, recoveredSlugs[index]).not.toBeNull();
      if (!post) continue;

      expect(post.content, recoveredSlugs[index]).not.toContain(
        'href="https://app.gengrowth.ai',
      );
      expect(post.content, recoveredSlugs[index]).not.toContain('href="/en/');
      expect(post.content, recoveredSlugs[index]).not.toContain(
        'href="https://gengrowth.ai/en/',
      );
    }

    for (const slug of goneSlugs) {
      await expect(getLocalBlogPostBySlug(slug, "en"), slug).resolves.toBeNull();
    }
  });

  it("keeps published product CTAs on the marketing site boundary", async () => {
    const englishPosts = await getLocalBlogPosts("en");
    const combinedContent = englishPosts.map((post) => post.content).join("\n");

    expect(combinedContent).not.toContain("https://gengrowth.ai/app");
    expect(combinedContent).not.toContain("https://gengrowth.ai/en/features");
    expect(combinedContent).not.toContain("https://gengrowth.ai/en/pricing");
    expect(combinedContent).not.toContain("https://app.gengrowth.ai/");
  });

  it("does not link published articles through retired marketing routes", async () => {
    const posts = await getLocalBlogPosts();
    const combinedContent = posts.map((post) => post.content).join("\n");

    for (const retiredPath of ["/features", "/templates", "/glossary"]) {
      expect(combinedContent).not.toContain(`href="${retiredPath}"`);
    }
  });
});
