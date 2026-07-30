import { getConnectedToolContent } from "@/components/tools/connected-tool-content";
import { ConnectedToolPage } from "@/components/tools/connected-tool-page";
import { generatePageMetadata } from "@/lib/seo";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const content = getConnectedToolContent(locale, "hidden-keywords");
  return generatePageMetadata({ title: "Keyword Opportunity Map", description: content.description, locale, path: content.path, noIndex: true });
}

export default async function HiddenKeywordsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <ConnectedToolPage locale={locale} content={getConnectedToolContent(locale, "hidden-keywords")} />;
}
