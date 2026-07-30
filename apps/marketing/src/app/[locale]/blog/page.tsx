// @input  — next-intl, blog data functions, BlogCard, generatePageMetadata, BreadcrumbJsonLd
// @output — 博客列表页（分页 + 分类筛选 + SEO metadata + BreadcrumbList JSON-LD）
// @pos    — 营销官网博客列表，对应 SPEC 2.7.3
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { getTranslations } from "next-intl/server";
import { getBlogPosts, getTotalPages } from "@/lib/blog";
import { BlogCard } from "@/components/blog/blog-card";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import Link from "next/link";

const CATEGORIES = [
  "case_study",
  "methodology",
  "weekly_review",
  "experiment_log",
] as const;

const PILLARS = [
  "growth_automation",
  "experiment_driven",
  "attribution",
  "seo_content",
  "customer_stories",
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title: locale === "en" ? "Blog — GenGrowth" : "博客 — GenGrowth",
    description:
      locale === "en"
        ? "Case studies, methodology, weekly reviews, and experiment logs from the GenGrowth team."
        : "来自 GenGrowth 团队的案例研究、方法论、周报和实验日志。",
    locale,
    path: "/blog",
  });
}

export default async function BlogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; category?: string; pillar?: string }>;
}) {
  const { locale } = await params;
  const { page: pageParam, category, pillar } = await searchParams;
  const page = Math.max(1, parseInt(pageParam || "1", 10));
  const t = await getTranslations({ locale, namespace: "blog" });

  const validCategory = CATEGORIES.includes(
    category as (typeof CATEGORIES)[number],
  )
    ? category
    : undefined;
  const validPillar = PILLARS.includes(pillar as (typeof PILLARS)[number])
    ? pillar
    : undefined;
  const { posts, total } = await getBlogPosts({
    locale,
    page,
    category: validCategory,
    pillar: validPillar,
  });
  const totalPages = getTotalPages(total);

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">
        <BreadcrumbJsonLd
          items={[
            {
              name: locale === "en" ? "Home" : "首页",
              url: `${siteConfig.url}/${locale}`,
            },
            { name: locale === "en" ? "Blog" : "博客" },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: locale === "en" ? "Home" : "首页", href: `/${locale}` },
            { label: locale === "en" ? "Blog" : "博客" },
          ]}
        />

        {/* Page header */}
        <div className="mb-12">
          <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
            {t("title")}
          </h1>
          <p className="text-text-dark-secondary text-[15px]">
            {locale === "en"
              ? "Insights, case studies, and experiment logs from our growth journey."
              : "来自我们增长之旅的洞察、案例和实验日志。"}
          </p>
        </div>

        {/* Category filter tabs */}
        <div className="flex flex-wrap gap-2 mb-4 border-b border-brand-border/40 pb-4">
          <Link
            href={`/${locale}/blog${validPillar ? `?pillar=${validPillar}` : ""}`}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              !validCategory
                ? "bg-brand-accent text-white"
                : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
            }`}
          >
            {locale === "en" ? "All" : "全部"}
          </Link>
          {CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={`/${locale}/blog?category=${cat}${validPillar ? `&pillar=${validPillar}` : ""}`}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                validCategory === cat
                  ? "bg-brand-accent text-white"
                  : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
              }`}
            >
              {t(`categories.${cat}`)}
            </Link>
          ))}
        </div>

        {/* Pillar filter tabs */}
        <div className="flex flex-wrap gap-2 mb-10">
          <Link
            href={`/${locale}/blog${validCategory ? `?category=${validCategory}` : ""}`}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              !validPillar
                ? "bg-brand-accent/20 text-brand-accent border border-brand-accent/40"
                : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
            }`}
          >
            {t("pillars.all")}
          </Link>
          {PILLARS.map((p) => (
            <Link
              key={p}
              href={`/${locale}/blog?${validCategory ? `category=${validCategory}&` : ""}pillar=${p}`}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                validPillar === p
                  ? "bg-brand-accent/20 text-brand-accent border border-brand-accent/40"
                  : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
              }`}
            >
              {t(`pillars.${p}`)}
            </Link>
          ))}
        </div>

        {posts.length === 0 ? (
          <p className="text-text-dark-secondary text-[15px] py-16 text-center">
            {t("noPosts")}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-14">
              {posts.map((post) => (
                <BlogCard key={post.id} post={post} />
              ))}
            </div>

            {totalPages > 1 && (
              <nav className="flex justify-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (p) => (
                    <Link
                      key={p}
                      href={
                        p === 1
                          ? `/${locale}/blog${validCategory ? `?category=${validCategory}` : ""}${validPillar ? `${validCategory ? "&" : "?"}pillar=${validPillar}` : ""}`
                          : `/${locale}/blog?page=${p}${validCategory ? `&category=${validCategory}` : ""}${validPillar ? `&pillar=${validPillar}` : ""}`
                      }
                      className={`w-8 h-8 flex items-center justify-center rounded-full text-[13px] font-medium transition-colors ${
                        p === page
                          ? "bg-brand-accent text-white"
                          : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
                      }`}
                    >
                      {p}
                    </Link>
                  ),
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
