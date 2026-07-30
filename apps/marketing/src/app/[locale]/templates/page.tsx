// @input  — generatePageMetadata, BreadcrumbJsonLd, TemplatesPageClient
// @output — Templates 模板页（server component + generateMetadata + BreadcrumbList JSON-LD）
// @pos    — 营销官网模板页，对应 SPEC 2.7
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import TemplatesPageClient from "./templates-page-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title:
      locale === "en"
        ? "Playbooks & Methods — GenGrowth"
        : "剧本与方法 — GenGrowth",
    description:
      locale === "en"
        ? "Reusable playbooks, transparent experiment methods. Follow live experiment logs."
        : "可复用剧本、透明实验方法论。跟踪实时实验日志。",
    locale,
    path: "/templates",
  });
}

export default async function TemplatesPage({
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
            name:
              locale === "en"
                ? "Playbooks & Methods"
                : "剧本与方法",
          },
        ]}
      />
      <TemplatesPageClient />
    </>
  );
}
