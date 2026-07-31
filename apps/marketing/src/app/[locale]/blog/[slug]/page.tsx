// @input  -- next-intl, blog data, siteConfig, generatePageMetadata, BlogArticleContent
// @output -- Blog post detail page (metadata + breadcrumb + article + JSON-LD)
// @pos    -- Blog detail page route, data fetching and layout orchestration (SPEC 2.7.3)
// once this file is updated, update header comments and _DIR.md in this folder
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { getBlogPostBySlug, getBlogPosts } from "@/lib/blog";
import { getLocalBlogPosts } from "@/lib/blog-content";
import { siteConfig } from "@/config/site";
import { generatePageMetadata } from "@/lib/seo";
import Link from "next/link";
import { BlogArticleContent } from "./blog-article-content";
import { getRelatedArticles } from "@/components/blog/related-articles";
import { localePath, localeUrl } from "@/lib/locale-path";

/** Escape `</` in JSON-LD to prevent </script> injection (XSS) */
function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function absoluteImageUrl(image: string): string {
  return image.startsWith("https://") ? image : `${siteConfig.url}${image}`;
}

/** Pre-render canonical repository-backed articles; legacy URLs remain served by the migration bridge. */
export async function generateStaticParams() {
  const posts = await getLocalBlogPosts();
  return posts.map((post) => ({ locale: post.locale, slug: post.slug }));
}

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const alternateLocale = locale === "en" ? "zh" : "en";
  const [post, alternatePost] = await Promise.all([
    getBlogPostBySlug(slug, locale),
    getBlogPostBySlug(slug, alternateLocale),
  ]);

  if (!post) {
    return generatePageMetadata({
      title: locale === "en" ? "Post Not Found" : "文章未找到",
      description: "",
      locale,
      path: `/blog/${slug}`,
    });
  }

  const metadata = generatePageMetadata({
    // The root layout applies the site-wide title template. Supplying the
    // article title alone avoids emitting "… GenGrowth — GenGrowth".
    title: post.title,
    description: post.excerpt || "",
    locale,
    path: `/blog/${slug}`,
    image: post.hero_image ? absoluteImageUrl(post.hero_image) : undefined,
  });

  const canonical = localeUrl(locale, `/blog/${slug}`);
  const alternate = localeUrl(alternateLocale, `/blog/${slug}`);
  return {
    ...metadata,
    alternates: {
      canonical,
      languages: {
        [locale]: canonical,
        ...(alternatePost ? { [alternateLocale]: alternate } : {}),
        "x-default": canonical,
      },
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const [post, { posts: allPosts }] = await Promise.all([
    getBlogPostBySlug(slug, locale),
    getBlogPosts({ locale }),
  ]);
  const t = await getTranslations({ locale, namespace: "blog" });
  const messages = await getMessages();

  if (!post) {
    notFound();
  }

  const relatedPosts = getRelatedArticles(
    post.slug,
    post.pillar_slug ?? null,
    post.category,
    allPosts,
  );

  const publishDate = new Date(post.published_at).toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  const hasUpdate =
    post.updated_at &&
    new Date(post.updated_at).getTime() > new Date(post.published_at).getTime();

  const updateDate = hasUpdate
    ? new Date(post.updated_at).toLocaleDateString(
        locale === "zh" ? "zh-CN" : "en-US",
        { year: "numeric", month: "long", day: "numeric" },
      )
    : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    author: { "@type": "Person", name: post.author },
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    description: post.excerpt,
    ...(post.hero_image ? { image: absoluteImageUrl(post.hero_image) } : {}),
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    mainEntityOfPage: localeUrl(locale, `/blog/${slug}`),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: locale === "zh" ? "首页" : "Home",
        item: localeUrl(locale),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: t("title"),
        item: localeUrl(locale, "/blog"),
      },
      { "@type": "ListItem", position: 3, name: post.title },
    ],
  };

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[960px] mx-auto px-6">
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="text-text-dark-secondary text-[13px] mb-12"
        >
          <Link
            href={localePath(locale)}
            className="hover:text-text-dark-primary transition-colors"
          >
            {locale === "zh" ? "首页" : "Home"}
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <Link
            href={localePath(locale, "/blog")}
            className="hover:text-text-dark-primary transition-colors"
          >
            {t("title")}
          </Link>
        </nav>

        <NextIntlClientProvider messages={{ blog: messages.blog }}>
          <BlogArticleContent
            locale={locale}
            post={post}
            publishDate={publishDate}
            updateDate={updateDate}
            t={t}
            relatedPosts={relatedPosts}
          />
        </NextIntlClientProvider>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }}
        />
      </div>
    </div>
  );
}
