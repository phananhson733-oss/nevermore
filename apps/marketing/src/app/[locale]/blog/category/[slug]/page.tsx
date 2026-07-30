// @input  — next-intl, blog data, BlogCard, generatePageMetadata, BreadcrumbJsonLd, VisibleBreadcrumb
// @output — Blog category aggregation page (filtered posts + SEO metadata + BreadcrumbList JSON-LD)
// @pos    — Blog category page route, SPEC 2.7.3
// once this file is updated, update header comments and _DIR.md in this folder
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getBlogPostsByCategory, isValidCategorySlug } from "@/lib/blog";
import { BlogCard } from "@/components/blog/blog-card";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";

type PageParams = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;

  if (!isValidCategorySlug(slug)) {
    return {};
  }

  const t = await getTranslations({ locale, namespace: "blog" });
  const categoryTitle = t(`categoryPages.${slug}.title`);
  const categoryDescription = t(`categoryPages.${slug}.description`);

  return generatePageMetadata({
    title:
      locale === "en"
        ? `${categoryTitle} -- Blog -- GenGrowth`
        : `${categoryTitle} -- 博客 -- GenGrowth`,
    description: categoryDescription,
    locale,
    path: `/blog/category/${slug}`,
  });
}

export default async function BlogCategoryPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;

  if (!isValidCategorySlug(slug)) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "blog" });
  const categoryTitle = t(`categoryPages.${slug}.title`);
  const categoryDescription = t(`categoryPages.${slug}.description`);

  const posts = await getBlogPostsByCategory(slug, locale);

  const homeLabel = locale === "en" ? "Home" : "首页";
  const blogLabel = locale === "en" ? "Blog" : "博客";

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">
        <BreadcrumbJsonLd
          items={[
            {
              name: homeLabel,
              url: `${siteConfig.url}/${locale}`,
            },
            {
              name: blogLabel,
              url: `${siteConfig.url}/${locale}/blog`,
            },
            { name: categoryTitle },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: homeLabel, href: `/${locale}` },
            { label: blogLabel, href: `/${locale}/blog` },
            { label: categoryTitle },
          ]}
        />

        {/* Page header */}
        <div className="mb-12">
          <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
            {categoryTitle}
          </h1>
          <p className="text-text-dark-secondary text-[15px]">
            {categoryDescription}
          </p>
        </div>

        {posts.length === 0 ? (
          <p className="text-text-dark-secondary text-[15px] py-16 text-center">
            {t("noPosts")}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {posts.map((post) => (
              <BlogCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
