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
    /* 顶部间距只留 36px：PageShell 已经为 fixed 导航垫了 68px */
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="max-w-report mx-auto px-6 md:px-8">
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

        <header className="relative overflow-hidden border-b border-brand-border pt-7 pb-12 md:pb-14">
          {/* GLOW_01 — 页级 hero 才允许的网格底 */}
          <div
            aria-hidden="true"
            className="bg-signal-grid absolute inset-0 opacity-40"
          />
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 hidden w-[46%] md:block"
          >
            <svg
              viewBox="0 0 500 330"
              className="h-full w-full opacity-75"
              preserveAspectRatio="xMidYMid meet"
            >
              <g fill="none" stroke="#24303E" strokeWidth="1.2">
                <path d="M250 165 C190 104 122 90 67 58" />
                <path d="M250 165 C176 165 122 185 58 218" />
                <path d="M250 165 C316 114 363 88 430 62" />
                <path d="M250 165 C333 172 382 205 448 245" />
                <path d="M67 58 C96 130 85 170 58 218" />
                <path d="M430 62 C392 128 398 188 448 245" />
              </g>
              {/* GLOW_03 — 每屏最多一处数据高亮：主枢纽节点 */}
              <circle cx="250" cy="165" r="46" fill="#3DDC97" opacity=".1" />
              <g fill="#3DDC97">
                <circle cx="250" cy="165" r="24" />
                <circle cx="67" cy="58" r="13" opacity=".6" />
                <circle cx="430" cy="62" r="16" opacity=".75" />
              </g>
              <g fill="#4CC3FA">
                <circle cx="58" cy="218" r="11" opacity=".5" />
                <circle cx="448" cy="245" r="13" opacity=".42" />
              </g>
              <g
                fill="none"
                stroke="#F09090"
                strokeDasharray="5 6"
                strokeWidth="1.5"
              >
                <circle cx="366" cy="276" r="27" />
                <circle cx="112" cy="282" r="21" />
              </g>
            </svg>
          </div>

          <div className="relative z-10 max-w-[720px]">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {content.eyebrow}
            </p>
            <h1 className="text-page-title mt-4 max-w-3xl text-text-dark-primary">
              {content.title}
            </h1>
            <p className="mt-5 max-w-[650px] text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
              {content.subtitle}
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              {/* 次按钮：真正的主 CTA 是下方工具面板里的那颗渐变提交按钮，
                  一屏只允许一个渐变，所以这颗锚点按钮走描边。 */}
              <a
                href="#internal-link-audit-tool"
                className="inline-flex h-11.5 w-fit items-center justify-center gap-2 rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-6 text-[14px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {content.primaryCta}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <p className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {content.trustLine}
              </p>
            </div>
          </div>
        </header>

        <main>
          <section className="pt-9">
            <InternalLinkAuditTool locale={locale} />
          </section>

          <section className="mt-18 border-t border-brand-border pt-14">
            <div className="grid gap-9 md:grid-cols-[0.72fr_1.28fr]">
              <div className="md:sticky md:top-24 md:self-start">
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {content.howEyebrow}
                </p>
                <h2 className="mt-2 max-w-sm text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                  {content.howTitle}
                </h2>
                <p className="mt-3 max-w-sm text-[13px] leading-[1.6] text-text-dark-secondary">
                  {content.howIntro}
                </p>
              </div>
              {/* 伪表格：这几步是一条有序链路，共享外框 + 1px 分隔线 */}
              <ol className="grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card">
                {content.howSteps.map((step, index) => (
                  <li
                    key={step.title}
                    className="grid gap-4 bg-brand-panel-sunken p-5 sm:grid-cols-[48px_1fr] sm:p-6"
                  >
                    <span className="font-mono text-[10.5px] tracking-[0.08em] text-brand-accent-text">
                      0{index + 1}
                    </span>
                    <article>
                      <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                        {step.title}
                      </h3>
                      <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                        {step.body}
                      </p>
                    </article>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="mt-18">
            <div className="max-w-2xl">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {content.findsEyebrow}
              </p>
              <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {content.findsTitle}
              </h2>
              <p className="mt-3 text-[13px] leading-[1.6] text-text-dark-secondary">
                {content.findsIntro}
              </p>
            </div>
            {/*
             * 九条发现进两列会余一格，而伪表格的底色就是分隔线颜色，空格子会变成
             * 一块比单元格更亮的实心矩形。两列时让末格跨满，三列时 9 恰好整除，
             * 必须显式跨回一格，否则 lg 下会多占一列。
             */}
            <div className="mt-7 grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card md:grid-cols-2 md:[&>*:last-child]:col-span-2 lg:grid-cols-3 lg:[&>*:last-child]:col-span-1">
              {content.findings.map((finding, index) => (
                <article
                  key={finding.title}
                  className="min-h-[180px] bg-brand-panel-sunken p-[22px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] tracking-[0.12em] text-text-dark-faint uppercase">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {index % 3 === 0 ? (
                      <CircleSlash2
                        aria-hidden="true"
                        className="size-4 text-brand-accent-text/70"
                      />
                    ) : index % 3 === 1 ? (
                      <Network
                        aria-hidden="true"
                        className="size-4 text-brand-accent-text/70"
                      />
                    ) : (
                      <Route
                        aria-hidden="true"
                        className="size-4 text-brand-accent-text/70"
                      />
                    )}
                  </div>
                  <h3 className="mt-6 text-[15.5px] leading-snug font-semibold text-text-dark-primary">
                    {finding.title}
                  </h3>
                  <p className="mt-2.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                    {finding.body}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-18 grid gap-4 lg:grid-cols-2">
            <div className="rounded-card border border-brand-accent/50 bg-brand-accent/[0.08] p-[26px] shadow-[inset_2px_0_0_#3DDC97]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {content.methodEyebrow}
              </p>
              <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {content.methodTitle}
              </h2>
              <div className="mt-6 divide-y divide-brand-border-faint">
                {content.methods.map((method) => (
                  <article key={method.title} className="py-4 first:pt-0">
                    <h3 className="text-[13.5px] font-semibold text-text-dark-primary">
                      {method.title}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {method.body}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-warning uppercase">
                {content.limitsEyebrow}
              </p>
              <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {content.limitsTitle}
              </h2>
              <div className="mt-6 divide-y divide-brand-border-faint">
                {content.limitations.map((limitation) => (
                  <article key={limitation.title} className="py-4 first:pt-0">
                    <h3 className="flex items-start gap-2 text-[13.5px] font-semibold text-text-dark-primary">
                      <FileQuestion
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0 text-brand-warning"
                      />
                      {limitation.title}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {limitation.body}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-18 border-y border-brand-border py-14">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {content.audienceEyebrow}
                </p>
                <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                  {content.audienceTitle}
                </h2>
                <p className="mt-3 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {content.audienceBody}
                </p>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                {content.fitSignals.map((signal) => (
                  <article
                    key={signal.title}
                    className="rounded-card border border-brand-border-card bg-brand-panel p-[22px] transition-colors hover:border-brand-accent/40"
                  >
                    <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                      {signal.title}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {signal.body}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-18">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {content.faqEyebrow}
            </p>
            <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {content.faqTitle}
            </h2>
            <div className="mt-6 divide-y divide-brand-border-faint border-y border-brand-border">
              {content.faqs.map((faq, index) => (
                <details key={faq.question} className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-4 py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
                    <span className="mt-0.5 font-mono text-[10px] tracking-[0.08em] text-text-dark-faint">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="min-w-0 flex-1 text-[13.5px] font-medium text-text-dark-primary">
                      {faq.question}
                    </h3>
                    <span
                      aria-hidden="true"
                      className="text-[18px] leading-none text-text-dark-secondary transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-3xl pb-6 pl-10 text-[12.5px] leading-[1.65] text-text-dark-secondary">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </section>

          <section className="mt-18 grid gap-4 lg:grid-cols-2">
            <article className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {content.relatedEyebrow}
              </p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {content.relatedTitle}
              </h2>
              <div className="mt-5 space-y-3">
                {content.relatedItems.map((item) => (
                  <Link
                    key={item.slug}
                    href={localePath(locale, `/tools/${item.slug}`)}
                    className="block rounded-row border border-brand-border bg-brand-panel-raised p-[18px] transition-colors hover:border-brand-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                  >
                    <span className="flex items-center gap-2 text-[13.5px] font-semibold text-text-dark-primary">
                      <Link2
                        aria-hidden="true"
                        className="size-4 shrink-0 text-brand-accent-text"
                      />
                      {item.title}
                    </span>
                    <span className="mt-2 block text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {item.body}
                    </span>
                  </Link>
                ))}
              </div>
              <Link
                href={localePath(locale, "/tools")}
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-2 uppercase transition-colors hover:text-brand-info"
              >
                {content.relatedTools}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </article>

            <article className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {content.readingEyebrow}
              </p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {content.readingTitle}
              </h2>
              <ul className="mt-5 divide-y divide-brand-border-faint">
                {content.readingItems.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 py-3.5 text-[12.5px] leading-[1.6] text-text-dark-strong first:pt-0"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-accent"
                    />
                    {item}
                  </li>
                ))}
              </ul>
              <Link
                href={localePath(
                  locale,
                  "/blog/evidence-first-growth-experiments",
                )}
                className="mt-5 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
              >
                {content.readingCta}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </article>
          </section>

          {/* 「下一步」容器走虚线 + 微渐变底，与实线的内容卡片区分开 */}
          <section className="mt-18 rounded-[16px] border border-dashed border-brand-border-dashed bg-[linear-gradient(135deg,rgba(61,220,151,0.04),rgba(76,195,250,0.05))] p-7 md:p-10">
            <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {content.ctaEyebrow}
                </p>
                <h2 className="mt-3 max-w-2xl text-[27px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                  {content.ctaTitle}
                </h2>
                <p className="mt-3 max-w-2xl text-[13px] leading-[1.65] text-text-dark-secondary">
                  {content.ctaBody}
                </p>
              </div>
              <Link
                href={siteConfig.appUrl}
                className="inline-flex h-11.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {content.ctaButton}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
