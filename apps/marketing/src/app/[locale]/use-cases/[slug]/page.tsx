// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the editorial library
// @pos    -- retires unverified use-case detail URLs without creating dead ends
import { permanentRedirect } from "next/navigation";

export default async function UseCaseDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/blog`);
}
