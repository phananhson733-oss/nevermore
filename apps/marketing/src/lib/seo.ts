// @input  — siteConfig
// @output — generatePageMetadata() 统一 SEO metadata 生成函数
// @pos    — SEO 工具层，被所有页面 generateMetadata 调用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

export function generatePageMetadata({
  title,
  description,
  locale,
  path,
  image,
  noIndex = false,
}: {
  title: string;
  description: string;
  locale: string;
  path: string;
  /** Custom OG image URL; falls back to default brand image (SPEC 8.1.1) */
  image?: string;
  /** Keep legacy or in-progress pages reachable without presenting them as canonical marketing pages. */
  noIndex?: boolean;
}): Metadata {
  const url = `${siteConfig.url}/${locale}${path}`;
  const alternateLocale = locale === "en" ? "zh" : "en";
  const alternateUrl = `${siteConfig.url}/${alternateLocale}${path}`;
  const ogImage = image || `${siteConfig.url}/images/og-default.png`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        [locale]: url,
        [alternateLocale]: alternateUrl,
        "x-default": `${siteConfig.url}/en${path}`,
      },
    },
    openGraph: {
      title,
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
      site: "@gengrowth",
      title,
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
