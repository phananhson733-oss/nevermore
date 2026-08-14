// @input  -- locale/slug route params、prompts 内容库、skills 内容库与 prompts 翻译命名空间
// @output -- /prompts/[slug] 详情页（提示词正文、变量卡、示例、FAQ 与 CreativeWork/FAQPage/Breadcrumb 结构化数据）
// @pos    -- 提示词库详情路由，承载每条提示词的长尾落地页
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { RelatedResources } from "@/components/resources/related-resources";
import { ResourceCodeBlock } from "@/components/resources/resource-code-block";
import { ResourceFaqSection } from "@/components/resources/resource-faq";
import { ResourceProse } from "@/components/resources/resource-prose";
import { VariableCard } from "@/components/resources/variable-card";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { safeJsonLd } from "@/components/seo/json-ld/utils";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { siteConfig } from "@/config/site";
import { routing } from "@/i18n/routing";
import {
  getPromptForLocale,
  getPromptsForLocale,
  localesOwningPrompt,
} from "@/lib/prompt-content";
import { resourceAlternates } from "@/lib/resource-alternates";
import { getSkillForLocale } from "@/lib/skill-content";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";
import { toPlainText } from "@/lib/resource-markdown";

const PATH = "/prompts";
const RELATED_LIMIT = 6;

export const revalidate = 3600;

/**
 * Pre-render every prompt in every locale. The library falls back to English
 * where a locale has no translated file, so each locale addresses the same set
 * of slugs and both routes are real pages rather than one redirecting to the
 * other.
 */
export async function generateStaticParams() {
  // Per locale, not the English list copied to each: a locale-exclusive file
  // would otherwise render on demand, which is where the cross-library throw
  // stops being a build failure and becomes a production error page.
  const perLocale = await Promise.all(
    routing.locales.map(async (locale) => {
      const { prompts } = await getPromptsForLocale(locale);
      return prompts.map((prompt) => ({ locale, slug: prompt.slug }));
    }),
  );
  return perLocale.flat();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const prompt = await getPromptForLocale(slug, locale);

  if (!prompt) {
    const t = await getTranslations({ locale, namespace: "prompts" });
    return generatePageMetadata({
      title: t("metadata.title"),
      description: t("metadata.description"),
      locale,
      path: `${PATH}/${slug}`,
      noIndex: true,
    });
  }

  const metadata = generatePageMetadata({
    title: prompt.title,
    description: prompt.description,
    locale,
    path: `${PATH}/${slug}`,
  });

  return resourceAlternates({
    metadata,
    locale,
    owningLocale: prompt.locale,
    path: `${PATH}/${slug}`,
    localesOwningFile: await localesOwningPrompt(slug),
  });
}

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const [prompt, { prompts }] = await Promise.all([
    getPromptForLocale(slug, locale),
    getPromptsForLocale(locale),
  ]);

  if (!prompt) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "prompts" });
  const tCommon = await getTranslations({ locale, namespace: "common" });
  const tSkills = await getTranslations({ locale, namespace: "skills" });

  const relatedSkill = prompt.relatedSkill
    ? await getSkillForLocale(prompt.relatedSkill, locale)
    : null;

  // The two libraries cannot validate each other inside their loaders without
  // importing each other, so the check lands here. Rendering nothing would hide
  // a typo: the page would look finished and the link would simply be gone.
  if (prompt.relatedSkill && !relatedSkill) {
    throw new Error(
      `prompts/${prompt.locale}/${prompt.slug}.md: relatedSkill references unknown skill '${prompt.relatedSkill}'.`,
    );
  }

  const bySlug = new Map(prompts.map((entry) => [entry.slug, entry]));
  const explicitRelated = prompt.relatedPrompts
    .map((relatedSlug) => bySlug.get(relatedSlug))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  // Top up from the same category so every page carries a full set of onward
  // links, without repeating one the author already chose.
  const chosen = new Set([prompt.slug, ...explicitRelated.map((e) => e.slug)]);
  const sameCategory = prompts.filter(
    (entry) => entry.category === prompt.category && !chosen.has(entry.slug),
  );
  const related = [...explicitRelated, ...sameCategory].slice(0, RELATED_LIMIT);

  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";
  // Formatted in UTC so the visible date always matches dateModified in the
  // schema on the same page. Without it, a non-UTC runtime shows the day before.
  const updatedLabel = new Date(prompt.updatedAt).toLocaleDateString(
    dateLocale,
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    },
  );
  // Structured data describes the resource, so it points at the URL that owns
  // the content rather than the fallback route a reader happens to be on.
  const canonicalUrl = localeUrl(prompt.locale, `${PATH}/${slug}`);

  const creativeWorkLd = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: prompt.title,
    description: prompt.description,
    url: canonicalUrl,
    inLanguage: prompt.locale === "zh" ? "zh-CN" : "en",
    datePublished: prompt.publishedAt,
    dateModified: prompt.updatedAt,
    keywords: prompt.keywords.join(", "),
    learningResourceType: "Prompt",
    isAccessibleForFree: true,
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteConfig.url,
    },
  };

  return (
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="mx-auto max-w-report px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: tCommon("home"), url: localeUrl(locale) },
            { name: t("eyebrow"), url: localeUrl(locale, PATH) },
            { name: prompt.title },
          ]}
        />
        <FaqPageJsonLd
          faqs={prompt.faqs.map((faq) => ({
            q: faq.question,
            a: toPlainText(faq.answer),
          }))}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(creativeWorkLd) }}
        />
        <VisibleBreadcrumb
          items={[
            { label: tCommon("home"), href: localePath(locale) },
            { label: t("eyebrow"), href: localePath(locale, PATH) },
            { label: prompt.title },
          ]}
        />

        <header className="relative overflow-hidden border-b border-brand-border pt-7 pb-11">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-signal-grid opacity-40"
          />
          <div className="relative max-w-[820px]">
            <span className="inline-flex rounded-full border border-brand-accent/25 bg-brand-accent-soft px-3 py-1 font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
              {t(`categories.${prompt.category}`)}
            </span>
            <h1 className="mt-5 text-page-title text-text-dark-primary">
              {prompt.title}
            </h1>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-text-dark-secondary md:text-[16.5px]">
              {prompt.description}
            </p>

            {prompt.locale !== locale && (
              <p className="mt-4 border-l-2 border-brand-border-dashed pl-4 font-mono text-[11px] leading-[1.6] text-text-dark-secondary">
                {t("contentLanguageNote")}
              </p>
            )}

            <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-3 border-t border-brand-border pt-5 font-mono text-[10.5px] tracking-[0.06em] uppercase">
              {[
                { term: t("detail.useCase"), value: prompt.useCase },
                { term: t("detail.outputFormat"), value: prompt.outputFormat },
                { term: t("detail.models"), value: prompt.models.join(" · ") },
                { term: t("detail.updated"), value: updatedLabel },
              ].map((entry) => (
                <div key={entry.term} className="min-w-0">
                  <dt className="text-text-dark-faint">{entry.term}</dt>
                  <dd className="mt-1 text-text-dark-strong normal-case">
                    {entry.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        <div className="grid min-w-0 gap-12 pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:gap-14">
          <div className="flex min-w-0 flex-col gap-14">
            <ResourceCodeBlock
              value={prompt.promptText}
              eyebrow={t("detail.promptEyebrow")}
              title={t("detail.promptTitle")}
              headingId="prompt-body"
              copyLabel={t("detail.copy")}
              copiedLabel={t("detail.copied")}
              failedLabel={t("detail.copyFailed")}
            />

            <section aria-labelledby="prompt-variables" className="min-w-0">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("detail.variablesEyebrow")}
              </p>
              <h2
                id="prompt-variables"
                className="mt-2 text-[22px] font-semibold text-text-dark-primary"
              >
                {t("detail.variablesTitle")}
              </h2>
              <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2">
                {prompt.variables.map((variable) => (
                  <VariableCard
                    key={variable.name}
                    variable={variable}
                    requiredLabel={t("detail.required")}
                    optionalLabel={t("detail.optional")}
                    exampleLabel={t("detail.example")}
                  />
                ))}
              </div>
            </section>

            <section aria-labelledby="prompt-how-to-use" className="min-w-0">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("detail.howToUseEyebrow")}
              </p>
              <h2
                id="prompt-how-to-use"
                className="mt-2 mb-5 text-[22px] font-semibold text-text-dark-primary"
              >
                {t("detail.howToUseTitle")}
              </h2>
              <ResourceProse markdown={prompt.howToUse} />
            </section>

            <ResourceCodeBlock
              value={prompt.exampleInput}
              eyebrow={t("detail.exampleInputEyebrow")}
              title={t("detail.exampleInputTitle")}
              headingId="prompt-example-input"
              copyLabel={t("detail.copyInput")}
              copiedLabel={t("detail.copied")}
              failedLabel={t("detail.copyFailed")}
            />

            <section
              aria-labelledby="prompt-example-output"
              className="min-w-0"
            >
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("detail.exampleOutputEyebrow")}
              </p>
              <h2
                id="prompt-example-output"
                className="mt-2 mb-5 text-[22px] font-semibold text-text-dark-primary"
              >
                {t("detail.exampleOutputTitle")}
              </h2>
              <div className="min-w-0 rounded-card border border-brand-border-card bg-brand-panel p-6 md:p-7">
                <ResourceProse markdown={prompt.exampleOutput} />
              </div>
            </section>

            {/* Amber, not accent: this section is a caution, and colour is the
                fastest way to say so before the heading is read. */}
            <section aria-labelledby="prompt-safety" className="min-w-0">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-warning uppercase">
                {t("detail.safetyEyebrow")}
              </p>
              <h2
                id="prompt-safety"
                className="mt-2 mb-5 text-[22px] font-semibold text-text-dark-primary"
              >
                {t("detail.safetyTitle")}
              </h2>
              <div className="min-w-0 rounded-card border border-brand-warning/25 bg-brand-warning/[0.06] p-6 md:p-7">
                <ResourceProse markdown={prompt.safetyNotes} />
              </div>
            </section>

            <ResourceFaqSection
              faqs={prompt.faqs}
              eyebrow={t("detail.faqEyebrow")}
              title={t("detail.faqTitle")}
              headingId="prompt-faq"
            />
          </div>

          <aside className="flex min-w-0 flex-col gap-10 lg:sticky lg:top-24 lg:self-start">
            {relatedSkill && (
              <section className="min-w-0">
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {t("detail.relatedSkill")}
                </p>
                <Link
                  href={localePath(locale, `/skills/${relatedSkill.slug}`)}
                  className="group mt-4 block min-w-0 rounded-card border border-brand-border-card bg-brand-panel p-5 transition-colors hover:border-brand-accent/30 hover:bg-brand-panel-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                >
                  <span className="font-mono text-[9.5px] tracking-[0.08em] text-text-dark-faint uppercase">
                    {tSkills(`owners.${relatedSkill.owner}`)}
                  </span>
                  <span className="mt-2.5 block text-[15px] font-semibold text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
                    {relatedSkill.title}
                  </span>
                  <span className="mt-2 block text-[12.5px] leading-[1.6] text-text-dark-secondary">
                    {relatedSkill.tagline}
                  </span>
                </Link>
                <p className="mt-3 text-[12px] leading-[1.6] text-text-dark-secondary">
                  {t("detail.relatedSkillNote")}
                </p>
              </section>
            )}

            <RelatedResources
              title={t("detail.relatedPrompts")}
              items={related.map((entry) => ({
                slug: entry.slug,
                href: localePath(locale, `${PATH}/${entry.slug}`),
                title: entry.title,
                description: entry.description,
              }))}
            />

            <section className="min-w-0 rounded-card border border-brand-border-card bg-brand-panel p-5">
              <h2 className="text-[16px] font-semibold text-text-dark-primary">
                {t("cta.title")}
              </h2>
              <p className="mt-2.5 text-[12.5px] leading-[1.65] text-text-dark-secondary">
                {t("cta.body")}
              </p>
              <Link
                href={localePath(locale, "/agents")}
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-4 text-[13px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-accent"
              >
                {t("cta.action")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </section>

            <Link
              href={localePath(locale, PATH)}
              className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-text-dark-secondary uppercase transition-colors hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              {t("detail.backToLibrary")}
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}
