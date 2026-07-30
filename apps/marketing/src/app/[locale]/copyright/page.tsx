// @input  — next-intl, @/lib/legal, @/components/legal/legal-page-template, generatePageMetadata, BreadcrumbJsonLd
// @output — 版权声明页面 (doc_type="copyright") + SEO metadata + BreadcrumbList JSON-LD
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
  const document = await getLegalDocument("copyright", locale);
  return generatePageMetadata({
    title:
      locale === "en" ? "Copyright Notice" : "版权声明",
    description:
      locale === "en"
        ? "Copyright and DMCA information for GenGrowth."
        : "GenGrowth 的版权与 DMCA 信息。",
    locale,
    path: "/copyright",
    noIndex: !document,
  });
}

export default async function CopyrightPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal" });
  const doc = await getLegalDocument("copyright", locale);

  if (!doc) {
    return (
      <div className="bg-brand-bg min-h-screen py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h1 className="text-text-dark-primary font-semibold mb-4">
            {t("copyright.title")}
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
            name: locale === "en" ? "Copyright Notice" : "版权声明",
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
        breadcrumbLabel={locale === "en" ? "Copyright Notice" : "版权声明"}
      />
    </>
  );
}
