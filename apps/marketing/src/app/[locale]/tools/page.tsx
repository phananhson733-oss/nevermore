// @input  -- locale param, tools i18n namespace, shared ToolCard
// @output -- Resources > Tools hub grouped by a visitor's current SEO/growth situation
// @pos    -- Resources branch; URL-audit cards hand off to independent Agents
import { ArrowRight, Compass, ScanSearch } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ToolCard } from "@/components/tools/tool-card";
import { generatePageMetadata } from "@/lib/seo";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { localePath, localeUrl } from "@/lib/locale-path";
import { GoogleOneTap } from "@/components/auth/google-one-tap";

const DIAGNOSIS_TOOLS = [
  {
    slug: "seo-quick-wins",
    // Naming table 2026-08-06: the card carries the formal name in both
    // locales; the search-phrase Title/H1 stay on the tool page itself.
    title: { en: "GSC Opportunity Finder", zh: "GSC Opportunity Finder" },
    description: {
      en: "Find high-impression queries with click opportunities from your own Search Console data.",
      zh: "用自己的 Search Console 数据找出曝光高、存在点击机会的查询词。",
    },
    cta: { en: "Connect Search Console", zh: "连接 Search Console" },
    category: "diagnosis",
  },
  {
    slug: "internal-link-audit",
    title: { en: "Internal Link Audit", zh: "内链审计" },
    description: {
      en: "Review crawl, indexability, and internal-link evidence in the Tech Agent. A verified account is required to run it.",
      zh: "在 Tech Agent 中检查抓取、可索引性与内链证据；运行时需要已验证账号。",
    },
    cta: { en: "Open Tech Agent", zh: "打开 Tech Agent" },
    category: "diagnosis",
  },
  {
    slug: "traffic-drop-diagnosis",
    title: { en: "Traffic Drop Diagnosis", zh: "流量下降诊断" },
    description: {
      en: "Compare Search Console periods before deciding why organic traffic changed.",
      zh: "先比较 Search Console 时间段，再判断自然流量为何变化。",
    },
    cta: { en: "Connect Search Console", zh: "连接 Search Console" },
    category: "diagnosis",
  },
  {
    slug: "seo-audit",
    title: { en: "Site-wide SEO Audit", zh: "全站 SEO 审计" },
    description: {
      en: "Review metadata, heading structure, and structured-data evidence in the SEO Agent. A verified account is required to run it.",
      zh: "在 SEO Agent 中检查元数据、标题结构与结构化数据证据；运行时需要已验证账号。",
    },
    cta: { en: "Open SEO Agent", zh: "打开 SEO Agent" },
    category: "diagnosis",
  },
] as const;

const PLANNING_TOOLS = [
  {
    slug: "low-competition-keywords",
    title: { en: "Keyword Opportunity Map", zh: "关键词机会地图" },
    description: {
      // Not "only after demand signals are verified": the GEO lane is
      // deliberately not gated on demand data, so that promise is broken by
      // every question-form row the tool is designed to return.
      en: "Reads your site, then shows search terms with measured demand and a weak site already on page one, plus the questions your pages already answer.",
      zh: "先读你的站点，再给出「有实测搜索量、且第一页已经有弱站」的词，以及你的页面已经能回答的问题。",
    },
    cta: { en: "Connect Search Console", zh: "连接 Search Console" },
    category: "planning",
  },
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });

  return generatePageMetadata({
    title:
      locale === "en" ? "Supporting SEO & Growth Tools" : "SEO 与增长辅助工具",
    description: t("subtitle"),
    locale,
    path: "/tools",
  });
}

export default async function ToolsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "tools" });
  const home = locale === "en" ? "Home" : "首页";
  const resources = locale === "en" ? "Resources" : "资源";
  const tools =
    locale === "en" ? "Supporting SEO & Growth Tools" : "SEO 与增长辅助工具";

  return (
    /* 顶部间距只留 36px：PageShell 已经为 fixed 导航垫了 68px */
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="max-w-report mx-auto px-6 md:px-8">
        {/* See the homepage: One Tap is scoped to pages where signing in
            is plausibly the next step. */}
        <GoogleOneTap />
        <BreadcrumbJsonLd
          items={[
            { name: home, url: localeUrl(locale) },
            { name: resources, url: localeUrl(locale, "/resources") },
            { name: tools },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: home, href: localePath(locale) },
            {
              label: resources,
              href: localePath(locale, "/resources"),
            },
            { label: tools },
          ]}
        />

        <header className="relative mb-14 overflow-hidden border-b border-brand-border pt-7 pb-12 md:pb-14">
          {/* GLOW_01 — 页级 hero 才允许的网格 + 氛围光 */}
          <div
            aria-hidden="true"
            className="bg-signal-grid absolute inset-0 opacity-40"
          />
          <div
            aria-hidden="true"
            className="absolute -top-30 right-[4%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
          />
          <div className="relative max-w-3xl">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-text-dark-primary">{t("title")}</h1>
            <p className="mt-5 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
              {t("subtitle")}
            </p>
          </div>
        </header>

        <section aria-labelledby="site-diagnosis-tools">
          <div className="mb-7 grid gap-5 md:grid-cols-[auto_1fr] md:items-end">
            <div className="flex size-11 items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent">
              <ScanSearch aria-hidden="true" className="size-[18px]" />
            </div>
            <div>
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("diagnoseEyebrow")}
              </p>
              <h2
                id="site-diagnosis-tools"
                className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary"
              >
                {t("diagnoseTitle")}
              </h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
                {t("diagnoseBody")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {DIAGNOSIS_TOOLS.map((tool) => (
              <ToolCard
                key={tool.slug}
                slug={tool.slug}
                title={tool.title[locale as "en" | "zh"]}
                description={tool.description[locale as "en" | "zh"]}
                category={tool.category}
                locale={locale}
                ctaLabel={tool.cta[locale as "en" | "zh"]}
              />
            ))}
          </div>
        </section>

        <section
          aria-labelledby="planning-tools"
          className="mt-18 border-t border-brand-border pt-14"
        >
          <div className="mb-7 grid gap-5 md:grid-cols-[auto_1fr] md:items-end">
            <div className="flex size-11 items-center justify-center rounded-[10px] border border-brand-border-strong bg-brand-panel text-text-dark-secondary">
              <Compass aria-hidden="true" className="size-[18px]" />
            </div>
            <div>
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("planEyebrow")}
              </p>
              <h2
                id="planning-tools"
                className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary"
              >
                {t("planTitle")}
              </h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
                {t("planBody")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {PLANNING_TOOLS.map((tool) => (
              <ToolCard
                key={tool.slug}
                slug={tool.slug}
                title={tool.title[locale as "en" | "zh"]}
                description={tool.description[locale as "en" | "zh"]}
                category={tool.category}
                locale={locale}
                ctaLabel={tool.cta[locale as "en" | "zh"]}
              />
            ))}
          </div>
        </section>

        {/* 「下一步」容器走虚线 + 微渐变底，与实线的工具卡片区分开 */}
        <section className="mt-18 rounded-[16px] border border-dashed border-brand-border-dashed bg-[linear-gradient(135deg,rgba(61,220,151,0.04),rgba(76,195,250,0.05))] p-7 md:p-10">
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("productCtaEyebrow")}
              </p>
              <h2 className="mt-3 text-[27px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {t("productCtaTitle")}
              </h2>
              <p className="mt-3 max-w-2xl text-[13px] leading-[1.65] text-text-dark-secondary">
                {t("productCtaBody")}
              </p>
            </div>
            <a
              href={localePath(locale, "/waitlist")}
              className="inline-flex h-11.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              {t("productCta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
