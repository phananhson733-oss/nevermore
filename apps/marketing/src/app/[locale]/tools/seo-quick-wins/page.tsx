import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { QuickWinsTool } from "@/components/tools/quick-wins-tool";
import { readTrafficDropSession } from "@/lib/tools/traffic-drop-session";
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

  return (
    <ConnectedToolPage
      locale={locale}
      content={getConnectedToolContent(locale, "seo-quick-wins")}
      connected={session.properties !== null}
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
  );
}
