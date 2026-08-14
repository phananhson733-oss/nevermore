// @input  -- locale route param、prompts 内容库与 prompts/common 翻译命名空间
// @output -- /prompts 提示词库 hub（筛选网格 + FAQ + ItemList/Breadcrumb/FAQPage 结构化数据）
// @pos    -- 提示词资源库入口，Resources hub 的 prompts 落点
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { ResourceLibrary } from "@/components/resources/resource-library";
import type { ResourceCardItem } from "@/components/resources/resource-card";
import { ResourceFaqSection } from "@/components/resources/resource-faq";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { safeJsonLd } from "@/components/seo/json-ld/utils";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { getPromptsForLocale } from "@/lib/prompt-content";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";
import { PROMPT_CATEGORIES } from "@/types/resource";

const PATH = "/prompts";

const HUB_FAQ_KEYS = ["cost", "difference", "edit", "updates"] as const;

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "prompts" });

  return generatePageMetadata({
    title: t("metadata.title"),
    description: t("metadata.description"),
    locale,
    path: PATH,
  });
}

export default async function PromptsHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "prompts" });
  const tCommon = await getTranslations({ locale, namespace: "common" });
  const { hasFallback, prompts } = await getPromptsForLocale(locale);

  const items: readonly ResourceCardItem[] = prompts.map((prompt) => ({
    slug: prompt.slug,
    href: localePath(locale, `${PATH}/${prompt.slug}`),
    title: prompt.title,
    description: prompt.description,
    categoryId: prompt.category,
    categoryLabel: t(`categories.${prompt.category}`),
    metaLabel: prompt.outputFormat,
    chipsLabel: t("card.models"),
    chips: prompt.models,
  }));

  const categories = PROMPT_CATEGORIES.map((category) => ({
    id: category,
    label: t(`categories.${category}`),
  }));

  const faqs = HUB_FAQ_KEYS.map((key) => ({
    question: t(`faq.items.${key}.q`),
    answer: t(`faq.items.${key}.a`),
  }));

  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t("metadata.title"),
    description: t("metadata.description"),
    numberOfItems: prompts.length,
    itemListElement: prompts.map((prompt, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: prompt.title,
      description: prompt.description,
      url: localeUrl(locale, `${PATH}/${prompt.slug}`),
    })),
  };

  return (
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="mx-auto max-w-report px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: tCommon("home"), url: localeUrl(locale) },
            { name: t("eyebrow"), url: localeUrl(locale, PATH) },
          ]}
        />
        <FaqPageJsonLd
          faqs={faqs.map((faq) => ({ q: faq.question, a: faq.answer }))}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(itemListLd) }}
        />
        <VisibleBreadcrumb
          items={[
            { label: tCommon("home"), href: localePath(locale) },
            { label: t("eyebrow") },
          ]}
        />

        <header className="relative overflow-hidden border-b border-brand-border pt-7 pb-12 md:pb-14">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-signal-grid opacity-40"
          />
          <div className="relative max-w-[760px]">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-page-title text-text-dark-primary">
              {t("title")}
            </h1>
            <p className="mt-5 text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
              {t("subtitle")}
            </p>
            {hasFallback && (
              <p className="mt-5 border-l-2 border-brand-border-dashed pl-4 font-mono text-[11px] leading-[1.6] text-text-dark-secondary">
                {t("contentLanguageNote")}
              </p>
            )}
          </div>
        </header>

        <div className="pt-12 md:pt-14">
          <ResourceLibrary
            items={items}
            categories={categories}
            allLabel={t("all")}
            filterLabel={t("filterLabel")}
            emptyLabel={t("empty")}
          />

          <section className="mt-16 grid min-w-0 gap-10 border-t border-brand-border pt-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
            <ResourceFaqSection
              faqs={faqs}
              eyebrow={t("faq.eyebrow")}
              title={t("faq.title")}
              headingId="prompts-faq"
            />

            <aside className="min-w-0 self-start rounded-card border border-brand-border-card bg-brand-panel p-6 md:p-7">
              <h2 className="text-[19px] font-semibold text-text-dark-primary">
                {t("cta.title")}
              </h2>
              <p className="mt-3 text-[13.5px] leading-[1.7] text-text-dark-secondary">
                {t("cta.body")}
              </p>
              <Link
                href={localePath(locale, "/agents")}
                className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-5 text-[13.5px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-accent"
              >
                {t("cta.action")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </aside>
          </section>
        </div>
      </div>
    </div>
  );
}
