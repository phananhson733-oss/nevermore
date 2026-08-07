import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { QuickWinsTool } from "@/components/tools/quick-wins-tool";
import { SeoQuickWinsArticle } from "@/components/tools/seo-quick-wins-article";
import { BreadcrumbJsonLd } from "@/components/seo/json-ld/breadcrumb-json-ld";
import { FaqPageJsonLd } from "@/components/seo/json-ld/faq-page-json-ld";
import { HowToJsonLd } from "@/components/seo/json-ld/how-to-json-ld";
import { ToolSoftwareApplicationJsonLd } from "@/components/seo/json-ld/tool-software-application-json-ld";
import { readTrafficDropSession } from "@/lib/tools/traffic-drop-session";
import { draftsEnabled } from "@/lib/tools/quick-wins-draft-config";
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
  const content = getConnectedToolContent(locale, "seo-quick-wins", {
    draftsEnabled: draftsEnabled(),
  });
  return generatePageMetadata({
    title:
      locale === "en"
        ? "High Impressions, Low Clicks in GSC? Find Pages to Fix"
        : "GSC 曝光高但点击少？找出该修复的页面",
    description:
      locale === "en"
        ? "Connect Search Console read-only to find measurable query and page opportunities, with evidence, limits, and an ordered next step."
        : "以只读方式连接 Search Console，找出可衡量的查询词与页面机会，并查看证据、限制和下一步顺序。",
    locale,
    path: content.path,
  });
}

export default async function SeoQuickWinsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // The Google grant belongs to the visitor, not to one tool; both connected
  // tools read the same session.
  const [session, messages] = await Promise.all([
    readTrafficDropSession(),
    getMessages(),
  ]);
  // Drafts are configuration, not code: a deployment without a model key runs
  // the whole evidence table and cannot produce a single draft. The page reads
  // the same switch the API does, so it never advertises a capability this
  // deployment does not have — and starts advertising it again the moment the
  // key is set, with nothing to remember.
  const drafts = draftsEnabled();
  const content = getConnectedToolContent(locale, "seo-quick-wins", {
    draftsEnabled: drafts,
  });
  const canonical = localeUrl(locale, content.path);

  return (
    <>
      {/*
        Structured data is generated from the same content object the page
        renders, never written out alongside it. A schema block maintained
        separately from the visible copy ends up describing a page that does
        not exist, and it is the version Google reads.
      */}
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
        article={<SeoQuickWinsArticle locale={locale} draftsEnabled={drafts} />}
      >
        {/* Only this tool's namespace crosses the client boundary, matching the shell's deliberately small provider. */}
        <NextIntlClientProvider
          messages={{ tools: { quickWins: messages.tools.quickWins } }}
        >
          <QuickWinsTool
            locale={locale}
            properties={session.properties}
            propertyTotal={session.propertyTotal}
            connectEnabled={session.connectEnabled}
            consentNotice={session.consentNotice}
          />
        </NextIntlClientProvider>
      </ConnectedToolPage>
    </>
  );
}
