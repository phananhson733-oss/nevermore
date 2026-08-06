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
import { localePath } from "@/lib/locale-path";

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

/*
 * 正文排版：成段文字一律走 sans，mono 只留给表头这类标签位。中文正文行高
 * 1.75，标题字重交给 globals.css 的 600 封顶，页面里不再写死。
 */
const CONTENT_CLASSES = [
  "max-w-none",
  "[&_>*]:max-w-[720px] [&_>*]:mx-auto",
  "[&_h2]:text-text-dark-primary [&_h2]:text-[22px] [&_h2]:leading-[1.3] [&_h2]:mt-14 [&_h2]:mb-4",
  "[&_h3]:text-text-dark-primary [&_h3]:text-[16.5px] [&_h3]:leading-[1.4] [&_h3]:mt-10 [&_h3]:mb-3",
  "[&_p]:text-text-dark-strong [&_p]:text-[15.5px] [&_p]:leading-[1.75] [&_p]:mb-5",
  "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-6 [&_ul]:space-y-2.5",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-6 [&_ol]:space-y-2.5",
  "[&_li]:text-text-dark-strong [&_li]:text-[15.5px] [&_li]:leading-[1.75]",
  "[&_li]:marker:text-text-dark-faint",
  "[&_li_strong]:text-text-dark-primary",
  "[&_a]:text-brand-accent-text [&_a]:underline [&_a]:underline-offset-4 [&_a]:decoration-brand-accent/30 hover:[&_a]:decoration-brand-accent",
  "[&_code]:bg-brand-panel-sunken [&_code]:border [&_code]:border-brand-border [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-text-dark-primary",
  "[&_strong]:text-text-dark-primary [&_strong]:font-semibold",
  "[&_em]:italic",
  "[&_table]:block [&_table]:w-full [&_table]:max-w-none [&_table]:overflow-x-auto [&_table]:my-10 [&_table]:border-collapse",
  "[&_th]:text-text-dark-secondary [&_th]:font-mono [&_th]:text-[10px] [&_th]:tracking-[0.1em] [&_th]:uppercase [&_th]:text-left [&_th]:px-3 [&_th]:py-2.5 [&_th]:border-b [&_th]:border-brand-border [&_th]:whitespace-nowrap",
  "[&_td]:text-text-dark-secondary [&_td]:text-[13px] [&_td]:leading-[1.7] [&_td]:px-3 [&_td]:py-2.5 [&_td]:border-b [&_td]:border-brand-border-faint [&_td]:align-top",
  "[&_td_strong]:text-text-dark-primary",
  "[&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-card [&_img]:my-10 [&_img]:mx-auto",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-brand-accent [&_blockquote]:pl-4 [&_blockquote]:my-6 [&_blockquote]:text-text-dark-strong",
].join(" ");

function getTopToolRecommendation(
  locale: string,
  pillar: string | null | undefined,
) {
  if (pillar === "seo_content") {
    return {
      href: localePath(locale, "/tools/internal-link-audit"),
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
    href: localePath(locale, "/tools/seo-audit"),
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
  const caseStudyMetrics = CASE_STUDY_METRICS_MAP[post.slug]?.[locale] ?? null;
  const topTool = getTopToolRecommendation(locale, post.pillar_slug);

  return (
    <article>
      {/* Meta line: category chip + mono date */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <span className="rounded border border-brand-accent/30 px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
          {t(`categories.${post.category}`)}
        </span>
        <time
          dateTime={post.published_at}
          className="font-mono text-[10.5px] tracking-[0.08em] text-text-dark-secondary"
        >
          {publishDate}
        </time>
      </div>

      {/* Title */}
      <h1 className="mb-5 text-[30px] leading-[1.15] text-text-dark-primary md:text-[40px]">
        {post.title}
      </h1>

      {/* Author / Reading time */}
      <div className="mb-10 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-text-dark-secondary">
        <span>{post.author}</span>
        {post.reading_time > 0 && (
          <>
            <span className="text-text-dark-faint">·</span>
            <span className="font-mono text-[10.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
              {post.reading_time} {t("minRead")}
            </span>
          </>
        )}
        {updateDate && (
          <>
            <span className="text-text-dark-faint">·</span>
            <span className="font-mono text-[10.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
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
          className="mb-10 aspect-[16/9] h-auto w-full rounded-card border border-brand-border-card object-cover"
        />
      )}

      {/* Divider */}
      <div className="mb-10 border-t border-brand-border" />

      {/* Excerpt */}
      <p className="mb-10 border-l-2 border-brand-accent pl-4 text-[15.5px] leading-[1.7] text-text-dark-strong">
        {post.excerpt}
      </p>

      <aside className="mb-12 rounded-card border border-brand-border-card bg-brand-panel p-[22px] md:p-[26px]">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {topTool.eyebrow}
        </p>
        <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <h2 className="text-[16.5px] font-semibold text-text-dark-primary">
              {topTool.title}
            </h2>
            <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
              {topTool.body}
            </p>
          </div>
          <Link
            href={topTool.href}
            className="inline-flex h-11.5 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-5 text-[13.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50"
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

      {/* 强调卡片：左侧 2px 内投影是这一屏唯一的「就是这里」信号 */}
      <section className="my-14 rounded-card border border-brand-accent/50 bg-brand-accent/[0.08] p-[26px] shadow-[inset_2px_0_0_#3DDC97]">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          {locale === "zh" ? "把方法用在你的网站上" : "Put the method to work"}
        </p>
        <h2 className="mt-3 text-[21px] font-semibold tracking-[-0.025em] text-text-dark-primary">
          {locale === "zh"
            ? "先从一个可验证的 SEO 信号开始"
            : "Start with one verifiable SEO signal"}
        </h2>
        <p className="mt-3 max-w-2xl text-[13px] leading-[1.65] text-text-dark-secondary">
          {locale === "zh"
            ? "公开工具不需要账号。先获得一个带证据的诊断结果，再决定是否把工作带入完整项目。"
            : "The public tools do not require an account. Get an evidence-led diagnostic first, then decide whether the work belongs in a full project."}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={localePath(locale, "/tools/seo-audit")}
            className="inline-flex h-11.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {locale === "zh" ? "运行免费 SEO 审计" : "Run a free SEO audit"}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
          <Link
            href={localePath(locale, "/tools/internal-link-audit")}
            className="inline-flex h-11.5 items-center justify-center rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-6 text-[14px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50"
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
      <div className="mt-16 border-t border-brand-border pt-8">
        <Link
          href={localePath(locale, "/blog")}
          className="font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-2 uppercase transition-colors hover:text-brand-info"
        >
          &larr; {locale === "zh" ? "返回博客" : "Back to blog"}
        </Link>
      </div>
    </article>
  );
}
