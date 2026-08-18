// @input  -- locale and agents.tech messages
// @output -- the technical-first view of the unified SEO Agent, canonical to it
// @pos    -- /agents/tech, kept reachable while its authority moves to /agents/seo

import { AgentPage } from "@/components/agents/agent-page";
import { generatePageMetadata } from "@/lib/seo";
import { getTranslations } from "next-intl/server";

const PATH = "/agents/tech";

/**
 * The URL stays; its search authority does not.
 *
 * This page and `/agents/seo` render the same workbench over the same engine
 * and differ only in which checks open first, which is a near-duplicate on a
 * site that sells finding near-duplicates. Redirecting would break links and
 * campaigns that still point here, so the page keeps serving and hands its
 * authority to the unified Agent instead. When the two merge for real this
 * becomes a permanent redirect.
 */
const CANONICAL_PATH = "/agents/seo";

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
    canonicalPath: CANONICAL_PATH,
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
