// @input  -- locale param, tools i18n namespace, site config, shared ToolCard
// @output -- tools hub grouped by a visitor's current SEO/growth situation
// @pos    -- free-tool continuation hub between acquisition pages and GenGrowth
import { ArrowRight, Compass, ScanSearch } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ToolCard } from "@/components/tools/tool-card";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { localePath, localeUrl } from "@/lib/locale-path";

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
    titleKey: "internalLinkAudit.title",
    descKey: "internalLinkAudit.description",
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
    titleKey: "seoAudit.title",
    descKey: "seoAudit.description",
    category: "diagnosis",
  },
] as const;

const PLANNING_TOOLS = [
  {
    slug: "hidden-keywords",
    title: { en: "Keyword Opportunity Map", zh: "关键词机会地图" },
    description: {
      en: "Turn site context into keyword directions only after demand signals are verified.",
      zh: "先验证需求信号，再把网站上下文转为关键词方向。",
    },
    // The tool has not shipped; the card must say so instead of implying a
    // gate the visitor can pass today. The page carries the waitlist form.
    status: { en: "Coming soon", zh: "即将上线" },
    cta: { en: "Join the waitlist", zh: "加入等待列表" },
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
    title: locale === "en" ? "Free SEO & Growth Tools" : "免费 SEO 与增长工具",
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
  const tools =
    locale === "en" ? "Free SEO & Growth Tools" : "免费 SEO 与增长工具";

  return (
    /* 顶部间距只留 36px：PageShell 已经为 fixed 导航垫了 68px */
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="max-w-report mx-auto px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[{ name: home, url: localeUrl(locale) }, { name: tools }]}
        />
        <VisibleBreadcrumb
          items={[{ label: home, href: localePath(locale) }, { label: tools }]}
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
                title={
                  "title" in tool
                    ? tool.title[locale as "en" | "zh"]
                    : t(tool.titleKey)
                }
                description={
                  "description" in tool
                    ? tool.description[locale as "en" | "zh"]
                    : t(tool.descKey)
                }
                category={tool.category}
                locale={locale}
                ctaLabel={
                  "cta" in tool ? tool.cta[locale as "en" | "zh"] : undefined
                }
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
                statusLabel={tool.status[locale as "en" | "zh"]}
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
              href={siteConfig.appUrl}
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
