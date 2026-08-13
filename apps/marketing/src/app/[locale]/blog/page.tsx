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

/*
 * 过滤 pill：mono 大写 + 圆角 999。选中态走 accent 描边 + 8% 填充，而不是实心
 * accent 块——实心块会和一屏唯一的渐变主 CTA 抢注意力。
 */
const FILTER_PILL_BASE =
  "rounded-full px-3.5 py-1.5 font-mono text-[10px] tracking-[0.08em] uppercase transition-colors";
const FILTER_PILL_ACTIVE =
  "border border-brand-accent/50 bg-brand-accent/12 text-brand-accent-text";
const FILTER_PILL_IDLE =
  "border border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/40 hover:text-text-dark-primary";

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
    /* 顶部间距只留 36px：PageShell 已经为 fixed 导航垫了 68px */
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="max-w-report mx-auto px-6 md:px-8">
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

        <header className="relative mb-10 overflow-hidden border-b border-brand-border pt-7 pb-12 md:pb-14">
          {/* GLOW_01 — 页级 hero 才允许的网格 + 氛围光 */}
          <div
            aria-hidden="true"
            className="bg-signal-grid absolute inset-0 opacity-40"
          />
          <div
            aria-hidden="true"
            className="absolute -top-30 right-[4%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
          />
          <div className="relative max-w-3xl">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {locale === "en"
                ? "Methods, decisions, and practical next steps"
                : "方法、决策与可执行的下一步"}
            </p>
            <h1 className="mt-4 text-text-dark-primary">{t("title")}</h1>
            <p className="mt-5 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
              {locale === "en"
                ? "Read by topic, then move from the idea to a concrete diagnostic or a connected GenGrowth project."
                : "按话题阅读，然后从一个想法走向具体诊断或一份连续的 GenGrowth 项目。"}
            </p>
          </div>
        </header>

        {/* Category filter tabs */}
        <div className="mb-4 flex flex-wrap gap-2 border-b border-brand-border pb-4">
          <Link
            href={`${localePath(locale, "/blog")}${validPillar ? `?pillar=${validPillar}` : ""}`}
            className={`${FILTER_PILL_BASE} ${
              !validCategory ? FILTER_PILL_ACTIVE : FILTER_PILL_IDLE
            }`}
          >
            {locale === "en" ? "All" : "全部"}
          </Link>
          {availableCategories.map((cat) => (
            <Link
              key={cat}
              href={`${localePath(locale, "/blog")}?category=${cat}${validPillar ? `&pillar=${validPillar}` : ""}`}
              className={`${FILTER_PILL_BASE} ${
                validCategory === cat ? FILTER_PILL_ACTIVE : FILTER_PILL_IDLE
              }`}
            >
              {t(`categories.${cat}`)}
            </Link>
          ))}
        </div>

        {/* Pillar filter tabs */}
        <div className="mb-10 flex flex-wrap gap-2">
          <Link
            href={`${localePath(locale, "/blog")}${validCategory ? `?category=${validCategory}` : ""}`}
            className={`${FILTER_PILL_BASE} ${
              !validPillar ? FILTER_PILL_ACTIVE : FILTER_PILL_IDLE
            }`}
          >
            {t("pillars.all")}
          </Link>
          {availablePillars.map((p) => (
            <Link
              key={p}
              href={`${localePath(locale, "/blog")}?${validCategory ? `category=${validCategory}&` : ""}pillar=${p}`}
              className={`${FILTER_PILL_BASE} ${
                validPillar === p ? FILTER_PILL_ACTIVE : FILTER_PILL_IDLE
              }`}
            >
              {t(`pillars.${p}`)}
            </Link>
          ))}
        </div>

        {posts.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-text-dark-secondary">
            {t("noPosts")}
          </p>
        ) : (
          <>
            <NextIntlClientProvider messages={{ blog: messages.blog }}>
              <div className="mb-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {posts.map((post) => (
                  <BlogCard key={post.id} post={post} />
                ))}
              </div>
            </NextIntlClientProvider>

            {totalPages > 1 && (
              <nav className="flex flex-wrap justify-center gap-1.5">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (p) => (
                    <Link
                      key={p}
                      href={
                        p === 1
                          ? `${localePath(locale, "/blog")}${validCategory ? `?category=${validCategory}` : ""}${validPillar ? `${validCategory ? "&" : "?"}pillar=${validPillar}` : ""}`
                          : `${localePath(locale, "/blog")}?page=${p}${validCategory ? `&category=${validCategory}` : ""}${validPillar ? `&pillar=${validPillar}` : ""}`
                      }
                      className={`flex size-9 items-center justify-center rounded-[8px] font-mono text-[11px] transition-colors ${
                        p === page
                          ? "border border-brand-accent/50 bg-brand-accent/12 text-brand-accent-text"
                          : "border border-brand-border-strong text-text-dark-secondary hover:border-brand-accent/40 hover:text-text-dark-primary"
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
          className="mt-18 border-t border-brand-border pt-14"
        >
          <div className="max-w-2xl">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("comparisons.eyebrow")}
            </p>
            <h2 className="mt-3 text-text-dark-primary">
              {t("comparisons.title")}
            </h2>
            <p className="mt-4 text-[14.5px] leading-[1.65] text-text-dark-secondary">
              {t("comparisons.body")}
            </p>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {comparisons.map((comparison) => (
              <article
                key={comparison.slug}
                id={`compare-${comparison.slug}`}
                className="rounded-card border border-brand-border-card bg-brand-panel p-[22px]"
              >
                <p className="font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase">
                  {t("comparisons.cardLabel")}
                </p>
                <h3 className="mt-3 text-[16.5px] font-semibold text-text-dark-primary">
                  {locale === "en"
                    ? `GenGrowth × ${comparison.competitor}`
                    : `GenGrowth 与 ${comparison.competitor}`}
                </h3>
                <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {t("comparisons.cardBody")}
                </p>
                <p className="mt-4 border-l-2 border-brand-accent pl-3.5 text-[13px] leading-[1.65] text-text-dark-strong">
                  {t(`comparisons.questions.${comparison.questionKey}`)}
                </p>
                <details className="group mt-5 border-t border-brand-border pt-4">
                  <summary className="cursor-pointer font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors marker:text-brand-accent-text hover:text-brand-accent-hover">
                    {t("comparisons.openChecklist")}
                  </summary>
                  <ol className="mt-3 list-decimal space-y-2 pl-5 text-[13px] leading-[1.6] text-text-dark-secondary">
                    <li>{t("comparisons.checklist.evidence")}</li>
                    <li>{t("comparisons.checklist.workflow")}</li>
                    <li>{t("comparisons.checklist.control")}</li>
                  </ol>
                </details>
              </article>
            ))}
          </div>
        </section>

        {/* 「下一步」容器走虚线 + 微渐变底，与实线的内容卡片区分开 */}
        <section className="mt-18 grid gap-6 rounded-[16px] border border-dashed border-brand-border-dashed bg-[linear-gradient(135deg,rgba(61,220,151,0.04),rgba(76,195,250,0.05))] p-7 md:grid-cols-[1fr_auto] md:items-end md:p-10">
          <div>
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {locale === "en"
                ? "Ready to apply a lesson?"
                : "准备把一个方法用起来？"}
            </p>
            <h2 className="mt-3 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {locale === "en"
                ? "Start with an evidence-led site diagnostic."
                : "先从基于证据的网站诊断开始。"}
            </h2>
            <p className="mt-3 max-w-xl text-[13px] leading-[1.65] text-text-dark-secondary">
              {locale === "en"
                ? "The SEO and Tech Agents inspect public HTML after you sign in to a verified GenGrowth account. No Search Console connection or site-ownership verification is required, and the marketing run is not saved to an app project."
                : "登录已验证的 GenGrowth 账号后，即可使用 SEO 与 Tech Agent 检查公开 HTML；无需连接 Search Console 或验证站点所有权，本次营销站运行也不会保存到 App 项目。"}
            </p>
          </div>
          <Link
            href={localePath(locale, "/agents")}
            className="inline-flex h-11.5 items-center justify-center rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {locale === "en" ? "Explore Agents" : "查看 Agents"}
          </Link>
        </section>
      </div>
    </div>
  );
}
