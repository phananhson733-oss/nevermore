// @input  -- locale/slug route params、skills 内容库、prompts 内容库与 skills 翻译命名空间
// @output -- /skills/[slug] 详情页（文件窗、方法论、四步流程、FAQ 与 TechArticle/HowTo/FAQPage/Breadcrumb 结构化数据）
// @pos    -- Skills 库详情路由，把一个 skill 呈现为可读可下载的真实工件
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { RelatedResources } from "@/components/resources/related-resources";
import { ResourceFaqSection } from "@/components/resources/resource-faq";
import { ResourceProse } from "@/components/resources/resource-prose";
import { SkillFileWindow } from "@/components/resources/skill-file-window";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { HowToJsonLd } from "@/components/seo/json-ld/how-to-json-ld";
import { safeJsonLd } from "@/components/seo/json-ld/utils";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { siteConfig } from "@/config/site";
import { routing } from "@/i18n/routing";
import { getPromptForLocale } from "@/lib/prompt-content";
import {
  SKILL_FILE_NAME,
  getSkillForLocale,
  getSkillsForLocale,
  localesOwningSkill,
} from "@/lib/skill-content";
import { resourceAlternates } from "@/lib/resource-alternates";
import { skillInstallCommand } from "@/lib/skill-install";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";
import { toPlainText } from "@/lib/resource-markdown";

const PATH = "/skills";
const RELATED_LIMIT = 5;

export const revalidate = 3600;

export async function generateStaticParams() {
  // Per locale — see the matching comment on the prompt detail route.
  const perLocale = await Promise.all(
    routing.locales.map(async (locale) => {
      const { skills } = await getSkillsForLocale(locale);
      return skills.map((skill) => ({ locale, slug: skill.slug }));
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
  const skill = await getSkillForLocale(slug, locale);

  if (!skill) {
    const t = await getTranslations({ locale, namespace: "skills" });
    return generatePageMetadata({
      title: t("metadata.title"),
      description: t("metadata.description"),
      locale,
      path: `${PATH}/${slug}`,
      noIndex: true,
    });
  }

  const metadata = generatePageMetadata({
    title: skill.title,
    description: skill.description,
    locale,
    path: `${PATH}/${slug}`,
  });

  return resourceAlternates({
    metadata,
    locale,
    owningLocale: skill.locale,
    path: `${PATH}/${slug}`,
    localesOwningFile: await localesOwningSkill(slug),
  });
}

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const [skill, { skills }] = await Promise.all([
    getSkillForLocale(slug, locale),
    getSkillsForLocale(locale),
  ]);

  if (!skill) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "skills" });
  const tCommon = await getTranslations({ locale, namespace: "common" });
  const tPrompts = await getTranslations({ locale, namespace: "prompts" });

  const bySlug = new Map(skills.map((entry) => [entry.slug, entry]));
  const explicitRelated = skill.relatedSkills
    .map((relatedSlug) => bySlug.get(relatedSlug))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const chosen = new Set([skill.slug, ...explicitRelated.map((e) => e.slug)]);
  const related = [
    ...explicitRelated,
    ...skills.filter((entry) => !chosen.has(entry.slug)),
  ].slice(0, RELATED_LIMIT);

  const resolvedPrompts = await Promise.all(
    skill.relatedPrompts.map(async (promptSlug) => ({
      slug: promptSlug,
      prompt: await getPromptForLocale(promptSlug, locale),
    })),
  );

  // Fail closed rather than filtering: a silently dropped cross-library link
  // leaves a finished-looking page with a relationship missing from it.
  const missing = resolvedPrompts
    .filter((entry) => !entry.prompt)
    .map((entry) => entry.slug);
  if (missing.length > 0) {
    throw new Error(
      `skills/${skill.locale}/${skill.slug}.md: relatedPrompts references unknown prompts: ${missing.join(", ")}.`,
    );
  }

  const relatedPrompts = resolvedPrompts.map(
    (entry) => entry.prompt as NonNullable<typeof entry.prompt>,
  );

  const dateLocale = locale === "zh" ? "zh-CN" : "en-US";
  // UTC — see the matching comment on the prompt detail route.
  const updatedLabel = new Date(skill.updatedAt).toLocaleDateString(
    dateLocale,
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    },
  );
  const canonicalUrl = localeUrl(skill.locale, `${PATH}/${slug}`);
  const downloadHref = localePath(locale, `${PATH}/${skill.slug}/file`);
  const agentHref = localePath(locale, `/agents/${skill.owner}`);
  const installCommand = skillInstallCommand(skill.slug);

  const techArticleLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: skill.title,
    description: skill.description,
    url: canonicalUrl,
    inLanguage: skill.locale === "zh" ? "zh-CN" : "en",
    datePublished: skill.publishedAt,
    dateModified: skill.updatedAt,
    keywords: skill.keywords.join(", "),
    isAccessibleForFree: true,
    // Authorship sits with the organisation: these procedures are maintained by
    // the team, and inventing a personal byline for schema would be a lie told
    // for a rich result.
    author: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      url: siteConfig.url,
    },
    mainEntityOfPage: canonicalUrl,
  };

  return (
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="mx-auto max-w-report px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: tCommon("home"), url: localeUrl(locale) },
            { name: t("eyebrow"), url: localeUrl(locale, PATH) },
            { name: skill.title },
          ]}
        />
        <FaqPageJsonLd
          faqs={skill.faqs.map((faq) => ({
            q: faq.question,
            a: toPlainText(faq.answer),
          }))}
        />
        <HowToJsonLd
          name={skill.title}
          steps={skill.steps.map((step) => ({
            name: step.name,
            text: toPlainText(step.text),
          }))}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(techArticleLd) }}
        />
        <VisibleBreadcrumb
          items={[
            { label: tCommon("home"), href: localePath(locale) },
            { label: t("eyebrow"), href: localePath(locale, PATH) },
            { label: skill.title },
          ]}
        />

        <header className="relative border-b border-brand-border pt-7 pb-11">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-signal-grid opacity-40"
          />
          <div className="relative max-w-[820px]">
            <span className="inline-flex rounded-full border border-brand-accent/25 bg-brand-accent-soft px-3 py-1 font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
              {t(`categories.${skill.category}`)}
            </span>
            <h1 className="mt-5 text-page-title text-text-dark-primary">
              {skill.title}
            </h1>
            <p className="mt-4 text-[15.5px] leading-[1.7] text-text-dark-secondary md:text-[16.5px]">
              {skill.description}
            </p>

            {skill.locale !== locale && (
              <p className="mt-4 border-l-2 border-brand-border-dashed pl-4 font-mono text-[11px] leading-[1.6] text-text-dark-secondary">
                {t("contentLanguageNote")}
              </p>
            )}

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#skill-file"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-5 text-[13.5px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-accent"
              >
                {t("detail.getFile")}
              </a>
              <Link
                href={agentHref}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-border-strong px-5 text-[13.5px] font-semibold text-text-dark-primary transition-colors hover:border-brand-accent/40 hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {t("detail.tryAgent")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>

            <dl className="mt-7 flex flex-wrap gap-x-8 gap-y-3 border-t border-brand-border pt-5 font-mono text-[10.5px] tracking-[0.06em] uppercase">
              {[
                { term: t("detail.owner"), value: t(`owners.${skill.owner}`) },
                { term: t("detail.format"), value: skill.installPath },
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
            <section
              id="skill-file"
              aria-labelledby="skill-file-title"
              className="min-w-0 scroll-mt-28"
            >
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("detail.fileEyebrow")}
              </p>
              <h2
                id="skill-file-title"
                className="mt-2 mb-5 text-[22px] font-semibold text-text-dark-primary"
              >
                {t("detail.fileTitle")}
              </h2>
              <SkillFileWindow
                installPath={skill.installPath}
                downloadName={SKILL_FILE_NAME}
                content={skill.fileContent}
                downloadHref={downloadHref}
                installTitle={t("detail.installTitle")}
                installNote={t("detail.installNote")}
                installCommand={installCommand}
                copyLabel={t("detail.copy")}
                copiedLabel={t("detail.copied")}
                failedLabel={t("detail.copyFailed")}
                downloadLabel={t("detail.download")}
                copyCommandLabel={t("detail.copyCommand")}
              />
            </section>

            <section aria-labelledby="skill-what" className="min-w-0">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("detail.whatEyebrow")}
              </p>
              <h2
                id="skill-what"
                className="mt-2 mb-5 text-[22px] font-semibold text-text-dark-primary"
              >
                {t("detail.whatTitle")}
              </h2>
              <ResourceProse markdown={skill.whatItDoes} />
            </section>

            <section aria-labelledby="skill-action" className="min-w-0">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("detail.actionEyebrow")}
              </p>
              <h2
                id="skill-action"
                className="mt-2 mb-5 text-[22px] font-semibold text-text-dark-primary"
              >
                {t("detail.actionTitle")}
              </h2>
              <div className="flex min-w-0 flex-col gap-4">
                <div className="min-w-0 rounded-card border border-brand-border bg-brand-panel-sunken p-5">
                  <p className="font-mono text-[9.5px] tracking-[0.08em] text-text-dark-faint uppercase">
                    {t("detail.actionAsk")}
                  </p>
                  <div className="mt-3">
                    <ResourceProse markdown={skill.exampleAsk} />
                  </div>
                </div>
                {/* The agent's reply carries the accent rail: it is the claim the
                    page is making, and the question above is only its setup. */}
                <div className="min-w-0 rounded-card border border-brand-accent/25 bg-brand-accent/[0.05] p-5 shadow-[inset_2px_0_0_#3DDC97] md:p-6">
                  <p className="font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
                    {t("detail.actionResponse")}
                  </p>
                  <div className="mt-3">
                    <ResourceProse markdown={skill.exampleResponse} />
                  </div>
                </div>
              </div>
            </section>

            <section aria-labelledby="skill-steps" className="min-w-0">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("detail.stepsEyebrow")}
              </p>
              <h2
                id="skill-steps"
                className="mt-2 text-[22px] font-semibold text-text-dark-primary"
              >
                {t("detail.stepsTitle")}
              </h2>
              {/* Numbered because the steps are an order of operations: reading
                  the site before the keywords is the point, not decoration. */}
              <ol className="mt-5 border-t border-brand-border">
                {skill.steps.map((step, index) => (
                  <li
                    key={step.name}
                    className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 border-b border-brand-border py-5"
                  >
                    <span className="font-mono text-[11px] text-text-dark-faint tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[15.5px] font-semibold text-text-dark-primary">
                        {step.name}
                      </h3>
                      <div className="mt-2">
                        <ResourceProse markdown={step.text} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <div className="grid min-w-0 gap-10 md:grid-cols-2">
              <section aria-labelledby="skill-coverage" className="min-w-0">
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {t("detail.coverageEyebrow")}
                </p>
                <h2
                  id="skill-coverage"
                  className="mt-2 text-[19px] font-semibold text-text-dark-primary"
                >
                  {t("detail.coverageTitle")}
                </h2>
                <ul className="mt-4 border-t border-brand-border">
                  {skill.coverage.map((entry) => (
                    <li
                      key={entry}
                      className="border-b border-brand-border-faint py-3 text-[13.5px] leading-[1.65] text-text-dark-strong"
                    >
                      {entry}
                    </li>
                  ))}
                </ul>
              </section>

              <section aria-labelledby="skill-when" className="min-w-0">
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {t("detail.whenEyebrow")}
                </p>
                <h2
                  id="skill-when"
                  className="mt-2 text-[19px] font-semibold text-text-dark-primary"
                >
                  {t("detail.whenTitle")}
                </h2>
                <ul className="mt-4 border-t border-brand-border">
                  {skill.whenToUse.map((entry) => (
                    <li
                      key={entry}
                      className="border-b border-brand-border-faint py-3 text-[13.5px] leading-[1.65] text-text-dark-strong"
                    >
                      {entry}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <ResourceFaqSection
              faqs={skill.faqs}
              eyebrow={t("detail.faqEyebrow")}
              title={t("detail.faqTitle")}
              headingId="skill-faq"
            />
          </div>

          <aside className="flex min-w-0 flex-col gap-10 lg:sticky lg:top-24 lg:self-start">
            <RelatedResources
              title={t("detail.relatedSkills")}
              items={related.map((entry) => ({
                slug: entry.slug,
                href: localePath(locale, `${PATH}/${entry.slug}`),
                title: entry.title,
                description: entry.tagline,
              }))}
            />

            {relatedPrompts.length > 0 && (
              <RelatedResources
                title={t("detail.relatedPrompts")}
                items={relatedPrompts.map((entry) => ({
                  slug: entry.slug,
                  href: localePath(locale, `/prompts/${entry.slug}`),
                  title: entry.title,
                  description: entry.description,
                }))}
              />
            )}

            <section className="min-w-0 rounded-card border border-brand-border-card bg-brand-panel p-5">
              <h2 className="text-[16px] font-semibold text-text-dark-primary">
                {t("cta.title")}
              </h2>
              <p className="mt-2.5 text-[12.5px] leading-[1.65] text-text-dark-secondary">
                {t("cta.body")}
              </p>
              <Link
                href={agentHref}
                className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-4 text-[13px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-accent"
              >
                {t("cta.action")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </section>

            <div className="flex flex-col gap-3">
              <Link
                href={localePath(locale, PATH)}
                className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-text-dark-secondary uppercase transition-colors hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                <ArrowLeft aria-hidden="true" className="size-3.5" />
                {t("detail.backToLibrary")}
              </Link>
              <Link
                href={localePath(locale, "/prompts")}
                className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-text-dark-secondary uppercase transition-colors hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                <ArrowLeft aria-hidden="true" className="size-3.5" />
                {tPrompts("detail.backToLibrary")}
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
