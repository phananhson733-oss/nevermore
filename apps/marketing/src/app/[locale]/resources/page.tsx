// @input  -- locale route param and resources/common translation namespaces
// @output -- canonical Resources hub for Prompts, Tools, Skills, and Docs
// @pos    -- /resources marketing information-architecture hub
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  Braces,
  Layers3,
  Wrench,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

const PATH = "/resources";

/**
 * The four resource types, in the order a reader meets them. A type is only
 * marked available once it has a real public route; `path` is what proves it,
 * and a planned type has none.
 */
const RESOURCE_TYPES = [
  { id: "prompts", sequence: "01", status: "available", path: "/prompts" },
  { id: "tools", sequence: "02", status: "available", path: "/tools" },
  { id: "skills", sequence: "03", status: "available", path: "/skills" },
  { id: "docs", sequence: "04", status: "planned", path: null },
] as const;

const AVAILABLE_RESOURCES = [
  { id: "prompts", icon: Braces, path: "/prompts", cta: "openPrompts" },
  { id: "tools", icon: Wrench, path: "/tools", cta: "openTools" },
  { id: "skills", icon: Layers3, path: "/skills", cta: "openSkills" },
] as const;

const PLANNED_RESOURCES = [
  {
    id: "docs",
    icon: BookOpenText,
    examples: ["boundaries", "agentScope", "dataRules"],
  },
] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "resources" });

  return generatePageMetadata({
    title: t("metadata.title"),
    description: t("metadata.description"),
    locale,
    path: PATH,
  });
}

export default async function ResourcesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "resources" });
  const tCommon = await getTranslations({ locale, namespace: "common" });

  return (
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="mx-auto max-w-report px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: tCommon("home"), url: localeUrl(locale) },
            { name: t("title"), url: localeUrl(locale, PATH) },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: tCommon("home"), href: localePath(locale) },
            { label: t("title") },
          ]}
        />

        <header className="relative overflow-hidden border-b border-brand-border pt-7 pb-12 md:pb-14">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-signal-grid opacity-40"
          />
          <div className="relative grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(310px,0.95fr)] lg:items-end">
            <div className="min-w-0 max-w-[720px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("eyebrow")}
              </p>
              <h1 className="mt-4 text-text-dark-primary">{t("title")}</h1>
              <p className="mt-5 max-w-[680px] text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
                {t("subtitle")}
              </p>
            </div>

            <nav
              aria-label={t("eyebrow")}
              className="grid min-w-0 grid-cols-2 border-t border-l border-brand-border lg:ml-auto lg:w-full"
            >
              {RESOURCE_TYPES.map((type) => (
                <article
                  key={type.id}
                  className="min-w-0 border-r border-b border-brand-border bg-brand-panel/70"
                >
                  {type.path ? (
                    <Link
                      href={localePath(locale, type.path)}
                      className="group block min-h-27 p-4 transition-colors hover:bg-brand-panel-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent md:p-5"
                    >
                      <span className="flex items-center justify-between gap-3 font-mono text-[9.5px] tracking-[0.1em] uppercase">
                        <span className="text-text-dark-faint">
                          {type.sequence}
                        </span>
                        <span className="text-brand-accent-text">
                          {t(type.status)}
                        </span>
                      </span>
                      <span className="mt-5 flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 text-[14px] font-semibold text-text-dark-primary">
                          {t(`types.${type.id}.title`)}
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-text-dark-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-accent-text"
                        />
                      </span>
                    </Link>
                  ) : (
                    <a
                      href={`#${type.id}`}
                      className="group block min-h-27 p-4 transition-colors hover:bg-brand-panel-raised focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-accent md:p-5"
                    >
                      <span className="flex items-center justify-between gap-3 font-mono text-[9.5px] tracking-[0.1em] uppercase">
                        <span className="text-text-dark-faint">
                          {type.sequence}
                        </span>
                        <span className="text-brand-warning">
                          {t(type.status)}
                        </span>
                      </span>
                      <span className="mt-5 flex min-w-0 items-center justify-between gap-3">
                        <span className="min-w-0 text-[14px] font-semibold text-text-dark-primary">
                          {t(`types.${type.id}.title`)}
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-text-dark-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-accent-text"
                        />
                      </span>
                    </a>
                  )}
                  <p className="min-h-10 border-t border-brand-border-faint px-4 py-3 font-mono text-[9px] leading-[1.45] text-text-dark-faint md:px-5">
                    {t(`types.${type.id}.note`)}
                  </p>
                </article>
              ))}
            </nav>
          </div>
        </header>

        <main>
          <section
            aria-labelledby="resources-available-title"
            className="border-b border-brand-border py-14 md:py-18"
          >
            <div className="max-w-[760px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("sections.available.eyebrow")}
              </p>
              <h2
                id="resources-available-title"
                className="mt-3 text-text-dark-primary"
              >
                {t("sections.available.title")}
              </h2>
              <p className="mt-4 text-[14px] leading-[1.7] text-text-dark-secondary">
                {t("sections.available.body")}
              </p>
            </div>

            <div className="mt-9 grid min-w-0 gap-5 lg:grid-cols-3">
              {AVAILABLE_RESOURCES.map((resource) => {
                const Icon = resource.icon;
                return (
                  <article
                    key={resource.id}
                    id={resource.id}
                    className="flex min-w-0 scroll-mt-28 flex-col rounded-card border border-brand-border-card bg-brand-panel p-6 shadow-panel md:p-7"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-row border border-brand-accent/25 bg-brand-accent-soft text-brand-accent-text">
                        <Icon aria-hidden="true" className="size-[18px]" />
                      </span>
                      <span className="rounded-full border border-brand-accent/25 bg-brand-accent-soft px-3 py-1 font-mono text-[9.5px] tracking-[0.08em] text-brand-accent-text uppercase">
                        {t("available")}
                      </span>
                    </div>
                    <h3 className="mt-7 text-[21px] font-semibold text-text-dark-primary">
                      {t(`types.${resource.id}.title`)}
                    </h3>
                    <p className="mt-3 flex-1 text-[13px] leading-[1.65] text-text-dark-secondary">
                      {t(`types.${resource.id}.description`)}
                    </p>
                    <Link
                      href={localePath(locale, resource.path)}
                      className="mt-6 inline-flex items-center gap-2 font-mono text-[10.5px] tracking-[0.08em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
                    >
                      {t(resource.cta)}
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                    </Link>
                  </article>
                );
              })}
            </div>
          </section>

          <section
            aria-labelledby="resources-planned-title"
            className="pt-14 md:pt-18"
          >
            <div className="max-w-[760px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("sections.planned.eyebrow")}
              </p>
              <h2
                id="resources-planned-title"
                className="mt-3 text-text-dark-primary"
              >
                {t("sections.planned.title")}
              </h2>
              <p className="mt-4 text-[14px] leading-[1.7] text-text-dark-secondary">
                {t("sections.planned.body")}
              </p>
            </div>

            <div className="mt-9 grid min-w-0 gap-5 lg:grid-cols-3">
              {PLANNED_RESOURCES.map((resource) => {
                const Icon = resource.icon;
                return (
                  <article
                    key={resource.id}
                    id={resource.id}
                    className="min-w-0 scroll-mt-28 rounded-card border border-dashed border-brand-border-dashed bg-brand-panel/55 p-6 md:p-7"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <span className="inline-flex size-10 items-center justify-center rounded-row border border-brand-border-strong bg-brand-panel-raised text-text-dark-strong">
                        <Icon aria-hidden="true" className="size-4" />
                      </span>
                      <span className="font-mono text-[9.5px] tracking-[0.08em] text-brand-warning uppercase">
                        {t("planned")}
                      </span>
                    </div>
                    <h3 className="mt-7 text-[21px] font-semibold text-text-dark-primary">
                      {t(`types.${resource.id}.title`)}
                    </h3>
                    <p className="mt-3 text-[13px] leading-[1.65] text-text-dark-secondary">
                      {t(`types.${resource.id}.description`)}
                    </p>

                    <ul className="mt-6 border-t border-brand-border pt-2">
                      {resource.examples.map((example, exampleIndex) => (
                        <li
                          key={example}
                          className="flex min-w-0 items-start gap-3 border-b border-brand-border-faint py-3 last:border-b-0"
                        >
                          <span className="mt-0.5 shrink-0 font-mono text-[9px] text-text-dark-faint">
                            {String(exampleIndex + 1).padStart(2, "0")}
                          </span>
                          <span className="min-w-0 text-[12.5px] leading-[1.55] text-text-dark-strong">
                            {t(`examples.${resource.id}.${example}`)}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-5 font-mono text-[9.5px] leading-[1.55] text-text-dark-faint">
                      {t(`types.${resource.id}.note`)}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
