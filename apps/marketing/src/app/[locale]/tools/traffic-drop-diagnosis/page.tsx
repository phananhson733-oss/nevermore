import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { TrafficDropTool } from "@/components/tools/traffic-drop-tool";
import { readTrafficDropSession } from "@/lib/tools/traffic-drop-session";
import { generatePageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "traffic-drop-diagnosis");
  // Localised, like every other tool page. A hard-coded English string here put
  // "Traffic Drop Diagnosis" in the tab title, the og:title and the Twitter
  // card of the Chinese page — on a page whose whole job is to be found.
  const t = await getTranslations({ locale, namespace: "tools.trafficDrop" });
  return generatePageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
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

  return (
    <ConnectedToolPage
      locale={locale}
      content={getConnectedToolContent(locale, "traffic-drop-diagnosis")}
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
        />
      </NextIntlClientProvider>
    </ConnectedToolPage>
  );
}
