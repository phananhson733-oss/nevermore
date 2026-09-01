// @input  -- locale and private website route identity
// @output -- canonical website GEO extension, never indexed
// @pos    -- Settings → Website → GEO; tool URL remains a shortcut

import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { localePath } from "@/lib/locale-path";
import { generatePageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";
interface WebsiteGeoPageProps {
  readonly params: Promise<{ readonly locale: string; readonly websiteId: string }>;
}
export async function generateMetadata({ params }: WebsiteGeoPageProps) {
  const { locale, websiteId } = await params;
  const t = await getTranslations({ locale, namespace: "tools.geoKnowledgeBase" });
  return generatePageMetadata({ title: t("asset.title"), description: t("asset.profileBody"), locale,
    path: `/account/websites/${websiteId}/geo`, noIndex: true });
}
export default async function AccountWebsiteGeoPage({ params }: WebsiteGeoPageProps) {
  const { locale, websiteId } = await params;
  redirect(localePath(locale, `/account/websites/${encodeURIComponent(websiteId)}`) + "#geo");
}
