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
    title: { en: "SEO Quick Wins", zh: "SEO Quick Wins" },
    description: {
      en: "Find high-impression pages with click opportunities from your own Search Console data.",
      zh: "用自己的 Search Console 数据找出曝光高、存在点击机会的页面。",
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
    cta: { en: "Check availability", zh: "查看可用性" },
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
      locale === "en"
        ? "Free SEO & Growth Tools"
        : "免费 SEO 与增长工具",
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
  const tools = locale === "en" ? "Free SEO & Growth Tools" : "免费 SEO 与增长工具";

  return (
    <div className="min-h-screen bg-brand-bg pb-24 pt-20 md:pt-28">
      <div className="mx-auto max-w-[1080px] px-5 sm:px-6">
        <BreadcrumbJsonLd
          items={[
            { name: home, url: localeUrl(locale) },
            { name: tools },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: home, href: localePath(locale) },
            { label: tools },
          ]}
        />

        <header className="relative mb-16 overflow-hidden border-b border-brand-border/60 pb-12 pt-7 md:pb-16 md:pt-12">
          <div
            aria-hidden="true"
            className="absolute -right-12 top-6 hidden size-72 rounded-full border border-brand-accent/20 bg-brand-accent/[0.035] md:block"
          />
          <div className="relative max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-accent-text">
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-[38px] font-bold leading-[1.02] tracking-[-0.04em] text-text-dark-primary md:text-[54px]">
              {t("title")}
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-text-dark-secondary md:text-[17px]">
              {t("subtitle")}
            </p>
          </div>
        </header>

        <section aria-labelledby="site-diagnosis-tools">
          <div className="mb-7 grid gap-5 md:grid-cols-[auto_1fr] md:items-end">
            <div className="flex size-11 items-center justify-center rounded-xl border border-brand-accent/30 bg-brand-accent/10 text-brand-accent-text">
              <ScanSearch aria-hidden="true" className="size-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-brand-accent-text">
                {t("diagnoseEyebrow")}
              </p>
              <h2 id="site-diagnosis-tools" className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {t("diagnoseTitle")}
              </h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
                {t("diagnoseBody")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {DIAGNOSIS_TOOLS.map((tool) => (
              <ToolCard
                key={tool.slug}
                slug={tool.slug}
                title={"title" in tool ? tool.title[locale as "en" | "zh"] : t(tool.titleKey)}
                description={"description" in tool ? tool.description[locale as "en" | "zh"] : t(tool.descKey)}
                category={tool.category}
                locale={locale}
                ctaLabel={"cta" in tool ? tool.cta[locale as "en" | "zh"] : undefined}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="planning-tools" className="mt-20 border-t border-brand-border/60 pt-14">
          <div className="mb-7 grid gap-5 md:grid-cols-[auto_1fr] md:items-end">
            <div className="flex size-11 items-center justify-center rounded-xl border border-brand-border bg-brand-bg-alt text-text-dark-secondary">
              <Compass aria-hidden="true" className="size-5" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-brand-accent-text">
                {t("planEyebrow")}
              </p>
              <h2 id="planning-tools" className="mt-2 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
                {t("planTitle")}
              </h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
                {t("planBody")}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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

        <section className="relative mt-20 overflow-hidden rounded-3xl border border-brand-accent/25 bg-brand-accent/[0.06] p-7 md:p-10">
          <div aria-hidden="true" className="absolute -right-16 -top-20 size-64 rounded-full border border-brand-accent/20" />
          <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-text">
                {t("productCtaEyebrow")}
              </p>
              <h2 className="mt-3 text-[27px] font-semibold tracking-[-0.035em] text-text-dark-primary">
                {t("productCtaTitle")}
              </h2>
              <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-text-dark-secondary">
                {t("productCtaBody")}
              </p>
            </div>
            <a
              href={siteConfig.appUrl}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-accent px-5 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
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
