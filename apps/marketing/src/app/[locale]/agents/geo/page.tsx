// @input  -- locale and agents.geo messages
// @output -- canonical, independent GEO Agent page
// @pos    -- /agents/geo marketing acquisition route

import { GeoAgentPage } from "@/components/agents/geo/geo-agent-page";
import { generatePageMetadata } from "@/lib/seo";
import { getTranslations } from "next-intl/server";

const PATH = "/agents/geo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.geo" });
  return generatePageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    locale,
    path: PATH,
  });
}

export default async function GeoAgentRoute({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <GeoAgentPage locale={locale} />;
}
