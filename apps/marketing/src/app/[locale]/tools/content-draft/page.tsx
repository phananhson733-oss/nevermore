// @input  -- locale and the visitor's server-verified sign-in state
// @output -- the authenticated on-demand Content Draft Writer on Marketing
// @pos    -- second tool of the content chain; takes a Content Brief as its only input and
//            hands a published URL on to the On-Page SEO Checker
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { ContentDraftTool } from "@/components/tools/content-draft-tool";
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
import { getServerAuthenticationStatus } from "@/lib/auth/server-auth-status";

// The server reads the sign-in cookie for each visit to decide the gate.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "content-draft");
  return generatePageMetadata({
    title: locale === "zh" ? "内容初稿生成器" : "Content Draft Writer",
    description: content.description,
    locale,
    path: content.path,
  });
}

export default async function ContentDraftPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [authentication, messages] = await Promise.all([
    getServerAuthenticationStatus(),
    getMessages(),
  ]);
  const content = getConnectedToolContent(locale, "content-draft");
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
              contentDraft: messages.tools.contentDraft,
            },
          }}
        >
          <ContentDraftTool locale={locale} authenticated={authentication === "authenticated"} />
        </NextIntlClientProvider>
      </ConnectedToolPage>
    </>
  );
}
