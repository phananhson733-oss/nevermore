// @input  -- locale param, tools.seoAudit i18n namespace, and siteConfig
// @output -- SEO metadata, JSON-LD, methodology, FAQ, and interactive Health Map
// @pos    -- programmatic SEO detail route for the free single-page health check
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { ArrowRight, FileQuestion } from "lucide-react";
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
  const faqs = Array.from({ length: 8 }, (_, offset) => offset + 1).map(
    (index) => ({
      q: t(`faq${index}q`),
      a: t(`faq${index}a`),
    }),
  );

  return (
    <div className="min-h-screen bg-brand-bg pb-24 pt-20 md:pt-28">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-6">
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

        <header className="relative mt-3 overflow-hidden border-b border-brand-border/60 pb-12 pt-7 md:pb-16 md:pt-12">
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 hidden w-[46%] md:block"
          >
            <svg
              viewBox="0 0 500 330"
              className="h-full w-full opacity-75"
              preserveAspectRatio="xMidYMid meet"
            >
              <g fill="none" stroke="rgba(217,119,87,.24)" strokeWidth="1">
                {[72, 132, 192, 252].map((y) => (
                  <path key={y} d={`M42 ${y} H462`} />
                ))}
              </g>
              <g fill="none" stroke="rgba(217,119,87,.45)" strokeWidth="2">
                <path d="M58 220 L146 161 L237 191 L333 93 L442 126" />
              </g>
              <g fill="#D97757">
                <circle cx="58" cy="220" r="9" />
                <circle cx="146" cy="161" r="12" opacity=".72" />
                <circle cx="237" cy="191" r="10" opacity=".6" />
                <circle cx="333" cy="93" r="18" />
                <circle cx="442" cy="126" r="13" opacity=".82" />
              </g>
              <g fill="#F0EDE8" opacity=".55">
                <rect x="43" y="269" width="72" height="6" rx="3" />
                <rect x="126" y="269" width="92" height="6" rx="3" />
                <rect x="229" y="269" width="54" height="6" rx="3" />
                <rect x="294" y="269" width="126" height="6" rx="3" />
              </g>
            </svg>
          </div>

          <div className="relative z-10 max-w-[720px]">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-brand-accent-text">
              {t("eyebrow")}
            </p>
            <h1 className="mt-5 max-w-3xl text-[42px] font-bold leading-[0.98] tracking-[-0.05em] text-text-dark-primary sm:text-[54px] md:text-[68px]">
              {t("pageTitle")}
            </h1>
            <p className="mt-6 max-w-[650px] text-[15px] leading-[1.75] text-text-dark-secondary md:text-[17px]">
              {t("pageSubtitle")}
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <a
                href="#seo-audit-tool"
                className="inline-flex w-fit items-center gap-2 rounded-xl bg-brand-accent px-5 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {t("heroCta")}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
              <p className="text-[10px] leading-relaxed text-text-dark-secondary">
                {t("heroTrust")}
              </p>
            </div>
          </div>
        </header>

        <main>
          <section className="pt-8 md:pt-10">
            <SeoAuditTool locale={locale} />
          </section>

          <section className="mt-24 border-t border-brand-border/60 pt-14">
            <div className="grid gap-9 md:grid-cols-[0.72fr_1.28fr]">
              <div className="md:sticky md:top-24 md:self-start">
                <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                  {t("methodEyebrow")}
                </p>
                <h2 className="mt-3 max-w-sm text-[28px] font-semibold leading-tight tracking-[-0.035em] text-text-dark-primary">
                  {t("howTitle")}
                </h2>
                <p className="mt-4 max-w-sm text-[12px] leading-relaxed text-text-dark-secondary">
                  {t("howIntro")}
                </p>
              </div>
              <ol className="grid gap-px overflow-hidden rounded-2xl border border-brand-border/60 bg-brand-border/60">
                {[1, 2, 3].map((index) => (
                  <li
                    key={index}
                    className="grid gap-4 bg-[#171718] p-5 sm:grid-cols-[48px_1fr] sm:p-6"
                  >
                    <p className="font-mono text-[10px] text-brand-accent-text">
                      0{index}
                    </p>
                    <article>
                      <h3 className="text-[14px] font-semibold text-text-dark-primary">
                        {t(`step${index}Title`)}
                      </h3>
                      <p className="mt-2 text-[11px] leading-relaxed text-text-dark-secondary">
                        {t(`step${index}Text`)}
                      </p>
                    </article>
                  </li>
                ))}
              </ol>
            </div>
          </section>

        <section className="mt-24">
          <div className="max-w-2xl">
            <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
              {t("signalsEyebrow")}
            </p>
            <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-text-dark-primary">
              {t("signalsTitle")}
            </h2>
            <p className="mt-4 text-[12px] leading-relaxed text-text-dark-secondary">
              {t("signalsBody")}
            </p>
          </div>
          <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-brand-border/60 bg-brand-border/60 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5].map((index) => (
              <article key={index} className="min-h-[180px] bg-[#171718] p-5">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[9px] text-brand-accent-text">
                    0{index}
                  </p>
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-accent/70" />
                </div>
                <h3 className="mt-7 text-[14px] font-semibold leading-snug text-text-dark-primary">
                  {t(`signal${index}Title`)}
                </h3>
                <p className="mt-3 text-[10px] leading-relaxed text-text-dark-secondary">
                  {t(`signal${index}Body`)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-24 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-brand-accent/25 bg-brand-accent/[0.045] p-6 md:p-7">
            <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
              {t("methodTransparencyEyebrow")}
            </p>
            <h2 className="mt-3 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {t("methodTransparencyTitle")}
            </h2>
            <div className="mt-7 divide-y divide-brand-border/60">
              {[1, 2, 3].map((index) => (
                <article key={index} className="py-5 first:pt-0">
                  <h3 className="text-[13px] font-semibold text-text-dark-primary">
                    {t(`method${index}Title`)}
                  </h3>
                  <p className="mt-2 text-[10px] leading-relaxed text-text-dark-secondary">
                    {t(`method${index}Body`)}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-brand-border/70 bg-[#171718] p-6 md:p-7">
            <p className="text-[10px] uppercase tracking-[0.18em] text-brand-warning">
              {t("limitsEyebrow")}
            </p>
            <h2 className="mt-3 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {t("limitsTitle")}
            </h2>
            <div className="mt-7 divide-y divide-brand-border/60">
              {[1, 2, 3].map((index) => (
                <article key={index} className="py-5 first:pt-0">
                  <h3 className="flex items-start gap-2 text-[13px] font-semibold text-text-dark-primary">
                    <FileQuestion
                      aria-hidden="true"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-warning"
                    />
                    {t(`limit${index}Title`)}
                  </h3>
                  <p className="mt-2 text-[10px] leading-relaxed text-text-dark-secondary">
                    {t(`limit${index}Body`)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-24 border-y border-brand-border/60 py-14">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                {t("useCasesEyebrow")}
              </p>
              <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-text-dark-primary">
                {t("useCasesTitle")}
              </h2>
              <p className="mt-4 text-[12px] leading-relaxed text-text-dark-secondary">
                {t("useCasesBody")}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[1, 2, 3].map((index) => (
                <article
                  key={index}
                  className="rounded-2xl border border-brand-border/70 bg-[#171718] p-5"
                >
                  <p className="font-mono text-[10px] text-brand-accent-text">
                    0{index}
                  </p>
                  <h3 className="mt-3 text-[14px] font-semibold text-text-dark-primary">
                    {t(`useCase${index}Title`)}
                  </h3>
                  <p className="mt-2 text-[11px] leading-relaxed text-text-dark-secondary">
                    {t(`useCase${index}Body`)}
                  </p>
                </article>
              ))}
              {[1, 2].map((index) => (
                <article
                  key={`comparison-${index}`}
                  className="rounded-2xl border border-brand-border/70 bg-[#171718] p-5"
                >
                  <h3 className="text-[14px] font-semibold text-text-dark-primary">
                    {t(`comparison${index}Title`)}
                  </h3>
                  <p className="mt-3 text-[10px] leading-relaxed text-text-dark-secondary">
                    {t(`comparison${index}Body`)}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-24">
          <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
            {t("faqEyebrow")}
          </p>
          <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.035em] text-text-dark-primary">
            {t("faqTitle")}
          </h2>
          <div className="mt-7 divide-y divide-brand-border/60 border-y border-brand-border/60">
            {faqs.map((faq, index) => (
              <details key={faq.q} className="group">
                <summary className="flex cursor-pointer list-none items-start gap-4 py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
                  <span className="mt-0.5 font-mono text-[9px] text-brand-accent-text">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="min-w-0 flex-1 text-[13px] font-medium text-text-dark-primary">
                    {faq.q}
                  </h3>
                  <span
                    aria-hidden="true"
                    className="text-[18px] leading-none text-text-dark-secondary transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="max-w-3xl pb-6 pl-10 text-[11px] leading-relaxed text-text-dark-secondary">
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-24 grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border border-brand-border/70 bg-[#171718] p-6">
              <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                {t("relatedToolsEyebrow")}
              </p>
              <h2 className="mt-3 text-[22px] font-semibold text-text-dark-primary">
                {t("relatedToolsTitle")}
              </h2>
              <Link
                href={`/${locale}/tools`}
                className="mt-6 block rounded-xl border border-brand-border/70 bg-black/10 p-5 transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold text-text-dark-primary">
                  <ArrowRight aria-hidden="true" className="h-4 w-4 text-brand-accent-text" />
                  {t("relatedToolsCta")}
                </span>
                <span className="mt-2 block text-[10px] leading-relaxed text-text-dark-secondary">
                  {t("relatedToolsBody")}
                </span>
              </Link>
              <Link
                href={`/${locale}/tools`}
                className="mt-4 inline-flex items-center gap-2 text-[11px] font-medium text-brand-accent-text"
              >
                {tools}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
          </article>
          <article className="rounded-2xl border border-brand-border/70 bg-[#171718] p-6">
              <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                {t("articlesEyebrow")}
              </p>
              <h2 className="mt-3 text-[22px] font-semibold text-text-dark-primary">
                {t("articlesTitle")}
              </h2>
              <p className="mt-3 text-[12px] leading-relaxed text-text-dark-secondary">
                {t("articlesBody")}
              </p>
              <Link
                href={`/${locale}/blog/programmatic-seo-at-scale`}
                className="mt-5 inline-flex items-center gap-2 text-[12px] font-semibold text-brand-accent-text hover:text-brand-accent-hover"
              >
                {t("articlesCta")}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
          </article>
        </section>
        <section className="relative mt-24 overflow-hidden rounded-3xl border border-brand-accent/25 bg-brand-accent/[0.07] p-7 md:p-10">
          <div
            aria-hidden="true"
            className="absolute -right-14 -top-24 h-64 w-64 rounded-full border border-brand-accent/20"
          />
          <div className="relative grid gap-7 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                {t("ctaEyebrow")}
              </p>
              <h2 className="mt-3 max-w-2xl text-[28px] font-semibold leading-tight tracking-[-0.035em] text-text-dark-primary">
                {t("ctaTitle")}
              </h2>
              <p className="mt-4 max-w-2xl text-[11px] leading-relaxed text-text-dark-secondary">
                {t("ctaBody")}
              </p>
            </div>
            <Link
              href={siteConfig.appUrl}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              {t("ctaButton")}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </section>
        </main>
      </div>
    </div>
  );
}
