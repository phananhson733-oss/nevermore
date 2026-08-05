// @input  -- generatePageMetadata, getTranslations, BreadcrumbJsonLd, FaqPageJsonLd
// @output -- Pricing page (server component + generateMetadata + FAQ/Breadcrumb JSON-LD)
// @pos    -- marketing site pricing page
// Once this file is updated, update the header comment and the folder's _DIR.md
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
} from "@/components/seo/json-ld";
import PricingPageClient from "./pricing-page-client";
import { localeUrl } from "@/lib/locale-path";

const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tNav = await getTranslations({ locale, namespace: "nav" });
  return generatePageMetadata({
    title: tNav("pricing"),
    description:
      locale === "en"
        ? "Use GenGrowth's free SEO diagnostics, then move into a connected workflow for research, structure, internal links, authority, and measurement."
        : "先使用 GenGrowth 的免费 SEO 诊断，再进入串联研究、网站结构、内链、权威建设与衡量的完整工作流。",
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
  const messages = await getMessages();
  const pricingMessages = {
    pricing: {
      hero: messages.pricing.hero,
      freeTools: messages.pricing.freeTools,
      product: messages.pricing.product,
      cta: messages.pricing.cta,
      faq: messages.pricing.faq,
    },
  };

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
            url: localeUrl(locale),
          },
          {
            name: tNav("pricing"),
          },
        ]}
      />
      <FaqPageJsonLd faqs={faqs} />
      <NextIntlClientProvider messages={pricingMessages}>
        <PricingPageClient />
      </NextIntlClientProvider>
    </>
  );
}
