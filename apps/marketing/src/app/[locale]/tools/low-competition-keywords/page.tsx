// @input  -- locale param, the visitor's Search Console grant, and the market allow-list
// @output -- the running Keyword Opportunity Map on the shared connected-tool shell
// @pos    -- P0-5 acquisition page; the waitlist it replaced is gone because the tool exists
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { KeywordMapArticle } from "@/components/tools/keyword-map-article";
import { KeywordMapTool } from "@/components/tools/keyword-map-tool";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
  HowToJsonLd,
  ToolSoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import { KEYWORD_MARKET_LOCATIONS } from "@/lib/tools/keyword-providers";
import { readTrafficDropSession } from "@/lib/tools/traffic-drop-session";
import { localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

// This route renders the visitor's cookie-backed grant state, so it cannot be
// part of the statically built locale tree.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "low-competition-keywords");
  return generatePageMetadata({
    title:
      locale === "en" ? "Low Competition Keyword Finder" : "低竞争关键词发现",
    description: content.description,
    locale,
    path: content.path,
  });
}

export default async function LowCompetitionKeywordsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [session, messages] = await Promise.all([
    readTrafficDropSession(),
    getMessages(),
  ]);
  const content = getConnectedToolContent(locale, "low-competition-keywords");
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
        article={<KeywordMapArticle locale={locale} />}
      >
        {/* Only this tool's namespace crosses the client boundary. */}
        <NextIntlClientProvider
          messages={{ tools: { keywordMap: messages.tools.keywordMap } }}
        >
          <KeywordMapTool
            locale={locale}
            properties={session.properties}
            propertyTotal={session.propertyTotal}
            connectEnabled={session.connectEnabled}
            consentNotice={session.consentNotice}
            /*
             * Read here, from the adapter that owns it. The allow-list exists
             * because the provider bills per task and answers an unmapped
             * location with an error only after the call, so a second copy in
             * the client bundle would be a second thing to forget to update.
             */
            markets={Object.keys(KEYWORD_MARKET_LOCATIONS)}
          />
        </NextIntlClientProvider>
      </ConnectedToolPage>
    </>
  );
}
