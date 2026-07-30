// @input  — generatePageMetadata, BreadcrumbJsonLd, ContactPageClient
// @output — Contact 联系页面（server component + generateMetadata + BreadcrumbList JSON-LD）
// @pos    — 营销官网联系页，提交写入 contact_submissions
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import ContactPageClient from "./contact-page-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title:
      locale === "en"
        ? "Contact — GenGrowth"
        : "联系我们 — GenGrowth",
    description:
      locale === "en"
        ? "Get in touch with the GenGrowth team. Questions, partnerships, or just say hello."
        : "联系 GenGrowth 团队。无论是问题、合作还是打个招呼。",
    locale,
    path: "/contact",
  });
}

export default async function ContactPage({
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
            name: locale === "en" ? "Contact" : "联系我们",
          },
        ]}
      />
      <ContactPageClient />
    </>
  );
}
