// @input  -- locale and the tools.geoBrief messages
// @output -- the brief generator, its stated limits and its FAQ
// @pos    -- /tools/geo-brief, the end of the GEO chain: one question becomes something writable

import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { GeoBriefTool } from "@/components/tools/geo-brief";
import { GEO_BRIEF_LIMITS } from "@/lib/geo-tools/brief-contract";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

const PATH = "/tools/geo-brief";

/** The brief is built from the signed-in account's own frozen version. */
export const dynamic = "force-dynamic";

interface FaqItem {
  readonly q: string;
  readonly a: string;
}

interface RelatedTool {
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
        ? "GEO Brief 生成器：把一道提问变成能写的东西"
        : "GEO Brief Builder: Turn One Question Into Something Writable",
    description:
      locale === "zh"
        ? "拿一道 AI 会被问到的题，看一次真实回答是怎么分段的，再配上你自己核实过的事实表，产出一份带出处的写作 Brief。没核实的维度只会写「未核实」，不会补数字。"
        : "Take one question buyers ask an AI, read how a real answer to it was organised, pair that with your own verified facts, and get a brief with provenance on every line. Unverified dimensions stay unverified; no number is filled in.",
    locale,
    path: PATH,
  });
}

export default async function GeoBriefPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, messages] = await Promise.all([
    getTranslations({ locale, namespace: "tools.geoBrief" }),
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

        <NextIntlClientProvider
          messages={{ tools: { geoBrief: messages.tools.geoBrief } }}
        >
          <GeoBriefTool />
        </NextIntlClientProvider>

        {/*
          The same constant the brief ships, so the page and the result cannot
          describe different boundaries.
        */}
        <section className="mt-14 border-t border-brand-border pt-10">
          <h2 className="text-[21px] text-text-dark-primary">
            {t("limitsTitle")}
          </h2>
          <ul className="mt-4 grid max-w-[760px] gap-3">
            {GEO_BRIEF_LIMITS.map((limit) => (
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
