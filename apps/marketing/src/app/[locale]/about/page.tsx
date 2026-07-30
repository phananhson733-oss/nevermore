// @input  — generatePageMetadata, BreadcrumbJsonLd, AboutPageClient
// @output — About 关于页面（server component + generateMetadata + BreadcrumbList JSON-LD）
// @pos    — 营销官网关于页，对应 SPEC 2.8
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import AboutPageClient from "./about-page-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title:
      locale === "en"
        ? "About — GenGrowth"
        : "关于我们 — GenGrowth",
    description:
      locale === "en"
        ? "Transparent, systematic, human-centered growth. Learn about our design principles and mission."
        : "透明、系统化、以人为本的增长理念。了解我们的设计原则和使命。",
    locale,
    path: "/about",
  });
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          {
            name: locale === "en" ? "Home" : "首页",
            url: `${siteConfig.url}/${locale}`,
          },
          {
            name: locale === "en" ? "About" : "关于我们",
          },
        ]}
      />
      <AboutPageClient />
    </>
  );
}
