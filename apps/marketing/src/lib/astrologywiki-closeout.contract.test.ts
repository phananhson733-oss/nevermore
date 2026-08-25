import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getMarketingRedirects } from "../../next.config";

const MARKETING_ROOT = join(process.cwd(), "apps", "marketing");
const BLOG_ROOT = join(MARKETING_ROOT, "content", "blog");

const RETIRED_ARTICLES = [
  ["en", "astrologywiki-case-study"],
  ["zh", "astrologywiki-case-study"],
  ["en", "astrologywiki-zero-to-5000-users"],
] as const;

// The AstrologyWiki case study claimed user, timeline, revenue, and authority
// numbers this repository cannot verify. The first repair rewrote it into an
// evidence-boundary correction on the same slugs, which fixed the false claims
// but published a meta-article about our own standards into the blog feed —
// readers hit a page explaining what we cannot prove instead of a story, which
// reads as a publishing fault. The claims stay retracted; the correction is now
// retired behind a 301 rather than kept as reader-facing content.
describe("AstrologyWiki closeout contract", () => {
  it.each(RETIRED_ARTICLES)(
    "keeps the %s/%s article retired",
    (locale, slug) => {
      expect(existsSync(join(BLOG_ROOT, locale, `${slug}.md`))).toBe(false);
    },
  );

  it.each([
    "/blog/astrologywiki-case-study",
    "/en/blog/astrologywiki-case-study",
    "/blog/astrologywiki-zero-to-5000-users",
    "/en/blog/astrologywiki-zero-to-5000-users",
  ])("301s %s onto the page-production guide", (source) => {
    expect(getMarketingRedirects()).toContainEqual({
      source,
      destination: "/blog/programmatic-seo-at-scale",
      statusCode: 301,
    });
  });

  // /zh/blog is a real route, so the Chinese URL cannot fold onto the
  // default-locale destination the way the /blog and /en/blog slugs do.
  it("301s the Chinese URL to its own locale", () => {
    expect(getMarketingRedirects()).toContainEqual({
      source: "/zh/blog/astrologywiki-case-study",
      destination: "/zh/blog/programmatic-seo-at-scale",
      statusCode: 301,
    });
  });

  it("leaves no published article citing the retired slugs", async () => {
    const { getLocalBlogPosts } = await import("./blog-content");
    const posts = await getLocalBlogPosts();

    for (const post of posts) {
      expect(post.content, `${post.locale}/${post.slug}`).not.toContain(
        "/blog/astrologywiki-",
      );
    }
  });
});
