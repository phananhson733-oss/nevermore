// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the editorial library
// @pos    -- retires noindex playbooks backed by non-canonical sample data
import { permanentRedirect } from "next/navigation";

export default async function PlaybooksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/blog`);
}
