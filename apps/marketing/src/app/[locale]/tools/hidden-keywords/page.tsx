// @input  -- locale param, connected-tool copy, coming-soon copy, waitlist namespace messages
// @output -- honest coming-soon page: the tool has not shipped; the waitlist is the primary CTA
// @pos    -- P0-5 acquisition page; replaces the former pure redirect to the product app
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld";
import { VisibleBreadcrumb } from "@/components/seo/visible-breadcrumb";
import { generatePageMetadata } from "@/lib/seo";
import { localePath, localeUrl } from "@/lib/locale-path";
import { getHiddenKeywordsComingSoonContent } from "./coming-soon-content";
import { ComingSoonToolSections } from "./coming-soon-sections";
import { ComingSoonWaitlist } from "./coming-soon-waitlist";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "hidden-keywords");
  const comingSoon = getHiddenKeywordsComingSoonContent(locale);
  return generatePageMetadata({
    title: comingSoon.metaTitle,
    description: content.description,
    locale,
    path: content.path,
    noIndex: true,
  });
}

export default async function HiddenKeywordsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "hidden-keywords");
  const comingSoon = getHiddenKeywordsComingSoonContent(locale);
  const messages = await getMessages({ locale });
  const home = locale === "zh" ? "首页" : "Home";
  const tools = locale === "zh" ? "免费 SEO 工具" : "Free SEO Tools";

  return (
    /* 顶部间距只留 36px：PageShell 已经为 fixed 导航垫了 68px */
    <section className="min-h-screen bg-brand-bg pt-9 pb-24">
      <div className="max-w-report mx-auto px-6 md:px-8">
        <BreadcrumbJsonLd
          items={[
            { name: home, url: localeUrl(locale) },
            { name: tools, url: localeUrl(locale, "/tools") },
            { name: content.title },
          ]}
        />
        <VisibleBreadcrumb
          items={[
            { label: home, href: localePath(locale) },
            { label: tools, href: localePath(locale, "/tools") },
            { label: content.title },
          ]}
        />

        <header className="relative overflow-hidden border-b border-brand-border pt-7 pb-12 md:pb-14">
          {/* GLOW_01 — 页级 hero 才允许的网格 + 氛围光 */}
          <div
            aria-hidden="true"
            className="bg-signal-grid absolute inset-0 opacity-40"
          />
          <div
            aria-hidden="true"
            className="absolute -top-30 right-[4%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
          />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
                {content.eyebrow}
              </p>
              {/* Availability chip stays neutral: it is a fact, not a selling point */}
              <span className="rounded border border-brand-border-strong px-2 py-[3px] font-mono text-[9.5px] tracking-[0.08em] text-text-dark-secondary uppercase">
                {comingSoon.statusLabel}
              </span>
            </div>
            <h1 className="text-page-title mt-4 max-w-4xl text-text-dark-primary">
              {content.title}
            </h1>
            <p className="mt-5 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]">
              {content.description}
            </p>

            <div className="rounded-card border-brand-border-card bg-brand-panel mt-8 max-w-3xl border p-[22px]">
              <p className="text-[13px] font-semibold text-text-dark-primary">
                {comingSoon.availabilityTitle}
              </p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-text-dark-secondary">
                {comingSoon.availabilityBody}
              </p>
              <p className="mt-3 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {content.sourceDetail}
              </p>
            </div>

            <NextIntlClientProvider
              messages={{ waitlist: messages.waitlist }}
            >
              <ComingSoonWaitlist content={comingSoon} />
            </NextIntlClientProvider>
          </div>
        </header>

        <ComingSoonToolSections
          locale={locale}
          content={content}
          comingSoon={comingSoon}
        />
      </div>
    </section>
  );
}
