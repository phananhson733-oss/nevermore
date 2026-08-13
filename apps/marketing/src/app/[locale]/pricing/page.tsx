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
        ? "Run GenGrowth SEO and Tech URL audits after account verification, without payment, Search Console, site-ownership verification, or saved run history."
        : "验证账号后运行 GenGrowth SEO 与 Tech URL 审计；无需付费、连接 Search Console、验证站点所有权，也不会保存运行历史。",
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
