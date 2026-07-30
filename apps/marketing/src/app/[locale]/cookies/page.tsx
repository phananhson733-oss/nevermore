// @input  — next-intl, @/lib/legal, @/components/legal/legal-page-template, generatePageMetadata, BreadcrumbJsonLd
// @output — Cookie 政策页面 (doc_type="cookies") + SEO metadata + BreadcrumbList JSON-LD
// @pos    — 法务页面之一，SPEC 法务模块
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { getTranslations } from "next-intl/server";
import { getLegalDocument, getLegalVersions } from "@/lib/legal";
import { LegalPageTemplate } from "@/components/legal/legal-page-template";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title:
      locale === "en" ? "Cookie Policy — GenGrowth" : "Cookie 政策 — GenGrowth",
    description:
      locale === "en"
        ? "How GenGrowth uses cookies and similar technologies."
        : "GenGrowth 如何使用 Cookie 和类似技术。",
    locale,
    path: "/cookies",
  });
}

export default async function CookiesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  const doc = await getLegalDocument("cookies", locale);

  if (!doc) {
    return (
      <div className="bg-brand-bg min-h-screen py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h1 className="text-text-dark-primary font-semibold mb-4">
            {t("cookies.title")}
          </h1>
          <p className="text-text-dark-secondary text-lg">{t("comingSoon")}</p>
        </div>
      </div>
    );
  }

  const versions = await getLegalVersions(doc.id);

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          {
            name: locale === "en" ? "Home" : "首页",
            url: `${siteConfig.url}/${locale}`,
          },
          {
            name: locale === "en" ? "Cookie Policy" : "Cookie 政策",
          },
        ]}
      />
      <LegalPageTemplate
        title={doc.title}
        effectiveDate={doc.effective_date}
        version={doc.version}
        content={doc.content}
        versions={versions}
        locale={locale}
        breadcrumbLabel={locale === "en" ? "Cookie Policy" : "Cookie 政策"}
      />
    </>
  );
}
