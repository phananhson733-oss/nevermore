import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { TrafficDropTool } from "@/components/tools/traffic-drop-tool";
import { readTrafficDropSession } from "@/lib/tools/traffic-drop-session";
import { generatePageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "traffic-drop-diagnosis");
  return generatePageMetadata({ title: "Traffic Drop Diagnosis", description: content.description, locale, path: content.path });
}

export default async function TrafficDropDiagnosisPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const [session, messages] = await Promise.all([readTrafficDropSession(), getMessages()]);

  return (
    <ConnectedToolPage locale={locale} content={getConnectedToolContent(locale, "traffic-drop-diagnosis")}>
      {/* Only this tool's namespace crosses the client boundary, matching the shell's deliberately small provider. */}
      <NextIntlClientProvider messages={{ tools: { trafficDrop: messages.tools.trafficDrop } }}>
        <TrafficDropTool
          locale={locale}
          properties={session.properties}
          connectEnabled={session.connectEnabled}
        />
      </NextIntlClientProvider>
    </ConnectedToolPage>
  );
}
