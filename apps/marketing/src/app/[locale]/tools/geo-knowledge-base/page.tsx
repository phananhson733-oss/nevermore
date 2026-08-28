// @input  -- locale, the visitor's authentication status, and the tools.geoKnowledgeBase messages
// @output -- the knowledge-base editor, its stated limits and its FAQ
// @pos    -- /tools/geo-knowledge-base, the asset the other GEO tools read from

import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { GeoKnowledgeBase } from "@/components/tools/geo-knowledge-base";
import { getServerAuthenticationStatus } from "@/lib/auth/server-auth-status";
import { localePath, localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

const PATH = "/tools/geo-knowledge-base";

/** The editor reads the signed-in account, so this page cannot be prerendered. */
export const dynamic = "force-dynamic";

const LIMITS = ["notSynced", "noGuess", "noGsc", "englishOnly"] as const;

interface FaqItem {
  readonly q: string;
  readonly a: string;
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
        ? "GEO 知识库：模型要认出你，需要知道什么"
        : "GEO Knowledge Base: What a Model Needs to Recognise You",
    description:
      locale === "zh"
        ? "记录品牌名与别名、品类词、买家角色、竞品的品牌名映射与已核实事实，冻结成不可变版本，AI 可见性体检的问题集由它确定性地推导出来。"
        : "Record the names you go by, your category, who you sell to, competitors by the name a model would use, and the facts you can source. Freeze it, and the visibility check derives its questions from it.",
    locale,
    path: PATH,
  });
}

export default async function GeoKnowledgeBasePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, messages, authentication] = await Promise.all([
    getTranslations({ locale, namespace: "tools.geoKnowledgeBase" }),
    getMessages(),
    getServerAuthenticationStatus(),
  ]);
  const home = locale === "zh" ? "首页" : "Home";
  const tools = locale === "zh" ? "工具" : "Tools";
  const faqItems = t.raw("faq.items") as readonly FaqItem[];

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
          messages={{
            tools: { geoKnowledgeBase: messages.tools.geoKnowledgeBase },
          }}
        >
          <GeoKnowledgeBase
            locale={locale}
            signedIn={authentication === "authenticated"}
          />
        </NextIntlClientProvider>

        <section className="mt-14 border-t border-brand-border pt-10">
          <h2 className="text-[21px] text-text-dark-primary">
            {t("limitsTitle")}
          </h2>
          <ul className="mt-4 grid max-w-[760px] gap-3">
            {LIMITS.map((limit) => (
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
      </div>
    </div>
  );
}
