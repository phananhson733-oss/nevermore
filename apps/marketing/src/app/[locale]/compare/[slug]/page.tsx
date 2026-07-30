// @input  -- slug and locale params
// @output -- permanent redirect from a legacy comparison URL to its Blog card
// @pos    -- legacy URL compatibility after comparisons moved into Blog
// once this file is updated, update header comments and _DIR.md in this folder
import { notFound, permanentRedirect } from "next/navigation";
import { isValidComparisonSlug } from "@/lib/mock/compare-content";

export default async function CompareDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isValidComparisonSlug(slug)) notFound();
  permanentRedirect(`/${locale}/blog#compare-${slug}`);
}
