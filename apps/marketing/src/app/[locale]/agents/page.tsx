// @input  -- locale and agents.hub messages
// @output -- the SEO and GEO Agents, with SEO's technical focus as a subordinate path
// @pos    -- /agents marketing acquisition hub

import Link from "next/link";
import { ArrowRight, CodeXml, Radar, ScanSearch } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { generatePageMetadata } from "@/lib/seo";
import { localePath, localeUrl } from "@/lib/locale-path";

const PATH = "/agents";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.hub" });
  return generatePageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    locale,
    path: PATH,
  });
}

export default async function AgentsHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.hub" });
  const home = locale === "zh" ? "首页" : "Home";
  /**
   * Two Agents, and the technical route is not one of them.
   *
   * GEO asks a live assistant real buyer questions and reads back who it cited
   * — a different capability, on different evidence, so it is a peer. The
   * technical route renders the same workbench over the same engine as SEO and
   * differs only in which checks open first, so it appears below as a focus
   * rather than as a third product to choose between.
   */
  const cards = [
    { id: "seo", icon: ScanSearch, path: "/agents/seo" },
    { id: "geo", icon: Radar, path: "/agents/geo" },
  ] as const;

  return (
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="mx-auto max-w-report px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: home, url: localeUrl(locale) },
            { name: t("breadcrumb"), url: localeUrl(locale, PATH) },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: home, href: localePath(locale) },
            { label: t("breadcrumb") },
          ]}
        />

        <header className="relative overflow-hidden border-b border-brand-border pt-7 pb-12">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-signal-grid opacity-40"
          />
          <div className="relative z-10 max-w-[760px]">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-page-title text-text-dark-primary">
              {t("title")}
            </h1>
            <p className="mt-5 max-w-[690px] text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
              {t("subtitle")}
            </p>
            <p className="mt-5 max-w-[680px] border-l-2 border-brand-accent/50 pl-4 text-[12.5px] leading-[1.65] text-text-dark-secondary">
              {t("boundary")}
            </p>
          </div>
        </header>

        <div className="pt-10">
          <div className="grid gap-5 md:grid-cols-2">
            {cards.map(({ id, icon: Icon, path }, index) => (
              <article
                key={id}
                className="group relative overflow-hidden rounded-card border border-brand-border-card bg-brand-panel p-6 transition-colors hover:border-brand-accent/40 md:p-7"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="inline-flex size-10 items-center justify-center rounded-[11px] border border-brand-accent/25 bg-brand-accent/[0.08] text-brand-accent-text">
                    <Icon aria-hidden="true" className="size-4.5" />
                  </span>
                  <span className="font-mono text-[10px] tracking-[0.08em] text-text-dark-faint">
                    0{index + 1}
                  </span>
                </div>
                <h2 className="mt-8 text-[22px] font-semibold text-text-dark-primary">
                  {t(`${id}.title`)}
                </h2>
                <p className="mt-3 text-[13px] leading-[1.65] text-text-dark-secondary">
                  {t(`${id}.description`)}
                </p>
                <p className="mt-5 rounded-row border border-brand-border bg-brand-panel-sunken px-4 py-3 font-mono text-[10.5px] leading-[1.55] text-text-dark-strong">
                  {t(`${id}.scope`)}
                </p>
                <Link
                  href={localePath(locale, path)}
                  className="mt-7 inline-flex items-center gap-2 text-[13.5px] font-semibold text-brand-accent-text transition-colors hover:text-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
                >
                  {t(`${id}.cta`)}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </article>
            ))}
          </div>

          <div className="mt-5 rounded-card border border-brand-border bg-brand-panel-sunken p-5 md:p-6">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] border border-brand-border text-text-dark-faint">
                <CodeXml aria-hidden="true" className="size-4" />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold text-text-dark-primary">
                  {t("tech.title")}
                </h3>
                <p className="mt-2 max-w-[620px] text-[13px] leading-[1.65] text-text-dark-secondary">
                  {t("tech.description")}
                </p>
                <Link
                  href={localePath(locale, "/agents/tech")}
                  className="mt-4 inline-flex items-center gap-2 text-[13px] text-text-dark-secondary underline decoration-brand-border underline-offset-4 transition-colors hover:text-text-dark-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-accent"
                >
                  {t("tech.cta")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
