// @input  — next-intl, @/lib/legal, @/components/legal/legal-page-template, generatePageMetadata, BreadcrumbJsonLd
// @output — 服务条款页面 (doc_type="terms") + SEO metadata + BreadcrumbList JSON-LD
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
  const document = await getLegalDocument("terms", locale);
  return generatePageMetadata({
    title:
      locale === "en" ? "Terms of Service" : "服务条款",
    description:
      locale === "en"
        ? "Terms and conditions for using GenGrowth services."
        : "使用 GenGrowth 服务的条款和条件。",
    locale,
    path: "/terms",
    noIndex: !document,
  });
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  const doc = await getLegalDocument("terms", locale);

  if (!doc) {
    return (
      <div className="bg-brand-bg min-h-screen py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h1 className="text-text-dark-primary font-semibold mb-4">
            {t("terms.title")}
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
            name: locale === "en" ? "Terms of Service" : "服务条款",
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
        breadcrumbLabel={locale === "en" ? "Terms of Service" : "服务条款"}
      />
    </>
  );
}
