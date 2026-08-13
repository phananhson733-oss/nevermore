// @input  -- locale and agents.seo messages
// @output -- canonical, independent SEO Agent page
// @pos    -- /agents/seo marketing acquisition route

import { AgentPage } from "@/components/agents/agent-page";
import { generatePageMetadata } from "@/lib/seo";
import { getTranslations } from "next-intl/server";

const PATH = "/agents/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.seo" });
  return generatePageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    locale,
    path: PATH,
  });
}

export default async function SeoAgentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <AgentPage agent="seo" locale={locale} />;
}
