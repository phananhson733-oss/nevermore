// @input  -- locale and the visitor's optional GSC property list
// @output -- the authenticated on-demand Content Brief Builder on Marketing
// @pos    -- first tool of the content chain; SERP and competitor pages are third-party,
//            GSC and the product profile are the visitor's own optional evidence
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { ContentBriefTool } from "@/components/tools/content-brief-tool";
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
  const content = getConnectedToolContent(locale, "content-brief");
  return generatePageMetadata({
    title: locale === "zh" ? "内容简报生成器" : "Content Brief Builder",
    description: content.description,
    locale,
    path: content.path,
  });
}

export default async function ContentBriefPage({
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
  const content = getConnectedToolContent(locale, "content-brief");
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
      >
        {/* Only shared auth copy and this tool's messages cross into client UI. */}
        <NextIntlClientProvider
          messages={{
            auth: messages.auth,
            tools: {
              contentBrief: messages.tools.contentBrief,
            },
          }}
        >
          <ContentBriefTool locale={locale} properties={session.properties} />
        </NextIntlClientProvider>
      </ConnectedToolPage>
    </>
  );
}
