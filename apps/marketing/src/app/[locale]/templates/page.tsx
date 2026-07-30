// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the current editorial library
// @pos    -- retires the noindex template hub in favor of repository-backed articles
import { permanentRedirect } from "next/navigation";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/blog`);
}
