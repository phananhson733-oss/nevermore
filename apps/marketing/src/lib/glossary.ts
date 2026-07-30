// @input  -- Supabase client, locale, category filter, slug
// @output -- glossary terms data for pages
// @pos    -- data layer for glossary pages, mirrors blog.ts pattern
// once this file is updated, update header comments and _DIR.md in this folder

import { getSupabase } from "@/lib/supabase";
import { MOCK_GLOSSARY_TERMS } from "@/lib/mock/glossary-data";

export interface GlossaryTerm {
  id: string;
  slug: string;
  locale: string;
  term: string;
  definition: string;
  body: string;
  category: "metrics" | "strategy" | "technical" | "methodology";
  related_terms: string[];
  related_feature: string | null;
  seo_title: string | null;
  status: "draft" | "published";
  created_at: string;
  updated_at: string;
}

/**
 * Fetch all published glossary terms for a locale, optionally filtered by category.
 * Results are sorted alphabetically by term.
 */
export async function getGlossaryTerms(
  locale: string,
  category?: string,
): Promise<GlossaryTerm[]> {
  const supabase = getSupabase();
  let query = supabase
    .from("glossary_terms")
    .select("*")
    .eq("status", "published")
    .eq("locale", locale);

  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query.order("term", { ascending: true });

  if (!error && data && data.length > 0) {
    return data as GlossaryTerm[];
  }

  // Fall back to mock data when Supabase returns empty or errors
  let mockResult = MOCK_GLOSSARY_TERMS.filter(
    (t) => t.status === "published" && t.locale === locale,
  );
  if (category) {
    mockResult = mockResult.filter((t) => t.category === category);
  }
  return mockResult.sort((a, b) => a.term.localeCompare(b.term));
}

/**
 * Fetch a single glossary term by slug and locale.
 * Returns null if not found or on error.
 */
export async function getGlossaryTermBySlug(
  slug: string,
  locale: string,
): Promise<GlossaryTerm | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("glossary_terms")
    .select("*")
    .eq("slug", slug)
    .eq("locale", locale)
    .eq("status", "published")
    .single();

  if (!error && data) {
    return data as GlossaryTerm;
  }

  // Fall back to mock data when Supabase returns empty or errors
  return (
    MOCK_GLOSSARY_TERMS.find(
      (t) => t.slug === slug && t.locale === locale && t.status === "published",
    ) ?? null
  );
}

/**
 * Fetch multiple glossary terms by their slugs, for "Related Terms" sections.
 */
export async function getRelatedTerms(
  slugs: string[],
  locale: string,
): Promise<GlossaryTerm[]> {
  if (slugs.length === 0) {
    return [];
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("glossary_terms")
    .select("*")
    .in("slug", slugs)
    .eq("locale", locale)
    .eq("status", "published")
    .order("term", { ascending: true });

  if (!error && data && data.length > 0) {
    return data as GlossaryTerm[];
  }

  // Fall back to mock data when Supabase returns empty or errors
  return MOCK_GLOSSARY_TERMS.filter(
    (t) =>
      slugs.includes(t.slug) && t.locale === locale && t.status === "published",
  ).sort((a, b) => a.term.localeCompare(b.term));
}
