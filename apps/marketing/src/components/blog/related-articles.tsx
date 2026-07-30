// @input  -- BlogPost array, current article context, locale
// @output -- Related Articles section with matched posts
// @pos    -- blog article footer, enhances internal linking and engagement
// once this file is updated, update header comments and _DIR.md in this folder
import Link from "next/link";
import type { BlogPost } from "@/types/blog";

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
      <div className="border-t border-brand-border/50 pt-10">
        <h2
          id="related-articles-heading"
          className="text-text-dark-primary text-[18px] font-semibold mb-6"
        >
          {title}
        </h2>

        <ul className="space-y-4">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link
                href={`/${locale}/blog/${post.slug}`}
                className="group flex flex-col gap-1 rounded-lg border border-brand-border/40 bg-brand-bg-alt/20 p-4 transition-all hover:border-brand-accent/40 hover:bg-brand-bg-alt/40"
              >
                <span className="text-brand-accent-text text-[11px] font-medium tracking-wider uppercase">
                  {post.category.replace(/_/g, " ")}
                </span>
                <span className="text-text-dark-primary text-[15px] font-medium leading-snug line-clamp-2 group-hover:text-brand-accent-text transition-colors">
                  {post.title}
                </span>
                {post.excerpt && (
                  <span className="text-text-dark-secondary text-[13px] leading-relaxed line-clamp-2">
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
