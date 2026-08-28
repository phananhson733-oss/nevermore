// @input  — siteConfig
// @output — generatePageMetadata() 统一 SEO metadata 生成函数
// @pos    — SEO 工具层，被所有页面 generateMetadata 调用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { Metadata } from "next";
import { siteConfig } from "../config/site";
import { localeUrl } from "./locale-path";

export function generatePageMetadata({
  title,
  description,
  locale,
  path,
  canonicalPath,
  image,
  noIndex = false,
}: {
  title: string;
  description: string;
  locale: string;
  path: string;
  /**
   * Where this page's authority belongs, when that is not this page.
   *
   * A consolidated route stays reachable and keeps its own copy, but every URL
   * it publishes has to name the same destination: a page that advertises
   * itself in hreflang and og:url while pointing rel=canonical elsewhere gives
   * two different answers to one question, and search engines are entitled to
   * believe either.
   */
  canonicalPath?: string;
  /** Custom OG image URL; falls back to default brand image (SPEC 8.1.1) */
  image?: string;
  /** Keep legacy or in-progress pages reachable without presenting them as canonical marketing pages. */
  noIndex?: boolean;
}): Metadata {
  const authorityPath = canonicalPath ?? path;
  const url = localeUrl(locale, authorityPath);
  const alternateLocale = locale === "en" ? "zh" : "en";
  const alternateUrl = localeUrl(alternateLocale, authorityPath);
  const ogImage = image || `${siteConfig.url}/images/og-default.png`;
  /**
   * `title` 走 root layout 的 `title.template`（`%s — GenGrowth`），但那个
   * 模板**只作用于 <title>**，不作用于 openGraph/twitter。所以分享卡片的
   * 标题要在这里显式补品牌名，否则社交平台上只剩裸标题。
   */
  const socialTitle = `${title} — ${siteConfig.name}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        [locale]: url,
        [alternateLocale]: alternateUrl,
        "x-default": localeUrl("en", authorityPath),
      },
    },
    openGraph: {
      title: socialTitle,
      description,
      url,
      siteName: siteConfig.name,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
        },
      ],
      locale: locale === "en" ? "en_US" : "zh_CN",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      site: "@GenGrowthAI",
      title: socialTitle,
      description,
      images: [ogImage],
    },
    ...(noIndex
      ? {
          robots: {
            index: false,
            follow: false,
            googleBot: { index: false, follow: false },
          },
        }
      : {}),
  };
}
