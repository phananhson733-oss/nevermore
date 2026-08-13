// @input  -- locale, exact Agent identity, Agent/tools/auth messages
// @output -- breadcrumb, concise Agent hero, boundaries, workbench, and method
// @pos    -- shared server-rendered frame for the independent SEO and Tech routes

import { Check, Database, LockKeyhole, ScanSearch } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "../seo/json-ld/breadcrumb-json-ld";
import { VisibleBreadcrumb } from "../seo/visible-breadcrumb";
import { localePath, localeUrl } from "../../lib/locale-path";
import { AgentWorkbench } from "./agent-workbench";
import { AGENT_PATH, type AgentKind } from "./agent-types";

export async function AgentPage({
  agent,
  locale,
}: {
  readonly agent: AgentKind;
  readonly locale: string;
}) {
  const [t, messages] = await Promise.all([
    getTranslations({ locale, namespace: `agents.${agent}` }),
    getMessages(),
  ]);
  const home = locale === "zh" ? "首页" : "Home";
  const agents = locale === "zh" ? "Agents 智能体" : "Agents";

  return (
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="mx-auto max-w-report px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: home, url: localeUrl(locale) },
            { name: agents, url: localeUrl(locale, "/agents") },
            { name: t("name"), url: localeUrl(locale, AGENT_PATH[agent]) },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: home, href: localePath(locale) },
            { label: agents, href: localePath(locale, "/agents") },
            { label: t("name") },
          ]}
        />

        <header className="relative overflow-hidden border-b border-brand-border pt-6 pb-10 md:pb-12">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-signal-grid opacity-40"
          />
          <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
            <div className="max-w-[720px]">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {t("eyebrow")}
              </p>
              <h1 className="mt-4 text-page-title text-text-dark-primary">
                {t("title")}
              </h1>
              <p className="mt-4 max-w-[680px] text-[15px] leading-[1.65] text-text-dark-secondary md:text-[16.5px]">
                {t("subtitle")}
              </p>
              <a
                href={`#${agent}-agent-workbench`}
                className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-5 text-[13.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
              >
                {t("heroCta")}
                <ScanSearch aria-hidden="true" className="size-4" />
              </a>
            </div>

            <div className="grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card">
              <div className="flex gap-3 bg-brand-panel-sunken p-4">
                <LockKeyhole
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-brand-accent"
                />
                <div>
                  <h2 className="text-[12.5px] font-semibold text-text-dark-primary">
                    {t("accountBoundaryTitle")}
                  </h2>
                  <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
                    {t("accountBoundaryBody")}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 bg-brand-panel-sunken p-4">
                <Database
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-brand-accent-2"
                />
                <div>
                  <h2 className="text-[12.5px] font-semibold text-text-dark-primary">
                    {t("dataBoundaryTitle")}
                  </h2>
                  <p className="mt-1 text-[11.5px] leading-[1.55] text-text-dark-secondary">
                    {t("dataBoundaryBody")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div>
          <section className="pt-8">
            <NextIntlClientProvider
              messages={{
                agents: messages.agents,
                tools: { seoAudit: messages.tools.seoAudit },
                auth: messages.auth,
              }}
            >
              <AgentWorkbench agent={agent} locale={locale} />
            </NextIntlClientProvider>
          </section>

          <section className="mt-16 border-t border-brand-border pt-12">
            <div className="grid gap-8 lg:grid-cols-[0.65fr_1.35fr]">
              <div>
                <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                  {t("howEyebrow")}
                </p>
                <h2 className="mt-2 text-[24px] font-semibold text-text-dark-primary">
                  {t("howTitle")}
                </h2>
                <p className="mt-3 max-w-sm text-[12.5px] leading-[1.65] text-text-dark-secondary">
                  {t("howBody")}
                </p>
              </div>
              <ol className="grid gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card sm:grid-cols-2 xl:grid-cols-4">
                {[1, 2, 3, 4].map((step) => (
                  <li
                    key={step}
                    className="min-h-[185px] bg-brand-panel-sunken p-5"
                  >
                    <p className="font-mono text-[10px] text-brand-accent-text">
                      0{step}
                    </p>
                    <h3 className="mt-5 flex items-start gap-2 text-[14px] font-semibold text-text-dark-primary">
                      <Check
                        aria-hidden="true"
                        className="mt-0.5 size-3.5 shrink-0 text-brand-accent"
                      />
                      {t(`step${step}Title`)}
                    </h3>
                    <p className="mt-2 text-[11.5px] leading-[1.6] text-text-dark-secondary">
                      {t(`step${step}Body`)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
            <p className="mt-5 rounded-row border border-brand-border-dashed bg-brand-panel-sunken px-4 py-3 text-[11.5px] leading-[1.6] text-text-dark-secondary">
              {t("finalBoundary")}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
