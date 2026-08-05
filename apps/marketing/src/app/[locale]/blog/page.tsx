// @input  — next-intl, blog data functions, BlogCard, generatePageMetadata, BreadcrumbJsonLd
// @output — 博客列表页（话题筛选 + 工具续接 + SEO metadata + BreadcrumbList JSON-LD）
// @pos    — 营销官网内容获客入口
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { getAllBlogPosts, getBlogPosts, getTotalPages } from "@/lib/blog";
import { BlogCard } from "@/components/blog/blog-card";
import { generatePageMetadata } from "@/lib/seo";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import Link from "next/link";
import { COMPARISON_SLUGS } from "@/lib/mock/compare-content";
import { localePath, localeUrl } from "@/lib/locale-path";
import {
  parseBlogPageParam,
  resolveBlogListFilters,
} from "@/lib/blog-list-filters";

const COMPARISON_QUESTION_KEYS = {
  "manual-growth": "manualGrowth",
  "okara-ai-cmo": "okaraAiCmo",
  babylovegrowth: "babylovegrowth",
  ahrefs: "ahrefs",
} as const;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; category?: string; pillar?: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const { page: pageParam, category, pillar } = await searchParams;
  const parsedPage = parseBlogPageParam(pageParam);
  if (!parsedPage.ok) notFound();
  const page = parsedPage.page;
  const allPublishedPosts = await getAllBlogPosts({ locale });
  const { invalid, validCategory, validPillar } = resolveBlogListFilters(
    allPublishedPosts,
    category,
    pillar,
  );
  if (invalid) notFound();
  // Paginated listings must self-canonicalise. Pointing page 2+ back at /blog
  // told Google they were duplicates of the first page, so the 51 posts that
  // only appear on deeper pages lost their listing-side discovery path.
  // Filtered views stay canonicalised to /blog: they are slices of the same
  // set, and we do not want every category × page combination indexed.
  const isFiltered = Boolean(validCategory) || Boolean(validPillar);
  const path = page > 1 && !isFiltered ? `/blog?page=${page}` : "/blog";
  const pageSuffix =
    page > 1 && !isFiltered
      ? locale === "en"
        ? ` — Page ${page}`
        : ` — 第 ${page} 页`
      : "";
  return generatePageMetadata({
    title: (locale === "en" ? "Blog" : "博客") + pageSuffix,
    description:
      locale === "en"
        ? "Evidence-led SEO methods, public-tool guides, and practical decision frameworks from the GenGrowth team."
        : "来自 GenGrowth 团队的证据优先 SEO 方法、公开工具指南与可执行决策框架。",
    locale,
    path,
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
  const parsedPage = parseBlogPageParam(pageParam);
  if (!parsedPage.ok) notFound();
  const page = parsedPage.page;
  const t = await getTranslations({ locale, namespace: "blog" });
  const messages = await getMessages();
  const allPublishedPosts = await getAllBlogPosts({ locale });

  // Metadata and rendering intentionally share this normalization. Otherwise
  // a stale filter could render the normal page 3 while canonicalizing to page
  // 1 as though it were still a filtered view.
  const {
    availableCategories,
    availablePillars,
    invalid,
    validCategory,
    validPillar,
  } = resolveBlogListFilters(allPublishedPosts, category, pillar);
  if (invalid) notFound();
  const { posts, total } = await getBlogPosts({
    locale,
    page,
    category: validCategory,
    pillar: validPillar,
  });
  const totalPages = getTotalPages(total);
  // Out-of-range pages used to render as a 200 with an empty list, so every
  // `?page=<any number>` minted another indexable soft 404. Page one stays
  // reachable — an empty result there has a real empty state to show.
  if (page > 1 && page > totalPages) {
    notFound();
  }
  const comparisons = await Promise.all(
    COMPARISON_SLUGS.map(async (slug) => {
      const comparison = await getTranslations({
        locale,
        namespace: `compare.${slug}`,
      });

      return {
        slug,
        competitor: comparison("competitor"),
        questionKey: COMPARISON_QUESTION_KEYS[slug],
      };
    }),
  );

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">
        <BreadcrumbJsonLd
          items={[
            {
              name: locale === "en" ? "Home" : "首页",
              url: localeUrl(locale),
            },
            { name: locale === "en" ? "Blog" : "博客" },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            {
              label: locale === "en" ? "Home" : "首页",
              href: localePath(locale),
            },
            { label: locale === "en" ? "Blog" : "博客" },
          ]}
        />

        <header className="mb-12 border-b border-brand-border/60 pb-12 pt-7 md:pb-16 md:pt-12">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-accent-text">
            {locale === "en"
              ? "Methods, decisions, and practical next steps"
              : "方法、决策与可执行的下一步"}
          </p>
          <h1 className="mt-4 text-[38px] font-bold leading-[1.02] tracking-[-0.04em] text-text-dark-primary md:text-[54px]">
            {t("title")}
          </h1>
          <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-dark-secondary md:text-[17px]">
            {locale === "en"
              ? "Read by topic, then move from the idea to a concrete diagnostic or a connected GenGrowth project."
              : "按话题阅读，然后从一个想法走向具体诊断或一份连续的 GenGrowth 项目。"}
          </p>
        </header>

        {/* Category filter tabs */}
        <div className="flex flex-wrap gap-2 mb-4 border-b border-brand-border/40 pb-4">
          <Link
            href={`${localePath(locale, "/blog")}${validPillar ? `?pillar=${validPillar}` : ""}`}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              !validCategory
                ? "bg-brand-accent text-white"
                : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
            }`}
          >
            {locale === "en" ? "All" : "全部"}
          </Link>
          {availableCategories.map((cat) => (
            <Link
              key={cat}
              href={`${localePath(locale, "/blog")}?category=${cat}${validPillar ? `&pillar=${validPillar}` : ""}`}
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
            href={`${localePath(locale, "/blog")}${validCategory ? `?category=${validCategory}` : ""}`}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              !validPillar
                ? "bg-brand-accent/20 text-brand-accent border border-brand-accent/40"
                : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
            }`}
          >
            {t("pillars.all")}
          </Link>
          {availablePillars.map((p) => (
            <Link
              key={p}
              href={`${localePath(locale, "/blog")}?${validCategory ? `category=${validCategory}&` : ""}pillar=${p}`}
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
            <NextIntlClientProvider messages={{ blog: messages.blog }}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-14">
                {posts.map((post) => (
                  <BlogCard key={post.id} post={post} />
                ))}
              </div>
            </NextIntlClientProvider>

            {totalPages > 1 && (
              <nav className="flex justify-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (p) => (
                    <Link
                      key={p}
                      href={
                        p === 1
                          ? `${localePath(locale, "/blog")}${validCategory ? `?category=${validCategory}` : ""}${validPillar ? `${validCategory ? "&" : "?"}pillar=${validPillar}` : ""}`
                          : `${localePath(locale, "/blog")}?page=${p}${validCategory ? `&category=${validCategory}` : ""}${validPillar ? `&pillar=${validPillar}` : ""}`
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

        <section
          id="comparisons"
          className="mt-20 border-t border-brand-border/60 pt-12 md:pt-16"
        >
          <div className="max-w-2xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-accent-text">
              {t("comparisons.eyebrow")}
            </p>
            <h2 className="mt-4 text-[28px] font-semibold leading-[1.08] tracking-[-0.035em] text-text-dark-primary md:text-[36px]">
              {t("comparisons.title")}
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-text-dark-secondary md:text-[15px]">
              {t("comparisons.body")}
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {comparisons.map((comparison) => (
              <article
                key={comparison.slug}
                id={`compare-${comparison.slug}`}
                className="rounded-2xl border border-brand-border/70 bg-brand-bg-alt/40 p-5"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-accent-text">
                  {t("comparisons.cardLabel")}
                </p>
                <h3 className="mt-3 text-[18px] font-semibold tracking-[-0.025em] text-text-dark-primary">
                  {locale === "en"
                    ? `GenGrowth × ${comparison.competitor}`
                    : `GenGrowth 与 ${comparison.competitor}`}
                </h3>
                <p className="mt-3 text-[13px] leading-relaxed text-text-dark-secondary">
                  {t("comparisons.cardBody")}
                </p>
                <p className="mt-4 border-l-2 border-brand-accent/70 pl-3 text-[13px] font-medium leading-relaxed text-text-dark-primary">
                  {t(`comparisons.questions.${comparison.questionKey}`)}
                </p>
                <details className="group mt-5 border-t border-brand-border/60 pt-4">
                  <summary className="cursor-pointer text-[13px] font-semibold text-brand-accent-text marker:text-brand-accent-text">
                    {t("comparisons.openChecklist")}
                  </summary>
                  <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-text-dark-secondary">
                    <li>{t("comparisons.checklist.evidence")}</li>
                    <li>{t("comparisons.checklist.workflow")}</li>
                    <li>{t("comparisons.checklist.control")}</li>
                  </ol>
                </details>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-20 grid gap-5 rounded-3xl border border-brand-border/70 bg-brand-bg-alt/50 p-6 md:grid-cols-[1fr_auto] md:items-end md:p-8">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-text">
              {locale === "en"
                ? "Ready to apply a lesson?"
                : "准备把一个方法用起来？"}
            </p>
            <h2 className="mt-3 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {locale === "en"
                ? "Start with an evidence-led site diagnostic."
                : "先从基于证据的网站诊断开始。"}
            </h2>
            <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-text-dark-secondary">
              {locale === "en"
                ? "The public audit and internal-link audit are free to run and do not require an account for the first result."
                : "公开 SEO 审计和内链审计均可免费运行，获得第一个结果无需账号。"}
            </p>
          </div>
          <Link
            href={localePath(locale, "/tools")}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover"
          >
            {locale === "en" ? "Explore free tools" : "探索免费工具"}
          </Link>
        </section>
      </div>
    </div>
  );
}
