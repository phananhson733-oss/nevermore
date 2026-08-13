// @input  -- locale and agents.tech messages
// @output -- canonical, independent Tech Agent page
// @pos    -- /agents/tech marketing acquisition route

import { AgentPage } from "@/components/agents/agent-page";
import { generatePageMetadata } from "@/lib/seo";
import { getTranslations } from "next-intl/server";

const PATH = "/agents/tech";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "agents.tech" });
  return generatePageMetadata({
    title: t("metaTitle"),
    description: t("metaDescription"),
    locale,
    path: PATH,
  });
}

export default async function TechAgentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <AgentPage agent="tech" locale={locale} />;
}
