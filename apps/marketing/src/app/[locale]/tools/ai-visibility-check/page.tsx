// @input  -- locale, the visitor's authentication status, and the tools.aiVisibility messages
// @output -- the visibility check, its stated limits and its FAQ
// @pos    -- /tools/ai-visibility-check, the run that reads a frozen knowledge base

import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { AiVisibilityCheck } from "@/components/tools/ai-visibility-check";
import { getServerAuthenticationStatus } from "@/lib/auth/server-auth-status";
import { VISIBILITY_LIMITS } from "@/lib/geo-tools/visibility-contract";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

const PATH = "/tools/ai-visibility-check";

/** The run belongs to the signed-in account, so this page cannot be prerendered. */
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
        ? "AI 可见性体检：模型回答里有没有你，引用的是谁"
        : "AI Visibility Check: Whether Answers Mention You, and Who They Cite",
    description:
      locale === "zh"
        ? "用冻结的问题集在 ChatGPT 上重复提问，看你在哪些回答里被提到、在哪些里被引用，以及这些回答是用哪些域名的内容拼出来的。每个数字都带采样次数与区间。"
        : "Ask a frozen question set on ChatGPT several times each and see where you are mentioned, where you are cited, and which domains the answers were built from. Every number carries its sample count and interval.",
    locale,
    path: PATH,
  });
}

export default async function AiVisibilityCheckPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, messages, authentication] = await Promise.all([
    getTranslations({ locale, namespace: "tools.aiVisibility" }),
    getMessages(),
    getServerAuthenticationStatus(),
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
          messages={{ tools: { aiVisibility: messages.tools.aiVisibility } }}
        >
          <AiVisibilityCheck authentication={authentication} locale={locale} />
        </NextIntlClientProvider>

        {/*
          Read from the same constant the report ships, so the page and the
          result cannot describe different boundaries.
        */}
        <section className="mt-14 border-t border-brand-border pt-10">
          <h2 className="text-[21px] text-text-dark-primary">
            {t("limitsTitle")}
          </h2>
          <ul className="mt-4 grid max-w-[760px] gap-3">
            {VISIBILITY_LIMITS.map((limit) => (
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
