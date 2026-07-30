// @input  -- term slug param, locale, glossary data layer
// @output -- glossary term detail page with structured data
// @pos    -- programmatic SEO term page, long-tail keyword target
// once this file is updated, update header comments and _DIR.md in this folder
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { getGlossaryTermBySlug, getRelatedTerms } from "@/lib/glossary";
import { siteConfig } from "@/config/site";
import { generatePageMetadata } from "@/lib/seo";
import { BreadcrumbJsonLd, DefinedTermJsonLd } from "@/components/seo/json-ld";
import { RelatedTerms } from "@/components/glossary/related-terms";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; term: string }>;
}) {
  const { locale, term: slug } = await params;
  const term = await getGlossaryTermBySlug(slug, locale);

  if (!term) {
    return generatePageMetadata({
      title:
        locale === "en"
          ? "Term Not Found -- GenGrowth"
          : "术语未找到 -- GenGrowth",
      description: "",
      locale,
      path: `/glossary/${slug}`,
    });
  }

  return generatePageMetadata({
    title: term.seo_title || `${term.term} -- GenGrowth`,
    description: term.definition,
    locale,
    path: `/glossary/${slug}`,
  });
}

export default async function GlossaryTermPage({
  params,
}: {
  params: Promise<{ locale: string; term: string }>;
}) {
  const { locale, term: slug } = await params;
  const term = await getGlossaryTermBySlug(slug, locale);

  if (!term) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "glossary.termPage" });
  const relatedTerms = await getRelatedTerms(term.related_terms, locale);

  const breadcrumbItems = [
    {
      name: locale === "zh" ? "首页" : "Home",
      url: `${siteConfig.url}/${locale}`,
    },
    {
      name: locale === "zh" ? "增长术语表" : "Growth Glossary",
      url: `${siteConfig.url}/${locale}/glossary`,
    },
    { name: term.term },
  ];

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[720px] mx-auto px-6">
        {/* 1. Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="text-text-dark-secondary text-[13px] mb-12"
        >
          <Link
            href={`/${locale}`}
            className="hover:text-text-dark-primary transition-colors"
          >
            {locale === "zh" ? "首页" : "Home"}
          </Link>
          <span className="mx-2 opacity-40">/</span>
          <Link
            href={`/${locale}/glossary`}
            className="hover:text-text-dark-primary transition-colors"
          >
            {locale === "zh" ? "增长术语表" : "Growth Glossary"}
          </Link>
        </nav>

        {/* 2. H1 term name */}
        <h1 className="text-3xl md:text-4xl font-bold text-text-dark-primary mb-8">
          {term.term}
        </h1>

        {/* 3. Definition block */}
        <div className="border-l-4 border-brand-accent pl-5 py-3 mb-10">
          <p className="text-base font-semibold text-text-dark-primary leading-relaxed">
            {term.definition}
          </p>
        </div>

        {/* 4. Body content */}
        <div
          className="prose prose-invert prose-brand max-w-none mb-12 text-text-dark-secondary leading-relaxed [&_h2]:text-text-dark-primary [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-text-dark-primary [&_h3]:text-lg [&_h3]:font-medium [&_h3]:mt-8 [&_h3]:mb-3 [&_a]:text-brand-accent [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
          dangerouslySetInnerHTML={{
            __html: term.body
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(
                /&lt;(\/?(p|h[1-6]|ul|ol|li|a|strong|em|br|div|span|blockquote|code|pre|table|thead|tbody|tr|th|td)(\s[^>]*)?)&gt;/gi,
                "<$1>",
              ),
          }}
        />

        {/* 5. Related feature link */}
        {term.related_feature && (
          <div className="rounded-lg border border-white/[0.06] bg-brand-bg-secondary p-6 mb-12">
            <h2 className="text-lg font-semibold text-text-dark-primary mb-2">
              {t("relatedFeature")}
            </h2>
            <Link
              href={`/${locale}/features#${term.related_feature}`}
              className="text-brand-accent hover:underline text-sm"
            >
              {locale === "zh"
                ? "查看 GenGrowth 如何帮助 -->"
                : "See how GenGrowth helps -->"}
            </Link>
          </div>
        )}

        {/* 6. Related terms */}
        <RelatedTerms terms={relatedTerms} locale={locale} />

        {/* 7. CTA */}
        <div className="mt-16 rounded-lg border border-brand-accent/20 bg-brand-accent/[0.05] p-8 text-center">
          <p className="text-text-dark-secondary text-sm mb-4">{t("cta")}</p>
          <Link
            href={`/${locale}/features`}
            className="inline-block rounded-lg bg-brand-accent px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-accent/90"
          >
            {locale === "zh" ? "了解更多" : "Learn More"}
          </Link>
        </div>

        {/* Back to glossary */}
        <div className="mt-10">
          <Link
            href={`/${locale}/glossary`}
            className="text-text-dark-secondary hover:text-brand-accent text-sm transition-colors"
          >
            {"<--"} {t("backToGlossary")}
          </Link>
        </div>

        {/* Structured data */}
        <BreadcrumbJsonLd items={breadcrumbItems} />
        <DefinedTermJsonLd name={term.term} description={term.definition} />
      </div>
    </div>
  );
}
