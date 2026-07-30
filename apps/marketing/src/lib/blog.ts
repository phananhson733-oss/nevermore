// @input  — local Markdown content, optional read-only legacy Supabase blog_posts
// @output — one blog query surface for pages, RSS and sitemap
// @pos    — local content is canonical; Supabase is a removable migration bridge
import { getSupabase } from "@/lib/supabase";
import {
  getLocalBlogPostBySlug,
  getLocalBlogPosts,
} from "@/lib/blog-content";
import type { BlogPost } from "@/types/blog";

const POSTS_PER_PAGE = 12;

/** Valid URL slugs for blog categories (hyphenated for URLs). */
const VALID_CATEGORY_SLUGS = [
  "case-study",
  "methodology",
  "weekly-review",
  "experiment-log",
] as const;

export type CategorySlug = (typeof VALID_CATEGORY_SLUGS)[number];

const VALID_PILLARS = [
  "growth_automation",
  "experiment_driven",
  "attribution",
  "seo_content",
  "customer_stories",
] as const;

function categorySlugToDb(slug: string): string {
  return slug.replace(/-/g, "_");
}

export function isValidCategorySlug(slug: string): slug is CategorySlug {
  return (VALID_CATEGORY_SLUGS as readonly string[]).includes(slug);
}

function isLegacySupabaseEnabled(): boolean {
  if (process.env.BLOG_LEGACY_SUPABASE_ENABLED === "false") return false;
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function toLegacyPost(post: BlogPost): BlogPost {
  return { ...post, content_source: "legacy_supabase" };
}

async function getLegacyPosts(locale?: string): Promise<readonly BlogPost[]> {
  if (!isLegacySupabaseEnabled()) return [];

  try {
    const supabase = getSupabase();
    let query = supabase
      .from("blog_posts")
      .select("*")
      .eq("status", "published")
      .order("published_at", { ascending: false });

    if (locale) query = query.eq("locale", locale);

    const { data, error } = await query;
    if (error) {
      console.error("[blog] legacy Supabase list failed:", error.message);
      return [];
    }

    return (data as BlogPost[] | null)?.map(toLegacyPost) ?? [];
  } catch (error) {
    console.error("[blog] legacy Supabase list failed:", error);
    return [];
  }
}

async function getLegacyPostBySlug(
  slug: string,
  locale?: string,
): Promise<BlogPost | null> {
  if (!isLegacySupabaseEnabled()) return null;

  try {
    const supabase = getSupabase();
    let query = supabase
      .from("blog_posts")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published");

    if (locale) query = query.eq("locale", locale);

    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error("[blog] legacy Supabase detail failed:", error.message);
      return null;
    }

    return data ? toLegacyPost(data as BlogPost) : null;
  } catch (error) {
    console.error("[blog] legacy Supabase detail failed:", error);
    return null;
  }
}

function mergePosts(
  localPosts: readonly BlogPost[],
  legacyPosts: readonly BlogPost[],
): BlogPost[] {
  const merged = new Map<string, BlogPost>();
  for (const post of legacyPosts) merged.set(`${post.locale}:${post.slug}`, post);
  // A local Markdown article always replaces the legacy record with the same
  // public URL. This makes migrations atomic at deployment time.
  for (const post of localPosts) merged.set(`${post.locale}:${post.slug}`, post);

  return [...merged.values()].sort(
    (left, right) =>
      new Date(right.published_at).getTime() -
      new Date(left.published_at).getTime(),
  );
}

export async function getAllBlogPosts({
  locale,
  category,
  pillar,
}: {
  locale?: string;
  category?: string;
  pillar?: string;
} = {}): Promise<BlogPost[]> {
  const [localPosts, legacyPosts] = await Promise.all([
    getLocalBlogPosts(locale),
    getLegacyPosts(locale),
  ]);

  return mergePosts(localPosts, legacyPosts).filter(
    (post) =>
      (!category || post.category === category) &&
      (!pillar || post.pillar_slug === pillar),
  );
}

export async function getBlogPosts({
  locale,
  page = 1,
  category,
  pillar,
}: {
  locale: string;
  page?: number;
  category?: string;
  pillar?: string;
}): Promise<{ posts: BlogPost[]; total: number }> {
  const validPillar =
    pillar && (VALID_PILLARS as readonly string[]).includes(pillar)
      ? pillar
      : undefined;
  const posts = await getAllBlogPosts({ locale, category, pillar: validPillar });
  const start = (Math.max(1, page) - 1) * POSTS_PER_PAGE;

  return {
    posts: posts.slice(start, start + POSTS_PER_PAGE),
    total: posts.length,
  };
}

export async function getBlogPostBySlug(
  slug: string,
  locale?: string,
): Promise<BlogPost | null> {
  if (locale) {
    const localPost = await getLocalBlogPostBySlug(slug, locale);
    if (localPost) return localPost;
  } else {
    const localPost = (await getLocalBlogPosts()).find(
      (post) => post.slug === slug,
    );
    if (localPost) return localPost;
  }

  // No mock fallback: a database outage must not make a genuine canonical URL
  // display unrelated development copy. A missing/failed legacy lookup is 404.
  return getLegacyPostBySlug(slug, locale);
}

export function getTotalPages(total: number): number {
  return Math.ceil(total / POSTS_PER_PAGE);
}

export async function getBlogPostsByCategory(
  category: string,
  locale: string,
): Promise<BlogPost[]> {
  return getAllBlogPosts({
    locale,
    category: categorySlugToDb(category),
  });
}
