// @input  -- locale, the visitor's optional GSC property list, and DFS market allow-list
// @output -- the authenticated on-demand competitor keyword gap tool on Marketing
// @pos    -- independent Marketing tool; competitor facts come from DFS, GSC is an optional own-site overlay
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { CompetitorKeywordGapTool } from "@/components/tools/competitor-keyword-gap-tool";
import { getCompetitorKeywordGapArticle } from "@/components/tools/competitor-keyword-gap-article-content";
import { ToolArticleSections } from "@/components/tools/tool-article";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
  HowToJsonLd,
  ToolSoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import { localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";
import {
  KEYWORD_MARKET_LANGUAGES,
  KEYWORD_MARKET_LOCATIONS,
} from "@/lib/tools/keyword-providers";
import { readTrafficDropSession } from "@/lib/tools/traffic-drop-session";
import { getServerAuthenticationStatus } from "@/lib/auth/server-auth-status";

// The server reads a cookie-backed, optional GSC property list for each visit.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "competitor-keyword-gap");
  return generatePageMetadata({
    title:
      locale === "zh"
        ? "竞品关键词差距分析"
        : "Competitor Keyword Gap Analysis",
    description: content.description,
    locale,
    path: content.path,
  });
}

export default async function CompetitorKeywordGapPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [authentication, session, messages] = await Promise.all([
    getServerAuthenticationStatus(),
    readTrafficDropSession(),
    getMessages(),
  ]);
  const content = getConnectedToolContent(locale, "competitor-keyword-gap");
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
            name: locale === "zh" ? "SEO 辅助工具" : "Supporting SEO Tools",
            url: localeUrl(locale, "/tools"),
          },
          { name: content.title, url: canonical },
        ]}
      />
      <ConnectedToolPage
        locale={locale}
        content={content}
        connected={authentication === "authenticated"}
        accountGated
        compactConnected
        article={
          <ToolArticleSections
            locale={locale}
            article={getCompetitorKeywordGapArticle(locale)}
          />
        }
      >
        {/* Only shared auth copy and this tool's messages cross into client UI. */}
        <NextIntlClientProvider
          messages={{
            auth: messages.auth,
            tools: {
              competitorKeywordGap: messages.tools.competitorKeywordGap,
            },
          }}
        >
          <CompetitorKeywordGapTool
            locale={locale}
            properties={session.properties}
            markets={Object.keys(KEYWORD_MARKET_LOCATIONS)}
            marketLanguages={KEYWORD_MARKET_LANGUAGES}
          />
        </NextIntlClientProvider>
      </ConnectedToolPage>
    </>
  );
}
