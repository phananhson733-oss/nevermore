// @input  -- locale param, category query param, glossary data layer
// @output -- glossary index page with category filter and alpha navigation
// @pos    -- programmatic SEO, long-tail keyword landing pages
// once this file is updated, update header comments and _DIR.md in this folder
import { getTranslations } from "next-intl/server";
import { getGlossaryTerms } from "@/lib/glossary";
import type { GlossaryTerm } from "@/lib/glossary";
import { GlossaryCard } from "@/components/glossary/glossary-card";
import { GlossarySidebar } from "@/components/glossary/glossary-sidebar";
import { generatePageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import Link from "next/link";

const CATEGORIES = [
  "metrics",
  "strategy",
  "technical",
  "methodology",
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "glossary" });

  return generatePageMetadata({
    title:
      locale === "en"
        ? "Growth Glossary -- GenGrowth"
        : "增长术语库 -- GenGrowth",
    description: t("subtitle"),
    locale,
    path: "/glossary",
  });
}

export default async function GlossaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { locale } = await params;
  const { category } = await searchParams;
  const t = await getTranslations({ locale, namespace: "glossary" });

  const validCategory = CATEGORIES.includes(
    category as (typeof CATEGORIES)[number],
  )
    ? category
    : undefined;

  const terms = await getGlossaryTerms(locale, validCategory);

  const groupedTerms = groupByLetter(terms);

  return (
    <div className="bg-brand-bg min-h-screen py-20 md:py-28">
      <div className="max-w-[1080px] mx-auto px-6">
        <BreadcrumbJsonLd
          items={[
            {
              name: locale === "en" ? "Home" : "首页",
              url: `${siteConfig.url}/${locale}`,
            },
            { name: locale === "en" ? "Growth Glossary" : "增长术语库" },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: locale === "en" ? "Home" : "首页", href: `/${locale}` },
            {
              label: locale === "en" ? "Growth Glossary" : "增长术语库",
            },
          ]}
        />

        {/* Hero */}
        <div className="mb-12">
          <h1 className="text-text-dark-primary font-bold text-[28px] md:text-[36px] tracking-[-0.02em] mb-3">
            {t("title")}
          </h1>
          <p className="text-text-dark-secondary text-[15px] mb-2">
            {t("subtitle")}
          </p>
          <p className="text-text-dark-secondary/60 text-[13px]">
            {t("termCount", { count: terms.length })}
          </p>
        </div>

        {/* Category filter tabs */}
        <div className="flex flex-wrap gap-2 mb-10 border-b border-brand-border/40 pb-4">
          <Link
            href={`/${locale}/glossary`}
            className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
              !validCategory
                ? "bg-brand-accent text-white"
                : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
            }`}
          >
            {t("allCategories")}
          </Link>
          {CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={`/${locale}/glossary?category=${cat}`}
              className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                validCategory === cat
                  ? "bg-brand-accent text-white"
                  : "text-text-dark-secondary hover:text-text-dark-primary hover:bg-brand-bg-alt"
              }`}
            >
              {t(cat)}
            </Link>
          ))}
        </div>

        {/* Main content: sidebar + cards */}
        <div className="flex gap-8">
          <GlossarySidebar terms={terms} />

          <div className="flex-1 min-w-0">
            {terms.length === 0 ? (
              <p className="text-text-dark-secondary text-[15px] py-16 text-center">
                {locale === "en" ? "No terms found." : "未找到术语。"}
              </p>
            ) : (
              <div className="space-y-10">
                {Object.entries(groupedTerms).map(([letter, letterTerms]) => (
                  <section key={letter} id={`letter-${letter}`}>
                    <h2 className="text-brand-accent font-bold text-[22px] mb-4 border-b border-brand-border/30 pb-2">
                      {letter}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {letterTerms.map((term) => (
                        <GlossaryCard
                          key={term.id}
                          term={term}
                          locale={locale}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function groupByLetter(
  terms: GlossaryTerm[],
): Record<string, GlossaryTerm[]> {
  const groups: Record<string, GlossaryTerm[]> = {};
  for (const term of terms) {
    const letter = term.term.charAt(0).toUpperCase();
    if (!groups[letter]) {
      groups[letter] = [];
    }
    groups[letter] = [...groups[letter], term];
  }
  return groups;
}
