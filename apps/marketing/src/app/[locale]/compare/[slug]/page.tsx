// @input  -- slug param, locale, compare i18n namespace, comparison data
// @output -- dynamic comparison detail page with SEO, JSON-LD, comparison table
// @pos    -- programmatic SEO, /compare/[slug] detail pages for organic traffic
// once this file is updated, update header comments and _DIR.md in this folder
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
} from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { ComparisonHero } from "@/components/compare/comparison-hero";
import { ComparisonTable } from "@/components/compare/comparison-table";
import { ComparisonFaqs } from "@/components/compare/comparison-faqs";
import { ComparisonBestFor } from "@/components/compare/comparison-best-for";
import { ComparisonCta } from "@/components/compare/comparison-cta";
import { isValidComparisonSlug } from "@/lib/mock/compare-content";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isValidComparisonSlug(slug)) {
    return { title: "Not Found" };
  }
  const t = await getTranslations({ locale, namespace: `compare.${slug}` });
  return generatePageMetadata({
    title: `${t("heroTitle")} -- GenGrowth`,
    description: t("heroDescription"),
    locale,
    path: `/compare/${slug}`,
  });
}

export default async function CompareDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isValidComparisonSlug(slug)) notFound();

  const t = await getTranslations({ locale, namespace: "compare" });
  const ts = await getTranslations({ locale, namespace: `compare.${slug}` });
  const tCommon = await getTranslations({ locale, namespace: "common" });

  const homeLabel = tCommon("home");
  const compareLabel = t("title");
  const pageLabel = ts("heroTitle");
  const competitorName = ts("competitor");

  const dimensionKeys = [
    "discovery",
    "strategy",
    "execution",
    "attribution",
    "optimization",
    "cost",
  ] as const;

  const comparisonRows = dimensionKeys.map((key) => ({
    dimension: ts(`dimensions.${key}.name`),
    genGrowth: ts(`dimensions.${key}.gengrowth`),
    competitor: ts(`dimensions.${key}.competitor`),
  }));

  const faqKeys = ["faq1", "faq2", "faq3"] as const;
  const faqs = faqKeys.map((key) => ({
    q: ts(`faqs.${key}.q`),
    a: ts(`faqs.${key}.a`),
  }));

  const bestForGG = [
    ts("bestFor.gengrowth.item1"),
    ts("bestFor.gengrowth.item2"),
    ts("bestFor.gengrowth.item3"),
  ];
  const bestForComp = [
    ts("bestFor.competitor.item1"),
    ts("bestFor.competitor.item2"),
    ts("bestFor.competitor.item3"),
  ];

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: homeLabel, url: `${siteConfig.url}/${locale}` },
          { name: compareLabel, url: `${siteConfig.url}/${locale}/compare` },
          { name: pageLabel },
        ]}
      />
      <FaqPageJsonLd faqs={faqs} />

      <VisibleBreadcrumb
        items={[
          { label: homeLabel, href: `/${locale}` },
          { label: compareLabel, href: `/${locale}/compare` },
          { label: pageLabel },
        ]}
      />

      <ComparisonHero title={pageLabel} subtitle={ts("heroDescription")}>
        <p className="text-brand-accent-text text-[14px] font-medium mb-6">
          {ts("tldr")}
        </p>
        <ComparisonTable
          rows={comparisonRows}
          competitorLabel={competitorName}
        />
      </ComparisonHero>

      <ComparisonBestFor
        gengrowthItems={bestForGG}
        competitorItems={bestForComp}
        gengrowthLabel="GenGrowth"
        competitorLabel={competitorName}
        heading={t("bestForHeading")}
      />

      <ComparisonFaqs
        faqs={faqs.map((f) => ({ question: f.q, answer: f.a }))}
        heading={t("faqHeading")}
      />

      <ComparisonCta
        locale={locale}
        ctaLabel={t("cta")}
        ctaSubtitle={t("ctaSubtitle")}
        backLabel={t("backToCompare")}
      />
    </>
  );
}
