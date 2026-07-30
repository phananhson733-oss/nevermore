// @input  -- locale param, tools.abTest i18n namespace, siteConfig
// @output -- A/B Test Sample Size Calculator page with SEO structured data
// @pos    -- programmatic SEO tool page, drives organic traffic for "ab test sample size"
// once this file is updated, update header comments and _DIR.md in this folder
import { getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import {
  BreadcrumbJsonLd,
  HowToJsonLd,
  FaqPageJsonLd,
} from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { ABTestCalculator } from "@/components/tools/ab-test-calculator";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools.abTest" });

  return generatePageMetadata({
    title: t("pageTitle"),
    description: t("pageSubtitle"),
    locale,
    path: "/tools/ab-test-calculator",
  });
}

export default async function ABTestCalculatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools.abTest" });

  const homeLabel = locale === "en" ? "Home" : "首页";
  const toolsLabel = locale === "en" ? "Free Growth Tools" : "免费增长工具";

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">
        {/* Structured data */}
        <BreadcrumbJsonLd
          items={[
            { name: homeLabel, url: `${siteConfig.url}/${locale}` },
            {
              name: toolsLabel,
              url: `${siteConfig.url}/${locale}/tools`,
            },
            { name: t("pageTitle") },
          ]}
        />
        <HowToJsonLd
          name={t("howItWorks")}
          steps={[
            { name: "Step 1", text: t("step1") },
            { name: "Step 2", text: t("step2") },
            { name: "Step 3", text: t("step3") },
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
            { label: t("pageTitle") },
          ]}
        />

        {/* Hero */}
        <div className="mb-10">
          <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
            {t("pageTitle")}
          </h1>
          <p className="text-text-dark-secondary text-[15px] max-w-[640px]">
            {t("pageSubtitle")}
          </p>
        </div>

        {/* Calculator component */}
        <ABTestCalculator locale={locale} />

        {/* How it works */}
        <section className="mt-16 mb-12">
          <h2 className="text-text-dark-primary font-semibold text-[20px] mb-6">
            {t("howItWorks")}
          </h2>
          <ol className="space-y-4 text-text-dark-secondary text-[14px] list-decimal list-inside">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
        </section>

        {/* FAQ */}
        <section className="mb-12">
          <h2 className="text-text-dark-primary font-semibold text-[20px] mb-6">
            FAQ
          </h2>
          <div className="space-y-6">
            {[
              { q: t("faq1q"), a: t("faq1a") },
              { q: t("faq2q"), a: t("faq2a") },
              { q: t("faq3q"), a: t("faq3a") },
            ].map((faq) => (
              <div key={faq.q}>
                <h3 className="text-text-dark-primary font-medium text-[15px] mb-2">
                  {faq.q}
                </h3>
                <p className="text-text-dark-secondary text-[14px] leading-relaxed">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
