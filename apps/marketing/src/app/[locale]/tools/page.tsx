// @input  -- locale param, tools i18n namespace, siteConfig
// @output -- tools index page with hero, tool card grid, and breadcrumb
// @pos    -- programmatic SEO, free tools landing page for organic traffic
// once this file is updated, update header comments and _DIR.md in this folder
import { getTranslations } from "next-intl/server";
import { ToolCard } from "@/components/tools/tool-card";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";

const TOOLS = [
  {
    slug: "ab-test-calculator",
    titleKey: "abTest.title",
    descKey: "abTest.description",
    category: "testing",
  },
  {
    slug: "growth-roi-calculator",
    titleKey: "roi.title",
    descKey: "roi.description",
    category: "analytics",
  },
  {
    slug: "seo-audit",
    titleKey: "seoAudit.title",
    descKey: "seoAudit.description",
    category: "seo",
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
        ? "Free Growth Tools -- GenGrowth"
        : "免费增长工具 -- GenGrowth",
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

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">
        <BreadcrumbJsonLd
          items={[
            {
              name: locale === "en" ? "Home" : "首页",
              url: `${siteConfig.url}/${locale}`,
            },
            {
              name: locale === "en" ? "Free Growth Tools" : "免费增长工具",
            },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: locale === "en" ? "Home" : "首页", href: `/${locale}` },
            {
              label: locale === "en" ? "Free Growth Tools" : "免费增长工具",
            },
          ]}
        />

        {/* Hero */}
        <div className="mb-12">
          <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
            {t("title")}
          </h1>
          <p className="text-text-dark-secondary text-[15px]">
            {t("subtitle")}
          </p>
        </div>

        {/* Tool cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {TOOLS.map((tool) => (
            <ToolCard
              key={tool.slug}
              slug={tool.slug}
              title={t(tool.titleKey)}
              description={t(tool.descKey)}
              category={tool.category}
              locale={locale}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
