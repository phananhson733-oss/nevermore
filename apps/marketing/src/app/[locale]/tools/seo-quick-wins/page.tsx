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
import { localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "seo-quick-wins");
  return generatePageMetadata({
    title: content.title,
    description: content.description,
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
  const content = getConnectedToolContent(locale, "seo-quick-wins");
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
        article={<SeoQuickWinsArticle locale={locale} />}
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
