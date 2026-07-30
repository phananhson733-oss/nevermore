// @input  -- sanitize-html, blog post data (title, content, excerpt, author, dates, category, reading_time), related posts, case study metrics
// @output -- BlogArticleContent component with a topic-matched tool handoff, article body, and related articles
// @pos    -- Extracted from blog [slug]/page.tsx, handles article rendering (SPEC 2.7.3)
// once this file is updated, update header comments and _DIR.md in this folder
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import sanitizeHtml from "sanitize-html";
import { AuthorBio } from "@/components/blog/author-bio";
import { RelatedArticles } from "@/components/blog/related-articles";
import { CaseStudyMetrics } from "@/components/blog/case-study-metrics";
import { CASE_STUDY_METRICS_MAP } from "@/lib/mock/blog-content-case-study";
import type { BlogPost } from "@/types/blog";

interface BlogArticleContentProps {
  locale: string;
  post: {
    slug: string;
    title: string;
    content: string;
    excerpt: string;
    author: string;
    category: string;
    reading_time: number;
    published_at: string;
    updated_at: string;
    hero_image?: string;
    hero_image_alt?: string;
    pillar_slug?: string | null;
  };
  publishDate: string;
  updateDate: string | null;
  t: (key: string) => string;
  relatedPosts?: BlogPost[];
}

const CONTENT_CLASSES = [
  "max-w-none",
  "[&_>*]:max-w-[720px] [&_>*]:mx-auto",
  "[&_h2]:text-text-dark-primary [&_h2]:text-[24px] [&_h2]:font-semibold [&_h2]:leading-[1.3] [&_h2]:mt-14 [&_h2]:mb-5 [&_h2]:tracking-[-0.01em]",
  "[&_h3]:text-text-dark-primary [&_h3]:text-[18px] [&_h3]:font-medium [&_h3]:leading-[1.4] [&_h3]:mt-10 [&_h3]:mb-4",
  "[&_p]:text-text-dark-secondary [&_p]:text-[17px] [&_p]:leading-[1.8] [&_p]:mb-5",
  "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-6 [&_ul]:space-y-3",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-6 [&_ol]:space-y-3",
  "[&_li]:text-text-dark-secondary [&_li]:text-[17px] [&_li]:leading-[1.8]",
  "[&_li_strong]:text-text-dark-primary",
  "[&_a]:text-brand-accent-text [&_a]:underline [&_a]:underline-offset-4 [&_a]:decoration-brand-accent/30 hover:[&_a]:decoration-brand-accent",
  "[&_code]:bg-brand-bg-alt [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px] [&_code]:text-text-dark-primary",
  "[&_strong]:text-text-dark-primary [&_strong]:font-semibold",
  "[&_em]:italic",
  "[&_table]:block [&_table]:w-full [&_table]:max-w-none [&_table]:overflow-x-auto [&_table]:my-10 [&_table]:border-collapse",
  "[&_th]:text-text-dark-primary [&_th]:text-[13px] [&_th]:font-semibold [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-brand-border [&_th]:whitespace-nowrap",
  "[&_td]:text-text-dark-secondary [&_td]:text-[14px] [&_td]:leading-[1.7] [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-brand-border/40 [&_td]:align-top",
  "[&_td_strong]:text-text-dark-primary",
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_img]:my-10 [&_img]:mx-auto",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-brand-accent/50 [&_blockquote]:pl-4 [&_blockquote]:my-6 [&_blockquote]:italic [&_blockquote]:text-text-dark-secondary",
].join(" ");

function getTopToolRecommendation(
  locale: string,
  pillar: string | null | undefined,
) {
  if (pillar === "seo_content") {
    return {
      href: `/${locale}/tools/internal-link-audit`,
      eyebrow: locale === "zh" ? "匹配的公开工具" : "Matched public tool",
      title:
        locale === "zh"
          ? "用一份有边界的内链审计检查站点结构"
          : "Check site structure with a bounded internal-link audit",
      body:
        locale === "zh"
          ? "无需账号，直接从公开 HTML 链接中找出需要人工复核的结构线索。"
          : "No account is required. Start from public HTML links and review the structural leads the crawl actually observed.",
      cta: locale === "zh" ? "运行内链审计" : "Run an internal-link audit",
    };
  }

  return {
    href: `/${locale}/tools/seo-audit`,
    eyebrow: locale === "zh" ? "匹配的公开工具" : "Matched public tool",
    title:
      locale === "zh"
        ? "先用公开 SEO 审计验证一个网站信号"
        : "Verify one site signal with a public SEO audit",
    body:
      locale === "zh"
        ? "无需账号即可检查单个公开页面，并清楚区分已测量信号与工具边界。"
        : "Check one public page without an account and keep measured signals separate from the tool's limits.",
    cta: locale === "zh" ? "运行免费 SEO 审计" : "Run a free SEO audit",
  };
}

export function BlogArticleContent({
  locale,
  post,
  publishDate,
  updateDate,
  t,
  relatedPosts = [],
}: BlogArticleContentProps) {
  const caseStudyMetrics =
    CASE_STUDY_METRICS_MAP[post.slug]?.[locale] ?? null;
  const topTool = getTopToolRecommendation(locale, post.pillar_slug);

  return (
    <article>
      {/* Meta line: category + date */}
      <div className="flex items-center gap-3 mb-5">
        <span className="text-brand-accent-text text-[13px] font-medium tracking-wide uppercase">
          {t(`categories.${post.category}`)}
        </span>
        <span className="text-text-dark-secondary/40 text-xs">|</span>
        <time
          dateTime={post.published_at}
          className="text-text-dark-secondary text-[13px]"
        >
          {publishDate}
        </time>
      </div>

      {/* Title */}
      <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] leading-[1.2] tracking-[-0.02em] mb-5">
        {post.title}
      </h1>

      {/* Author / Reading time */}
      <div className="flex items-center gap-3 text-text-dark-secondary text-[13px] mb-10">
        <span>{post.author}</span>
        {post.reading_time > 0 && (
          <>
            <span className="opacity-40">·</span>
            <span>
              {post.reading_time} {t("minRead")}
            </span>
          </>
        )}
        {updateDate && (
          <>
            <span className="opacity-40">·</span>
            <span>
              {t("updated")} {updateDate}
            </span>
          </>
        )}
      </div>

      {/* Hero image */}
      {post.hero_image && (
        <img
          src={post.hero_image}
          alt={post.hero_image_alt ?? post.title}
          width={1200}
          height={675}
          loading="eager"
          className="w-full h-auto rounded-xl mb-10 aspect-[16/9] object-cover"
        />
      )}

      {/* Divider */}
      <div className="border-t border-brand-border/50 mb-10" />

      {/* Excerpt */}
      <p className="text-text-dark-secondary text-[15px] leading-[1.8] mb-10 pl-5 border-l-2 border-brand-accent/60">
        {post.excerpt}
      </p>

      <aside className="mb-12 rounded-2xl border border-brand-border/70 bg-brand-bg-alt/45 p-5 md:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-text">
          {topTool.eyebrow}
        </p>
        <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-text-dark-primary">
              {topTool.title}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-text-dark-secondary">
              {topTool.body}
            </p>
          </div>
          <Link
            href={topTool.href}
            className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-brand-accent/45 px-4 py-2.5 text-[12px] font-semibold text-brand-accent-text transition-colors hover:bg-brand-accent/10"
          >
            {topTool.cta}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
      </aside>

      {/* Case study metrics (rendered for posts with metrics data) */}
      {caseStudyMetrics && (
        <CaseStudyMetrics metrics={caseStudyMetrics} locale={locale} />
      )}

      {/* Content */}
      <div
        className={CONTENT_CLASSES}
        dangerouslySetInnerHTML={{
          __html: sanitizeHtml(post.content, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
            allowedAttributes: {
              ...sanitizeHtml.defaults.allowedAttributes,
              img: ["src", "alt", "width", "height", "loading"],
            },
          }),
        }}
      />

      <section className="my-14 rounded-2xl border border-brand-accent/25 bg-brand-accent/[0.055] p-6 md:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-text">
          {locale === "zh" ? "把方法用在你的网站上" : "Put the method to work"}
        </p>
        <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.025em] text-text-dark-primary">
          {locale === "zh"
            ? "先从一个可验证的 SEO 信号开始"
            : "Start with one verifiable SEO signal"}
        </h2>
        <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
          {locale === "zh"
            ? "公开工具不需要账号。先获得一个带证据的诊断结果，再决定是否把工作带入完整项目。"
            : "The public tools do not require an account. Get an evidence-led diagnostic first, then decide whether the work belongs in a full project."}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/${locale}/tools/seo-audit`}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-accent px-4 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-brand-accent-hover"
          >
            {locale === "zh" ? "运行免费 SEO 审计" : "Run a free SEO audit"}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
          <Link
            href={`/${locale}/tools/internal-link-audit`}
            className="inline-flex items-center gap-2 rounded-xl border border-brand-border px-4 py-2.5 text-[12px] font-semibold text-text-dark-primary transition-colors hover:border-brand-accent/60"
          >
            {locale === "zh" ? "运行内链审计" : "Run an internal link audit"}
          </Link>
        </div>
      </section>

      {/* Author bio */}
      <AuthorBio />

      {/* Related articles */}
      {relatedPosts.length > 0 && (
        <RelatedArticles posts={relatedPosts} locale={locale} />
      )}

      {/* Back to blog */}
      <div className="border-t border-brand-border/50 mt-16 pt-8">
        <Link
          href={`/${locale}/blog`}
          className="text-text-dark-secondary text-[13px] hover:text-brand-accent-text transition-colors"
        >
          &larr; {locale === "zh" ? "返回博客" : "Back to blog"}
        </Link>
      </div>
    </article>
  );
}
