// @input  -- locale, optional explicit Brief-repair handoff, and the tools.geoKnowledgeBase messages
// @output -- public knowledge-base explanation, canonical Profile entry, and bounded repair editor
// @pos    -- compatibility information URL; editing lives only in Website Profile

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

/** Preserve the existing compatibility route's rendering boundary. */
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
        ? "在网站 Profile 底部统一维护完整 GEO 知识库，审阅有来源的角色、事实和提问集，再冻结为可供 GEO 工具直接使用的不可变版本。"
        : "Maintain a complete GEO knowledge base in your Website Profile, review source-grounded roles, facts and questions, then freeze an immutable version for your GEO tools.",
    locale,
    path: PATH,
  });
}

export default async function GeoKnowledgeBasePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ repair?: string | readonly string[] }>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: "tools.geoKnowledgeBase" });
  const repair = query.repair === "brief";
  const repairContext = repair
    ? await Promise.all([
      getMessages(),
      getServerAuthenticationStatus(),
    ])
    : null;
  const repairEditor = repairContext === null
    ? null
    : (
      <NextIntlClientProvider
        messages={{
          tools: { geoKnowledgeBase: repairContext[0].tools.geoKnowledgeBase },
          account: { websites: { fields: repairContext[0].account.websites.fields, editor: repairContext[0].account.websites.editor } },
        }}
      >
        <GeoKnowledgeBase
          locale={locale}
          signedIn={repairContext[1] === "authenticated"}
        />
      </NextIntlClientProvider>
    );
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
            <p className="mt-4 text-sm leading-relaxed text-text-dark-secondary">
              {t("asset.shortcutDescription")}{" "}
              <a className="text-brand-accent-text underline" href={localePath(locale, "/account/websites")}>{t("asset.backToWebsites")}</a>
            </p>
          </div>
        </header>

        {repairEditor}

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
