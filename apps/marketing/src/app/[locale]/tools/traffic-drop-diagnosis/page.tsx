import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { generatePageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "traffic-drop-diagnosis");
  return generatePageMetadata({ title: "Traffic Drop Diagnosis", description: content.description, locale, path: content.path });
}

export default async function TrafficDropDiagnosisPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ConnectedToolPage locale={locale} content={getConnectedToolContent(locale, "traffic-drop-diagnosis")} />;
}
