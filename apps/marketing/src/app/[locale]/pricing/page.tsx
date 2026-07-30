// @input  -- generatePageMetadata, getTranslations, BreadcrumbJsonLd, FaqPageJsonLd
// @output -- Pricing page (server component + generateMetadata + FAQ/Breadcrumb JSON-LD)
// @pos    -- marketing site pricing page
// Once this file is updated, update the header comment and the folder's _DIR.md
import { getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
} from "@/components/seo/json-ld";
import PricingPageClient from "./pricing-page-client";

const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing.hero" });
  const tNav = await getTranslations({ locale, namespace: "nav" });
  return generatePageMetadata({
    title: `${tNav("pricing")} -- GenGrowth`,
    description: t("subtitle"),
    locale,
    path: "/pricing",
  });
}

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tFaq = await getTranslations({ locale, namespace: "pricing.faq" });
  const tCommon = await getTranslations({ locale, namespace: "common" });
  const tNav = await getTranslations({ locale, namespace: "nav" });

  const faqs = FAQ_KEYS.map((key) => ({
    q: tFaq(`${key}.question`),
    a: tFaq(`${key}.answer`),
  }));

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          {
            name: tCommon("home"),
            url: `${siteConfig.url}/${locale}`,
          },
          {
            name: tNav("pricing"),
          },
        ]}
      />
      <FaqPageJsonLd faqs={faqs} />
      <PricingPageClient />
    </>
  );
}
