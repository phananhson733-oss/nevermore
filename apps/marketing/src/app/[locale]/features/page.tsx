// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the current product-positioning page
// @pos    -- retires the noindex Features landing page without exposing stale claims
import { permanentRedirect } from "next/navigation";

export default async function FeaturesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/pricing`);
}
