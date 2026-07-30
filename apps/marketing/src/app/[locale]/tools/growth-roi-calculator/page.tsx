// @input  -- locale param, tools.roi i18n namespace, siteConfig
// @output -- Growth ROI Calculator page with SEO metadata, JSON-LD, and ROICalculator client component
// @pos    -- programmatic SEO, free tool detail page for organic traffic
// once this file is updated, update header comments and _DIR.md in this folder
import { getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
  HowToJsonLd,
} from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { ROICalculator } from "@/components/tools/roi-calculator";

const PATH = "/tools/growth-roi-calculator";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools.roi" });

  return generatePageMetadata({
    title: t("pageTitle"),
    description: t("pageSubtitle"),
    locale,
    path: PATH,
  });
}

export default async function GrowthROICalculatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools.roi" });

  const homeLabel = locale === "en" ? "Home" : "首页";
  const toolsLabel = locale === "en" ? "Free Growth Tools" : "免费增长工具";
  const pageLabel = t("pageTitle");

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">
        {/* Structured data */}
        <BreadcrumbJsonLd
          items={[
            { name: homeLabel, url: `${siteConfig.url}/${locale}` },
            { name: toolsLabel, url: `${siteConfig.url}/${locale}/tools` },
            { name: pageLabel },
          ]}
        />
        <HowToJsonLd
          name={t("howItWorks")}
          steps={[
            { name: t("step1"), text: t("step1") },
            { name: t("step2"), text: t("step2") },
            { name: t("step3"), text: t("step3") },
          ]}
        />
        <FaqPageJsonLd
          faqs={[
            { q: t("faq1q"), a: t("faq1a") },
            { q: t("faq2q"), a: t("faq2a") },
            { q: t("faq3q"), a: t("faq3a") },
          ]}
        />

        {/* Visible breadcrumb */}
        <VisibleBreadcrumb
          items={[
            { label: homeLabel, href: `/${locale}` },
            { label: toolsLabel, href: `/${locale}/tools` },
            { label: pageLabel },
          ]}
        />

        {/* Hero */}
        <div className="mb-12">
          <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
            {t("pageTitle")}
          </h1>
          <p className="text-text-dark-secondary text-[15px]">
            {t("pageSubtitle")}
          </p>
        </div>

        {/* Interactive calculator */}
        <ROICalculator locale={locale} />

        {/* FAQ section */}
        <div className="mt-16">
          <h2 className="text-text-dark-primary font-semibold text-[22px] mb-6">
            FAQ
          </h2>
          <div className="space-y-6">
            {[
              { q: t("faq1q"), a: t("faq1a") },
              { q: t("faq2q"), a: t("faq2a") },
              { q: t("faq3q"), a: t("faq3a") },
            ].map((faq) => (
              <div key={faq.q}>
                <h3 className="text-text-dark-primary font-medium text-[15px] mb-1">
                  {faq.q}
                </h3>
                <p className="text-text-dark-secondary text-[13px] leading-relaxed">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
