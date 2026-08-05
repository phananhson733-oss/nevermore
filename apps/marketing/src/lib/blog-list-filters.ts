// @input  — published BlogPost inventory and raw category/pillar query params
// @output — validated filters plus the currently available filter options
// @pos    — shared blog-list query normalization for metadata and page rendering
// Once this file is updated, update the header comment and folder _DIR.md.

import type { BlogPost } from "../types/blog";

export const BLOG_CATEGORIES = [
  "case_study",
  "methodology",
  "weekly_review",
  "experiment_log",
] as const;

export const BLOG_PILLARS = [
  "growth_automation",
  "experiment_driven",
  "attribution",
  "seo_content",
  "customer_stories",
] as const;

export function resolveBlogListFilters(
  posts: readonly BlogPost[],
  category: string | undefined,
  pillar: string | undefined,
) {
  const requestedCategory = BLOG_CATEGORIES.includes(
    category as (typeof BLOG_CATEGORIES)[number],
  )
    ? category
    : undefined;
  const requestedPillar = BLOG_PILLARS.includes(
    pillar as (typeof BLOG_PILLARS)[number],
  )
    ? pillar
    : undefined;

  const availableCategories = BLOG_CATEGORIES.filter((candidate) =>
    posts.some(
      (post) =>
        post.category === candidate &&
        (!requestedPillar || post.pillar_slug === requestedPillar),
    ),
  );
  const availablePillars = BLOG_PILLARS.filter((candidate) =>
    posts.some(
      (post) =>
        post.pillar_slug === candidate &&
        (!requestedCategory || post.category === requestedCategory),
    ),
  );

  return {
    availableCategories,
    availablePillars,
    validCategory: availableCategories.includes(
      requestedCategory as (typeof BLOG_CATEGORIES)[number],
    )
      ? requestedCategory
      : undefined,
    validPillar: availablePillars.includes(
      requestedPillar as (typeof BLOG_PILLARS)[number],
    )
      ? requestedPillar
      : undefined,
  };
}
