import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { brandTermCandidates } from "@sf/public-tools";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { DailyBriefingTool } from "@/components/tools/daily-briefing-tool";
import {
  BreadcrumbJsonLd,
  FaqPageJsonLd,
  HowToJsonLd,
  ToolSoftwareApplicationJsonLd,
} from "@/components/seo/json-ld";
import { readTrafficDropSession } from "@/lib/tools/traffic-drop-session";
import { localeUrl } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "daily-search-briefing");
  return generatePageMetadata({
    title: content.title,
    description: content.description,
    locale,
    path: content.path,
  });
}

export default async function DailySearchBriefingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [session, messages] = await Promise.all([
    readTrafficDropSession(),
    getMessages(),
  ]);
  const content = getConnectedToolContent(locale, "daily-search-briefing");
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
        <NextIntlClientProvider messages={{ tools: { dailyBriefing: messages.tools.dailyBriefing } }}>
          <DailyBriefingTool
            locale={locale}
            properties={session.properties}
            propertyTotal={session.propertyTotal}
            connectEnabled={session.connectEnabled}
            consentNotice={session.consentNotice}
            {...(session.properties
              ? {
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
