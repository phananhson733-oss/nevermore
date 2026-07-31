// @input  -- locale param, typed P0-2 copy, shared SEO and marketing layout primitives
// @output -- localized Internal Link Audit landing page, JSON-LD, and bounded live crawl UI
// @pos    -- SEO flagship route for the public P0-2 tool at /tools/internal-link-audit

import Link from "next/link";
import {
  ArrowRight,
  CircleSlash2,
  FileQuestion,
  Link2,
  Network,
  Route,
} from "lucide-react";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
  HowToJsonLd,
  ToolSoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { InternalLinkAuditTool } from "@/components/tools/internal-link-audit-tool";
import { getInternalLinkAuditContent } from "@/components/tools/internal-link-audit-content";
import { siteConfig } from "@/config/site";
import { generatePageMetadata } from "@/lib/seo";
import { localePath, localeUrl } from "@/lib/locale-path";

const PATH = "/tools/internal-link-audit";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getInternalLinkAuditContent(locale);
  const metadata = generatePageMetadata({
    title: content.metaTitle,
    description: content.metaDescription,
    locale,
    path: PATH,
  });
  return {
    ...metadata,
    title: { absolute: content.metaTitle },
  };
}

export default async function InternalLinkAuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getInternalLinkAuditContent(locale);
  const home = locale === "en" ? "Home" : "首页";
  const tools = locale === "en" ? "Free Growth Tools" : "免费增长工具";
  const faqs = content.faqs.map((faq) => ({
    q: faq.question,
    a: faq.answer,
  }));

  return (
    <div className="min-h-screen bg-brand-bg pb-24 pt-20 md:pt-28">
      <div className="mx-auto max-w-[1120px] px-5 sm:px-6">
        <BreadcrumbJsonLd
          items={[
            { name: home, url: localeUrl(locale) },
            { name: tools, url: localeUrl(locale, "/tools") },
            { name: content.breadcrumb },
          ]}
        />
        <HowToJsonLd
          name={
            locale === "en"
              ? "How to run an internal link audit"
              : "如何运行内链审计"
          }
          steps={content.howSteps.map((step) => ({
            name: step.title,
            text: step.body,
          }))}
        />
        <FaqPageJsonLd faqs={faqs} />
        <ToolSoftwareApplicationJsonLd
          name={content.title}
          description={content.schemaDescription}
          url={localeUrl(locale, `${PATH}`)}
          featureList={content.schemaFeatures}
        />
        <VisibleBreadcrumb
          items={[
            { label: home, href: localePath(locale) },
            { label: tools, href: localePath(locale, "/tools") },
            { label: content.breadcrumb },
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
              <g
                fill="none"
                stroke="rgba(217,119,87,.28)"
                strokeWidth="1.2"
              >
                <path d="M250 165 C190 104 122 90 67 58" />
                <path d="M250 165 C176 165 122 185 58 218" />
                <path d="M250 165 C316 114 363 88 430 62" />
                <path d="M250 165 C333 172 382 205 448 245" />
                <path d="M67 58 C96 130 85 170 58 218" />
                <path d="M430 62 C392 128 398 188 448 245" />
              </g>
              <g fill="#D97757">
                <circle cx="250" cy="165" r="33" />
                <circle cx="67" cy="58" r="18" opacity=".65" />
                <circle cx="430" cy="62" r="22" opacity=".82" />
              </g>
              <g fill="#F0EDE8">
                <circle cx="58" cy="218" r="13" opacity=".55" />
                <circle cx="448" cy="245" r="16" opacity=".45" />
              </g>
              <g
                fill="none"
                stroke="#D95757"
                strokeDasharray="5 6"
                strokeWidth="1.5"
              >
                <circle cx="366" cy="276" r="27" />
                <circle cx="112" cy="282" r="21" />
              </g>
            </svg>
          </div>

          <div className="relative z-10 max-w-[720px]">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-brand-accent-text">
              {content.eyebrow}
            </p>
            <h1 className="mt-5 max-w-3xl text-[42px] font-bold leading-[0.98] tracking-[-0.05em] text-text-dark-primary sm:text-[54px] md:text-[68px]">
              {content.title}
            </h1>
            <p className="mt-6 max-w-[650px] text-[15px] leading-[1.75] text-text-dark-secondary md:text-[17px]">
              {content.subtitle}
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <a
                href="#internal-link-audit-tool"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {content.primaryCta}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
              <p className="text-[10px] leading-relaxed text-text-dark-secondary">
                {content.trustLine}
              </p>
            </div>
          </div>
        </header>

        <main>
          <section className="pt-8 md:pt-10">
            <InternalLinkAuditTool locale={locale} />
          </section>

          <section className="mt-24 border-t border-brand-border/60 pt-14">
            <div className="grid gap-9 md:grid-cols-[0.72fr_1.28fr]">
              <div className="md:sticky md:top-24 md:self-start">
                <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                  {content.howEyebrow}
                </p>
                <h2 className="mt-3 max-w-sm text-[28px] font-semibold leading-tight tracking-[-0.035em] text-text-dark-primary">
                  {content.howTitle}
                </h2>
                <p className="mt-4 max-w-sm text-[12px] leading-relaxed text-text-dark-secondary">
                  {content.howIntro}
                </p>
              </div>
              <ol className="grid gap-px overflow-hidden rounded-2xl border border-brand-border/60 bg-brand-border/60">
                {content.howSteps.map((step, index) => (
                  <li
                    key={step.title}
                    className="grid gap-4 bg-[#171718] p-5 sm:grid-cols-[48px_1fr] sm:p-6"
                  >
                    <span className="font-mono text-[11px] text-brand-accent-text">
                      0{index + 1}
                    </span>
                    <article>
                      <h3 className="text-[14px] font-semibold text-text-dark-primary">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-[11px] leading-relaxed text-text-dark-secondary">
                        {step.body}
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
                {content.findsEyebrow}
              </p>
              <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-text-dark-primary">
                {content.findsTitle}
              </h2>
              <p className="mt-4 text-[12px] leading-relaxed text-text-dark-secondary">
                {content.findsIntro}
              </p>
            </div>
            <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-brand-border/60 bg-brand-border/60 md:grid-cols-2 lg:grid-cols-3">
              {content.findings.map((finding, index) => (
                <article
                  key={finding.title}
                  className="min-h-[180px] bg-[#171718] p-5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] text-brand-accent-text">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {index % 3 === 0 ? (
                      <CircleSlash2
                        aria-hidden="true"
                        className="h-4 w-4 text-brand-accent-text/70"
                      />
                    ) : index % 3 === 1 ? (
                      <Network
                        aria-hidden="true"
                        className="h-4 w-4 text-brand-accent-text/70"
                      />
                    ) : (
                      <Route
                        aria-hidden="true"
                        className="h-4 w-4 text-brand-accent-text/70"
                      />
                    )}
                  </div>
                  <h3 className="mt-7 text-[14px] font-semibold leading-snug text-text-dark-primary">
                    {finding.title}
                  </h3>
                  <p className="mt-3 text-[10px] leading-relaxed text-text-dark-secondary">
                    {finding.body}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-24 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-brand-accent/25 bg-brand-accent/[0.045] p-6 md:p-7">
              <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                {content.methodEyebrow}
              </p>
              <h2 className="mt-3 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {content.methodTitle}
              </h2>
              <div className="mt-7 divide-y divide-brand-border/60">
                {content.methods.map((method) => (
                  <article key={method.title} className="py-5 first:pt-0">
                    <h3 className="text-[13px] font-semibold text-text-dark-primary">
                      {method.title}
                    </h3>
                    <p className="mt-2 text-[10px] leading-relaxed text-text-dark-secondary">
                      {method.body}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-brand-border/70 bg-[#171718] p-6 md:p-7">
              <p className="text-[10px] uppercase tracking-[0.18em] text-brand-warning">
                {content.limitsEyebrow}
              </p>
              <h2 className="mt-3 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {content.limitsTitle}
              </h2>
              <div className="mt-7 divide-y divide-brand-border/60">
                {content.limitations.map((limitation) => (
                  <article key={limitation.title} className="py-5 first:pt-0">
                    <h3 className="flex items-start gap-2 text-[13px] font-semibold text-text-dark-primary">
                      <FileQuestion
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-warning"
                      />
                      {limitation.title}
                    </h3>
                    <p className="mt-2 text-[10px] leading-relaxed text-text-dark-secondary">
                      {limitation.body}
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
                  {content.audienceEyebrow}
                </p>
                <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.035em] text-text-dark-primary">
                  {content.audienceTitle}
                </h2>
                <p className="mt-4 text-[12px] leading-relaxed text-text-dark-secondary">
                  {content.audienceBody}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {content.fitSignals.map((signal) => (
                  <article
                    key={signal.title}
                    className="rounded-2xl border border-brand-border/70 bg-[#171718] p-5"
                  >
                    <h3 className="text-[14px] font-semibold text-text-dark-primary">
                      {signal.title}
                    </h3>
                    <p className="mt-3 text-[10px] leading-relaxed text-text-dark-secondary">
                      {signal.body}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-24">
            <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
              {content.faqEyebrow}
            </p>
            <h2 className="mt-3 text-[28px] font-semibold tracking-[-0.035em] text-text-dark-primary">
              {content.faqTitle}
            </h2>
            <div className="mt-7 divide-y divide-brand-border/60 border-y border-brand-border/60">
              {content.faqs.map((faq, index) => (
                <details key={faq.question} className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-4 py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
                    <span className="mt-0.5 font-mono text-[9px] text-brand-accent-text">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="min-w-0 flex-1 text-[13px] font-medium text-text-dark-primary">
                      {faq.question}
                    </h3>
                    <span
                      aria-hidden="true"
                      className="text-[18px] leading-none text-text-dark-secondary transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-3xl pb-6 pl-10 text-[11px] leading-relaxed text-text-dark-secondary">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>

          <section className="mt-24 grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-brand-border/70 bg-[#171718] p-6">
              <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                {content.relatedEyebrow}
              </p>
              <h2 className="mt-3 text-[22px] font-semibold text-text-dark-primary">
                {content.relatedTitle}
              </h2>
              <Link
                href={localePath(locale, "/tools/seo-audit")}
                className="mt-6 block rounded-xl border border-brand-border/70 bg-black/10 p-5 transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold text-text-dark-primary">
                  <Link2
                    aria-hidden="true"
                    className="h-4 w-4 text-brand-accent-text"
                  />
                  {content.relatedAudit}
                </span>
                <span className="mt-2 block text-[10px] leading-relaxed text-text-dark-secondary">
                  {content.relatedAuditBody}
                </span>
              </Link>
              <Link
                href={localePath(locale, "/tools")}
                className="mt-4 inline-flex items-center gap-2 text-[11px] font-medium text-brand-accent-text"
              >
                {content.relatedTools}
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            </article>

            <article className="rounded-2xl border border-brand-border/70 bg-[#171718] p-6">
              <p className="text-[10px] uppercase tracking-[0.18em] text-brand-accent-text">
                {content.readingEyebrow}
              </p>
              <h2 className="mt-3 text-[22px] font-semibold text-text-dark-primary">
                {content.readingTitle}
              </h2>
              <ul className="mt-6 divide-y divide-brand-border/60">
                {content.readingItems.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 py-4 text-[11px] leading-relaxed text-text-dark-secondary first:pt-0"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href={localePath(locale, "/blog/evidence-first-growth-experiments")}
                className="mt-5 inline-flex items-center gap-2 text-[11px] font-semibold text-brand-accent-text hover:text-brand-accent-hover"
              >
                {content.readingCta}
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
                  {content.ctaEyebrow}
                </p>
                <h2 className="mt-3 max-w-2xl text-[28px] font-semibold leading-tight tracking-[-0.035em] text-text-dark-primary">
                  {content.ctaTitle}
                </h2>
                <p className="mt-4 max-w-2xl text-[11px] leading-relaxed text-text-dark-secondary">
                  {content.ctaBody}
                </p>
              </div>
              <Link
                href={siteConfig.appUrl}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 py-3 text-[12px] font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {content.ctaButton}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
