// @input  -- locale and the tools.geoBrief messages
// @output -- the brief generator, its stated limits and its FAQ
// @pos    -- /tools/geo-brief, the end of the GEO chain: one question becomes something writable

import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { GeoBriefTool } from "@/components/tools/geo-brief";
import styles from "@/components/tools/geo-brief-workspace.module.css";
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
    <div className={styles.page}>
      <div className={styles.container}>
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

        <NextIntlClientProvider
          messages={{ tools: { geoBrief: messages.tools.geoBrief } }}
        >
          <GeoBriefTool />
        </NextIntlClientProvider>

        <section className={styles.support}>
          <h2 className="text-[21px] text-text-dark-primary">
            {t("limitsTitle")}
          </h2>
          <p className="mt-4 max-w-[760px]">{t("artifact.limitsBody")}</p>
        </section>

        <section className={styles.support}>
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

        <section className={styles.support}>
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
                  className="block border border-brand-border-card bg-brand-panel p-5 transition-colors hover:border-brand-accent-text"
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
