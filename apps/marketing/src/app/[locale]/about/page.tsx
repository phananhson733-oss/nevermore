// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the current product-positioning page
// @pos    -- retires the noindex About landing page without leaving old links broken
import { permanentRedirect } from "next/navigation";

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/pricing`);
}
