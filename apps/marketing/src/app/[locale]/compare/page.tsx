// @input  -- locale param, compare i18n namespace, siteConfig, comparison slugs
// @output -- compare index page listing all comparison articles as cards
// @pos    -- programmatic SEO, comparison landing page for organic traffic
// once this file is updated, update header comments and _DIR.md in this folder
import { getTranslations } from "next-intl/server";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import Link from "next/link";
import { COMPARISON_SLUGS } from "@/lib/mock/compare-content";

const PATH = "/compare";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "compare" });

  return generatePageMetadata({
    title:
      locale === "en"
        ? "Compare GenGrowth -- GenGrowth"
        : "GenGrowth 对比 -- GenGrowth",
    description: t("subtitle"),
    locale,
    path: PATH,
  });
}

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "compare" });

  const tCommon = await getTranslations({ locale, namespace: "common" });
  const homeLabel = tCommon("home");
  const compareLabel = t("title");

  const cards = await Promise.all(
    COMPARISON_SLUGS.map(async (slug) => {
      const ts = await getTranslations({
        locale,
        namespace: `compare.${slug}`,
      });
      return {
        slug,
        title: ts("heroTitle"),
        description: ts("heroDescription"),
      };
    }),
  );

  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: homeLabel, url: `${siteConfig.url}/${locale}` },
          { name: compareLabel },
        ]}
      />
      <VisibleBreadcrumb
        items={[
          { label: homeLabel, href: `/${locale}` },
          { label: compareLabel },
        ]}
      />

      {/* Hero */}
      <div className="mb-12">
        <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
          {t("title")}
        </h1>
        <p className="text-text-dark-secondary text-[15px]">{t("subtitle")}</p>
      </div>

      {/* Comparison cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map((card) => (
          <Link
            key={card.slug}
            href={`/${locale}/compare/${card.slug}`}
            className="group block"
          >
            <article className="h-full rounded-xl border border-brand-border/60 bg-brand-bg-alt/30 p-6 transition-all duration-200 group-hover:border-brand-accent/50 group-hover:bg-brand-bg-alt/60">
              <h2 className="text-text-dark-primary font-semibold text-[17px] leading-snug mb-2 group-hover:text-brand-accent-text transition-colors">
                {card.title}
              </h2>
              <p className="text-text-dark-secondary text-[13px] leading-relaxed mb-4">
                {card.description}
              </p>
              <span className="text-brand-accent-text text-[13px] font-medium opacity-0 -translate-x-1 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 inline-block">
                {t("readComparison")} &rarr;
              </span>
            </article>
          </Link>
        ))}
      </div>
    </>
  );
}
