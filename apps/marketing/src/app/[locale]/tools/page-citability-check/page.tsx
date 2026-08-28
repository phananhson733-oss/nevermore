// @input  -- locale and the tools.pageCitability messages
// @output -- the public page-citability checker, its stated limits and its FAQ
// @pos    -- /tools/page-citability-check, the no-login entry into the GEO tools

import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { PageCitabilityCheck } from "@/components/tools/page-citability-check";
import { CITABILITY_LIMITS } from "@/lib/geo-tools/citability-rules";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

const PATH = "/tools/page-citability-check";

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
        ? "页面可引用性检查：AI 回答能不能读到、能不能引用这一页"
        : "Page Citability Check: Can an AI Answer Read and Quote This Page",
    description:
      locale === "zh"
        ? "提交一个网址，检查回答问题的抓取器是否被 robots.txt 放行、正文是否在不执行 JavaScript 的 HTML 里，以及页面上的结论能不能被抽出来引用。"
        : "Submit one URL to check whether the crawlers behind AI answers are allowed in, whether the copy is in the HTML before JavaScript runs, and whether a claim on the page can be lifted out.",
    locale,
    path: PATH,
  });
}

export default async function PageCitabilityCheckPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, messages] = await Promise.all([
    getTranslations({ locale, namespace: "tools.pageCitability" }),
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
          Only the namespace the client actually reads. Handing the provider
          the whole catalogue serializes every message on the site into this
          page's payload for a component that reads one namespace.
        */}
        <NextIntlClientProvider
          messages={{ tools: { pageCitability: messages.tools.pageCitability } }}
        >
          <PageCitabilityCheck locale={locale} />
        </NextIntlClientProvider>

        {/*
          The limits, on the page rather than in a pull request description.
          Read from the same constant the report ships, so the page and the
          result cannot describe different boundaries.
        */}
        <section className="mt-14 border-t border-brand-border pt-10">
          <h2 className="text-[21px] text-text-dark-primary">
            {t("limitsTitle")}
          </h2>
          <ul className="mt-4 grid max-w-[760px] gap-3">
            {CITABILITY_LIMITS.map((limit) => (
              <li
                className="text-[13.5px] leading-[1.7] text-text-dark-secondary"
                key={limit}
              >
                {t(`limits.${limit}`)}
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
                <dt className="text-[15px] text-text-dark-primary">{item.q}</dt>
                <dd className="mt-2 text-[14px] leading-[1.7] text-text-dark-secondary">
                  {item.a}
                </dd>
              </div>
            ))}
          </dl>
        </section>

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
