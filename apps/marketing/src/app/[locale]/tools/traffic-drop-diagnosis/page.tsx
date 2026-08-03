import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { brandTermCandidates } from "@sf/public-tools";
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
  // Localised, from the same source as the rest of this page's copy. Both
  // branches fixed the hard-coded English title that was reaching the Chinese
  // page's tab, og:title and Twitter card; this is main's resolution, and it
  // is the right one — the same change removed `tools.trafficDrop.metaTitle`
  // from the message bundles, so reading it here would throw MISSING_MESSAGE
  // at request time. `generatePageMetadata` adds the brand for share cards and
  // the root layout's title template adds it for `<title>`, so `content.title`
  // must not carry it either.
  return generatePageMetadata({
    title: content.title,
    description: content.description,
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
          {...(session.properties
            ? {
                /*
                 * Derived here rather than in the browser: `@sf/public-tools`
                 * reaches `node:net` through its own index, so a client
                 * component can only take TYPES from it. These are candidates
                 * for a form the visitor edits — never a brand list on their
                 * behalf; the domain gets it wrong in both directions and
                 * silently. See brand-candidates.ts.
                 */
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
  );
}
