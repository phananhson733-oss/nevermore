// @input  -- BlogPost array, current article context, locale
// @output -- Related Articles section with matched posts
// @pos    -- blog article footer, enhances internal linking and engagement
// once this file is updated, update header comments and _DIR.md in this folder
import Link from "next/link";
import type { BlogPost } from "@/types/blog";
import { localePath } from "@/lib/locale-path";

/**
 * Score each post relative to the current article context.
 * Same pillar_slug: +2 points
 * Same category:    +1 point
 */
function scorePost(
  post: BlogPost,
  currentPillar: string | null,
  currentCategory: string,
): number {
  let score = 0;
  if (currentPillar !== null && post.pillar_slug === currentPillar) {
    score += 2;
  }
  if (post.category === currentCategory) {
    score += 1;
  }
  return score;
}

/**
 * Pure function: returns up to 3 related posts scored by pillar and category
 * similarity, excluding the current article.
 *
 * Prioritization:
 * - Posts sharing the same pillar_slug (+2) are shown first.
 * - Posts with no pillar set (undefined) are kept as category-only candidates.
 * - When pillar matches exist, posts with an explicit DIFFERENT pillar are excluded.
 * - When no pillar matches exist, all positive-score posts are included.
 */
export function getRelatedArticles(
  currentSlug: string,
  currentPillar: string | null,
  currentCategory: string,
  allPosts: BlogPost[],
): BlogPost[] {
  const seen = new Set<string>();

  const candidates = allPosts
    .filter((post) => {
      if (post.slug === currentSlug) return false;
      if (seen.has(post.slug)) return false;
      seen.add(post.slug);
      return true;
    })
    .map((post) => ({
      post,
      score: scorePost(post, currentPillar, currentCategory),
    }))
    .filter(({ score }) => score > 0);

  const hasPillarMatch = candidates.some(({ score }) => score >= 2);

  const filtered = hasPillarMatch
    ? candidates.filter(
        ({ post, score }) =>
          score >= 2 ||
          post.pillar_slug === undefined ||
          post.pillar_slug === null,
      )
    : candidates;

  return filtered
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ post }) => post);
}

interface RelatedArticlesProps {
  readonly posts: ReadonlyArray<BlogPost>;
  readonly locale: string;
}

export function RelatedArticles({ posts, locale }: RelatedArticlesProps) {
  if (posts.length === 0) return null;

  const title = locale === "zh" ? "相关文章" : "Related Articles";

  return (
    <section aria-labelledby="related-articles-heading" className="mt-16">
      <div className="border-t border-brand-border pt-10">
        <h2
          id="related-articles-heading"
          className="mb-6 text-[16.5px] font-semibold text-text-dark-primary"
        >
          {title}
        </h2>

        <ul className="space-y-3">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link
                href={localePath(locale, `/blog/${post.slug}`)}
                className="group flex flex-col gap-1.5 rounded-card border border-brand-border-card bg-brand-panel p-[18px] transition-colors hover:border-brand-accent/40"
              >
                <span className="font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
                  {post.category.replace(/_/g, " ")}
                </span>
                <span className="line-clamp-2 text-[14.5px] leading-snug font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
                  {post.title}
                </span>
                {post.excerpt && (
                  <span className="line-clamp-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                    {post.excerpt}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
