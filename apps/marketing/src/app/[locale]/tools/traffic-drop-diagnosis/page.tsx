import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { brandTermCandidates } from "@sf/public-tools";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { TrafficDropTool } from "@/components/tools/traffic-drop-tool";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
  HowToJsonLd,
  ToolSoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import { readTrafficDropSession } from "@/lib/tools/traffic-drop-session";
import { localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

// This route renders the visitor's cookie-backed GSC connection state. Keep it
// request-bound even though the surrounding locale tree is statically built.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "traffic-drop-diagnosis");
  // Localised, from the same source as the rest of this page's copy. Both
  // branches fixed the hard-coded English title that was reaching the Chinese
  // page's tab, og:title and Twitter card; this is main's resolution, and it
  // is the right one — the same change removed `tools.trafficDrop.metaTitle`
  // from the message bundles, so reading it here would throw MISSING_MESSAGE
  // at request time. `generatePageMetadata` adds the brand for share cards and
  // the root layout's title template adds it for `<title>`, so `content.title`
  // must not carry it either.
  return generatePageMetadata({
    title: locale === "en" ? "SEO Traffic Drop Diagnosis" : "SEO 流量下降诊断",
    description:
      locale === "en"
        ? "Verify a drop against your own Search Console history, locate the change point, and see what the data can and cannot say about a penalty or manual action."
        : "用自己的 Search Console 历史数据确认自然流量是否真的下降、定位变化时点，并弄清数据对「是否被惩罚 / 手动操作」能说明什么、不能说明什么。",
    locale,
    path: content.path,
  });
}

export default async function TrafficDropDiagnosisPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [session, messages] = await Promise.all([
    readTrafficDropSession(),
    getMessages(),
  ]);
  const content = getConnectedToolContent(locale, "traffic-drop-diagnosis");
  const canonical = localeUrl(locale, content.path);

  return (
    <>
      <ToolSoftwareApplicationJsonLd
        name={content.title}
        description={content.description}
        url={canonical}
        featureList={content.outputs.map((output) => output.label)}
      />
      <HowToJsonLd name={content.workflowTitle} steps={content.steps} />
      <FaqPageJsonLd
        faqs={content.faq.map((item) => ({
          q: item.question,
          a: item.answer,
        }))}
      />
      <BreadcrumbJsonLd
        items={[
          { name: locale === "zh" ? "首页" : "Home", url: localeUrl(locale) },
          {
            name: locale === "zh" ? "免费 SEO 工具" : "Free SEO Tools",
            url: localeUrl(locale, "/tools"),
          },
          { name: content.title, url: canonical },
        ]}
      />
      <ConnectedToolPage
        locale={locale}
        content={content}
        connected={session.properties !== null}
      >
        {/* Only this tool's namespace crosses the client boundary, matching the shell's deliberately small provider. */}
        <NextIntlClientProvider
          messages={{ tools: { trafficDrop: messages.tools.trafficDrop } }}
        >
          <TrafficDropTool
            locale={locale}
            properties={session.properties}
            propertyTotal={session.propertyTotal}
            connectEnabled={session.connectEnabled}
            consentNotice={session.consentNotice}
            {...(session.properties
              ? {
                  /*
                   * Derived here rather than in the browser: `@sf/public-tools`
                   * reaches `node:net` through its own index, so a client
                   * component can only take TYPES from it. These are candidates
                   * for a form the visitor edits — never a brand list on their
                   * behalf; the domain gets it wrong in both directions and
                   * silently. See brand-candidates.ts.
                   */
                  brandCandidates: Object.fromEntries(
                    session.properties.map((property) => [
                      property,
                      brandTermCandidates(property),
                    ]),
                  ),
                }
              : {})}
          />
        </NextIntlClientProvider>
      </ConnectedToolPage>
    </>
  );
}
