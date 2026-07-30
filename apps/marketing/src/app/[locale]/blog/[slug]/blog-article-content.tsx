// @input  -- sanitize-html, blog post data (title, content, excerpt, author, dates, category, reading_time), related posts, case study metrics
// @output -- BlogArticleContent component rendering article body with sanitized HTML and related articles
// @pos    -- Extracted from blog [slug]/page.tsx, handles article rendering (SPEC 2.7.3)
// once this file is updated, update header comments and _DIR.md in this folder
import Link from "next/link";
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
