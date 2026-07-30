// @input  — locale and legacy category slug
// @output — permanent redirect from legacy category URLs to the canonical Blog list filter
// @pos    — legacy URL compatibility; topic selection lives on /blog
// once this file is updated, update header comments and _DIR.md in this folder
import { notFound, permanentRedirect } from "next/navigation";
import { isValidCategorySlug } from "@/lib/blog";

type PageParams = { locale: string; slug: string };

export default async function BlogCategoryPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;

  if (!isValidCategorySlug(slug)) {
    notFound();
  }

  const category = slug.replace(/-/g, "_");
  permanentRedirect(`/${locale}/blog?category=${category}`);
}
