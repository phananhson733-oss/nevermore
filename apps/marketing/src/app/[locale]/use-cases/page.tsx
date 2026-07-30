// @input  -- locale param, use-cases data layer, next-intl
// @output -- use cases index page with card grid
// @pos    -- programmatic SEO, use case landing pages
// once this file is updated, update header comments and _DIR.md in this folder
import { getTranslations } from "next-intl/server";
import { getUseCases } from "@/lib/use-cases";
import { UseCaseCard } from "@/components/use-cases/use-case-card";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "useCases" });

  return generatePageMetadata({
    title: locale === "en" ? "Use Cases -- GenGrowth" : "应用场景 -- GenGrowth",
    description: t("subtitle"),
    locale,
    path: "/use-cases",
  });
}

export default async function UseCasesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "useCases" });
  const useCases = getUseCases();

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">
        <BreadcrumbJsonLd
          items={[
            {
              name: locale === "en" ? "Home" : "首页",
              url: `${siteConfig.url}/${locale}`,
            },
            { name: locale === "en" ? "Use Cases" : "应用场景" },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: locale === "en" ? "Home" : "首页", href: `/${locale}` },
            {
              label: locale === "en" ? "Use Cases" : "应用场景",
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

        {/* Use case card grid */}
        {useCases.length === 0 ? (
          <p className="text-text-dark-secondary text-[15px] py-16 text-center">
            {locale === "en" ? "No use cases found." : "未找到应用场景。"}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {useCases.map((uc) => (
              <UseCaseCard key={uc.slug} useCase={uc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
