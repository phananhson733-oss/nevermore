// @input  -- locale param, tools.seoAudit i18n namespace, and siteConfig
// @output -- SEO metadata, JSON-LD, methodology, FAQ, and interactive Health Map
// @pos    -- programmatic SEO detail route for the free homepage health check
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SeoAuditTool } from "@/components/tools/seo-audit-tool";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
  HowToJsonLd,
} from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { siteConfig } from "@/config/site";
import { generatePageMetadata } from "@/lib/seo";

const PATH = "/tools/seo-audit";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools.seoAudit" });
  return generatePageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    locale,
    path: PATH,
  });
}

export default async function SeoAuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools.seoAudit" });
  const home = locale === "en" ? "Home" : "首页";
  const tools = locale === "en" ? "Free Growth Tools" : "免费增长工具";
  const faqs = [1, 2, 3].map((index) => ({
    q: t(`faq${index}q`),
    a: t(`faq${index}a`),
  }));

  return (
    <div className="min-h-screen bg-brand-bg py-20 md:py-28">
      <div className="mx-auto max-w-[1080px] px-6">
        <BreadcrumbJsonLd
          items={[
            { name: home, url: `${siteConfig.url}/${locale}` },
            { name: tools, url: `${siteConfig.url}/${locale}/tools` },
            { name: t("pageTitle") },
          ]}
        />
        <HowToJsonLd
          name={t("howTitle")}
          steps={[1, 2, 3].map((index) => ({
            name: t(`step${index}Title`),
            text: t(`step${index}Text`),
          }))}
        />
        <FaqPageJsonLd faqs={faqs} />
        <VisibleBreadcrumb
          items={[
            { label: home, href: `/${locale}` },
            { label: tools, href: `/${locale}/tools` },
            { label: t("pageTitle") },
          ]}
        />

        <header className="relative mb-10 overflow-hidden border-b border-brand-border/60 pb-10 pt-4">
          <div className="grid gap-8 md:grid-cols-[1.45fr_0.55fr] md:items-end">
            <div>
              <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.2em] text-brand-accent-text">
                {t("eyebrow")}
              </p>
              <h1 className="max-w-3xl text-[34px] font-bold leading-[1.05] tracking-[-0.04em] text-text-dark-primary md:text-[52px]">
                {t("pageTitle")}
              </h1>
              <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-dark-secondary md:text-[16px]">
                {t("pageSubtitle")}
              </p>
            </div>
            <div className="grid grid-cols-5 gap-1.5" aria-hidden="true">
              {[92, 81, 74, 63, 45].map((height, index) => (
                <span
                  key={height}
                  className="self-end rounded-sm bg-brand-accent/70"
                  style={{ height, opacity: 1 - index * 0.14 }}
                />
              ))}
            </div>
          </div>
        </header>

        <SeoAuditTool locale={locale} />

        <section className="mt-20 border-t border-brand-border/60 pt-12">
          <div className="grid gap-8 md:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-brand-accent-text">
                {t("methodEyebrow")}
              </p>
              <h2 className="mt-3 text-[24px] font-semibold tracking-[-0.02em] text-text-dark-primary">
                {t("howTitle")}
              </h2>
            </div>
            <div className="grid gap-px overflow-hidden rounded-2xl border border-brand-border/60 bg-brand-border/60">
              {[1, 2, 3].map((index) => (
                <article key={index} className="bg-[#171718] p-5">
                  <p className="font-mono text-[10px] text-brand-accent-text">
                    0{index}
                  </p>
                  <h3 className="mt-2 text-[14px] font-semibold text-text-dark-primary">
                    {t(`step${index}Title`)}
                  </h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-text-dark-secondary">
                    {t(`step${index}Text`)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-16 rounded-2xl border border-brand-accent/20 bg-brand-accent/[0.05] p-7 md:flex md:items-center md:justify-between">
          <div>
            <h2 className="text-[20px] font-semibold text-text-dark-primary">
              {t("ctaTitle")}
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
              {t("ctaBody")}
            </p>
          </div>
          <Link
            href={siteConfig.appUrl}
            className="mt-5 inline-flex rounded-lg bg-brand-accent px-5 py-3 text-[12px] font-semibold text-white md:mt-0"
          >
            {t("ctaButton")}
          </Link>
        </section>

        <section className="mt-16">
          <h2 className="mb-6 text-[22px] font-semibold text-text-dark-primary">
            FAQ
          </h2>
          <div className="divide-y divide-brand-border/60">
            {faqs.map((faq) => (
              <article key={faq.q} className="py-5">
                <h3 className="text-[14px] font-medium text-text-dark-primary">
                  {faq.q}
                </h3>
                <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-text-dark-secondary">
                  {faq.a}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
