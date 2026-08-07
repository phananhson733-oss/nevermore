// @input  -- locale param, tools.seoAudit i18n namespace, and siteConfig
// @output -- SEO metadata, JSON-LD, methodology, FAQ, and synchronous site audit
// @pos    -- programmatic SEO detail route for the free site-wide audit tool
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { ArrowRight, FileQuestion } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { SeoAuditTool } from "@/components/tools/seo-audit-tool";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
  HowToJsonLd,
  ToolSoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { siteConfig } from "@/config/site";
import { generatePageMetadata } from "@/lib/seo";
import { localePath, localeUrl } from "@/lib/locale-path";

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
  const messages = await getMessages();
  const home = locale === "en" ? "Home" : "首页";
  const tools = locale === "en" ? "Free Growth Tools" : "免费增长工具";
  const faqs = Array.from({ length: 8 }, (_, offset) => offset + 1).map(
    (index) => ({
      q: t(`faq${index}q`),
      a: t(`faq${index}a`),
    }),
  );

  return (
    /* 顶部间距只留 36px：PageShell 已经为 fixed 导航垫了 68px */
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="max-w-report mx-auto px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: home, url: localeUrl(locale) },
            { name: tools, url: localeUrl(locale, "/tools") },
            { name: t("pageTitle") },
          ]}
        />
        {/* Structured data reuses the strings the page renders, so the schema
            cannot drift from the visible copy. */}
        <ToolSoftwareApplicationJsonLd
          name={t("pageTitle")}
          description={t("metaDescription")}
          url={localeUrl(locale, PATH)}
          featureList={[1, 2, 3, 4, 5].map((index) => t(`signal${index}Title`))}
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
            { label: home, href: localePath(locale) },
            { label: tools, href: localePath(locale, "/tools") },
            { label: t("pageTitle") },
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
              <g fill="none" stroke="#141C26" strokeWidth="1">
                {[72, 132, 192, 252].map((y) => (
                  <path key={y} d={`M42 ${y} H462`} />
                ))}
              </g>
              <g fill="none" stroke="#3DDC97" strokeWidth="2">
                <path d="M58 220 L146 161 L237 191 L333 93 L442 126" />
              </g>
              <g fill="#3DDC97">
                <circle cx="58" cy="220" r="4" opacity=".55" />
                <circle cx="146" cy="161" r="4" opacity=".55" />
                <circle cx="237" cy="191" r="4" opacity=".55" />
                {/* GLOW_03 — 每屏最多一处数据高亮：这条序列的峰值 */}
                <circle cx="333" cy="93" r="13" opacity=".18" />
                <circle cx="333" cy="93" r="5" />
                <circle cx="442" cy="126" r="4" opacity=".55" />
              </g>
              <g fill="#1E2937">
                <rect x="43" y="269" width="72" height="5" rx="2.5" />
                <rect x="126" y="269" width="92" height="5" rx="2.5" />
                <rect x="229" y="269" width="54" height="5" rx="2.5" />
                <rect x="294" y="269" width="126" height="5" rx="2.5" />
              </g>
            </svg>
          </div>

          <div className="relative z-10 max-w-[720px]">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="text-page-title mt-4 max-w-3xl text-text-dark-primary">
              {t("pageTitle")}
            </h1>
            <p className="mt-5 max-w-[650px] text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
              {t("pageSubtitle")}
            </p>
            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              {/* 次按钮：真正的主 CTA 是下方工具面板里的那颗渐变提交按钮，
                  一屏只允许一个渐变，所以这颗锚点按钮走描边。 */}
              <a
                href="#seo-audit-tool"
                className="inline-flex h-11.5 w-fit items-center justify-center gap-2 rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-6 text-[14px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {t("heroCta")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
              <p className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {t("heroTrust")}
              </p>
            </div>
          </div>
        </header>

        <main>
          <section className="pt-9">
            <NextIntlClientProvider
              messages={{ tools: { seoAudit: messages.tools.seoAudit } }}
            >
              <SeoAuditTool locale={locale} />
            </NextIntlClientProvider>
          </section>

          <section className="mt-18 border-t border-brand-border pt-14">
            <div className="grid gap-9 md:grid-cols-[0.72fr_1.28fr]">
              <div className="md:sticky md:top-24 md:self-start">
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {t("methodEyebrow")}
                </p>
                <h2 className="mt-2 max-w-sm text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                  {t("howTitle")}
                </h2>
                <p className="mt-3 max-w-sm text-[13px] leading-[1.6] text-text-dark-secondary">
                  {t("howIntro")}
                </p>
              </div>
              {/* 伪表格：三步是一条有序链路，共享外框 + 1px 分隔线 */}
              <ol className="grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card">
                {[1, 2, 3].map((index) => (
                  <li
                    key={index}
                    className="grid gap-4 bg-brand-panel-sunken p-5 sm:grid-cols-[48px_1fr] sm:p-6"
                  >
                    <p className="font-mono text-[10.5px] tracking-[0.08em] text-brand-accent-text">
                      0{index}
                    </p>
                    <article>
                      <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                        {t(`step${index}Title`)}
                      </h3>
                      <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                        {t(`step${index}Text`)}
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
                {t("signalsEyebrow")}
              </p>
              <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {t("signalsTitle")}
              </h2>
              <p className="mt-3 text-[13px] leading-[1.6] text-text-dark-secondary">
                {t("signalsBody")}
              </p>
            </div>
            {/*
             * 五格进二/三列都会余一格。伪表格的底色就是分隔线颜色，所以空出来的
             * 格子不是留白，而是一块比单元格更亮的实心矩形。让末格跨满剩余列宽，
             * 两个断点下 5%3 和 5%2 都恰好差一格，同一条规则通吃。
             */}
            <div className="mt-7 grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card md:grid-cols-2 md:[&>*:last-child]:col-span-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5].map((index) => (
                <article
                  key={index}
                  className="min-h-[180px] bg-brand-panel-sunken p-[22px]"
                >
                  <p className="font-mono text-[10px] tracking-[0.12em] text-text-dark-faint uppercase">
                    0{index}
                  </p>
                  <h3 className="mt-6 text-[15.5px] leading-snug font-semibold text-text-dark-primary">
                    {t(`signal${index}Title`)}
                  </h3>
                  <p className="mt-2.5 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                    {t(`signal${index}Body`)}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-18 grid gap-4 lg:grid-cols-2">
            <div className="rounded-card border border-brand-accent/50 bg-brand-accent/[0.08] p-[26px] shadow-[inset_2px_0_0_#3DDC97]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("methodTransparencyEyebrow")}
              </p>
              <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {t("methodTransparencyTitle")}
              </h2>
              <div className="mt-6 divide-y divide-brand-border-faint">
                {[1, 2, 3].map((index) => (
                  <article key={index} className="py-4 first:pt-0">
                    <h3 className="text-[13.5px] font-semibold text-text-dark-primary">
                      {t(`method${index}Title`)}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {t(`method${index}Body`)}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-warning uppercase">
                {t("limitsEyebrow")}
              </p>
              <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {t("limitsTitle")}
              </h2>
              <div className="mt-6 divide-y divide-brand-border-faint">
                {[1, 2, 3].map((index) => (
                  <article key={index} className="py-4 first:pt-0">
                    <h3 className="flex items-start gap-2 text-[13.5px] font-semibold text-text-dark-primary">
                      <FileQuestion
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0 text-brand-warning"
                      />
                      {t(`limit${index}Title`)}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {t(`limit${index}Body`)}
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
                  {t("useCasesEyebrow")}
                </p>
                <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                  {t("useCasesTitle")}
                </h2>
                <p className="mt-3 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {t("useCasesBody")}
                </p>
              </div>
              <div className="grid gap-3.5 sm:grid-cols-2">
                {[1, 2, 3].map((index) => (
                  <article
                    key={index}
                    className="rounded-card border border-brand-border-card bg-brand-panel p-[22px] transition-colors hover:border-brand-accent/40"
                  >
                    <p className="font-mono text-[10px] tracking-[0.12em] text-text-dark-faint uppercase">
                      0{index}
                    </p>
                    <h3 className="mt-3 text-[15.5px] font-semibold text-text-dark-primary">
                      {t(`useCase${index}Title`)}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {t(`useCase${index}Body`)}
                    </p>
                  </article>
                ))}
                {[1, 2].map((index) => (
                  <article
                    key={`comparison-${index}`}
                    className="rounded-card border border-brand-border-card bg-brand-panel p-[22px] transition-colors hover:border-brand-accent/40"
                  >
                    <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                      {t(`comparison${index}Title`)}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                      {t(`comparison${index}Body`)}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          {/*
           * 枢纽区块。这一页是唯一触及全部其他工具的入口，所以「每类记录去哪」
           * 只有它讲得通。它替代的是「先修哪个」——记录里刻意没有 score /
           * priority，方向因此由归属给出，不由排序给出。
           *
           * 第 1 条尤其要小心措辞：noindex 是**前提**不是**优先级**。写成
           * 「这些排在最前面」就是在替产品做它拒绝做的判断；写成「它们在其他
           * 问题之前」是陈述逻辑关系，两者差一个词，性质完全不同。
           */}
          <section className="mt-18">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("handoffEyebrow")}
            </p>
            <h2 className="mt-2 max-w-3xl text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {t("handoffTitle")}
            </h2>
            <p className="mt-3 max-w-3xl text-[13px] leading-[1.7] text-text-dark-secondary">
              {t("handoffBody")}
            </p>
            <ol className="mt-7 space-y-3">
              {[1, 2, 3, 4, 5].map((index) => (
                <li
                  key={index}
                  className="rounded-card border border-brand-border-card bg-brand-panel p-[22px]"
                >
                  <h3 className="flex items-baseline gap-3 text-[15.5px] font-semibold text-text-dark-primary">
                    <span
                      aria-hidden="true"
                      className="shrink-0 font-mono text-[10px] tracking-[0.12em] text-text-dark-faint"
                    >
                      0{index}
                    </span>
                    {t(`handoff${index}Title`)}
                  </h3>
                  <p className="mt-2 pl-8 text-[12.5px] leading-[1.7] text-text-dark-secondary">
                    {t(`handoff${index}Body`)}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-18">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("faqEyebrow")}
            </p>
            <h2 className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {t("faqTitle")}
            </h2>
            <div className="mt-6 divide-y divide-brand-border-faint border-y border-brand-border">
              {faqs.map((faq, index) => (
                <details key={faq.q} className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-4 py-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent">
                    <span className="mt-0.5 font-mono text-[10px] tracking-[0.08em] text-text-dark-faint">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="min-w-0 flex-1 text-[13.5px] font-medium text-text-dark-primary">
                      {faq.q}
                    </h3>
                    <span
                      aria-hidden="true"
                      className="text-[18px] leading-none text-text-dark-secondary transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="max-w-3xl pb-6 pl-10 text-[12.5px] leading-[1.65] text-text-dark-secondary">
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </section>

          <section className="mt-18 grid gap-4 lg:grid-cols-2">
            <article className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("relatedToolsEyebrow")}
              </p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {t("relatedToolsTitle")}
              </h2>
              <Link
                href={localePath(locale, "/tools/internal-link-audit")}
                className="mt-5 block rounded-row border border-brand-border bg-brand-panel-raised p-[18px] transition-colors hover:border-brand-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                <span className="flex items-center gap-2 text-[13.5px] font-semibold text-text-dark-primary">
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 text-brand-accent-text"
                  />
                  {t("relatedToolsCta")}
                </span>
                <span className="mt-2 block text-[12.5px] leading-[1.6] text-text-dark-secondary">
                  {t("relatedToolsBody")}
                </span>
              </Link>
              <Link
                href={localePath(locale, "/tools")}
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-2 uppercase transition-colors hover:text-brand-info"
              >
                {tools}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </article>
            <article className="rounded-card border border-brand-border-card bg-brand-panel p-[26px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("articlesEyebrow")}
              </p>
              <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {t("articlesTitle")}
              </h2>
              <p className="mt-3 text-[13px] leading-[1.6] text-text-dark-secondary">
                {t("articlesBody")}
              </p>
              <Link
                href={localePath(
                  locale,
                  "/blog/evidence-first-growth-experiments",
                )}
                className="mt-5 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
              >
                {t("articlesCta")}
                <span aria-hidden="true">&rarr;</span>
              </Link>
            </article>
          </section>

          {/* 「下一步」容器走虚线 + 微渐变底，与实线的内容卡片区分开 */}
          <section className="mt-18 rounded-[16px] border border-dashed border-brand-border-dashed bg-[linear-gradient(135deg,rgba(61,220,151,0.04),rgba(76,195,250,0.05))] p-7 md:p-10">
            <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {t("ctaEyebrow")}
                </p>
                <h2 className="mt-3 max-w-2xl text-[27px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                  {t("ctaTitle")}
                </h2>
                <p className="mt-3 max-w-2xl text-[13px] leading-[1.65] text-text-dark-secondary">
                  {t("ctaBody")}
                </p>
              </div>
              <Link
                href={siteConfig.appUrl}
                className="inline-flex h-11.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {t("ctaButton")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
