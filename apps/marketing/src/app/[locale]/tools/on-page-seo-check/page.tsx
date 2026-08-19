// @input  -- locale and the tools.onPageChecker messages
// @output -- the page-scoped keyword checker, its boundaries and its FAQ
// @pos    -- /tools/on-page-seo-check, the page-first entry into the SEO Agent's crawl

import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import {
  COVERAGE_EXCLUSIONS,
  COVERAGE_GROUPS,
} from "@/lib/on-page-checker/coverage-chapter";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { OnPageChecker } from "@/components/tools/on-page-checker";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

const PATH = "/tools/on-page-seo-check";



interface FaqItem {
  readonly q: string;
  readonly a: string;
}

interface RelatedTool {
  /** The destination itself, never a route that redirects to it. */
  readonly href: string;
  readonly name: string;
  readonly blurb: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return generatePageMetadata({
    title:
      locale === "zh"
        ? "On-Page SEO 检查器：一个页面，一组关键词"
        : "On-Page SEO Checker: One Page, One Set of Queries",
    description:
      locale === "zh"
        ? "提交一个页面和最多五个关键词，看每个词在 title、描述、H1、副标题、正文开头和 URL 里是否出现、出现多少次，以及哪些事实公开 HTML 量不出来。"
        : "Submit one page and up to five queries to see where each appears in the title, description, H1, sub-headings, opening text and URL, how often, and what public HTML cannot measure.",
    locale,
    path: PATH,
  });
}

export default async function OnPageSeoCheckPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, messages] = await Promise.all([
    getTranslations({ locale, namespace: "tools.onPageChecker" }),
    getMessages(),
  ]);
  const home = locale === "zh" ? "首页" : "Home";
  const tools = locale === "zh" ? "工具" : "Tools";
  const faqItems = t.raw("faq.items") as readonly FaqItem[];
  const relatedTools = t.raw("related.items") as readonly RelatedTool[];

  return (
    <div className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="mx-auto max-w-report px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: home, url: localeUrl(locale) },
            { name: tools, url: localeUrl(locale, "/tools") },
            { name: t("title"), url: localeUrl(locale, PATH) },
          ]}
        />
        <FaqPageJsonLd faqs={faqItems.map((item) => ({ ...item }))} />
        <VisibleBreadcrumb
          items={[
            { label: home, href: localePath(locale) },
            { label: tools, href: localePath(locale, "/tools") },
            { label: t("title") },
          ]}
        />

        <header className="relative overflow-hidden border-b border-brand-border pt-6 pb-10">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-signal-grid opacity-40"
          />
          <div className="relative z-10 max-w-[720px]">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("eyebrow")}
            </p>
            <h1 className="mt-4 text-page-title text-text-dark-primary">
              {t("title")}
            </h1>
            <p className="mt-4 text-[15px] leading-[1.65] text-text-dark-secondary md:text-[16.5px]">
              {t("intro")}
            </p>
          </div>
        </header>

        {/*
          Only the namespaces the client actually reads.

          Handing the provider the whole catalogue serializes every message on
          the site into this page's RSC payload and its HTML — 232 KB against a
          sibling tool page's 13 KB — for a component that reads two namespaces.
        */}
        <NextIntlClientProvider
          messages={{
            tools: {
              onPageChecker: messages.tools.onPageChecker,
              // The shared account of the crawl gate's errors, so this page does
              // not write a second, contradicting one.
              seoAudit: { errors: messages.tools.seoAudit.errors },
            },
          }}
        >
          <OnPageChecker locale={locale} />
        </NextIntlClientProvider>

        {/*
          The boundary, written down where a visitor reads the report.

          It was only ever in a pull request description, so a page that got no
          verdict on something read as a hole rather than as a stated limit —
          and the tool this one is measured against publishes exactly this
          chapter.
        */}
        <section className="mt-14 border-t border-brand-border pt-10">
          <h2 className="text-[21px] text-text-dark-primary">
            {t("coverage.title")}
          </h2>
          <p className="mt-3 max-w-[720px] text-[14px] leading-[1.7] text-text-dark-secondary">
            {t("coverage.intro")}
          </p>
          <dl className="mt-6 grid gap-4 md:grid-cols-2">
            {COVERAGE_GROUPS.map((group) => (
              <div key={group}>
                <dt className="text-[14px] text-text-dark-primary">
                  {t(`coverage.labels.${group}`)}
                </dt>
                <dd className="mt-1 text-[13.5px] leading-[1.7] text-text-dark-secondary">
                  {t(`coverage.checks.${group}`)}
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-10 text-[16px] text-text-dark-primary">
            {t("coverage.notTitle")}
          </h3>
          <ul className="mt-3 grid max-w-[760px] gap-2">
            {COVERAGE_EXCLUSIONS.map((entry) => (
              <li
                className="text-[13.5px] leading-[1.7] text-text-dark-secondary"
                key={entry}
              >
                {t(`coverage.not.${entry}`)}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14 border-t border-brand-border pt-10">
          <h2 className="text-[21px] text-text-dark-primary">
            {t("faq.title")}
          </h2>
          <dl className="mt-6 grid gap-6">
            {faqItems.map((item) => (
              <div key={item.q}>
                <dt className="text-[15px] text-text-dark-primary">
                  {item.q}
                </dt>
                <dd className="mt-2 text-[14px] leading-[1.7] text-text-dark-secondary">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/*
          Where the page hands off.

          The checker answers one question about one page; everything it
          deliberately does not answer — the site around that page, what to
          write next, why traffic moved — is a different tool here, and a
          visitor who reaches the bottom of this report is exactly the person
          with that next question.
        */}
        <section className="mt-14 border-t border-brand-border pt-10">
          <h2 className="text-[21px] text-text-dark-primary">
            {t("related.title")}
          </h2>
          <p className="mt-3 max-w-[720px] text-[14px] leading-[1.7] text-text-dark-secondary">
            {t("related.intro")}
          </p>
          <ul className="mt-6 grid gap-4 md:grid-cols-2">
            {relatedTools.map((tool) => (
              <li key={tool.href}>
                <a
                  className="block rounded-xl border border-brand-border-card bg-brand-panel p-5 transition-colors hover:border-brand-accent/40"
                  href={localePath(locale, tool.href)}
                >
                  <span className="block text-[15px] text-text-dark-primary">
                    {tool.name}
                  </span>
                  <span className="mt-1.5 block text-[13.5px] leading-[1.7] text-text-dark-secondary">
                    {tool.blurb}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
