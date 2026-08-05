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
  const requestedCategory = BLOG_CATEGORIES.find(
    (candidate) => candidate === category,
  );
  const requestedPillar = BLOG_PILLARS.find(
    (candidate) => candidate === pillar,
  );

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

  const invalidCategory =
    category !== undefined &&
    (!requestedCategory || !availableCategories.includes(requestedCategory));
  const invalidPillar =
    pillar !== undefined &&
    (!requestedPillar || !availablePillars.includes(requestedPillar));

  return {
    availableCategories,
    availablePillars,
    invalid: invalidCategory || invalidPillar,
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

export type BlogPageParamResult =
  | { readonly ok: true; readonly page: number }
  | { readonly ok: false };

/**
 * A present `page` parameter is a public URL claim, not a forgiving form
 * field. Reject malformed, zero, negative, padded, fractional, and unsafe
 * values so they cannot create alternate 200 URLs for page one.
 */
export function parseBlogPageParam(
  raw: string | undefined,
): BlogPageParamResult {
  if (raw === undefined) return { ok: true, page: 1 };
  if (!/^[1-9]\d*$/.test(raw)) return { ok: false };
  const page = Number(raw);
  return Number.isSafeInteger(page) ? { ok: true, page } : { ok: false };
}
